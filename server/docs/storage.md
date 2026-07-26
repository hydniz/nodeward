# How agent data is stored

The recommendation this file describes, in one sentence: **one Postgres, three
storage classes, and a series catalogue that makes every value findable years
later.** The schema below is what `store/postgres.ts` should implement; the
repository interfaces in `store/types.ts` already have the right shape for it.

---

## 1. Three classes, not one

Agents deliver three kinds of data that behave nothing alike. Storing them the
same way is what makes monitoring databases unmanageable later.

| | write pattern | volume | lifetime | shape |
| --- | --- | --- | --- | --- |
| **facts** (hosts, services, interfaces, networks, dns) | snapshot per host, rarely changes | tiny | current + history | relational |
| **samples** (cpu, ram, rx/tx, …) | append only, every 15 s | everything | tiered, downsampled | time series |
| **state** (agents, alerts, acks) | mutated in place | tiny | forever | relational |

Facts and state are ordinary tables. Only samples need the machinery below.

## 2. Identity first — this is what "findable" means

Data becomes unfindable because its *keys* were not stable, not because it was
stored in the wrong place. Three rules:

- **`host_id` is a machine identity**, not a hostname and never an ip. Derive it
  once on the agent (`/etc/machine-id`, or a uuid written to
  `/var/lib/nodeward/id`) and keep it across renames and re-installs. A host that
  gets a new id is a new host, and its history is orphaned.
- **`service_id = (host_id, node_id)`** — the same key the ui already uses in its
  urls (`ug1.wiki`). One key, three layers: agent, api, browser.
- **a metric is identified by `(host_id, target, name)`**, and that tuple gets a
  row of its own in `metric_series` — the *catalogue*.

The catalogue is the answer to "übersichtlich und auffindbar":

```sql
-- everything ug1 ever measured, when it started, when it last reported
select name, target_kind, target_id, unit, first_seen_at, last_seen_at
from metric_series where host_id = 'ug1' order by name;
```

Because samples reference the catalogue by a small integer, renaming a metric or
fixing a unit touches one row instead of ten million, and a metric that stopped
being reported is still visible (its `last_seen_at` simply stops moving) — that
is how you notice that the disk metric quietly disappeared three weeks ago.

**Naming convention**, decided once: lowercase, dotted path, unit in the name.
`cpu.pct`, `mem.used.pct`, `fs.used.pct`, `net.rx.bytes_per_s`,
`uptime.seconds`. Never `cpu2` or `cpuPercent`. The domain type `MetricName` is
open on purpose, so this convention is the only thing keeping the catalogue
readable.

## 3. Samples: wide rows for the vitals, narrow rows for the rest

Two mechanisms, because the two access patterns really are different:

**a) `host_vitals` — one wide row per host per tick.** cpu, ram, disk, load,
uptime in fixed columns. Every page load needs these for every host, and one row
per host beats five index lookups. ~5× smaller than the generic form.

**b) `metric_samples` — narrow rows, `(series_id, at, value)`.** Everything else:
per-interface traffic, per-service metrics, and whatever an agent invents next
without a migration.

If you want only one mechanism, take (b) and derive the vitals from it — correct,
just more work per request. Do not take only (a): the moment an agent reports
something per interface, you are back to migrations for every new metric.

## 4. Tiering, or the archive eats the disk

Measured for this fleet (15 s interval, ~15 narrow series per host):

| | 7 hosts | 50 hosts |
| --- | --- | --- |
| raw, kept forever | 20 GB/year | 142 GB/year |
| **tiered (raw 7 d + 5 min 90 d + 1 h forever)** | **≈ 690 MB steady** | **≈ 4.9 GB steady** |

A factor of 25, and the tiered number stops growing. Three tiers:

| tier | resolution | retention | what it is for |
| --- | --- | --- | --- |
| raw | 15 s | 7 days | "what happened during that outage last night" |
| 5 min | 5 min | 90 days | trends, the charts people actually look at |
| 1 h | 1 h | forever | "how much did this grow this year" |

Each rollup row keeps **avg, min, max, last, count** — never only the average: an
average hides exactly the spike that tripped the alert.

**Retention by partition, not by DELETE.** Partition raw by day, rollups by
month, and expiry becomes `drop table metric_samples_2026_07_19` — instant, no
vacuum storm, no bloat. A `DELETE` of ten million rows on a home server is a
twenty-minute outage of the thing that is supposed to be watching for outages.

## 5. Facts: current tables + an append-only change log

The graph needs the *current* facts fast, so they live in normal tables that the
ingest replaces per host (snapshot semantics, see
`InventoryRepository.replaceHost`). But "when did this service appear?" is asked
sooner or later, and an overwriting table cannot answer it — so every applied
snapshot also writes what changed into `inventory_changes`.

That log is small (facts change rarely), it makes the graph explainable in
hindsight, and it is what lets the ui one day show "3 new services since last
week" without keeping full snapshots.

## 6. The schema

```sql
-- ---------------------------------------------------------------- facts
create table hosts (
  id            text primary key,          -- stable machine id
  name          text not null,
  host          text not null,             -- 'hetzner cpx41 · fsn1'
  mgmt          text not null,
  mgmt_ip       inet,
  mgmt_via      text,
  tags          jsonb not null default '[]',
  first_seen_at timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table services (
  host_id   text not null references hosts(id) on delete cascade,
  node_id   text not null,
  label     text not null,
  descr     text not null,
  res       text not null,
  chip_id   text,                          -- the stack it belongs to
  primary key (host_id, node_id)
);

create table interfaces (
  host_id  text not null references hosts(id) on delete cascade,
  iface_id text not null,
  title    text not null,
  net_id   text not null references networks(id),
  node_id  text,                           -- set → the service owns it
  ips      jsonb not null default '[]',
  ports    text,
  primary key (host_id, iface_id)
);

create table networks (
  id    text primary key,
  name  text not null,
  cidr  text,
  color text not null,
  kind  text not null,
  role  text not null,                     -- provider|mesh|overlay|lan|p2p
  virtual boolean not null default false,
  note  text
);

create table edges (                       -- interface ↔ network membership
  id       text primary key,
  host_id  text not null references hosts(id) on delete cascade,
  iface_id text not null,
  net_id   text not null references networks(id),
  node_id  text,
  label    text,
  ring     boolean not null default false,
  foreign key (host_id, iface_id) references interfaces(host_id, iface_id)
    on delete cascade
);

create table dns_zones   ( id text primary key, name text not null, kind text not null,
                           dns text not null, registrar text, renews date,
                           ns jsonb not null default '[]', dnssec boolean not null,
                           color text, note text );

create table dns_records ( id text primary key,
                           zone_id text not null references dns_zones(id) on delete cascade,
                           name text not null, fqdn text not null, type text not null,
                           value text not null, ttl text, proxied boolean not null default false,
                           host_id text references hosts(id) on delete set null,
                           iface_id text, node_id text, net_id text references networks(id),
                           via text, tls jsonb, note text );
create index on dns_records (fqdn);
create index on dns_records (host_id, node_id);

-- what changed, so history is not lost to overwrites
create table inventory_changes (
  at       timestamptz not null default now(),
  host_id  text not null,
  entity   text not null,                  -- host|service|interface|edge|record
  entity_id text not null,
  action   text not null,                  -- added|removed|changed
  before   jsonb,
  after    jsonb
) partition by range (at);
create index on inventory_changes (host_id, at desc);

-- ------------------------------------------------------------- samples
-- the catalogue: one row per thing that is ever measured
create table metric_series (
  id            bigserial primary key,
  host_id       text not null references hosts(id) on delete cascade,
  target_kind   text not null,             -- host|service|interface
  target_id     text not null default '',  -- node_id / iface_id, '' for host
  name          text not null,             -- 'net.rx.bytes_per_s'
  unit          text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (host_id, target_kind, target_id, name)
);

-- the hot path: everything the dashboard shows for every host, one row per tick
create table host_vitals (
  host_id text not null references hosts(id) on delete cascade,
  at      timestamptz not null,
  cpu_pct    real,
  mem_pct    real,
  fs_pct     real,
  load1      real,
  uptime_s   bigint,
  status     text not null,                -- as the agent saw it
  primary key (host_id, at)
) partition by range (at);                 -- daily

-- everything else, generic
create table metric_samples (
  series_id bigint not null references metric_series(id) on delete cascade,
  at        timestamptz not null,
  value     double precision not null,
  primary key (series_id, at)
) partition by range (at);                 -- daily

-- rollups: same shape, coarser, with the spread kept
create table metric_rollup_5m (
  series_id bigint not null references metric_series(id) on delete cascade,
  bucket    timestamptz not null,
  avg double precision not null,
  min double precision not null,
  max double precision not null,
  last double precision not null,
  count int not null,
  primary key (series_id, bucket)
) partition by range (bucket);             -- monthly

create table metric_rollup_1h (like metric_rollup_5m including all)
  partition by range (bucket);             -- yearly

-- --------------------------------------------------------------- events
create table agent_events (
  id      bigserial,
  host_id text not null references hosts(id) on delete cascade,
  at      timestamptz not null,
  received_at timestamptz not null default now(),
  kind    text not null,
  node_id text, iface_id text,
  message text,
  data    jsonb,
  primary key (id, at)
) partition by range (at);                 -- monthly
create index on agent_events (host_id, at desc);

-- ---------------------------------------------------------------- state
create table agents (
  id           text primary key,
  host_id      text not null references hosts(id) on delete cascade,
  name         text not null,
  version      text not null,
  platform     text,
  token_hash   text not null unique,       -- sha-256, never the token
  enrolled_at  timestamptz not null default now(),
  last_seen_at timestamptz,
  last_seq     bigint,                     -- for idempotent ingest
  revoked_at   timestamptz,
  labels       jsonb not null default '{}',
  config       jsonb
);
create index on agents (host_id) where revoked_at is null;

create table alert_rules ( id text primary key, name text not null, metric text not null,
                           comparator text not null, threshold double precision not null,
                           for_seconds int not null, level text not null,
                           enabled boolean not null default true, hosts jsonb );

create table alerts (
  id       bigserial primary key,
  rule_id  text references alert_rules(id) on delete set null,
  host_id  text not null references hosts(id) on delete cascade,
  node_id  text,
  level    text not null,
  text     text not null,
  since    timestamptz not null,
  resolved_at timestamptz,
  acknowledged_at timestamptz,
  observed jsonb,
  -- one open alert per (rule, host, node): makes `raise` idempotent
  unique nulls not distinct (rule_id, host_id, node_id, resolved_at)
);
create index on alerts (host_id) where resolved_at is null;

create table schema_migrations (version text primary key, applied_at timestamptz default now());
```

## 7. The write path

One transaction per report, and nothing clever in it:

1. resolve `series_id` for each sample — `insert … on conflict do update set
   last_seen_at = excluded.last_seen_at returning id`, with the ids **cached in
   memory** (a `Map<string, bigint>`); the catalogue changes once per new metric,
   not once per sample
2. `insert into host_vitals …` (one row) and a **single multi-row insert** for the
   samples — one round trip, not one per sample
3. `update agents set last_seen_at = now(), last_seq = $seq`
4. commit, answer the ack — everything else (alert evaluation, notifications)
   happens *after* the response

Two guards that save a lot of grief later:

- **`collected_at` vs `received_at`**: keep both. A host with a broken clock will
  otherwise write into the future and disappear from every chart. Clamp
  `collected_at` to `received_at` when it is ahead, and count it.
- **`last_seq`**: a retrying agent must be a no-op, not a duplicate.

## 8. Jobs

| job | interval | what it does |
| --- | --- | --- |
| rollup | 5 min | fold raw into `metric_rollup_5m`, then 5 min into `1h` hourly |
| partitions | daily | create tomorrow's partitions, `drop table` the expired ones |
| liveness | 30 s | agents with `last_seen_at` older than the window → host `down` |
| vacuum | — | leave it to autovacuum; partition drops keep bloat away |

`insert into metric_rollup_5m … select series_id, to_timestamp(floor(extract(epoch
from at)/300)*300), avg(value), min(value), max(value), … group by 1, 2 on
conflict do update` — plain SQL, no extension needed.

## 9. Postgres, and what would change that

**Take Postgres.** It is one process to run and back up, it does relational and
time series well enough at this size, and — the actual argument — facts and
metrics live in the same database, so questions that span them stay one query:

```sql
-- fullest disk per site, over the last day, from facts + samples together
select h.tags->>'site' as site, h.name, max(v.fs_pct)
from host_vitals v join hosts h on h.id = v.host_id
where v.at > now() - interval '1 day' group by 1, 2 order by 3 desc;
```

Split metrics into Prometheus/VictoriaMetrics and that query needs application
code and two round trips. For a fleet this size that trade is not worth it.

- **TimescaleDB** if it is easy to run (`timescale/timescaledb` image): the
  hypertable, `continuous aggregate` and compression replace §8's rollup job and
  cut the samples ~10× more. Same tables, same SQL — treat it as an optimisation,
  not a dependency.
- **SQLite** is a legitimate choice while everything lives on one machine: one
  file to back up, no server. You give up partition drops (retention becomes
  `delete` + `vacuum`, or one file per month) and concurrent writers get awkward
  above a handful of agents.
- **Prometheus/VM** only when metrics outgrow the database — 50+ hosts at 15 s, or
  a wish for PromQL. Then keep facts in Postgres and remote-write the samples.

## 10. Where this plugs into the code

| table group | repository | file |
| --- | --- | --- |
| hosts, services, interfaces, networks, edges, dns_*, inventory_changes | `InventoryRepository` | `store/postgres.ts` |
| metric_series, host_vitals, metric_samples, metric_rollup_*, agent_events | `HealthRepository` | same |
| agents | `AgentRepository` | same |
| alerts, alert_rules | `AlertRepository` | same |

For reading the data with other tools — grafana, metabase, `psql` — see
[explore.md](explore.md): it adds a read-only role and the views that hide
`series_id`, plus the queries that work against this schema as-is.

Migrations as plain numbered sql files (`server/db/migrations/001_init.sql`) with
a tiny runner that records them in `schema_migrations` — the project has no orm
and does not need one.

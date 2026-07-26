# Letting people look at the data themselves

Short answer: **yes, grafana works directly against the schema — no exporter, no
second copy of the data.** The samples table is already in the shape grafana's
postgres datasource wants, and because facts and metrics live in the same
database, a query can join them.

But grafana is not the whole answer, because "der Nutzer soll selbst
durchschauen" splits into two very different needs:

| | who | what they want | where it belongs |
| --- | --- | --- | --- |
| **curated** | everyone, on a phone too | "how is ug1 doing, is the disk still filling up" | nodeward itself |
| **ad-hoc** | the operator, at a desk | "correlate wg0 traffic with immich cpu over six months" | grafana / metabase / psql |

Build the first, hand over the second. Trying to make nodeward answer arbitrary
questions turns it into a worse grafana; trying to make grafana draw the topology
turns it into a worse nodeward.

---

## 1. Grafana against the same postgres

### A read-only role — and one table it must not see

```sql
create role nodeward_ro login password '…';
grant connect on database nodeward to nodeward_ro;
grant usage on schema public to nodeward_ro;

-- whitelist, never `all tables`: `agents` holds token hashes
grant select on hosts, services, interfaces, networks, edges,
                dns_zones, dns_records, inventory_changes,
                metric_series, host_vitals, metric_samples,
                metric_rollup_5m, metric_rollup_1h,
                agent_events, alerts, alert_rules to nodeward_ro;
```

`agents.token_hash` is a credential. It is a hash, so it is not directly usable,
but a monitoring dashboard has no business reading it — and `grant select on all
tables` would include every table added later, too.

### Views, so nobody needs to know about `series_id`

The catalogue keeps the archive small, but it makes hand-written queries do a
join. Two views hide that, and they are what an external tool should point at:

```sql
create view v_samples as
select h.id   as host_id,
       h.name as host,
       m.target_kind,
       m.target_id,
       m.name as metric,
       m.unit,
       s.at,
       s.value
from metric_samples s
join metric_series  m on m.id = s.series_id
join hosts          h on h.id = m.host_id;

create view v_vitals as
select h.id as host_id, h.name as host, v.*
from host_vitals v join hosts h on h.id = v.host_id;

-- the same for the rollups, so long ranges stay fast
create view v_samples_5m as
select h.name as host, m.name as metric, m.unit, m.target_kind, m.target_id,
       r.bucket, r.avg, r.min, r.max, r.last, r.count
from metric_rollup_5m r
join metric_series m on m.id = r.series_id
join hosts h on h.id = m.host_id;
```

Rule of thumb for whoever writes dashboards: **explore in the views, build panels
on the base tables** — the view join is cheap (the catalogue is small and stays
cached), but an explicit `series_id` filter lets postgres skip partitions.

### Datasource

Grafana ships the postgres datasource; provision it instead of clicking:

```yaml
# grafana/provisioning/datasources/nodeward.yaml
apiVersion: 1
datasources:
  - name: nodeward
    type: grafana-postgresql-datasource
    url: postgres:5432
    user: nodeward_ro
    jsonData:
      database: nodeward
      sslmode: disable            # a compose network; require it over the wire
      timescaledb: false          # true if the extension is installed
      postgresVersion: 1600
    secureJsonData:
      password: ${NODEWARD_RO_PASSWORD}
```

```yaml
# compose, next to the api and the database
grafana:
  image: grafana/grafana:latest
  environment:
    GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD}
    GF_USERS_ALLOW_SIGN_UP: "false"
  volumes:
    - ./grafana/provisioning:/etc/grafana/provisioning:ro
    - grafana-data:/var/lib/grafana
  ports: ["3000:3000"]
```

### Queries that work as-is

Host vitals, grafana's time macros doing the bucketing:

```sql
SELECT $__timeGroupAlias(at, $__interval),
       avg(cpu_pct) AS cpu, avg(mem_pct) AS ram, avg(fs_pct) AS disk
FROM host_vitals
WHERE $__timeFilter(at) AND host_id = '$host'
GROUP BY 1 ORDER BY 1;
```

Any metric, several series in one panel:

```sql
SELECT $__timeGroupAlias(s.at, $__interval),
       m.name || ' ' || m.target_id AS metric,
       avg(s.value)
FROM metric_samples s
JOIN metric_series m ON m.id = s.series_id
WHERE $__timeFilter(s.at)
  AND m.host_id = '$host'
  AND m.name = ANY (string_to_array('$metric', ','))
GROUP BY 1, 2 ORDER BY 1;
```

Long range — same query against the rollup, and it stays fast for years:

```sql
SELECT r.bucket AS time, m.name AS metric, r.avg, r.max
FROM metric_rollup_1h r JOIN metric_series m ON m.id = r.series_id
WHERE r.bucket BETWEEN $__timeFrom() AND $__timeTo() AND m.host_id = '$host'
ORDER BY 1;
```

Template variables — the catalogue is exactly the list a picker needs:

```sql
-- $host
SELECT name AS __text, id AS __value FROM hosts ORDER BY name;
-- $metric  (depends on $host)
SELECT DISTINCT name FROM metric_series WHERE host_id = '$host' ORDER BY 1;
```

And the thing a metrics-only stack cannot do — facts joined with measurements:

```sql
-- fullest disk per site over the last day
SELECT h.tags->>'site' AS site, h.name, max(v.fs_pct) AS disk
FROM host_vitals v JOIN hosts h ON h.id = v.host_id
WHERE v.at > now() - interval '1 day'
GROUP BY 1, 2 ORDER BY 3 DESC;

-- traffic of every interface that terminates a proxied dns record
SELECT r.fqdn, m.target_id AS iface, avg(s.value) AS bytes_per_s
FROM dns_records r
JOIN metric_series m ON m.host_id = r.host_id AND m.target_id = r.iface_id
JOIN metric_samples s ON s.series_id = m.id
WHERE r.proxied AND m.name = 'net.rx.bytes_per_s' AND s.at > now() - interval '7 days'
GROUP BY 1, 2 ORDER BY 3 DESC;
```

Ship two dashboards as provisioned json (`grafana/provisioning/dashboards/`) so
nobody starts at an empty screen: **fleet** (a row per host, cpu/ram/disk, alert
table) and **host** (`$host` variable, vitals + per-interface traffic + the event
log from `agent_events`).

### If SQL is the wrong ask

Grafana's postgres datasource means writing SQL. If the person who should
"durchschauen" is not going to do that, **metabase** is the better second tool:
point-and-click questions, saved as a browsable collection, same read-only role.
Grafana wins for time series and alerting, metabase for "let me poke around".

### Shortcut: embed instead of build

If nodeward should show a chart but you do not want to build one yet: grafana
panels embed as iframes (`GF_SECURITY_ALLOW_EMBEDDING=true`, panel → share →
embed) — a `<iframe>` in the host detail with `&var-host=ug1` gives a real chart
in the product in an afternoon. Fine as a stepping stone; replace it when the
in-app chart exists, because an iframe brings its own auth, theme and latency.

## 2. What nodeward should answer itself

Three things, all reading endpoints that already exist as seams:

- **sparklines on the host and service detail** — last hour of cpu/ram/disk next
  to the tiles. `GET /api/health/hosts/:hostId/series?metrics=cpu.pct&step=60`.
- **an explore page** — pick host + metric from `GET /api/health/series` (the
  catalogue *is* the picker), pick a window, get a chart and a table. This is
  ~90 % of what people open grafana for, and it stays in the product, in the same
  colours, on a phone.
- **csv, everywhere** — `GET /api/health/hosts/:hostId/export.csv` with the same
  query parameters. Long format (`at,host,target,metric,unit,value`), so it opens
  in a spreadsheet or `pandas.read_csv` without reshaping. The route is finished;
  it answers `501` only because `series()` behind it is still a seam.

The csv is the cheapest possible "look at it yourself" and worth having before
any chart: it makes the data leave the building without a second service.

## 3. Interop, when they already run a stack

Many homelabs already have prometheus + grafana. Two ways to fit in, both small:

- **`GET /metrics`** in prometheus exposition format: the current vitals per host
  as gauges with `host`, `site`, `service` labels. That is a ~50-line route over
  `HealthRepository.latestAll()` and it makes nodeward a normal scrape target.
- **remote-write out**: forward incoming samples to prometheus/victoriametrics as
  well as to postgres. More moving parts; only worth it when metrics volume
  outgrows the database (see `storage.md` §9).

Neither replaces the internal store: alerts, the topology and the ui read facts
and measurements together, which a metrics-only backend cannot do.

## 4. Also browsable without any tool

Because the store is plain postgres with stable ids and readable names:

```sh
psql nodeward -c "select name, target_id, unit, last_seen_at from metric_series
                  where host_id='ug1' order by name"
psql nodeward -c "\copy (select * from v_samples_5m where host='ug1'
                         and bucket > now() - interval '30 days') to 'ug1.csv' csv header"
```

That is the real reason for the schema in `storage.md`: the data stays
understandable to a human with a terminal, years later, without nodeward running.

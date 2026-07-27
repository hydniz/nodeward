import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useApi } from '../api.js';
import RecordModal from '../components/RecordModal.jsx';
import {
  PageHead, Search, Chips, FilterRow, Tile, TileRow, Sect, MasterList,
  DetailHead, KeyRow, Note,
} from '../components/ui.jsx';
import {
  serverPath, netPath, isDirect, useGo,
} from '../nav.js';

const UP = '#3ecf9a';
const WARN = '#e6b450';
const DOWN = '#e0564a';

const GROUPS = [
  ['public', 'public zones'],
  ['magicdns', 'tailnet · magicdns'],
  ['internal', 'internal / split dns'],
];

const FILTERS = [
  ['all', 'All'],
  ['public', 'Public'],
  ['magicdns', 'MagicDNS'],
  ['internal', 'Internal'],
];

const GLYPH = { public: '⊕', magicdns: '⇄', internal: '⌂' };

const DAY = 86400000;
const daysLeft = (date) => Math.ceil((Date.parse(date) - Date.now()) / DAY);
const certTone = (d) => (d < 14 ? 'crit' : d < 30 ? 'warn' : '');

// how a name is exposed — the single most important thing about a record
function exposure(r, netsById) {
  if (!r.server) return { cls: 'none', text: 'external' };
  if (r.proxied) return { cls: 'proxied', text: '◆ cf proxied' };
  const net = netsById[r.net];
  if (net?.role === 'provider') return { cls: 'direct', text: 'direct origin' };
  if (net?.role === 'mesh' || net?.role === 'overlay') return { cls: 'mesh', text: 'tailnet only' };
  return { cls: 'mesh', text: 'lan only' };
}

// one view-model per zone from the raw facts
function buildModel(dom, servers, netsById, query) {
  const serversById = Object.fromEntries(servers.map((s) => [s.id, s]));
  const q = query.trim().toLowerCase();

  const zones = dom.zones.map((z) => {
    const recs = dom.records
      .filter((r) => r.zone === z.id)
      .filter((r) => !q || [r.fqdn, r.value, r.type, r.server, r.note]
        .filter(Boolean).join(' ').toLowerCase().includes(q))
      .map((r) => {
        const s = r.server ? serversById[r.server] : null;
        const iface = s?.interfaces.find((i) => i.id === r.iface);
        const node = r.node ? s?.nodes.find((n) => n.id === r.node) : null;
        const down = r.state === 'down' || s?.status === 'down';
        return {
          ...r,
          server: s,
          serverId: r.server,
          iface,
          node,
          down,
          exposure: exposure(r, netsById),
          cert: r.tls ? { ...r.tls, days: daysLeft(r.tls.expires) } : null,
        };
      });

    const certs = recs.filter((r) => r.cert);
    const soonest = certs.length
      ? certs.reduce((a, r) => (r.cert.days < a.cert.days ? r : a))
      : null;
    return {
      ...z,
      records: recs,
      exposed: recs.filter((r) => r.exposure.cls === 'proxied' || r.exposure.cls === 'direct').length,
      proxied: recs.filter((r) => r.proxied).length,
      broken: recs.filter((r) => r.down).length,
      certs,
      soonest,
      expiring: certs.filter((r) => r.cert.days < 30).length,
    };
  });

  const rank = { public: 0, magicdns: 1, internal: 2 };
  zones.sort((a, b) => rank[a.kind] - rank[b.kind]
    || b.records.length - a.records.length
    || a.id.localeCompare(b.id));

  return {
    zones,
    total: zones.reduce((a, z) => a + z.records.length, 0),
    expiring: zones.reduce((a, z) => a + z.expiring, 0),
    broken: zones.reduce((a, z) => a + z.broken, 0),
  };
}

function Cert({ cert }) {
  if (!cert) return <span className="cert-none">—</span>;
  return (
    <span className={`cert ${certTone(cert.days)}`}>
      {cert.days < 0 ? 'expired' : `${cert.days}d`}
    </span>
  );
}

export default function DomainsPage() {
  const { data: dom } = useApi('/api/domains');
  const { data: srv } = useApi('/api/servers');
  const { data: topo } = useApi('/api/topology');
  const [params, setParams] = useSearchParams();
  const go = useGo();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [recordId, setRecordId] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setRecordId(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const netsById = useMemo(
    () => Object.fromEntries((topo?.networks ?? []).map((n) => [n.id, n])),
    [topo],
  );
  const model = useMemo(
    () => (dom && srv && topo ? buildModel(dom, srv.servers, netsById, query) : null),
    [dom, srv, topo, netsById, query],
  );

  if (!model) {
    return (
      <div className="page">
        <PageHead title="Domains" sub="connecting…" />
      </div>
    );
  }

  const listed = model.zones.filter((z) => (filter === 'all' || z.kind === filter)
    && (!query || z.records.length));
  const selected = model.zones.find((z) => z.id === params.get('zone'))
    ?? listed[0] ?? model.zones[0];
  const openRecord = selected.records.find((r) => r.id === recordId);

  const groups = GROUPS.map(([kind, label]) => ({
    id: kind,
    label,
    items: listed.filter((z) => z.kind === kind).map((z) => ({
      id: z.id,
      name: z.name,
      kind: z.dns,
      color: z.color,
      count: z.records.length,
      state: z.broken
        ? `${z.broken} broken`
        : z.expiring
          ? `${z.expiring} cert${z.expiring > 1 ? 's' : ''} soon`
          : z.kind === 'public' ? `${z.proxied} proxied` : 'no certs',
      bad: z.broken > 0,
    })),
  }));

  return (
    <div className="page scroll">
      <PageHead
        title="Domains"
        sub={`${model.zones.length} zones · ${model.total} records · ${model.expiring} certs under 30d`}
      >
        <Search value={query} onChange={setQuery} placeholder="search names, targets…" />
      </PageHead>

      <FilterRow
        meta={model.broken
          ? `${model.broken} record${model.broken > 1 ? 's' : ''} pointing at something unhealthy`
          : 'every record resolves to a healthy target'}
      >
        <Chips options={FILTERS} value={filter} onChange={setFilter} />
      </FilterRow>

      <div className="detail-layout">
        <MasterList
          groups={groups}
          selectedId={selected.id}
          onSelect={(id) => setParams({ zone: id }, { replace: true })}
        />

        <section className="detailcard">
          <DetailHead
            glyph={GLYPH[selected.kind]}
            color={selected.color}
            title={selected.name}
            chips={[
              selected.dns,
              selected.registrar ? `registrar ${selected.registrar}` : null,
              selected.dnssec ? 'dnssec' : selected.kind === 'public' ? 'no dnssec' : null,
            ]}
            right={<span className="dh-unit">{selected.records.length} records</span>}
          />

          <TileRow>
            <Tile label="records" value={selected.records.length} hint={`${selected.exposed} reachable from the internet`} />
            <Tile
              label="proxied"
              value={selected.kind === 'public' ? `${selected.proxied}/${selected.exposed}` : '—'}
              hint={selected.kind === 'public' ? 'origin hidden behind cf' : 'not a public zone'}
            />
            <Tile
              label="next cert"
              value={selected.soonest ? `${selected.soonest.cert.days}d` : '—'}
              tone={selected.soonest && selected.soonest.cert.days < 30 ? WARN : undefined}
              hint={selected.soonest ? selected.soonest.fqdn : 'no certificates in this zone'}
            />
            <Tile
              label="health"
              value={selected.broken ? `${selected.broken} broken` : 'ok'}
              tone={selected.broken ? DOWN : UP}
              hint={selected.broken ? 'target host unreachable' : 'all targets answering'}
            />
          </TileRow>

          <Sect>records · {selected.records.length}</Sect>
          <div className="table-scroll">
            <table className="dtable">
              <thead>
                <tr>
                  <th>name</th>
                  <th>type</th>
                  <th>target</th>
                  <th>terminates at</th>
                  <th>exposure</th>
                  <th className="num">tls</th>
                </tr>
              </thead>
              <tbody>
                {selected.records.map((r) => {
                  const sub = [r.via ? `via ${r.via}` : null, r.ttl ? `ttl ${r.ttl}` : null]
                    .filter(Boolean).join(' · ');
                  return (
                    <tr
                      key={r.id}
                      className={r.down ? 'is-down' : ''}
                      title="record overview · ctrl+click opens the terminating host"
                      onClick={(e) => {
                        if (isDirect(e) && r.serverId) {
                          go(serverPath(r.serverId, r.node?.id));
                          return;
                        }
                        setRecordId(r.id);
                      }}
                    >
                      <td>
                        <span className="rec-name">
                          {r.name === '@' ? selected.name : r.name}
                          {r.name !== '@' && <span className="rec-zone">.{selected.name}</span>}
                        </span>
                      </td>
                      <td><span className={`rtype ${r.type.toLowerCase()}`}>{r.type}</span></td>
                      <td>
                        <span className="rec-target">
                          <span className="mono" title={r.value}>{r.value}</span>
                          {sub && <span className="rec-via">{sub}</span>}
                        </span>
                      </td>
                      <td>
                        {r.server ? (
                          <span className="rec-ends">
                            <span
                              className="dot sm"
                              style={{ background: r.down ? DOWN : UP }}
                            />
                            <button
                              type="button"
                              className="rec-host as-btn"
                              title="open this host's page"
                              onClick={(e) => {
                                e.stopPropagation();
                                go(serverPath(r.serverId, r.node?.id));
                              }}
                            >
                              {r.server.name}
                              {r.node && <span className="t-node"> · {r.node.label}</span>}
                            </button>
                            {r.net && (
                              <button
                                type="button"
                                className="nbadge"
                                title="open this network's page"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  go(netPath(r.net));
                                }}
                              >
                                {netsById[r.net]?.name ?? r.net}
                              </button>
                            )}
                          </span>
                        ) : (
                          <span className="nil">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`expose ${r.exposure.cls}`}>{r.exposure.text}</span>
                      </td>
                      <td className="num"><Cert cert={r.cert} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Sect>zone</Sect>
          <div className="zone-facts">
            <span><em>dns</em>{selected.dns}</span>
            {selected.registrar && <span><em>registrar</em>{selected.registrar}</span>}
            {selected.renews && <span><em>renews</em>{selected.renews}</span>}
            <span><em>dnssec</em>{selected.dnssec ? 'signed' : 'off'}</span>
            <span><em>nameservers</em>{selected.ns.join(' · ')}</span>
          </div>

          {selected.certs.length > 0 && (
            <>
              <Sect>certificates · {selected.certs.length}</Sect>
              {[...selected.certs]
                .sort((a, b) => a.cert.days - b.cert.days)
                .map((r) => (
                  <KeyRow
                    key={r.id}
                    l={r.fqdn}
                    owner={r.cert.issuer}
                    r={r.cert.days < 0 ? 'expired' : `${r.cert.days}d left · ${r.cert.expires}`}
                    tone={r.cert.days < 14 ? 'down' : r.cert.days < 30 ? 'warn' : 'accent'}
                    mono
                    title="record overview"
                    onClick={() => setRecordId(r.id)}
                  />
                ))}
            </>
          )}

          {selected.records.some((r) => r.note) && (
            <>
              <Sect>notes</Sect>
              {selected.records.filter((r) => r.note).map((r) => (
                <KeyRow
                  key={r.id}
                  l={r.fqdn}
                  r={r.note}
                  tone={r.down ? 'down' : 'dim'}
                  mono
                  title="record overview"
                  onClick={() => setRecordId(r.id)}
                />
              ))}
            </>
          )}

          <Sect>about this zone</Sect>
          <Note>{selected.note}</Note>
        </section>
      </div>

      {openRecord && (
        <RecordModal
          record={openRecord}
          zone={selected}
          net={netsById[openRecord.net]}
          server={openRecord.server}
          node={openRecord.node}
          onClose={() => setRecordId(null)}
        />
      )}
    </div>
  );
}

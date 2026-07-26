import React from 'react';

// ---------------------------------------------------------------------------
// page scaffolding shared by servers / networks / domains
//
// every one of those pages is built from the same four bands:
//   head (title + tools) → filters → tiles → body
// and the master/detail pages (networks, domains) share the same rail +
// detail card. Same vocabulary everywhere: one thing looks like one thing.
// ---------------------------------------------------------------------------

export function PageHead({ title, sub, children }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        <div className="page-sub">{sub}</div>
      </div>
      {children && <div className="head-tools">{children}</div>}
    </header>
  );
}

export function Search({ value, onChange, placeholder }) {
  return (
    <input
      className="search"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// options: [id, label, color?]
export function Chips({ options, value, onChange }) {
  return (
    <>
      {options.map(([id, label, color]) => (
        <button
          key={id}
          type="button"
          className={`chip${value === id ? ' active' : ''}`}
          onClick={() => onChange(id)}
        >
          {color && <span className="chip-dot" style={{ background: color }} />}
          {label}
        </button>
      ))}
    </>
  );
}

export function FilterRow({ children, meta }) {
  return (
    <div className="filter-row">
      {children}
      {meta && <span className="filter-meta">{meta}</span>}
    </div>
  );
}

export function Tile({
  label, value, tone, hint, bar,
}) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value" style={tone ? { color: tone } : undefined}>{value}</div>
      {bar != null && (
        <div className="tile-track">
          <div
            className="tile-fill"
            style={{ width: `${Math.max(0, Math.min(100, bar))}%`, background: tone }}
          />
        </div>
      )}
      {hint && <div className="tile-hint">{hint}</div>}
    </div>
  );
}

export function TileRow({ children }) {
  return <div className="tile-row">{children}</div>;
}

export function Sect({ children, first }) {
  return <div className={`sect${first ? ' no-line' : ''}`}>{children}</div>;
}

// ---- master rail ----------------------------------------------------------
// groups: [{ id, label, items: [{ id, name, kind, color, count, state, bad }] }]
export function MasterList({ groups, selectedId, onSelect }) {
  return (
    <div className="masterlist">
      {groups.filter((g) => g.items.length).map((g) => (
        <React.Fragment key={g.id}>
          <div className="ml-group">{g.label}</div>
          {g.items.map((it) => (
            <button
              key={it.id}
              type="button"
              className={`ml-item${selectedId === it.id ? ' active' : ''}`}
              // left border on wide screens, bottom border in the mobile
              // tab strip — css decides which of the two is visible
              style={selectedId === it.id
                ? { borderLeftColor: it.color, borderBottomColor: it.color }
                : undefined}
              onClick={() => onSelect(it.id)}
            >
              <span className="ml-glyph" style={{ background: it.color }} />
              <span className="ml-text">
                <span className="ml-name">{it.name}</span>
                <span className="ml-kind">{it.kind}</span>
              </span>
              <span className="ml-meta">
                <span className="ml-count">{it.count}</span>
                <span className={`ml-state${it.bad ? ' bad' : ''}`}>{it.state}</span>
              </span>
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

export function DetailHead({ glyph, color, title, chips = [], right }) {
  return (
    <div className="dh">
      <span className="dh-glyph" style={{ color }}>{glyph}</span>
      <h2>{title}</h2>
      {chips.filter(Boolean).map((c) => (
        <span key={c} className="mchip">{c}</span>
      ))}
      {right && <span className="dh-right">{right}</span>}
    </div>
  );
}

// one key → value line inside a detail card; clickable when it leads somewhere
export function KeyRow({
  l, owner, r, tone, mono, onClick, title,
}) {
  const cls = `krow tone-${tone || 'dim'}${onClick ? ' as-link' : ''}`;
  const body = (
    <>
      <span className={`k-l${mono ? ' mono' : ''}`}>{l}</span>
      {owner && <span className="k-owner">{owner}</span>}
      {r && <span className="k-r">{r}</span>}
    </>
  );
  if (!onClick) return <div className={cls}>{body}</div>;
  return (
    <button type="button" className={cls} onClick={onClick} title={title}>
      {body}
    </button>
  );
}

export function Note({ children }) {
  return <div className="dnote">{children}</div>;
}

// "open … page →" — the way out of every mini overview
export function OpenLink({ onClick, children }) {
  return (
    <button type="button" className="panel-openlink" onClick={onClick}>
      {children}
    </button>
  );
}

// modal shell for the mini overviews
export function MiniModal({ onClose, children, wide }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`mini-wrap${wide ? ' wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

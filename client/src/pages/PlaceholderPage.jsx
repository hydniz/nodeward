import React from 'react';

export default function PlaceholderPage({ title, sub }) {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          <div className="page-sub">coming soon</div>
        </div>
      </header>
      <div className="empty-state">
        <div className="empty-glyph">{'{ }'}</div>
        <div className="empty-title">nothing here yet</div>
        <div className="empty-sub">{sub}</div>
        <div className="empty-note">this view will be generated from live agent data</div>
      </div>
    </div>
  );
}

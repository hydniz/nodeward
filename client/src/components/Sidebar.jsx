import React from 'react';
import { NavLink } from 'react-router';
import { useApi } from '../api.js';
import { announceUnauthorized, logout } from '../auth.js';

const mainNav = [
  ['/', 'Overview'],
  ['/servers', 'Servers'],
  ['/networks', 'Networks'],
  ['/services', 'Services'],
  ['/domains', 'Domains'],
  ['/alerts', 'Alerts'],
];

const adminNav = [
  ['/settings', 'Settings'],
  ['/integrations', 'Integrations'],
  ['/agents', 'Agents'],
];

export default function Sidebar() {
  const { data: summary } = useApi('/api/summary');
  const { data: me } = useApi('/api/auth/me');
  const alerts = summary?.alerts?.length ?? 0;

  const signOut = async () => {
    await logout();
    // the session cookie is gone; the AuthGate takes it from here
    announceUnauthorized();
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">n</span>
        <span className="brand-name">nodeward</span>
        <span className="brand-ver">v0.1</span>
      </div>

      <nav className="nav">
        {mainNav.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className="nav-item">
            <span>{label}</span>
            {label === 'Alerts' && alerts > 0 && (
              <span className="nav-badge">{alerts}</span>
            )}
          </NavLink>
        ))}

        <div className="nav-section">admin</div>
        {adminNav.map(([to, label]) => (
          <NavLink key={to} to={to} className="nav-item">
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-user">
        <span className="avatar" />
        <span>admin</span>
        {me?.required && (
          <button type="button" className="signout" onClick={signOut}>
            sign out
          </button>
        )}
      </div>
    </aside>
  );
}

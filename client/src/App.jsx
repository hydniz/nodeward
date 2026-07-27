import React from 'react';
import { Routes, Route, Navigate } from 'react-router';
import Sidebar from './components/Sidebar.jsx';
import OverviewPage from './pages/OverviewPage.jsx';
import ServersPage from './pages/ServersPage.jsx';
import NetworksPage from './pages/NetworksPage.jsx';
import DomainsPage from './pages/DomainsPage.jsx';
import ServicesPage from './pages/ServicesPage.jsx';
import PlaceholderPage from './pages/PlaceholderPage.jsx';

const placeholders = [
  ['alerts', 'Alerts', 'active + resolved alerts from all agents'],
  ['settings', 'Settings', 'thresholds, polling, appearance'],
  ['integrations', 'Integrations', 'tailscale, cloudflare, hetzner, proxmox'],
  ['agents', 'Agents', 'nodeward agents installed on your hosts'],
];

export default function App() {
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/servers" element={<ServersPage />} />
          <Route path="/networks" element={<NetworksPage />} />
          <Route path="/domains" element={<DomainsPage />} />
          <Route path="/services" element={<ServicesPage />} />
          {placeholders.map(([slug, title, sub]) => (
            <Route
              key={slug}
              path={`/${slug}`}
              element={<PlaceholderPage title={title} sub={sub} />}
            />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

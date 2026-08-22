import React, { useState, useEffect, useCallback } from 'react';

const API_KEY = localStorage.getItem('openfb_api_key') || '';
const BASE_URL = '/api';

async function api(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, m, h] = await Promise.all([
        api('/session').catch(() => []),
        api('/metrics').catch(() => null),
        api('/health').catch(() => null),
      ]);
      setSessions(s);
      setMetrics(m);
      setHealth(h);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function createSession() {
    setError('');
    try {
      await api('/session', {
        method: 'POST',
        body: JSON.stringify({
          label: newLabel,
          email: newEmail || undefined,
          password: newPassword || undefined,
        }),
      });
      setShowCreate(false);
      setNewLabel('');
      setNewEmail('');
      setNewPassword('');
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function destroySession(id: string) {
    if (!confirm('Destroy this session?')) return;
    try {
      await api(`/session/${id}`, { method: 'DELETE' });
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  const stateBadge = (state: string) => {
    const cls = state === 'authenticated' ? 'success' :
                state === 'waiting_for_login' ? 'warning' :
                state === 'error' ? 'danger' : 'info';
    return <span className={`badge ${cls}`}>{state}</span>;
  };

  return (
    <div className="app">
      <div className="header">
        <h1>🔐 OpenFB</h1>
        <span className="badge info">Camoufox Engine</span>
        {health && (
          <span className={`badge ${health.status === 'ok' ? 'success' : 'warning'}`}>
            {health.status}
          </span>
        )}
        <button className="btn" onClick={refresh} disabled={loading}>
          {loading ? '⟳' : '↻'} Refresh
        </button>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--danger)' }}><p>⚠️ {error}</p></div>}

      {metrics && (
        <div className="stats">
          <div className="stat-card">
            <div className="stat-value">{metrics.sessions?.total ?? 0}</div>
            <div className="stat-label">Sessions</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{metrics.sessions?.authenticated ?? 0}</div>
            <div className="stat-label">Authenticated</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{Math.round(metrics.uptime ?? 0)}s</div>
            <div className="stat-label">Uptime</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{Math.round((metrics.memory?.heapUsed ?? 0) / 1024 / 1024)}MB</div>
            <div className="stat-label">Heap Used</div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <span className="card-title">Facebook Sessions</span>
          <button className="btn primary" onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? '✕ Cancel' : '+ New Session'}
          </button>
        </div>

        {showCreate && (
          <div style={{ marginBottom: '1rem' }}>
            <div className="mb-1">
              <input className="input" placeholder="Session label (e.g. 'Marketing Account')"
                value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            </div>
            <div className="mb-1">
              <input className="input" placeholder="Facebook email (optional)"
                value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            </div>
            <div className="mb-1">
              <input className="input" type="password" placeholder="Facebook password (optional)"
                value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <button className="btn primary" onClick={createSession}>Create Session</button>
          </div>
        )}

        {sessions.length === 0 ? (
          <p className="muted">No active sessions. Click "New Session" to launch a Camoufox browser.</p>
        ) : (
          sessions.map((s: any) => (
            <div key={s.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '0.75rem 0', borderBottom: '1px solid var(--border)',
            }}>
              <div>
                <strong>{s.label}</strong> {stateBadge(s.state)}
                <div className="mono muted mt-1" style={{ fontSize: '0.8rem' }}>
                  ID: {s.id.slice(0, 8)}... • WS: {s.wsEndpoint?.replace('ws://', '')}
                </div>
              </div>
              <div className="row">
                <a className="btn" href={`/api/session/${s.id}/screenshot`} target="_blank">📸 Screenshot</a>
                <button className="btn danger" onClick={() => destroySession(s.id)}>Destroy</button>
              </div>
            </div>
          ))
        )}
      </div>

      {health && (
        <div className="card">
          <span className="card-title">Engine Status</span>
          <div className="mt-1">
            <p><span className="muted">Engine:</span> {health.engine?.name}</p>
            <p><span className="muted">Healthy:</span> {health.engine?.healthy ? '✅' : '❌'}</p>
            <p className="muted mono" style={{ fontSize: '0.85rem' }}>{health.engine?.details}</p>
          </div>
        </div>
      )}

      <div className="muted" style={{ textAlign: 'center', marginTop: '2rem', fontSize: '0.85rem' }}>
        OpenFB v0.1.0 — Powered by Camoufox anti-detect browser • MIT License
      </div>
    </div>
  );
}

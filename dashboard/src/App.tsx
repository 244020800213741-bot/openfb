import React, { useState, useEffect, useCallback } from 'react';

const BASE_URL = '/api';

function getApiKey(): string {
  return localStorage.getItem('openfb_api_key') || '';
}

async function api(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKey(),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export default function App() {
  const [authed, setAuthed] = useState(() => !!getApiKey());
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [sessions, setSessions] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Shared login state
  const [loginStatus, setLoginStatus] = useState(null);
  const [loginBusy, setLoginBusy] = useState(false);

  // New session form state
  const [showCreate, setShowCreate] = useState(false);
  const [sessionType, setSessionType] = useState<'main' | 'marketplace'>('main');

  // Common fields
  const [label, setLabel] = useState('');

  // Marketplace monitor fields
  const [mqQuery, setMqQuery] = useState('');
  const [mqLocation, setMqLocation] = useState('');
  const [mqRadius, setMqRadius] = useState('');
  const [mqMinPrice, setMqMinPrice] = useState('');
  const [mqMaxPrice, setMqMaxPrice] = useState('');
  const [mqSortBy, setMqSortBy] = useState('relevance');
  const [mqCondition, setMqCondition] = useState([]);
  const [mqPostedAfter, setMqPostedAfter] = useState('');
  const [mqItemType, setMqItemType] = useState('all');
  const [mqInterval, setMqInterval] = useState('30');
  const [mqMaxResults, setMqMaxResults] = useState('10');
  const [mqEmailTo, setMqEmailTo] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, m, h, ls] = await Promise.all([
        api('/session').catch(() => []),
        api('/metrics').catch(() => null),
        api('/health').catch(() => null),
        api('/session/login-fb/status').catch(() => null),
      ]);
      setSessions(s);
      setMetrics(m);
      setHealth(h);
      setLoginStatus(ls);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh, authed]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    const key = apiKeyInput.trim();
    if (!key) {
      setLoginError('Please enter your API key');
      return;
    }
    fetch(`${BASE_URL}/health`, { headers: { 'x-api-key': key } })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        localStorage.setItem('openfb_api_key', key);
        setAuthed(true);
      })
      .catch(() => {
        setLoginError('Invalid API key. Check the API_KEY value in your .env file.');
      });
  }

  function handleLogout() {
    localStorage.removeItem('openfb_api_key');
    setAuthed(false);
    setApiKeyInput('');
    setSessions([]);
    setMetrics(null);
    setHealth(null);
    setLoginStatus(null);
  }

  async function openLoginFb() {
    setLoginBusy(true);
    setError('');
    try {
      await api('/session/login-fb/open', { method: 'POST' });
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoginBusy(false);
    }
  }

  async function closeLoginFb() {
    setLoginBusy(true);
    setError('');
    try {
      await api('/session/login-fb/close', { method: 'POST' });
      refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoginBusy(false);
    }
  }

  async function createSession() {
    setError('');
    try {
      const body: any = {
        label: label || (sessionType === 'main' ? 'Facebook Session' : 'Marketplace Monitor'),
        type: sessionType,
      };

      if (sessionType === 'marketplace') {
        if (!mqQuery) {
          setError('Search query is required for marketplace sessions');
          return;
        }
        body.monitor = {
          query: mqQuery,
          location: mqLocation || undefined,
          radiusKm: mqRadius ? Number(mqRadius) : undefined,
          minPrice: mqMinPrice ? Number(mqMinPrice) : undefined,
          maxPrice: mqMaxPrice ? Number(mqMaxPrice) : undefined,
          sortBy: mqSortBy,
          condition: mqCondition.length ? mqCondition : undefined,
          postedAfter: mqPostedAfter || undefined,
          itemType: mqItemType,
          intervalMinutes: Number(mqInterval) || 30,
          maxResults: Number(mqMaxResults) || 10,
          emailTo: mqEmailTo || undefined,
        };
      }

      await api('/session', { method: 'POST', body: JSON.stringify(body) });
      setShowCreate(false);
      resetForm();
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function resetForm() {
    setLabel('');
    setMqQuery('');
    setMqLocation('');
    setMqRadius('');
    setMqMinPrice('');
    setMqMaxPrice('');
    setMqSortBy('relevance');
    setMqCondition([]);
    setMqPostedAfter('');
    setMqItemType('all');
    setMqInterval('30');
    setMqMaxResults('10');
    setMqEmailTo('');
  }

  async function destroySession(id: string) {
    if (!confirm('Destroy this session?')) return;
    try {
      await api(`/session/${id}`, { method: 'DELETE' });
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  function toggleCondition(c: string) {
    setMqCondition((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  }

  const stateBadge = (state: string) => {
    const cls =
      state === 'authenticated' ? 'success' :
      state === 'waiting_for_login' ? 'warning' :
      state === 'error' ? 'danger' : 'info';
    return <span className={`badge ${cls}`}>{state}</span>;
  };

  const screenshotUrl = (id: string) =>
    `${BASE_URL}/session/${id}/screenshot?apiKey=${encodeURIComponent(getApiKey())}`;

  // ─── Login screen ───
  if (!authed) {
    return (
      <div className="app">
        <div className="header">
          <h1>OpenFB</h1>
          <span className="badge info">Camoufox Engine</span>
        </div>
        <div className="card" style={{ maxWidth: '420px', margin: '2rem auto' }}>
          <h2>Login</h2>
          <p className="muted" style={{ fontSize: '0.9rem' }}>
            Enter your API key. This is the value of <code>API_KEY</code> in your <code>.env</code> file.
          </p>
          <form onSubmit={handleLogin}>
            <div className="mb-1">
              <input
                className="input"
                type="password"
                placeholder="API Key"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                autoFocus
              />
            </div>
            {loginError && (
              <p style={{ color: 'var(--danger)', fontSize: '0.9rem' }}> {loginError}</p>
            )}
            <button className="btn primary" type="submit">Login</button>
          </form>
        </div>
      </div>
    );
  }

  // ─── Main dashboard ───
  return (
    <div className="app">
      <div className="header">
        <h1>OpenFB</h1>
        <span className="badge info">Camoufox Engine</span>
        {health && (
          <span className={`badge ${health.status === 'ok' ? 'success' : 'warning'}`}>
            {health.status}
          </span>
        )}
        <button className="btn" onClick={refresh} disabled={loading}>
          {loading ? '...' : 'Refresh'}
        </button>
        <button className="btn" onClick={handleLogout}>Logout</button>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <p> {error}</p>
        </div>
      )}

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
            <div className="stat-value">
              {Math.round((metrics.memory?.heapUsed ?? 0) / 1024 / 1024)}MB
            </div>
            <div className="stat-label">Heap Used</div>
          </div>
        </div>
      )}

      {/* ─── Shared Facebook Login ─── */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Facebook Login (Shared)</span>
          {loginStatus?.hasSharedLogin ? (
            <span className="badge success">Saved</span>
          ) : (
            <span className="badge warning">Not logged in</span>
          )}
        </div>
        <div className="mt-1" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <p className="muted" style={{ margin: 0, flex: 1, minWidth: '200px', fontSize: '0.9rem' }}>
            Log in to Facebook once. The login is saved and shared with all new sessions automatically.
          </p>
          <button
            className="btn primary"
            onClick={openLoginFb}
            disabled={loginBusy || loginStatus?.windowOpen}
          >
            {loginStatus?.windowOpen ? 'Window Open...' : 'Login FB'}
          </button>
          {loginStatus?.windowOpen && (
            <button className="btn" onClick={closeLoginFb} disabled={loginBusy}>
              Close Window
            </button>
          )}
        </div>
        {loginStatus?.hasSharedLogin && (
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
            Login saved. New sessions will inherit this login automatically.
          </p>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Sessions</span>
          <button className="btn primary" onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? 'Cancel' : '+ New Session'}
          </button>
        </div>

        {showCreate && (
          <div style={{ marginBottom: '1rem' }}>
            {/* ─── Session type selector ─── */}
            <div className="mb-1">
              <label className="muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.5rem' }}>
                Session Type
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className={`btn ${sessionType === 'main' ? 'primary' : ''}`}
                  onClick={() => setSessionType('main')}
                  style={{ flex: 1 }}
                >
                  Facebook Main
                </button>
                <button
                  className={`btn ${sessionType === 'marketplace' ? 'primary' : ''}`}
                  onClick={() => setSessionType('marketplace')}
                  style={{ flex: 1 }}
                >
                  Facebook Marketplace
                </button>
              </div>
            </div>

            {/* ─── Common fields ─── */}
            <div className="mb-1">
              <input
                className="input"
                placeholder="Session label (optional)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="mb-1">
              <input
                className="input"
                placeholder="Facebook email (optional)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="mb-1">
              <input
                className="input"
                type="password"
                placeholder="Facebook password (optional)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {/* ─── Marketplace fields ─── */}
            {sessionType === 'marketplace' && (
              <div style={{
                marginTop: '1rem',
                padding: '1rem',
                background: 'var(--bg-alt, #f5f5f5)',
                borderRadius: '8px',
              }}>
                <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>
                  Marketplace Search Filters
                </h3>

                <div className="mb-1">
                  <label className="muted" style={{ fontSize: '0.8rem' }}>Search query *</label>
                  <input
                    className="input"
                    placeholder="e.g. iPhone 13"
                    value={mqQuery}
                    onChange={(e) => setMqQuery(e.target.value)}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div className="mb-1">
                    <label className="muted" style={{ fontSize: '0.8rem' }}>Location</label>
                    <input
                      className="input"
                      placeholder="e.g. Madrid"
                      value={mqLocation}
                      onChange={(e) => setMqLocation(e.target.value)}
                    />
                  </div>
                  <div className="mb-1">
                    <label className="muted" style={{ fontSize: '0.8rem' }}>Radius (km)</label>
                    <input
                      className="input"
                      type="number"
                      placeholder="e.g. 10"
                      value={mqRadius}
                      onChange={(e) => setMqRadius(e.target.value)}
                    />
                  </div>
                  <div className="mb-1">
                    <label className="muted" style={{ fontSize: '0.8rem' }}>Min price</label>
                    <input
                      className="input"
                      type="number"
                      placeholder="0"
                      value={mqMinPrice}
                      onChange={(e) => setMqMinPrice(e.target.value)}
                    />
                  </div>
                  <div className="mb-1">
                    <label className="muted" style={{ fontSize: '0.8rem' }}>Max price</label>
                    <input
                      className="input"
                      type="number"
                      placeholder="9999"
                      value={mqMaxPrice}
                      onChange={(e) => setMqMaxPrice(e.target.value)}
                    />
                  </div>
                </div>

                <div className="mb-1">
                  <label className="muted" style={{ fontSize: '0.8rem' }}>Sort by</label>
                  <select
                    className="input"
                    value={mqSortBy}
                    onChange={(e) => setMqSortBy(e.target.value)}
                  >
                    <option value="relevance">Relevance</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                    <option value="newest">Newest first</option>
                    <option value="nearest">Nearest first</option>
                  </select>
                </div>

                <div className="mb-1">
                  <label className="muted" style={{ fontSize: '0.8rem' }}>Condition</label>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {[
                      { v: 'new', label: 'New' },
                      { v: 'used_like_new', label: 'Like New' },
                      { v: 'used_good', label: 'Good' },
                      { v: 'used_fair', label: 'Fair' },
                    ].map((c) => (
                      <button
                        key={c.v}
                        className={`btn ${mqCondition.includes(c.v) ? 'primary' : ''}`}
                        onClick={() => toggleCondition(c.v)}
                        style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mb-1">
                  <label className="muted" style={{ fontSize: '0.8rem' }}>Posted after</label>
                  <input
                    className="input"
                    type="date"
                    value={mqPostedAfter}
                    onChange={(e) => setMqPostedAfter(e.target.value)}
                  />
                </div>

                <div className="mb-1">
                  <label className="muted" style={{ fontSize: '0.8rem' }}>Item type</label>
                  <select
                    className="input"
                    value={mqItemType}
                    onChange={(e) => setMqItemType(e.target.value)}
                  >
                    <option value="all">All</option>
                    <option value="item">Items</option>
                    <option value="vehicle">Vehicles</option>
                    <option value="housing">Housing</option>
                  </select>
                </div>

                <div style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  background: 'var(--bg, #fff)',
                  borderRadius: '8px',
                  border: '1px solid var(--border, #ddd)',
                }}>
                  <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.95rem' }}>
                    Monitoring & Email
                  </h3>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <div className="mb-1">
                      <label className="muted" style={{ fontSize: '0.8rem' }}>
                        Search interval (minutes) *
                      </label>
                      <input
                        className="input"
                        type="number"
                        placeholder="30"
                        value={mqInterval}
                        onChange={(e) => setMqInterval(e.target.value)}
                      />
                    </div>
                    <div className="mb-1">
                      <label className="muted" style={{ fontSize: '0.8rem' }}>
                        Max results per email *
                      </label>
                      <input
                        className="input"
                        type="number"
                        placeholder="10"
                        value={mqMaxResults}
                        onChange={(e) => setMqMaxResults(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="mb-1">
                    <label className="muted" style={{ fontSize: '0.8rem' }}>
                      Email to (leave empty = use GMAIL_TO from .env)
                    </label>
                    <input
                      className="input"
                      type="email"
                      placeholder="myalerts@gmail.com"
                      value={mqEmailTo}
                      onChange={(e) => setMqEmailTo(e.target.value)}
                    />
                  </div>
                  <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
                    Results are sent to this Gmail. Configure GMAIL_USER and GMAIL_APP_PASSWORD in .env.
                  </p>
                </div>
              </div>
            )}

            <button className="btn primary" onClick={createSession} style={{ marginTop: '0.5rem' }}>
              Create {sessionType === 'main' ? 'Facebook Session' : 'Marketplace Monitor'}
            </button>
          </div>
        )}

        {sessions.length === 0 ? (
          <p className="muted">
            No active sessions. Click "New Session" to launch a Camoufox browser.
          </p>
        ) : (
          sessions.map((s: any) => (
            <div
              key={s.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                padding: '0.75rem 0',
                borderBottom: '1px solid var(--border, #ddd)',
              }}
            >
              <div style={{ flex: 1 }}>
                <div>
                  <strong>{s.label}</strong>{' '}
                  {stateBadge(s.state)}{' '}
                  {s.type && (
                    <span className={`badge ${s.type === 'marketplace' ? 'warning' : 'info'}`} style={{ fontSize: '0.75rem' }}>
                      {s.type}
                    </span>
                  )}
                </div>
                <div className="mono muted mt-1" style={{ fontSize: '0.8rem' }}>
                  ID: {s.id.slice(0, 8)}...
                </div>
                {s.monitor && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                    <div>
                      <span className="muted">Query:</span> "{s.monitor.config.query}"
                      {' '}
                      <span className="muted">Every:</span> {s.monitor.config.intervalMinutes}min
                      {' '}
                      <span className="muted">Max/email:</span> {s.monitor.config.maxResults}
                    </div>
                    {s.monitor.lastRunAt && (
                      <div className="muted">
                        Last run: {new Date(s.monitor.lastRunAt).toLocaleTimeString()}
                        {' — '}{s.monitor.lastResultCount} new results
                      </div>
                    )}
                    {s.monitor.nextRunAt && (
                      <div className="muted">
                        Next run: {new Date(s.monitor.nextRunAt).toLocaleTimeString()}
                      </div>
                    )}
                    {s.monitor.totalEmailsSent !== undefined && s.monitor.totalEmailsSent > 0 && (
                      <div className="muted">
                        Emails sent: {s.monitor.totalEmailsSent}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="row" style={{ flexShrink: 0 }}>
                <a className="btn" href={screenshotUrl(s.id)} target="_blank" rel="noopener noreferrer">
                  Screenshot
                </a>
                <button className="btn danger" onClick={() => destroySession(s.id)}>
                  Destroy
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {health && (
        <div className="card">
          <span className="card-title">Engine Status</span>
          <div className="mt-1">
            <p>
              <span className="muted">Engine:</span> {health.engine?.name}
            </p>
            <p>
              <span className="muted">Healthy:</span> {health.engine?.healthy ? 'YES' : 'NO'}
            </p>
            <p className="muted mono" style={{ fontSize: '0.85rem' }}>
              {health.engine?.details}
            </p>
          </div>
        </div>
      )}

      <div className="muted" style={{ textAlign: 'center', marginTop: '2rem', fontSize: '0.85rem' }}>
        OpenFB v0.1.0 — Powered by Camoufox anti-detect browser
      </div>
    </div>
  );
}

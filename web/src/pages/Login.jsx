import { useState } from 'react';
import { api, setToken } from '../lib/api.js';

export default function Login({ onIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const d = await api('/auth/login', { method: 'POST', body: { email, password } });
      setToken(d.token);
      onIn(d.user);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div className="login">
      <div className="wrap">
        <div className="brand" style={{ justifyContent: 'center', paddingBottom: 24 }}>
          <div className="brand-mark">HM</div>
          <div>
            <div className="brand-name">HouseMaster</div>
            <div className="brand-sub">Richmond</div>
          </div>
        </div>
        <div className="card">
          <div className="card-body" style={{ padding: 28 }}>
            <h2 style={{ fontSize: 20, marginBottom: 4 }}>Sign in</h2>
            <div style={{ color: 'var(--text-2)', marginBottom: 20 }}>Use the email your office set up for you.</div>
            {err && <div className="banner" style={{ marginBottom: 16 }}>{err}</div>}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="username"
                     value={email} onChange={(e) => setEmail(e.target.value)}
                     onKeyDown={(e) => e.key === 'Enter' && submit()} />
            </div>
            <div className="field">
              <label htmlFor="pw">Password</label>
              <input id="pw" className="input" type="password" autoComplete="current-password"
                     value={password} onChange={(e) => setPassword(e.target.value)}
                     onKeyDown={(e) => e.key === 'Enter' && submit()} />
            </div>
            <button className="btn primary" style={{ width: '100%', marginTop: 6 }}
                    onClick={submit} disabled={busy}>
              {busy ? <span className="spinner" /> : null} Sign in
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

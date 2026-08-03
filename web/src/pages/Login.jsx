import { useEffect, useState } from 'react';
import { api, setToken } from '../lib/api.js';

export default function Login({ onIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [first, setFirst] = useState(null); // null until we know which screen this is
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/auth/setup')
      .then((d) => setFirst(Boolean(d.needs_first_owner)))
      .catch(() => setFirst(false));
  }, []);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const d = first
        ? await api('/auth/setup', { method: 'POST', body: { full_name: fullName, email, password } })
        : await api('/auth/login', { method: 'POST', body: { email, password } });
      setToken(d.token);
      onIn(d.user);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const go = (e) => e.key === 'Enter' && submit();

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
            <h2 style={{ fontSize: 20, marginBottom: 4 }}>
              {first ? 'Set up the first login' : 'Sign in'}
            </h2>
            <div style={{ color: 'var(--text-2)', marginBottom: 20 }}>
              {first
                ? 'Nobody can sign in yet. This creates the owner account, and then this screen goes back to asking for a password.'
                : 'Use the email your office set up for you.'}
            </div>

            {err && <div className="banner" style={{ marginBottom: 16 }}>{err}</div>}

            {first && (
              <div className="field">
                <label htmlFor="name">Your name</label>
                <input id="name" className="input" autoComplete="name"
                       value={fullName} onChange={(e) => setFullName(e.target.value)} onKeyDown={go} />
              </div>
            )}

            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="username"
                     value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={go} />
            </div>

            <div className="field">
              <label htmlFor="pw">Password</label>
              <input id="pw" className="input" type="password"
                     autoComplete={first ? 'new-password' : 'current-password'}
                     value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={go} />
              {first && <div className="help">Twelve characters or more.</div>}
            </div>

            <button className="btn primary" style={{ width: '100%', marginTop: 6 }}
                    onClick={submit} disabled={busy || first === null}>
              {busy ? <span className="spinner" /> : null}
              {first ? ' Create the owner account' : ' Sign in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from '../components/Icons.jsx';

const ago = (iso) => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  if (mins < 1440) { const h = Math.round(mins / 60); return `${h} ${h === 1 ? 'hour' : 'hours'} ago`; }
  const d = Math.round(mins / 1440);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
};

export default function Isn() {
  const [status, setStatus] = useState(null);
  const [roster, setRoster] = useState(null);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(null);
  const [key, setKey] = useState('');

  const load = () =>
    Promise.all([api('/isn/status'), api('/isn/inspectors').catch(() => null)])
      .then(([s, i]) => {
        setStatus(s);
        setKey(s.connection?.company_key || '');
        if (i) setRoster(i);
      })
      .catch((e) => setErr(e.message));

  useEffect(() => { load(); }, []);

  const run = async (id, fn, msg) => {
    setBusy(id); setErr(null); setNote(null);
    try { await fn(); if (msg) setNote(msg); } catch (e) { setErr(e.message); }
    setBusy(null);
  };

  const patch = (body, msg) =>
    run('conn', async () => {
      await api('/isn/connection', { method: 'PATCH', body });
      await load();
    }, msg);

  const sync = () =>
    run('sync', async () => {
      const out = await api('/isn/sync', { method: 'POST', body: {} });
      await load();
      setNote(`Pulled ${out.pulled ?? 0} order${out.pulled === 1 ? '' : 's'}.`);
    });

  const link = (isnId, employeeId) =>
    run(isnId, async () => {
      const out = await api('/isn/inspectors/link', {
        method: 'POST', body: { isn_user_id: isnId, employee_id: employeeId || null },
      });
      await load();
      setNote(employeeId
        ? `Linked. ${out.ordersReassigned} order${out.ordersReassigned === 1 ? '' : 's'} now belong to them.`
        : 'Unlinked.');
    });

  if (!status) return <div className="empty"><div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…</div>;

  const c = status.connection;
  const on = !!c?.enabled;
  const last = status.runs?.[0];

  return (
    <div className="stack">
      {err && <div className="banner">{err}</div>}
      {note && <div className="note">{note}</div>}

      {/* --------------------------------------------------------- the link */}
      <div className="card">
        <div className="card-head">
          <div>
            <h2>{on ? 'Reading orders from ISN' : 'The ISN link is off'}</h2>
            <div className="sub">
              {on
                ? `Last pull ${ago(c.last_sync_at)}${last?.status ? ` — ${last.status}` : ''}.`
                : 'Nothing is being pulled. Orders, client details and radon jobs all come from here.'}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            {on && (
              <button className="btn" disabled={busy === 'sync'} onClick={sync}>
                {busy === 'sync' ? <span className="spinner" /> : null} Pull now
              </button>
            )}
            <button
              className={`btn ${on ? '' : 'primary'}`}
              disabled={busy === 'conn' || (!on && !status.credentialsPresent)}
              onClick={() => patch({ enabled: !on }, on ? 'ISN link switched off.' : 'ISN link switched on.')}
            >
              {on ? 'Switch off' : 'Switch it on'}
            </button>
          </div>
        </div>

        <div className="card-body">
          <div className="setting">
            <div style={{ minWidth: 0 }}>
              <b>Keys</b>
              <span>
                Held in the server's environment as {c?.credential_env_var} and
                ISN_SECRET_ACCESS_KEY. They are never stored in the database and never shown here.
              </span>
            </div>
            <span style={{ marginLeft: 'auto' }}>
              <span className={`pill ${status.credentialsPresent ? 'green' : 'red'}`}>
                {status.credentialsPresent ? 'In place' : 'Missing'}
              </span>
            </span>
          </div>

          <div className="field" style={{ marginTop: 16, maxWidth: 420 }}>
            <label htmlFor="ck">Company key</label>
            <input id="ck" className="input mono" value={key} onChange={(e) => setKey(e.target.value)} />
            <div className="help">
              The company's own piece of its ISN address. Changing it makes the next pull
              rediscover where the ISN lives.
            </div>
          </div>
          <button
            className="btn"
            disabled={busy === 'conn' || !key.trim() || key === c?.company_key}
            onClick={() => patch({ company_key: key.trim() }, 'Company key saved.')}
          >
            Save the key
          </button>

          {!status.credentialsPresent && (
            <div className="banner" style={{ marginTop: 16 }}>
              ISN_ACCESS_KEY and ISN_SECRET_ACCESS_KEY are not set on the server, so the
              link cannot be switched on. Ask ISN for a key pair on a dedicated integration
              user — not a person's login, because the change feed is consumed per user and
              a shared login eats notifications other tools still need.
            </div>
          )}

          {last?.error && (
            <div className="banner" style={{ marginTop: 16 }}>Last pull failed: {last.error}</div>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------- who is who */}
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Which inspector is which</h2>
            <div className="sub">
              The keys are the company's, so every order comes down together. This is what
              splits them up: an inspector's phone shows their jobs, their counts and their
              deadlines, and nobody else's.
            </div>
          </div>
          {roster?.unmapped > 0 && (
            <span className="pill amber" style={{ marginLeft: 'auto' }}>
              {roster.unmapped} not matched
            </span>
          )}
        </div>

        {!roster?.inspectors?.length ? (
          <div className="empty">
            <div className="ico"><Icon name="users" size={24} /></div>
            <h3>No inspectors seen yet</h3>
            <p>
              This list builds itself from orders. Pull once with the link on, and everyone
              ISN has scheduled work for shows up here to be matched.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>In ISN</th>
                  <th style={{ width: 110 }}>Orders</th>
                  <th style={{ width: 260 }}>Is this person</th>
                </tr>
              </thead>
              <tbody>
                {roster.inspectors.map((i) => (
                  <tr key={i.inspector_isn_id} style={{ cursor: 'default' }}>
                    <td>
                      <div style={{ color: 'var(--text)', fontWeight: 550 }}>
                        {i.inspector_name || 'Unnamed'}
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                        {i.inspector_isn_id}
                      </div>
                    </td>
                    <td>{i.orders}</td>
                    <td>
                      <select
                        className="input"
                        value={i.employee_id || ''}
                        disabled={busy === i.inspector_isn_id}
                        onChange={(e) => link(i.inspector_isn_id, e.target.value)}
                      >
                        <option value="">Not matched — their work counts for nobody</option>
                        {roster.employees.map((e) => (
                          <option key={e.id} value={e.id}>{e.full_name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="card-foot" style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
          Matching someone repoints the orders already pulled, not just the next lot — so
          last week's work shows up straight away. Each of them still needs a login of their
          own under <b>Logins</b>, with the same person selected there.
        </div>
      </div>
    </div>
  );
}

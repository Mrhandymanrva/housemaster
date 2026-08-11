import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from '../components/Icons.jsx';
import { ROLES, atLeast } from '../lib/roles.js';

/* What each role can actually do, in the words someone would use out loud. */
const ROLE_MEANS = {
  field: 'Fills out forms on the phone. Can look things up, cannot change them.',
  office: 'Everything above, plus adding and editing records and clearing what is due.',
  admin: 'Everything above, plus deleting records, setting up the phone app, and managing these logins.',
  owner: 'Everything. Only an owner can make another owner.',
};



const lastSeen = (iso) => {
  if (!iso) return 'Has not signed in yet';
  const days = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (days === 0) return 'Signed in today';
  if (days === 1) return 'Signed in yesterday';
  if (days < 30) return `Signed in ${days} days ago`;
  return `Last signed in ${new Date(iso).toLocaleDateString()}`;
};

export default function Team({ me }) {
  const [users, setUsers] = useState(null);
  const [staff, setStaff] = useState([]);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ email: '', password: '', app_role: 'field', employee_id: '' });
  const [resetting, setResetting] = useState(null);
  const [resetPw, setResetPw] = useState('');
  const [pw, setPw] = useState({ current_password: '', new_password: '' });

  const load = () =>
    api('/users')
      .then((d) => setUsers(d.users || []))
      .catch((e) => { setErr(e.message); setUsers([]); });

  useEffect(() => {
    load();
    api('/records/employees/_options/list')
      .then((d) => setStaff(d.options || []))
      .catch(() => {});
  }, []);

  const say = (m) => { setNote(m); setErr(null); setTimeout(() => setNote(null), 4000); };

  const run = async (id, fn) => {
    setBusy(id); setErr(null);
    try { await fn(); } catch (e) { setErr(e.message); }
    setBusy(null);
  };

  const add = () =>
    run('new', async () => {
      const d = await api('/users', { method: 'POST', body: { ...draft, employee_id: draft.employee_id || null } });
      setUsers((u) => [d.user, ...u]);
      setAdding(false);
      setDraft({ email: '', password: '', app_role: 'field', employee_id: '' });
      say(`${d.user.full_name || d.user.email} can sign in now. Give them the password in person.`);
    });

  const patch = (u, body, msg) =>
    run(u.id, async () => {
      const d = await api(`/users/${u.id}`, { method: 'PATCH', body });
      setUsers((list) => list.map((x) => (x.id === u.id ? d.user : x)));
      say(msg);
    });

  const resetPassword = (u) =>
    run(u.id, async () => {
      await api(`/users/${u.id}/password`, { method: 'POST', body: { new_password: resetPw } });
      setResetting(null); setResetPw('');
      say(`New password set for ${u.full_name || u.email}. Hand it over directly — it is not emailed.`);
    });

  const changeOwn = () =>
    run('me', async () => {
      await api('/users/me/password', { method: 'POST', body: pw });
      setPw({ current_password: '', new_password: '' });
      say('Your password is changed.');
    });

  const canEdit = (u) => atLeast(me.role, u.app_role);

  return (
    <div className="stack">
      {err && <div className="banner">{err}</div>}
      {note && <div className="note">{note}</div>}

      {/* ------------------------------------------------ my own password */}
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Your password</h2>
            <div className="sub">Signed in as {me.email} — {me.role}.</div>
          </div>
        </div>
        <div className="card-body" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0, minWidth: 220 }}>
            <label htmlFor="cur">Current password</label>
            <input id="cur" className="input" type="password" autoComplete="current-password"
                   value={pw.current_password}
                   onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0, minWidth: 220 }}>
            <label htmlFor="new">New password</label>
            <input id="new" className="input" type="password" autoComplete="new-password"
                   value={pw.new_password}
                   onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
          </div>
          <button className="btn primary" disabled={busy === 'me'} onClick={changeOwn}>Change it</button>
          <div style={{ color: 'var(--text-3)', fontSize: 13, flexBasis: '100%' }}>
            Twelve characters or more. A phrase you will remember beats a short scramble.
          </div>
        </div>
      </div>

      {/* --------------------------------------------------- who can sign in */}
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Who can sign in</h2>
            <div className="sub">
              Switching someone off takes hold on their very next tap, not whenever their session runs out.
            </div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <button className="btn primary" onClick={() => setAdding((a) => !a)}>
              <Icon name="check" size={17} /> {adding ? 'Never mind' : 'Add someone'}
            </button>
          </div>
        </div>

        {adding && (
          <div className="card-body" style={{ borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field" style={{ margin: 0, minWidth: 220 }}>
                <label htmlFor="ne">Email</label>
                <input id="ne" className="input" type="email" value={draft.email}
                       onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
              </div>
              <div className="field" style={{ margin: 0, minWidth: 200 }}>
                <label htmlFor="np">First password</label>
                <input id="np" className="input" type="text" autoComplete="off" value={draft.password}
                       onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
              </div>
              <div className="field" style={{ margin: 0, minWidth: 170 }}>
                <label htmlFor="nr">Can do</label>
                <select id="nr" className="input" value={draft.app_role}
                        onChange={(e) => setDraft({ ...draft, app_role: e.target.value })}>
                  {ROLES.filter((r) => atLeast(me.role, r)).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ margin: 0, minWidth: 200 }}>
                <label htmlFor="nem">Which person</label>
                <select id="nem" className="input" value={draft.employee_id}
                        onChange={(e) => setDraft({ ...draft, employee_id: e.target.value })}>
                  <option value="">Not on the staff list</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <button className="btn primary" disabled={busy === 'new'} onClick={add}>Create the login</button>
            </div>
            <div style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 10 }}>
              {ROLE_MEANS[draft.app_role]}
            </div>
          </div>
        )}

        {!users && <div className="empty"><div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…</div>}

        {users && !users.length && (
          <div className="empty">
            <h3>No logins yet</h3>
            <p>Add one above, or run the seed script to create the first owner.</p>
          </div>
        )}

        {users && users.length > 0 && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Person</th>
                  <th style={{ width: 170 }}>Can do</th>
                  <th style={{ width: 210 }}>Last seen</th>
                  <th style={{ width: 230 }}></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} style={{ cursor: 'default', opacity: u.active ? 1 : 0.55 }}>
                    <td>
                      <div style={{ color: 'var(--text)', fontWeight: 550 }}>
                        {u.full_name || u.email}
                        {u.id === me.id && (
                          <span style={{
                            marginLeft: 8, fontSize: 12, fontWeight: 600, padding: '1px 7px',
                            borderRadius: 10, background: 'var(--surface-3)', color: 'var(--text-2)',
                          }}>you</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                        {u.email}{u.job_title ? ` · ${u.job_title}` : ''}{u.active ? '' : ' · switched off'}
                      </div>
                    </td>
                    <td>
                      <select
                        className="input"
                        value={u.app_role}
                        disabled={!canEdit(u) || busy === u.id}
                        title={ROLE_MEANS[u.app_role]}
                        onChange={(e) => patch(u, { app_role: e.target.value },
                          `${u.full_name || u.email} is now ${e.target.value}.`)}
                      >
                        {ROLES.filter((rl) => atLeast(me.role, rl) || rl === u.app_role).map((rl) => (
                          <option key={rl} value={rl}>{rl}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ fontSize: 13 }}>{lastSeen(u.last_login_at)}</td>
                    <td>
                      {canEdit(u) && u.id !== me.id && (
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button className="btn" disabled={busy === u.id}
                                  onClick={() => { setResetting(resetting === u.id ? null : u.id); setResetPw(''); }}>
                            Reset password
                          </button>
                          <button className="btn" disabled={busy === u.id}
                                  onClick={() => patch(u, { active: !u.active },
                                    u.active ? `${u.full_name || u.email} can no longer sign in.`
                                             : `${u.full_name || u.email} can sign in again.`)}>
                            {u.active ? 'Switch off' : 'Switch on'}
                          </button>
                        </div>
                      )}
                      {resetting === u.id && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                          <input className="input" type="text" autoComplete="off" placeholder="New password"
                                 style={{ maxWidth: 190 }}
                                 value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
                          <button className="btn primary" disabled={busy === u.id}
                                  onClick={() => resetPassword(u)}>Set</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-body">
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>What the four levels mean</h2>
          {ROLES.map((rl) => (
            <div key={rl} style={{ display: 'flex', gap: 12, padding: '7px 0' }}>
              <div style={{ width: 70, color: 'var(--text)', fontWeight: 550, textTransform: 'capitalize' }}>{rl}</div>
              <div style={{ color: 'var(--text-2)', fontSize: 13.5 }}>{ROLE_MEANS[rl]}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

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
  const [probe, setProbe] = useState(null);
  const [people, setPeople] = useState(null);
  const [onlyInspectors, setOnlyInspectors] = useState(true);
  const [whose, setWhose] = useState(null);

  useEffect(() => { if (people) load(); }, [onlyInspectors]);

  const refreshRoster = () =>
    run('roster', async () => {
      const out = await api('/isn/roster/refresh', { method: 'POST', body: {} });
      setWhose(out.keysBelongTo);
      await load();
      setNote([
        `Read ${out.detailed} ${out.detailed === 1 ? 'person' : 'people'}.`,
        out.deleted ? `${out.deleted} deleted in ISN, skipped.` : '',
        out.unchanged ? `${out.unchanged} unchanged since last time.` : '',
        out.remaining ? `${out.remaining} left — press it again.` : '',
        out.failures?.length ? `${out.failures.length} could not be read.` : '',
      ].filter(Boolean).join(' '));
    });

  const adopt = (u, employeeId) =>
    run(u.isn_user_id, async () => {
      const out = await api('/isn/roster/adopt', {
        method: 'POST',
        body: {
          isn_user_id: u.isn_user_id,
          employee_id: employeeId || null,
          full_name: u.name,
          email: u.email,
          role: u.isInspector ? 'Inspector' : 'CSR',
        },
      });
      await load();
      setNote(employeeId
        ? `Linked. ${out.ordersReassigned} order${out.ordersReassigned === 1 ? '' : 's'} now theirs.`
        : `${u.name} added to your staff and linked.`);
    });

  const load = () =>
    Promise.all([
      api('/isn/status'),
      api('/isn/inspectors').catch(() => null),
      api(`/isn/roster${onlyInspectors ? '?inspectors=true' : ''}`).catch((e) => ({ error: e.message })),
    ])
      .then(([s, i, r]) => {
        setStatus(s);
        setKey(s.connection?.company_key || '');
        if (i) setRoster(i);
        setPeople(r);
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

          <div className="setting" style={{ marginTop: 16 }}>
            <div style={{ minWidth: 0 }}>
              <b>Pull on its own</b>
              <span>
                {on && c?.sync_every_minutes > 0
                  ? <>Every {c.sync_every_minutes} minutes, whether anyone is looking or not.
                      {status.schedule?.nextAt && <> Next around {new Date(status.schedule.nextAt)
                        .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</>}</>
                  : 'Nobody has to remember to press the button. The phone counts are only as true as the last pull.'}
              </span>
            </div>
            <span style={{ marginLeft: 'auto' }}>
              <select className="input" style={{ width: 'auto' }}
                      value={c?.sync_every_minutes ?? 60}
                      disabled={busy === 'conn'}
                      onChange={(e) => patch({ sync_every_minutes: Number(e.target.value) },
                        Number(e.target.value)
                          ? `Pulling every ${e.target.value} minutes.`
                          : 'Automatic pulls switched off.')}>
                <option value="0">Only when I press the button</option>
                <option value="15">Every 15 minutes</option>
                <option value="30">Every 30 minutes</option>
                <option value="60">Every hour</option>
                <option value="240">Every 4 hours</option>
                <option value="1440">Once a day</option>
              </select>
            </span>
          </div>

          <div className="setting">
            <div style={{ minWidth: 0 }}>
              <b>Check what ISN sends</b>
              <span>
                Asks for footprints and reports the field names and shape of the answer —
                never the contents, because an order carries a client's name and address.
                Useful when a pull fails and the reason is the shape of the reply.
              </span>
            </div>
            <button className="btn" style={{ marginLeft: 'auto' }} disabled={busy === 'probe'}
                    onClick={() => run('probe', async () => {
                      const out = await api('/isn/probe');
                      setProbe(out.probes);
                    })}>
              {busy === 'probe' ? <span className="spinner" /> : null} Check
            </button>
          </div>

          {probe && (
            <pre style={{
              marginTop: 12, padding: 14, background: 'var(--surface-2)',
              border: '1px solid var(--line)', borderRadius: 'var(--r-sm)',
              fontSize: 12.5, fontFamily: 'var(--mono)', overflowX: 'auto', whiteSpace: 'pre-wrap',
            }}>{JSON.stringify(probe, null, 2)}</pre>
          )}
        </div>
      </div>

      {/* --------------------------------------------------- what came in */}
      {status.cached?.orders > 0 && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>What has come in</h2>
              <div className="sub">
                {status.cached.orders} orders cached
                {status.cached.offices > 1 && <> across {status.cached.offices} offices</>}
                {' · '}<b>{status.cached.counted} count as work</b>
                {' · '}{status.cached.with_radon} flagged as radon
                {status.cached.unassigned > 0 &&
                  <> · {status.cached.unassigned} belong to nobody here yet</>}
              </div>
              <div className="sub" style={{ marginTop: 2 }}>
                Left out of every count:{' '}
                {status.cached.unscheduled} not yet scheduled ·{' '}
                {status.cached.canceled} cancelled ·{' '}
                {status.cached.deleted} deleted in ISN
              </div>
            </div>
          </div>

          {status.cached.with_radon === status.cached.orders && (
            <div className="card-body" style={{ paddingBottom: 0 }}>
              <div className="banner">
                Every order is being flagged as radon, which is almost certainly wrong — it
                drafts a radon set against each one. Check the service names below against
                what counts as radon.
              </div>
            </div>
          )}

          <div className="card-body">
            <div style={{ fontSize: 13.5, color: 'var(--text-2)', marginBottom: 10 }}>
              What your office calls things. A job counts as radon when a <b>booked service</b>{' '}
              is named one of {(c?.radon_service_match || []).join(', ') || 'nothing set'} — or a{' '}
              <b>fee by that name was actually charged</b>. A line at zero is a price list entry,
              not a sale.
            </div>

            {status.radonReasons?.length > 0 && (
              <div style={{ fontSize: 13.5, color: 'var(--text-2)', marginBottom: 12 }}>
                Why the radon ones matched:{' '}
                {status.radonReasons.map((rr, i) => (
                  <span key={i}>{i ? ' · ' : ''}{rr.radon_reason} <b>({rr.orders})</b></span>
                ))}
              </div>
            )}
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Service or fee on the order</th><th style={{ width: 100 }}>Orders</th>
                  <th style={{ width: 110 }}>Charged</th>
                  <th style={{ width: 120 }}>Counts as radon</th></tr></thead>
                <tbody>
                  {status.services.map((s, i) => {
                    const named = (c?.radon_service_match || [])
                      .map((p) => String(p).trim().toLowerCase()).filter(Boolean)
                      .some((p) => String(s.name || '').toLowerCase().includes(p));
                    return (
                      <tr key={i} style={{ cursor: 'default' }}>
                        <td style={{ color: 'var(--text)' }}>{s.name || <i>unnamed</i>}</td>
                        <td>{s.orders}</td>
                        <td>{s.charged > 0 ? `${s.charged} of ${s.orders}` : <span className="muted">never</span>}</td>
                        <td>
                          {!named ? <span className="muted">no</span>
                            : s.charged > 0 ? <span className="pill green">yes</span>
                            : <span className="pill amber" title="Named radon, but never charged — a price list line">
                                only if charged</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------- the ISN roster */}
      <div className="card">
        <div className="card-head">
          <div>
            <h2>People on your ISN</h2>
            <div className="sub">
              {whose && <>The keys belong to <b>{whose}</b>. Orders are pulled company-wide, so this
                is not limited to their own jobs. </>}
              {people?.totals?.listed
                ? <>{people.totals.listed} on this ISN
                    {people.ourOffice && <> · {people.totals.in_our_office} in your office</>}
                    {people.totals.stubs_only > 0 && <> · {people.totals.stubs_only} not read yet</>}</>
                : 'Read the list from ISN to get started.'}
            </div>

            {people?.offices?.length > 1 && (
              <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Your office</span>
                <select className="input" style={{ width: 'auto', minWidth: 220 }}
                        value={people.ourOffice || ''}
                        disabled={busy === 'office'}
                        onChange={(e) => run('office', async () => {
                          await api('/isn/connection', {
                            method: 'PATCH', body: { isn_office_id: e.target.value || null },
                          });
                          await load();
                          setNote(e.target.value
                            ? 'Set. Orders and people from other branches are no longer shown.'
                            : 'Showing every office on this ISN.');
                        })}>
                  <option value="">Every office on this ISN</option>
                  {people.offices.map((o) => (
                    <option key={o.isn_office_id} value={o.isn_office_id}>
                      {o.name}{o.city ? ` — ${o.city}` : ''} ({o.people})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'center' }}>
            {people?.unlinked > 0 && (
              <span className="pill amber">{people.unlinked} inspectors to set up</span>
            )}
            <button className="btn" style={{ width: 'auto' }}
                    onClick={() => setOnlyInspectors((v) => !v)}>
              {onlyInspectors ? 'Show everyone' : 'Inspectors only'}
            </button>
            <button className="btn primary" style={{ width: 'auto' }}
                    disabled={busy === 'roster'} onClick={refreshRoster}>
              {busy === 'roster' ? <span className="spinner" /> : null} Read from ISN
            </button>
          </div>
        </div>

        {people?.error ? (
          <div className="card-body">
            <div className="banner">Could not read the roster: {people.error}</div>
          </div>
        ) : !people?.roster?.length ? (
          <div className="empty">
            <div className="ico"><Icon name="users" size={24} /></div>
            <h3>{people?.totals?.listed ? 'No inspectors in that view' : 'Nothing read yet'}</h3>
            <p>
              {people?.totals?.listed
                ? 'Nobody here is flagged as an inspector in ISN. Show everyone to see the rest.'
                : 'ISN gives the user list as bare ids — the names come one call at a time, so it is fetched on request rather than every time this page opens.'}
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>In ISN</th>
                  <th style={{ width: 150 }}>Their role</th>
                  <th style={{ width: 300 }}>Here</th>
                </tr>
              </thead>
              <tbody>
                {people.roster.map((u) => (
                  <tr key={u.isn_user_id} style={{ cursor: 'default', opacity: u.inactive ? 0.5 : 1 }}>
                    <td>
                      <div style={{ color: 'var(--text)', fontWeight: 550 }}>{u.name}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                        {u.email || u.isn_user_id}{u.inactive ? ' · inactive in ISN' : ''}
                      </div>
                    </td>
                    <td style={{ fontSize: 13.5 }}>{u.role || '—'}</td>
                    <td>
                      {u.employee_id ? (
                        <span className="pill green">{u.employee_name}</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <select
                            className="input" style={{ flex: 1, minWidth: 150 }}
                            defaultValue={u.suggested_employee_id || ''}
                            disabled={busy === u.isn_user_id}
                            onChange={(e) => adopt(u, e.target.value)}
                          >
                            <option value="">Choose someone…</option>
                            {people.employees.map((e) => (
                              <option key={e.id} value={e.id}>{e.full_name}</option>
                            ))}
                          </select>
                          <button className="btn" style={{ width: 'auto' }}
                                  disabled={busy === u.isn_user_id}
                                  onClick={() => adopt(u, null)}>
                            Add as new
                          </button>
                        </div>
                      )}
                      {!u.employee_id && u.suggested_employee_name && (
                        <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4 }}>
                          Same email as {u.suggested_employee_name}.
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="card-foot" style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
          Adding somebody creates their staff record and ties it to ISN in one step. Giving
          them a password is separate, under <b>Logins</b> — being on the roster does not by
          itself let anyone sign in.
        </div>
      </div>

      {/* ------------------------------------- inspectors seen on orders */}
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

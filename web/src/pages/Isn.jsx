import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import RevenueCheck from '../components/RevenueCheck.jsx';
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

/**
 * What a pull window actually reaches.
 *
 * The number in the box is ISN's change filter; the sync multiplies it because
 * a job booked in spring for a date in autumn has not been *touched* since
 * spring. Showing the months is the only way the choice reads as a choice.
 * Kept in step with the lookback in server/integrations/isn.js.
 */
const reach = (days) => {
  const months = Math.max((Number(days) || 14) * 6, 120) / 30.44;
  return months >= 11.5 && months < 12.5 ? 'a year'
    : months >= 12.5 ? `${(months / 12).toFixed(1)} years`
    : `${Math.round(months)} months`;
};

/**
 * What availability came back, and who it could not be asked about.
 *
 * Names rather than a count, because an inspector ISN would not answer for is
 * a person whose week shows as unknown on the grid, and a number gives nobody
 * anything to act on. The reason it is unknown and not "unavailable" belongs
 * here too: a run of empty slots is a question that did not work for them, not
 * two months of leave.
 */
function AvailabilityLine({ a }) {
  if (a.error) return <div style={{ marginTop: 6 }}>Availability could not be read: {a.error}</div>;
  if (!a.asked) {
    return (
      <div style={{ marginTop: 6 }}>
        <b>Nobody is linked to ISN yet</b>, so availability could not be asked for. ISN needs the
        inspector's own id to answer, and the roster below is where people get linked.
      </div>
    );
  }
  return (
    <div style={{ marginTop: 6 }}>
      Availability: asked ISN about {a.asked} inspector{a.asked > 1 ? 's' : ''}
      {a.zip ? <> around <span className="mono">{a.zip}</span></> : null}; {a.withSlots} could take
      work on {a.days} day{a.days === 1 ? '' : 's'} between them. Days nobody offered a slot on are
      shaded on the week grid as <i>not available</i> — which is not the same as on leave, and is
      as close as this API gets.
      {a.failures?.length ? (
        <> ISN would not answer for {a.failures.join(', ')} — their weeks stay unmarked rather
          than being shaded on a guess.</>
      ) : null}
    </div>
  );
}

/**
 * What ISN calls things, and what each word does to the screens.
 *
 * Two rounds went into working out why unscheduled orders were on the
 * calendar, both spent reasoning about what ISN probably calls them. It calls
 * them whatever this office set up, which is knowable — it is in the data.
 * So rather than a third guess, here is the list with counts beside it, and
 * the decision belongs to whoever runs the branch.
 */
function StatusRules() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api('/isn/statuses').then((d) => setRows(d.statuses)).catch(() => setRows(false));
  }, []);

  const flip = async (s) => {
    setBusy(s.status); setErr(null);
    try {
      const d = await api('/isn/statuses', {
        method: 'PATCH',
        body: { status: s.status, countsAsWork: !s.countsAsWork },
      });
      setRows(d.statuses);
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  };

  if (rows === false || !rows) return null;
  const off = rows.filter((s) => !s.countsAsWork).length;

  return (
    <div className="setting" style={{ display: 'block', marginTop: 16 }}>
      <b>What ISN calls things</b>
      <span>
        Every status your ISN has actually sent, with how many orders carry it. This decides what
        is <b>drawn on the schedule</b> — the calendar, the week grid, the day list on the phone.
        {' '}{off} turned off.{' '}
        {/* This switch used to move revenue as well, so turning Complete off to
            tidy a calendar quietly took 1,406 finished jobs out of the month's
            takings. Whether a job is revenue is not a display preference. */}
        <b>It does not touch Money.</b> Revenue counts every job except the ones that never
        happened — cancelled, deleted, never scheduled — and a finished job is always revenue,
        whatever you hide from the grid. An order with no day on it never reaches the calendar
        either way; it goes on the waiting list.
      </span>
      {err && <div className="note" style={{ marginTop: 8 }}>{err}</div>}
      <div style={{ marginTop: 10 }}>
        {rows.map((s) => (
          <div key={s.status} className="day-row">
            <span className="d-who" style={{ width: 170 }}>
              {s.asWritten || s.status || <i>(no status)</i>}
            </span>
            <span className="d-where">
              {s.orders} order{s.orders === 1 ? '' : 's'}
              {/* The number that matters for the calendar: how many of them
                  carry a date and so could be drawn on a day. */}
              {s.dated > 0 && <>, {s.dated} with a date on {s.dated === 1 ? 'it' : 'them'}</>}
              {s.orders === 0 && <> — a rule with nothing behind it</>}
              {/* Plain, not a tag: the tag style shouts in capitals, and a
                  whole sentence shouted is harder to read than no sentence. */}
              {s.note && <span style={{ color: 'var(--text-3)' }}> · {s.note}</span>}
            </span>
            <button className={`chip ${s.countsAsWork ? 'on' : ''}`} disabled={busy === s.status}
                    onClick={() => flip(s)}>
              {s.countsAsWork ? 'On the schedule' : 'Left off'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Isn() {
  const [status, setStatus] = useState(null);
  const [roster, setRoster] = useState(null);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(null);
  const [key, setKey] = useState('');
  const [probe, setProbe] = useState(null);
  const [probePath, setProbePath] = useState('');
  const [events, setEvents] = useState(null);
  const [orderNo, setOrderNo] = useState('');
  const [lookup, setLookup] = useState(null);

  const lookUpOrder = () =>
    run('lookup', async () => {
      setLookup(await api(`/isn/order-lookup?number=${encodeURIComponent(orderNo.trim())}`));
    });
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

          {/*
            * How deep the pull reaches.
            *
            * ISN's order list answers "what has changed since", not "what
            * happened since", so this is the only thing deciding how far back
            * the app can ever see. It was reachable only by someone with
            * database access, which is why the Money screen had six months of
            * history and no way to ask for more.
            */}
          <div className="setting" style={{ marginTop: 16 }}>
            <div style={{ minWidth: 0 }}>
              <b>How far back to look</b>
              <span>
                Reaches about {reach(c?.pull_window_days)} of history — ISN only lists orders
                that have changed recently, so anything older than this has never been pulled
                in and the app cannot report on it. Going deeper is a one-off catch-up: every
                order it has not read costs a call, it does at most{' '}
                {c?.max_orders_per_pull || 600} per pull, so it fills in over the next few
                syncs and then goes quiet again.
              </span>
            </div>
            <span style={{ marginLeft: 'auto' }}>
              <select className="input" style={{ width: 'auto' }}
                      value={c?.pull_window_days ?? 14}
                      disabled={busy === 'conn'}
                      onChange={(e) => patch({ pull_window_days: Number(e.target.value) },
                        `Looking back about ${reach(Number(e.target.value))}. The next pull starts catching up.`)}>
                {[14, 30, 45, 61, 90, 120].map((d) => (
                  <option key={d} value={d}>{d} days — about {reach(d)}</option>
                ))}
              </select>
            </span>
          </div>

          {/*
            * The calendar, which is the only thing that can tell a free day on
            * the week grid from a blocked one. There is no documentation for
            * it, so the app finds the endpoint by asking and reports what it
            * found — including "nothing answered", which is an answer.
            */}
          <div className="setting" style={{ marginTop: 16 }}>
            <div style={{ minWidth: 0 }}>
              <b>Time blocked off</b>
              <span>
                {c?.events_path
                  ? <>Reading the calendar from <span className="mono">{c.events_path}</span>.{' '}
                      {c.events_note}{' '}
                      {c.events_kind === 'slots' && (
                        <>That one reports when somebody is free rather than what is stopping
                           them, so a block shows with no reason against it.</>
                      )}</>
                  /* Once ISN has refused every way in, the note carries the
                     finding and repeating the search here would bury it. */
                  : c?.events_note
                    ? <>{c.events_note}</>
                    : <>Not read yet. Blocked time is an <b>Event</b> in ISN and nothing in the
                         docs says where to find one, so this asks the likely paths in turn and
                         keeps whichever answers. Until it does, a free-looking day on the week
                         grid may not be free.</>}
                {c?.events_checked_at && (
                  <> Last asked {new Date(c.events_checked_at).toLocaleString('en-US',
                    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.</>
                )}
              </span>
            </div>
            <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
              <button className="btn" disabled={busy === 'events'}
                      onClick={() => run('events', async () => {
                        const out = await api('/isn/events/pull', { method: 'POST' });
                        setEvents(out);
                        await load();
                      })}>
                {busy === 'events' ? <span className="spinner" /> : null} Pull the calendar
              </button>
            </span>
          </div>

          {/*
            * Two findings, kept apart. Whether ISN has a calendar to read is
            * one question and what availability came back is another, and the
            * second is the one that puts anything on the grid — so it is
            * reported even when, especially when, the first found nothing.
            */}
          {events && (
            <div className={events.availability?.days > 0 || (events.found && !events.error)
              ? 'ok' : 'note'} style={{ marginTop: 10 }}>
              {events.found && !events.error ? (
                <>Read {events.read} from <span className="mono">{events.path}</span> and kept{' '}
                  {events.written}.
                  {events.unmatched > 0 && <> {events.unmatched} could not be matched to anybody
                    here — those are left off the week grid rather than put on the wrong row.
                    Linking that person below would place them.</>}
                  {events.kind === 'slots' && <> This one only reports availability, so blocks
                    show without a reason.</>}</>
              ) : events.error ? (
                <>{events.path} stopped answering: {events.error}</>
              ) : (
                <><b>ISN has no Events in its API.</b> Every way in was refused
                  {events.answers?.length ? <> — {events.answers.slice(0, 2).map((a) =>
                    `${a.paths[0]}${a.count > 1 ? ` and ${a.count - 1} more` : ''}: "${a.text}"`)
                    .join(' · ')}</> : null}. So "Off", "Hold" and the rest are written on ISN's
                  own calendar and cannot be read from outside it.</>
              )}
              {events.availability && <AvailabilityLine a={events.availability} />}
            </div>
          )}

          <StatusRules />

          <RevenueCheck />

          <div className="setting">
            <div style={{ minWidth: 0 }}>
              <b>Why is a job not showing?</b>
              <span>
                Put in the order number from ISN's calendar and this says what we hold for
                it and what each filter makes of it.
              </span>
            </div>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <input className="input mono" style={{ width: 120 }} placeholder="23495"
                     value={orderNo} onChange={(e) => setOrderNo(e.target.value)}
                     onKeyDown={(e) => e.key === 'Enter' && lookUpOrder()} />
              <button className="btn" style={{ width: 'auto' }}
                      disabled={busy === 'lookup' || !orderNo.trim()} onClick={lookUpOrder}>
                {busy === 'lookup' ? <span className="spinner" /> : null} Look it up
              </button>
            </span>
          </div>

          {lookup && (
            <div style={{ marginTop: 12 }}>
              <div className={lookup.reasons?.length || !lookup.cached ? 'banner' : 'note'}>
                <b>#{lookup.number}</b> — {lookup.verdict}
              </div>
              <pre style={{
                marginTop: 10, padding: 14, background: 'var(--surface-2)',
                border: '1px solid var(--line)', borderRadius: 'var(--r-sm)',
                fontSize: 12.5, fontFamily: 'var(--mono)', overflowX: 'auto', whiteSpace: 'pre-wrap',
              }}>{JSON.stringify(
                lookup.cached ? lookup.order : { lastPull: lookup.lastPull, isnSays: lookup.live },
                null, 2)}</pre>
            </div>
          )}

          <div className="setting">
            <div style={{ minWidth: 0 }}>
              <b>Check what ISN sends</b>
              <span>
                Reports the field names and shape of the answer — never the contents, because
                an order carries a client's name and address. Blank checks the paths the sync
                depends on plus the calendar ones; put a path in to ask for one thing, like an
                event id off ISN's own calendar.
              </span>
            </div>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
              {/* One path, when you know what you are looking for — an event id
                  off ISN's own calendar, say. Blank asks the standard list. */}
              <input className="input mono" style={{ width: 165 }} placeholder="/event/33398"
                     value={probePath} onChange={(e) => setProbePath(e.target.value)}
                     onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.nextSibling?.click()} />
              <button className="btn" disabled={busy === 'probe'}
                      onClick={() => run('probe', async () => {
                        const at = probePath.trim();
                        const out = await api(`/isn/probe${at ? `?path=${encodeURIComponent(at)}` : ''}`);
                        setProbe(out.probes);
                      })}>
                {busy === 'probe' ? <span className="spinner" /> : null} Check
              </button>
            </span>
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

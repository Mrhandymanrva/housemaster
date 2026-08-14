import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';

/**
 * The month, out of the orders already synced.
 *
 * Every inspection has a date and an inspector on it, which is a calendar
 * already — it only ever needed drawing. Nothing here asks ISN anything.
 *
 * Colour means what kind of time it is, never whose: with four inspectors, four
 * colours cannot be told apart by somebody who does not see red and green, and
 * a fifth hire would break the key silently. Initials do the naming and work at
 * any team size. Picking one person filters the month down to their calendar,
 * which is the view somebody books against.
 *
 * One thing this cannot show, and says so: time somebody has blocked off. That
 * lives on ISN's own calendar and is not in its API, so an empty square means
 * nothing is booked — not that anybody is free.
 */
export default function Calendar() {
  const [month, setMonth] = useState(null);
  const [cal, setCal] = useState(null);
  const [err, setErr] = useState(null);
  const [only, setOnly] = useState(null);        // an employee id, or null for everybody
  const [open, setOpen] = useState(null);        // the day being looked at

  useEffect(() => {
    let live = true;
    setErr(null);
    api(`/ops/calendar${month ? `?month=${month}` : ''}`)
      .then((d) => { if (live) { setCal(d); setOpen(null); } })
      .catch((e) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [month]);

  if (err) return <div className="note">Could not load the calendar: {err}</div>;
  if (!cal) return <div className="note">Reading the schedule…</div>;

  const mine = (xs) => (only ? xs.filter((x) => x.employeeId === only) : xs);
  // Only when somebody is picked. Matching on the id alone finds the
  // nobody-assigned row, whose id is also null, and the month then opens
  // headed "Nobody assigned — 2 inspections".
  const person = only ? cal.inspectors.find((p) => p.employeeId === only) : null;
  const day = open ? cal.weeks.flat().find((c) => c.date === open) : null;

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div>
            <h2>{cal.label}</h2>
            <div className="sub">
              {person
                ? <>{person.name} — {person.jobs} inspection{person.jobs === 1 ? '' : 's'} this month
                    {cal.money && person.booked ? <> worth {money(person.booked)}</> : null}.</>
                : <>{cal.totals.jobs} inspection{cal.totals.jobs === 1 ? '' : 's'} booked across{' '}
                    {cal.totals.workingDays} day{cal.totals.workingDays === 1 ? '' : 's'}
                    {cal.money && cal.totals.booked ? <>, worth {money(cal.totals.booked)}</> : null}.
                    {cal.totals.unassigned > 0 && <> {cal.totals.unassigned} with nobody on
                      {cal.totals.unassigned === 1 ? ' it' : ' them'}.</>}</>}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexShrink: 0 }}>
            <button className="btn ghost" onClick={() => setMonth(cal.prev)}>‹ {shortOf(cal.prev)}</button>
            <button className="btn ghost" onClick={() => setMonth(null)}>Today</button>
            <button className="btn ghost" onClick={() => setMonth(cal.next)}>{shortOf(cal.next)} ›</button>
          </div>
        </div>

        <div className="legend" style={{ flexWrap: 'wrap' }}>
          <button className={`chip ${!only ? 'on' : ''}`} onClick={() => setOnly(null)}>
            Everybody
          </button>
          {cal.inspectors.filter((p) => p.employeeId).map((p) => (
            <button key={p.employeeId} className={`chip ${only === p.employeeId ? 'on' : ''}`}
                    onClick={() => setOnly(only === p.employeeId ? null : p.employeeId)}>
              {p.name}<span className="chip-n">{p.jobs}</span>
            </button>
          ))}
        </div>

        <div className="card-body" style={{ overflowX: 'auto' }}>
          <table className="month">
            <thead>
              <tr>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <th key={d}>{d}</th>)}</tr>
            </thead>
            <tbody>
              {cal.weeks.map((week, i) => (
                <tr key={i}>
                  {week.map((c) => {
                    const items = mine(c.items);
                    return (
                      <td key={c.date}
                          className={[
                            c.inMonth ? '' : 'outside',
                            c.date === cal.today ? 'today-cell' : '',
                            open === c.date ? 'picked' : '',
                          ].filter(Boolean).join(' ')}
                          /* A clickable cell that only answers the mouse is a
                             cell somebody on a keyboard cannot open at all. */
                          role="button"
                          tabIndex={0}
                          aria-label={`${c.date}, ${items.length} booked`}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            e.preventDefault();
                            setOpen(open === c.date ? null : c.date);
                          }}
                          onClick={() => setOpen(open === c.date ? null : c.date)}>
                        <div className="m-head">
                          <span className="m-day">{c.day}</span>
                          {items.length > 0 && (
                            <span className="m-n">
                              {items.length}
                              {cal.money && !only
                                ? ` · ${money(items.reduce((a, x) => a + (x.fee || 0), 0))}` : ''}
                            </span>
                          )}
                        </div>
                        {items.slice(0, 3).map((it) => (
                          <div key={it.id}
                               className={`m-job ${it.radon ? 'radon' : ''} ${it.unassigned ? 'unassigned' : ''}`}
                               title={`${it.time} · ${it.inspector} · ${it.address}`}>
                            <b>{it.time.replace(':00', '')}</b>
                            <span>{only ? it.address : it.initials}</span>
                          </div>
                        ))}
                        {items.length > 3 && <div className="m-more">+{items.length - 3} more</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="week-gap">
          <b>An empty square means nothing is booked, not that somebody is free.</b> Time blocked
          off is written on ISN's own calendar and is not in its API, so this shows booked work
          only — everything on it comes from the orders already synced.
        </div>
      </div>

      {day && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-head">
            <div>
              <h2>{new Date(`${day.date}T12:00:00`).toLocaleDateString('en-US',
                { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
              <div className="sub">
                {mine(day.items).length
                  ? <>{mine(day.items).length} booked
                      {cal.money ? <>, worth {money(mine(day.items).reduce((a, x) => a + (x.fee || 0), 0))}</> : null}.</>
                  : <>Nothing booked{only ? ' for them' : ''} that day.</>}
              </div>
            </div>
            <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setOpen(null)}>
              Close
            </button>
          </div>
          <div className="card-body">
            {mine(day.items).map((it) => (
              <div key={it.id} className="day-row">
                <span className="d-time">{it.time}</span>
                <span className="d-who">{it.inspector}</span>
                <span className="d-where">
                  {it.address}{it.city ? `, ${it.city}` : ''}
                  {it.radon && <span className="tag">radon</span>}
                  {it.status && it.status !== 'Scheduled' && <span className="tag">{it.status}</span>}
                </span>
                {cal.money && <span className="d-fee">{money(it.fee)}</span>}
                {it.url && (
                  <a className="btn ghost sm" href={it.url} target="_blank" rel="noreferrer">
                    Open in ISN
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

const shortOf = (id) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' })
  .format(new Date(`${id}-01T12:00:00Z`));

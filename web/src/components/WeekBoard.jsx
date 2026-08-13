import { money } from '../lib/format.js';

/**
 * The week, by inspector and by day.
 *
 * A name is a name — colour says what kind of time it is, never whose. Four
 * inspector colours cannot be told apart reliably: green against amber
 * separates at ΔE 4 under red-green colour blindness, which is to say not at
 * all, and a branch that hires a fifth inspector would break the key silently.
 * So the row carries the name, which works at any team size, and colour is
 * free to mean something fixed: inspection, radon, blocked, nobody assigned.
 *
 * Two rows earn their place by never disappearing. An inspector with an empty
 * week still gets a row, because an empty week is the thing worth seeing. And
 * a job with nobody on it gets its own row at the bottom rather than being
 * dropped for having no inspector to sit under.
 */
export default function WeekBoard({ board, onOpen }) {
  const { days, inspectors, totals } = board;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>The week</h2>
          <div className="sub">
            Who is booked, when, and where the gaps are.
            {totals.unassigned > 0 && <> {totals.unassigned} job{totals.unassigned > 1 ? 's have' : ' has'} nobody on it.</>}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right', fontSize: 12.5, color: 'var(--text-3)' }}>
          {days[0]?.weekday} {days[0]?.day} – {days[6]?.weekday} {days[6]?.day}
        </div>
      </div>

      <div className="legend">
        <span><i className="sw job" /> Inspection</span>
        <span><i className="sw radon" /> With radon</span>
        <span><i className="sw un" /> Nobody assigned</span>
        <span style={{ color: 'var(--text-3)' }}>Dashed — nothing booked</span>
      </div>

      <div className="card-body" style={{ overflowX: 'auto' }}>
        <table className="week">
          <thead>
            <tr>
              <th>Inspector</th>
              {days.map((d) => (
                <th key={d.date} className={`day ${d.date === today ? 'today' : ''}`}>
                  {d.weekday}<b>{d.day}</b>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {inspectors.map((p) => (
              <tr key={p.employeeId || p.name}>
                <td className="wk-who">
                  <div className={`who-name ${p.unassigned ? 'nobody' : ''}`}>{p.name}</div>
                  <div className="who-sum">
                    {p.jobs ? `${p.jobs} job${p.jobs > 1 ? 's' : ''}` : 'nothing booked'}
                    {board.money && p.booked ? ` · ${money(p.booked)}` : ''}
                  </div>
                </td>
                {days.map((d) => {
                  const slots = p.days[d.date] || [];
                  return (
                    <td key={d.date} className={d.date === today ? 'today-col' : undefined}>
                      {!slots.length && <span className="slot free">—</span>}
                      {slots.map((s) => (
                        <button key={s.id}
                                className={`slot ${p.unassigned ? 'unassigned' : 'job'} ${s.radon ? 'radon' : ''}`}
                                title={`${s.time} · ${s.address}${s.city ? `, ${s.city}` : ''}`
                                  + (board.money ? ` · ${money(s.fee)}` : '')}
                                onClick={() => onOpen?.(s)}>
                          <span className="t">{s.time}</span>
                          <span className="w">{s.address}</span>
                        </button>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!inspectors.length && (
              <tr><td colSpan={8} style={{ color: 'var(--text-3)', padding: '22px 4px' }}>
                Nothing booked this week.
              </td></tr>
            )}
          </tbody>
          {board.money && (
            <tfoot>
              <tr>
                <td className="wk-who" style={{ paddingTop: 10 }}>
                  <span className="foot-label">Booked that day</span>
                </td>
                {days.map((d) => (
                  <td key={d.date} className={`daysum ${d.date === today ? 'today-col' : ''}`}>
                    <b>{d.jobs ? money(d.booked) : '—'}</b>
                    {d.jobs ? `${d.jobs} job${d.jobs > 1 ? 's' : ''}` : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Said out loud rather than left as an empty column somebody reads as a
          free day. Goes when ISN's calendar is wired in. */}
      <div className="week-gap">
        Time somebody has blocked off is an <b>Event</b> in ISN, and the app only reads orders —
        so a day can look free here when it is not. Settings → ISN link → Check says whether
        the calendar will tell us.
      </div>
    </div>
  );
}

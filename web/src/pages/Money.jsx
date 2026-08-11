import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from '../components/Icons.jsx';
import { money, n, OFFICE_ZONE } from '../lib/format.js';

/**
 * The owner's screen.
 *
 * Everything else in the app is a compliance view — what is due, who is
 * licensed, what is overdue. Useful, and not the first question somebody
 * running a branch asks. This is the money.
 *
 * It is built to be believed, which means it never rounds an uncertainty away:
 * booked and collected are shown as two different things because they are two
 * different things, a month in progress is compared only with the same stretch
 * of the month before, and the margin tile says it cannot answer yet rather
 * than answering with a number that leaves labour and fuel out.
 */
export default function Money() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api('/ops/money').then(setD).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="banner">{err}</div>;
  if (!d) return <div className="empty"><div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…</div>;

  const monthName = new Date(d.month.start)
    .toLocaleDateString('en-US', { month: 'long', timeZone: OFFICE_ZONE });
  const noWork = !d.jobs.month;

  return (
    <div className="stack" style={{ gap: 18 }}>
      {noWork && (
        <div className="note">
          No jobs booked in {monthName} yet. Everything below reads zero until ISN has
          something to sync.
        </div>
      )}

      <div className="kpis">
        <Kpi label={`Booked in ${monthName}`} value={money(d.booked.month)}
             delta={delta(d.booked.month, d.booked.priorToDate)}
             foot="against the same days last month" />
        <Kpi label="Collected" value={money(d.booked.collected)}
             foot={`${share(d.booked.collected, d.booked.month)} of what was booked`} />
        <Kpi label="Still owed" value={money(d.receivables.total)} tone={d.receivables.total ? 'warn' : null}
             foot={d.receivables.jobs
               ? `${d.receivables.jobs} ${d.receivables.jobs === 1 ? 'job' : 'jobs'}, oldest ${d.receivables.oldestDays} days`
               : 'nothing outstanding'} />
        <Kpi label="Average ticket" value={d.averageTicket.month == null ? '—' : money(d.averageTicket.month)}
             delta={delta(d.averageTicket.month, d.averageTicket.priorToDate)}
             foot="against the same days last month" />
        <Kpi label="Jobs booked" value={d.jobs.month}
             delta={delta(d.jobs.month, d.jobs.priorToDate)}
             foot="against the same days last month" />
        <Kpi label="Radon attach rate"
             value={d.jobs.radonAttach == null ? '—' : `${Math.round(d.jobs.radonAttach * 100)}%`}
             foot={`${d.jobs.radon} of ${d.jobs.month} jobs carried a radon test`} />
      </div>

      <Trend rows={d.trend} />

      <div className="two-up">
        <ServiceLines lines={d.byService} monthName={monthName} />
        <Scoreboard rows={d.scoreboard} />
      </div>

      <div className="two-up">
        <Receivables r={d.receivables} />
        <Overhead o={d.overhead} monthName={monthName} margin={d.margin} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ bits */

const delta = (now, before) => {
  if (before == null || !before || now == null) return null;
  const pct = ((now - before) / Math.abs(before)) * 100;
  if (!Number.isFinite(pct)) return null;
  return { pct: Math.round(pct), up: pct >= 0 };
};

const share = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

function Kpi({ label, value, delta: dd, foot, tone }) {
  return (
    <div className={`kpi ${tone || ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">
        {dd && (
          /* Direction is stated in words as well as colour — up and down on a
             money screen is exactly where colour alone gets misread. */
          <span className={`trend ${dd.up ? 'up' : 'down'}`}>
            {dd.up ? '▲' : '▼'} {Math.abs(dd.pct)}% {dd.up ? 'up' : 'down'}
          </span>
        )}
        {foot && <span>{foot}</span>}
      </div>
    </div>
  );
}

/**
 * Twelve months of money.
 *
 * Collected is part of booked rather than a rival to it, so the bar is stacked
 * — the whole bar is what was booked, the solid part is what came in, the rest
 * is still owed. Two bars side by side would invite reading them as separate
 * totals and adding them up.
 *
 * One axis, because both are dollars. Green and blue rather than the obvious
 * green and amber: that pair separates at ΔE 4 under red-green colour
 * blindness, which is to say not at all.
 */
function Trend({ rows }) {
  const [hover, setHover] = useState(null);
  const top = Math.max(...rows.map((r) => r.booked), 1);
  const W = 760;
  const H = 200;
  const pad = { l: 8, r: 8, t: 16, b: 26 };
  const band = (W - pad.l - pad.r) / rows.length;
  const barW = Math.min(38, band * 0.62);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / top);

  /* Read back in UTC, because that is how it was built. Rendered in local time
     a month that starts at midnight UTC lands in the evening of the last day
     of the month before, and every label on the axis shifts back one. */
  const label = (m) => {
    const [yy, mm] = m.split('-');
    return new Date(Date.UTC(+yy, +mm - 1, 1))
      .toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  };
  const longLabel = (m) => {
    const [yy, mm] = m.split('-');
    return new Date(Date.UTC(+yy, +mm - 1, 1))
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Booked and collected</h2>
          <div className="sub">The last twelve months. The whole bar is what was booked;
            the solid part is what has been paid.</div>
        </div>
        <div className="legend" style={{ marginLeft: 'auto' }}>
          <span><i style={{ background: 'var(--brand)' }} />Collected</span>
          <span><i style={{ background: 'var(--blue)' }} />Still owed</span>
        </div>
      </div>
      <div className="card-body chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img"
             aria-label="Booked and collected revenue by month for the last twelve months">
          {/* Recessive gridlines: three is enough to read a height by. */}
          {[0.5, 1].map((f) => (
            <line key={f} x1={pad.l} x2={W - pad.r} y1={y(top * f)} y2={y(top * f)} className="grid" />
          ))}
          <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="axis" />

          {rows.map((r, i) => {
            const x = pad.l + band * i + (band - barW) / 2;
            const owed = Math.max(0, r.booked - r.collected);
            const hCollected = Math.max(0, y(0) - y(r.collected));
            const hOwed = Math.max(0, y(0) - y(owed));
            const on = hover === i;
            return (
              <g key={r.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                {/* A hit area taller and wider than the bar, so a thin month is
                    still hoverable. */}
                <rect x={pad.l + band * i} y={pad.t} width={band} height={H - pad.t - pad.b}
                      fill="transparent" />
                {owed > 0 && (
                  <rect x={x} y={y(r.booked)} width={barW} height={hOwed} rx="4"
                        fill="var(--blue)" opacity={on || hover === null ? 1 : 0.45} />
                )}
                {r.collected > 0 && (
                  /* 2px of surface between the segments so the boundary is a
                     shape, not only a colour change. */
                  <rect x={x} y={y(r.collected) + (owed > 0 ? 2 : 0)} width={barW}
                        height={Math.max(0, hCollected - (owed > 0 ? 2 : 0))} rx="4"
                        fill="var(--brand)" opacity={on || hover === null ? 1 : 0.45} />
                )}
                <text x={x + barW / 2} y={H - 8} className="tick">{label(r.month)}</text>
              </g>
            );
          })}

          {/* Only the newest month is labelled directly. A number on all twelve
              is noise, and the current month is the one being looked for. */}
          {rows.length > 0 && rows[rows.length - 1].booked > 0 && (
            <text x={pad.l + band * (rows.length - 1) + band / 2} y={y(rows[rows.length - 1].booked) - 6}
                  className="point-label">{money(rows[rows.length - 1].booked)}</text>
          )}
        </svg>

        {hover != null && (
          <div className="chart-tip" style={{ left: `${((hover + 0.5) / rows.length) * 100}%` }}>
            <b>{longLabel(rows[hover].month)}</b>
            <div><span style={{ background: 'var(--brand)' }} />Collected {money(rows[hover].collected)}</div>
            <div><span style={{ background: 'var(--blue)' }} />Still owed
              {' '}{money(Math.max(0, rows[hover].booked - rows[hover].collected))}</div>
            <div className="tot">Booked {money(rows[hover].booked)} · {rows[hover].jobs} jobs</div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * What sold.
 *
 * ISN gives the services on an order but one fee for the whole job, so a job's
 * money cannot be split across its lines without inventing the split. These
 * are counts of jobs that included each thing, and the heading says so.
 */
function ServiceLines({ lines, monthName }) {
  const top = Math.max(...lines.map((l) => l.jobs), 1);
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>What sold in {monthName}</h2>
          <div className="sub">Jobs that included each service. One job can be on more than one line.</div>
        </div>
      </div>
      <div className="card-body">
        {!lines.length && <div className="empty" style={{ padding: '24px 0' }}>Nothing booked yet.</div>}
        {lines.map((l) => (
          <div key={l.key} className="svc">
            <span className="svc-name">{l.label}</span>
            <span className="svc-bar"><i style={{ width: `${(l.jobs / top) * 100}%` }} /></span>
            <span className="svc-n">{l.jobs}</span>
            <span className="svc-money">
              {l.key === 'inspection' ? money(l.booked) : l.fee ? money(l.fee) : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Scoreboard({ rows }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>By inspector</h2>
          <div className="sub">This month. Attach rate is how often a job went out with radon on it.</div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Inspector</th><th>Jobs</th><th>Booked</th><th>Average</th><th>Radon</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="num">{r.jobs}</td>
                <td className="num">{money(r.booked)}</td>
                <td className="num">{r.averageTicket == null ? '—' : money(r.averageTicket)}</td>
                <td className="num">{r.radonAttach == null ? '—'
                  : `${Math.round(r.radonAttach * 100)}%`}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} style={{ color: 'var(--text-3)' }}>No jobs this month.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Not a number but a worklist: oldest first, because that is this afternoon's calls. */
function Receivables({ r }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Waiting on payment</h2>
          <div className="sub">
            {r.jobs ? `${r.jobs} ${r.jobs === 1 ? 'job' : 'jobs'}, ${money(r.total)} outstanding. Oldest first.`
                    : 'Nothing outstanding.'}
          </div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data">
          <tbody>
            {r.list.map((x) => (
              <tr key={x.id}>
                <td>
                  {x.address || x.client || x.orderNumber || 'Job'}
                  <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{x.client}</div>
                </td>
                <td className="num">{money(x.amount)}</td>
                <td className="num" style={{ color: x.days > 45 ? 'var(--red)' : 'var(--text-2)' }}>
                  {x.days}d
                </td>
                <td style={{ width: 40 }}>
                  {x.url && <a href={x.url} target="_blank" rel="noreferrer" className="link-btn">ISN</a>}
                </td>
              </tr>
            ))}
            {!r.list.length && <tr><td style={{ color: 'var(--text-3)' }}>Everything booked has been paid.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * What the app knows the cost of — which is not the cost of the branch, and
 * the panel says which is which rather than letting a total imply it.
 */
function Overhead({ o, monthName, margin }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Costs the app can see</h2>
          <div className="sub">{monthName}, from what is recorded on your own screens.</div>
        </div>
        <b style={{ marginLeft: 'auto', fontSize: 17 }}>{money(o.total)}</b>
      </div>
      <div className="card-body">
        {o.lines.map((l) => (
          <div key={l.key} className="cost-line">
            <span>{l.label}</span>
            <b>{money(l.amount)}</b>
          </div>
        ))}
        {!o.lines.length && (
          <div style={{ color: 'var(--text-3)', fontSize: 14 }}>
            Nothing with a cost on it was recorded this month.
          </div>
        )}

        <div className="gap-note">
          <b>This is not what it costs to run the branch.</b> Not counted: {o.notCounted.join(', ')}.
          {margin == null && (
            <> That is why there is no margin figure here — one that left wages and fuel out
               would be wrong in the flattering direction. Putting a cost per hour on each
               inspector would let the app estimate it from the crew and hours it already
               has on every job.</>
          )}
        </div>
      </div>
    </div>
  );
}

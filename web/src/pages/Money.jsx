import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { money, n, OFFICE_ZONE } from '../lib/format.js';

/**
 * The owner's screen, laid out to the mockup.
 *
 * Everything else in the app is a compliance view — what is due, who is
 * licensed, what is overdue. Useful, and not the first question somebody
 * running a branch asks. This is the money.
 *
 * The shape is the mockup's: a six-tile KPI grid three across, the twelve-month
 * trend beside what is selling, the scoreboard beside the receivables, a strip
 * of cost chips, and the readiness chips along the bottom. What is different is
 * only what the numbers are allowed to claim.
 *
 * Booked and collected stay two different things, because they are. A period
 * in progress is compared only with the same stretch of the one before, since
 * eleven days against a whole thirty reads as a collapse somebody would act on.
 * Service lines are counts of jobs that included each thing rather than a split
 * of the money, because ISN gives one fee per job and any split would be
 * invented. And where the mockup shows net income and gross margin from
 * QuickBooks, this shows what the app itself can see — which is real, and is
 * labelled as the part of the cost that is counted.
 */
const PERIODS = [
  ['week', 'This week'], ['month', 'This month'],
  ['quarter', 'Quarter'], ['year', 'Year'],
];

export default function Money() {
  const [period, setPeriod] = useState('month');
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let live = true;
    setBusy(true);
    api(`/ops/money?period=${period}`)
      .then((x) => { if (live) { setD(x); setErr(null); } })
      .catch((e) => live && setErr(e.message))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [period]);

  if (err) return <div className="banner">{err}</div>;
  if (!d) return <div className="empty"><div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…</div>;

  const label = { week: 'this week', month: monthName(d), quarter: 'this quarter', year: 'this year' }[d.period];
  const per = { week: 'week', month: 'month', quarter: 'quarter', year: 'year' }[d.period];

  return (
    <div className={`stack money ${busy ? 'busy' : ''}`} style={{ gap: 18 }}>
      <div className="seg" role="tablist" aria-label="Period">
        {PERIODS.map(([k, t]) => (
          <button key={k} role="tab" aria-selected={period === k}
                  className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{t}</button>
        ))}
      </div>

      {!d.jobs.month && (
        <div className="note">
          Nothing booked {label}. Everything below reads zero until ISN has something to sync.
        </div>
      )}

      <div className="kpis">
        <Kpi label={`Booked revenue · ${cap(label)}`} value={money(d.booked.month)}
             delta={delta(d.booked.month, d.booked.priorToDate)}
             meta={d.month.pace
               ? `vs the same point last ${per} · on pace for about ${money(d.month.pace)}`
               : `vs the same point last ${per}`} />

        <Kpi label="Collected" value={money(d.booked.collected)}
             meta={`${share(d.booked.collected, d.booked.month)} of what was booked · ISN's paid flag`} />

        <Kpi label="Waiting on payment" value={money(d.receivables.total)}
             tone={d.receivables.total ? 'warn' : null}
             meta={d.receivables.jobs
               ? `${d.receivables.jobs} ${d.receivables.jobs === 1 ? 'job' : 'jobs'} · oldest ${d.receivables.oldestDays} days`
               : 'nothing outstanding'} />

        <Kpi label="Average ticket" value={d.averageTicket.month == null ? '—' : money(d.averageTicket.month)}
             delta={delta(d.averageTicket.month, d.averageTicket.priorToDate)}
             meta={`vs the same point last ${per}`} />

        <Kpi label={`Jobs booked · ${cap(label)}`} value={d.jobs.month}
             delta={delta(d.jobs.month, d.jobs.priorToDate)}
             meta={jobMeta(d)} />

        <Kpi label="Radon attach rate"
             value={d.jobs.radonAttach == null ? '—' : `${Math.round(d.jobs.radonAttach * 100)}%`}
             meta={`${d.jobs.radon} of ${d.jobs.month} jobs went out with radon on them`} />
      </div>

      <div className="grid split">
        <Trend rows={d.trend} knownFrom={d.knownFrom} />
        <ServiceLines lines={d.byService} label={label} />
      </div>

      <div className="grid split">
        <Scoreboard rows={d.scoreboard} label={label} />
        <Receivables r={d.receivables} />
      </div>

      <Costs o={d.overhead} label={label} margin={d.margin} />
      <Readiness r={d.readiness} />
    </div>
  );
}

/* ------------------------------------------------------------------ bits */

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const monthName = (d) => new Date(d.month.start)
  .toLocaleDateString('en-US', { month: 'long', timeZone: OFFICE_ZONE });

const delta = (now, before) => {
  if (before == null || !before || now == null) return null;
  const pct = ((now - before) / Math.abs(before)) * 100;
  return Number.isFinite(pct) ? { pct: Math.round(pct), up: pct >= 0 } : null;
};
const share = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

const jobMeta = (d) => {
  const bits = d.byService.filter((l) => l.key !== 'inspection')
    .slice(0, 3).map((l) => `${l.jobs} ${l.label.toLowerCase()}`);
  return bits.length ? bits.join(' · ') : 'nothing else attached';
};

function Kpi({ label, value, delta: dd, meta, tone }) {
  return (
    <div className={`kpi ${tone || ''}`}>
      <div className="lbl">{label}</div>
      <div className="val mono">{value}</div>
      <div className="meta">
        {/* Direction is a word as well as a colour. Up and down on a money
            screen is exactly where colour alone gets misread. */}
        {dd && <span className={`delta ${dd.up ? 'up' : 'down'}`}>
          {dd.up ? '▲' : '▼'} {Math.abs(dd.pct)}% {dd.up ? 'up' : 'down'}
        </span>}
        <span>{meta}</span>
      </div>
    </div>
  );
}

/**
 * Twelve months, booked against collected.
 *
 * Two lines with the collected one filled, so the gap between them is the
 * money still owed — which is the thing worth seeing and needs no third
 * series to say it. One axis, because both are dollars.
 *
 * Green and blue rather than the obvious green and amber: that pair separates
 * at ΔE 4 under red-green colour blindness, which is to say not at all.
 */
function Trend({ rows, knownFrom }) {
  const [hover, setHover] = useState(null);
  const W = 720;
  const H = 260;
  const pad = { l: 46, r: 15, t: 30, b: 34 };
  const top = niceTop(Math.max(...rows.map((r) => r.booked), 1));
  const x = (i) => pad.l + ((W - pad.l - pad.r) * i) / Math.max(1, rows.length - 1);
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / top);

  // Months the app has never seen are not months the branch earned nothing in.
  // The line starts where the records start; before that the chart shows a
  // shaded gap and says why, because a flat zero back to last September is a
  // confident claim about a year nobody has looked at.
  const from = Math.max(0, rows.findIndex((r) => r.known !== false));
  const seen = rows.slice(from);
  const line = (key) => seen.map((r, i) =>
    `${i ? 'L' : 'M'}${x(i + from).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' ');
  const area = seen.length
    ? `${line('collected')} L${x(rows.length - 1).toFixed(1)},${y(0)} L${x(from).toFixed(1)},${y(0)} Z`
    : '';

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Revenue over the last 12 months</h2>
          <div className="sub">
            What jobs were booked at, against what has been paid. The gap between the
            lines is money still owed.
            {knownFrom && rows[0] && rows[0].known === false && (
              <> Orders only go back to {longMonth(knownFrom)} — ISN lists what has changed
                 recently, so anything older than that was never pulled in. The shaded part
                 is unknown, not zero.</>
            )}
          </div>
        </div>
      </div>
      <div className="legend">
        <span><i className="swatch" style={{ background: 'var(--blue)' }} /> Booked</span>
        <span><i className="swatch" style={{ background: 'var(--brand)' }} /> Collected</span>
      </div>
      <div className="chart-wrap" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="260" role="img"
             aria-label="Booked and collected revenue by month for the last twelve months">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line className="gl" x1={pad.l} x2={W - pad.r} y1={y(top * f)} y2={y(top * f)} />
              <text x={8} y={y(top * f) + 4}>{shortMoney(top * f)}</text>
            </g>
          ))}

          {from > 0 && (
            <>
              <rect x={pad.l} y={pad.t} width={x(from) - pad.l} height={H - pad.t - pad.b}
                    fill="var(--surface-3)" fillOpacity="0.7" />
              <text x={(pad.l + x(from)) / 2} y={pad.t + (H - pad.t - pad.b) / 2}
                    textAnchor="middle" style={{ fontSize: 11.5 }}>not synced yet</text>
            </>
          )}
          <path d={area} fill="var(--brand)" fillOpacity="0.12" />
          <path d={line('collected')} fill="none" stroke="var(--brand)" strokeWidth="2.5"
                strokeLinejoin="round" strokeLinecap="round" />
          <path d={line('booked')} fill="none" stroke="var(--blue)" strokeWidth="2.5"
                strokeLinejoin="round" strokeLinecap="round" />

          {seen.length > 0 && (
            <>
              <circle cx={x(rows.length - 1)} cy={y(rows[rows.length - 1].booked)} r="4" fill="var(--blue)" />
              <circle cx={x(rows.length - 1)} cy={y(rows[rows.length - 1].collected)} r="4" fill="var(--brand)" />
            </>
          )}

          {rows.map((r, i) => (
            <g key={r.month} onMouseEnter={() => setHover(i)}>
              <rect x={x(i) - (W - pad.l - pad.r) / rows.length / 2} y={pad.t}
                    width={(W - pad.l - pad.r) / rows.length} height={H - pad.t - pad.b} fill="transparent" />
              <text x={x(i)} y={H - 12} textAnchor="middle">{shortMonth(r.month)}</text>
            </g>
          ))}
          {hover != null && (
            <line className="gl" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)}
                  stroke="var(--line-2)" strokeDasharray="3 3" />
          )}
        </svg>

        {hover != null && (
          <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <b>{longMonth(rows[hover].month)}</b>
            {rows[hover].known === false && <div className="tot">Never synced — no orders on file</div>}
            {rows[hover].known !== false && (
              <>
                <div><span style={{ background: 'var(--blue)' }} />Booked {money(rows[hover].booked)}</div>
                <div><span style={{ background: 'var(--brand)' }} />Collected {money(rows[hover].collected)}</div>
                <div className="tot">
                  {money(Math.max(0, rows[hover].booked - rows[hover].collected))} owed · {rows[hover].jobs} jobs
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/*
 * Pick the gridline step first, then the top — the other way round gives a
 * round ceiling divided into ragged quarters, which is how an axis ends up
 * labelled $0 $9k $18k $26k $35k.
 */
function niceTop(v, lines = 4) {
  const raw = v / lines;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  return step * lines;
}
/* A 2.5k step has to read as $2.5k, not round to $3k and put two gridlines
   the same distance apart with the same label. */
const shortMoney = (v) => {
  if (v < 1000) return `$${Math.round(v)}`;
  const k = v / 1000;
  return `$${k % 1 === 0 ? k : k.toFixed(1)}k`;
};

/* Read back in UTC, because that is how it was built. Rendered in local time a
   month starting at midnight UTC lands in the evening of the day before, and
   every label on the axis shifts back one. */
const asDate = (m) => new Date(Date.UTC(+m.split('-')[0], +m.split('-')[1] - 1, 1));
const shortMonth = (m) => asDate(m).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
const longMonth = (m) => asDate(m).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * What sold.
 *
 * ISN gives the services on an order but one fee for the whole job, so a job's
 * money cannot be split across its lines without inventing the split. These
 * are counts of jobs that included each thing; the money column is filled only
 * where there really is a separate figure, which is the radon fee.
 */
function ServiceLines({ lines, label }) {
  const top = Math.max(...lines.map((l) => l.jobs), 1);
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>What is bringing it in</h2>
          <div className="sub">Jobs {label} that included each service. One job can be on more than one line.</div>
        </div>
      </div>
      <div className="card-body">
        {!lines.length && <div className="empty" style={{ padding: '28px 0' }}>Nothing booked yet.</div>}
        <div className="bars">
          {lines.map((l) => (
            <div key={l.key} className="barrow">
              <span className="name">{l.label}</span>
              <span className="track"><i className="fill" style={{ width: `${(l.jobs / top) * 100}%` }} /></span>
              <span className="amt mono">
                {l.key === 'inspection' ? money(l.booked) : l.fee ? money(l.fee) : `${l.jobs} jobs`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const initials = (s = '') => s.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function Scoreboard({ rows, label }) {
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>Inspector scoreboard</h2><div className="sub">{cap(label)}, most booked first.</div></div>
      </div>
      <div className="card-body" style={{ paddingTop: 2 }}>
        <table className="data">
          <thead>
            <tr><th>Inspector</th><th className="r">Jobs</th><th className="r">Booked</th>
              <th className="r">Avg ticket</th><th className="r">Radon</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td><div className="who-cell"><span className="mini-av">{initials(r.name)}</span> {r.name}</div></td>
                <td className="r mono">{r.jobs}</td>
                <td className="r mono">{money(r.booked)}</td>
                <td className="r mono">{r.averageTicket == null ? '—' : money(r.averageTicket)}</td>
                <td className="r">
                  {r.radonAttach == null ? '—' : (
                    <span className={`pill ${r.radonAttach >= 0.5 ? 'green' : 'amber'}`}>
                      {Math.round(r.radonAttach * 100)}%
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={5} style={{ color: 'var(--text-3)' }}>No jobs in this period.</td></tr>}
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
            {r.jobs ? `${money(r.total)} across ${r.jobs} ${r.jobs === 1 ? 'job' : 'jobs'}. Oldest first.`
                    : 'Nothing outstanding.'}
          </div>
        </div>
      </div>
      <div className="card-body" style={{ paddingTop: 2 }}>
        <div className="rows">
          {r.list.map((x) => (
            <div key={x.id} className="row">
              <div className="main-text">
                <b>{x.address || x.client || `Job ${x.orderNumber || ''}`}</b>
                <span>{[x.client, x.orderNumber && `#${x.orderNumber}`].filter(Boolean).join(' · ')}</span>
              </div>
              <span className="amt mono">{money(x.amount)}</span>
              <span className="age" style={x.days > 45 ? { color: 'var(--red)', fontWeight: 600 } : undefined}>
                {x.days}d
              </span>
              {x.url && <a className="link-btn" href={x.url} target="_blank" rel="noreferrer">ISN</a>}
            </div>
          ))}
          {!r.list.length && (
            <div style={{ color: 'var(--text-3)', padding: '18px 6px', fontSize: 13.5 }}>
              Everything booked has been paid.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * What the app knows the cost of — which is not the cost of the branch, and
 * the panel says which is which rather than letting a total imply it.
 */
function Costs({ o, label, margin }) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Operating costs you already track</h2>
          <div className="sub">Pulled from records you are keeping now — {label}.</div>
        </div>
      </div>
      <div className="card-body">
        <div className="costs">
          {o.lines.map((l) => (
            <div key={l.key} className="cost">
              <div className="cl">{l.label}</div>
              <div className="cv mono">{money(l.amount)}</div>
            </div>
          ))}
          <div className="cost total">
            <div className="cl">Tracked total</div>
            <div className="cv mono">{money(o.total)}</div>
          </div>
        </div>

        <div className="note" style={{ marginTop: 12 }}>
          <span aria-hidden="true">◆</span>
          <span>
            <b>This is not what it costs to run the branch.</b> Not counted: {o.notCounted.join(', ')}.
            {margin == null && ' That is why there is no margin figure — one that left wages and fuel'
              + ' out would be wrong in the flattering direction. Putting a cost per hour on each'
              + ' inspector would let the app estimate it from the crew and hours it already has'
              + ' on every job.'}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Can everybody work, and is the data fresh. Still an owner's question. */
function Readiness({ r }) {
  if (!r) return null;
  const chips = [
    r.blocked
      ? { tone: 'red', text: `${r.blocked} of ${r.people} cannot work today` }
      : { tone: 'green', text: r.people ? 'Everyone can work today' : 'Nobody on the team yet' },
    r.licensesSoon && { tone: 'amber', text: `${r.licensesSoon} ${r.licensesSoon === 1 ? 'licence renews' : 'licences renew'} within 30 days` },
    r.registrationsSoon && { tone: 'amber', text: `${r.registrationsSoon} van ${r.registrationsSoon === 1 ? 'registration is' : 'registrations are'} due within 30 days` },
    r.overdue && { tone: 'red', text: `${r.overdue} overdue on the compliance board` },
    { tone: r.isnEnabled ? 'blue' : 'amber',
      text: r.isnEnabled ? `ISN synced ${ago(r.isnSyncedAt)}` : 'ISN link is switched off' },
  ].filter(Boolean);

  return (
    <div className="readiness">
      {chips.map((c, i) => (
        <div key={i} className="rchip">
          <span className="rdot" style={{ background: `var(--${c.tone})` }} />{c.text}
        </div>
      ))}
    </div>
  );
}

function ago(at) {
  if (!at) return 'never';
  const mins = Math.round((Date.now() - new Date(at)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from '../components/Icons.jsx';
import { date, num, n, money, whenText } from '../lib/format.js';
import WeekBoard from '../components/WeekBoard.jsx';

/* One big number, one sentence under it, and it takes you somewhere. */
function Status({ tone, icon, big, small, onClick }) {
  return (
    <button className={`status ${tone}`} onClick={onClick}>
      <div className="ico"><Icon name={icon} size={21} /></div>
      <div style={{ minWidth: 0 }}>
        <div className="big">{big}</div>
        <div className="small">{small}</div>
      </div>
    </button>
  );
}

const firstNames = (list) => {
  const n = list.map((r) => r.full_name.split(' ')[0]);
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]} and ${n[1]}`;
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export default function Home({ go }) {
  const [d, setD] = useState(null);
  const [week, setWeek] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => { api('/ops/dashboard').then(setD).catch((e) => setErr(e.message)); }, []);
  // The week loads on its own, so a slow board does not hold up the rest of
  // the screen and a broken one does not take the screen down with it.
  useEffect(() => { api('/ops/week').then(setWeek).catch(() => setWeek(false)); }, []);

  if (err) return <div className="banner">{err}</div>;
  if (!d) return <div className="empty"><div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…</div>;

  const past = d.buckets?.Overdue || 0;
  const soon = d.buckets?.['Due Soon'] || 0;
  const blocked = d.readiness.filter((r) => r.licenses_expired > 0 || r.dl_expired);
  const open = d.horizon.filter((h) => !h.completed_date);
  const first = open.slice(0, 6);

  const t = week?.totals;

  return (
    <div className="stack">
      {/* What the week is worth and what is in it, before anything else. The
          compliance view that used to open this screen is true but is not the
          question somebody starts the day with. */}
      {week && (
        <div className="kpis home-kpis">
          {week.money && (
            <div className="kpi">
              <div className="lbl">Scheduled this week</div>
              <div className="val mono">{money(t.booked)}</div>
              <div className="meta">
                {t.jobs} job{t.jobs === 1 ? '' : 's'} on the book
                {t.unbilled ? ` · ${money(t.unbilled)} not yet paid` : ''}
              </div>
            </div>
          )}
          <div className="kpi">
            <div className="lbl">Inspections scheduled</div>
            <div className="val mono">{t.jobs}</div>
            <div className="meta">{t.done} done · {t.toCome} to come</div>
          </div>
          <div className="kpi">
            <div className="lbl">Radon sets out</div>
            <div className="val mono">{week.radonSets.out}</div>
            <div className="meta">
              {t.radonJobs} job{t.radonJobs === 1 ? '' : 's'} this week carry radon
            </div>
          </div>
          <div className={`kpi ${past || t.unassigned ? 'attn' : ''}`}>
            <div className="lbl">Needs you</div>
            <div className="val mono">{past + (d.pendingFieldSubmissions || 0) + t.unassigned}</div>
            <div className="meta">
              {[past && `${past} past due`,
                d.pendingFieldSubmissions && `${d.pendingFieldSubmissions} to review`,
                t.unassigned && `${t.unassigned} unassigned`]
                .filter(Boolean).join(' · ') || 'nothing waiting'}
            </div>
          </div>
        </div>
      )}

      {week && <WeekBoard board={week} onOpen={(s) => s.url && window.open(s.url, '_blank')} />}
      {week === false && (
        <div className="note">The week could not be loaded. Everything below still works.</div>
      )}

      <div className="headline">
        <Status
          tone={past ? 'red' : 'green'} icon={past ? 'alert' : 'check'}
          big={past ? `${plural(past, 'thing is', 'things are')} past due` : 'Nothing is past due'}
          small={past ? 'Take care of these today.' : 'You are caught up. Nice.'}
          onClick={() => go('attention')}
        />
        <Status
          tone={soon ? 'amber' : 'green'} icon="clock"
          big={soon ? `${plural(soon, 'thing', 'things')} due in 30 days` : 'Nothing due this month'}
          small="Renewals, inspections and calibrations."
          onClick={() => go('attention')}
        />
        <Status
          tone={blocked.length ? 'red' : 'green'} icon="badge"
          big={blocked.length ? `${firstNames(blocked)} can't work` : 'Everyone can work today'}
          small={blocked.length
            ? blocked[0].licenses_expired ? 'An expired license is the holdup.' : 'An expired driver\u2019s license is the holdup.'
            : 'Licenses and driver\u2019s licenses are all current.'}
          onClick={() => go('records:employees')}
        />
      </div>

      {d.pendingFieldSubmissions > 0 && (
        <div className="note" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Icon name="inbox" size={19} />
          <span>
            {plural(d.pendingFieldSubmissions, 'form', 'forms')} came in from the phones and
            {d.pendingFieldSubmissions === 1 ? ' is' : ' are'} waiting on you.
          </span>
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => go('inbox')}>
            Take a look
          </button>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Handle these first</h2>
            <div className="sub">The soonest six of {open.length} dates being tracked.</div>
          </div>
          <button className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => go('attention')}>
            See all
          </button>
        </div>
        <div className="rows">
          {first.map((h) => (
            <button className="row" key={h.id} onClick={() => go('attention')}>
              <span className={`dot ${h.days_out < 0 ? 'red' : h.days_out <= 30 ? 'amber' : 'blue'}`} />
              <span className="main-text">
                <b>{h.title}</b>
                <span>{h.subject}</span>
              </span>
              <span className={`when ${h.days_out < 0 ? 'red' : h.days_out <= 30 ? 'amber' : ''}`}>
                <b>{whenText(h.days_out)}</b>
                <span>{date(h.due_date)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid c2">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Who can work today</h2>
              <div className="sub">License, driver&rsquo;s license and training status.</div>
            </div>
          </div>
          <div className="card-body" style={{ display: 'grid', gap: 18 }}>
            {d.readiness.map((r) => {
              const stuck = n(r.licenses_expired) > 0 || r.dl_expired;
              // Postgres hands numerics back as strings, so "0" is truthy and
              // 0 of 0 came out NaN \u2014 which is how somebody who owes no hours
              // at all ended up with a full red bar against their name.
              const need = Number(r.ceu_hours_required) || 0;
              const done = Number(r.ceu_hours_completed) || 0;
              const pct = need ? Math.min(100, Math.round((done / need) * 100)) : 0;
              return (
                <div key={r.employee_id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 7 }}>
                    <span style={{ fontWeight: 550 }}>{r.full_name}</span>
                    <span style={{ fontSize: 13.5, color: 'var(--text-3)' }}>{r.role}</span>
                    <span className={`pill ${stuck ? 'red' : 'green'}`} style={{ marginLeft: 'auto' }}>
                      {stuck ? (r.licenses_expired ? 'License expired' : 'Driver\u2019s license expired') : 'Good to go'}
                    </span>
                  </div>
                  {need > 0 && (
                    <>
                      {/* Progress, not an alarm. Whether somebody can work today
                          is the pill's job; this only says how far along they
                          are, so it stays in the brand colour either way. */}
                      <div className="bar">
                        <i style={{ width: `${pct}%`, background: 'var(--brand)' }} />
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 5 }}>
                        {num(done)} of {num(need)} training hours done this cycle
                        {done >= need && ' \u2014 all done'}
                      </div>
                    </>
                  )}
                  {need === 0 && (
                    <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
                      No training hours required this cycle
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2>Running low</h2>
              <div className="sub">At or below the point where you said to reorder.</div>
            </div>
            <button className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => go('records:supplies')}>
              Supplies
            </button>
          </div>
          {d.lowStock.length === 0 ? (
            <div className="empty" style={{ padding: '34px 20px' }}>
              <div className="ico"><Icon name="check" size={22} /></div>
              <p>Everything is stocked above its reorder point.</p>
            </div>
          ) : (
            <div className="rows">
              {d.lowStock.map((s) => (
                <button className="row" key={s.id} onClick={() => go('records:supplies')}>
                  <span className="dot red" />
                  <span className="main-text">
                    <b>{s.item_name}</b>
                    <span>Reorder at {num(s.reorder_point)}</span>
                  </span>
                  <span className="when red">
                    <b>{num(s.quantity_on_hand)} left</b>
                    <span>on hand</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

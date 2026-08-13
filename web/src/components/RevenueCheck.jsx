import { useState } from 'react';
import { api } from '../lib/api.js';
import { money, OFFICE_ZONE } from '../lib/format.js';

/**
 * Why doesn't the total match ISN's?
 *
 * A revenue figure that disagrees with the one the office already trusts puts
 * every other number in the app under suspicion. The cause is almost never
 * arithmetic — both sides are adding up real jobs, just not the same ones, or
 * the same ones on different days.
 *
 * So this does not argue with ISN. It totals the month every way the stored
 * orders allow and shows them side by side; whichever one lands on ISN's
 * figure is the answer, and it says so in a sentence. When nothing matches
 * exactly, the job list underneath is what a person can read against ISN's own
 * screen — one job at a time, which is where a single odd order shows up.
 */
export default function RevenueCheck() {
  const [target, setTarget] = useState('');
  const [period, setPeriod] = useState('month');
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      setOut(await api(`/isn/revenue-check?period=${period}&target=${encodeURIComponent(target.trim())}`));
    } catch (e) { setErr(e.message); setOut(null); }
    setBusy(false);
  };

  const day = (d) => (d ? new Date(`${d}T12:00:00Z`)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');

  return (
    <div className="setting" style={{ display: 'block' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <b>Why doesn’t the total match ISN?</b>
          <span>
            Put in the figure ISN is showing and this adds the same period up every way the
            orders allow. Whichever way produces ISN’s number is what ISN is counting — usually
            a different date or a different filter, not a wrong sum. Reads only what is already
            stored, so it costs no calls.
          </span>
        </div>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexShrink: 0 }}>
          <select className="input" style={{ width: 'auto' }} value={period}
                  onChange={(e) => setPeriod(e.target.value)}>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="quarter">Quarter</option>
            <option value="year">Year</option>
          </select>
          <input className="input mono" style={{ width: 130 }} placeholder="$49,331.00"
                 value={target} onChange={(e) => setTarget(e.target.value)}
                 onKeyDown={(e) => e.key === 'Enter' && run()} />
          <button className="btn" onClick={run} disabled={busy}>
            {busy ? <span className="spinner" /> : 'Compare'}
          </button>
        </span>
      </div>

      {err && <div className="banner" style={{ marginTop: 12 }}>{err}</div>}

      {out && (
        <div style={{ marginTop: 14 }}>
          <div className="rc-head">
            <span>The app shows <b className="mono">{money(out.app.amount)}</b> across {out.app.jobs} jobs.</span>
            {out.target != null && (
              <span>ISN shows <b className="mono">{money(out.target)}</b> — a difference of{' '}
                <b className="mono" style={{ color: out.difference ? 'var(--red)' : 'var(--green)' }}>
                  {out.difference > 0 ? '+' : ''}{money(out.difference)}</b>.</span>
            )}
          </div>

          {out.match ? (
            <div className="ok" style={{ marginTop: 10 }}>
              <b>{out.match.label}</b> comes to exactly ISN’s figure. {out.match.detail}{' '}
              That is the difference — both totals are right, they are answering different questions.
            </div>
          ) : out.target != null && (
            <div className="note" style={{ marginTop: 10 }}>
              No way of counting lands on ISN’s figure exactly, so this is not a rule — it is
              one or two particular jobs. The closest is <b>{out.nearest?.[0]?.label}</b>, still
              out by {money(out.nearest?.[0]?.off)}. Read the list below against ISN’s own and
              the odd one out will show.
            </div>
          )}

          <table className="data rc-table">
            <thead><tr><th>Counting it this way</th><th className="r">Jobs</th><th className="r">Total</th>
              {out.target != null && <th className="r">vs ISN</th>}</tr></thead>
            <tbody>
              {out.totals.map((t) => {
                const off = out.target == null || t.amount == null ? null : t.amount - out.target;
                return (
                  <tr key={t.key} className={t.key === 'app' ? 'rc-app' : undefined}>
                    <td>
                      <b>{t.label}</b>
                      <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                        {t.unavailable ? 'ISN does not send what this needs.' : t.detail}
                      </div>
                    </td>
                    <td className="r mono">{t.jobs ?? '—'}</td>
                    <td className="r mono">{t.amount == null ? '—' : money(t.amount)}</td>
                    {out.target != null && (
                      <td className="r mono" style={{ color: off === 0 ? 'var(--green)' : 'var(--text-3)' }}>
                        {off == null ? '—' : off === 0 ? 'exact' : `${off > 0 ? '+' : ''}${money(off)}`}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="rc-note">
            Last pulled from ISN {out.lastSyncAt
              ? new Date(out.lastSyncAt).toLocaleString('en-US',
                  { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: OFFICE_ZONE })
              : 'never'}. Anything changed in ISN since then is not in these numbers.
          </div>

          <button className="link-btn" style={{ marginTop: 10 }} onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'Hide the jobs' : `Show the ${out.lines.length} jobs the app counted`}
          </button>

          {showAll && (
            <div className="table-wrap" style={{ maxHeight: 340, marginTop: 8 }}>
              <table className="data rc-table">
                <thead><tr><th>Day</th><th>Order</th><th>Where</th>
                  <th>Status</th><th className="r">Fee</th><th className="r">Paid</th></tr></thead>
                <tbody>
                  {out.lines.map((l, i) => (
                    <tr key={`${l.orderNumber || i}`}>
                      <td className="mono">{day(l.day)}</td>
                      <td className="mono">{l.orderNumber || '—'}</td>
                      <td>{l.address || l.client || '—'}</td>
                      <td>{l.status}</td>
                      <td className="r mono">{money(l.amount)}</td>
                      <td className="r">{l.paid ? 'yes' : 'no'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

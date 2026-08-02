import { useState, useMemo } from 'react';
import { date, daysOut } from '../lib/format.js';

const CATS = [
  ['Licenses', 'var(--red)'],
  ['Vans', 'var(--blue)'],
  ['Equipment', 'var(--amber)'],
  ['Insurance', 'var(--violet)'],
  ['Software', 'var(--green)'],
  ['Supplies', '#2E8FA0'],
];

const HEIGHT = { Critical: 96, High: 72, Normal: 52, Low: 34 };

/**
 * Every dated obligation in the business on one rail: overdue to the left of
 * today, the next six months to the right. Height is priority, color is what
 * kind of thing it is. Nothing else on the dashboard needs to be read first.
 */
export default function Horizon({ items, onPick, days = 180 }) {
  const [tip, setTip] = useState(null);

  const { plotted, overdueCount, overdueWidth } = useMemo(() => {
    const open = items.filter((i) => !i.completed_date);
    const overdue = open.filter((i) => i.days_out < 0);
    const oldest = Math.min(-14, ...overdue.map((i) => i.days_out));
    const span = days - oldest;
    const zeroPct = ((0 - oldest) / span) * 100;
    return {
      overdueCount: overdue.length,
      overdueWidth: `${zeroPct}%`,
      zeroPct,
      plotted: open
        .filter((i) => i.days_out <= days)
        .map((i) => ({ ...i, x: ((i.days_out - oldest) / span) * 100 })),
      span,
      oldest,
    };
  }, [items, days]);

  const oldest = Math.min(-14, ...items.filter((i) => i.days_out < 0).map((i) => i.days_out));
  const span = days - oldest;
  const pos = (d) => ((d - oldest) / span) * 100;

  return (
    <div className="horizon">
      <div className="legend" style={{ padding: '0 0 10px' }}>
        {CATS.map(([c, col]) => (
          <span key={c}><i style={{ background: col }} />{c}</span>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--text-3)' }}>
          Taller bars matter more
        </span>
      </div>

      <div
        className="horizon-track"
        style={{ '--overdue-w': overdueWidth }}
        onMouseLeave={() => setTip(null)}
      >
        <div className="horizon-today" style={{ left: `${pos(0)}%` }} />
        {plotted.map((i) => (
          <button
            key={i.id}
            className={`tick cat-${i.category}`}
            style={{ left: `${i.x}%`, height: HEIGHT[i.priority] || 40 }}
            aria-label={`${i.title} — ${i.subject} — ${date(i.due_date)}`}
            onMouseEnter={(e) =>
              setTip({ i, x: e.clientX, y: e.currentTarget.getBoundingClientRect().top })
            }
            onFocus={(e) =>
              setTip({ i, x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().top })
            }
            onClick={() => onPick?.(i)}
          />
        ))}
      </div>

      <div className="horizon-axis">
        {[oldest, 0, 30, 60, 90, 120, 180].filter((d, idx, a) => a.indexOf(d) === idx && d <= days).map((d) => (
          <span key={d} className="mark" style={{ left: `${pos(d)}%` }}>
            {d < 0 ? `${Math.abs(d)} days late` : d === 0 ? '' : d < 60 ? `${d} days` : `${Math.round(d / 30)} months`}
          </span>
        ))}
      </div>

      {overdueCount > 0 && (
        <div style={{ marginTop: 16, fontSize: 14, color: 'var(--text-2)' }}>
          The <b style={{ color: 'var(--red)' }}>{overdueCount} past due</b> sit in the pink area to the
          left of today. Hover any bar to see what it is.
        </div>
      )}

      {tip && (
        <div className="tip" style={{ left: Math.min(tip.x + 12, window.innerWidth - 280), top: tip.y - 8 }}>
          <div className="t">{tip.i.title}</div>
          <div className="s">{tip.i.subject}</div>
          <div className="s" style={{ marginTop: 4 }}>
            {date(tip.i.due_date)} · {daysOut(tip.i.days_out)}
            {tip.i.responsible_name ? ` · ${tip.i.responsible_name}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

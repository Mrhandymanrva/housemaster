import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import Horizon from '../components/Horizon.jsx';
import Icon from '../components/Icons.jsx';
import { date, whenText, bucketOf, bucketTone } from '../lib/format.js';

const RANGES = [
  ['soon', 'Next 30 days'],
  ['past', 'Past due'],
  ['all', 'Everything'],
];

const BUCKETS = ['Past due', 'This week', 'This month', 'Later on'];

const BLURB = {
  'Past due': 'These dates have already gone by.',
  'This week': 'Coming up in the next seven days.',
  'This month': 'Still a few weeks out.',
  'Later on': 'Nothing to do yet — just so you know it is coming.',
};

export default function Attention() {
  const [items, setItems] = useState(null);
  const [range, setRange] = useState('soon');
  const [kind, setKind] = useState('All');
  const [timeline, setTimeline] = useState(false);
  const [done, setDone] = useState(() => new Set());

  useEffect(() => { api('/ops/compliance?days=365').then((d) => setItems(d.items)); }, []);

  const kinds = useMemo(
    () => ['All', ...new Set((items || []).map((i) => i.category))], [items]
  );

  const clear = async (id) => {
    setDone((s) => new Set(s).add(id));
    try { await api(`/ops/compliance/${id}/clear`, { method: 'POST', body: {} }); } catch { /* demo */ }
  };

  if (!items) return <div className="empty"><div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…</div>;

  const shown = items.filter((i) => {
    if (done.has(i.id) || i.completed_date) return false;
    if (kind !== 'All' && i.category !== kind) return false;
    if (range === 'past') return i.days_out < 0;
    if (range === 'soon') return i.days_out <= 30;
    return true;
  });

  const grouped = BUCKETS
    .map((b) => [b, shown.filter((i) => bucketOf(i.days_out) === b)])
    .filter(([, list]) => list.length);

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="segmented">
          {RANGES.map(([k, label]) => (
            <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{label}</button>
          ))}
        </div>

        <select className="plain" value={kind} onChange={(e) => setKind(e.target.value)}>
          {kinds.map((c) => <option key={c} value={c}>{c === 'All' ? 'Everything' : c}</option>)}
        </select>

        <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => setTimeline((t) => !t)}>
          <Icon name="calendar" size={16} /> {timeline ? 'Hide timeline' : 'Show timeline'}
        </button>
      </div>

      {timeline && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>The next six months at a glance</h2>
              <div className="sub">Each bar is one item. Anything left of the line is already late.</div>
            </div>
          </div>
          <div className="card-body">
            <Horizon items={items.filter((i) => !done.has(i.id))} />
          </div>
        </div>
      )}

      {grouped.length === 0 && (
        <div className="card">
          <div className="empty">
            <div className="ico"><Icon name="check" size={24} /></div>
            <h3>Nothing here</h3>
            <p>Try a wider range at the top, or you really are all clear.</p>
          </div>
        </div>
      )}

      {grouped.map(([bucket, list]) => (
        <div className="card" key={bucket}>
          <div className="card-head">
            <div>
              <h2>{bucket} <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>· {list.length}</span></h2>
              <div className="sub">{BLURB[bucket]}</div>
            </div>
          </div>
          <div className="rows">
            {list.map((i) => (
              <div className="row" key={i.id} style={{ cursor: 'default' }}>
                <span className={`dot ${bucketTone(bucket)}`} />
                <span className="main-text">
                  <b>{i.title}</b>
                  <span>
                    {i.subject}
                    {i.responsible_name ? ` · ${i.responsible_name} handles this` : ''}
                  </span>
                </span>
                <span className={`when ${bucketTone(bucket) === 'red' ? 'red' : bucketTone(bucket) === 'amber' ? 'amber' : ''}`}>
                  <b>{whenText(i.days_out)}</b>
                  <span>{date(i.due_date)}</span>
                </span>
                <button className="btn sm" onClick={() => clear(i.id)} title="Mark this as taken care of">
                  <Icon name="check" size={15} /> Done
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

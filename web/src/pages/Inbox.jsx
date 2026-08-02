import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from '../components/Icons.jsx';

const when = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins} minutes ago`;
  if (mins < 1440) { const h = Math.round(mins / 60); return `${h} ${h === 1 ? 'hour' : 'hours'} ago`; }
  const d = Math.round(mins / 1440);
  return `${d} ${d === 1 ? 'day' : 'days'} ago`;
};

const label = (k) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const show = (v) => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));

export default function Inbox({ onCount }) {
  const [subs, setSubs] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    api('/ops/field/submissions?status=pending').then((d) => setSubs(d.submissions));
  }, []);

  const act = async (id, verb) => {
    setBusy(id);
    try { await api(`/ops/field/submissions/${id}/${verb}`, { method: 'POST', body: {} }); } catch { /* demo */ }
    setSubs((s) => {
      const next = s.filter((x) => x.id !== id);
      onCount?.(next.length);
      return next;
    });
    setBusy(null);
  };

  if (!subs) return <div className="empty"><div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…</div>;

  if (!subs.length) {
    return (
      <div className="card">
        <div className="empty">
          <div className="ico"><Icon name="check" size={24} /></div>
          <h3>Nothing waiting on you</h3>
          <p>When someone fills out a form on their phone that needs a second look, it shows up here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      {subs.map((s) => (
        <div className="card" key={s.id}>
          <div className="card-head">
            <div>
              <h2>{s.module_name}</h2>
              <div className="sub">{s.submitted_by_name} sent this {when(s.received_at)}</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              <button className="btn" disabled={busy === s.id} onClick={() => act(s.id, 'reject')}>
                Send it back
              </button>
              <button className="btn primary" disabled={busy === s.id} onClick={() => act(s.id, 'apply')}>
                <Icon name="check" size={17} /> Looks good — save it
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data">
              <tbody>
                {Object.entries(s.payload).map(([k, v]) => (
                  <tr key={k} style={{ cursor: 'default' }}>
                    <td style={{ width: 260 }}>{label(k)}</td>
                    <td style={{ color: 'var(--text)' }}>{show(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

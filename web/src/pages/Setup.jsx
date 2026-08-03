import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from '../components/Icons.jsx';

/* The choices behind every dropdown in the app, list by list. */
export default function Setup() {
  const [lists, setLists] = useState(null);
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  const [draft, setDraft] = useState({ label: '', sort: '' });

  useEffect(() => {
    api('/ops/lookup-lists')
      .then((d) => setLists(d.lists || []))
      .catch((e) => { setErr(e.message); setLists([]); });
  }, []);

  const replace = (key, values) =>
    setLists((ls) => ls.map((l) => (l.key === key ? { ...l, values } : l)));

  const run = async (id, fn) => {
    setBusy(id); setErr(null);
    try { await fn(); } catch (e) { setErr(e.message); }
    setBusy(null);
  };

  const patch = (list, v, body) =>
    run(v.id, async () => {
      const d = await api(`/ops/lookups/${v.id}`, { method: 'PATCH', body });
      replace(list.key, list.values.map((x) => (x.id === v.id ? d.value : x))
        .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label)));
    });

  const add = (list) =>
    run(`add:${list.key}`, async () => {
      const label = draft.label.trim();
      if (!label) throw new Error('Give the choice a name.');
      const highest = list.values.reduce((m, v) => Math.max(m, v.sort), 0);
      const d = await api('/ops/lookups', {
        method: 'POST',
        body: { list_key: list.key, value: label, label, sort: Number(draft.sort) || highest + 10 },
      });
      replace(list.key, [...list.values, { ...d.value, active: true }]
        .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label)));
      setDraft({ label: '', sort: '' });
    });

  if (!lists) return <div className="empty"><div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…</div>;

  return (
    <div className="stack">
      {err && <div className="banner">{err}</div>}

      <div className="note">
        These are the choices behind every dropdown in the app. Renaming one changes
        what people read; switching one off keeps it out of the dropdowns without
        disturbing records that already use it.
      </div>

      {lists.map((list) => {
        const live = list.values.filter((v) => v.active).length;
        const isOpen = open === list.key;
        return (
          <div className="card" key={list.key}>
            <div className="card-head" style={{ cursor: 'pointer' }}
                 role="button" tabIndex={0} aria-expanded={isOpen}
                 onKeyDown={(e) => {
                   if (e.key !== 'Enter' && e.key !== ' ') return;
                   e.preventDefault();
                   setOpen(isOpen ? null : list.key); setDraft({ label: '', sort: '' });
                 }}
                 onClick={() => { setOpen(isOpen ? null : list.key); setDraft({ label: '', sort: '' }); }}>
              <div>
                <h2>{list.label}</h2>
                <div className="sub">
                  {live} {live === 1 ? 'choice' : 'choices'}
                  {list.values.length > live ? ` · ${list.values.length - live} switched off` : ''}
                  {list.used_by?.length ? ` · used by ${list.used_by.join(', ')}` : ' · not on any screen yet'}
                </div>
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <Icon name={isOpen ? 'left' : 'right'} size={18} />
              </div>
            </div>

            {isOpen && (
              <>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Reads as</th>
                        <th style={{ width: 200 }}>Stored as</th>
                        <th style={{ width: 90 }}>Order</th>
                        <th style={{ width: 130 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.values.map((v) => (
                        <tr key={v.id} style={{ cursor: 'default', opacity: v.active ? 1 : 0.5 }}>
                          <td>
                            <input className="input" defaultValue={v.label} disabled={busy === v.id}
                                   onBlur={(e) => e.target.value.trim() && e.target.value !== v.label
                                     && patch(list, v, { label: e.target.value.trim() })} />
                          </td>
                          <td style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{v.value}</td>
                          <td>
                            <input className="input" type="number" defaultValue={v.sort} disabled={busy === v.id}
                                   onBlur={(e) => Number(e.target.value) !== v.sort
                                     && patch(list, v, { sort: Number(e.target.value) })} />
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn" disabled={busy === v.id}
                                    onClick={() => patch(list, v, { active: !v.active })}>
                              {v.active ? 'Switch off' : 'Switch on'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="card-body" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div className="field" style={{ margin: 0, minWidth: 240 }}>
                    <label htmlFor={`new-${list.key}`}>Add a choice</label>
                    <input id={`new-${list.key}`} className="input" value={draft.label}
                           placeholder="What people will read"
                           onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                           onKeyDown={(e) => e.key === 'Enter' && add(list)} />
                  </div>
                  <div className="field" style={{ margin: 0, width: 110 }}>
                    <label htmlFor={`sort-${list.key}`}>Order</label>
                    <input id={`sort-${list.key}`} className="input" type="number" value={draft.sort}
                           placeholder="last"
                           onChange={(e) => setDraft({ ...draft, sort: e.target.value })} />
                  </div>
                  <button className="btn primary" disabled={busy === `add:${list.key}`} onClick={() => add(list)}>
                    <Icon name="plus" size={17} /> Add it
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icons.jsx';
import { date } from '../lib/format.js';
import { singular } from '../lib/plain.js';

function Switch({ on, onChange, label }) {
  return (
    <button type="button" className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}
            role="switch" aria-checked={!!on} aria-label={label}><i /></button>
  );
}

const plural = (key = '') => key.replace(/_/g, ' ') || 'records';

function Control({ f, value, onChange, refs, currentLabel }) {
  const common = { className: `input ${f.format === 'mono' ? 'mono' : ''}`, id: f.column_name };
  switch (f.ui_control) {
    case 'readonly':
      return <div style={{ color: 'var(--text-2)', padding: '4px 0' }}>{date(value)}</div>;
    case 'textarea':
      return <textarea {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'toggle':
      return <Switch on={!!value} label={f.label} onChange={onChange} />;
    case 'date':
      return <input {...common} type="date" value={(value || '').slice(0, 10)} onChange={(e) => onChange(e.target.value)} />;
    case 'number': case 'integer': case 'currency':
      return <input {...common} type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose one…</option>
          {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'ref': {
      // What goes in the column is a record's id, so this has to be a choice
      // from a list. It used to be a text box that invited you to type a name
      // and then tried to save the name as the id.
      const choices = refs?.[f.ref_entity];
      if (!choices) {
        return <select {...common} disabled><option>Loading…</option></select>;
      }
      // An existing value whose record is not in the list would be silently
      // dropped on save, so it is carried along as its own option.
      const known = choices.some((o) => o.id === value);
      return (
        <select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">
            {choices.length ? 'Choose one…' : `No ${plural(f.ref_entity)} to choose from yet`}
          </option>
          {!known && value && <option value={value}>{currentLabel || 'Currently set'}</option>}
          {choices.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      );
    }
    default:
      return <input {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

export default function RecordDrawer({ entity, record, onClose, onSave, readOnly }) {
  const [draft, setDraft] = useState(record || {});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [refs, setRefs] = useState({});

  useEffect(() => setDraft(record || {}), [record]);

  // One fetch per referenced entity, not per field: an equipment record points
  // at both an employee and a vehicle, and a vehicle service record points at
  // the same vehicle list twice.
  useEffect(() => {
    const wanted = [...new Set(
      entity.fields.filter((f) => f.ui_control === 'ref' && f.ref_entity).map((f) => f.ref_entity)
    )];
    let dead = false;
    Promise.all(wanted.map((key) =>
      api(`/records/${key}/_options/list`)
        .then((d) => [key, d.options || []])
        .catch(() => [key, []])
    )).then((pairs) => { if (!dead) setRefs(Object.fromEntries(pairs)); });
    return () => { dead = true; };
  }, [entity.key]);
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const sections = {};
  for (const f of entity.fields) (sections[f.form_section] ||= []).push(f);
  const isNew = !record?.id;
  const title = record?.[entity.title_column] || `New ${singular(entity)}`;
  const dirty = JSON.stringify(draft) !== JSON.stringify(record || {});

  const save = async () => {
    setSaving(true); setErr(null);
    try { await onSave(draft); } catch (e) { setErr(e.message); } finally { setSaving(false); }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={title}>
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <h2>{title}</h2>
            <div className="sub">
              {isNew ? 'Fill in what you know. You can always come back and finish it.'
                     : 'Change anything and hit save.'}
            </div>
          </div>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <Icon name="x" size={19} />
          </button>
        </div>

        <div className="drawer-body">
          {err && <div className="banner" style={{ marginTop: 14 }}>{err}</div>}
          {Object.entries(sections).map(([name, fields]) => (
            <div key={name}>
              <div className="section-label">{name}</div>
              {fields.sort((a, b) => a.form_order - b.form_order).map((f) => (
                <div key={f.column_name} className="field">
                  <label htmlFor={f.column_name}>
                    {f.label}{f.required && <span className="opt"> — needed</span>}
                  </label>
                  <Control f={f} value={draft[f.column_name]} refs={refs}
                           currentLabel={record?.[`${f.column_name}__label`]}
                           onChange={(v) => setDraft((d) => ({ ...d, [f.column_name]: v }))} />
                  {f.help && <div className="help">{f.help}</div>}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="drawer-foot">
          <button className="btn primary" onClick={save} disabled={saving || !dirty || readOnly}>
            {saving ? <span className="spinner" /> : <Icon name="check" size={17} />}
            {isNew ? 'Add it' : 'Save changes'}
          </button>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          {!dirty && !isNew && (
            <span style={{ marginLeft: 'auto', fontSize: 13.5, color: 'var(--text-3)' }}>
              Nothing changed yet
            </span>
          )}
        </div>
      </aside>
    </>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icons.jsx';
import { plainName, singular } from '../lib/plain.js';

/**
 * Loading a list in from a spreadsheet.
 *
 * Building the list in Excel is the part the office is already good at, so
 * this takes over at the paste and does nothing before it — no file to export,
 * no template to download and fill in the right order.
 *
 * The screen it lands on is the preview, not a progress bar. Every row shows
 * what it would do before anything is written, because the alternative is
 * finding out afterwards, one wrong record at a time, with no way to tell
 * which of forty rows was the one that went in twice.
 *
 * Nothing is parsed here. The paste goes to the server as typed and comes back
 * as a plan, which means the preview and the import are the same reading of
 * the same text rather than two readings that agree until they do not.
 */
export default function ImportDrawer({ entity, onClose, onDone }) {
  const [text, setText] = useState('');
  const [plan, setPlan] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [matchOn, setMatchOn] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);

  const fields = entity.fields.filter(
    (f) => f.ui_control !== 'readonly'
      && !['id', 'created_at', 'updated_at'].includes(f.column_name)
  );
  const label = (col) => fields.find((f) => f.column_name === col)?.label || col;

  const post = useCallback(async (body) => {
    const d = await api(`/records/${entity.key}/import`, {
      method: 'POST', body: { text, ...body },
    });
    setPlan(d);
    setMapping(d.mapping);
    return d;
  }, [entity.key, text]);

  /** First look: the server matches headings to fields and says what it found. */
  const read = async () => {
    setBusy(true); setErr(null);
    try {
      const d = await post({});
      // Matching on the column that names the record is what people mean by
      // "load this again with the new numbers in it". Off when that column is
      // not in the paste, since then there is nothing to recognise rows by.
      const titled = d.mapping.includes(entity.title_column) ? entity.title_column : null;
      setMatchOn(titled);
      if (titled) await post({ mapping: d.mapping, matchOn: titled });
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  /** Any change to how the columns line up re-reads the whole paste. */
  const replan = async (nextMapping, nextMatch) => {
    setBusy(true); setErr(null);
    try { await post({ mapping: nextMapping, matchOn: nextMatch }); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const changeColumn = (i, col) => {
    const next = mapping.map((m, j) => {
      if (j === i) return col || null;
      return col && m === col ? null : m;   // a field can only be filled once
    });
    setMapping(next);
    const stillMatched = col === matchOn || next.includes(matchOn) ? matchOn : null;
    if (stillMatched !== matchOn) setMatchOn(stillMatched);
    replan(next, stillMatched);
  };

  const commit = async () => {
    setBusy(true); setErr(null);
    try {
      const d = await api(`/records/${entity.key}/import`, {
        method: 'POST', body: { text, mapping, matchOn, commit: true },
      });
      setDone(d.committed);
      onDone?.();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const name = plainName(entity).toLowerCase();
  const blockedBy = plan && plan.missingRequired.length && plan.summary.create
    ? plan.missingRequired : null;
  const canCommit = plan && !plan.summary.problems && !blockedBy && plan.summary.total > 0;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer wide" role="dialog" aria-label={`Import ${name}`}>
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <h2>Import {name}</h2>
            <div className="sub">
              {done ? 'All done.'
                : plan ? 'Check what this would do. Nothing is saved until you say so.'
                : 'Build the list in a spreadsheet, then copy and paste it here.'}
            </div>
          </div>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <Icon name="x" size={19} />
          </button>
        </div>

        <div className="drawer-body">
          {err && <div className="banner" style={{ marginTop: 14 }}>{err}</div>}

          {done ? (
            <Finished done={done} name={name} />
          ) : !plan ? (
            <Paste entity={entity} fields={fields} text={text} setText={setText} />
          ) : (
            <>
              <Summary plan={plan} name={name} />

              {blockedBy && (
                <div className="banner" style={{ marginBottom: 16 }}>
                  Nothing in the paste is the {blockedBy.join(' or the ').toLowerCase()}, and every
                  new {singular(entity).toLowerCase()} needs one. Point a column at it below.
                </div>
              )}

              <div className="section-label">Which column is which</div>
              <div className="map-grid">
                {plan.header.map((h, i) => (
                  <div key={i} className="map-col">
                    <div className="map-head" title={h}>{h || <em>no heading</em>}</div>
                    <select className="input" value={mapping?.[i] || ''}
                            onChange={(e) => changeColumn(i, e.target.value)}>
                      <option value="">Skip this column</option>
                      {fields.map((f) => (
                        <option key={f.column_name} value={f.column_name}>
                          {f.label}{f.required ? ' — needed' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="section-label">Rows that are already here</div>
              <div className="field">
                <select className="input" value={matchOn || ''}
                        onChange={(e) => { setMatchOn(e.target.value || null); replan(mapping, e.target.value || null); }}>
                  <option value="">Add every row as a new {singular(entity).toLowerCase()}</option>
                  {mapping?.filter(Boolean).map((col) => (
                    <option key={col} value={col}>Update the one with the same {label(col)}</option>
                  ))}
                </select>
                <div className="help">
                  {matchOn
                    ? `A row whose ${label(matchOn)} is already on file updates that record instead of adding a second one. Blank cells are left as they are.`
                    : 'Nothing will be matched up, so pasting the same list twice gives you two of everything.'}
                </div>
              </div>

              <div className="section-label">What this would do</div>
              <Preview plan={plan} mapping={mapping} label={label} />
            </>
          )}
        </div>

        <div className="drawer-foot">
          {done ? (
            <button className="btn primary" onClick={onClose}>Close</button>
          ) : !plan ? (
            <>
              <button className="btn primary" onClick={read} disabled={busy || !text.trim()}>
                {busy ? <span className="spinner" /> : <Icon name="check" size={17} />}
                Read the paste
              </button>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
            </>
          ) : (
            <>
              <button className="btn primary" onClick={commit} disabled={busy || !canCommit}>
                {busy ? <span className="spinner" /> : <Icon name="check" size={17} />}
                {plan.summary.update
                  ? `Add ${plan.summary.create} and update ${plan.summary.update}`
                  : `Add ${plan.summary.create} ${plan.summary.create === 1 ? singular(entity).toLowerCase() : name}`}
              </button>
              <button className="btn ghost" onClick={() => { setPlan(null); setDone(null); setErr(null); }}>
                Back to the paste
              </button>
              {plan.summary.problems > 0 && (
                <span style={{ marginLeft: 'auto', fontSize: 13.5, color: 'var(--red)' }}>
                  Fix the {plan.summary.problems} flagged {plan.summary.problems === 1 ? 'row' : 'rows'} in
                  your spreadsheet and paste again.
                </span>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function Paste({ entity, fields, text, setText }) {
  const wanted = fields.filter((f) => f.required).map((f) => f.label);
  return (
    <>
      <p style={{ color: 'var(--text-2)', fontSize: 14.5, marginTop: 14 }}>
        Include the heading row — that is how the columns get matched up. Headings
        that do not match anything are skipped, and you can point them at the right
        field on the next screen.
      </p>
      <textarea className="input mono paste-box" value={text} spellCheck={false}
                onChange={(e) => setText(e.target.value)}
                placeholder={placeholder(entity, fields)} />
      <div className="help" style={{ marginTop: 8 }}>
        {wanted.length
          ? <>Every row needs {wanted.join(' and ')}. Dates are read month first, so 3/9/2026 is March.</>
          : <>Dates are read month first, so 3/9/2026 is March.</>}
      </div>
    </>
  );
}

/** A sample built from this screen's own columns, not a generic one. */
function placeholder(entity, fields) {
  const cols = fields.slice(0, 4);
  const sample = { text: 'Some text', integer: '2021', number: '4', currency: '32450',
    date: '3/9/2026', toggle: 'yes', select: cols[0]?.options?.[0]?.label || 'Choose one',
    ref: 'A name from that list', email: 'name@example.com' };
  const head = cols.map((f) => f.label).join('\t');
  const row = cols.map((f) => f.options?.[0]?.label || sample[f.ui_control] || 'Some text').join('\t');
  return `${head}\n${row}\n…`;
}

function Summary({ plan, name }) {
  const { create, update, problems, total } = plan.summary;
  return (
    <div className="import-summary">
      <span className="pill green">{create} new</span>
      {update > 0 && <span className="pill steel">{update} updated</span>}
      {problems > 0 && <span className="pill red">{problems} to fix</span>}
      <span style={{ color: 'var(--text-3)', fontSize: 13.5 }}>
        {total} {total === 1 ? 'row' : 'rows'} read from your paste
      </span>
    </div>
  );
}

const BADGE = { create: ['green', 'New'], update: ['steel', 'Update'], problem: ['red', 'Fix'] };

/**
 * Problem rows first. On a forty-row paste the two that need attention are
 * what the office came here to see, and making them scroll for those is how
 * somebody imports anyway and sorts it out later.
 */
function Preview({ plan, mapping, label }) {
  const cols = (mapping || []).filter(Boolean);
  const order = [...plan.rows].sort((a, b) =>
    (a.action === 'problem' ? 0 : 1) - (b.action === 'problem' ? 0 : 1) || a.line - b.line);
  const shown = order.slice(0, 60);

  return (
    <div className="import-preview">
      <table className="data">
        <thead>
          <tr>
            <th style={{ width: 44 }}>Row</th>
            <th style={{ width: 78 }} />
            {cols.map((c) => <th key={c}>{label(c)}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const [tone, word] = BADGE[r.action];
            const bad = new Set(r.errors.map((e) => e.column));
            return [
              <tr key={r.line} className={r.action === 'problem' ? 'row-bad' : undefined}>
                <td className="mono" style={{ color: 'var(--text-3)' }}>{r.line}</td>
                <td><span className={`pill ${tone}`}>{word}</span></td>
                {cols.map((c) => (
                  <td key={c} className={bad.has(c) ? 'cell-bad' : undefined}>
                    {r.display[c] || <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </td>
                ))}
              </tr>,
              r.errors.length ? (
                <tr key={`${r.line}-why`} className="row-why">
                  <td />
                  <td colSpan={cols.length + 1}>
                    {r.errors.map((e, i) => (
                      <div key={i}><b>{e.label}:</b> {e.message}</div>
                    ))}
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
      {order.length > shown.length && (
        <div className="card-foot" style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
          Showing {shown.length} of {order.length} rows. Everything flagged is in the list above.
        </div>
      )}
    </div>
  );
}

function Finished({ done, name }) {
  return (
    <div style={{ padding: '40px 0', textAlign: 'center' }}>
      <div className="pill green" style={{ fontSize: 15, padding: '8px 14px' }}>
        {done.created} added{done.updated ? `, ${done.updated} updated` : ''}
      </div>
      <p style={{ color: 'var(--text-2)', marginTop: 16, fontSize: 14.5 }}>
        They are in {name} now. Anything you left blank can be filled in from the
        record itself, or by pasting again and matching on the same column.
      </p>
    </div>
  );
}

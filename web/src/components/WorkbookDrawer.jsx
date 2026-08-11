import { useEffect, useRef, useState } from 'react';
import { api, getToken } from '../lib/api.js';
import Icon from './Icons.jsx';

/**
 * The whole thing, out and back.
 *
 * Loading a franchise a screen at a time meant a dozen separate pastes in an
 * order the office had to work out for itself, because a van cannot name a
 * driver who does not exist yet. One workbook: every screen is a sheet, it
 * goes home on a laptop, and the ordering is sorted out at the other end.
 *
 * It is the same import engine underneath — the one the paste box uses — so a
 * date, a dropdown choice or a missing required field behaves the same
 * whichever way it arrived. What is different is what a preview has to show:
 * not one table but every sheet at once, because the answer to "what will this
 * do" is now spread across all of them.
 */
export default function WorkbookDrawer({ onClose, onDone }) {
  const [file, setFile] = useState(null);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);
  const [open, setOpen] = useState({});
  const picker = useRef(null);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  /* The workbook is a file, not JSON, so it comes down through fetch rather
     than the api helper — but with the same token, since the route is not open. */
  const download = async () => {
    setBusy('download'); setErr(null);
    try {
      const res = await fetch('/api/records/workbook', {
        headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not build it.');
      const blob = await res.blob();
      const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1]
        || 'housemaster-records.xlsx';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(e.message); }
    setBusy(null);
  };

  const read = (f) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.readAsDataURL(f);
  });

  const check = async (f) => {
    setBusy('check'); setErr(null); setPlan(null); setDone(null);
    try {
      const body = { file: await read(f) };
      setPlan(await api('/records/workbook', { method: 'POST', body }));
      setFile({ name: f.name, body: body.file });
    } catch (e) { setErr(e.message); }
    setBusy(null);
  };

  const commit = async () => {
    setBusy('commit'); setErr(null);
    try {
      const d = await api('/records/workbook', { method: 'POST', body: { file: file.body, commit: true } });
      setDone(d.committed);
      onDone?.();
    } catch (e) { setErr(e.message); }
    setBusy(null);
  };

  const blocked = plan?.sheets.find((s) => s.missingRequired.length && s.summary.create);
  const canCommit = plan && !plan.totals.problems && !blocked
    && (plan.totals.create || plan.totals.update);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer wide" role="dialog" aria-label="Everything in one workbook">
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <h2>Everything in one workbook</h2>
            <div className="sub">
              {done ? 'All done.'
                : plan ? 'Check what this would do. Nothing is saved until you say so.'
                : 'One sheet per screen. Fill it in on a laptop, upload it back here.'}
            </div>
          </div>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <Icon name="x" size={19} />
          </button>
        </div>

        <div className="drawer-body">
          {err && <div className="banner" style={{ marginTop: 14 }}>{err}</div>}

          {done ? (
            <Finished done={done} />
          ) : !plan ? (
            <>
              <div className="section-label">Get the workbook</div>
              <p style={{ color: 'var(--text-2)', fontSize: 14.5, margin: '0 0 12px' }}>
                Comes down with everything already on file, one sheet per screen, with
                dropdowns on the columns that have a fixed set of answers. Every row
                carries its own id — leave those alone and the row updates; add rows at
                the bottom with the id blank and they are new.
              </p>
              <button className="btn" onClick={download} disabled={busy === 'download'}>
                {busy === 'download' ? <span className="spinner" /> : <Icon name="table" size={17} />}
                Download the workbook
              </button>

              <div className="section-label">Send it back</div>
              <p style={{ color: 'var(--text-2)', fontSize: 14.5, margin: '0 0 12px' }}>
                Sheets you did not touch change nothing. A van can name a driver you are
                adding on the Team sheet of the same file — whoever is pointed at gets
                written first.
              </p>
              <input ref={picker} type="file" hidden
                     accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                     onChange={(e) => e.target.files[0] && check(e.target.files[0])} />
              <button className="btn primary" onClick={() => picker.current.click()} disabled={busy === 'check'}>
                {busy === 'check' ? <span className="spinner" /> : <Icon name="inbox" size={17} />}
                Choose the filled-in workbook
              </button>
            </>
          ) : (
            <>
              <div className="import-summary">
                <span className="pill green">{plan.totals.create} new</span>
                {plan.totals.update > 0 && <span className="pill steel">{plan.totals.update} updated</span>}
                {plan.totals.problems > 0 && <span className="pill red">{plan.totals.problems} to fix</span>}
                <span style={{ color: 'var(--text-3)', fontSize: 13.5 }}>
                  across {plan.sheets.length} {plan.sheets.length === 1 ? 'sheet' : 'sheets'} of {file?.name}
                </span>
              </div>

              {blocked && (
                <div className="banner" style={{ margin: '14px 0 0' }}>
                  The {blocked.sheet} sheet has no {blocked.missingRequired.join(' or ')} column,
                  and new rows need one. Download a fresh workbook and copy your rows into it.
                </div>
              )}
              {plan.unknown.length > 0 && (
                <div className="note" style={{ margin: '14px 0 0' }}>
                  Skipped {plan.unknown.join(', ')} — {plan.unknown.length === 1 ? 'that sheet does' : 'those sheets do'} not
                  match a screen in the app.
                </div>
              )}

              <div className="section-label">Sheet by sheet</div>
              <p className="sub" style={{ margin: '-6px 0 12px', fontSize: 13.5, color: 'var(--text-3)' }}>
                In the order they will be written, so anything pointed at comes first.
              </p>
              {plan.sheets.map((s) => (
                <Sheet key={s.entity} s={s} open={!!open[s.entity]}
                       onToggle={() => setOpen((o) => ({ ...o, [s.entity]: !o[s.entity] }))} />
              ))}
              {plan.empty.length > 0 && (
                <p style={{ color: 'var(--text-3)', fontSize: 13.5, marginTop: 14 }}>
                  Untouched: {plan.empty.join(', ')}.
                </p>
              )}
            </>
          )}
        </div>

        <div className="drawer-foot">
          {done ? (
            <button className="btn primary" onClick={onClose}>Close</button>
          ) : plan ? (
            <>
              <button className="btn primary" onClick={commit} disabled={busy === 'commit' || !canCommit}>
                {busy === 'commit' ? <span className="spinner" /> : <Icon name="check" size={17} />}
                Save {plan.totals.create} new and {plan.totals.update} changed
              </button>
              <button className="btn ghost" onClick={() => { setPlan(null); setFile(null); setErr(null); }}>
                Choose a different file
              </button>
              {plan.totals.problems > 0 && (
                <span style={{ marginLeft: 'auto', fontSize: 13.5, color: 'var(--red)' }}>
                  Fix the flagged rows in the workbook and upload it again.
                </span>
              )}
            </>
          ) : (
            <button className="btn ghost" onClick={onClose}>Close</button>
          )}
        </div>
      </aside>
    </>
  );
}

const BADGE = { create: ['green', 'New'], update: ['steel', 'Update'], problem: ['red', 'Fix'] };

/**
 * A sheet folded shut unless it needs attention.
 *
 * Fifteen sheets expanded is a wall of table nobody reads. Anything with a
 * problem in it opens itself, because that is the one the office has to act on.
 */
function Sheet({ s, open, onToggle }) {
  const { create, update, problems, total } = s.summary;
  const show = open || problems > 0;
  const cols = [...new Set(s.rows.flatMap((r) => Object.keys(r.display || {})))].slice(0, 6);

  return (
    <div className="card" style={{ marginBottom: 10, borderColor: problems ? 'var(--red)' : undefined }}>
      <button className="sheet-head" onClick={onToggle}>
        <b>{s.sheet}</b>
        <span className="chips">
          {create > 0 && <span className="pill green">{create} new</span>}
          {update > 0 && <span className="pill steel">{update} updated</span>}
          {problems > 0 && <span className="pill red">{problems} to fix</span>}
          {!create && !update && !problems && <span className="pill">nothing to do</span>}
        </span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 13 }}>
          {total} {total === 1 ? 'row' : 'rows'} {show ? '⌄' : '›'}
        </span>
      </button>

      {show && (
        <div className="import-preview" style={{ borderRadius: 0, borderWidth: '1px 0 0' }}>
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 44 }}>Row</th>
                <th style={{ width: 78 }} />
                {cols.map((c) => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => {
                const [tone, word] = BADGE[r.action];
                const bad = new Set(r.errors.map((e) => e.column));
                return [
                  <tr key={r.line} className={r.action === 'problem' ? 'row-bad' : undefined}>
                    <td className="mono" style={{ color: 'var(--text-3)' }}>{r.line}</td>
                    <td><span className={`pill ${tone}`}>{word}</span></td>
                    {cols.map((c) => (
                      <td key={c} className={bad.has(c) ? 'cell-bad' : undefined}>
                        {r.display?.[c] || <span style={{ color: 'var(--text-3)' }}>—</span>}
                      </td>
                    ))}
                  </tr>,
                  r.errors.length ? (
                    <tr key={`${r.line}-why`} className="row-why">
                      <td />
                      <td colSpan={cols.length + 1}>
                        {r.errors.map((e, i) => <div key={i}><b>{e.label}:</b> {e.message}</div>)}
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
          {s.truncated && (
            <div className="card-foot" style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
              Showing the first {s.rows.length} rows. Everything flagged is in the list above.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Finished({ done }) {
  const total = done.reduce((a, d) => a + d.created + d.updated, 0);
  return (
    <div style={{ padding: '28px 0' }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <span className="pill green" style={{ fontSize: 15, padding: '8px 14px' }}>
          {total} {total === 1 ? 'record' : 'records'} written
        </span>
      </div>
      {done.filter((d) => d.created || d.updated).map((d) => (
        <div key={d.sheet} style={{ display: 'flex', gap: 10, padding: '8px 0',
                                    borderBottom: '1px solid var(--line)', fontSize: 14.5 }}>
          <b style={{ minWidth: 180 }}>{d.sheet}</b>
          <span style={{ color: 'var(--text-2)' }}>
            {[d.created && `${d.created} added`, d.updated && `${d.updated} updated`]
              .filter(Boolean).join(', ')}
          </span>
        </div>
      ))}
    </div>
  );
}

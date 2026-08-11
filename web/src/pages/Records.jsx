import { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api.js';
import DataTable from '../components/DataTable.jsx';
import RecordDrawer from '../components/RecordDrawer.jsx';
import ImportDrawer from '../components/ImportDrawer.jsx';
import Icon from '../components/Icons.jsx';
import { plainName, singular } from '../lib/plain.js';

/** Kept in step with NO_IMPORT in server/routes/records.js. */
const NO_IMPORT = new Set(['radon_custody_events', 'radon_deployments', 'inventory_transactions']);

export default function Records({ entity, openId = null, onOpened }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(null);
  const [wide, setWide] = useState(false);
  const [open, setOpen] = useState(null);
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search) qs.set('search', search);
      if (sort) qs.set('sort', sort);
      const d = await api(`/records/${entity.key}?${qs}`);
      setRows(d.rows); setTotal(d.total); setErr(null);
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }, [entity.key, search, sort]);

  useEffect(() => { setSearch(''); setSort(null); setWide(false); }, [entity.key]);

  // Arrived here from the command bar with a record in mind. Fetched by id
  // rather than hunted for in the list, which only holds the first fifty.
  useEffect(() => {
    if (!openId) return;
    let live = true;
    api(`/records/${entity.key}/${openId}`)
      .then((d) => { if (live) setOpen(d.record); })
      .catch((e) => setErr(e.message))
      .finally(() => onOpened?.());
    return () => { live = false; };
  }, [openId, entity.key]);
  useEffect(() => { const t = setTimeout(load, search ? 220 : 0); return () => clearTimeout(t); }, [load, search]);

  const toggleSort = (col) => setSort((s) => (s === `${col}:asc` ? `${col}:desc` : `${col}:asc`));

  const save = async (draft) => {
    const body = { ...draft };
    delete body.id; delete body.created_at; delete body.updated_at;
    if (draft.id) await api(`/records/${entity.key}/${draft.id}`, { method: 'PATCH', body });
    else await api(`/records/${entity.key}`, { method: 'POST', body });
    setOpen(null);
    load();
  };

  const hidden = entity.fields.filter((f) => f.show_in_list).length - 5;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={17} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
                 placeholder={`Search ${plainName(entity).toLowerCase()}`} />
        </div>
        <span style={{ fontSize: 14, color: 'var(--text-2)' }}>
          {loading ? '\u2026' : `${total} ${total === 1 ? 'record' : 'records'}`}
        </span>
        {/* Ledgers are written by the app as things happen; the server refuses
            to import them, so the button is not offered for them either. */}
        {!NO_IMPORT.has(entity.key) && (
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setImporting(true)}>
            <Icon name="table" size={17} /> Import from a spreadsheet
          </button>
        )}
        <button className="btn primary"
                style={NO_IMPORT.has(entity.key) ? { marginLeft: 'auto' } : undefined}
                onClick={() => setOpen({})}>
          <Icon name="plus" size={17} /> Add a {singular(entity)}
        </button>
      </div>

      {err && <div className="banner">{err}</div>}

      <div className="card">
        <DataTable entity={entity} rows={rows} loading={loading} maxCols={wide ? 99 : 5}
                   sort={sort} onSort={toggleSort} onOpen={setOpen}
                   emptyLabel={plainName(entity).toLowerCase()} addLabel={singular(entity)} />
        {hidden > 0 && rows.length > 0 && (
          <div className="card-foot" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
              {wide ? 'Showing every column.' : `${hidden} more ${hidden === 1 ? 'column is' : 'columns are'} hidden to keep this readable. Click any row to see everything.`}
            </span>
            <button className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => setWide((w) => !w)}>
              {wide ? 'Show fewer columns' : 'Show all columns'}
            </button>
          </div>
        )}
      </div>

      {open && (
        <RecordDrawer entity={entity} record={open.id ? open : null}
                      onClose={() => setOpen(null)} onSave={save} />
      )}

      {importing && (
        <ImportDrawer entity={entity} onDone={load} onClose={() => setImporting(false)} />
      )}
    </div>
  );
}

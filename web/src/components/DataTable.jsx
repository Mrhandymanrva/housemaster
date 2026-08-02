import Icon from './Icons.jsx';
import { money, num, date, phone, stateColor } from '../lib/format.js';

const Pill = ({ v }) => <span className={`pill ${stateColor(v)}`}>{v}</span>;

const STATUS_COLS = new Set(['status', 'state', 'condition', 'txn_type']);

export function cellValue(row, f) {
  const raw = f.ui_control === 'ref' ? row[`${f.column_name}__label`] ?? row[f.column_name] : row[f.column_name];
  if (raw == null || raw === '') return <span style={{ color: 'var(--text-3)' }}>—</span>;
  if (STATUS_COLS.has(f.column_name)) return <Pill v={raw} />;
  if (f.data_type === 'bool') return raw ? <span className="pill green">Yes</span> : <span className="pill">No</span>;
  switch (f.format) {
    case 'money': return money(raw);
    case 'mileage': return `${num(raw)} mi`;
    case 'phone': return phone(raw);
    case 'date': return date(raw);
    default: break;
  }
  if (f.data_type === 'date') return date(raw);
  if (f.data_type === 'number' || f.data_type === 'integer') return num(raw);
  return String(raw);
}

const cellClass = (f) =>
  f.format === 'mono' ? 'id'
  : ['money', 'mileage'].includes(f.format) || f.data_type === 'number' || f.data_type === 'integer' ? 'num'
  : '';

export default function DataTable({ entity, rows, loading, onOpen, sort, onSort, maxCols = 5, emptyLabel, addLabel }) {
  const cols = entity.fields
    .filter((f) => f.show_in_list)
    .sort((a, b) => a.list_order - b.list_order)
    .slice(0, maxCols);

  if (loading) {
    return <div className="empty"><div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…</div>;
  }
  if (!rows.length) {
    return (
      <div className="empty">
        <h3>Nothing here yet</h3>
        <p>Use the button above to add the first {addLabel || 'record'}.</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {cols.map((f) => (
              <th key={f.column_name} style={{ width: f.width || undefined }}
                  onClick={() => onSort?.(f.column_name)} title={`Sort by ${f.label}`}>
                {f.label}
                {sort?.startsWith(f.column_name) && (sort.endsWith('desc') ? ' ↓' : ' ↑')}
              </th>
            ))}
            <th style={{ width: 44 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} onClick={() => onOpen(row)}>
              {cols.map((f) => (
                <td key={f.column_name} className={cellClass(f)} style={{ maxWidth: f.width || 260 }}>
                  {cellValue(row, f)}
                </td>
              ))}
              <td style={{ color: 'var(--text-3)', textAlign: 'right' }}><Icon name="right" size={16} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

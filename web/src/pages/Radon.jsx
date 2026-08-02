import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from '../components/Icons.jsx';
import { date, num } from '../lib/format.js';

const when = (iso) => {
  if (!iso) return '—';
  const h = Math.round((Date.now() - new Date(iso)) / 3.6e6);
  if (h < 1) return 'just now';
  if (h < 48) return `${h} hours ago`;
  return `${Math.round(h / 24)} days ago`;
};

const clock = (iso) => (iso ? new Date(iso).toLocaleString('en-US', {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}) : '—');

/* A monitor's position in its cycle, small enough to sit in a table row. */
function Cycle({ position, interval }) {
  if (interval > 14) {
    return (
      <div className="cycle-bar" title={`${position} of ${interval}`}>
        <i style={{ width: `${(position / interval) * 100}%` }} />
      </div>
    );
  }
  return (
    <div className="cycle" aria-hidden="true">
      {Array.from({ length: interval }, (_, i) => (
        <i key={i} className={`${i + 1 < position ? 'on' : ''} ${i + 1 === position ? 'now' : ''} ${i + 1 === interval ? 'qa' : ''}`} />
      ))}
    </div>
  );
}

const VIEWS = [
  ['due', 'Needs a duplicate'],
  ['flagged', 'Flagged'],
  ['all', 'All monitors'],
];

function QualityChecks({ qa, interval, tolerance }) {
  const [view, setView] = useState('due');
  const [search, setSearch] = useState('');

  const due = qa.filter((d) => d.next_set_needs_duplicate);
  const flagged = qa.filter((d) => d.rpd_failures > 0);

  const base = view === 'due' ? due : view === 'flagged' ? flagged : qa;
  const rows = base
    .filter((d) => !search || `${d.name} ${d.serial_number} ${d.assigned_to || ''}`
      .toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) =>
      (b.next_set_needs_duplicate - a.next_set_needs_duplicate)
      || (b.rpd_failures - a.rpd_failures)
      || (b.next_set_number - a.next_set_number));

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Quality checks</h2>
          <div className="sub">
            Every {interval}th set on a monitor goes out as a pair, counted per monitor.
            {' '}{qa.length} monitors in service.
          </div>
        </div>
      </div>

      <div className="card-body" style={{ paddingBottom: 14 }}>
        <div className="toolbar">
          <div className="segmented">
            {VIEWS.map(([k, label]) => (
              <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>
                {label}
                {k === 'due' && due.length > 0 && <span className="seg-count">{due.length}</span>}
                {k === 'flagged' && flagged.length > 0 && <span className="seg-count">{flagged.length}</span>}
                {k === 'all' && <span className="seg-count">{qa.length}</span>}
              </button>
            ))}
          </div>
          <div className="search" style={{ width: 240, marginLeft: 'auto' }}>
            <Icon name="search" size={17} />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="Find a monitor" />
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty" style={{ padding: '34px 20px' }}>
          <div className="ico"><Icon name="check" size={22} /></div>
          <p>
            {view === 'due' ? 'No monitor is due for a duplicate on its next set.'
             : view === 'flagged' ? 'No pair has come back outside tolerance.'
             : 'No monitor matches that search.'}
          </p>
        </div>
      ) : (
        <div className="table-wrap scroll-cap">
          <table className="data">
            <thead>
              <tr>
                <th>Monitor</th>
                <th style={{ width: 150 }}>Carried by</th>
                <th style={{ width: 190 }}>Sets since last duplicate</th>
                <th style={{ width: 160 }}>Next set</th>
                <th style={{ width: 150 }}>Last duplicate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.equipment_id} style={{ cursor: 'default' }}>
                  <td>
                    <div>{d.name}</div>
                    <div className="mono" style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                      {d.serial_number}
                    </div>
                  </td>
                  <td>{d.assigned_to || '—'}</td>
                  <td>
                    <Cycle position={d.next_set_number} interval={interval} />
                    <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4 }}>
                      {d.sets_since_last} of {interval}
                    </div>
                  </td>
                  <td>
                    {d.next_set_needs_duplicate
                      ? <span className="pill red">Take two monitors</span>
                      : <span style={{ color: 'var(--text-2)' }}>
                          One monitor · #{d.next_set_number}
                        </span>}
                  </td>
                  <td>
                    {d.last_duplicate_at ? when(d.last_duplicate_at) : 'never'}
                    {d.rpd_failures > 0 && (
                      <span className="pill red" style={{ marginLeft: 8 }}>
                        {d.rpd_failures} off by &gt;{tolerance}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CustodyDrawer({ id, onClose }) {
  const [d, setD] = useState(null);
  useEffect(() => { api(`/radon/tests/${id}`).then(setD).catch(() => setD({ error: true })); }, [id]);
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Chain of custody">
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}>
            <h2>{d?.test?.property_address || 'Radon set'}</h2>
            <div className="sub">
              {d?.test ? `${d.test.test_number} · placed by ${d.test.inspector_name || 'unknown'}` : 'Loading…'}
            </div>
          </div>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="Close">
            <Icon name="x" size={19} />
          </button>
        </div>

        <div className="drawer-body">
          {!d && <div className="empty"><div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…</div>}

          {d?.test && (
            <>
              {d.test.qa_duplicate_required && (
                <div className="note" style={{ marginTop: 16 }}>
                  <b>Quality-check set.</b> {d.test.qa_reason}
                </div>
              )}

              <div className="section-label">What was placed</div>
              {d.devices.map((v) => (
                <div className="row" key={v.id} style={{ cursor: 'default', padding: '12px 0' }}>
                  <span className={`dot ${v.role === 'Duplicate' ? 'amber' : 'blue'}`} />
                  <span className="main-text">
                    <b>{v.equipment_name || v.canister_lot || v.device_serial}</b>
                    <span>
                      {v.role}{v.placement_room ? ` · ${v.placement_room}` : ''}
                      {v.placement_floor ? ` · ${v.placement_floor}` : ''}
                      {v.distance_inches ? ` · ${v.distance_inches}" apart` : ''}
                    </span>
                  </span>
                  <span className="when">
                    <b>{v.result_pci_l != null ? `${v.result_pci_l} pCi/L` : 'no reading yet'}</b>
                    <span className="mono">{v.tamper_seal_number || ''}</span>
                  </span>
                </div>
              ))}

              {d.test.rpd_pct != null && (
                <div className={`note ${d.test.rpd_within_tolerance ? '' : 'warn'}`} style={{ marginTop: 14 }}>
                  {d.test.rpd_within_tolerance
                    ? `The two readings are ${d.test.rpd_pct}% apart — inside tolerance, so the unit is reading true.`
                    : `The two readings are ${d.test.rpd_pct}% apart. That is wider than tolerance — get this unit checked before it goes back out.`}
                </div>
              )}

              <div className="section-label">Chain of custody</div>
              <div className="timeline">
                {d.custody.map((c) => (
                  <div className="tl" key={c.id}>
                    <div className="tl-dot" />
                    <div>
                      <b>{c.event_type}</b>
                      <div className="tl-meta">
                        {clock(c.occurred_at)}
                        {c.employee_name ? ` · ${c.employee_name}` : ''}
                        {c.party_name ? ` → ${c.party_name}` : ''}
                        {c.gps_lat ? ' · location recorded' : ''}
                      </div>
                      {c.notes && <div className="tl-note">{c.notes}</div>}
                    </div>
                  </div>
                ))}
                {!d.custody.length && <div className="faint">No custody entries yet.</div>}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function OutInField({ sets, onOpen }) {
  const [search, setSearch] = useState('');
  const [readyOnly, setReadyOnly] = useState(false);

  const isReady = (t) => t.hours_out != null && t.hours_out >= (t.min_hours || 48);
  const ready = sets.filter(isReady);

  const rows = sets
    .filter((t) => !readyOnly || isReady(t))
    .filter((t) => !search || `${t.property_address} ${t.inspector_name || ''} ${t.isn_order_id || ''} ${t.devices || ''}`
      .toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b.hours_out ?? -1) - (a.hours_out ?? -1));

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Out in the field</h2>
          <div className="sub">
            {sets.length} sets placed and not back yet
            {ready.length > 0 ? `, ${ready.length} ready to pick up now.` : '.'}
          </div>
        </div>
      </div>

      <div className="card-body" style={{ paddingBottom: 14 }}>
        <div className="toolbar">
          <div className="segmented">
            <button className={!readyOnly ? 'on' : ''} onClick={() => setReadyOnly(false)}>
              Everything <span className="seg-count">{sets.length}</span>
            </button>
            <button className={readyOnly ? 'on' : ''} onClick={() => setReadyOnly(true)}>
              Ready to pick up <span className="seg-count">{ready.length}</span>
            </button>
          </div>
          <div className="search" style={{ width: 240, marginLeft: 'auto' }}>
            <Icon name="search" size={17} />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="Address, tech or ISN order" />
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty" style={{ padding: '34px 20px' }}>
          <div className="ico"><Icon name="check" size={22} /></div>
          <p>Nothing here.</p>
        </div>
      ) : (
        <div className="table-wrap scroll-cap">
          <table className="data">
            <thead>
              <tr>
                <th>Property</th>
                <th style={{ width: 150 }}>Placed by</th>
                <th style={{ width: 200 }}>Monitor</th>
                <th style={{ width: 130 }}>Time out</th>
                <th style={{ width: 150 }}>Pickup</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} onClick={() => onOpen(t.id)}>
                  <td>
                    <div>{t.property_address}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                      {t.isn_order_id ? `ISN ${t.isn_order_id}` : t.test_number}
                    </div>
                  </td>
                  <td>{t.inspector_name || '—'}</td>
                  <td>
                    {t.devices || <span style={{ color: 'var(--text-3)' }}>not placed yet</span>}
                    {t.has_duplicate && <span className="pill amber" style={{ marginLeft: 8 }}>Pair</span>}
                  </td>
                  <td className="num">{t.hours_out != null ? `${num(t.hours_out)} hrs` : '—'}</td>
                  <td>
                    {t.hours_out == null
                      ? <span className="pill">Scheduled</span>
                      : isReady(t)
                        ? <span className="pill green">Ready now</span>
                        : <span style={{ color: 'var(--text-2)' }}>
                            in {Math.ceil((t.min_hours || 48) - t.hours_out)} hrs
                          </span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function Radon() {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => { api('/radon/board').then(setD).catch(() => setD({ error: true })); }, []);

  if (!d) return <div className="empty"><div className="spinner" style={{ margin: '0 auto 12px' }} />Loading…</div>;
  if (d.error) return <div className="banner">Could not load the radon board.</div>;

  const interval = d.rule?.duplicate_interval || 10;
  const dueNow = d.qa.filter((x) => x.next_set_needs_duplicate);
  const flagged = d.recent.filter((r) => r.rpd_within_tolerance === false);

  return (
    <div className="stack">
      {dueNow.length > 0 && (
        <div className="note warn" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Icon name="alert" size={20} />
          <span>
            <b>{dueNow.length} {dueNow.length === 1 ? 'monitor is' : 'monitors are'} due for a duplicate</b>
            {' — '}
            {dueNow.slice(0, 3).map((x) => x.name.replace('Radon CRM ', '')).join(', ')}
            {dueNow.length > 3 ? ` and ${dueNow.length - 3} more` : ''}.
            {' '}Whoever takes {dueNow.length === 1 ? 'it' : 'them'} out needs a second monitor.
          </span>
        </div>
      )}

      {(d.exceptions || []).length > 0 && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Needs a look</h2>
              <div className="sub">
                Sets that came in from a phone with no signal and turned out to owe a duplicate.
                The house was already tested, so the record is kept rather than thrown away —
                but it does not clear itself.
              </div>
            </div>
          </div>
          <div className="rows">
            {d.exceptions.map((x) => (
              <button className="row" key={x.id} onClick={() => setOpen(x.id)}>
                <span className="dot amber" />
                <span className="main-text">
                  <b>{x.property_address}</b>
                  <span>{x.qa_exception_reason}</span>
                </span>
                <span className="when amber">
                  <b>{x.monitor_name}</b>
                  <span>{x.inspector_name}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <QualityChecks qa={d.qa} interval={interval} tolerance={d.rule?.rpd_tolerance_pct || 36} />

      <OutInField sets={d.open} onOpen={setOpen} />

      {flagged.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Pairs that disagree</h2>
              <div className="sub">
                The duplicate came back more than {d.rule?.rpd_tolerance_pct || 36}% off the primary.
                Pull the unit and get it checked.
              </div>
            </div>
          </div>
          <div className="rows">
            {flagged.map((t) => (
              <button className="row" key={t.id} onClick={() => setOpen(t.id)}>
                <span className="dot red" />
                <span className="main-text">
                  <b>{t.property_address}</b>
                  <span>{t.result_pci_l} vs {t.duplicate_pci_l} pCi/L · {t.inspector_name}</span>
                </span>
                <span className="when red">
                  <b>{t.rpd_pct}% apart</b>
                  <span>tolerance {d.rule?.rpd_tolerance_pct || 36}%</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Recent results</h2>
            <div className="sub">
              {d.rule?.action_level_pci || 4} pCi/L and above is where mitigation gets recommended.
            </div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Property</th>
                <th style={{ width: 120 }}>Result</th>
                <th style={{ width: 130 }}>Duplicate</th>
                <th style={{ width: 150 }}>Status</th>
                <th style={{ width: 130 }}>Picked up</th>
              </tr>
            </thead>
            <tbody>
              {d.recent.map((t) => (
                <tr key={t.id} onClick={() => setOpen(t.id)}>
                  <td>{t.property_address}</td>
                  <td className="num">{t.result_pci_l != null ? `${t.result_pci_l} pCi/L` : '—'}</td>
                  <td className="num">
                    {t.duplicate_pci_l != null
                      ? `${t.duplicate_pci_l} pCi/L`
                      : <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </td>
                  <td>
                    {t.result_status === 'At or Above Action Level'
                      ? <span className="pill red">Mitigation advised</span>
                      : t.result_status === 'Below Action Level'
                        ? <span className="pill green">Below action level</span>
                        : <span className="pill">{t.status}</span>}
                  </td>
                  <td>{date(t.retrieved_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {open && <CustodyDrawer id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

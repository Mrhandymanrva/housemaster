import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icons.jsx';
import { plainName } from '../lib/plain.js';

/**
 * One box that gets you anywhere.
 *
 * Editing one van was Records, then the Vans and equipment group, then the
 * Vans tile, then the list, then the row — five moves for something you knew
 * the name of before you started. For an app with eighteen tables that people
 * touch all day, that was the single biggest tax on using it.
 *
 * It searches records as well as screens, and it does that without any new
 * server work: the catalog already declares which columns are searchable for
 * every entity, and the list endpoint already takes a search term. So this
 * fans out across the screens most likely to hold what you typed and merges
 * the answers — a couple of dozen lines riding on machinery that was already
 * there.
 */
const KEY = (e) => (e.key || '').toLowerCase();

/* Where a bare word most likely belongs. Searching all eighteen tables on
   every keystroke would be slow and mostly noise; these are the ones people
   look things up in. */
const LIKELY = ['employees', 'vehicles', 'equipment', 'supplies', 'vendors', 'licenses'];

export default function CommandBar({ entities, go, canSeeMoney }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState(0);
  const input = useRef(null);
  const round = useRef(0);

  // Cmd-K, Ctrl-K, or / — the two conventions people already have in their
  // hands. `/` is ignored while typing, or it would swallow the character.
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && KEY(e) === 'k') { e.preventDefault(); setOpen((o) => !o); return; }
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setOpen(true); return; }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) { setTerm(''); setHits([]); setAt(0); setTimeout(() => input.current?.focus(), 10); }
  }, [open]);

  // Screens first and instantly: they need no round trip, and half of what
  // anybody types here is the name of a screen.
  const screens = [
    ...entities.map((e) => ({ kind: 'screen', key: e.key, label: plainName(e), route: `records:${e.key}` })),
    { kind: 'screen', key: 'home', label: 'Home', route: 'home' },
    { kind: 'screen', key: 'attention', label: 'Needs attention', route: 'attention' },
    { kind: 'screen', key: 'radon', label: 'Radon', route: 'radon' },
    { kind: 'screen', key: 'inbox', label: 'From the field', route: 'inbox' },
    { kind: 'screen', key: 'settings', label: 'Settings', route: 'settings' },
    ...(canSeeMoney ? [{ kind: 'screen', key: 'money', label: 'Money', route: 'money' }] : []),
  ].filter((s) => !term || s.label.toLowerCase().includes(term.toLowerCase()));

  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) { setHits([]); setBusy(false); return undefined; }

    // Late answers from a term you have already typed past must not overwrite
    // the current ones, so each round is numbered and stale ones are dropped.
    const mine = ++round.current;
    setBusy(true);
    const timer = setTimeout(async () => {
      const targets = entities.filter((e) => LIKELY.includes(e.key) && e.search_columns?.length);
      const results = await Promise.all(targets.map(async (e) => {
        try {
          const d = await api(`/records/${e.key}?search=${encodeURIComponent(q)}&limit=5`);
          return d.rows.map((row) => ({
            kind: 'record', entity: e, id: row.id,
            label: row[e.title_column] || '(no name)',
            hint: subtitle(e, row),
          }));
        } catch { return []; }
      }));
      if (mine !== round.current) return;
      setHits(results.flat());
      setBusy(false);
    }, 180);
    return () => clearTimeout(timer);
  }, [term, entities]);

  const rows = [...screens.slice(0, 6), ...hits];
  const pick = (row) => {
    setOpen(false);
    if (row.kind === 'screen') go(row.route);
    else go(`records:${row.entity.key}`, row.id);
  };

  if (!open) return null;

  return (
    <div className="cmd-scrim" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="cmd" role="dialog" aria-label="Find anything">
        <div className="cmd-input">
          <Icon name="search" size={18} />
          <input ref={input} value={term} placeholder="Find a screen, a van, a person, a serial number…"
                 onChange={(e) => { setTerm(e.target.value); setAt(0); }}
                 onKeyDown={(e) => {
                   if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(i + 1, rows.length - 1)); }
                   if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
                   if (e.key === 'Enter' && rows[at]) { e.preventDefault(); pick(rows[at]); }
                 }} />
          <kbd>esc</kbd>
        </div>

        <div className="cmd-list">
          {rows.map((row, i) => (
            <button key={`${row.kind}-${row.entity?.key || row.key}-${row.id || ''}`}
                    className={`cmd-row ${i === at ? 'on' : ''}`}
                    onMouseEnter={() => setAt(i)} onClick={() => pick(row)}>
              <Icon name={row.kind === 'screen' ? 'right' : (row.entity.icon || 'table')} size={16} />
              <span className="cmd-label">{row.label}</span>
              <span className="cmd-hint">{row.kind === 'screen' ? 'Screen' : row.hint || plainName(row.entity)}</span>
            </button>
          ))}
          {busy && <div className="cmd-note">Looking…</div>}
          {!busy && term.trim().length >= 2 && !rows.length && (
            <div className="cmd-note">Nothing matching “{term.trim()}”.</div>
          )}
          {!term && <div className="cmd-note">Type to search. ↑↓ to move, ↵ to open.</div>}
        </div>
      </div>
    </div>
  );
}

/** Enough of the row to tell two similar ones apart. */
function subtitle(entity, row) {
  const cols = (entity.search_columns || []).filter((c) => c !== entity.title_column);
  const bits = cols.map((c) => row[c]).filter(Boolean).slice(0, 2);
  return bits.length ? bits.join(' · ') : plainName(entity);
}

/**
 * Reading a pasted spreadsheet into records.
 *
 * The thing being defended against is a bad import that looks like a good one.
 * Forty rows go in, thirty-eight land, and nobody notices the two that did not
 * until an inspector cannot find a monitor. So nothing here half-succeeds: the
 * whole paste is worked out first, shown, and only then written, all of it or
 * none of it.
 *
 * Every value is checked against the same catalog the record form uses, which
 * is what stops an import writing things the app itself would refuse — a
 * status the dropdown has never heard of, a driver who is not on the team, a
 * date that is really a mileage.
 *
 * No database access in here. The caller hands in what was looked up, so this
 * can be tested against a table of awkward spreadsheets rather than a server.
 */

/** A column that exists to be written, as opposed to one the app maintains. */
export const importable = (f) =>
  f.ui_control !== 'readonly' &&
  !['id', 'created_at', 'updated_at', 'created_by', 'updated_by'].includes(f.column_name);

/**
 * How two pieces of text are decided to be the same thing.
 *
 * "Unit 12", "unit-12" and "UNIT 12" are one van. Exported because the caller
 * builds the name-to-id indexes this compares against, and an index keyed one
 * way against lookups done another way silently matches nothing.
 */
export const matchKey = (s) =>
  String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const norm = matchKey;

/**
 * Match pasted headings to fields, so the common case needs no mapping at all.
 *
 * Both the label and the column name are tried, punctuation and case ignored,
 * because a heading is as likely to say "Unit #" as "unit_number". A heading
 * that matches nothing is left unmapped rather than guessed at — a wrong guess
 * that silently writes the wrong column is worse than an unmapped one, which
 * is visible and takes one click to fix.
 */
export function guessMapping(header, fields) {
  const usable = fields.filter(importable);
  const byLabel = new Map();
  for (const f of usable) {
    byLabel.set(norm(f.label), f.column_name);
    if (!byLabel.has(norm(f.column_name))) byLabel.set(norm(f.column_name), f.column_name);
  }
  const taken = new Set();
  return header.map((h) => {
    const hit = byLabel.get(norm(h));
    if (!hit || taken.has(hit)) return null;   // never map two columns to one field
    taken.add(hit);
    return hit;
  });
}

// ------------------------------------------------------------------ values

const TRUE = ['yes', 'y', 'true', 't', '1', 'x', '✓', 'on'];
const FALSE = ['no', 'n', 'false', 'f', '0', '', 'off'];

/**
 * Dates as a spreadsheet writes them.
 *
 * US month-first, because that is what this office types and what Excel gives
 * on a US locale. Read the other way round, 03/04/2026 lands nine months out
 * and nothing about the record looks wrong afterwards — so anything that could
 * be either is still read month-first, and the header on the preview says so.
 */
function toDate(raw) {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return check(+m[1], +m[2], +m[3], s);

  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (m) {
    let year = +m[3];
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return check(year, +m[1], +m[2], s);
  }

  // "Jan 5, 2026" and "5 Jan 2026" — Date.parse is left out of it deliberately,
  // since it accepts things like "cat 3" on some runtimes.
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  m = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (m) {
    const mon = MON.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mon >= 0) return check(+m[3], mon + 1, +m[2], s);
  }
  m = s.match(/^(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})$/i);
  if (m) {
    const mon = MON.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mon >= 0) return check(+m[3], mon + 1, +m[1], s);
  }

  return { error: `"${raw}" is not a date. Use 3/9/2026 or 2026-03-09.` };
}

/** Rejects 2/30 rather than letting it roll forward into March. */
function check(y, mo, d, raw) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return { error: `"${raw}" is not a real date.` };
  const at = new Date(Date.UTC(y, mo - 1, d));
  if (at.getUTCMonth() !== mo - 1 || at.getUTCDate() !== d) {
    return { error: `"${raw}" is not a real date.` };
  }
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { value: iso };
}

function toNumber(raw, { integer }) {
  // $1,250.00 and 12,500 mi both arrive from spreadsheets already formatted
  const s = raw.replace(/[$,\s]/g, '').replace(/\s*(mi|miles|hrs|hours)$/i, '');
  if (!/^-?\d*\.?\d+$/.test(s)) return { error: `"${raw}" is not a number.` };
  const n = Number(s);
  if (!Number.isFinite(n)) return { error: `"${raw}" is not a number.` };
  if (integer && !Number.isInteger(n)) return { error: `"${raw}" has to be a whole number.` };
  return { value: n };
}

/**
 * One cell against one field. `ctx.refIndex` maps a referenced record's name to
 * its id; `field.options` are the choices behind a dropdown.
 */
export function coerceCell(field, raw, ctx = {}) {
  const s = String(raw ?? '').trim();
  if (s === '') return { value: null };

  switch (field.ui_control) {
    case 'toggle': {
      const v = s.toLowerCase();
      if (TRUE.includes(v)) return { value: true };
      if (FALSE.includes(v)) return { value: false };
      return { error: `"${raw}" is not a yes or a no.` };
    }
    case 'date':
      return toDate(s);
    case 'integer':
      return toNumber(s, { integer: true });
    case 'number':
    case 'currency':
      return toNumber(s, { integer: false });
    case 'select': {
      const opts = field.options || [];
      if (!opts.length) return { value: s };   // a list nobody has filled in yet
      const hit = opts.find((o) => norm(o.value) === norm(s) || norm(o.label) === norm(s));
      if (hit) return { value: hit.value };
      const shown = opts.slice(0, 6).map((o) => o.label).join(', ');
      return { error: `"${raw}" is not on the list. Choices are ${shown}${opts.length > 6 ? '…' : ''}.` };
    }
    case 'ref': {
      const index = ctx.refIndex?.[field.column_name];
      if (!index) return { error: 'This column cannot be matched up.' };
      const hit = index.get(norm(s));
      if (hit === AMBIGUOUS) {
        return { error: `More than one ${field.label.toLowerCase()} is called "${raw}".` };
      }
      if (!hit) return { error: `No ${field.label.toLowerCase()} called "${raw}" yet. Add it first.` };
      return { value: hit };
    }
    case 'email':
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return { error: `"${raw}" is not an email address.` };
      return { value: s };
    default:
      return { value: s };
  }
}

export const AMBIGUOUS = Symbol('more than one record with this name');

// ------------------------------------------------------------------- plan

/**
 * What the paste would do, row by row, without doing any of it.
 *
 * `existing` maps the match column's value to the id of the record already
 * holding it; that is what decides update against create. Without a match
 * column every row is a new record, which is right for a first load and wrong
 * for the second — so the caller offers one and the preview names it.
 */
export function planImport({ fields, header, rows, mapping, matchOn = null, refIndex = {}, existing = new Map() }) {
  const byColumn = new Map(fields.filter(importable).map((f) => [f.column_name, f]));

  // A mapping naming a column that is not importable is refused rather than
  // ignored: silently dropping it would import rows missing that data.
  const cleaned = mapping.map((m) => (m && byColumn.has(m) ? m : null));
  const mapped = cleaned.filter(Boolean);

  const matching = matchOn && mapped.includes(matchOn) ? matchOn : null;
  const missingRequired = fields
    .filter((f) => f.required && importable(f) && !mapped.includes(f.column_name))
    .map((f) => f.label);

  const seen = new Map();  // match value -> first line that used it
  const planned = rows.map((cells, i) => {
    const line = i + 2;    // 1 is the heading row, as the spreadsheet counts
    const values = {};
    const errors = [];
    const display = {};

    cleaned.forEach((col, c) => {
      if (!col) return;
      const field = byColumn.get(col);
      const raw = cells[c] ?? '';
      const out = coerceCell(field, raw, { refIndex });
      display[col] = raw;
      if (out.error) errors.push({ column: col, label: field.label, raw, message: out.error });
      else values[col] = out.value;
    });

    for (const f of fields) {
      if (!f.required || !importable(f)) continue;
      if (!mapped.includes(f.column_name)) continue;
      if (values[f.column_name] === null || values[f.column_name] === undefined) {
        if (!errors.some((e) => e.column === f.column_name)) {
          errors.push({ column: f.column_name, label: f.label, raw: '', message: `${f.label} cannot be blank.` });
        }
      }
    }

    let action = 'create';
    let matchId = null;
    if (matching) {
      const key = norm(values[matching]);
      if (key) {
        if (seen.has(key)) {
          errors.push({ column: matching, label: byColumn.get(matching).label, raw: display[matching],
            message: `Same as line ${seen.get(key)} — one of them would overwrite the other.` });
        } else {
          seen.set(key, line);
        }
        const hit = existing.get(key);
        if (hit) { action = 'update'; matchId = hit; }
      }
    }

    if (errors.length) action = 'problem';
    return { line, action, values, display, errors, matchId };
  });

  return {
    mapping: cleaned,
    matchOn: matching,
    missingRequired,
    rows: planned,
    summary: {
      total: planned.length,
      create: planned.filter((r) => r.action === 'create').length,
      update: planned.filter((r) => r.action === 'update').length,
      problems: planned.filter((r) => r.action === 'problem').length,
    },
  };
}

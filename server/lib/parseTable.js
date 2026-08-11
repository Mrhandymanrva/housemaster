/**
 * Turning a paste into rows.
 *
 * The office builds these lists in a spreadsheet, because that is where it is
 * easy to see forty vans at once and spot the one with no unit number. So the
 * import takes a paste rather than a file: select the block in Excel, copy,
 * paste. No exporting, no file picker, no "which of these three CSVs was the
 * good one".
 *
 * Copying out of Excel gives tab-separated text, and a saved CSV gives commas,
 * and somebody will paste one where the other was expected. Both are read
 * here, and the delimiter is worked out from the text rather than asked about.
 *
 * Parsing happens on the server rather than in the browser so the preview and
 * the commit read the same bytes through the same code. A parser on each side
 * is two parsers that will eventually disagree, and the failure mode of that
 * is the preview showing something the commit did not write.
 */

/**
 * Whichever candidate carves the text into the most consistent number of
 * columns wins. Counting occurrences alone picks comma every time an address
 * column is present — "Richmond, VA" is not two columns.
 */
export function sniffDelimiter(text) {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim()).slice(0, 20);
  if (!lines.length) return '\t';

  let best = { delimiter: '\t', score: -1 };
  for (const delimiter of ['\t', ',', ';', '|']) {
    const counts = lines.map((l) => splitLine(l, delimiter).length);
    const first = counts[0];
    if (first < 2) continue;
    // agreement across lines, with a nudge for more columns so a file that
    // splits evenly on both wins on the one that actually separates fields
    const agree = counts.filter((n) => n === first).length / counts.length;
    const score = agree * 10 + Math.min(first, 12) * 0.1;
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

/** One line, respecting quotes. Used only for sniffing. */
function splitLine(line, delimiter) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * The whole paste, quotes and all.
 *
 * A quoted field may contain the delimiter and may run over a line break —
 * a notes column with two sentences in it does exactly that — so this walks
 * the text a character at a time rather than splitting on newlines first.
 */
export function parseTable(text, delimiter = null) {
  const src = String(text ?? '').replace(/^﻿/, ''); // Excel's byte-order mark
  const d = delimiter || sniffDelimiter(src);

  const rows = [];
  let row = [];
  let cur = '';
  let quoted = false;
  let started = false; // has this cell begun, so a lone "" is kept as empty

  const endCell = () => { row.push(cur); cur = ''; started = false; };
  const endRow = () => {
    endCell();
    // a trailing newline should not become a row of one empty cell
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
      continue;
    }
    if (ch === '"' && !started) { quoted = true; started = true; continue; }
    if (ch === d) { endCell(); continue; }
    if (ch === '\r') { if (src[i + 1] === '\n') i++; endRow(); continue; }
    if (ch === '\n') { endRow(); continue; }
    cur += ch;
    started = true;
  }
  if (cur !== '' || row.length) endRow();

  if (!rows.length) return { delimiter: d, header: [], rows: [] };

  // Ragged rows are normal — Excel drops trailing empties — so every row is
  // squared off against the header rather than rejected.
  const header = rows[0].map((h) => h.trim());
  const width = header.length;
  const body = rows.slice(1)
    .map((rw) => Array.from({ length: width }, (_, i) => (rw[i] ?? '').trim()))
    .filter((rw) => rw.some((cell) => cell !== ''));

  return { delimiter: d, header, rows: body };
}

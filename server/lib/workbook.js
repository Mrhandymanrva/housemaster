/**
 * The whole thing as one workbook.
 *
 * Loading a franchise in a screen at a time meant eighteen separate pastes in
 * a fixed order, because a van cannot name a driver who does not exist yet.
 * One workbook fixes both: every screen is a sheet, it goes home on a laptop,
 * and it comes back in one piece with the order sorted out at this end.
 *
 * It is also the export. Sheets come back filled in, each row carrying its own
 * id, so the round trip — download, fix twenty things in Excel, upload — is
 * the same path as the first load rather than a second feature.
 *
 * Two things do the heavy lifting on data quality, and both work in Excel
 * before anything is uploaded:
 *
 *   Dropdowns. Every choice column and every column pointing at another record
 *   is a real Excel list, so "Sold" cannot be typed into Status and a driver's
 *   name cannot be misspelt. Errors caught in the cell never become rows to
 *   explain later.
 *
 *   The id column. It is what makes an edit an edit. Leave it alone and the
 *   row updates; a row typed underneath with no id is a new record. Without
 *   it, renaming a van would quietly create a second one.
 */
import ExcelJS from 'exceljs';

/** Columns the app maintains; nobody types these. */
const HOUSEKEEPING = ['id', 'created_at', 'updated_at', 'created_by', 'updated_by'];

export const ID_HEADER = 'id — leave this alone';

/**
 * Ledgers are left out for the same reason they have no paste button: they
 * are records of things the app watched happen, and evidence you can edit in
 * Excel is not evidence.
 */
export const NO_IMPORT = new Set([
  'radon_custody_events', 'radon_deployments', 'inventory_transactions',
]);

export const importableFields = (entity) =>
  entity.fields.filter((f) => f.ui_control !== 'readonly' && !HOUSEKEEPING.includes(f.column_name));

export const workbookEntities = (catalog) => catalog.filter((e) => !NO_IMPORT.has(e.key));

/**
 * Excel sheet names cannot hold : \ / ? * [ ] and stop at 31 characters, so
 * the label is trimmed to fit. The mapping back is by name, so whatever this
 * does the reader has to do too — hence one function, exported, used by both.
 */
export function sheetName(entity) {
  return String(entity.label_plural || entity.key)
    .replace(/[:\\/?*[\]]/g, ' ')
    .trim()
    .slice(0, 31);
}

const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B873C' } };
const NOTE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAFAEE' } };

/**
 * @param catalog  the resolved catalog
 * @param data     { [entityKey]: rows }   what is already on file
 * @param refs     { [entityKey]: [{ id, label }] }  choices for pointer columns
 */
export async function buildWorkbook({ catalog, data = {}, refs = {}, generatedOn = '' }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HouseMaster Ops';
  const entities = workbookEntities(catalog);

  startHere(wb, entities, generatedOn);

  // Long lists live on their own sheet and are pointed at by range, because a
  // dropdown defined inline breaks somewhere past 255 characters — which is
  // about eight employees.
  const lists = wb.addWorksheet('Choices');
  lists.state = 'veryHidden';
  const ranges = new Map();
  let col = 1;
  const addList = (key, values) => {
    if (!values.length) return null;
    if (ranges.has(key)) return ranges.get(key);
    const letter = lists.getColumn(col).letter;
    lists.getCell(`${letter}1`).value = key;
    values.forEach((v, i) => { lists.getCell(`${letter}${i + 2}`).value = v; });
    const range = `Choices!$${letter}$2:$${letter}$${values.length + 1}`;
    ranges.set(key, range);
    col++;
    return range;
  };

  for (const entity of entities) {
    const ws = wb.addWorksheet(sheetName(entity));
    const fields = importableFields(entity);

    ws.columns = [
      { header: ID_HEADER, key: 'id', width: 20 },
      ...fields.map((f) => ({
        header: f.required ? `${f.label} *` : f.label,
        key: f.column_name,
        width: Math.min(Math.max(String(f.label).length + 4, 12), 34),
      })),
    ];

    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    head.fill = HEAD_FILL;
    head.height = 22;
    ws.views = [{ state: 'frozen', ySplit: 1 }];   // headings stay put while scrolling
    ws.getColumn(1).font = { color: { argb: 'FF8A97A8' }, size: 9 };

    for (const row of data[entity.key] || []) {
      ws.addRow({
        id: row.id,
        ...Object.fromEntries(fields.map((f) => [f.column_name, cellValue(f, row)])),
      });
    }

    // Validation is applied down the sheet, not just over the rows that exist,
    // so it is still there on the empty rows somebody types into.
    const lastRow = Math.max(ws.rowCount, 1) + 500;
    fields.forEach((f, i) => {
      const letter = ws.getColumn(i + 2).letter;
      const validation = validationFor(f, refs, addList);
      if (validation) {
        for (let r = 2; r <= lastRow; r++) ws.getCell(`${letter}${r}`).dataValidation = validation;
      }
      if (f.ui_control === 'date') ws.getColumn(i + 2).numFmt = 'm/d/yyyy';
    });
  }

  return wb.xlsx.writeBuffer();
}

/** What goes in the cell — dates as dates, pointers as the name they point at. */
function cellValue(f, row) {
  const raw = row[f.column_name];
  if (raw === null || raw === undefined) return null;
  if (f.ui_control === 'ref') return row[`${f.column_name}__label`] ?? null;
  if (f.ui_control === 'toggle') return raw ? 'Yes' : 'No';
  if (f.ui_control === 'date') {
    const d = raw instanceof Date ? raw : new Date(raw);
    return Number.isNaN(d.getTime()) ? String(raw) : d;
  }
  if (f.ui_control === 'currency' || f.ui_control === 'number' || f.ui_control === 'integer') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : String(raw);
  }
  return raw;
}

function validationFor(f, refs, addList) {
  const list = (values) => {
    const range = addList(f.lookup_list || f.ref_entity, values);
    return range && {
      type: 'list', allowBlank: true, formulae: [range],
      showErrorMessage: true, errorStyle: 'stop',
      errorTitle: 'Not one of the choices',
      error: 'Pick from the list. If what you need is missing, the office adds it in the app first.',
    };
  };

  if (f.ui_control === 'select') return list((f.options || []).map((o) => o.label));
  if (f.ui_control === 'ref') return list((refs[f.ref_entity] || []).map((o) => o.label).filter(Boolean));
  if (f.ui_control === 'toggle') {
    return {
      type: 'list', allowBlank: true, formulae: ['"Yes,No"'],
      showErrorMessage: true, errorStyle: 'stop',
      errorTitle: 'Yes or No', error: 'This one is a yes or a no.',
    };
  }
  return null;
}

/** The sheet somebody actually reads before they start typing. */
function startHere(wb, entities, generatedOn) {
  const ws = wb.addWorksheet('Start here');
  ws.getColumn(1).width = 4;
  ws.getColumn(2).width = 104;

  const lines = [
    ['h', 'HouseMaster — everything in one workbook'],
    ['p', generatedOn ? `Taken from the app on ${generatedOn}.` : ''],
    ['', ''],
    ['h2', 'How to use it'],
    ['n', 'One sheet per screen in the app. Fill in the sheets you have something to say about and leave the rest alone — an untouched sheet changes nothing.'],
    ['n', 'Rows already in the app come down filled in. Change what is wrong and leave the rest.'],
    ['n', 'Add new records as new rows at the bottom of a sheet. Leave the id column empty on those.'],
    ['n', 'Upload the whole file back in the app under Records. You will see exactly what it would do before anything is saved.'],
    ['n', 'Once you have uploaded it, download a fresh workbook before making more changes. The rows you added come back with their id filled in; this copy still has them blank, and uploading it twice would look like you were adding them all over again.'],
    ['', ''],
    ['h2', 'The rules'],
    ['n', 'The id column is how the app knows an edit from a new record. Do not type in it, do not delete it, do not sort it away from its row.'],
    ['n', 'A star in the heading means every row needs it.'],
    ['n', 'Grey dropdown columns only take what is in the list. If the choice you need is missing, the office adds it in the app first.'],
    ['n', 'To point at another record — a van\'s driver, an asset\'s van — use its name, exactly as it appears on that record\'s own sheet. Something you are adding in this same workbook is fine; it gets created first.'],
    ['n', 'Dates are read month first. 3/9/2026 is March.'],
    ['n', 'Leaving a cell empty on an existing row leaves that field as it is. It does not clear it.'],
    ['', ''],
    ['h2', 'The sheets'],
    ...entities.map((e) => ['n', `${sheetName(e)} — ${e.label_plural}`]),
  ];

  lines.forEach(([kind, text], i) => {
    const row = ws.getRow(i + 1);
    const cell = row.getCell(2);
    cell.value = text;
    cell.alignment = { wrapText: true, vertical: 'top' };
    if (kind === 'h') { cell.font = { bold: true, size: 15, color: { argb: 'FF176F31' } }; row.height = 24; }
    if (kind === 'h2') { cell.font = { bold: true, size: 12 }; row.height = 22; }
    if (kind === 'n') { cell.font = { size: 11 }; row.height = 30; cell.fill = NOTE_FILL; }
    if (kind === 'p') cell.font = { size: 10, color: { argb: 'FF56657A' } };
  });
}

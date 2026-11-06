/**
 * statement-check
 * Match a delivery report against a carrier statement and find what was
 * delivered but not paid, underpaid, overpaid or paid without a delivery.
 * No dependencies. Works in Node and in the browser.
 */

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** Turn a date written in common formats into YYYY-MM-DD, or null. */
export function normDate(value) {
  if (value instanceof Date && !isNaN(value)) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const s = String(value ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  // UK style: day first (DD/MM/YYYY, DD-MM-YY, DD.MM.YYYY)
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${pad(m[2])}-${pad(m[1])}`;
  }
  // Excel serial date (e.g. 46310 or 46310.5)
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(EXCEL_EPOCH + Math.floor(parseFloat(s)) * 864e5);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  return null;
}

/** Read an amount such as "£1,250.00", "(12.40)", "12,40" or 12.4. Returns NaN when it is not a number. */
export function money(value) {
  if (typeof value === 'number') return value;
  let s = String(value ?? '').trim();
  if (!s) return NaN;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s);
  s = s.replace(/[£$€\s()+-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  const n = parseFloat(s);
  if (isNaN(n)) return NaN;
  return negative ? -n : n;
}

/** Build the matching key for a row: dates become YYYY-MM-DD, text ignores spaces and case. */
export function keyOf(row, columns) {
  return columns.map(c => normPart(row[c])).join(' · ');
}

const COLUMN_HINTS = {
  id: /track|barcode|consign|parcel|package|shipment|waybill|awb/i,
  date: /date|day/i,
  route: /route/i,
  service: /service|type/i,
  driver: /driver|courier|associate|name/i,
  status: /status|outcome|result|state/i,
  amount: /amount|paid|pay|total|value|rate|price|£|net|gross/i,
};
const PAYABLE = /deliver|complet|success|done|pod/i;

/**
 * Guess which columns to use from the header names.
 * Returns { keys, date, amount, driver, status, payable } (some may be empty).
 */
export function guessColumns(rows) {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const pick = (re, avoid = []) => cols.find(c => re.test(c) && !avoid.includes(c)) || '';
  const id = pick(COLUMN_HINTS.id);
  const date = pick(COLUMN_HINTS.date);
  const keys = id ? [id] : [date, pick(COLUMN_HINTS.route), pick(COLUMN_HINTS.service, [date])].filter(Boolean);
  if (!keys.length && cols.length) keys.push(cols[0]);
  const status = pick(COLUMN_HINTS.status);
  const payable = status
    ? [...new Set(rows.map(r => String(r[status] ?? '').trim()).filter(v => PAYABLE.test(v)))]
    : [];
  return { keys, date, amount: pick(COLUMN_HINTS.amount, keys), driver: pick(COLUMN_HINTS.driver, keys), status, payable };
}

/**
 * Compare a delivery report with a carrier statement.
 *
 * @param {object[]} report    rows of what you delivered (one object per line)
 * @param {object[]} statement rows of what the carrier paid
 * @param {object} options
 * @param {string[]} options.reportKeys     columns that identify a line in the report
 * @param {string[]} options.statementKeys  the same columns in the statement, in the same order
 * @param {string}   options.statementAmount column with what was paid
 * @param {string}  [options.reportAmount]   column with what each line should pay
 * @param {number|function|object[]} [options.rate] fixed rate per line, a function (row) => amount,
 *                                         or a list of { from: 'YYYY-MM-DD', amount } for rate changes (needs reportDate)
 * @param {string}  [options.reportDate]     date column in the report
 * @param {string}  [options.statementDate]  date column in the statement
 * @param {string}  [options.driver]         driver column in the report
 * @param {string}  [options.status]         status column in the report
 * @param {string[]}[options.payable]        status values that should be paid (others are skipped)
 */
export function reconcile(report, statement, options = {}) {
  const o = options;
  if (!o.reportKeys?.length || !o.statementKeys?.length) throw new Error('Choose at least one key column in each file.');
  if (o.reportKeys.length !== o.statementKeys.length) throw new Error('Use the same number of key columns in both files, in the same order.');
  if (!o.statementAmount) throw new Error('Choose the statement column that shows what was paid.');
  if (!o.reportAmount && o.rate == null) throw new Error('Give a report amount column or a rate.');

  const expectedFor = row => {
    if (o.reportAmount) return money(row[o.reportAmount]);
    if (typeof o.rate === 'number') return o.rate;
    if (typeof o.rate === 'function') return money(o.rate(row));
    if (Array.isArray(o.rate)) {
      const d = o.reportDate ? normDate(row[o.reportDate]) : null;
      const table = [...o.rate].sort((a, b) => a.from.localeCompare(b.from));
      let amount = table[0]?.amount;
      for (const r of table) if (d && d >= r.from) amount = r.amount;
      return amount;
    }
    return NaN;
  };
  const show = (row, keys) => keys.map(k => showPart(row[k])).join(' · ');
  const isBlank = k => !k.replace(/ · /g, '');

  const paid = new Map();
  let statementTotal = 0, badAmounts = 0;
  for (const row of statement) {
    const k = keyOf(row, o.statementKeys);
    if (isBlank(k)) continue;
    const a = money(row[o.statementAmount]);
    if (isNaN(a)) { badAmounts++; continue; }
    statementTotal += a;
    const e = paid.get(k) || { amount: 0, times: 0, row };
    e.amount += a; e.times++;
    paid.set(k, e);
  }

  const lines = [], seen = new Set();
  let skipped = 0, duplicates = 0;
  for (const row of report) {
    const k = keyOf(row, o.reportKeys);
    if (isBlank(k)) continue;
    if (o.status && o.payable && !o.payable.includes(String(row[o.status] ?? '').trim())) { skipped++; continue; }
    if (seen.has(k)) { duplicates++; continue; }
    seen.add(k);
    const expected = expectedFor(row), p = paid.get(k);
    const line = {
      key: k,
      label: show(row, o.reportKeys),
      date: o.reportDate ? (normDate(row[o.reportDate]) || String(row[o.reportDate] ?? '')) : '',
      driver: o.driver ? String(row[o.driver] ?? '').trim() : '',
      expected: isNaN(expected) ? 0 : r2(expected),
      paid: p ? r2(p.amount) : 0,
    };
    line.diff = r2(line.paid - line.expected);
    line.status = !p ? 'missing' : Math.abs(line.diff) < 0.005 ? 'ok' : line.diff < 0 ? 'under' : 'over';
    if (p && p.times > 1) line.note = `paid ${p.times} times`;
    lines.push(line);
  }
  for (const [k, p] of paid) {
    if (seen.has(k)) continue;
    lines.push({
      key: k, label: show(p.row, o.statementKeys),
      date: o.statementDate ? (normDate(p.row[o.statementDate]) || '') : '',
      driver: '', expected: 0, paid: r2(p.amount), diff: r2(p.amount), status: 'extra',
    });
  }

  const count = s => lines.filter(l => l.status === s).length;
  const claim = lines.filter(l => l.status === 'missing' || l.status === 'under');
  const dates = lines.map(l => l.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const byDriver = {};
  for (const l of claim) byDriver[l.driver || '(none)'] = r2((byDriver[l.driver || '(none)'] || 0) - l.diff);

  return {
    lines,
    claim,
    found: r2(claim.reduce((a, l) => a - l.diff, 0)),
    counts: { ok: count('ok'), missing: count('missing'), under: count('under'), over: count('over'), extra: count('extra') },
    expectedTotal: r2(lines.filter(l => l.status !== 'extra').reduce((a, l) => a + l.expected, 0)),
    statementTotal: r2(statementTotal),
    byDriver,
    skipped, duplicates, badAmounts,
    from: dates[0] || null, to: dates[dates.length - 1] || null,
  };
}

/** Read CSV text into an array of objects keyed by the header row. Handles quotes, commas and new lines inside quotes. */
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some(v => v !== '')) rows.push(row);
  const [head = [], ...body] = rows;
  const names = head.map(h => h.trim());
  return body.map(r => Object.fromEntries(names.map((n, i) => [n, r[i] ?? ''])));
}

/** The lines to claim as CSV, ready to attach to a dispute. */
export function claimCSV(result, currency = '£') {
  const esc = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const head = ['Line', 'Date', 'Driver', 'Status', `Expected (${currency})`, `Paid (${currency})`, `Owed (${currency})`, 'Note'];
  const body = result.claim.map(l => [l.label, l.date, l.driver, l.status === 'missing' ? 'Not paid' : 'Underpaid', l.expected.toFixed(2), l.paid.toFixed(2), (-l.diff).toFixed(2), l.note || '']);
  return [head, ...body, ['Total', '', '', '', '', '', result.found.toFixed(2), '']].map(r => r.map(esc).join(',')).join('\n') + '\n';
}

function normPart(v) { return normDate(v) || String(v ?? '').toUpperCase().replace(/\s+/g, ''); }
function showPart(v) { return normDate(v) || String(v ?? '').trim().replace(/\s+/g, ' '); }
function pad(n) { return String(n).padStart(2, '0'); }
function r2(v) { return Math.round(v * 100) / 100; }

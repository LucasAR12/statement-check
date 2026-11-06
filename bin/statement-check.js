#!/usr/bin/env node
// Command line: compare a delivery report CSV with a carrier statement CSV.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCSV, guessColumns, reconcile, claimCSV } from '../src/index.js';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const files = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (files.length < 2 || args.includes('--help')) {
  console.log(`Usage: statement-check <report.csv> <statement.csv> [options]

Options (columns are guessed from the headers when left out):
  --report-key "Tracking ID"      key column(s) in the report, comma separated
  --statement-key "Parcel"        the same key column(s) in the statement
  --statement-amount "Amount"     what the carrier paid
  --report-amount "Rate"          what each line should pay
  --rate 1.10                     or a fixed rate per line
  --status "Status"               status column in the report
  --payable "Delivered,Collected" status values that should be paid
  --out claim.csv                 save the lines to claim
  --json                          print the full result as JSON`);
  process.exit(files.length < 2 ? 1 : 0);
}

const report = parseCSV(readFileSync(files[0], 'utf8'));
const statement = parseCSV(readFileSync(files[1], 'utf8'));
const gr = guessColumns(report), gs = guessColumns(statement);
const list = v => v ? v.split(',').map(s => s.trim()) : undefined;

const result = reconcile(report, statement, {
  reportKeys: list(flag('report-key')) || gr.keys,
  statementKeys: list(flag('statement-key')) || gs.keys,
  statementAmount: flag('statement-amount') || gs.amount,
  reportAmount: flag('rate') ? undefined : (flag('report-amount') || gr.amount || undefined),
  rate: flag('rate') ? Number(flag('rate')) : undefined,
  reportDate: gr.date, statementDate: gs.date, driver: gr.driver,
  status: flag('status') || gr.status || undefined,
  payable: list(flag('payable')) || (gr.payable.length ? gr.payable : undefined),
});

if (args.includes('--json')) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }
const c = result.counts;
console.log(`Delivered, not paid: £${result.found.toFixed(2)} across ${result.claim.length} lines`);
console.log(`Paid right ${c.ok} · not paid ${c.missing} · underpaid ${c.under} · overpaid ${c.over} · not in your report ${c.extra}`);
console.log(`Report total £${result.expectedTotal.toFixed(2)} · statement total £${result.statementTotal.toFixed(2)}`);
if (result.skipped || result.duplicates || result.badAmounts) console.log(`Skipped ${result.skipped} non-payable lines, ${result.duplicates} repeated lines, ${result.badAmounts} unreadable amounts`);
for (const [d, v] of Object.entries(result.byDriver)) console.log(`  ${d}: £${v.toFixed(2)}`);
if (flag('out')) { writeFileSync(flag('out'), claimCSV(result)); console.log(`Saved ${flag('out')}`); }

# statement-check

Match a delivery report against a carrier statement and find the drops you delivered but were never paid for.

Last-mile delivery subcontractors (Amazon DSPs, DPD, Evri, Yodel and others) get paid from a statement the carrier sends. Checking it line by line against what the drivers actually delivered takes hours, so most companies don't, and missing or underpaid drops go unclaimed. `statement-check` does that comparison in milliseconds, with no dependencies, in Node or in the browser.

```
$ npx statement-check examples/report.csv examples/statement.csv
Delivered, not paid: £2.70 across 3 lines
Paid right 4 · not paid 2 · underpaid 1 · overpaid 1 · not in your report 1
Report total £8.80 · statement total £8.30
Skipped 1 non-payable lines, 1 repeated lines, 1 unreadable amounts
  P. Shah: £1.60
  D. Okafor: £1.10
```

## What it handles

- **Messy keys:** tracking IDs with different spacing or case (`h01a 0007` = `H01A0007`), or keys made of several columns (date + route + service).
- **Dates in any common format:** `2026-10-02`, `02/10/2026` (day first), `2.10.26` and Excel serial dates all become `2026-10-02`.
- **Amounts as people write them:** `£1,250.00`, `(12.40)` as a negative, `12,40`, numbers.
- **Every outcome:** paid right, not paid, underpaid, overpaid, and paid but not in your report.
- **Real-world noise:** a line repeated in the report counts once; a parcel paid twice is summed and flagged `paid 2 times`; failed or non-payable statuses are skipped; unreadable amounts are counted, not guessed.
- **Rate changes:** a fixed rate, a rate column, a function, or a dated rate table (`£165` until the 14th, `£172` from the 15th).
- **Claim file:** the lines to claim as a CSV with a total, ready to attach to a dispute.

## Install

```bash
npm install github:LucasAR12/statement-check
```

Node 18 or later. No dependencies.

## Use it in code

```js
import { parseCSV, reconcile, claimCSV } from 'statement-check';
import { readFileSync, writeFileSync } from 'node:fs';

const report = parseCSV(readFileSync('report.csv', 'utf8'));
const statement = parseCSV(readFileSync('statement.csv', 'utf8'));

const result = reconcile(report, statement, {
  reportKeys: ['Tracking ID'],      // what identifies a line in your report
  statementKeys: ['Parcel'],        // the same thing in the carrier's statement
  statementAmount: 'Amount',        // what the carrier paid
  reportAmount: 'Rate',             // what each line should pay (or use `rate`)
  reportDate: 'Date',
  driver: 'Driver',
  status: 'Status',
  payable: ['Delivered'],           // statuses that should be paid
});

console.log(result.found);          // 2.7  → money to claim
console.log(result.counts);         // { ok: 4, missing: 2, under: 1, over: 1, extra: 1 }
console.log(result.byDriver);       // { 'P. Shah': 1.6, 'D. Okafor': 1.1 }
writeFileSync('claim.csv', claimCSV(result));
```

Reading Excel? Load the sheet with any library (for example SheetJS) into an array of objects and pass it in: `reconcile` only needs plain rows.

### Options

| Option | What it is |
|---|---|
| `reportKeys` | Column(s) that identify a line in the report |
| `statementKeys` | The same column(s) in the statement, in the same order |
| `statementAmount` | Column with what was paid |
| `reportAmount` | Column with what each line should pay |
| `rate` | Instead of `reportAmount`: a number, a function `(row) => amount`, or `[{ from: 'YYYY-MM-DD', amount }]` (needs `reportDate`) |
| `reportDate`, `statementDate` | Date columns, used for the period and dated rates |
| `driver` | Driver column, used for the per-driver total |
| `status`, `payable` | Status column and the values that should be paid |

### Result

| Field | What it is |
|---|---|
| `found` | Total to claim (not paid + underpaid) |
| `claim` | The lines to claim |
| `lines` | Every line with `status` (`ok`, `missing`, `under`, `over`, `extra`), `expected`, `paid`, `diff`, `date`, `driver` and an optional `note` |
| `counts` | How many lines of each status |
| `byDriver` | Amount to claim per driver |
| `expectedTotal`, `statementTotal` | Totals on each side |
| `skipped`, `duplicates`, `badAmounts` | What was left out and why |
| `from`, `to` | Period covered |

`guessColumns(rows)` suggests keys, amount, date, driver, status and payable values from the header names, which is what the command line uses when you don't pass columns.

## Command line

```
statement-check <report.csv> <statement.csv> [options]

  --report-key "Tracking ID"      key column(s) in the report, comma separated
  --statement-key "Parcel"        the same key column(s) in the statement
  --statement-amount "Amount"     what the carrier paid
  --report-amount "Rate"          what each line should pay
  --rate 1.10                     or a fixed rate per line
  --status "Status"               status column in the report
  --payable "Delivered,Collected" status values that should be paid
  --out claim.csv                 save the lines to claim
  --json                          print the full result as JSON
```

## Privacy

Everything runs locally. Nothing is uploaded anywhere. The example files in `examples/` are invented.

## Tests

```bash
npm test
```

## Background

This is the matching engine behind [Kerbproof](https://lucasar12.github.io/kerbproof-site/), a tool for UK delivery subcontractors. It is open so that any operator, bookkeeper or developer can check their own statements.

## Licence

MIT

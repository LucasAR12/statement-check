import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normDate, money, parseCSV, guessColumns, reconcile, claimCSV } from '../src/index.js';

const load = f => parseCSV(readFileSync(new URL(`../examples/${f}`, import.meta.url), 'utf8'));

test('dates in common formats become YYYY-MM-DD', () => {
  assert.equal(normDate('2026-10-2'), '2026-10-02');
  assert.equal(normDate('02/10/2026'), '2026-10-02');
  assert.equal(normDate('2.10.26'), '2026-10-02');
  assert.equal(normDate('46297'), '2026-10-02');
  assert.equal(normDate('route 12'), null);
});

test('amounts with symbols, thousands and brackets', () => {
  assert.equal(money('£1,250.00'), 1250);
  assert.equal(money('(12.40)'), -12.4);
  assert.equal(money('12,40'), 12.4);
  assert.equal(money(' 7 '), 7);
  assert.ok(Number.isNaN(money('n/a')));
});

test('CSV with quotes and a byte-order mark', () => {
  const rows = parseCSV('﻿a,b\n"x, y","say ""hi"""\n');
  assert.deepEqual(rows, [{ a: 'x, y', b: 'say "hi"' }]);
});

test('guesses columns from header names', () => {
  assert.deepEqual(guessColumns(load('statement.csv')).keys, ['Parcel']);
  const g = guessColumns(load('report.csv'));
  assert.deepEqual(g.keys, ['Tracking ID']);
  assert.equal(g.status, 'Status');
  assert.deepEqual(g.payable, ['Delivered']);
  assert.equal(g.amount, 'Rate');
});

test('example month: finds what was not paid', () => {
  const r = reconcile(load('report.csv'), load('statement.csv'), {
    reportKeys: ['Tracking ID'], statementKeys: ['Parcel'], statementAmount: 'Amount',
    reportAmount: 'Rate', reportDate: 'Date', driver: 'Driver', status: 'Status', payable: ['Delivered'],
  });
  assert.deepEqual(r.counts, { ok: 4, missing: 2, under: 1, over: 1, extra: 1 });
  assert.equal(r.found, 2.7);
  assert.equal(r.skipped, 1);
  assert.equal(r.duplicates, 1);
  assert.equal(r.badAmounts, 1);
  assert.equal(r.statementTotal, 8.3);
  assert.equal(r.expectedTotal, 8.8);
  assert.deepEqual(r.byDriver, { 'P. Shah': 1.6, 'D. Okafor': 1.1 });
  assert.equal(r.lines.find(l => l.key === 'H01A0006').note, 'paid 2 times');
  assert.match(claimCSV(r), /Total,,,,,,2\.70,/);
});

test('rate change by date', () => {
  const report = [{ id: 'A', d: '2026-10-14' }, { id: 'B', d: '2026-10-15' }];
  const statement = [{ id: 'A', p: '165' }, { id: 'B', p: '165' }];
  const r = reconcile(report, statement, {
    reportKeys: ['id'], statementKeys: ['id'], statementAmount: 'p', reportDate: 'd',
    rate: [{ from: '2026-10-01', amount: 165 }, { from: '2026-10-15', amount: 172 }],
  });
  assert.equal(r.found, 7);
  assert.equal(r.lines.find(l => l.key === 'B').status, 'under');
});

test('keys made of several columns, in any date format', () => {
  const report = [{ day: '03/10/2026', route: 'CX12', amount: '172' }];
  const statement = [{ date: '2026-10-03', Route: 'cx 12', paid: '172.00' }];
  const r = reconcile(report, statement, { reportKeys: ['day', 'route'], statementKeys: ['date', 'Route'], statementAmount: 'paid', reportAmount: 'amount' });
  assert.equal(r.counts.ok, 1);
});

test('clear errors for a bad setup', () => {
  assert.throws(() => reconcile([], [], { reportKeys: ['a'], statementKeys: [], statementAmount: 'x', rate: 1 }), /key column/);
  assert.throws(() => reconcile([], [], { reportKeys: ['a'], statementKeys: ['a', 'b'], statementAmount: 'x', rate: 1 }), /same number/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unwrapRecords } from '../shared/unwrap.ts';

test('unwraps numeric-keyed objects', () => {
	const { records } = unwrapRecords({ '0': { id: 'a' }, '1': { id: 'b' } });
	assert.deepEqual(records.map((r) => r.id), ['a', 'b']);
});

test('unwraps envelope data + total_count', () => {
	const { records, total } = unwrapRecords({ info: { total_count: 9 }, data: [{ id: 'a' }] });
	assert.equal(records.length, 1);
	assert.equal(total, 9);
});

test('unwraps arrays', () => {
	assert.equal(unwrapRecords([{ id: 'a' }]).records.length, 1);
});

test('empty object is zero records', () => {
	assert.equal(unwrapRecords({}).records.length, 0);
});

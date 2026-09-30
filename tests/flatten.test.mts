import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flattenRecord } from '../shared/flatten.ts';

test('merges normalized group dicts', () => {
	const flat = flattenRecord({
		id: 'abc',
		insertTimestamp: 1,
		g_1: { fld_a: 'hello', fld_b: { instance_id: 'x', text: 'Bob' } },
	});
	assert.equal(flat.id, 'abc');
	assert.equal(flat.fld_a, 'hello');
	assert.deepEqual(flat.fld_b, { id: 'x', text: 'Bob' });
});

test('keeps date text+timestamp', () => {
	const flat = flattenRecord({
		id: '1',
		g_1: { fld_d: { text: '01/01/2026', timestamp: 1767225600 } },
	});
	assert.deepEqual(flat.fld_d, { text: '01/01/2026', timestamp: 1767225600 });
});

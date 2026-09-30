import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectAllPages, limitPair, shouldStopPaging } from '../shared/pagination.ts';

test('limitPair is [skip,count]', () => {
	assert.deepEqual(limitPair(2, 50), [2, 50]);
});

test('stops on short page', () => {
	assert.equal(shouldStopPaging({ received: 3, pageSize: 100, fetched: 3, cap: 5000 }), true);
});

test('continues on full page under cap', () => {
	assert.equal(shouldStopPaging({ received: 100, pageSize: 100, fetched: 100, cap: 5000 }), false);
});

function fakeSource(size: number) {
	const calls: Array<[number, number]> = [];
	const rows = Array.from({ length: size }, (_, i) => i);
	return {
		calls,
		fetch: async (skip: number, count: number) => {
			calls.push([skip, count]);
			return { records: rows.slice(skip, skip + count) };
		},
	};
}

test('collectAllPages reads every page and is not capped', async () => {
	const src = fakeSource(250);
	const result = await collectAllPages(src.fetch, { pageSize: 100, cap: 5000 });
	assert.equal(result.records.length, 250);
	assert.equal(result.capped, false);
	assert.deepEqual(src.calls, [[0, 100], [100, 100], [200, 100]]);
});

test('collectAllPages stops at cap and reports capped', async () => {
	const src = fakeSource(1000);
	const result = await collectAllPages(src.fetch, { pageSize: 100, cap: 150 });
	assert.equal(result.records.length, 150);
	assert.equal(result.capped, true);
	assert.deepEqual(src.calls, [[0, 100], [100, 50]]);
});

test('collectAllPages exact cap with no more rows is not capped when total is known', async () => {
	const result = await collectAllPages(async (skip, count) => ({ records: Array.from({ length: Math.max(0, Math.min(count, 200 - skip)) }, () => 1), total: 200 }), { pageSize: 100, cap: 200 });
	assert.equal(result.records.length, 200);
	assert.equal(result.capped, false);
});

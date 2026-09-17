import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyForceWorkflowAsync, applyReadFlags, buildRecordFilter, parseOrderBy } from '../shared/apiFlags.ts';

test('parseOrderBy accepts csv and json', () => {
	assert.deepEqual(parseOrderBy('fld_x,asc'), ['fld_x', 'asc']);
	assert.deepEqual(parseOrderBy('["_id","desc"]'), ['_id', 'desc']);
	assert.equal(parseOrderBy(''), undefined);
});

test('applyReadFlags defaults to normalized and excludes archive', () => {
	const body = applyReadFlags({}, {});
	assert.equal(body.normalized, '1');
	assert.equal(body.with_archive, 0);
});

test('applyReadFlags include archive omits with_archive', () => {
	const body = applyReadFlags({}, { withArchive: true });
	assert.equal(body.with_archive, undefined);
});

test('applyReadFlags projects fields/groups and skips formulas', () => {
	const body = applyReadFlags(
		{},
		{
			returnFields: 'fld_a, fld_b',
			returnGroups: 'g_1',
			dontRecalcFormula: true,
			withComments: true,
			orderBy: 'fld_a,desc',
			normalized: false,
		},
	);
	assert.equal(body.normalized, '0');
	assert.deepEqual(body.return_fields, ['fld_a', 'fld_b']);
	assert.deepEqual(body.return_groups, ['g_1']);
	assert.equal(body.dont_recalc_formula, '1');
	assert.equal(body.with_comments, '1');
	assert.deepEqual(body.orderby, ['fld_a', 'desc']);
});

test('buildRecordFilter AND vs OR', () => {
	const triples: Array<[string, string, unknown]> = [
		['fld_a', '=', '1'],
		['fld_b', '=', '2'],
	];
	assert.deepEqual(buildRecordFilter(triples, 'and'), triples);
	assert.deepEqual(buildRecordFilter(triples, 'or'), { andxor: [[['fld_a', '=', '1']], [['fld_b', '=', '2']]] });
});

test('force_workflow_async only when enabled', () => {
	assert.deepEqual(applyForceWorkflowAsync({}, false), {});
	assert.equal(applyForceWorkflowAsync({}, true).force_workflow_async, 1);
});

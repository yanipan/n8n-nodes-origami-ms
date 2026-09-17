import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	entityOptions,
	extractGroups,
	fieldOptions,
	groupOptions,
	summarizeStructure,
} from '../shared/structure.ts';

test('entityOptions unwraps a raw list and marks protected', () => {
	const options = entityOptions([
		{ entity_name: 'test', entity_data_name: 'e_86', protected_entity: '0' },
		{ entity_name: 'users', entity_data_name: 'origami_users', protected_entity: '1' },
	]);
	assert.equal(options.length, 2);
	assert.ok(options.some((o) => o.value === 'e_86' && o.name.includes('test')));
	assert.ok(options.some((o) => o.value === 'origami_users' && o.name.includes('[protected]')));
});

test('entityOptions unwraps numeric-keyed lists', () => {
	const options = entityOptions({
		'0': { entity_name: 'A', entity_data_name: 'e_1' },
		info: { total_count: 1 },
	});
	assert.deepEqual(options, [{ name: 'A (e_1)', value: 'e_1' }]);
});

test('extractGroups reads field_group_data and flattens nested fields_data', () => {
	const structure = {
		instance_data: [
			{
				field_group_data: { group_name: 'Main', group_data_name: 'g_1', repeatable_group: '1' },
				fields_data: [
					[
						{ field_name: 'Title', field_data_name: 'fld_1', field_type_name: 'input-text', required: '1' },
						{ field_name: 'Calc', field_data_name: 'fld_2', field_type_name: 'formula-field' },
					],
				],
			},
		],
	};
	const groups = extractGroups(structure);
	assert.equal(groups.length, 1);
	assert.equal(groups[0].group_data_name, 'g_1');
	assert.equal((groups[0].fields_data as unknown[]).length, 2);
	assert.equal(groupOptions(structure, { repeatableOnly: true }).length, 1);
});

test('extractGroups reads unnormalized field_groups', () => {
	const groups = extractGroups({
		instance_data: {
			_id: 'abc',
			field_groups: [
				{
					field_group_data: { group_data_name: 'g_x', group_name: 'X' },
					fields_data: [{ field_data_name: 'fld_x', field_name: 'X', field_type_name: 'input-text' }],
				},
			],
		},
	});
	assert.equal(groups[0]?.group_data_name, 'g_x');
});

test('extractGroups returns empty on error bodies', () => {
	assert.equal(extractGroups({ error: { type: 'login' } }).length, 0);
});

test('fieldOptions filters writable and files, includes group names', () => {
	const structure = {
		instance_data: [
			{
				field_group_data: { group_name: 'Files', group_data_name: 'g_f' },
				fields_data: [
					{ field_name: 'Doc', field_data_name: 'fld_file', field_type_name: 'upload-files' },
					{ field_name: 'Sum', field_data_name: 'fld_sum', field_type_name: 'formula-field' },
					{ field_name: 'Note', field_data_name: 'fld_note', field_type_name: 'input-text', required: 1 },
				],
			},
		],
	};
	const writable = fieldOptions(structure, { writableOnly: true });
	assert.ok(writable.some((o) => o.value === 'fld_note'));
	assert.ok(writable.some((o) => o.value === 'fld_file'));
	assert.ok(!writable.some((o) => o.value === 'fld_sum'));
	const files = fieldOptions(structure, { fileOnly: true });
	assert.deepEqual(files.map((o) => o.value), ['fld_file']);
	const all = fieldOptions(structure, { includeGroup: true });
	assert.ok(all.find((o) => o.value === 'fld_note')?.name.includes('Files /'));
	assert.ok(all.find((o) => o.value === 'fld_note')?.name.includes('*'));
});

test('summarizeStructure counts groups and fields', () => {
	const summary = summarizeStructure(
		{
			instance_data: [
				{
					field_group_data: { group_data_name: 'g_1', group_name: 'Main' },
					fields_data: [{ field_data_name: 'fld_1', field_type_name: 'input-text' }],
				},
			],
		},
		'e_471',
	);
	assert.equal(summary.entity_data_name, 'e_471');
	assert.equal(summary.groupCount, 1);
	assert.equal(summary.fieldCount, 1);
	assert.equal(summary.groups[0].fields[0].writable, true);
});

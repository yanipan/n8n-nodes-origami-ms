import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractEntityId } from '../shared/entityParam.ts';

test('extractEntityId reads string and resource locator', () => {
	assert.equal(extractEntityId('e_471'), 'e_471');
	assert.equal(extractEntityId({ mode: 'list', value: 'e_86' }), 'e_86');
	assert.equal(extractEntityId({ id: 'e_1' }), 'e_1');
	assert.equal(extractEntityId({}), '');
});

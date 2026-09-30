import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aiAccessViolation, isReadOperation, isToolNodeType, normalizeAiAgentAccess } from '../shared/aiAccess.ts';

test('regular node is never restricted', () => {
	assert.equal(
		aiAccessViolation({ nodeType: 'n8n-nodes-origami-ms.origami', resource: 'record', operation: 'delete', access: 'readOnly' }),
		undefined,
	);
});

test('tool node blocks writes when read only or unset', () => {
	for (const access of ['readOnly', undefined, '']) {
		const message = aiAccessViolation({ nodeType: 'n8n-nodes-origami-ms.origamiTool', resource: 'invoice', operation: 'create', access });
		assert.match(message ?? '', /invoice\.create is blocked/);
	}
});

test('tool node allows reads when read only', () => {
	assert.equal(
		aiAccessViolation({ nodeType: 'n8n-nodes-origami-ms.origamiTool', resource: 'record', operation: 'getAll', access: 'readOnly' }),
		undefined,
	);
});

test('tool node allows writes when read and write', () => {
	assert.equal(
		aiAccessViolation({ nodeType: 'n8n-nodes-origami-ms.origamiTool', resource: 'communication', operation: 'sendSms', access: 'readWrite' }),
		undefined,
	);
});

test('unknown operations count as writes', () => {
	assert.equal(isReadOperation('record', 'somethingNew'), false);
	assert.equal(isReadOperation('omnichannel', 'ingest'), false);
	assert.equal(isToolNodeType('x.origamiTool'), true);
	assert.equal(normalizeAiAgentAccess('bogus'), 'readOnly');
});

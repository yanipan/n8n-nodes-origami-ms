import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coerceWriteValue, isWritableFieldType } from '../shared/fieldTypes.ts';

test('never writes formula/metadata', () => {
	assert.equal(isWritableFieldType('formula-field'), false);
	assert.equal(coerceWriteValue('formula-field', 'x'), undefined);
});

test('relation create/update is a bare id string', () => {
	assert.equal(coerceWriteValue('select-from-entity', { instance_id: 'abc', text: 'Name' }), 'abc');
});

test('refund attach stays an object', () => {
	const value = coerceWriteValue('select-from-entity', 'abc', 'origami_invoices_attach_invoice_fld');
	assert.deepEqual(value, { instance_id: 'abc', text: 'abc' });
});

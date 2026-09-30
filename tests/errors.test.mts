import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractOrigamiError, isHttpErrorStatus } from '../shared/errors.ts';

test('extractOrigamiError reads string errors', () => {
	assert.equal(extractOrigamiError({ error: 'Required' }), 'Required');
});

test('extractOrigamiError reads login objects', () => {
	assert.equal(
		extractOrigamiError({ error: { type: 'login', message: 'Wrong username or password' } }),
		'login: Wrong username or password',
	);
});

test('extractOrigamiError ignores success bodies', () => {
	assert.equal(extractOrigamiError({ success: 'ok', results: { _id: '1' } }), undefined);
});

test('HTTP 200 is not an error status', () => {
	assert.equal(isHttpErrorStatus(200), false);
	assert.equal(isHttpErrorStatus(403), true);
});

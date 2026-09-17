import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getBaseUrl } from '../shared/baseUrl.ts';

test('builds subdomain URL', () => {
	assert.equal(getBaseUrl({ accountName: 'mycompany' }), 'https://mycompany.origami.ms');
});

test('custom base URL wins and strips slash', () => {
	assert.equal(getBaseUrl({ accountName: 'mycompany', customBaseUrl: 'https://crm.example.com/' }), 'https://crm.example.com');
});

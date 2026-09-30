import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headerValue, safeEqual } from '../shared/webhookAuth.ts';
import { buildMultipartBody, sanitizeMultipartName } from '../shared/multipart.ts';

test('safeEqual matches only identical strings', () => {
	assert.equal(safeEqual('secret', 'secret'), true);
	assert.equal(safeEqual('secret', 'secreT'), false);
	assert.equal(safeEqual('secret', 'secret1'), false);
	assert.equal(safeEqual('', 'x'), false);
});

test('headerValue reads lowercased express headers', () => {
	assert.equal(headerValue({ 'x-origami-secret': 'abc' }, 'X-Origami-Secret'), 'abc');
	assert.equal(headerValue({ 'x-a': ['1', '2'] }, 'x-a'), '1');
	assert.equal(headerValue({}, 'x-a'), '');
});

test('multipart file name cannot break the header', () => {
	assert.equal(sanitizeMultipartName('a"\r\nb.txt'), 'a___b.txt');
	const body = buildMultipartBody('B', { username: 'u' }, { fieldName: 'file', fileName: 'x".txt', buffer: Buffer.from('hi') }).toString();
	assert.ok(body.includes('name="username"\r\n\r\nu\r\n'));
	assert.ok(body.includes('filename="x_.txt"'));
	assert.ok(body.endsWith('\r\n--B--\r\n'));
});

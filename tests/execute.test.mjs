// Execute-level tests against the compiled node (run `npm run test:execute`, which builds first).
// The n8n context is mocked; every HTTP call is captured so request bodies can be asserted.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { executeOrigami } = require('../dist/nodes/Origami/execute.js');
const { Origami } = require('../dist/nodes/Origami/Origami.node.js');
const { OrigamiTrigger } = require('../dist/nodes/OrigamiTrigger/OrigamiTrigger.node.js');

const NODE = 'n8n-nodes-origami-ms.origami';
const TOOL = 'n8n-nodes-origami-ms.origamiTool';

function harness({ params, respond, items = [{ json: {} }], nodeType = NODE, credentials = {}, continueOnFail = false }) {
	const calls = [];
	const hints = [];
	const reply = (opts) => {
		calls.push(opts);
		const r = respond(opts, calls.length - 1) ?? {};
		return { statusCode: r.statusCode ?? 200, body: r.body, headers: r.headers ?? {} };
	};
	const ctx = {
		getInputData: () => items,
		getNodeParameter: (name, _i, fallback) => {
			const value = name.split('.').reduce((obj, key) => (obj == null ? undefined : obj[key]), params);
			if (value !== undefined) return value;
			if (fallback !== undefined) return fallback;
			throw new Error(`test harness: missing parameter ${name}`);
		},
		getNode: () => ({ name: 'Origami', type: nodeType, typeVersion: 1, parameters: {} }),
		getCredentials: async () => ({ accountName: 'stage', customBaseUrl: '', username: 'u', apiSecret: 's', ...credentials }),
		continueOnFail: () => continueOnFail,
		addExecutionHints: (...h) => hints.push(...h),
		helpers: {
			httpRequestWithAuthentication: async (_type, opts) => reply(opts),
			httpRequest: async (opts) => reply(opts),
			getBinaryDataBuffer: async () => Buffer.from('hello'),
			prepareBinaryData: async (buffer, fileName, mimeType) => ({ data: buffer.toString('base64'), fileName, mimeType }),
		},
	};
	return { run: () => executeOrigami.call(ctx), calls, hints };
}

const rowsSource = (size) => (opts) => {
	const [skip, count] = opts.body.limit;
	return { body: Array.from({ length: Math.max(0, Math.min(count, size - skip)) }, (_, k) => ({ _id: `id${skip + k}` })) };
};

const recordGetAll = (extra = {}) => ({
	resource: 'record',
	operation: 'getAll',
	entityDataName: 'e_1',
	simplify: false,
	returnAll: true,
	...extra,
});

test('Return All pages with limit pairs, stable _id asc order and excludes archived', async () => {
	const h = harness({ params: recordGetAll(), respond: rowsSource(250) });
	const [out] = await h.run();
	assert.equal(out.length, 250);
	assert.deepEqual(h.calls.map((c) => c.body.limit), [[0, 100], [100, 100], [200, 100]]);
	for (const call of h.calls) {
		assert.deepEqual(call.body.orderby, ['_id', 'asc']);
		assert.equal(call.body.with_archive, 0);
		assert.match(call.url, /^https:\/\/stage\.origami\.ms\/entities\/api\/instance_data\/format\/json$/);
	}
	assert.equal(h.hints.length, 0);
});

test('Return All stops at Max Records and warns', async () => {
	const h = harness({ params: recordGetAll({ maxRecords: 150 }), respond: rowsSource(10000) });
	const [out] = await h.run();
	assert.equal(out.length, 150);
	assert.equal(h.hints.length, 1);
	assert.equal(h.hints[0].type, 'warning');
	assert.match(h.hints[0].message, /Max Records \(150\)/);
});

test('Return All keeps a user Order By', async () => {
	const h = harness({ params: recordGetAll({ orderBy: 'fld_1,desc' }), respond: rowsSource(3) });
	await h.run();
	assert.deepEqual(h.calls[0].body.orderby, ['fld_1', 'desc']);
});

test('Get by ID uses a nested filter and does not hide archived records', async () => {
	const h = harness({
		params: { resource: 'record', operation: 'get', entityDataName: 'e_1', instanceId: 'abc', simplify: false, withArchive: false },
		respond: () => ({ body: [{ _id: 'abc' }] }),
	});
	const [out] = await h.run();
	assert.equal(out[0].json._id, 'abc');
	assert.deepEqual(h.calls[0].body.filter, [['_id', '=', 'abc']]);
	assert.equal('with_archive' in h.calls[0].body, false);
});

test('Update throws when nothing was updated', async () => {
	const h = harness({
		params: {
			resource: 'record',
			operation: 'update',
			entityDataName: 'e_1',
			instanceId: 'abc',
			updateMode: 'builder',
			updateFields: { field: [{ fieldDataName: 'fld_1', value: 'x', groupIndex: 0 }] },
		},
		respond: () => ({ body: { success: 'ok', results: { instances_updated: 0 } } }),
	});
	await assert.rejects(h.run(), /instances_updated=0/);
	assert.deepEqual(h.calls[0].body.filter, [['_id', '=', 'abc']]);
	assert.deepEqual(h.calls[0].body.field, [['fld_1', 'x', 0]]);
});

test('HTTP 200 with an error body fails, or becomes an error item with Continue On Fail', async () => {
	const params = { resource: 'entity', operation: 'getAll' };
	const respond = () => ({ body: { error: { type: 'login', message: 'Wrong username or password' } } });
	await assert.rejects(harness({ params, respond }).run(), /login: Wrong username or password/);
	const [out] = await harness({ params, respond, continueOnFail: true }).run();
	assert.match(out[0].json.error, /Wrong username or password/);
});

test('Invoice builder charges VAT by default and can turn it off per line', async () => {
	const h = harness({
		params: {
			resource: 'invoice',
			operation: 'create',
			invoiceType: 'deal_invoice',
			invoiceCreateMode: 'builder',
			invoiceCustomerId: 'cust',
			invoiceDate: '17/09/2026',
			invoiceCurrency: 'NIS',
			invoiceCompanyIndex: '0',
			invoiceItems: {
				item: [
					{ itemId: 'a', quantity: 1, unitPrice: 10, taxPercent: 18 },
					{ itemId: 'b', quantity: 2, unitPrice: 5, taxPercent: 18, chargeVat: false },
				],
			},
		},
		respond: () => ({ body: { success: 'ok', results: { _id: 'inv1' } } }),
	});
	await h.run();
	const call = h.calls[0];
	assert.match(call.url, /\/invoices\/api\/create_invoice$/);
	assert.equal(call.body.type, 'deal_invoice');
	const [withVat, noVat] = call.body.form_data.find((g) => g.group_data_name === 'origami_invoices_items').data;
	assert.equal(withVat.origami_invoices_item_include_tax_fld, '1');
	assert.equal(withVat.origami_invoices_item_total_fld, 11.8);
	assert.equal(noVat.origami_invoices_item_include_tax_fld, '0');
	assert.equal(noVat.origami_invoices_item_tax_fld, 0);
});

const uploadParams = {
	resource: 'file',
	operation: 'upload',
	entityDataName: 'e_1',
	instanceId: 'rec1',
	fieldDataName: 'fld_9',
	binaryPropertyName: 'data',
};
const uploadItems = [{ json: {}, binary: { data: { fileName: 'a"b.txt', mimeType: 'text/plain' } } }];

test('File upload fails on a non-JSON HTTP error instead of reporting success', async () => {
	const h = harness({
		params: uploadParams,
		items: uploadItems,
		respond: () => ({ statusCode: 403, body: '<html>Forbidden</html>' }),
	});
	await assert.rejects(h.run(), /File upload failed: HTTP 403/);
	assert.equal(h.calls.length, 1);
});

test('File upload sends multipart with a sanitized file name, then attaches the file id', async () => {
	const h = harness({
		params: uploadParams,
		items: uploadItems,
		respond: (_opts, index) =>
			index === 0
				? { body: JSON.stringify({ success: 'ok', results: { _id: 'file1' } }) }
				: { body: { success: 'ok', results: { instances_updated: 1 } } },
	});
	const [out] = await h.run();
	const multipart = h.calls[0].body.toString('utf8');
	assert.match(h.calls[0].headers['Content-Type'], /^multipart\/form-data; boundary=/);
	assert.ok(multipart.includes('filename="a_b.txt"'));
	assert.ok(multipart.includes('name="api_secret"'));
	assert.deepEqual(h.calls[1].body.field, [['fld_9', 'file1', 0]]);
	assert.equal(out[0].json.file_id, 'file1');
});

test('AI tool with Read Only access blocks writes before any HTTP call', async () => {
	const h = harness({
		nodeType: TOOL,
		params: { resource: 'record', operation: 'delete', entityDataName: 'e_1', deleteIds: 'a' },
		respond: () => ({ body: { success: 'ok' } }),
	});
	await assert.rejects(h.run(), /record\.delete is blocked/);
	assert.equal(h.calls.length, 0);
});

test('AI tool with Read Only access still reads', async () => {
	const h = harness({ nodeType: TOOL, params: { resource: 'entity', operation: 'getAll' }, respond: () => ({ body: [] }) });
	await h.run();
	assert.equal(h.calls.length, 1);
});

test('AI tool with Read and Write access may write', async () => {
	const h = harness({
		nodeType: TOOL,
		credentials: { aiAgentAccess: 'readWrite' },
		params: { resource: 'record', operation: 'delete', entityDataName: 'e_1', deleteIds: 'a' },
		respond: () => ({ body: { success: 'ok' } }),
	});
	await h.run();
	assert.deepEqual(h.calls[0].body._ids, ['a']);
});

test('Credential test fails on an HTTP 200 login error and passes on a list', async () => {
	const credentialTest = new Origami().methods.credentialTest.origamiApiTest;
	const credential = { id: '1', name: 'c', type: 'origamiApi', data: { accountName: 'stage', username: 'u', apiSecret: 's' } };
	const bad = await credentialTest.call(
		{ helpers: { request: async () => ({ error: { type: 'login', message: 'Wrong username or password' } }) } },
		credential,
	);
	assert.equal(bad.status, 'Error');
	assert.match(bad.message, /Wrong username or password/);
	const good = await credentialTest.call({ helpers: { request: async () => [{ entity_data_name: 'e_1' }] } }, credential);
	assert.equal(good.status, 'OK');
	const noAccount = await credentialTest.call({ helpers: { request: async () => [] } }, { ...credential, data: { username: 'u' } });
	assert.equal(noAccount.status, 'Error');
});

function webhookCtx(headers) {
	const response = {};
	return {
		response,
		ctx: {
			getNodeParameter: (name) => ({ secretHeader: 'X-Origami-Secret', secretValue: 'shh' })[name],
			getHeaderData: () => headers,
			getBodyData: () => ({ ping: 1 }),
			getResponseObject: () => ({
				status(code) {
					response.status = code;
					return this;
				},
				json(body) {
					response.body = body;
				},
			}),
			getNode: () => ({ name: 'Origami Trigger' }),
		},
	};
}

test('Trigger returns 401 on a wrong secret and passes the body on the right one', async () => {
	const trigger = new OrigamiTrigger();
	const wrong = webhookCtx({ 'x-origami-secret': 'nope' });
	const denied = await trigger.webhook.call(wrong.ctx);
	assert.equal(wrong.response.status, 401);
	assert.equal(denied.noWebhookResponse, true);
	const right = webhookCtx({ 'x-origami-secret': 'shh' });
	const allowed = await trigger.webhook.call(right.ctx);
	assert.deepEqual(allowed.workflowData, [[{ json: { ping: 1 } }]]);
});

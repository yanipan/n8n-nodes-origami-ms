// Execute-level tests against the compiled node (run `npm run test:execute`, which builds first).
// The n8n context is mocked; every HTTP call is captured so request bodies can be asserted.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { executeOrigami } = require('../dist/nodes/Origami/execute.js');
const { Origami } = require('../dist/nodes/Origami/Origami.node.js');
const { OrigamiTrigger } = require('../dist/nodes/OrigamiTrigger/OrigamiTrigger.node.js');
const { OrigamiApi } = require('../dist/credentials/OrigamiApi.credentials.js');

// Mirrors n8n's generic credential auth: each authenticate property is assigned onto the request options.
function applyGenericAuth(opts, credentials) {
	const resolve = (v) => (typeof v === 'string' && v.startsWith('={{$credentials.') ? credentials[v.slice(16, -2)] : v);
	for (const [outer, props] of Object.entries(new OrigamiApi().authenticate.properties)) {
		if (!opts[outer]) opts[outer] = {};
		for (const [key, value] of Object.entries(props)) opts[outer][key] = resolve(value);
	}
}

const NODE = 'n8n-nodes-origami-ms.origami';
const TOOL = 'n8n-nodes-origami-ms.origamiTool';

function harness({ params, respond, items = [{ json: {} }], nodeType = NODE, credentials = {}, continueOnFail = false }) {
	const calls = [];
	const plainCalls = [];
	const hints = [];
	const creds = { accountName: 'stage', customBaseUrl: '', username: 'u', apiSecret: 's', ...credentials };
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
		getCredentials: async () => ({ ...creds }),
		continueOnFail: () => continueOnFail,
		addExecutionHints: (...h) => hints.push(...h),
		helpers: {
			httpRequestWithAuthentication: async (_type, opts) => {
				applyGenericAuth(opts, creds);
				return reply(opts);
			},
			httpRequest: async (opts) => {
				plainCalls.push(opts);
				return reply(opts);
			},
			getBinaryDataBuffer: async () => Buffer.from('hello'),
			prepareBinaryData: async (buffer, fileName, mimeType) => ({ data: buffer.toString('base64'), fileName, mimeType }),
		},
	};
	return { run: () => executeOrigami.call(ctx), calls, plainCalls, hints };
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

// n8n 2.39.2 workflow-execute.ts handleNodeErrorOutput:
// an item leaves the success branch only when item.error is set, or when every json
// key is one of error, message, details. Extra keys (description, httpCode, ...) do
// not route unless item.error is set. continueOnFail() is true for both Continue modes.
function routesByErrorProperty(item) {
	return Boolean(item.error);
}
function routesByJsonFallback(item) {
	return Boolean(item.json?.error) && Object.keys(item.json).every((key) => ['error', 'message', 'details'].includes(key));
}

test('HTTP 200 with an error body fails, or becomes an error item with Continue On Fail', async () => {
	const params = { resource: 'entity', operation: 'getAll' };
	const respond = () => ({ statusCode: 200, body: { error: { type: 'login', message: 'Wrong username or password' } } });
	await assert.rejects(harness({ params, respond }).run(), (err) => {
		assert.equal(err.name, 'NodeApiError');
		assert.equal(err.httpCode ?? null, null);
		assert.match(err.message, /Wrong username or password/);
		assert.match(err.description, /entity\.getAll/);
		assert.match(err.description, /item 0/);
		assert.match(err.description, /Wrong username or password/);
		assert.equal(err.context.itemIndex, 0);
		return true;
	});
	const [out] = await harness({ params, respond, continueOnFail: true }).run();
	assert.equal(out.length, 1);
	assert.match(out[0].json.error, /Wrong username or password/);
	assert.match(out[0].json.description, /entity\.getAll/);
	assert.match(out[0].json.origamiError, /Wrong username or password/);
	assert.equal('httpCode' in out[0].json, false);
	assert.equal(out[0].json.resource, 'entity');
	assert.equal(out[0].json.operation, 'getAll');
	assert.equal(out[0].json.itemIndex, 0);
	assert.deepEqual(out[0].pairedItem, { item: 0 });
	assert.equal(routesByJsonFallback(out[0]), false);
	assert.equal(routesByErrorProperty(out[0]), true);
});

test('Stop Workflow keeps NodeApiError httpCode and a description', async () => {
	const h = harness({
		params: { resource: 'record', operation: 'get', entityDataName: 'e_1', instanceId: 'abc', simplify: false },
		respond: () => ({ statusCode: 403, body: { error: 'no access' } }),
	});
	await assert.rejects(h.run(), (err) => {
		assert.equal(err.name, 'NodeApiError');
		assert.notEqual(err.name, 'NodeOperationError');
		assert.equal(err.httpCode, '403');
		assert.match(err.message, /HTTP 403/);
		assert.match(err.description, /HTTP 403/);
		assert.match(err.description, /no access/);
		assert.match(err.description, /record\.get/);
		assert.match(err.description, /item 0/);
		assert.equal(err.context.itemIndex, 0);
		return true;
	});
});

test('Continue keeps successes and puts the failed middle item on the error-output shape', async () => {
	const h = harness({
		params: { resource: 'record', operation: 'get', entityDataName: 'e_1', instanceId: 'abc', simplify: false },
		items: [{ json: {} }, { json: {} }, { json: {} }],
		continueOnFail: true,
		respond: (_opts, index) =>
			index === 1
				? { statusCode: 500, body: { error: { type: 'server', message: 'boom' } } }
				: { body: [{ _id: 'ok', n: index }] },
	});
	const [out] = await h.run();
	assert.equal(out.length, 3);
	assert.equal(out[0].json._id, 'ok');
	assert.equal(out[0].json.n, 0);
	assert.equal(out[0].error, undefined);
	assert.equal(routesByErrorProperty(out[0]), false);
	assert.deepEqual(out[0].pairedItem, { item: 0 });
	assert.equal(out[2].json._id, 'ok');
	assert.equal(out[2].json.n, 2);
	assert.deepEqual(out[2].pairedItem, { item: 2 });
	const failed = out[1];
	assert.deepEqual(failed.pairedItem, { item: 1 });
	assert.match(failed.json.error, /boom/);
	assert.match(failed.json.description, /HTTP 500/);
	assert.match(failed.json.description, /record\.get/);
	assert.match(failed.json.description, /item 1/);
	assert.equal(failed.json.httpCode, '500');
	assert.match(String(failed.json.origamiError), /boom/);
	assert.equal(failed.json.resource, 'record');
	assert.equal(failed.json.operation, 'get');
	assert.equal(failed.json.itemIndex, 1);
	assert.deepEqual(JSON.parse(JSON.stringify(failed.json)), failed.json);
	assert.equal(routesByJsonFallback(failed), false);
	assert.equal(routesByErrorProperty(failed), true);
	assert.equal(failed.error.httpCode, '500');
	assert.equal(failed.error.name, 'NodeApiError');
});

test('Continue on a local failure still fills the error item', async () => {
	const h = harness({
		params: { resource: 'record', operation: 'get', entityDataName: 'e_1', instanceId: 'missing', simplify: false },
		continueOnFail: true,
		respond: () => ({ body: [] }),
	});
	const [out] = await h.run();
	assert.match(out[0].json.error, /not found/);
	assert.match(out[0].json.description, /record\.get/);
	assert.match(out[0].json.description, /item 0/);
	assert.equal('httpCode' in out[0].json, false);
	assert.equal('origamiError' in out[0].json, false);
	assert.equal(out[0].json.resource, 'record');
	assert.equal(out[0].json.operation, 'get');
	assert.equal(out[0].json.itemIndex, 0);
	assert.deepEqual(out[0].pairedItem, { item: 0 });
	assert.equal(routesByJsonFallback(out[0]), false);
	assert.equal(routesByErrorProperty(out[0]), true);
	assert.equal(out[0].error.name, 'NodeOperationError');
});

test('AI tool Continue On Fail reports a blocked write and does not call HTTP', async () => {
	const h = harness({
		nodeType: TOOL,
		continueOnFail: true,
		params: { resource: 'record', operation: 'delete', entityDataName: 'e_1', deleteIds: 'a' },
		respond: () => ({ body: { success: 'ok' } }),
	});
	const [out] = await h.run();
	assert.match(out[0].json.error, /record\.delete is blocked/);
	assert.equal(out[0].json.resource, 'record');
	assert.equal(out[0].json.operation, 'delete');
	assert.equal(h.calls.length, 0);
	assert.equal(routesByErrorProperty(out[0]), true);
});

test('loadOptions throws a readable NodeApiError when the HTTP client fails', async () => {
	const node = new Origami();
	await assert.rejects(
		node.methods.loadOptions.getEntities.call({
			getNode: () => ({ name: 'Origami', type: NODE, typeVersion: 1 }),
			getCredentials: async () => ({ accountName: 'stage', username: 'u', apiSecret: 's' }),
			helpers: {
				httpRequestWithAuthentication: async () => {
					throw new Error('socket hang up');
				},
			},
		}),
		(err) => {
			assert.equal(err.name, 'NodeApiError');
			assert.match(err.message, /socket hang up/);
			return true;
		},
	);
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

test('File upload fails on an HTTP 200 Origami error body', async () => {
	const h = harness({
		params: uploadParams,
		items: uploadItems,
		respond: () => ({ body: JSON.stringify({ error: { type: 'validation', message: 'The filetype you are attempting to upload is not allowed.' } }) }),
	});
	await assert.rejects(h.run(), /filetype you are attempting to upload is not allowed/);
	assert.equal(h.calls.length, 1);
});

test('File upload sends authenticated multipart with credential fields as parts, then attaches the file id', async () => {
	const h = harness({
		params: uploadParams,
		items: uploadItems,
		respond: (_opts, index) =>
			index === 0
				? { body: JSON.stringify({ success: 'ok', results: { _id: 'file1' } }) }
				: { body: { success: 'ok', results: { instances_updated: 1 } } },
	});
	const [out] = await h.run();
	assert.equal(h.plainCalls.length, 0);
	const upload = h.calls[0];
	assert.match(upload.url, /^https:\/\/stage\.origami\.ms\/entities\/api\/upload_file\/format\/json$/);
	assert.ok(upload.body instanceof FormData);
	assert.equal(Object.keys(upload.headers).find((k) => k.toLowerCase() === 'content-type'), undefined);
	assert.equal(upload.body.get('username'), 'u');
	assert.equal(upload.body.get('api_secret'), 's');
	assert.equal(upload.body.get('entity_data_name'), 'e_1');
	assert.equal(upload.body.get('instance_id'), 'rec1');
	assert.equal(upload.body.get('field_data_name'), 'fld_9');
	const file = upload.body.get('file');
	assert.equal(file.name, 'a_b.txt');
	assert.equal(file.type, 'text/plain');
	assert.equal(await file.text(), 'hello');
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

// Mirrors n8n's credential tester: a responseSuccessBody rule fails the test when get(body, key) === value.
function failedRule(rules, body) {
	for (const rule of rules) {
		if (rule.type !== 'responseSuccessBody') continue;
		const actual = rule.properties.key.split('.').reduce((obj, key) => (obj == null ? undefined : obj[key]), body);
		if (actual === rule.properties.value) return rule.properties.message;
	}
	return undefined;
}

test('Credential test is declarative and fails on an HTTP 200 login error body', () => {
	const node = new Origami();
	assert.equal(node.description.credentials[0].testedBy, undefined);
	assert.equal(node.methods.credentialTest, undefined);
	const { request, rules } = new OrigamiApi().test;
	assert.equal(request.method, 'POST');
	assert.equal(request.url, '/entities/api/entities_list/format/json');
	assert.equal(failedRule(rules, { error: { type: 'login', message: 'Wrong username or password' } }), 'Wrong username or API secret');
	assert.equal(failedRule(rules, [{ entity_data_name: 'e_1' }]), undefined);
	assert.equal(failedRule(rules, { success: 'ok' }), undefined);
});

test('Credential test base URL matches getBaseUrl', () => {
	const { baseURL } = new OrigamiApi().test.request;
	assert.match(baseURL, /^=\{\{.*\}\}$/);
	const evaluate = new Function('$credentials', `return ${baseURL.slice(3, -2)};`);
	assert.equal(evaluate({ accountName: 'stage' }), 'https://stage.origami.ms');
	assert.equal(evaluate({ accountName: ' stage ', customBaseUrl: '' }), 'https://stage.origami.ms');
	assert.equal(evaluate({ accountName: 'stage', customBaseUrl: ' https://crm.example.com// ' }), 'https://crm.example.com');
	assert.equal(evaluate({ accountName: 'stage', customBaseUrl: '   ' }), 'https://stage.origami.ms');
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

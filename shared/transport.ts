import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { getBaseUrl } from './baseUrl';
import { extractOrigamiError, isHttpErrorStatus } from './errors';
import { sanitizeMultipartName } from './multipart';

export const BROWSER_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

type Ctx = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions;

function failureText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Throws NodeApiError. httpCode is set only for HTTP status >= 400 so a 200 {error} body is not given a fake status. */
function raiseApiError(
	ctx: Ctx,
	opts: { message: string; httpStatus?: number; origamiError?: string; endpoint?: string },
): never {
	const httpCode =
		opts.httpStatus !== undefined && isHttpErrorStatus(opts.httpStatus) ? String(opts.httpStatus) : undefined;
	const parts: string[] = [];
	if (httpCode) parts.push(`HTTP ${httpCode}`);
	if (opts.origamiError) parts.push(`Origami: ${opts.origamiError}`);
	if (opts.endpoint) parts.push(opts.endpoint);
	let description = parts.join('. ');
	if (!description || description === opts.message) {
		description = opts.endpoint ? `${opts.message} (${opts.endpoint})` : `${opts.message}.`;
	}
	const error = new NodeApiError(
		ctx.getNode(),
		{ message: opts.message },
		{ message: opts.message, description, httpCode },
	);
	if (opts.origamiError) error.context.origamiError = opts.origamiError;
	throw error;
}

function rethrowReadable(ctx: Ctx, error: unknown, endpoint: string): never {
	if (error instanceof NodeApiError || error instanceof NodeOperationError) throw error;
	const message = `Origami request failed: ${failureText(error)}`;
	throw new NodeApiError(ctx.getNode(), { message }, { message, description: endpoint });
}

export async function origamiApiRequest(
	this: Ctx,
	endpoint: string,
	body: IDataObject = {},
): Promise<unknown> {
	try {
		const credentials = await this.getCredentials('origamiApi');
		const baseUrl = getBaseUrl({
			accountName: credentials.accountName as string | undefined,
			customBaseUrl: credentials.customBaseUrl as string | undefined,
		});
		const payload: IDataObject = {
			username: credentials.username,
			api_secret: credentials.apiSecret,
			...body,
		};

		const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'origamiApi', {
			method: 'POST',
			url: `${baseUrl}${endpoint}`,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				'User-Agent': BROWSER_UA,
			},
			body: payload,
			json: true,
			ignoreHttpStatusErrors: true,
			returnFullResponse: true,
		})) as { statusCode?: number; body?: unknown };

		const status = response.statusCode ?? 200;
		const data = response.body;
		const apiError = extractOrigamiError(data);
		if (isHttpErrorStatus(status)) {
			const snippet = typeof data === 'string' ? data.slice(0, 800) : JSON.stringify(data)?.slice(0, 800);
			raiseApiError(this, {
				message: `HTTP ${status} on ${endpoint}. 403 is often a malformed body or missing /format/json, not a login failure. ${snippet ?? ''}`,
				httpStatus: status,
				origamiError: apiError,
				endpoint,
			});
		}
		if (apiError) {
			raiseApiError(this, { message: apiError, origamiError: apiError, endpoint });
		}
		return data;
	} catch (error) {
		rethrowReadable(this, error, endpoint);
	}
}

export async function origamiFileDownload(
	this: IExecuteFunctions,
	fileId: string,
): Promise<{ buffer: Buffer; contentType: string }> {
	const credentials = await this.getCredentials('origamiApi');
	const baseUrl = getBaseUrl({
		accountName: credentials.accountName as string | undefined,
		customBaseUrl: credentials.customBaseUrl as string | undefined,
	});
	const endpoint = `/entities/api/file?f=${encodeURIComponent(fileId)}`;
	let response: { statusCode?: number; body?: unknown; headers?: Record<string, string> };
	try {
		response = (await this.helpers.httpRequestWithAuthentication.call(this, 'origamiApi', {
			method: 'POST',
			url: `${baseUrl}${endpoint}`,
			headers: {
				Accept: '*/*',
				'Content-Type': 'application/json',
				'User-Agent': BROWSER_UA,
			},
			body: {},
			json: true,
			encoding: 'arraybuffer',
			ignoreHttpStatusErrors: true,
			returnFullResponse: true,
		})) as { statusCode?: number; body?: unknown; headers?: Record<string, string> };
	} catch (error) {
		rethrowReadable(this, error, endpoint);
	}

	const status = response.statusCode ?? 200;
	if (isHttpErrorStatus(status)) {
		raiseApiError(this, {
			message: `File download HTTP ${status}`,
			httpStatus: status,
			endpoint,
		});
	}
	const body = response.body;
	const downloadError =
		body && typeof body === 'object' && !Buffer.isBuffer(body) ? extractOrigamiError(body) : undefined;
	if (downloadError) {
		raiseApiError(this, { message: downloadError, origamiError: downloadError, endpoint });
	}
	let buffer: Buffer;
	if (Buffer.isBuffer(body)) {
		buffer = body;
	} else if (body instanceof ArrayBuffer) {
		buffer = Buffer.from(new Uint8Array(body));
	} else if (typeof body === 'string') {
		buffer = Buffer.from(body);
	} else {
		buffer = Buffer.from(JSON.stringify(body ?? ''));
	}
	const contentType = response.headers?.['content-type'] ?? 'application/octet-stream';
	return { buffer, contentType };
}

/**
 * Multipart body for file uploads. n8n's generic credential auth sets `username` and `api_secret`
 * as properties on the request body; these setters turn them into real form fields.
 */
class OrigamiUploadForm extends FormData {
	set username(value: unknown) {
		this.set('username', String(value ?? ''));
	}

	set api_secret(value: unknown) {
		this.set('api_secret', String(value ?? ''));
	}
}

export async function origamiUploadFile(
	this: IExecuteFunctions,
	fields: {
		entity_data_name: string;
		instance_id: string;
		field_data_name: string;
		fileName: string;
		fileBuffer: Buffer;
		mimeType?: string;
	},
): Promise<unknown> {
	const credentials = await this.getCredentials('origamiApi');
	const baseUrl = getBaseUrl({
		accountName: credentials.accountName as string | undefined,
		customBaseUrl: credentials.customBaseUrl as string | undefined,
	});
	const form = new OrigamiUploadForm();
	form.append('entity_data_name', fields.entity_data_name);
	form.append('instance_id', fields.instance_id);
	form.append('field_data_name', fields.field_data_name);
	form.append(
		'file',
		new Blob([new Uint8Array(fields.fileBuffer)], { type: fields.mimeType || 'application/octet-stream' }),
		sanitizeMultipartName(fields.fileName),
	);
	const endpoint = '/entities/api/upload_file/format/json';
	let response: { statusCode?: number; body?: unknown };
	try {
		// No Content-Type header: the HTTP client sets multipart/form-data with the boundary and length.
		response = (await this.helpers.httpRequestWithAuthentication.call(this, 'origamiApi', {
			method: 'POST',
			url: `${baseUrl}${endpoint}`,
			headers: {
				'User-Agent': BROWSER_UA,
				Accept: 'application/json',
			},
			body: form,
			ignoreHttpStatusErrors: true,
			returnFullResponse: true,
		})) as { statusCode?: number; body?: unknown };
	} catch (error) {
		rethrowReadable(this, error, endpoint);
	}

	const status = response.statusCode ?? 200;
	let parsed: unknown = response.body;
	if (Buffer.isBuffer(parsed)) parsed = parsed.toString('utf8');
	if (typeof parsed === 'string') {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			/* keep raw text for the error below */
		}
	}
	const apiError = parsed && typeof parsed === 'object' ? extractOrigamiError(parsed) : undefined;
	if (isHttpErrorStatus(status) || typeof parsed !== 'object' || parsed === null) {
		const snippet = typeof parsed === 'string' ? parsed.slice(0, 300) : JSON.stringify(parsed)?.slice(0, 300);
		raiseApiError(this, {
			message: `File upload failed: HTTP ${status} on ${endpoint}. ${snippet ?? ''}`,
			httpStatus: status,
			origamiError: apiError,
			endpoint,
		});
	}
	if (apiError) {
		raiseApiError(this, { message: apiError, origamiError: apiError, endpoint });
	}
	return parsed;
}

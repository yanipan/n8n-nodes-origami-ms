import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { getBaseUrl } from './baseUrl';
import { extractOrigamiError, isHttpErrorStatus } from './errors';
import { buildMultipartBody } from './multipart';

export const BROWSER_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

type Ctx = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions;

export async function origamiApiRequest(
	this: Ctx,
	endpoint: string,
	body: IDataObject = {},
): Promise<unknown> {
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
	if (isHttpErrorStatus(status)) {
		const snippet = typeof data === 'string' ? data.slice(0, 800) : JSON.stringify(data)?.slice(0, 800);
		throw new NodeApiError(this.getNode(), {
			message: `HTTP ${status} on ${endpoint}. 403 is often a malformed body or missing /format/json, not a login failure. ${snippet ?? ''}`,
		} as never);
	}
	const apiError = extractOrigamiError(data);
	if (apiError) {
		throw new NodeApiError(this.getNode(), { message: apiError } as never);
	}
	return data;
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
	const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'origamiApi', {
		method: 'POST',
		url: `${baseUrl}/entities/api/file?f=${encodeURIComponent(fileId)}`,
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

	const status = response.statusCode ?? 200;
	if (isHttpErrorStatus(status)) {
		throw new NodeApiError(this.getNode(), { message: `File download HTTP ${status}` } as never);
	}
	const body = response.body;
	if (body && typeof body === 'object' && !Buffer.isBuffer(body) && extractOrigamiError(body)) {
		throw new NodeApiError(this.getNode(), { message: extractOrigamiError(body)! } as never);
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
	const boundary = `----OrigamiBoundary${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
	const body = buildMultipartBody(
		boundary,
		{
			username: String(credentials.username ?? ''),
			api_secret: String(credentials.apiSecret ?? ''),
			entity_data_name: fields.entity_data_name,
			instance_id: fields.instance_id,
			field_data_name: fields.field_data_name,
		},
		{ fieldName: 'file', fileName: fields.fileName, mimeType: fields.mimeType, buffer: fields.fileBuffer },
	);
	const endpoint = '/entities/api/upload_file/format/json';
	// Plain httpRequest (not WithAuthentication): generic auth would try to merge
	// username/api_secret into a Buffer body. Credentials are already in the multipart parts.
	// eslint-disable-next-line @n8n/community-nodes/no-http-request-with-manual-auth
	const response = (await this.helpers.httpRequest({
		method: 'POST',
		url: `${baseUrl}${endpoint}`,
		headers: {
			'User-Agent': BROWSER_UA,
			Accept: 'application/json',
			'Content-Type': `multipart/form-data; boundary=${boundary}`,
			'Content-Length': body.length,
		},
		body,
		ignoreHttpStatusErrors: true,
		returnFullResponse: true,
	})) as { statusCode?: number; body?: unknown };

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
	if (isHttpErrorStatus(status) || typeof parsed !== 'object' || parsed === null) {
		const snippet = typeof parsed === 'string' ? parsed.slice(0, 300) : JSON.stringify(parsed)?.slice(0, 300);
		throw new NodeApiError(this.getNode(), {
			message: `File upload failed: HTTP ${status} on ${endpoint}. ${snippet ?? ''}`,
		} as never);
	}
	const apiError = extractOrigamiError(parsed);
	if (apiError) {
		throw new NodeApiError(this.getNode(), { message: apiError } as never);
	}
	return parsed;
}

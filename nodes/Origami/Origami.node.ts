import type {
	ICredentialTestFunctions,
	ICredentialsDecrypted,
	IExecuteFunctions,
	INodeCredentialTestResult,
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { origamiProperties } from './properties';
import { executeOrigami } from './execute';
import { BROWSER_UA, origamiApiRequest } from '../../shared/transport';
import { getBaseUrl } from '../../shared/baseUrl';
import { extractOrigamiError } from '../../shared/errors';
import { entityOptions, fieldOptions, groupOptions } from '../../shared/structure';
import { extractEntityId } from '../../shared/entityParam';

function asString(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function readPath(root: unknown, path: string): unknown {
	const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
	let current: unknown = root;
	for (const part of parts) {
		if (current == null) return undefined;
		if (Array.isArray(current)) {
			const index = /^\d+$/.test(part) ? Number(part) : 0;
			current = current[index];
			if (!/^\d+$/.test(part) && current && typeof current === 'object') {
				current = (current as Record<string, unknown>)[part];
			}
			continue;
		}
		if (typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function firstParam(ctx: ILoadOptionsFunctions, paths: string[]): string {
	for (const path of paths) {
		try {
			const value = ctx.getCurrentNodeParameter(path);
			const fromLocator = extractEntityId(value);
			if (fromLocator) return fromLocator;
			const direct = asString(value);
			if (direct) return direct;
			if (value && typeof value === 'object') {
				const nested =
					asString(readPath(value, 'value')) ||
					asString(readPath(value, 'field.0.groupDataName')) ||
					asString(readPath(value, 'field.groupDataName')) ||
					asString(readPath(value, '0.groupDataName'));
				if (nested) return nested;
			}
		} catch {
			/* path not present on this node */
		}
	}
	const extra = ctx as ILoadOptionsFunctions & { getCurrentNodeParameters?: () => unknown };
	const all = extra.getCurrentNodeParameters?.();
	if (all) {
		for (const path of paths) {
			const found = asString(readPath(all, path));
			if (found) return found;
		}
		const fromCollection =
			asString(readPath(all, 'createFields.field.0.groupDataName')) ||
			asString(readPath(all, 'createFields.field.groupDataName'));
		if (fromCollection) return fromCollection;
	}
	return '';
}

async function loadStructure(ctx: ILoadOptionsFunctions): Promise<unknown> {
	const entity = extractEntityId(firstParam(ctx, ['entityDataName'])) || firstParam(ctx, ['entityDataName.value']);
	if (!entity) return {};
	return origamiApiRequest.call(ctx, '/entities/api/entity_structure/format/json', {
		entity_data_name: entity,
	});
}

export class Origami implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Origami',
		name: 'origami',
		icon: { light: 'file:origami.png', dark: 'file:origami.dark.png' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Origami.ms CRM: records, invoices, files, and communications. Search entities, then Get Structure before writes.',
		defaults: { name: 'Origami' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'origamiApi', required: true, testedBy: 'origamiApiTest' }],
		properties: origamiProperties,
	};

	methods = {
		credentialTest: {
			// Origami answers a bad login with HTTP 200 + {error}, which n8n's declarative test counts as success.
			async origamiApiTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const data = credential.data ?? {};
				let baseUrl: string;
				try {
					baseUrl = getBaseUrl({
						accountName: data.accountName as string | undefined,
						customBaseUrl: data.customBaseUrl as string | undefined,
					});
				} catch (error) {
					return { status: 'Error', message: (error as Error).message };
				}
				try {
					// ICredentialTestFunctions only exposes request(); httpRequest is not available here.
					// eslint-disable-next-line @n8n/community-nodes/no-deprecated-workflow-functions
					const response = await this.helpers.request({
						method: 'POST',
						uri: `${baseUrl}/entities/api/entities_list/format/json`,
						headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
						body: { username: data.username, api_secret: data.apiSecret },
						json: true,
					});
					const apiError = extractOrigamiError(response);
					if (apiError) return { status: 'Error', message: apiError };
					if (response === null || typeof response !== 'object') {
						return { status: 'Error', message: 'Unexpected non-JSON response. Check Account Name / Custom Base URL.' };
					}
					return { status: 'OK', message: 'Connection successful' };
				} catch (error) {
					return { status: 'Error', message: `Request failed: ${(error as Error).message}` };
				}
			},
		},
		listSearch: {
			async searchEntities(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const response = await origamiApiRequest.call(this, '/entities/api/entities_list/format/json');
				const query = (filter || '').toLowerCase();
				const results = entityOptions(response)
					.filter(
						(option) =>
							!query ||
							option.name.toLowerCase().includes(query) ||
							option.value.toLowerCase().includes(query),
					)
					.slice(0, 80)
					.map((option) => ({ name: option.name, value: option.value }));
				return { results };
			},
		},
		loadOptions: {
			async getEntities(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await origamiApiRequest.call(this, '/entities/api/entities_list/format/json');
				return entityOptions(response);
			},
			async getGroups(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const structure = await loadStructure(this);
				return groupOptions(structure);
			},
			async getRepeatableGroups(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const structure = await loadStructure(this);
				return groupOptions(structure, { repeatableOnly: true });
			},
			async getFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const structure = await loadStructure(this);
				const groupName = firstParam(this, [
					'createFields.field.groupDataName',
					'groupDataName',
				]);
				return fieldOptions(structure, { groupName, writableOnly: true });
			},
			async getAllFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const structure = await loadStructure(this);
				return fieldOptions(structure, { includeGroup: true });
			},
			async getWritableFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const structure = await loadStructure(this);
				return fieldOptions(structure, { writableOnly: true, includeGroup: true });
			},
			async getFileFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const structure = await loadStructure(this);
				return fieldOptions(structure, { fileOnly: true, includeGroup: true });
			},
		},
	};

	async execute(this: IExecuteFunctions) {
		return executeOrigami.call(this);
	}
}

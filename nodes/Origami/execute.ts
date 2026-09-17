import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { origamiApiRequest, origamiFileDownload, origamiUploadFile } from '../../shared/transport';
import { flattenRecord } from '../../shared/flatten';
import { unwrapRecords } from '../../shared/unwrap';
import {
	DEFAULT_PAGE_SIZE,
	DEFAULT_RETURN_ALL_CAP,
	STABLE_ORDER_BY,
	collectAllPages,
	limitPair,
} from '../../shared/pagination';
import { aiAccessViolation, isToolNodeType } from '../../shared/aiAccess';
import { extractFields, extractGroups, summarizeStructure } from '../../shared/structure';
import { isWritableFieldType } from '../../shared/fieldTypes';
import { buildInvoiceItem, canCreateInvoiceType, invoiceStructure } from '../../shared/invoiceCatalog';
import { applyForceWorkflowAsync, applyReadFlags, buildRecordFilter } from '../../shared/apiFlags';
import { extractEntityId } from '../../shared/entityParam';

function parseJsonParam(this: IExecuteFunctions, name: string, itemIndex: number, fallback: unknown): unknown {
	const raw = this.getNodeParameter(name, itemIndex);
	if (typeof raw !== 'string') return raw ?? fallback;
	try {
		return JSON.parse(raw);
	} catch {
		throw new NodeOperationError(this.getNode(), `${name} must be valid JSON`, { itemIndex });
	}
}

function maxRecords(this: IExecuteFunctions, itemIndex: number): number {
	const value = Number(this.getNodeParameter('maxRecords', itemIndex, DEFAULT_RETURN_ALL_CAP));
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_RETURN_ALL_CAP;
}

function maybeSimplify(record: Record<string, unknown>, simplify: boolean): IDataObject {
	return (simplify ? flattenRecord(record) : record) as IDataObject;
}

function entityName(this: IExecuteFunctions, itemIndex: number): string {
	const id = extractEntityId(this.getNodeParameter('entityDataName', itemIndex));
	if (!id) {
		throw new NodeOperationError(this.getNode(), 'Select an entity', { itemIndex });
	}
	return id;
}

async function fetchAll(
	ctx: IExecuteFunctions,
	endpoint: string,
	baseBody: IDataObject,
	cap: number,
): Promise<Array<Record<string, unknown>>> {
	const { records, capped } = await collectAllPages(
		async (skip, count) => {
			const page = await origamiApiRequest.call(ctx, endpoint, { ...baseBody, limit: limitPair(skip, count) });
			return unwrapRecords(page);
		},
		{ pageSize: DEFAULT_PAGE_SIZE, cap },
	);
	if (capped) {
		ctx.addExecutionHints({
			message: `Return All stopped at Max Records (${cap}). Origami has more rows: raise Max Records or narrow the filter.`,
			type: 'warning',
			location: 'outputPane',
		});
	}
	return records;
}

export async function executeOrigami(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	const items = this.getInputData();
	const returnData: INodeExecutionData[] = [];
	const nodeType = this.getNode().type;
	let aiAgentAccess: unknown;

	for (let i = 0; i < items.length; i++) {
		try {
			const resource = this.getNodeParameter('resource', i) as string;
			const operation = this.getNodeParameter('operation', i) as string;
			if (isToolNodeType(nodeType)) {
				aiAgentAccess ??= (await this.getCredentials('origamiApi')).aiAgentAccess ?? 'readOnly';
				const violation = aiAccessViolation({ nodeType, resource, operation, access: aiAgentAccess });
				if (violation) throw new NodeOperationError(this.getNode(), violation, { itemIndex: i });
			}

			if (resource === 'entity' && operation === 'getAll') {
				const response = await origamiApiRequest.call(this, '/entities/api/entities_list/format/json');
				const list = Array.isArray(response) ? response : unwrapRecords(response).records;
				for (const row of list) {
					returnData.push({ json: row as IDataObject, pairedItem: { item: i } });
				}
				continue;
			}

			if (resource === 'entity' && operation === 'getStructure') {
				const entityDataName = entityName.call(this, i);
				const response = await origamiApiRequest.call(this, '/entities/api/entity_structure/format/json', {
					entity_data_name: entityDataName,
				});
				returnData.push({
					json: summarizeStructure(response, entityDataName) as unknown as IDataObject,
					pairedItem: { item: i },
				});
				continue;
			}

			if (resource === 'record' && operation === 'getFormTemplate') {
				const entityDataName = entityName.call(this, i);
				const structure = await origamiApiRequest.call(this, '/entities/api/entity_structure/format/json', {
					entity_data_name: entityDataName,
				});
				const formTemplate = [];
				for (const group of extractGroups(structure)) {
					const data: IDataObject = {};
					for (const field of extractFields(group)) {
						const typeName = field.field_type_name ?? field.field_type;
						if (!field.field_data_name || !isWritableFieldType(typeName)) continue;
						const required = field.required === '1' || field.required === 1 || field.required === true;
						data[field.field_data_name] = `[${field.field_name ?? field.field_data_name} (${typeName ?? 'text'})${required ? ' *required' : ''}]`;
					}
					if (Object.keys(data).length && group.group_data_name) {
						formTemplate.push({ group_data_name: group.group_data_name, data: [data] });
					}
				}
				returnData.push({ json: { form_data: formTemplate }, pairedItem: { item: i } });
				continue;
			}

			if (resource === 'record' && (operation === 'get' || operation === 'getAll')) {
				const entityDataName = entityName.call(this, i);
				const simplify = this.getNodeParameter('simplify', i, true) as boolean;
				const useProtected = this.getNodeParameter('useProtected', i, false) as boolean;
				const endpoint = useProtected
					? '/entities/api/instance_data_protected/format/json'
					: '/entities/api/instance_data/format/json';
				const body: IDataObject = { entity_data_name: entityDataName };
				applyReadFlags(body, {
					normalized: this.getNodeParameter('normalized', i, true) as boolean,
					// Get by ID must find archived records too; with_archive=0 would hide them.
					withArchive: operation === 'get' ? true : (this.getNodeParameter('withArchive', i, false) as boolean),
					returnFields: this.getNodeParameter('returnFields', i, '') as string,
					orderBy: this.getNodeParameter('orderBy', i, '') as string,
					innerOrderBy: this.getNodeParameter('innerOrderBy', i, ''),
					returnGroups: this.getNodeParameter('returnGroups', i, '') as string,
					dontRecalcFormula: this.getNodeParameter('dontRecalcFormula', i, false) as boolean,
					withComments: this.getNodeParameter('withComments', i, false) as boolean,
				});

				if (operation === 'get') {
					const instanceId = this.getNodeParameter('instanceId', i) as string;
					body.filter = [['_id', '=', instanceId]];
					body.limit = [0, 1];
					const response = await origamiApiRequest.call(this, endpoint, body);
					const record = unwrapRecords(response).records[0];
					if (!record) {
						throw new NodeOperationError(this.getNode(), `Record ${instanceId} not found`, { itemIndex: i });
					}
					returnData.push({ json: maybeSimplify(record, simplify), pairedItem: { item: i } });
					continue;
				}

				const filterMode = this.getNodeParameter('filterMode', i, 'none') as string;
				if (filterMode === 'builder') {
					const filtersRoot = this.getNodeParameter('filters', i, {}) as { condition?: Array<{ field: string; operator: string; value: string }> };
					const conditions =
						(Array.isArray(filtersRoot?.condition) && filtersRoot.condition.length
							? filtersRoot.condition
							: (this.getNodeParameter('filters.condition', i, []) as Array<{
									field: string;
									operator: string;
									value: string;
								}>)) || [];
					const triples = conditions
						.filter((c) => c?.field)
						.map((c) => [c.field, c.operator || '=', c.value] as [string, string, unknown]);
					const combine = (this.getNodeParameter('filterCombine', i, 'and') as string) === 'or' ? 'or' : 'and';
					const filter = buildRecordFilter(triples, combine);
					if (filter) body.filter = filter as IDataObject;
				} else if (filterMode === 'json') {
					body.filter = parseJsonParam.call(this, 'filterJson', i, []) as IDataObject;
				}

				const returnAll = this.getNodeParameter('returnAll', i) as boolean;
				let records: Array<Record<string, unknown>>;
				if (returnAll) {
					// Stable order so rows inserted while paging do not shift pages (Origami default is _id desc).
					body.orderby ??= STABLE_ORDER_BY;
					records = await fetchAll(this, endpoint, body, maxRecords.call(this, i));
				} else {
					const skip = this.getNodeParameter('skip', i, 0) as number;
					const limit = this.getNodeParameter('limit', i, 50) as number;
					body.limit = limitPair(skip, limit);
					records = unwrapRecords(await origamiApiRequest.call(this, endpoint, body)).records;
				}
				for (const record of records) {
					returnData.push({ json: maybeSimplify(record, simplify), pairedItem: { item: i } });
				}
				continue;
			}

			if (resource === 'record' && operation === 'create') {
				const entityDataName = entityName.call(this, i);
				const createMode = this.getNodeParameter('createMode', i) as string;
				let form_data: unknown;
				if (createMode === 'builder') {
					const fields = this.getNodeParameter('createFields.field', i, []) as Array<{
						groupDataName: string;
						fieldDataName: string;
						value: string;
					}>;
					const grouped: Record<string, IDataObject> = {};
					for (const field of fields) {
						if (!field.groupDataName || !field.fieldDataName) continue;
						grouped[field.groupDataName] ??= {};
						grouped[field.groupDataName][field.fieldDataName] = field.value;
					}
					form_data = Object.entries(grouped).map(([group_data_name, data]) => ({
						group_data_name,
						data: [data],
					}));
				} else {
					form_data = parseJsonParam.call(this, 'formData', i, []);
				}
				const payload: IDataObject = { entity_data_name: entityDataName, form_data: form_data as IDataObject };
				applyForceWorkflowAsync(payload, this.getNodeParameter('forceWorkflowAsync', i, false) as boolean);
				const bulk = this.getNodeParameter('bulkCreate', i, false) as boolean;
				if (bulk) payload.bulk = '1';
				const response = await origamiApiRequest.call(this, '/entities/api/create_instance/format/json', payload);
				const created = response as { results?: { _id?: string } | Array<{ _id?: string }> };
				if (!bulk && !(created?.results as { _id?: string } | undefined)?._id) {
					throw new NodeOperationError(
						this.getNode(),
						'Create did not return results._id. A required field is probably missing.',
						{ itemIndex: i },
					);
				}
				returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
				continue;
			}

			if (resource === 'record' && operation === 'update') {
				const entityDataName = entityName.call(this, i);
				const instanceId = this.getNodeParameter('instanceId', i) as string;
				const updateMode = this.getNodeParameter('updateMode', i) as string;
				let field: unknown;
				if (updateMode === 'builder') {
					const fields = this.getNodeParameter('updateFields.field', i, []) as Array<{
						fieldDataName: string;
						value: string;
						groupIndex: number;
					}>;
					field = fields.map((f) => [f.fieldDataName, f.value, f.groupIndex ?? 0]);
				} else {
					field = parseJsonParam.call(this, 'updateFieldsJson', i, []);
				}
				const payload: IDataObject = {
					entity_data_name: entityDataName,
					filter: [['_id', '=', instanceId]],
					field: field as IDataObject,
				};
				applyForceWorkflowAsync(payload, this.getNodeParameter('forceWorkflowAsync', i, false) as boolean);
				const response = await origamiApiRequest.call(this, '/entities/api/update_instance_fields/format/json', payload);
				const updated = (response as { results?: { instances_updated?: number } })?.results?.instances_updated;
				if (!updated) {
					throw new NodeOperationError(this.getNode(), 'Update returned instances_updated=0', { itemIndex: i });
				}
				returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
				continue;
			}

			if (resource === 'record' && operation === 'delete') {
				const entityDataName = entityName.call(this, i);
				const ids = String(this.getNodeParameter('deleteIds', i))
					.split(',')
					.map((id) => id.trim())
					.filter(Boolean);
				if (!ids.length) {
					throw new NodeOperationError(this.getNode(), 'Provide at least one record ID', { itemIndex: i });
				}
				const response = await origamiApiRequest.call(this, '/entities/api/remove_instance/format/json', {
					entity_data_name: entityDataName,
					_ids: ids,
				});
				returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
				continue;
			}

			if (resource === 'record' && (operation === 'archive' || operation === 'unarchive')) {
				const entityDataName = entityName.call(this, i);
				const instanceId = this.getNodeParameter('instanceId', i) as string;
				const response = await origamiApiRequest.call(this, '/entities/api/archive_action', {
					entity_data_name: entityDataName,
					id: instanceId,
					type: operation === 'archive' ? 'in' : 'out',
				});
				returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
				continue;
			}

			if (resource === 'record' && operation === 'getHistory') {
				const entityDataName = entityName.call(this, i);
				const instanceId = this.getNodeParameter('instanceId', i) as string;
				const response = await origamiApiRequest.call(this, '/entities/api/instances_history/format/json', {
					entity_data_name: entityDataName,
					id: instanceId,
				});
				returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
				continue;
			}

			if (resource === 'repeatableGroup') {
				const entityDataName = entityName.call(this, i);
				const instanceId = this.getNodeParameter('instanceId', i) as string;
				const groupDataName = this.getNodeParameter('groupDataName', i) as string;
				if (operation === 'add') {
					const group_data = parseJsonParam.call(this, 'groupData', i, {});
					const payload: IDataObject = {
						entity_data_name: entityDataName,
						_id: instanceId,
						group_data_name: groupDataName,
						group_data: group_data as IDataObject,
					};
					applyForceWorkflowAsync(payload, this.getNodeParameter('forceWorkflowAsync', i, false) as boolean);
					const response = await origamiApiRequest.call(this, '/entities/api/add_group_repetition/format/json', payload);
					returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
				} else {
					const index = this.getNodeParameter('groupIndex', i) as number;
					const response = await origamiApiRequest.call(this, '/entities/api/remove_group_repetition/format/json', {
						entity_data_name: entityDataName,
						_id: instanceId,
						group_data_name: groupDataName,
						index,
					});
					returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
				}
				continue;
			}

			if (resource === 'file' && operation === 'upload') {
				const entityDataName = entityName.call(this, i);
				const instanceId = this.getNodeParameter('instanceId', i) as string;
				const fieldDataName = this.getNodeParameter('fieldDataName', i) as string;
				const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i) as string;
				const binary = items[i].binary?.[binaryPropertyName];
				if (!binary) {
					throw new NodeOperationError(this.getNode(), `No binary data on property "${binaryPropertyName}"`, {
						itemIndex: i,
					});
				}
				const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
				const response = (await origamiUploadFile.call(this, {
					entity_data_name: entityDataName,
					instance_id: instanceId,
					field_data_name: fieldDataName,
					fileName: binary.fileName || 'upload.bin',
					fileBuffer: buffer,
					mimeType: binary.mimeType,
				})) as { results?: { _id?: string } };
				const fileId = response?.results?._id;
				if (!fileId) {
					throw new NodeOperationError(this.getNode(), 'Upload did not return results._id', { itemIndex: i });
				}
				if (instanceId && fieldDataName) {
					await origamiApiRequest.call(this, '/entities/api/update_instance_fields/format/json', {
						entity_data_name: entityDataName,
						filter: [['_id', '=', instanceId]],
						field: [[fieldDataName, fileId, 0]],
					});
				}
				returnData.push({ json: { ...(response as IDataObject), file_id: fileId, instanceId }, pairedItem: { item: i } });
				continue;
			}

			if (resource === 'file' && operation === 'download') {
				const fileId = this.getNodeParameter('fileId', i) as string;
				const { buffer, contentType } = await origamiFileDownload.call(this, fileId);
				const binary = await this.helpers.prepareBinaryData(buffer, fileId, contentType);
				returnData.push({ json: { file_id: fileId }, binary: { data: binary }, pairedItem: { item: i } });
				continue;
			}

			if (resource === 'invoice') {
				const invoiceType = this.getNodeParameter('invoiceType', i) as string;
				if (operation === 'getStructure') {
					returnData.push({ json: invoiceStructure(invoiceType) as unknown as IDataObject, pairedItem: { item: i } });
					continue;
				}
				if (operation === 'get') {
					const invoiceId = this.getNodeParameter('invoiceId', i) as string;
					const response = await origamiApiRequest.call(this, '/invoices/api/instance_data/format/json', {
						invoice_type: invoiceType,
						filter: [['_id', '=', invoiceId]],
						limit: [0, 1],
					});
					const record = unwrapRecords(response).records[0];
					if (!record) {
						throw new NodeOperationError(this.getNode(), `Invoice ${invoiceId} not found`, { itemIndex: i });
					}
					returnData.push({ json: flattenRecord(record) as IDataObject, pairedItem: { item: i } });
					continue;
				}
				if (operation === 'getAll') {
					const body: IDataObject = { invoice_type: invoiceType };
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					let records: Array<Record<string, unknown>>;
					if (returnAll) {
						records = await fetchAll(this, '/invoices/api/instance_data/format/json', body, maxRecords.call(this, i));
					} else {
						const skip = this.getNodeParameter('skip', i, 0) as number;
						const limit = this.getNodeParameter('limit', i, 50) as number;
						body.limit = limitPair(skip, limit);
						records = unwrapRecords(
							await origamiApiRequest.call(this, '/invoices/api/instance_data/format/json', body),
						).records;
					}
					for (const record of records) {
						returnData.push({ json: flattenRecord(record) as IDataObject, pairedItem: { item: i } });
					}
					continue;
				}
				if (operation === 'create') {
					if (!canCreateInvoiceType(invoiceType)) {
						throw new NodeOperationError(this.getNode(), `Cannot create invoice type ${invoiceType}`, { itemIndex: i });
					}
					const mode = this.getNodeParameter('invoiceCreateMode', i) as string;
					let form_data: unknown;
					if (mode === 'json') {
						form_data = parseJsonParam.call(this, 'invoiceFormData', i, []);
					} else {
						const customer = this.getNodeParameter('invoiceCustomerId', i) as string;
						const date = this.getNodeParameter('invoiceDate', i) as string;
						const currency = this.getNodeParameter('invoiceCurrency', i) as string;
						const company = this.getNodeParameter('invoiceCompanyIndex', i) as string;
						const itemsRows = this.getNodeParameter('invoiceItems.item', i, []) as Array<{
							itemId: string;
							quantity: number;
							unitPrice: number;
							taxPercent: number;
							chargeVat?: boolean;
						}>;
						form_data = [
							{
								group_data_name: 'origami_invoices_general_details',
								data: [
									{
										origami_invoices_customer_fld: customer,
										origami_invoices_date_fld: date,
										origami_invoices_currency_fld: currency,
										origami_invoices_company_index: company,
										origami_invoices_global_discount_fld: 0,
										origami_invoices_global_discount_type_fld: 'percent',
									},
								],
							},
							{
								group_data_name: 'origami_invoices_items',
								data: itemsRows.map((item) => buildInvoiceItem(item)),
							},
						];
						const cashAmount = this.getNodeParameter('invoiceCashAmount', i, 0) as number;
						if (cashAmount) {
							(form_data as IDataObject[]).push({
								group_data_name: 'origami_invoices_cash',
								data: [{ origami_invoices_cash_fld: cashAmount }],
							} as IDataObject);
						}
						if (invoiceType === 'refund_invoice') {
							const attachId = this.getNodeParameter('attachInvoiceId', i, '') as string;
							if (attachId) {
								(form_data as IDataObject[]).push({
									group_data_name: 'origami_invoices_attach_invoice',
									data: [
										{
											origami_invoices_attach_invoice_fld: { instance_id: attachId, text: attachId },
										},
									],
								} as IDataObject);
							}
						}
					}
					const invoicePayload: IDataObject = {
						type: invoiceType,
						saved_id: this.getNodeParameter('savedId', i, '') as string,
						round_total: this.getNodeParameter('roundTotal', i, false) ? 1 : 0,
						form_data: form_data as IDataObject,
					};
					if (invoiceType === 'refund_invoice') {
						invoicePayload.attach_type = this.getNodeParameter('attachType', i, 'tax_invoice') as string;
					}
					const uniqueId = (this.getNodeParameter('externalUniqueId', i, '') as string).trim();
					if (uniqueId) invoicePayload.external_unique_id = uniqueId;
					const response = await origamiApiRequest.call(this, '/invoices/api/create_invoice', invoicePayload);
					returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
					continue;
				}
			}

			if (resource === 'communication' && operation === 'sendEmail') {
				const emailList = String(this.getNodeParameter('emailList', i))
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean);
				const response = await origamiApiRequest.call(this, '/entities/api/send_email/format/json', {
					email_list: emailList,
					subject: this.getNodeParameter('emailSubject', i),
					msg: this.getNodeParameter('emailBody', i),
					bcc: this.getNodeParameter('emailBcc', i, true) ? 1 : 0,
				});
				returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
				continue;
			}

			if (resource === 'communication' && operation === 'sendSms') {
				const phones = String(this.getNodeParameter('phoneList', i))
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean);
				const response = await origamiApiRequest.call(this, '/entities/api/send_sms/format/json', {
					entity_data_name: entityName.call(this, i),
					instance_id: this.getNodeParameter('instanceId', i),
					msg: this.getNodeParameter('smsMessage', i),
					phone_list: phones,
				});
				returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
				continue;
			}

			if (resource === 'communication' && operation === 'sendPush') {
				const userId = this.getNodeParameter('userId', i);
				const response = await origamiApiRequest.call(this, '/ui/api/push_notification', {
					user_id: userId,
					id: userId,
					text: this.getNodeParameter('pushText', i),
					duration: this.getNodeParameter('pushDuration', i),
				});
				returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
				continue;
			}

			if (resource === 'omnichannel') {
				const payload = parseJsonParam.call(this, 'omniPayload', i, {}) as IDataObject;
				const response = await origamiApiRequest.call(this, '/omnichannel_external/api/new_message/format/json', payload);
				returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
				continue;
			}

			if (resource === 'calendar') {
				const payload = parseJsonParam.call(this, 'calendarPayload', i, {}) as IDataObject;
				payload.entity_data_name = entityName.call(this, i);
				const viewId = (this.getNodeParameter('calendarViewId', i, '') as string).trim();
				if (viewId) {
					payload.view_id = viewId;
					payload.id = payload.id || viewId;
				}
				const start = (this.getNodeParameter('calendarStart', i, '') as string).trim();
				const end = (this.getNodeParameter('calendarEnd', i, '') as string).trim();
				if (start) payload.start = start;
				if (end) payload.end = end;
				const response = await origamiApiRequest.call(this, '/entities/api/calander_view_details/format/json', payload);
				returnData.push({ json: response as IDataObject, pairedItem: { item: i } });
				continue;
			}

			throw new NodeOperationError(this.getNode(), `Unknown resource/operation ${resource}.${operation}`, {
				itemIndex: i,
			});
		} catch (error) {
			if (this.continueOnFail()) {
				returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
				continue;
			}
			throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
		}
	}

	return [returnData];
}

const NEVER_WRITE = new Set(['formula-field', 'metadata-field']);

export function isWritableFieldType(fieldType?: string): boolean {
	if (!fieldType) return true;
	return !NEVER_WRITE.has(fieldType);
}

function relationId(value: unknown): unknown {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		const obj = value as Record<string, unknown>;
		if (obj.instance_id !== undefined) return String(obj.instance_id);
		if (obj.id !== undefined) return String(obj.id);
	}
	return value;
}

function relationIdList(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => relationId(item));
	}
	if (typeof value === 'string' && value.includes(',')) {
		return value.split(',').map((part) => part.trim()).filter(Boolean);
	}
	return relationId(value);
}

export function coerceWriteValue(
	fieldType: string | undefined,
	value: unknown,
	fieldDataName?: string,
): unknown {
	if (!isWritableFieldType(fieldType)) {
		return undefined;
	}
	if (fieldDataName === 'origami_invoices_attach_invoice_fld' || fieldDataName === 'origami_invoices_attach_tax_receipt_fld') {
		if (value && typeof value === 'object' && !Array.isArray(value)) return value;
		if (typeof value === 'string' && value) {
			return { instance_id: value, text: value };
		}
		return value;
	}

	switch (fieldType) {
		case 'select-from-entity':
		case 'user-field':
			return relationId(value);
		case 'multi-select-from-entity':
		case 'assign-field':
			return relationIdList(value);
		case 'input-checkbox-singel':
			if (value === true || value === 1 || value === '1') return '1';
			if (value === false || value === 0 || value === '0') return '0';
			return value;
		case 'input-datetime':
			if (value && typeof value === 'object' && !Array.isArray(value) && 'text' in (value as object)) {
				return (value as { text: unknown }).text;
			}
			return value;
		default:
			return value;
	}
}

export function buildFormData(
	groups: Array<{ group_data_name: string; fields: Record<string, unknown> }>,
): Array<{ group_data_name: string; data: Array<Record<string, unknown>> }> {
	return groups
		.filter((group) => Object.keys(group.fields).length > 0)
		.map((group) => ({
			group_data_name: group.group_data_name,
			data: [group.fields],
		}));
}

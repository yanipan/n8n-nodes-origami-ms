export type PickerOption = { name: string; value: string };

function isWritableFieldType(fieldType?: string): boolean {
	if (!fieldType) return true;
	return fieldType !== 'formula-field' && fieldType !== 'metadata-field';
}

function entityRows(list: unknown): Array<Record<string, unknown>> {
	if (Array.isArray(list)) {
		return list.filter((row) => row && typeof row === 'object') as Array<Record<string, unknown>>;
	}
	if (!list || typeof list !== 'object') return [];
	const obj = list as Record<string, unknown>;
	if (Array.isArray(obj.data)) {
		return obj.data.filter((row) => row && typeof row === 'object') as Array<Record<string, unknown>>;
	}
	const numericKeys = Object.keys(obj).filter((key) => /^\d+$/.test(key));
	if (!numericKeys.length) return [];
	return numericKeys
		.sort((a, b) => Number(a) - Number(b))
		.map((key) => obj[key])
		.filter((row) => row && typeof row === 'object') as Array<Record<string, unknown>>;
}

export type OrigamiField = {
	field_name?: string;
	field_data_name?: string;
	field_type_name?: string;
	field_type?: string;
	required?: unknown;
	possible_values?: unknown;
};

export type OrigamiGroup = {
	group_name?: string;
	group_data_name?: string;
	repeatable_group?: unknown;
	fields_data?: unknown;
};

export function isRequiredFlag(value: unknown): boolean {
	return value === true || value === 1 || value === '1';
}

export function isRepeatableFlag(value: unknown): boolean {
	return value === true || value === 1 || value === '1';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return undefined;
}

function flattenFieldRows(fieldsData: unknown): unknown[] {
	if (!Array.isArray(fieldsData)) return [];
	if (fieldsData.length > 0 && Array.isArray(fieldsData[0])) {
		return (fieldsData as unknown[]).flat();
	}
	return fieldsData;
}

export function extractGroups(structure: unknown): OrigamiGroup[] {
	if (!structure) return [];
	const obj = asRecord(structure);
	if (obj?.error) return [];

	let raw: unknown[] = [];
	if (Array.isArray(structure)) raw = structure;
	else if (obj) {
		if (Array.isArray(obj.instance_data)) raw = obj.instance_data;
		else {
			const nested = asRecord(obj.instance_data);
			if (Array.isArray(nested?.field_groups)) raw = nested.field_groups as unknown[];
			else if (Array.isArray(obj.field_groups)) raw = obj.field_groups;
			else {
				const data = asRecord(obj.data);
				if (Array.isArray(data?.instance_data)) raw = data.instance_data as unknown[];
			}
		}
	}

	return raw
		.map((group): OrigamiGroup => {
			if (!group || typeof group !== 'object') return {};
			const g = group as Record<string, unknown>;
			const meta = asRecord(g.field_group_data) ?? {};
			return {
				...meta,
				...g,
				fields_data: flattenFieldRows(g.fields_data ?? meta.fields_data ?? []),
				group_name: (meta.group_name as string) ?? (g.group_name as string),
				group_data_name: (meta.group_data_name as string) ?? (g.group_data_name as string),
				repeatable_group: meta.repeatable_group ?? g.repeatable_group,
			};
		})
		.filter((group) => Boolean(group.group_data_name));
}

export function extractFields(group: OrigamiGroup): OrigamiField[] {
	const fields = flattenFieldRows(group.fields_data);
	return fields
		.map((raw): OrigamiField => {
			if (!raw || typeof raw !== 'object') return {};
			const f = raw as Record<string, unknown>;
			const nested = asRecord(f.field_data) ?? {};
			return {
				field_name: (nested.field_name as string) ?? (f.field_name as string),
				field_data_name: (nested.field_data_name as string) ?? (f.field_data_name as string),
				field_type_name:
					(nested.field_type_name as string) ?? (f.field_type_name as string) ?? (f.field_type as string),
				field_type: f.field_type as string | undefined,
				required: nested.required ?? f.required,
				possible_values: nested.possible_values ?? f.possible_values,
			};
		})
		.filter((field) => Boolean(field.field_data_name));
}

export function entityOptions(list: unknown): PickerOption[] {
	const rows = entityRows(list);
	const options = rows
		.map((r) => {
			const value = String(r.entity_data_name ?? r.data_name ?? '');
			if (!value) return undefined;
			const label = String(r.entity_name ?? r.name ?? value);
			const denied = r.access === 'denied' ? ' (denied)' : '';
			const prot = r.protected_entity === true || r.protected_entity === 1 || r.protected_entity === '1';
			return {
				name: `${label} (${value})${prot ? ' [protected]' : ''}${denied}`,
				value,
			};
		})
		.filter((opt): opt is PickerOption => Boolean(opt));
	return sortOptions(options);
}

export function groupOptions(
	structure: unknown,
	opts: { repeatableOnly?: boolean } = {},
): PickerOption[] {
	const options = extractGroups(structure)
		.filter((group) => group.group_data_name)
		.filter((group) => !opts.repeatableOnly || isRepeatableFlag(group.repeatable_group))
		.map((group) => {
			const repeatable = isRepeatableFlag(group.repeatable_group) ? ' repeatable' : '';
			return {
				name: `${group.group_name ?? group.group_data_name} (${group.group_data_name})${repeatable}`,
				value: group.group_data_name as string,
			};
		});
	return sortOptions(options);
}

export function fieldOptions(
	structure: unknown,
	opts: { groupName?: string; writableOnly?: boolean; fileOnly?: boolean; includeGroup?: boolean } = {},
): PickerOption[] {
	const options: PickerOption[] = [];
	const seen = new Set<string>();
	for (const group of extractGroups(structure)) {
		if (opts.groupName && group.group_data_name !== opts.groupName) continue;
		for (const field of extractFields(group)) {
			if (!field.field_data_name || seen.has(field.field_data_name)) continue;
			const typeName = field.field_type_name ?? field.field_type;
			if (opts.writableOnly && !isWritableFieldType(typeName)) continue;
			if (opts.fileOnly && typeName !== 'upload-files') continue;
			seen.add(field.field_data_name);
			const required = isRequiredFlag(field.required) ? '*' : '';
			const groupPrefix =
				opts.includeGroup && group.group_name
					? `${group.group_name} / `
					: opts.includeGroup && group.group_data_name
						? `${group.group_data_name} / `
						: '';
			options.push({
				name: `${groupPrefix}${field.field_name ?? field.field_data_name}${required} (${field.field_data_name}${typeName ? `, ${typeName}` : ''})`,
				value: field.field_data_name,
			});
		}
	}
	return sortOptions(options);
}

export function summarizeStructure(structure: unknown, entityDataName: string) {
	const groups = extractGroups(structure).map((group) => ({
		group_data_name: group.group_data_name,
		group_name: group.group_name,
		repeatable: isRepeatableFlag(group.repeatable_group),
		fields: extractFields(group).map((field) => ({
			field_data_name: field.field_data_name,
			field_name: field.field_name,
			type: field.field_type_name ?? field.field_type,
			required: isRequiredFlag(field.required),
			writable: isWritableFieldType(field.field_type_name ?? field.field_type),
		})),
	}));
	return {
		entity_data_name: entityDataName,
		groupCount: groups.length,
		fieldCount: groups.reduce((n, group) => n + group.fields.length, 0),
		groups,
	};
}

function sortOptions(options: PickerOption[]): PickerOption[] {
	return options.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

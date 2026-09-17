function extractFieldValue(value: unknown): unknown {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		const obj = value as Record<string, unknown>;
		if (obj.instance_id !== undefined) {
			return { id: obj.instance_id, text: obj.text ?? obj.ref_value ?? null };
		}
		if (obj.text !== undefined && obj.timestamp !== undefined) {
			return { text: obj.text, timestamp: obj.timestamp };
		}
		if (obj.file_id !== undefined) {
			return {
				file_id: obj.file_id,
				file_name: obj.file_name,
				ext: obj.ext,
				is_image: obj.is_image,
			};
		}
		if (obj.value !== undefined && obj.field_data_name !== undefined) {
			return extractFieldValue(obj.value);
		}
	}
	return value;
}

function flattenFieldGroups(record: Record<string, unknown>): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	if (record._id) output._id = record._id;
	if (record.id) output.id = record.id;
	if (record.insertTimestamp) output.insertTimestamp = record.insertTimestamp;

	const groups = (record.field_groups ?? record.fieldGroups) as unknown;
	if (!Array.isArray(groups)) {
		return record;
	}

	for (const rawGroup of groups) {
		if (!rawGroup || typeof rawGroup !== 'object') continue;
		const group = rawGroup as Record<string, unknown>;
		const meta = (group.field_group_data as Record<string, unknown> | undefined) ?? group;
		const groupName = String(meta.group_name ?? meta.group_data_name ?? 'group');
		const isRepeatable = meta.repeatable_group === '1' || meta.repeatable_group === 1;
		const fieldsData = (group.fields_data as unknown[]) ?? [];
		if (!Array.isArray(fieldsData) || fieldsData.length === 0) continue;

		if (fieldsData.length === 1 && !isRepeatable && Array.isArray(fieldsData[0])) {
			for (const field of fieldsData[0] as unknown[]) {
				if (!field || typeof field !== 'object') continue;
				const f = field as Record<string, unknown>;
				const name = String(f.field_data_name ?? f.field_name ?? '');
				if (!name) continue;
				output[name] = extractFieldValue(f.value);
			}
		} else {
			fieldsData.forEach((rep, idx) => {
				if (!Array.isArray(rep)) return;
				const row: Record<string, unknown> = {};
				for (const field of rep) {
					if (!field || typeof field !== 'object') continue;
					const f = field as Record<string, unknown>;
					const name = String(f.field_data_name ?? f.field_name ?? '');
					if (!name) continue;
					row[name] = extractFieldValue(f.value);
				}
				output[`${groupName}[${idx}]`] = row;
			});
		}
	}
	return output;
}

const SYSTEM_KEYS = new Set(['id', '_id', 'insertTimestamp', 'created_at', 'updated_at', 'info']);

export function flattenRecord(raw: Record<string, unknown>): Record<string, unknown> {
	const record = (raw.instance_data && typeof raw.instance_data === 'object'
		? (raw.instance_data as Record<string, unknown>)
		: raw);

	if (Array.isArray(record.field_groups) || Array.isArray(record.fieldGroups)) {
		return flattenFieldGroups(record);
	}

	const output: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		if (SYSTEM_KEYS.has(key) || value === null || typeof value !== 'object' || Array.isArray(value)) {
			output[key] = extractFieldValue(value);
			continue;
		}
		const group = value as Record<string, unknown>;
		for (const [field, fieldValue] of Object.entries(group)) {
			output[field] = extractFieldValue(fieldValue);
		}
	}
	return output;
}

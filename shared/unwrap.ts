export type UnwrappedRecords = {
	records: Array<Record<string, unknown>>;
	total?: number;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return undefined;
}

export function unwrapRecords(response: unknown): UnwrappedRecords {
	if (response === null || response === undefined) {
		return { records: [] };
	}
	if (Array.isArray(response)) {
		return { records: response.filter((row) => row && typeof row === 'object') as Array<Record<string, unknown>> };
	}
	const obj = asRecord(response);
	if (!obj) {
		return { records: [] };
	}

	const info = asRecord(obj.info);
	const total =
		typeof info?.total_count === 'number'
			? info.total_count
			: typeof obj.total_count === 'number'
				? obj.total_count
				: undefined;

	if (Array.isArray(obj.data)) {
		return {
			records: obj.data.filter((row) => row && typeof row === 'object') as Array<Record<string, unknown>>,
			total,
		};
	}

	const numericKeys = Object.keys(obj).filter((key) => /^\d+$/.test(key));
	const nonMetaKeys = Object.keys(obj).filter((key) => !['info', 'entity_data', 'success', 'error', 'results'].includes(key));
	if (numericKeys.length && numericKeys.length === nonMetaKeys.filter((key) => /^\d+$/.test(key)).length) {
		const records = numericKeys
			.sort((a, b) => Number(a) - Number(b))
			.map((key) => obj[key])
			.filter((row) => row && typeof row === 'object') as Array<Record<string, unknown>>;
		return { records, total };
	}

	if (obj.id || obj._id || obj.instance_data || obj.field_groups) {
		return { records: [obj], total: total ?? 1 };
	}

	return { records: [], total };
}

export function firstRecord(response: unknown): Record<string, unknown> | undefined {
	return unwrapRecords(response).records[0];
}

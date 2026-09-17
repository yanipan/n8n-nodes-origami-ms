export function extractEntityId(value: unknown): string {
	if (typeof value === 'string') return value.trim();
	if (value && typeof value === 'object') {
		const obj = value as Record<string, unknown>;
		if (typeof obj.value === 'string') return obj.value.trim();
		if (typeof obj.id === 'string') return obj.id.trim();
	}
	return '';
}

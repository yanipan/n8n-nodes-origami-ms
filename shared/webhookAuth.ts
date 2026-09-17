// Constant-time string compare without node:crypto (restricted for community nodes).
export function safeEqual(actual: string, expected: string): boolean {
	const length = Math.max(actual.length, expected.length);
	let diff = actual.length ^ expected.length;
	for (let i = 0; i < length; i++) {
		diff |= (actual.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
	}
	return diff === 0;
}

export function headerValue(headers: Record<string, unknown>, name: string): string {
	const value = headers[name.toLowerCase()] ?? headers[name];
	if (Array.isArray(value)) return String(value[0] ?? '');
	return value === undefined || value === null ? '' : String(value);
}

export function extractOrigamiError(response: unknown): string | undefined {
	if (response === null || response === undefined || typeof response !== 'object') {
		return undefined;
	}
	const err = (response as { error?: unknown }).error;
	if (err === undefined || err === null || err === false || err === '') {
		return undefined;
	}
	if (typeof err === 'string') {
		return err;
	}
	if (typeof err === 'object') {
		const obj = err as { message?: unknown; type?: unknown };
		if (typeof obj.message === 'string' && obj.message) {
			return typeof obj.type === 'string' && obj.type ? `${obj.type}: ${obj.message}` : obj.message;
		}
		return JSON.stringify(err);
	}
	return String(err);
}

export function isHttpErrorStatus(status: number): boolean {
	return status >= 400;
}

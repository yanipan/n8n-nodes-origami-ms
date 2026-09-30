export function sanitizeMultipartName(value: string): string {
	return value.replace(/[\r\n"\\]/g, '_');
}

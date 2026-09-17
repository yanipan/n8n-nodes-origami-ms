export function sanitizeMultipartName(value: string): string {
	return value.replace(/[\r\n"\\]/g, '_');
}

export function buildMultipartBody(
	boundary: string,
	fields: Record<string, string>,
	file: { fieldName: string; fileName: string; mimeType?: string; buffer: Buffer },
): Buffer {
	const parts: Buffer[] = [];
	for (const [name, value] of Object.entries(fields)) {
		parts.push(
			Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${sanitizeMultipartName(name)}"\r\n\r\n${value}\r\n`),
		);
	}
	const mimeType = (file.mimeType || 'application/octet-stream').replace(/[\r\n]/g, '');
	parts.push(
		Buffer.from(
			`--${boundary}\r\nContent-Disposition: form-data; name="${sanitizeMultipartName(file.fieldName)}"; filename="${sanitizeMultipartName(file.fileName)}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
		),
		file.buffer,
		Buffer.from(`\r\n--${boundary}--\r\n`),
	);
	return Buffer.concat(parts);
}

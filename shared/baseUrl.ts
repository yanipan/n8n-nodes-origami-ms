export function getBaseUrl(credentials: {
	accountName?: string;
	customBaseUrl?: string;
}): string {
	const custom = (credentials.customBaseUrl ?? '').trim().replace(/\/+$/, '');
	if (custom) {
		return custom;
	}
	const account = (credentials.accountName ?? '').trim();
	if (!account) {
		throw new Error('Set Account Name (subdomain) or Custom Base URL');
	}
	return `https://${account}.origami.ms`;
}

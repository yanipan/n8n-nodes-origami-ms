import { config } from '@n8n/node-cli/eslint';

export default [
	{ ignores: ['tests/**', 'dist/**', 'scripts/**', '.n8n-sandbox/**'] },
	...(Array.isArray(config) ? config : [config]),
];

import type {
	IAuthenticateGeneric,
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class OrigamiApi implements ICredentialType {
	name = 'origamiApi';

	displayName = 'Origami API';

	documentationUrl = 'https://documenter.getpostman.com/view/2653695/2s93kz65gS';

	icon: Icon = {
		light: 'file:../nodes/Origami/origami.png',
		dark: 'file:../nodes/Origami/origami.dark.png',
	};

	properties: INodeProperties[] = [
		{
			displayName:
				'Use an Origami API user (email + OGMI secret from Settings → General → Developer).',
			name: 'credNotice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Account Name',
			name: 'accountName',
			type: 'string',
			default: '',
			placeholder: 'mycompany',
			description: 'Origami subdomain (mycompany → https://mycompany.origami.ms). Ignored if Custom Base URL is set.',
		},
		{
			displayName: 'Custom Base URL',
			name: 'customBaseUrl',
			type: 'string',
			default: '',
			placeholder: 'https://crm.example.com',
			description: 'Optional custom domain. Leave empty to use https://{account}.origami.ms',
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			required: true,
			description: 'API user login email',
		},
		{
			displayName: 'API Secret',
			name: 'apiSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'OGMI-… secret from Settings → General → Developer',
		},
		{
			displayName: 'AI Agent Access',
			name: 'aiAgentAccess',
			type: 'options',
			options: [
				{
					name: 'Read and Write',
					value: 'readWrite',
					description: 'Agents may also create, update, delete, upload, issue invoices and send messages',
				},
				{
					name: 'Read Only',
					value: 'readOnly',
					description: 'Agents may only list, get and download',
				},
			],
			default: 'readOnly',
			description:
				'Applies only when the Origami node is connected to an AI Agent as a tool. Regular workflow nodes are not affected.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
				Accept: 'application/json',
			},
			body: {
				username: '={{$credentials.username}}',
				api_secret: '={{$credentials.apiSecret}}',
			},
		},
	};
}

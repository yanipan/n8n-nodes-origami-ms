import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { headerValue, safeEqual } from '../../shared/webhookAuth';

export class OrigamiTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Origami Trigger',
		name: 'origamiTrigger',
		icon: { light: 'file:origami.png', dark: 'file:origami.dark.png' },
		group: ['trigger'],
		version: 1,
		subtitle: 'Origami workflow webhook',
		description: 'Receive HTTP callbacks from Origami workflows',
		defaults: { name: 'Origami Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'origami',
			},
		],
		properties: [
			{
				displayName:
					'Activate this workflow, copy Production URL into an Origami workflow HTTP action. Set both header fields to require a shared secret. Deactivate when unused.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Auth Header Name',
				name: 'secretHeader',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				placeholder: 'X-Origami-Secret',
				description: 'If set, require this request header to match Auth Header Value',
			},
			{
				displayName: 'Auth Header Value',
				name: 'secretValue',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				displayOptions: { hide: { secretHeader: [''] } },
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const headerName = (this.getNodeParameter('secretHeader') as string).trim();
		if (headerName) {
			const expected = this.getNodeParameter('secretValue') as string;
			const actual = headerValue(this.getHeaderData() as Record<string, unknown>, headerName);
			if (!expected || !safeEqual(actual, expected)) {
				this.getResponseObject().status(401).json({ error: 'Unauthorized' });
				return { noWebhookResponse: true };
			}
		}
		const body = this.getBodyData() as IDataObject;
		return {
			workflowData: [[{ json: body }]],
		};
	}
}

export type AiAgentAccess = 'readOnly' | 'readWrite';

// Allowlist: anything not listed here counts as a write, so new operations are blocked for agents by default.
const READ_OPERATIONS: Record<string, string[]> = {
	entity: ['getAll', 'getStructure'],
	record: ['get', 'getAll', 'getFormTemplate', 'getHistory'],
	invoice: ['get', 'getAll', 'getStructure'],
	file: ['download'],
	calendar: ['getViewDetails'],
};

export function isReadOperation(resource: string, operation: string): boolean {
	return READ_OPERATIONS[resource]?.includes(operation) ?? false;
}

export function isToolNodeType(nodeType: string): boolean {
	return /Tool$/.test(nodeType);
}

export function normalizeAiAgentAccess(value: unknown): AiAgentAccess {
	return value === 'readWrite' ? 'readWrite' : 'readOnly';
}

export function aiAccessViolation(opts: {
	nodeType: string;
	resource: string;
	operation: string;
	access: unknown;
}): string | undefined {
	if (!isToolNodeType(opts.nodeType)) return undefined;
	if (normalizeAiAgentAccess(opts.access) === 'readWrite') return undefined;
	if (isReadOperation(opts.resource, opts.operation)) return undefined;
	return `AI agent access is Read Only on this Origami credential, so ${opts.resource}.${opts.operation} is blocked. An admin can set AI Agent Access to Read and Write on the credential.`;
}

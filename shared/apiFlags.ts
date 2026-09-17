export type ReadFlags = {
	normalized?: boolean;
	withArchive?: boolean;
	returnFields?: string;
	orderBy?: string;
	innerOrderBy?: string | unknown;
	returnGroups?: string;
	dontRecalcFormula?: boolean;
	withComments?: boolean;
};

function csv(value?: string): string[] {
	if (!value) return [];
	return value
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean);
}

export function parseOrderBy(value?: string): unknown {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	if (trimmed.startsWith('[')) {
		try {
			return JSON.parse(trimmed);
		} catch {
			return undefined;
		}
	}
	const [field, direction] = trimmed.split(',').map((part) => part.trim());
	if (!field) return undefined;
	return [field, direction === 'asc' || direction === 'desc' ? direction : 'desc'];
}

export function applyReadFlags(body: Record<string, unknown>, flags: ReadFlags): Record<string, unknown> {
	body.normalized = flags.normalized === false ? '0' : '1';
	// Origami: with_archive=0 excludes archived. Unset includes them.
	if (!flags.withArchive) body.with_archive = 0;
	const fields = csv(flags.returnFields);
	if (fields.length) body.return_fields = fields;
	const groups = csv(flags.returnGroups);
	if (groups.length) body.return_groups = groups;
	const orderBy = parseOrderBy(flags.orderBy);
	if (orderBy) body.orderby = orderBy;
	if (flags.innerOrderBy) {
		const inner = parseInnerOrderBy(flags.innerOrderBy);
		if (inner) body.inner_orderby = inner;
	}
	if (flags.dontRecalcFormula) body.dont_recalc_formula = '1';
	if (flags.withComments) body.with_comments = '1';
	return body;
}

export function parseInnerOrderBy(value?: string | unknown): unknown {
	if (Array.isArray(value)) return value.length ? value : undefined;
	if (value && typeof value === 'object') return value;
	if (typeof value !== 'string' || !value.trim() || value.trim() === '[]') return undefined;
	try {
		const parsed = JSON.parse(value.trim());
		if (Array.isArray(parsed) && parsed.length === 0) return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

export function buildRecordFilter(
	triples: Array<[string, string, unknown]>,
	combine: 'and' | 'or' = 'and',
): unknown {
	if (!triples.length) return undefined;
	if (combine === 'or' && triples.length > 1) {
		return { andxor: triples.map((triple) => [triple]) };
	}
	return triples;
}

export function applyForceWorkflowAsync(body: Record<string, unknown>, enabled?: boolean): Record<string, unknown> {
	if (enabled) body.force_workflow_async = 1;
	return body;
}

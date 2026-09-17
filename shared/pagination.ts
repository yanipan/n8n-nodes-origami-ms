export const DEFAULT_PAGE_SIZE = 100;
export const DEFAULT_RETURN_ALL_CAP = 5000;

export function limitPair(skip: number, count: number): [number, number] {
	return [Math.max(0, skip), Math.max(1, count)];
}

export function shouldStopPaging(opts: {
	received: number;
	pageSize: number;
	fetched: number;
	total?: number;
	cap: number;
}): boolean {
	if (opts.received < opts.pageSize) return true;
	if (opts.total !== undefined && opts.fetched >= opts.total) return true;
	if (opts.fetched >= opts.cap) return true;
	return false;
}

export const STABLE_ORDER_BY: [string, string] = ['_id', 'asc'];

export type Page<R> = { records: R[]; total?: number };

// Pages with limit [skip, count] until a short page, the reported total, or the cap.
// capped=true means Origami still had more rows when the cap stopped paging.
export async function collectAllPages<R>(
	fetchPage: (skip: number, count: number) => Promise<Page<R>>,
	opts: { pageSize?: number; cap?: number } = {},
): Promise<{ records: R[]; capped: boolean }> {
	const pageSize = Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE);
	const cap = Math.max(1, opts.cap ?? DEFAULT_RETURN_ALL_CAP);
	const records: R[] = [];
	let total: number | undefined;
	for (;;) {
		const count = Math.min(pageSize, cap - records.length);
		const page = await fetchPage(records.length, count);
		total = page.total ?? total;
		records.push(...page.records);
		if (page.records.length < count) return { records, capped: false };
		if (total !== undefined && records.length >= total) return { records, capped: false };
		if (records.length >= cap) return { records: records.slice(0, cap), capped: true };
	}
}

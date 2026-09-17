export const INVOICE_TYPES = [
	{ name: 'Proforma (Deal Invoice)', value: 'deal_invoice' },
	{ name: 'Tax Invoice', value: 'tax_invoice' },
	{ name: 'Tax Invoice Receipt', value: 'tax_receipt' },
	{ name: 'Receipt', value: 'receipt' },
	{ name: 'Credit Invoice', value: 'refund_invoice' },
	{ name: 'Delivery Note', value: 'delivery_note' },
	{ name: 'Work Order', value: 'work_order' },
] as const;

export const INVOICE_LIST_ONLY_TYPES = [{ name: 'Income and Expenses (read only)', value: 'income_and_expences' }];

export type InvoiceType = (typeof INVOICE_TYPES)[number]['value'];

const GENERAL = 'origami_invoices_general_details';
const ITEMS = 'origami_invoices_items';
const PAYMENT_GROUPS = [
	'origami_invoices_cash',
	'origami_invoices_check',
	'origami_invoices_cc',
	'origami_invoices_transfer',
	'origami_invoices_tax_clear',
];

const GENERAL_FIELDS = [
	'origami_invoices_customer_fld',
	'origami_invoices_date_fld',
	'origami_invoices_currency_fld',
	'origami_invoices_company_index',
	'origami_invoices_lang_fld',
	'origami_invoices_global_discount_fld',
	'origami_invoices_global_discount_type_fld',
];

const ITEM_FIELDS = [
	'origami_invoices_item_fld',
	'origami_invoices_item_name_fld',
	'origami_invoices_item_quantity_fld',
	'origami_invoices_item_unit_price_fld',
	'origami_invoices_item_tax_precent_fld',
	'origami_invoices_item_discount_fld',
	'origami_invoices_item_include_tax_fld',
];

const NEVER_SEND = [
	'origami_invoices_number_fld',
	'origami_invoices_total_fld',
	'origami_invoices_status_fld',
	'origami_invoices_item_total_fld',
];

export function groupsForInvoiceType(type: string): string[] {
	const groups = [GENERAL, ITEMS];
	if (['tax_receipt', 'receipt', 'refund_invoice'].includes(type)) {
		groups.push(...PAYMENT_GROUPS);
	}
	if (type === 'refund_invoice') {
		groups.push('origami_invoices_attach_invoice', 'origami_invoices_attach_tax_receipt');
	}
	if (type === 'delivery_note') {
		groups.push('origami_invoices_shipping');
	}
	return groups;
}

export function invoiceStructure(type: string): {
	type: string;
	groups: Array<{ group_data_name: string; fields: string[]; notes: string }>;
	neverSend: string[];
	currencyTokens: string[];
} {
	const notes: Record<string, string> = {
		[GENERAL]: 'Customer, date, currency (NIS|USD|EURO), company index 0-5. Totals are computed.',
		[ITEMS]: 'One object per line. Quantity > 0. Unit price is before VAT and may be negative for discounts. include_tax_fld "1" adds tax_precent on top, "0" = no VAT. Origami recomputes price/tax/total.',
		origami_invoices_cash: 'Payment sum in origami_invoices_cash_fld. Required total must match items for tax_receipt.',
		origami_invoices_attach_invoice: 'Refund parent must be {instance_id, text}. A bare string credits 0.',
	};
	return {
		type,
		groups: groupsForInvoiceType(type).map((group) => ({
			group_data_name: group,
			fields: group === GENERAL ? GENERAL_FIELDS : group === ITEMS ? ITEM_FIELDS : [],
			notes: notes[group] ?? '',
		})),
		neverSend: NEVER_SEND,
		currencyTokens: ['NIS', 'USD', 'EURO'],
	};
}

export function canCreateInvoiceType(type: string): boolean {
	return INVOICE_TYPES.some((item) => item.value === type);
}

export type InvoiceItemInput = {
	itemId: string;
	quantity: number;
	unitPrice: number;
	taxPercent: number;
	chargeVat?: boolean;
};

// Origami recomputes price/tax/total server-side (verified on stage 2026-09-17) but still
// requires the fields. origami_invoices_item_include_tax_fld means "charge VAT on top of the
// unit price": '1' adds tax_precent, '0' issues the line with no VAT. It is NOT "price includes VAT".
export function buildInvoiceItem(item: InvoiceItemInput): Record<string, unknown> {
	const qty = Number(item.quantity) || 0;
	const unit = Number(item.unitPrice) || 0;
	const pct = Number(item.taxPercent) || 0;
	const chargeVat = item.chargeVat !== false;
	const price = round2(qty * unit);
	const tax = chargeVat ? round2((price * pct) / 100) : 0;
	return {
		origami_invoices_item_fld: item.itemId,
		origami_invoices_item_quantity_fld: qty,
		origami_invoices_item_unit_price_fld: unit,
		origami_invoices_item_tax_precent_fld: pct,
		origami_invoices_item_discount_fld: 0,
		origami_invoices_item_include_tax_fld: chargeVat ? '1' : '0',
		origami_invoices_item_price_fld: price,
		origami_invoices_item_tax_fld: tax,
		origami_invoices_item_total_fld: round2(price + tax),
	};
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

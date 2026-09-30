import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInvoiceItem, canCreateInvoiceType, groupsForInvoiceType, invoiceStructure } from '../shared/invoiceCatalog.ts';

test('create is allowed for live types only', () => {
	assert.equal(canCreateInvoiceType('deal_invoice'), true);
	assert.equal(canCreateInvoiceType('income_and_expences'), false);
});

test('tax_receipt includes payment groups', () => {
	assert.ok(groupsForInvoiceType('tax_receipt').includes('origami_invoices_cash'));
	assert.equal(groupsForInvoiceType('deal_invoice').includes('origami_invoices_cash'), false);
});

test('structure lists currency tokens', () => {
	assert.deepEqual(invoiceStructure('tax_invoice').currencyTokens, ['NIS', 'USD', 'EURO']);
});

test('invoice item charges VAT by default (include_tax=1)', () => {
	const row = buildInvoiceItem({ itemId: 'x', quantity: 2, unitPrice: 10, taxPercent: 18 });
	assert.equal(row.origami_invoices_item_include_tax_fld, '1');
	assert.equal(row.origami_invoices_item_price_fld, 20);
	assert.equal(row.origami_invoices_item_tax_fld, 3.6);
	assert.equal(row.origami_invoices_item_total_fld, 23.6);
});

test('invoice item without VAT sends include_tax=0 and zero tax', () => {
	const row = buildInvoiceItem({ itemId: 'x', quantity: 1, unitPrice: 11.8, taxPercent: 18, chargeVat: false });
	assert.equal(row.origami_invoices_item_include_tax_fld, '0');
	assert.equal(row.origami_invoices_item_tax_fld, 0);
	assert.equal(row.origami_invoices_item_total_fld, 11.8);
});

import { bech32 } from '@scure/base';
import { webLnInvoice } from '../webln-invoice';
import { invoiceFixture, paymentHash } from '../testing/webln-invoice';

it('verifies a signed amount, default network fields and payment hash', () => {
  const invoice = invoiceFixture();
  expect(webLnInvoice(invoice)).toMatchObject({ invoice, amountMsat: 1000, paymentHash, description: 'Test purchase' });
  expect(webLnInvoice(invoice.toUpperCase()).invoice).toBe(invoice);
});
it.each(['lnbc', 'lnbc1p', 'lnbc999999999999999', 'lnevil1u', 'lnbc0u'])('rejects unreviewable amounts: %s', hrp => {
  expect(() => webLnInvoice(invoiceFixture({ hrp }))).toThrow();
});
it('rejects checksum changes, mixed case and truncated fields', () => {
  const invoice = invoiceFixture();
  expect(() => webLnInvoice(invoice.slice(0, -1) + (invoice.endsWith('q') ? 'p' : 'q'))).toThrow();
  expect(() => webLnInvoice('LN' + invoice.slice(2))).toThrow();
  expect(() => webLnInvoice(invoiceFixture({ extra: [1, 1, 20, 0] }))).toThrow();
});
it('rejects duplicate hashes and expired invoices', () => {
  expect(() => webLnInvoice(invoiceFixture({ duplicateHash: true }))).toThrow();
  expect(() => webLnInvoice(invoiceFixture({ createdAt: 1 }))).toThrow('invoice-expired');
});
it('rejects an invalid ECDSA signature with a valid checksum', () => {
  const decoded = bech32.decode(invoiceFixture(), 5000);
  decoded.words.splice(-104, 104, ...new Array(104).fill(0));
  expect(() => webLnInvoice(bech32.encode(decoded.prefix, decoded.words, 5000))).toThrow();
});
it('rejects an explicitly zero expiry', () => {
  expect(() => webLnInvoice(invoiceFixture({ expiry: 0 }))).toThrow('invoice-expired');
});


it('applies the default one-hour expiry to signed invoices without an x tag', () => {
  const createdAt = Math.floor(Date.now() / 1000);
  expect(webLnInvoice(invoiceFixture({ createdAt, omitExpiry: true })).expiresAt).toBe(createdAt + 3600);
  expect(() => webLnInvoice(invoiceFixture({ createdAt: createdAt - 3601, omitExpiry: true }))).toThrow('invoice-expired');
});

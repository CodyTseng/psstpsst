import { walletDecision, type WalletOption } from '@/lib/wallet/approval';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { assertNotAborted } from '@/platform/abort';
import i18n from '@/i18n/core';
import { signingRevision } from '@/services/signing/changes';
import { cacheLocalInvoiceTransaction, getWallets, makeInvoice, payInvoice, walletSupportsMethod, type WalletRow } from '@/services/wallet/wallet.service';
import { claimWebLnPayment } from '@/services/wallet/webln-payments';
import { webLnInvoice } from '@/services/wallet/webln-invoice';
import type { RuntimePrompt } from '@/services/napplet/runtime';

const methods = ['enable', 'isEnabled', 'getInfo', 'sendPayment', 'makeInvoice'];
const supported = (wallet: WalletRow) => ['getInfo', ...(walletSupportsMethod(wallet, 'pay_invoice') ? ['sendPayment'] : []),
  ...(walletSupportsMethod(wallet, 'make_invoice') ? ['makeInvoice'] : [])];

/** Document-local initialization; every payment and invoice requires its own review. */
export class WebLn {
  private enabled = false;
  private busy = false;
  constructor(private account: string, private sourceId: string, private title: string, private signal: AbortSignal,
    private confirm: (prompt: RuntimePrompt, signal: AbortSignal) => Promise<string | false>) {}
  private scope() { return { accountPubkey: this.account, sourceId: this.sourceId }; }
  private check(revision?: number) {
    assertNotAborted(this.signal);
    if (revision !== undefined && signingRevision(this.scope()) !== revision) throw new Error('permission-revoked');
  }
  private async review(title: string, detail: string, extra: Partial<RuntimePrompt> = {}) {
    const answer = await this.confirm({ title, detail, accountPubkey: this.account,
      requester: { title: this.title, origin: this.sourceId }, ...extra }, this.signal);
    this.check();
    return answer;
  }
  async handle(method: string, args: unknown[]): Promise<unknown> {
    this.check();
    if (!methods.includes(method)) throw new Error('unsupported-method');
    if (args.length !== (['sendPayment', 'makeInvoice'].includes(method) ? 1 : 0)) throw new Error('invalid-request');
    if (method === 'isEnabled') return this.enabled;
    if (this.busy) throw new Error('wallet-request-pending');
    this.busy = true;
    try {
      const revision = signingRevision(this.scope());
      if (method === 'enable') {
        if (this.enabled) return;
        const wallets = await getWallets(this.account); this.check();
        if (!wallets.length) throw new Error('wallet-not-connected');
        this.enabled = true;
        return;
      }
      if (!this.enabled) throw new Error('webln-not-enabled');
      const wallets = await getWallets(this.account);
      this.check(revision);
      if (!wallets.length) { this.enabled = false; throw new Error('wallet-not-connected'); }
      if (method === 'getInfo') {
        const wallet = wallets.find(row => row.isDefault) ?? wallets[0];
        return { node: { alias: wallet.customName || wallet.name, pubkey: '' },
          methods: [...new Set(wallets.flatMap(supported))] };
      }
      const capability = method === 'sendPayment' ? 'pay_invoice' : 'make_invoice';
      const eligible = wallets.filter(wallet => walletSupportsMethod(wallet, capability));
      if (!eligible.length) throw new Error('unsupported-method');
      const choices: WalletOption[] = eligible.map(({ id, name, customName, isDefault }) => ({ id, name, customName, isDefault }));
      const check = () => this.check(revision);
      const select = (answer: string | false) => {
        const decision = walletDecision(answer);
        const wallet = eligible.find(row => row.id === decision.walletId);
        if (!wallet) throw new Error('permission-denied');
        return { decision, wallet };
      };
      const ensureWallet = async (wallet: WalletRow) => {
        const fresh = (await getWallets(this.account)).find(row => row.id === wallet.id);
        check();
        if (!fresh || !walletSupportsMethod(fresh, capability)) throw new Error('wallet-unavailable');
      };
      if (method === 'sendPayment') {
        // Yield before bounded signature verification so the host can paint feedback.
        await new Promise<void>(resolve => setTimeout(resolve, 0)); check();
        const parsed = webLnInvoice(args[0]);
        const answer = await this.review(i18n.t('wallet.confirm_payment'), '', {
          wallet: { operation: 'payment', wallets: choices, amountMsat: parsed.amountMsat, description: parsed.description },
        });
        check();
        const { wallet, decision } = select(answer);
        if (decision.amountSats !== undefined) throw new Error('permission-denied');
        const expires = Date.now() + 60000;
        const paymentCheck = () => { check(); if (Date.now() > expires || Date.now() / 1000 >= parsed.expiresAt) throw new Error('payment-review-expired'); };
        let attempted = false;
        try {
          const result = await payInvoice(wallet, parsed.invoice, { prompt: i18n.t('wallet.auth_prompt'), cancel: i18n.t('common.cancel') }, undefined,
            {
              check: paymentCheck,
              beforeSend: async () => {
                await ensureWallet(wallet); paymentCheck();
                await claimWebLnPayment(this.account, parsed.paymentHash);
                attempted = true; paymentCheck();
                await cacheLocalInvoiceTransaction(wallet, { ...parsed, type: 'outgoing', state: 'pending' });
              },
            });
          const preimage = (result as { preimage?: unknown } | null)?.preimage;
          if (typeof preimage !== 'string' || !/^[a-f0-9]{64}$/i.test(preimage)
            || bytesToHex(sha256(hexToBytes(preimage))) !== parsed.paymentHash) throw new Error('invalid-payment-proof');
          // Persist a completed debit even if its requesting document has since closed.
          await cacheLocalInvoiceTransaction(wallet, { ...parsed, type: 'outgoing', state: 'settled', preimage, settledAt: Math.floor(Date.now() / 1000) });
          check();
          return { preimage };
        } catch (error) {
          if (attempted) throw new Error('payment-result-uncertain-check-wallet');
          throw error;
        }
      }
      const request = args[0];
      if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('invalid-request');
      const options = request as Record<string, unknown>;
      if (Object.keys(options).some(key => !['amount', 'defaultAmount', 'minimumAmount', 'maximumAmount', 'defaultMemo'].includes(key))) throw new Error('invalid-request');
      const sats = (value: unknown): number => {
        if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) throw new Error('invalid-amount');
        const number = Number(value);
        if (!Number.isSafeInteger(number) || number <= 0 || !Number.isSafeInteger(number * 1000)) throw new Error('invalid-amount');
        return number;
      };
      const min = options.minimumAmount === undefined ? 1 : sats(options.minimumAmount);
      const max = options.maximumAmount === undefined ? Math.floor(Number.MAX_SAFE_INTEGER / 1000) : sats(options.maximumAmount);
      if (min > max || options.defaultMemo !== undefined && (typeof options.defaultMemo !== 'string' || options.defaultMemo.length > 1000)) throw new Error('invalid-request');
      const memo = typeof options.defaultMemo === 'string' ? options.defaultMemo : '';
      const fixed = options.amount !== undefined;
      const amount = fixed ? sats(options.amount) : options.defaultAmount === undefined ? min : sats(options.defaultAmount);
      if (amount < min || amount > max) throw new Error('invalid-amount');
      const answer = await this.review(i18n.t('webln.invoice_title'), '', {
        wallet: { operation: 'invoice', wallets: choices, amountMsat: amount * 1000, description: memo,
          ...(fixed ? {} : { amountRange: { min, max } }) },
      });
      check();
      const { wallet, decision } = select(answer);
      if (fixed && decision.amountSats !== undefined) throw new Error('permission-denied');
      const approved = fixed ? amount : sats(decision.amountSats);
      if (approved < min || approved > max) throw new Error('permission-denied');
      const expires = Date.now() + 60000;
      const invoiceCheck = () => { check(); if (Date.now() > expires) throw new Error('payment-review-expired'); };
      const result = await makeInvoice(wallet, { amountMsat: approved * 1000, description: memo }, { check: invoiceCheck, beforeSend: () => ensureWallet(wallet) });
      check();
      const parsed = webLnInvoice(result.invoice ?? result.payment_request);
      if (parsed.amountMsat !== approved * 1000) throw new Error('invalid-invoice-amount');
      await cacheLocalInvoiceTransaction(wallet, { ...parsed, type: 'incoming', state: 'pending' });
      check();
      return { paymentRequest: parsed.invoice };
    } catch (error) {
      // Do not expose relay, database or wallet-supplied error payloads to a page.
      const safe = new Set(['unsupported-method', 'invalid-request', 'invalid-amount', 'invalid-invoice', 'invalid-invoice-amount',
        'invoice-expired', 'permission-denied', 'permission-revoked', 'wallet-not-connected', 'webln-not-enabled',
        'wallet-unavailable', 'wallet-pin-setup-required', 'payment-review-expired', 'payment-already-attempted',
        'payment-result-uncertain-check-wallet']);
      throw new Error(error instanceof Error && safe.has(error.message) ? error.message : 'wallet-request-failed');
    } finally { this.busy = false; }
  }
}

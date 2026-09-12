import { normalizeLightningInput } from '@/services/wallet/lnurl';
import { parseBolt11Invoice, type ParsedInvoice } from '@/services/wallet/bolt11';
import { walletDescriptionText } from './description';

const DESCRIPTION_TAG = 'description';

export function parseInvoiceMessage(content: string): ParsedInvoice | null {
  const input = normalizeLightningInput(content.trim());
  if (!input) return null;
  try {
    return parseBolt11Invoice(input);
  } catch {
    return null;
  }
}

export function invoiceMessageTags(description: string | null | undefined): string[][] {
  const text = walletDescriptionText(description);
  return text ? [[DESCRIPTION_TAG, text]] : [];
}

export function invoiceMessageDescription(tags: string[][] | null | undefined): string | null {
  for (const tag of tags ?? []) {
    if (tag[0] !== DESCRIPTION_TAG) continue;
    const text = walletDescriptionText(tag[1]);
    if (text) return text;
  }
  return null;
}

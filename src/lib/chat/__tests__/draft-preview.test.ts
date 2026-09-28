import { createDraftPreviewSelector } from '../draft-preview';

describe('draft preview selector', () => {
  it('freezes the existing preview while its conversation is active', () => {
    const select = createDraftPreviewSelector('chat', true);
    expect(select({ drafts: { chat: 'existing draft' } })).toBe('existing draft');
    expect(select({ drafts: { chat: 'typing now' } })).toBe('existing draft');
    expect(select({ drafts: {} })).toBeUndefined();
  });

  it('keeps an initially empty active preview empty while typing', () => {
    const select = createDraftPreviewSelector('chat', true);
    expect(select({ drafts: {} })).toBeUndefined();
    expect(select({ drafts: { chat: 'typing now' } })).toBeUndefined();
  });

  it('follows draft changes while the conversation is inactive', () => {
    const select = createDraftPreviewSelector('chat', false);
    expect(select({ drafts: { chat: 'first' } })).toBe('first');
    expect(select({ drafts: { chat: 'latest' } })).toBe('latest');
    expect(select({ drafts: {} })).toBeUndefined();
  });
});

import { compareContactIndexes, getContactIndex } from '@/lib/contacts/contact-index';

describe('contact address-book indexing', () => {
  it.each([
    ['张三', 'Z', 'zhangsan'],
    ['重庆', 'C', 'chongqing'],
    ['曾国藩', 'Z', 'zengguofan'],
    ['单田芳', 'S', 'shantianfang'],
    ['区楚良', 'O', 'ouchuliang'],
  ])('indexes the Chinese name %s by full pinyin', (name, section, sortKey) => {
    expect(getContactIndex(name, true)).toMatchObject({ section, sortKey });
  });

  it('sorts Chinese names by their full pinyin keys', () => {
    const zhang = getContactIndex('张三', true);
    const zhao = getContactIndex('赵六', true);

    expect(compareContactIndexes(zhang, zhao)).toBeLessThan(0);
  });

  it.each([
    ['あべ', 'あ'],
    ['オオタ', 'あ'],
    ['がく', 'か'],
    ['ジョウ', 'さ'],
    ['ちば', 'た'],
    ['ぽん', 'は'],
    ['んどう', 'わ'],
  ])('puts %s in the %s gojuon row', (name, section) => {
    expect(getContactIndex(name, true).section).toBe(section);
  });

  it('orders Japanese sections by gojuon rows', () => {
    const a = getContactIndex('アベ', true);
    const ka = getContactIndex('かとう', true);
    const wa = getContactIndex('わたなべ', true);

    expect(compareContactIndexes(a, ka)).toBeLessThan(0);
    expect(compareContactIndexes(ka, wa)).toBeLessThan(0);
  });

  it('does not invent a reading for leading Kanji in known Japanese text', () => {
    expect(getContactIndex('山田たろう', true).section).toBe('#');
  });

  it.each([
    ['Élodie', 'E'],
    ['Øyvind', 'Ø'],
    ['김민수', 'ㄱ'],
    ['나연', 'ㄴ'],
    ['Алексей', 'А'],
    ['أحمد', 'أ'],
  ])('keeps a useful localized section for %s', (name, section) => {
    expect(getContactIndex(name, true).section).toBe(section);
  });

  it('separates symbols and unresolved public-key fallbacks', () => {
    expect(getContactIndex('123', true).section).toBe('#');
    expect(getContactIndex('npub1…abcd', false).section).toBe('?');
  });

  it('ignores leading decoration when indexing and sorting a resolved name', () => {
    expect(getContactIndex('🔥 张三', true)).toMatchObject({
      section: 'Z',
      sortKey: 'zhangsan',
    });
    expect(getContactIndex('✨ Alice', true)).toMatchObject({
      section: 'A',
      sortKey: 'Alice',
    });
  });

  it('reuses cached metadata for an unchanged name', () => {
    expect(getContactIndex('张三', true)).toBe(getContactIndex('张三', true));
  });
});

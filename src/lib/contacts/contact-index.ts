import { pinyin } from 'pinyin-pro';

export type ContactIndexFamily =
  | 'latin'
  | 'japanese'
  | 'korean'
  | 'other'
  | 'symbol'
  | 'unresolved';

export type ContactIndex = {
  /** Localized section label rendered in the list and jump rail. */
  section: string;
  /** Script family used to keep mixed-script section ordering stable. */
  family: ContactIndexFamily;
  /** Normalized value used to order entries inside a section. */
  sortKey: string;
};

const FAMILY_ORDER: Record<ContactIndexFamily, number> = {
  latin: 0,
  japanese: 1,
  korean: 2,
  other: 3,
  symbol: 4,
  unresolved: 5,
};

const GOJUON_SECTIONS = ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ'] as const;
const GOJUON_ORDER = new Map<string, number>(
  GOJUON_SECTIONS.map((section, index) => [section, index]),
);
const HANGUL_SECTIONS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'] as const;
const HANGUL_ORDER = new Map<string, number>(
  HANGUL_SECTIONS.map((section, index) => [section, index]),
);
const HANGUL_LEAD_TO_SECTION = [
  'ㄱ', 'ㄱ', 'ㄴ', 'ㄷ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅂ', 'ㅅ',
  'ㅅ', 'ㅇ', 'ㅈ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

const LETTER = /\p{L}/u;
const LATIN = /\p{Script=Latin}/u;
const MARKS = /\p{M}/gu;
const KANA = /[\u3040-\u30ff\u31f0-\u31ff]/u;
const MAX_CACHE_ENTRIES = 20_000;

// Collators are relatively expensive to construct. Keep one per supported
// ordering and share them across every Contacts/New-chat/Forward list instance.
const latinCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const japaneseCollator = new Intl.Collator('ja', { sensitivity: 'base', numeric: true });
const koreanCollator = new Intl.Collator('ko', { sensitivity: 'base', numeric: true });
const universalCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

// Profile refreshes rebuild the contact-entry array even when almost every name
// is unchanged. Cache the expensive transliteration by resolved name so only a
// changed/new name is recomputed. The bound prevents untrusted remote profile
// churn from growing session memory forever.
const indexCache = new Map<string, ContactIndex>();

function fromFirstLetter(value: string): string | null {
  const characters = Array.from(value.trim());
  for (let index = 0; index < characters.length; index++) {
    if (LETTER.test(characters[index])) return characters.slice(index).join('');
  }
  return null;
}

function latinSection(character: string): string | null {
  const base = character.normalize('NFKD').replace(MARKS, '').charAt(0).toUpperCase();
  return base >= 'A' && base <= 'Z' ? base : null;
}

function isHan(character: string): boolean {
  const code = character.codePointAt(0);
  return (
    code !== undefined &&
    ((code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0x20000 && code <= 0x323af))
  );
}

function gojuonSection(character: string): string | null {
  if (!KANA.test(character)) return null;

  // ICU/CLDR's Japanese collation already understands hiragana/katakana,
  // voiced marks, small kana, and their gojuon order. The ten row boundaries
  // turn that standard ordering into the compact index used by address books.
  let section: (typeof GOJUON_SECTIONS)[number] | null = null;
  for (const boundary of GOJUON_SECTIONS) {
    if (japaneseCollator.compare(character, boundary) < 0) break;
    section = boundary;
  }
  return section;
}

function hangulSection(character: string): string | null {
  const code = character.codePointAt(0);
  if (code === undefined) return null;

  if (code >= 0xac00 && code <= 0xd7a3) {
    return HANGUL_LEAD_TO_SECTION[Math.floor((code - 0xac00) / 588)] ?? null;
  }

  // Modern leading jamo (ᄀ..ᄒ) and compatibility consonants (ㄱ..ㅎ).
  const normalized = character.normalize('NFKD').codePointAt(0);
  if (normalized !== undefined && normalized >= 0x1100 && normalized <= 0x1112) {
    return HANGUL_LEAD_TO_SECTION[normalized - 0x1100] ?? null;
  }
  return HANGUL_ORDER.has(character as (typeof HANGUL_SECTIONS)[number]) ? character : null;
}

function computeContactIndex(name: string, hasResolvedName: boolean): ContactIndex {
  if (!hasResolvedName) return { section: '?', family: 'unresolved', sortKey: name };

  const normalizedName = name.normalize('NFKC');
  const indexName = fromFirstLetter(normalizedName);
  if (!indexName) return { section: '#', family: 'symbol', sortKey: normalizedName };
  const first = Array.from(indexName)[0];

  const gojuon = gojuonSection(first);
  if (gojuon) {
    return { section: gojuon, family: 'japanese', sortKey: indexName };
  }

  if (isHan(first)) {
    // Kana elsewhere identifies Japanese text, but a leading Kanji has no
    // deterministic reading without explicit phonetic profile metadata. Do not
    // mislabel it with the Chinese reading of the same character.
    if (KANA.test(indexName)) {
      return { section: '#', family: 'symbol', sortKey: indexName };
    }

    const sortKey = pinyin(indexName, {
      toneType: 'none',
      separator: '',
      nonZh: 'consecutive',
      surname: 'head',
    }).toLowerCase();
    const section = latinSection(sortKey.charAt(0));
    return section
      ? { section, family: 'latin', sortKey }
      : { section: '#', family: 'symbol', sortKey: indexName };
  }

  const latin = latinSection(first);
  if (latin) {
    return {
      section: latin,
      family: 'latin',
      sortKey: indexName.normalize('NFKD').replace(MARKS, ''),
    };
  }

  if (LATIN.test(first)) {
    return {
      section: first.toLocaleUpperCase(),
      family: 'latin',
      sortKey: indexName,
    };
  }

  const hangul = hangulSection(first);
  if (hangul) {
    return { section: hangul, family: 'korean', sortKey: indexName };
  }

  return {
    section: first.toLocaleUpperCase(),
    family: 'other',
    sortKey: indexName,
  };
}

/** Return cached, localized address-book metadata for a display name. */
export function getContactIndex(name: string, hasResolvedName: boolean): ContactIndex {
  const cacheKey = `${hasResolvedName ? '1' : '0'}\0${name}`;
  const cached = indexCache.get(cacheKey);
  if (cached) return cached;

  const index = computeContactIndex(name, hasResolvedName);
  if (indexCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = indexCache.keys().next().value;
    if (oldest !== undefined) indexCache.delete(oldest);
  }
  indexCache.set(cacheKey, index);
  return index;
}

function familyCollator(family: ContactIndexFamily): Intl.Collator {
  if (family === 'japanese') return japaneseCollator;
  if (family === 'korean') return koreanCollator;
  if (family === 'latin') return latinCollator;
  return universalCollator;
}

/** Compare precomputed indexes without repeating transliteration. */
export function compareContactIndexes(a: ContactIndex, b: ContactIndex): number {
  const familyOrder = FAMILY_ORDER[a.family] - FAMILY_ORDER[b.family];
  if (familyOrder !== 0) return familyOrder;

  if (a.section !== b.section) {
    if (a.family === 'japanese') {
      return (GOJUON_ORDER.get(a.section) ?? 99) - (GOJUON_ORDER.get(b.section) ?? 99);
    }
    if (a.family === 'korean') {
      return (HANGUL_ORDER.get(a.section) ?? 99) - (HANGUL_ORDER.get(b.section) ?? 99);
    }
    const localized = familyCollator(a.family).compare(a.section, b.section);
    // Distinct labels can collate as equal (for example O and Ø under English).
    // A binary tie-break keeps every section contiguous in the sorted entry list.
    return localized !== 0 ? localized : a.section < b.section ? -1 : 1;
  }

  return familyCollator(a.family).compare(a.sortKey, b.sortKey);
}

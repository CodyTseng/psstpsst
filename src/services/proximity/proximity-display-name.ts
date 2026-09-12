import { randomBytes } from '@noble/hashes/utils.js';

import i18n, { matchSupportedLanguage } from '@/i18n';
import { PROXIMITY_DEFAULT_NAMES, type ProximityNameVocabulary } from '@/i18n/proximity-default-names';

export const PROXIMITY_DISPLAY_NAME_MAX_LENGTH = 32;

const UNSAFE_DISPLAY_NAME_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

export function sanitizeProximityDisplayNameInput(value: string): string {
  return Array.from(value.replace(UNSAFE_DISPLAY_NAME_CHARACTERS, ''))
    .slice(0, PROXIMITY_DISPLAY_NAME_MAX_LENGTH)
    .join('');
}

export function normalizeProximityDisplayName(value: string): string {
  return sanitizeProximityDisplayNameInput(value).trim();
}

type RandomBytesSource = (length: number) => Uint8Array;

function displayNameFromEntropy(
  entropy: Uint8Array,
  vocabulary: ProximityNameVocabulary,
  animalOffset = 0,
): string {
  if (entropy.length < 2) throw new Error('Two random bytes are required to generate a name');
  const adjective = vocabulary.adjectives[entropy[0] % vocabulary.adjectives.length];
  const animal = vocabulary.animals[(entropy[1] + animalOffset) % vocabulary.animals.length];
  return vocabulary.order === 'animal-first'
    ? `${animal}${vocabulary.separator}${adjective}`
    : `${adjective}${vocabulary.separator}${animal}`;
}

/** Use the current app language only when generating a new, key-independent alias. */
export function randomProximityDisplayName(
  excludedName?: string,
  randomBytesSource: RandomBytesSource = randomBytes,
  locale: string = i18n.language,
): string {
  const vocabulary = PROXIMITY_DEFAULT_NAMES[matchSupportedLanguage(locale)];
  let entropy = randomBytesSource(2);
  let candidate = displayNameFromEntropy(entropy, vocabulary);
  for (let attempt = 1; candidate === excludedName && attempt < 4; attempt += 1) {
    entropy = randomBytesSource(2);
    candidate = displayNameFromEntropy(entropy, vocabulary);
  }
  if (candidate !== excludedName) return candidate;

  return displayNameFromEntropy(entropy, vocabulary, 1);
}

export function normalizeOrRandomProximityDisplayName(value: string): string {
  return normalizeProximityDisplayName(value) || randomProximityDisplayName();
}

export function isValidProximityDisplayName(value: string): boolean {
  return value.length > 0 && value === normalizeProximityDisplayName(value);
}

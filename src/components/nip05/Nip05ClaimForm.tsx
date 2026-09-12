import Check from 'lucide-react-native/icons/check';
import { type RefObject, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, type TextInput, View } from 'react-native';

import { AppButton } from '@/components/common/AppButton';
import { AppInput } from '@/components/common/AppInput';
import { AppText } from '@/components/common/AppText';
import { NIP05_SERVICE_DOMAIN } from '@/lib/nostr/nip05';
import { platform } from '@/platform';
import { buildSigner } from '@/services/account/account.service';
import {
  checkNip05NameAvailability,
  lookupNip05NameByPubkey,
  Nip05NameError,
  nip05IdentifierForName,
  normalizeNip05Name,
  upsertNip05Name,
} from '@/services/nip05/nip05.service';
import { iconStrokeWidth } from '@/theme/icons';
import { spacing, typography, uiDensity, useThemeColors } from '@/theme';

type Availability =
  | 'idle'
  | 'checking'
  | 'available'
  | 'owned'
  | 'reserved'
  | 'taken'
  | 'invalid'
  | 'check_failed';

/** Result of the last completed lookup, keyed by the name it belongs to. */
type LookupResult = {
  name: string;
  result: 'available' | 'reserved' | 'taken' | 'invalid' | 'check_failed';
};

const LOOKUP_DEBOUNCE_MS = 500;

type Props = {
  /** Account the name is bound to; the claim is signed with its key. */
  pubkey: string;
  /** Focus handle for the host surface (screen transition / sheet contract). */
  inputRef?: RefObject<TextInput | null>;
  /** Render the explanatory intro line above the field. */
  intro?: boolean;
  /** Known reverse-lookup result, supplied by a parent that already fetched it. */
  ownedNameHint?: string | null;
  /** Called with `name@psstpsst.chat` once the server-side binding succeeds. */
  onClaimed: (identifier: string) => void | Promise<void>;
};

/**
 * Shared "claim a psstpsst.chat address" form used by onboarding and the
 * profile sheet. Reverse lookup prefills an existing name; edits check
 * availability live (debounced, stale responses discarded). Registration,
 * renaming, and confirming an owned name all use the same upsert request.
 */
export function Nip05ClaimForm({
  pubkey,
  inputRef,
  intro,
  ownedNameHint,
  onClaimed,
}: Props) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const [name, setName] = useState(ownedNameHint ?? '');
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [claiming, setClaiming] = useState(false);
  // undefined = ownership check still in flight; null = this key owns no name.
  const [ownedName, setOwnedName] = useState<string | null | undefined>(ownedNameHint);

  const trimmed = name.trim();
  const normalized = normalizeNip05Name(trimmed);

  // One name per pubkey: reverse-lookup what this key already owns. An owned
  // key starts prefilled with its name and can confirm or rename; a lookup
  // failure falls back to the normal claim flow (the server still enforces).
  useEffect(() => {
    if (ownedNameHint !== undefined) return;
    let active = true;
    lookupNip05NameByPubkey(pubkey)
      .then((owned) => {
        if (!active) return;
        setOwnedName(owned);
        if (owned) setName(owned);
      })
      .catch(() => {
        if (active) setOwnedName(null);
      });
    return () => {
      active = false;
    };
  }, [ownedNameHint, pubkey]);

  // Debounced availability lookup. The result is keyed by the looked-up name,
  // so stale responses and edits during an in-flight request never apply.
  // Skipped while the input still holds the owned name — ownership of that
  // one is already established.
  const unchangedOwned = ownedName != null && normalized === ownedName;
  useEffect(() => {
    if (!normalized || unchangedOwned) return;
    const timer = setTimeout(() => {
      checkNip05NameAvailability(normalized)
        .then((result) => setLookup({ name: normalized, result }))
        .catch(() => setLookup({ name: normalized, result: 'check_failed' }));
    }, LOOKUP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [normalized, unchangedOwned]);

  // idle/invalid are derived synchronously; async states come from the lookup.
  const status: Availability = unchangedOwned
    ? 'owned'
    : !trimmed
      ? 'idle'
      : !normalized
        ? 'invalid'
        : lookup?.name === normalized
          ? lookup.result
          : 'checking';

  const claimable =
    ownedName !== undefined && (status === 'available' || status === 'owned');

  async function claim() {
    if (!normalized || !claimable || claiming) return;
    setClaiming(true);
    try {
      // Let the loading state paint before key access and signing.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const signer = await buildSigner(pubkey);
      await upsertNip05Name({ signer, name: normalized });
      setOwnedName(normalized);
      await onClaimed(nip05IdentifierForName(normalized));
    } catch (err) {
      if (
        err instanceof Nip05NameError &&
        (err.code === 'invalid_name' ||
          err.code === 'name_reserved' ||
          err.code === 'name_taken')
      ) {
        // The server can reject a name after the live availability check.
        // Surface that definitive result inline without duplicating reserved-name rules.
        setLookup({
          name: normalized,
          result:
            err.code === 'invalid_name'
              ? 'invalid'
              : err.code === 'name_reserved'
                ? 'reserved'
                : 'taken',
        });
      } else {
        await platform.confirmationDialog.notify({
          title: t('nip05.claim_failed'),
          okLabel: t('common.ok'),
        });
      }
    } finally {
      setClaiming(false);
    }
  }

  // Status row below the input (hint, spinner, green check, or error). The
  // field border still turns red via AppInput's `invalid` (no `error` text —
  // that would add another line below).
  const hasError =
    status === 'invalid' ||
    status === 'reserved' ||
    status === 'taken' ||
    status === 'check_failed';
  const statusIcon =
    status === 'checking' ? (
      <ActivityIndicator
        size="small"
        color={c.textMuted}
        style={{ transform: [{ scale: 0.7 }] }}
      />
    ) : claimable ? (
      <Check strokeWidth={iconStrokeWidth.compact} size={13} color={c.success} />
    ) : null;
  const statusText =
    status === 'checking'
      ? t('nip05.checking')
      : status === 'available'
        ? t('nip05.available')
        : status === 'owned'
          ? ownedName
            ? t('nip05.already_claimed')
            : t('nip05.owned')
          : status === 'reserved'
            ? t('nip05.reserved')
            : status === 'taken'
              ? t('nip05.taken')
              : status === 'check_failed'
                ? t('nip05.check_failed')
                : status === 'invalid'
                  ? t('nip05.invalid')
                  : t('nip05.name_hint');
  const statusTone = hasError ? 'danger' : claimable ? 'success' : 'muted';

  return (
    <View style={{ gap: spacing.lg }}>
      {intro ? (
        <AppText variant="body" tone="muted">
          {t('nip05.subtitle')}
        </AppText>
      ) : null}
      <View style={{ gap: spacing.xs }}>
        <AppInput
          ref={inputRef}
          label={t('nip05.name_label')}
          placeholder={t('nip05.name_placeholder')}
          value={name}
          onChangeText={setName}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          editable={!claiming}
          invalid={hasError}
          trailingAccessory={
            <View style={{ height: uiDensity.inputHeight, justifyContent: 'center' }}>
              <AppText variant="body" tone="muted">
                @{NIP05_SERVICE_DOMAIN}
              </AppText>
            </View>
          }
          returnKeyType="done"
          onSubmitEditing={() => void claim()}
        />
        {/* Status line below the input: hint, spinner, green check, or error.
            The field border still turns red via AppInput's `invalid` (no
            `error` text — that would duplicate this line). */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: spacing.xs,
          }}
        >
          {statusIcon ? (
            <View
              style={{
                height: typography.caption.lineHeight,
                justifyContent: 'center',
              }}
            >
              {statusIcon}
            </View>
          ) : null}
          <AppText variant="caption" tone={statusTone} style={{ flex: 1 }}>
            {statusText}
          </AppText>
        </View>
      </View>
      <AppButton
        label={
          unchangedOwned
            ? t('nip05.claim_owned')
            : ownedName
              ? t('nip05.change')
              : t('nip05.claim')
        }
        variant="primary"
        size="lg"
        loading={claiming}
        disabled={!claimable}
        onPress={() => void claim()}
      />
    </View>
  );
}

import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppFormScrollView } from '@/components/common/AppFormScrollView';
import { AppButton } from '@/components/common/AppButton';
import { AppContentColumn } from '@/components/common/AppContentColumn';
import { AppScreen } from '@/components/common/AppScreen';
import { Nip05ClaimForm } from '@/components/nip05/Nip05ClaimForm';
import { OnboardingFormLayout } from '@/components/onboarding/OnboardingFormLayout';
import { useScrolled } from '@/hooks/use-scrolled';
import { useFocusAfterTransition } from '@/hooks/use-focus-after-transition';
import { buildSigner } from '@/services/account/account.service';
import { saveProfile } from '@/services/profile/profile.service';
import { loadAccountDmRelays } from '@/services/relay/relay-list.service';
import { useActiveAccount } from '@/stores/active-account.store';
import { spacing } from '@/theme';

/**
 * Optional last onboarding step, immediately after the key backup: claim a
 * psstpsst.chat address so others can find the account by name. Skippable.
 * The account is NOT active yet at this point — the setActive bootstrap runs
 * only when this step finishes (claim or skip), so nothing account-preparing
 * sits between the key backup and the claim.
 */
export default function OnboardingNip05() {
  const { scrolled, scrollProps } = useScrolled();
  const { t } = useTranslation();
  const { pubkey } = useLocalSearchParams<{ pubkey?: string }>();
  const inputRef = useFocusAfterTransition();
  const setActive = useActiveAccount((s) => s.setActive);
  const [leaving, setLeaving] = useState(false);

  async function finish() {
    if (leaving) return;
    if (!pubkey) {
      router.replace('/');
      return;
    }
    setLeaving(true);
    try {
      await setActive(pubkey);
      router.replace('/');
    } finally {
      setLeaving(false);
    }
  }

  async function handleClaimed(identifier: string) {
    if (pubkey) {
      // Persist the profile announcement for background delivery. The binding
      // already succeeded, so a signing/storage failure does not block onboarding
      // (the field remains editable in the profile).
      try {
        const signer = await buildSigner(pubkey);
        const relays = await loadAccountDmRelays(pubkey);
        await saveProfile({
          signer,
          accountPubkey: pubkey,
          metadata: { nip05: identifier },
          relays,
        });
      } catch {}
    }
    await finish();
  }

  return (
    <AppScreen edges={['bottom']}>
      <OnboardingFormLayout bordered={scrolled} title={t('nip05.title')}>
        <AppContentColumn style={{ flex: 1 }}>
          <AppFormScrollView
            {...scrollProps}
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              paddingTop: spacing.sm,
              paddingBottom: spacing['2xl'],
              gap: spacing.xl,
            }}
            keyboardShouldPersistTaps="handled"
          >
            {pubkey ? (
              <Nip05ClaimForm
                pubkey={pubkey}
                inputRef={inputRef}
                intro
                onClaimed={handleClaimed}
              />
            ) : null}
            <AppButton
              label={pubkey ? t('nip05.skip') : t('common.done')}
              variant="text"
              size="lg"
              loading={leaving}
              onPress={() => void finish()}
            />
          </AppFormScrollView>
        </AppContentColumn>
      </OnboardingFormLayout>
    </AppScreen>
  );
}

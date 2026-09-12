import { SquareArrowRightUp } from '@solar-icons/react-native/category/arrows/Linear/SquareArrowRightUp';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, View } from 'react-native';

import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { ListGroup } from '@/components/common/ListGroup';
import { ListRow } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { SectionLabel } from '@/components/common/SectionLabel';
import { LicenseState } from '@/components/licenses/LicenseState';
import { useLicenseCatalog, useProjectNotices } from '@/hooks/use-licenses';
import { useScrolled } from '@/hooks/use-scrolled';
import { useDirectionalIconStyle } from '@/i18n/direction';
import { IS_ELECTRON } from '@/lib/platform';
import { openProjectUrl, openRuntimeNotices, type NoticeChunk } from '@/services/licenses/licenses.service';
import { spacing, useThemeColors } from '@/theme';

const EMPTY_CHUNKS: readonly NoticeChunk[] = [];
const chunkKey = (chunk: NoticeChunk) => chunk.key;
function renderChunk({ item }: { item: NoticeChunk }) {
  return (
    <View>
      {item.title ? (
        <View style={{ paddingTop: spacing.xl, paddingBottom: spacing.md }}>
          <AppText variant="caption" tone="muted" selectable>{item.title}</AppText>
        </View>
      ) : null}
      <AppText selectable language="en">{item.text}</AppText>
    </View>
  );
}

export default function OpenSourceProject() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { t } = useTranslation();
  const c = useThemeColors();
  const direction = useDirectionalIconStyle();
  const { catalog, error: catalogError, retry: retryCatalog } = useLicenseCatalog();
  const project = typeof id === 'string' ? catalog?.byId.get(id) : undefined;
  const { chunks, error, retry } = useProjectNotices(project);
  const [linkError, setLinkError] = useState(false);
  const titleClearance = useScreenHeaderClearance();
  const { scrolled, scrollProps } = useScrolled({ resetKey: id });
  const external = <SquareArrowRightUp size={18} color={c.textMuted} style={direction} />;
  const openUrl = (url: string) => {
    setLinkError(false);
    void openProjectUrl(url).catch(() => setLinkError(true));
  };
  return (
    <AppScreen edges={['bottom']}>
      <FlatList
        key={id}
        {...scrollProps}
        data={chunks ?? EMPTY_CHUNKS}
        keyExtractor={chunkKey}
        renderItem={renderChunk}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={3}
        contentContainerStyle={{ paddingTop: titleClearance + spacing.sm,
          paddingHorizontal: spacing.lg, paddingBottom: spacing['3xl'] }}
        ListHeaderComponent={project ? (
          <View style={{ gap: spacing.xl }}>
            <View style={{ gap: spacing.sm }}>
              <AppText variant="title" selectable>{project.name}</AppText>
              {project.version ? <AppText tone="muted">{t('about.version', { version: project.version })}</AppText> : null}
              <AppText tone="muted" selectable>{project.license || t('licenses.see_notices')}</AppText>
            </View>
            {project.repository || project.website ? (
              <ListGroup>
                {project.repository ? <ListRow title={t('licenses.repository')} trailing={external}
                  onPress={() => openUrl(project.repository!)} /> : null}
                {project.website && project.website !== project.repository ? <ListRow title={t('licenses.website')} trailing={external}
                  onPress={() => openUrl(project.website!)} /> : null}
              </ListGroup>
            ) : null}
            {IS_ELECTRON && project.name === 'electron' ? (
              <ListRow title={t('licenses.runtime_notices')} trailing={external}
                onPress={() => {
                  setLinkError(false);
                  void openRuntimeNotices().catch(() => setLinkError(true));
                }} />
            ) : null}
            {linkError ? <AppText tone="danger">{t('licenses.link_failed')}</AppText> : null}
            <SectionLabel>{t('licenses.notices')}</SectionLabel>
          </View>
        ) : null}
        ListEmptyComponent={catalogError ? <LicenseState title={t('licenses.load_failed')} retry={retryCatalog} /> :
          catalog && !project ? <LicenseState title={t('licenses.not_found')} /> :
          error ? <LicenseState title={t('licenses.load_failed')} retry={retry} /> :
          project ? <View style={{ padding: spacing.xl }} /> : null}
      />
      <ScreenHeader title={t('licenses.details')} bordered={scrolled} />
    </AppScreen>
  );
}

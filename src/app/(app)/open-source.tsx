import { router } from 'expo-router';
import { memo, useDeferredValue, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, View } from 'react-native';

import { AppScreen } from '@/components/common/AppScreen';
import { AppText } from '@/components/common/AppText';
import { DirectionalChevron } from '@/components/common/DirectionalChevron';
import { ListRow, ROW_CONTENT_INSET } from '@/components/common/ListRow';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { LicenseState } from '@/components/licenses/LicenseState';
import { SearchBar, SEARCH_BAR_SCREEN_GUTTER } from '@/components/search/SearchBar';
import { useLicenseCatalog } from '@/hooks/use-licenses';
import { useScrolled } from '@/hooks/use-scrolled';
import { searchLicensedProjects, type LicensedProject } from '@/services/licenses/licenses.service';
import { useLicenseBrowserStore } from '@/stores/license-browser.store';
import { spacing, uiDensity, useThemeColors } from '@/theme';

const SEARCH_HEIGHT = uiDensity.searchBarHeight + spacing.sm * 2;
const EMPTY_PROJECTS: readonly LicensedProject[] = [];

const ProjectRow = memo(function ProjectRow({ project }: { project: LicensedProject }) {
  const c = useThemeColors();
  const { t } = useTranslation();
  return (
    <ListRow
      variant="list"
      title={project.name}
      subtitle={[project.version, project.license || t('licenses.see_notices')].filter(Boolean).join(' · ')}
      trailing={<DirectionalChevron size={18} color={c.textMuted} />}
      onPress={() => router.push({ pathname: '/open-source-project', params: { id: project.id } })}
    />
  );
});
const renderProject = ({ item }: { item: LicensedProject }) => <ProjectRow project={item} />;
const projectKey = (project: LicensedProject) => project.id;

function ProjectSeparator() {
  const c = useThemeColors();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: c.border,
        marginStart: ROW_CONTENT_INSET,
      }}
    />
  );
}

export default function OpenSource() {
  const { t } = useTranslation();
  const { catalog, error, retry } = useLicenseCatalog();
  const query = useLicenseBrowserStore((state) => state.query);
  const setQuery = useLicenseBrowserStore((state) => state.setQuery);
  const deferredQuery = useDeferredValue(query);
  const projects = useMemo(() => catalog ? searchLicensedProjects(catalog, deferredQuery) : EMPTY_PROJECTS,
    [catalog, deferredQuery]);
  const titleClearance = useScreenHeaderClearance(SEARCH_HEIGHT);
  const { scrolled, scrollProps } = useScrolled({ resetKey: deferredQuery });
  return (
    <AppScreen edges={['bottom']}>
      <FlatList
        key={deferredQuery}
        {...scrollProps}
        data={projects}
        keyExtractor={projectKey}
        renderItem={renderProject}
        ItemSeparatorComponent={ProjectSeparator}
        initialNumToRender={12}
        windowSize={5}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingTop: titleClearance + spacing.sm, paddingBottom: spacing.xl }}
        ListHeaderComponent={catalog ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm }}>
            <AppText tone="muted">{t('licenses.intro')}</AppText>
            <AppText variant="caption" tone="muted">{t('licenses.count', { count: projects.length })}</AppText>
          </View>
        ) : null}
        ListEmptyComponent={error ? <LicenseState title={t('licenses.load_failed')} retry={retry} /> :
          catalog ? <LicenseState title={t('licenses.no_results')} /> : null}
      />
      <ScreenHeader
        title={t('about.open_source')}
        bordered={scrolled}
        belowHeight={SEARCH_HEIGHT}
        below={(
          <View style={{ paddingHorizontal: SEARCH_BAR_SCREEN_GUTTER, paddingVertical: spacing.sm }}>
            <SearchBar value={query} onChangeText={setQuery} placeholder={t('licenses.search')} />
          </View>
        )}
      />
    </AppScreen>
  );
}

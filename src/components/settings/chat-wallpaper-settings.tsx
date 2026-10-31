import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import Check from 'lucide-react-native/icons/check';
import Plus from 'lucide-react-native/icons/plus';
import Trash2 from 'lucide-react-native/icons/trash-2';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { useStore } from 'zustand';

import { AppButton } from '@/components/common/AppButton';
import { AppScreen } from '@/components/common/AppScreen';
import { IconButton } from '@/components/common/IconButton';
import { AppText } from '@/components/common/AppText';
import { ScreenHeader, useScreenHeaderClearance } from '@/components/common/ScreenHeader';
import { useWallpaperPreference } from '@/hooks/use-chat-wallpaper';
import { useScrolled } from '@/hooks/use-scrolled';
import { IS_ELECTRON } from '@/lib/platform';
import { platform } from '@/platform';
import {
  addWallpaperImage, deleteWallpaperImage, loadWallpaper, loadWallpaperLibrary, saveWallpaper,
  wallpaperLibraryStore, type WallpaperScope,
} from '@/services/preferences/chat-wallpaper.service';
import { radius, spacing, useThemeColors } from '@/theme';
import { iconStrokeWidth } from '@/theme/icons';

type Tile = { id: string; label: string; uri: string | null };

export function ChatWallpaperSettings({ scope }: { scope?: WallpaperScope }) {
  const state = useWallpaperPreference(scope);
  const global = useWallpaperPreference();
  const library = useStore(wallpaperLibraryStore);
  const { t } = useTranslation();
  const c = useThemeColors();
  const clearance = useScreenHeaderClearance();
  const { scrolled, scrollProps } = useScrolled();
  const [width, setWidth] = useState(0);
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const operation = useRef(false);
  const preferencesReady = state.loaded && global.loaded;
  useEffect(() => {
    if (preferencesReady) void loadWallpaperLibrary();
  }, [preferencesReady]);
  const ready = preferencesReady && library.loaded;
  const busy = picking || library.adding || state.saving || pending !== null || library.deleting !== null;
  const selected = state.value?.kind === 'image' ? state.value.fileName
    : state.value?.kind === 'none' || !scope ? 'none' : 'inherit';
  const conversation = scope !== undefined;
  const tiles = useMemo<Tile[]>(() => [
    ...(conversation ? [{ id: 'inherit', label: t('wallpaper.inherit'), uri: global.uri }] : []),
    { id: 'none', label: t('wallpaper.none'), uri: null },
    ...library.images.map((image, index) => ({
      id: image.fileName, label: `${t('wallpaper.custom_photo')} ${index + 1}`, uri: image.uri,
    })),
    ...(!editing ? [{ id: 'add', label: t('wallpaper.choose_photo'), uri: null }] : []),
  ], [conversation, global.uri, library.images, editing, t]);
  const columns = Math.max(3, Math.min(6, Math.floor(width / 160)));
  const tileWidth = Math.max(1, (width - spacing.lg * 2 - spacing.sm * (columns - 1)) / columns);

  async function pick() {
    if (operation.current) return;
    operation.current = true;
    setPicking(true);
    setFailed(null);
    let stagedUri: string | undefined;
    try {
      let uri: string | undefined;
      if (IS_ELECTRON) {
        stagedUri = (await platform.documentPicker.pickDocument({ type: 'image/*' }))?.uri;
        uri = stagedUri;
      } else {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1, exif: false,
        });
        if (!result.canceled) uri = result.assets[0]?.uri;
      }
      if (uri) await addWallpaperImage(uri);
    } catch { setFailed('wallpaper.save_failed'); }
    finally {
      if (stagedUri) {
        await platform.fileSystem.delete(stagedUri, { idempotent: true })
          .catch((error) => console.warn('[wallpaper] Failed to clean up the staged source image.', error));
      }
      setPicking(false);
      operation.current = false;
    }
  }

  const select = useCallback(async (id: string) => {
    if (operation.current) return;
    operation.current = true;
    setPending(id);
    setFailed(null);
    try {
      await saveWallpaper(scope, id === 'none' || id === 'inherit' ? id : { fileName: id });
    } catch { setFailed('wallpaper.save_failed'); }
    finally { setPending(null); operation.current = false; }
  }, [scope]);

  const remove = useCallback(async (fileName: string) => {
    if (operation.current) return;
    operation.current = true;
    setFailed(null);
    try {
      const confirmed = await platform.confirmationDialog.confirm({
        title: t('wallpaper.delete'), message: t('wallpaper.delete_confirm'),
        cancelLabel: t('common.cancel'), confirmLabel: t('common.delete'), destructive: true,
      });
      if (confirmed) await deleteWallpaperImage(fileName);
    } catch { setFailed('wallpaper.delete_failed'); }
    finally { operation.current = false; }
  }, [t]);

  function retry() {
    void loadWallpaper(scope);
    void loadWallpaper();
    void loadWallpaperLibrary();
  }

  return (
    <AppScreen edges={['bottom']}>
      <View style={{ flex: 1 }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {ready && width > 0 ? (
          <FlatList
            key={columns}
            {...scrollProps}
            data={tiles}
            numColumns={columns}
            keyExtractor={(item) => item.id}
            columnWrapperStyle={{ gap: spacing.sm }}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: clearance + spacing.sm,
              paddingBottom: spacing.lg, gap: spacing.sm }}
            ListFooterComponent={failed ? <AppText tone="danger">{t(failed)}</AppText> : null}
            renderItem={({ item }) => {
              if (item.id === 'add') {
                return <WallpaperAddTile width={tileWidth} label={item.label} disabled={picking || library.adding}
                  loading={picking || library.adding} onPress={() => void pick()} />;
              }
              return <WallpaperTile item={item} width={tileWidth} checked={(pending ?? selected) === item.id}
                editing={editing} deleting={library.deleting === item.id}
                onSelect={select} onDelete={remove} />;
            }}
          />
        ) : (
          <View style={{ paddingTop: clearance + spacing.lg, paddingHorizontal: spacing.lg, gap: spacing.lg }}>
            {state.error || global.error || library.error ? <>
              <AppText tone="danger">{t('wallpaper.load_failed')}</AppText>
              <AppButton label={t('common.retry')} onPress={retry} />
            </> : <ActivityIndicator color={c.textMuted} />}
          </View>
        )}
      </View>
      <ScreenHeader bordered={scrolled} title={t('wallpaper.title')}
        right={library.images.length > 0 || editing ? <AppButton
          label={t(editing ? 'common.done' : 'common.edit')} variant="text"
          disabled={!ready || busy} onPress={() => setEditing((current) => !current)} /> : undefined} />
    </AppScreen>
  );
}

/** Stable artwork stays mounted while only the old and new selection marks update. */
const WallpaperTile = memo(function WallpaperTile({ item, width, checked, editing, deleting, onSelect, onDelete }: {
  item: Tile; width: number; checked: boolean; editing: boolean; deleting: boolean;
  onSelect: (id: string) => void; onDelete: (id: string) => void;
}) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const source = useMemo(() => item.uri ? { uri: item.uri } : undefined, [item.uri]);
  const photo = item.id !== 'none' && item.id !== 'inherit';
  return (
    <View style={{ width, height: width * 1.5 }}>
      <AppButton accessibilityRole="radio" accessibilityLabel={item.label}
        accessibilityState={{ checked, disabled: editing }}
        variant="ghost" compact compactInset={0} fullWidth={false}
        onPress={() => { if (!editing && !checked) onSelect(item.id); }}
        iconLeft={
          <View style={{ width, height: width * 1.5, overflow: 'hidden', borderRadius: radius.lg,
            backgroundColor: c.background, borderWidth: StyleSheet.hairlineWidth,
            borderColor: checked ? c.accent : c.border }}>
            {source ? <Image source={source} contentFit="cover" style={StyleSheet.absoluteFill} recyclingKey={item.uri} /> : null}
            {!photo ? <View style={{ position: 'absolute', bottom: 0, start: 0, end: 0,
              backgroundColor: c.surface, padding: spacing.sm }}>
              <AppText variant="caption">{item.label}</AppText>
            </View> : null}
            {checked && !editing ? <View style={{ position: 'absolute', top: spacing.sm, end: spacing.sm,
              borderRadius: radius.full, padding: spacing.xs, backgroundColor: c.accent }}>
              <Check size={18} strokeWidth={iconStrokeWidth.default} color={c.accentForeground} />
            </View> : null}
          </View>
        }
      />
      {editing && photo ? <IconButton
        icon={deleting ? <ActivityIndicator size="small" color={c.danger} />
          : <Trash2 size={18} strokeWidth={iconStrokeWidth.default} color={c.danger} />}
        accessibilityLabel={`${t('wallpaper.delete')}: ${item.label}`}
        variant="dangerSoft" size={spacing['2xl']} hitSlop={spacing.sm}
        style={{ position: 'absolute', top: spacing.sm, end: spacing.sm }}
        disabled={deleting} onPress={() => onDelete(item.id)} /> : null}
    </View>
  );
});

/** Keep pointer feedback local so hovering never rerenders the wallpaper gallery. */
function WallpaperAddTile({ width, label, disabled, loading, onPress }: {
  width: number; label: string; disabled: boolean; loading: boolean; onPress: () => void;
}) {
  const c = useThemeColors();
  const [hovered, setHovered] = useState(false);
  const active = hovered && !disabled;
  const foreground = active ? c.text : c.textMuted;
  return (
    <AppButton accessibilityRole="button" accessibilityLabel={label} variant="ghost" compact compactInset={0} fullWidth={false}
      disabled={disabled} onPress={onPress}
      onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
      iconLeft={
        <View style={{ width, height: width * 1.5, borderRadius: radius.lg,
          backgroundColor: c.background, borderStyle: 'dashed', borderWidth: 1,
          borderColor: active ? c.text : c.border, alignItems: 'center', justifyContent: 'center',
          padding: spacing.sm, gap: spacing.sm }}>
          <View style={{ width: spacing.xl, height: spacing.xl, alignItems: 'center', justifyContent: 'center' }}>
            {loading ? <ActivityIndicator size="small" color={foreground} />
              : <Plus size={spacing.xl} strokeWidth={iconStrokeWidth.default} color={foreground} />}
          </View>
          <AppText variant="caption" align="center" style={{ color: foreground }}>{label}</AppText>
        </View>
      }
    />
  );
}

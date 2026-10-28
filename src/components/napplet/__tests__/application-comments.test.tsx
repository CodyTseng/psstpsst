import { createRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { FlatList, ScrollView, type TextInput } from 'react-native';
import { AppText } from '@/components/common/AppText';
import { AppInput } from '@/components/common/AppInput';
import { AppButton } from '@/components/common/AppButton';
import { ApplicationComments, CommentComposer } from '../ApplicationComments';
import { ApplicationDetailsPage } from '../ApplicationDetailsPage';
import type { ExploreEntry } from '@/services/explore/model';
import type { ApplicationCommentsSession } from '@/services/explore/comments';
import type { CommentRow } from '@/services/explore/comments-index';
import type { ApplicationComment } from '@/services/explore/comments-protocol';
import { lightPalette, darkPalette } from '@/theme';

let mockScheme: 'light' | 'dark' = 'light';
const mockPost = jest.fn();
const mockLoad = jest.fn(async () => {});
const mockSession = { post: mockPost, load: mockLoad } as unknown as ApplicationCommentsSession;
const mockState = { rows: [] as CommentRow[], loading: false, loaded: true, error: false, hasMore: false, session: mockSession };
jest.mock('@/hooks/use-application-comments', () => ({ useApplicationComments: () => mockState }));
jest.mock('@/hooks/use-display-name', () => ({ useDisplayName: (pubkey: string) => ({ name: pubkey === 'account' ? 'Alice' : 'Bob', profile: null }) }));
jest.mock('@/lib/time', () => ({ formatListTime: () => 'now' }));
jest.mock('@/stores/theme.store', () => ({ useThemeStore: (select: (state: object) => unknown) => select({ accent: 'blue', preference: mockScheme }) }));
jest.mock('@/theme', () => ({ ...jest.requireActual('@/theme'), useThemeColors: () => jest.requireActual('@/theme')[mockScheme === 'light' ? 'lightPalette' : 'darkPalette'] }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { name: string }) => options?.name ? `${key}: ${options.name}` : key }) }));
jest.mock('@/components/common/AppScreen', () => ({ AppScreen: 'Page' }));
jest.mock('@/components/common/ScreenHeader', () => ({ ScreenHeader: 'Header', useScreenHeaderClearance: () => 64 }));
jest.mock('@/components/common/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/common/AppText', () => ({ AppText: 'Text' }));
jest.mock('@/components/common/AppInput', () => ({ AppInput: 'Input' }));
jest.mock('@/components/common/AppButton', () => ({ AppButton: 'Button' }));
jest.mock('@/components/common/IconButton', () => ({ IconButton: 'IconButton' }));
jest.mock('@/components/napplet/NappletInfo', () => ({ ApplicationInfo: ({ action }: { action?: React.ReactNode }) => action ?? null }));
jest.mock('@/components/napplet/ApplicationOpenSetting', () => ({ ApplicationOpenSetting: () => null }));
jest.mock('@/components/napplet/ApplicationDetailsActions', () => ({ ApplicationDetailsActions: () => null }));
jest.mock('lucide-react-native/icons/x', () => () => null);
jest.mock('@solar-icons/react-native/category/messages/Linear/ChatRound', () => ({ ChatRound: 'EmptyIcon' }), { virtual: true });

let renderer: ReactTestRenderer;
beforeEach(() => { jest.clearAllMocks(); mockPost.mockReset(); mockState.rows = []; mockState.loading = false; mockState.loaded = true; mockState.error = false; });
afterEach(() => { act(() => renderer?.unmount()); });
const input = createRef<TextInput>();

it.each(['light', 'dark'] as const)('keeps a top-level composer above the themed thread in %s mode', async scheme => {
  mockScheme = scheme;
  const entry = { kind: 'website', address: 'https://site.example' } as ExploreEntry;
  await act(async () => { renderer = create(<ApplicationComments entry={entry} account="account" header={<AppText>Application details</AppText>} />); });
  expect(renderer.root.findAllByType(FlatList)).toHaveLength(1);
  expect(renderer.root.findByType(FlatList).props.data).toEqual([]);
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'Application details')).toBe(true);
  expect(renderer.root.findAllByType(CommentComposer)).toHaveLength(1);
  expect(renderer.root.findByType('EmptyIcon' as never).props.color).toBe((scheme === 'light' ? lightPalette : darkPalette).textMuted);
});

it('retains the draft on failure and clears it only after a successful retry', async () => {
  const sent = jest.fn();
  await act(async () => { renderer = create(<CommentComposer account="account" session={mockSession} inputRef={input} onCancelReply={() => {}} onSent={sent} />); });
  act(() => { renderer.root.findByType(AppInput).props.onChangeText('My review'); });
  mockPost.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { renderer.root.findByType(AppButton).props.onPress(); });
  expect(renderer.root.findByType(AppInput).props.value).toBe('My review');
  expect(renderer.root.findAllByType(AppText).some(node => node.props.children === 'comments.post_failed')).toBe(true);
  mockPost.mockResolvedValueOnce({ id: 'event' });
  await act(async () => { renderer.root.findByType(AppButton).props.onPress(); });
  expect(renderer.root.findByType(AppInput).props.value).toBe('');
  expect(sent).toHaveBeenCalledWith(undefined);
});

it('submits the selected reply parent and prevents duplicate submissions while publishing', async () => {
  let finish!: (event: unknown) => void;
  mockPost.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const reply = { event: { id: 'parent', pubkey: 'bob' } } as ApplicationComment;
  await act(async () => { renderer = create(<CommentComposer account="account" session={mockSession} reply={reply} inputRef={input} onCancelReply={() => {}} onSent={() => {}} />); });
  act(() => { renderer.root.findByType(AppInput).props.onChangeText('Reply'); });
  await act(async () => { const post = renderer.root.findAllByType(AppButton).find(node => node.props.label === 'comments.post')!; post.props.onPress(); post.props.onPress(); });
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockPost).toHaveBeenCalledWith('Reply', 'parent');
  expect(renderer.root.findByType(AppInput).props.editable).toBe(false);
  expect(renderer.root.findAllByType(AppButton).find(node => node.props.label === 'common.cancel')!.props.disabled).toBe(true);
  await act(async () => { finish({ id: 'event' }); });
});

it('keeps primary Open in the scrolling application header and Post in the composer', async () => {
  const entry = { kind: 'website', address: 'https://site.example' } as ExploreEntry;
  await act(async () => { renderer = create(<ApplicationDetailsPage
    application={{ title: 'App', description: '', required: [], servers: [] }} discussion={{ entry, account: 'account' }}
    access={{ loaded: true, approved: true }} onPublisher={() => {}} onOpen={() => {}} />); });
  const buttons = renderer.root.findAllByType(AppButton);
  const open = buttons.find(button => button.props.label === 'applications.open')!;
  expect(renderer.root.findByType(FlatList).findAllByType(AppButton)).toContain(open);
  expect(buttons.find(button => button.props.label === 'comments.post')?.props.variant).toBe('primary');
  expect(open.props.variant).toBe('primary');
  expect(open.props.fullWidth).toBe(false);
});

it.each(['discussion', 'details', 'unsupported-root'])('shows the titlebar divider only while %s content is scrolled', async mode => {
  const entry = { key: 'site', kind: 'website', address: mode === 'unsupported-root' ? 'invalid' : 'https://site.example' } as ExploreEntry;
  await act(async () => { renderer = create(<ApplicationDetailsPage
    application={{ title: 'App', description: '', required: [], servers: [] }}
    discussion={mode === 'details' ? undefined : { entry, account: 'account' }}
    access={{ loaded: true, approved: true }} onPublisher={() => {}} onOpen={() => {}} />); });
  const header = () => renderer.root.findByType('Header' as never);
  expect(header().props.bordered).toBe(false);
  const scrollable = renderer.root.findByType(mode === 'discussion' ? FlatList : ScrollView);
  const scrollTo = (y: number) => act(() => { scrollable.props.onScroll({ nativeEvent: {
    contentOffset: { y }, contentSize: { height: 2000 }, layoutMeasurement: { height: 600 },
  } }); });
  scrollTo(20);
  expect(header().props.bordered).toBe(true);
  scrollTo(0);
  expect(header().props.bordered).toBe(false);
});

it.each(['light', 'dark'] as const)('opens and closes nested reply composers in place in %s mode', async scheme => {
  mockScheme = scheme;
  const parent = { event: { id: 'parent', pubkey: 'bob', content: 'Parent review', created_at: 1 } } as ApplicationComment;
  const child = { event: { id: 'child', pubkey: 'carol', content: 'Nested reply', created_at: 2 } } as ApplicationComment;
  mockState.rows = [
    { comment: parent, depth: 0, hasReplies: true, guideDepths: [], continuesParent: false },
    { comment: child, depth: 1, parentDepth: 0, hasReplies: false, guideDepths: [], continuesParent: false },
  ];
  const entry = { kind: 'website', address: 'https://site.example' } as ExploreEntry;
  await act(async () => { renderer = create(<ApplicationComments entry={entry} account="account" header={null} />); });
  expect(renderer.root.findAllByType(CommentComposer)).toHaveLength(1);
  const topComposer = renderer.root.findByType(CommentComposer);
  act(() => { topComposer.findByType(AppInput).props.onChangeText('Unfinished review'); });
  const replies = renderer.root.findAllByType(AppButton).filter(node => node.props.label === 'comments.reply');
  act(() => { replies[1].props.onPress(); });
  const inline = renderer.root.findAllByType(CommentComposer).find(node => node.props.reply)!;
  expect(inline.props.reply).toBe(child);
  expect(inline.parent!.findAllByType(AppText).some(node => node.props.children === 'Nested reply')).toBe(true);
  expect(inline.findByType(AppInput).props.autoFocus).toBe(true);
  expect(inline.findAllByType(AppText).some(node => String(node.props.children).includes('comments.public_as'))).toBe(false);
  const cancel = inline.findAllByType(AppButton).find(node => node.props.label === 'common.cancel')!;
  const post = inline.findAllByType(AppButton).find(node => node.props.label === 'comments.post')!;
  expect(cancel.props.variant).toBe('secondary');
  expect(cancel.props.size).toBe(post.props.size);
  act(() => { inline.findAllByType(AppButton).find(node => node.props.label === 'common.cancel')!.props.onPress(); });
  expect(renderer.root.findAllByType(CommentComposer)).toHaveLength(1);
  act(() => { replies[0].props.onPress(); });
  const retryComposer = renderer.root.findAllByType(CommentComposer).find(node => node.props.reply)!;
  act(() => { retryComposer.findByType(AppInput).props.onChangeText('Inline reply'); });
  mockPost.mockRejectedValueOnce(new Error('offline'));
  await act(async () => { retryComposer.findAllByType(AppButton).find(node => node.props.label === 'comments.post')!.props.onPress(); });
  expect(retryComposer.findByType(AppInput).props.value).toBe('Inline reply');
  mockPost.mockResolvedValueOnce({ id: 'posted' });
  await act(async () => { retryComposer.findAllByType(AppButton).find(node => node.props.label === 'comments.post')!.props.onPress(); });
  expect(mockPost).toHaveBeenLastCalledWith('Inline reply', 'parent');
  expect(topComposer.findByType(AppInput).props.value).toBe('Unfinished review');
  expect(renderer.root.findAllByType(CommentComposer)).toHaveLength(1);

});

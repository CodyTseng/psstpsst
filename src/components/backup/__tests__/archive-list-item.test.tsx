import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { IconButton } from '@/components/common/IconButton';
import { ListRow } from '@/components/common/ListRow';

import { ArchiveListItem } from '../archive-list-item';

jest.mock(
  '@solar-icons/react-native/category/notes/Linear/Archive',
  () => ({ Archive: () => null }),
  { virtual: true },
);
jest.mock(
  '@solar-icons/react-native/category/folders/Linear/FolderOpen',
  () => ({ FolderOpen: () => null }),
  { virtual: true },
);
jest.mock(
  '@solar-icons/react-native/category/ui/Linear/TrashBinTrash',
  () => ({ TrashBinTrash: () => null }),
  { virtual: true },
);
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue' }) => unknown) =>
    selector({ accent: 'blue' }),
}));

describe('ArchiveListItem', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('reveals the archive without triggering the row share action', () => {
    const onPress = jest.fn();
    const onReveal = jest.fn();
    const stopPropagation = jest.fn();

    act(() => {
      renderer = create(
        <ArchiveListItem
          title="archive.zip"
          subtitle="Created today"
          onPress={onPress}
          onReveal={onReveal}
          onDelete={jest.fn()}
        />,
      );
    });

    act(() => {
      renderer!.root.findByType(IconButton).props.onPress({ stopPropagation });
    });

    const row = renderer!.root.findByType(ListRow);
    expect(row.props.preserveColumn).toBe('value');
    expect(row.props.trailing).toBeTruthy();
    expect(row.props.trailingOnHover).toBeUndefined();
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(onReveal).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });
});

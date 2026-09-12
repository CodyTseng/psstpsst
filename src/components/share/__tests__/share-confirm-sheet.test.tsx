import { act, create, type ReactTestRenderer } from 'react-test-renderer';

type MockBottomSheetProps = {
  scrollStyle?: { height?: number; maxHeight?: number };
  scrollOverlay?: React.ReactNode;
  contentStyle?: { paddingHorizontal?: number };
};

const mockBottomSheet = jest.fn((_props: MockBottomSheetProps) => null);

jest.mock('@/components/common/ActionRow', () => ({ ActionRow: () => null }));
jest.mock('@/components/common/BottomSheet', () => ({
  BottomSheet: (props: MockBottomSheetProps) => mockBottomSheet(props),
}));
jest.mock('@/components/share/SelectedRecipientsRow', () => ({
  RecipientSummary: () => null,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { ShareConfirmSheet } = jest.requireActual<
  typeof import('../ShareConfirmSheet')
>('../ShareConfirmSheet');

describe('ShareConfirmSheet', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('lets a short preview hug its content while capping long previews', () => {
    act(() => {
      renderer = create(
        <ShareConfirmSheet
          visible
          onClose={() => {}}
          preview={null}
          recipients={[
            { conversationKey: 'peer', deliveryKind: 'relay', name: 'Peer' },
          ]}
          sending={false}
          onConfirm={() => {}}
        />,
      );
    });

    const props = mockBottomSheet.mock.lastCall?.[0];
    if (!props) throw new Error('BottomSheet was not rendered');
    expect(props.scrollStyle?.height).toBeUndefined();
    expect(props.scrollStyle?.maxHeight).toEqual(expect.any(Number));
    expect(props.scrollOverlay).toBeUndefined();
    expect(props.contentStyle).toEqual({ paddingHorizontal: 0 });
  });
});

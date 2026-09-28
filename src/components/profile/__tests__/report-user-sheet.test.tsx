import { act, create, type ReactTestRenderer } from 'react-test-renderer';

type BottomSheetProps = {
  children?: React.ReactNode;
  fixedFooter?: React.ReactNode;
  onClosed?: () => void;
};

type ActionRowProps = {
  confirm: { onPress: () => Promise<void> };
};

type ListRowProps = {
  onPress: () => void;
};

const mockBottomSheet = jest.fn((props: BottomSheetProps) => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return (
    <View>
      {props.children}
      {props.fixedFooter}
    </View>
  );
});
const mockActionRow = jest.fn((_props: ActionRowProps) => null);
const mockListRow = jest.fn((_props: ListRowProps) => null);
const mockReportUser = jest.fn();
const mockShowToast = jest.fn();

jest.mock('@/components/common/ActionRow', () => ({
  ActionRow: (props: ActionRowProps) => mockActionRow(props),
}));
jest.mock('@/components/common/AppText', () => ({
  AppText: ({ children }: { children?: React.ReactNode }) => {
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return <View>{children}</View>;
  },
}));
jest.mock('@/components/common/BottomSheet', () => ({
  BottomSheet: (props: BottomSheetProps) => mockBottomSheet(props),
}));
jest.mock('@/components/common/ListRow', () => ({
  ListRow: (props: ListRowProps) => mockListRow(props),
}));
jest.mock('@/components/common/radio-indicator', () => ({ RadioIndicator: () => null }));
jest.mock('@/services/nostr/report.service', () => ({
  PROFILE_REPORT_TYPES: ['spam'],
  reportUser: (...args: unknown[]) => mockReportUser(...args),
}));
jest.mock('@/stores/toast.store', () => ({
  showToast: (message: string) => mockShowToast(message),
}));
jest.mock('@/theme', () => ({ spacing: { lg: 16 } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const { ReportUserSheet } = jest.requireActual<typeof import('../report-user-sheet')>(
  '../report-user-sheet',
);

describe('ReportUserSheet', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReportUser.mockResolvedValue({});
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  it('shows success only after the native sheet finishes closing', async () => {
    const onClose = jest.fn();
    act(() => {
      renderer = create(
        <ReportUserSheet
          visible
          accountPubkey={'a'.repeat(64)}
          reportedPubkey={'b'.repeat(64)}
          onClose={onClose}
        />,
      );
    });

    act(() => mockListRow.mock.lastCall?.[0].onPress());
    await act(async () => mockActionRow.mock.lastCall?.[0].confirm.onPress());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockShowToast).not.toHaveBeenCalled();

    act(() => mockBottomSheet.mock.lastCall?.[0].onClosed?.());
    expect(mockShowToast).toHaveBeenCalledWith('report.success');
  });
});

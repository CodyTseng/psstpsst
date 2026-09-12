import { confirmationDialogAdapter } from '../confirmation-dialog';

const { Alert } = jest.requireActual('react-native') as typeof import('react-native');

describe('Expo confirmation dialog adapter', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps a confirm to the native cancel and preferred primary actions', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const result = confirmationDialogAdapter.confirm({
      title: 'Use this address?',
      message: 'This address will become public.',
      cancelLabel: 'Cancel',
      confirmLabel: 'Use address',
    });

    const buttons = alert.mock.calls[0]?.[2];
    expect(buttons?.map(({ text, style, isPreferred }) => ({ text, style, isPreferred }))).toEqual([
      { text: 'Cancel', style: 'cancel', isPreferred: undefined },
      { text: 'Use address', style: 'default', isPreferred: true },
    ]);

    buttons?.[1]?.onPress?.();
    await expect(result).resolves.toBe(true);
  });

  it('keeps a destructive confirm destructive instead of preferred', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const result = confirmationDialogAdapter.confirm({
      title: 'Delete this chat?',
      message: 'This cannot be undone.',
      cancelLabel: 'Cancel',
      confirmLabel: 'Delete',
      destructive: true,
    });

    const buttons = alert.mock.calls[0]?.[2];
    expect(buttons?.[1]).toMatchObject({
      text: 'Delete',
      style: 'destructive',
      isPreferred: false,
    });

    buttons?.[0]?.onPress?.();
    await expect(result).resolves.toBe(false);
  });

  it('maps a notice acknowledgement to the preferred native action', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const result = confirmationDialogAdapter.notify({ title: 'Saved', okLabel: 'OK' });

    const buttons = alert.mock.calls[0]?.[2];
    expect(buttons?.[0]).toMatchObject({ text: 'OK', isPreferred: true });

    buttons?.[0]?.onPress?.();
    await expect(result).resolves.toBeUndefined();
  });
});

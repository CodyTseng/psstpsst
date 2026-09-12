import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { getDialogPresenter } from '@/platform/dialog-presenter';
import { ActionRow } from '../ActionRow';
import { AppButton } from '../AppButton';
import { ConfirmationDialogHost } from '../ConfirmationDialogHost';

jest.mock('@/lib/platform', () => ({
  ...jest.requireActual('@/lib/platform'),
  IS_ELECTRON: true,
}));

// The real store persists through the db (expo-sqlite), which jest-expo leaves
// without a native binding; the host only needs a static accent.
jest.mock('@/stores/theme.store', () => ({
  useThemeStore: (selector: (state: { accent: 'blue' }) => unknown) =>
    selector({ accent: 'blue' }),
}));

const CONFIRM_OPTIONS = {
  title: 'Remove this emoji pack?',
  message: 'It will be removed from your collection.',
  cancelLabel: 'Cancel',
  confirmLabel: 'Remove',
  destructive: true,
};

function dialogButtons(tree: ReactTestRenderer) {
  return tree.root.findAllByType(AppButton);
}

describe('ConfirmationDialogHost', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  function mount() {
    act(() => {
      renderer = create(<ConfirmationDialogHost />);
    });
    const presenter = getDialogPresenter();
    if (!presenter) throw new Error('presenter not registered');
    return presenter;
  }

  it('registers a presenter on mount and clears it on unmount', () => {
    mount();
    expect(getDialogPresenter()).not.toBeNull();
    act(() => renderer?.unmount());
    renderer = undefined;
    expect(getDialogPresenter()).toBeNull();
  });

  it('presents a destructive confirm with danger/secondary roles and resolves true on confirm', async () => {
    const presenter = mount();
    let result: boolean | undefined;
    act(() => {
      void presenter.confirm(CONFIRM_OPTIONS).then((v) => {
        result = v;
      });
    });
    const buttons = dialogButtons(renderer!);
    expect(buttons.map((b) => ({ label: b.props.label, variant: b.props.variant }))).toEqual([
      { label: 'Cancel', variant: 'secondary' },
      { label: 'Remove', variant: 'danger' },
    ]);
    await act(async () => {
      buttons[1].props.onPress();
    });
    expect(result).toBe(true);
  });

  it('resolves false on cancel', async () => {
    const presenter = mount();
    let result: boolean | undefined;
    act(() => {
      void presenter.confirm({ ...CONFIRM_OPTIONS, destructive: false }).then((v) => {
        result = v;
      });
    });
    const buttons = dialogButtons(renderer!);
    // A non-destructive confirm keeps the primary role.
    expect(buttons[1].props.variant).toBe('primary');
    await act(async () => {
      buttons[0].props.onPress();
    });
    expect(result).toBe(false);
  });

  it('uses the caller-declared vertical layout for a long confirm action', () => {
    const presenter = mount();
    act(() => {
      void presenter.confirm({ ...CONFIRM_OPTIONS, actionLayout: 'vertical' });
    });

    expect(renderer!.root.findByType(ActionRow).props.layout).toBe('vertical');
  });

  it('presents a notice as one primary button and resolves on dismissal', async () => {
    const presenter = mount();
    let resolved = false;
    act(() => {
      void presenter.notify({ title: 'Saved', okLabel: 'OK' }).then(() => {
        resolved = true;
      });
    });
    const buttons = dialogButtons(renderer!);
    expect(buttons.map((b) => ({ label: b.props.label, variant: b.props.variant }))).toEqual([
      { label: 'OK', variant: 'primary' },
    ]);
    await act(async () => {
      buttons[0].props.onPress();
    });
    expect(resolved).toBe(true);
  });

  it('queues a second dialog instead of replacing the visible one', async () => {
    const presenter = mount();
    const results: boolean[] = [];
    act(() => {
      void presenter.confirm(CONFIRM_OPTIONS).then((v) => results.push(v));
      void presenter
        .confirm({ ...CONFIRM_OPTIONS, title: 'Second', confirmLabel: 'Keep' })
        .then((v) => results.push(v));
    });
    // Only the first dialog is visible — one confirm pair, not two.
    expect(dialogButtons(renderer!).map((b) => b.props.label)).toEqual(['Cancel', 'Remove']);
    await act(async () => {
      dialogButtons(renderer!)[1].props.onPress();
    });
    expect(dialogButtons(renderer!).map((b) => b.props.label)).toEqual(['Cancel', 'Keep']);
    await act(async () => {
      dialogButtons(renderer!)[0].props.onPress();
    });
    expect(results).toEqual([true, false]);
    expect(dialogButtons(renderer!)).toEqual([]);
  });

  it('ignores a double settle of the same dialog', async () => {
    const presenter = mount();
    const results: boolean[] = [];
    act(() => {
      void presenter.confirm(CONFIRM_OPTIONS).then((v) => results.push(v));
      void presenter
        .confirm({ ...CONFIRM_OPTIONS, title: 'Second' })
        .then((v) => results.push(v));
    });
    const confirmButton = dialogButtons(renderer!)[1];
    await act(async () => {
      confirmButton.props.onPress();
      confirmButton.props.onPress();
    });
    expect(results).toEqual([true]);
    // The queued dialog is still pending, not dropped by the double settle.
    expect(dialogButtons(renderer!).map((b) => b.props.label)).toEqual(['Cancel', 'Remove']);
  });
});

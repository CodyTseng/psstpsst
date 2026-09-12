import { shouldSendOnDesktopKeyPress } from '../desktop-send-shortcut';

describe('desktop send shortcut', () => {
  it('uses Command+Enter on macOS', () => {
    expect(
      shouldSendOnDesktopKeyPress({
        key: 'Enter',
        metaKey: true,
        platform: 'darwin',
      }),
    ).toBe(true);
    expect(
      shouldSendOnDesktopKeyPress({
        key: 'Enter',
        ctrlKey: true,
        platform: 'darwin',
      }),
    ).toBe(false);
  });

  it.each(['win32', 'linux'])('uses Ctrl+Enter on %s', (platform) => {
    expect(
      shouldSendOnDesktopKeyPress({ key: 'Enter', ctrlKey: true, platform }),
    ).toBe(true);
    expect(
      shouldSendOnDesktopKeyPress({ key: 'Enter', metaKey: true, platform }),
    ).toBe(false);
  });

  it('leaves Shift+Enter to insert a newline', () => {
    expect(
      shouldSendOnDesktopKeyPress({
        key: 'Enter',
        metaKey: true,
        shiftKey: true,
        platform: 'darwin',
      }),
    ).toBe(false);
    expect(
      shouldSendOnDesktopKeyPress({
        key: 'Enter',
        ctrlKey: true,
        shiftKey: true,
        platform: 'linux',
      }),
    ).toBe(false);
  });

  it('sends plain Enter only when the preference is enabled', () => {
    expect(
      shouldSendOnDesktopKeyPress({
        key: 'Enter',
        enterToSend: true,
        platform: 'darwin',
      }),
    ).toBe(true);
    expect(
      shouldSendOnDesktopKeyPress({
        key: 'Enter',
        enterToSend: false,
        platform: 'darwin',
      }),
    ).toBe(false);
  });

  it('does not send during IME composition or key repeat', () => {
    expect(
      shouldSendOnDesktopKeyPress({
        key: 'Enter',
        metaKey: true,
        isComposing: true,
        platform: 'darwin',
      }),
    ).toBe(false);
    expect(
      shouldSendOnDesktopKeyPress({
        key: 'Enter',
        ctrlKey: true,
        repeat: true,
        platform: 'linux',
      }),
    ).toBe(false);
  });
});

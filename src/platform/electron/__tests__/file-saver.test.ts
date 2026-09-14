import type { ElectronBridge } from '../bridge';
import { electronFileSaverAdapter } from '../file-saver';

describe('Electron file-saver adapter', () => {
  afterEach(() => {
    delete window.psstpsstDesktop;
  });

  it('always uses Save As with the original filename', async () => {
    const saveFile = jest.fn().mockResolvedValue(true);
    window.psstpsstDesktop = {
      dialogs: { saveFile } as unknown as ElectronBridge['dialogs'],
    } as ElectronBridge;

    await expect(
      electronFileSaverAdapter.save('psstpsst-file://attachments/hash.bin', {
        suggestedName: 'recording.mp3',
        mimeType: 'audio/mpeg',
      }),
    ).resolves.toBe(true);

    expect(saveFile).toHaveBeenCalledWith(
      'psstpsst-file://attachments/hash.bin',
      'recording.mp3',
    );
  });
});

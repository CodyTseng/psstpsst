import { Linking } from 'react-native';

import { urlOpenerAdapter } from '../url-opener';

describe('Expo URL opener', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports when the operating system accepts the URL', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(undefined);

    await expect(urlOpenerAdapter.openExternalUrl('lightning:lnbc1test')).resolves.toBe(true);
  });

  it('reports failure without rejecting when no app handles the URL', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('No handler'));

    await expect(urlOpenerAdapter.openExternalUrl('lightning:lnbc1test')).resolves.toBe(false);
  });
});

describe('remote signer application identity', () => {
  afterEach(() => jest.resetModules());

  it.each([
    [{ IS_IOS: true }, 'iOS'],
    [{ IS_ANDROID: true }, 'Android'],
    [{ IS_ELECTRON: true, DESKTOP_OS: 'darwin' }, 'macOS'],
    [{ IS_ELECTRON: true, DESKTOP_OS: 'win32' }, 'Windows'],
    [{ IS_ELECTRON: true, DESKTOP_OS: 'linux' }, 'Linux'],
  ])('identifies the platform for %s', (platform, label) => {
    jest.doMock('@/lib/platform', () => platform);
    const { signerClientMetadata, DEFAULT_SIGNER_CLIENT_NAME } = jest.requireActual<typeof import('../client-metadata')>('../client-metadata');
    expect(DEFAULT_SIGNER_CLIENT_NAME).toBe(`PsstPsst (${label})`);
    expect(signerClientMetadata().name).toBe(DEFAULT_SIGNER_CLIENT_NAME);
    expect(signerClientMetadata('   ').name).toBe(DEFAULT_SIGNER_CLIENT_NAME);
    expect(signerClientMetadata('  My device  ').name).toBe('My device');
    expect(signerClientMetadata().image).toBe('https://raw.githubusercontent.com/CodyTseng/psstpsst/master/assets/images/icon.png');
    expect(signerClientMetadata()).not.toHaveProperty('url');
  });
});

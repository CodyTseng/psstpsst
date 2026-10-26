import type { PlatformAdapters } from '../ports';

describe('platform registry', () => {
  it('lazily defaults to the Expo adapter set', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module instance
      const fresh = require('../registry') as typeof import('../registry');
      expect(fresh.getPlatform().database).toBeDefined();
    });
  });

  it('uses a custom adapter set installed before first use', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module instance
      const fresh = require('../registry') as typeof import('../registry');
      const fake = { security: { getItem: jest.fn() } } as unknown as PlatformAdapters;
      fresh.initPlatformAdapters(fake);
      expect(fresh.getPlatform()).toBe(fake);
    });
  });

  it('rejects a second initialization', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module instance
      const fresh = require('../registry') as typeof import('../registry');
      const fake = { security: { getItem: jest.fn() } } as unknown as PlatformAdapters;
      fresh.initPlatformAdapters(fake);
      expect(() => fresh.initPlatformAdapters(fake)).toThrow(/already initialized/);
    });
  });

  it('resolves port access through the proxy at call time', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module instance
      const freshRegistry = require('../registry') as typeof import('../registry');
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module instance
      const { platform } = require('../index') as typeof import('../index');
      const fake = {
        security: { accessStatus: jest.fn().mockResolvedValue('available') },
      } as unknown as PlatformAdapters;
      freshRegistry.initPlatformAdapters(fake);
      expect(platform.security).toBe(fake.security);
    });
  });
  it('does not expose vault transport through the public platform facade', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- fresh module instance
      const { platform } = require('../index') as typeof import('../index');
      expect(() => Reflect.get(platform, 'keyVault')).toThrow('vault transport is internal');
      expect(() => Reflect.get(platform, 'secureStorage')).toThrow();
    });
  });

});

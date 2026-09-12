import path from 'node:path';

import {
  parseNativeProximityMessage,
  validateNativeProximityHandshake,
} from '../proximity-protocol';
import { ProximityService } from '../proximity-service';

describe('Electron native proximity protocol', () => {
  it('resolves the development helper from the Electron application root', () => {
    expect(
      ProximityService.executable('/missing/resources', '/workspace/desktop'),
    ).toBe(
      path.join(
        '/workspace/desktop',
        'native',
        'proximity',
        'bin',
        process.platform,
        process.platform === 'win32'
          ? 'psstpsst-proximity.exe'
          : 'psstpsst-proximity',
      ),
    );
  });

  it('accepts only allowlisted events and valid responses', () => {
    expect(
      parseNativeProximityMessage(
        '{"type":"event","name":"onMessage","value":{"endpointId":"c:1"}}',
      ),
    ).toEqual({
      type: 'event',
      name: 'onMessage',
      value: { endpointId: 'c:1' },
    });
    expect(
      parseNativeProximityMessage(
        '{"type":"event","name":"arbitrary","value":{}}',
      ),
    ).toBeNull();
    expect(parseNativeProximityMessage('{broken')).toBeNull();
  });

  it('requires both BLE roles and the expected platform', () => {
    expect(
      validateNativeProximityHandshake(
        {
          protocolVersion: 1,
          implementationVersion: 'test-1',
          platform: process.platform,
          capabilities: {
            central: true,
            peripheral: true,
            concurrentRoles: true,
          },
        },
        process.platform,
      ),
    ).toMatchObject({ protocolVersion: 1, platform: process.platform });
    expect(() =>
      validateNativeProximityHandshake(
        {
          protocolVersion: 1,
          implementationVersion: 'test-1',
          platform: process.platform,
          capabilities: {
            central: true,
            peripheral: false,
            concurrentRoles: false,
          },
        },
        process.platform,
      ),
    ).toThrow('required BLE roles');
  });

  it('probes and calls a helper without initializing Bluetooth', async () => {
    const service = new ProximityService(process.execPath, jest.fn(), [
      path.join(process.cwd(), 'desktop/native/proximity/fake-helper.mjs'),
    ]);
    await expect(service.initialize()).resolves.toBe(true);
    expect(service.isAvailable()).toBe(true);
    await expect(service.requestPermissions()).resolves.toBe(true);
    await expect(service.disconnect('c:test')).resolves.toBeUndefined();
    service.close();
    expect(service.isAvailable()).toBe(false);
  });

  it('restarts the helper after a native transport failure', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const service = new ProximityService(process.execPath, jest.fn(), [
      path.join(process.cwd(), 'desktop/native/proximity/fake-helper.mjs'),
    ]);
    await expect(service.initialize()).resolves.toBe(true);
    await expect(
      service.startAdvertising('{"id":"local"}'),
    ).resolves.toBeUndefined();
    await expect(service.send('c:crash', 'payload')).rejects.toThrow(
      'Proximity module exited',
    );
    expect(service.isAvailable()).toBe(false);
    await expect(service.startScan(1_000)).resolves.toBeUndefined();
    expect(service.isAvailable()).toBe(true);
    service.close();
    consoleError.mockRestore();
  });

  it('keeps transport operations benign when the helper is unavailable', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const service = new ProximityService(
      '/missing/psstpsst-proximity',
      jest.fn(),
    );
    await expect(service.initialize()).resolves.toBe(false);
    await expect(service.requestPermissions()).resolves.toBe(false);
    await expect(service.startAdvertising('{}')).resolves.toBeUndefined();
    await expect(service.startScan(1_000)).resolves.toBeUndefined();
    await expect(service.send('c:missing', 'payload')).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith(
      '[proximity-native] helper is missing: /missing/psstpsst-proximity',
    );
    consoleError.mockRestore();
  });
});

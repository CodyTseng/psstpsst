import { NativeModule, registerWebModule } from 'expo';

class ExpoNoiseModule extends NativeModule {
  private unavailable(): Error {
    return new Error('Native Noise sessions are unavailable on web');
  }

  generateKeyPairAsync(): Promise<never> { return Promise.reject(this.unavailable()); }
  createHandshakeAsync(): Promise<never> { return Promise.reject(this.unavailable()); }
  writeHandshakeAsync(): Promise<never> { return Promise.reject(this.unavailable()); }
  readHandshakeAsync(): Promise<never> { return Promise.reject(this.unavailable()); }
  getRemoteStaticKeyAsync(): Promise<never> { return Promise.reject(this.unavailable()); }
  finishHandshakeAsync(): Promise<never> { return Promise.reject(this.unavailable()); }
  destroyHandshakeAsync(): Promise<never> { return Promise.reject(this.unavailable()); }
  shouldRotateSessionAsync(): Promise<never> { return Promise.reject(this.unavailable()); }
  sealAsync(): Promise<never> { return Promise.reject(this.unavailable()); }
  openAsync(): Promise<never> { return Promise.reject(this.unavailable()); }
  destroySessionAsync(): Promise<never> { return Promise.reject(this.unavailable()); }
}

export default registerWebModule(ExpoNoiseModule, 'ExpoNoise');

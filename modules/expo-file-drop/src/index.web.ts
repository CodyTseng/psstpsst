import { NativeModule, registerWebModule } from 'expo';

class ExpoFileDropModule extends NativeModule {
  async setEnabledAsync(_enabled: boolean): Promise<void> {}
}

export default registerWebModule(ExpoFileDropModule, 'ExpoFileDrop');

const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

const androidPermissions = [
  ['android.permission.BLUETOOTH', 30],
  ['android.permission.BLUETOOTH_ADMIN', 30],
  ['android.permission.ACCESS_FINE_LOCATION', 30],
  ['android.permission.BLUETOOTH_SCAN'],
  ['android.permission.BLUETOOTH_ADVERTISE'],
  ['android.permission.BLUETOOTH_CONNECT'],
];

function withAndroidBluetooth(config) {
  return withAndroidManifest(config, (result) => {
    const manifest = result.modResults.manifest;
    const existing = manifest['uses-permission'] ?? [];
    for (const [name, maxSdkVersion] of androidPermissions) {
      if (existing.some((entry) => entry.$?.['android:name'] === name)) continue;
      const attributes = { 'android:name': name };
      if (maxSdkVersion) attributes['android:maxSdkVersion'] = String(maxSdkVersion);
      if (name === 'android.permission.BLUETOOTH_SCAN') {
        attributes['android:usesPermissionFlags'] = 'neverForLocation';
      }
      existing.push({ $: attributes });
    }
    manifest['uses-permission'] = existing;
    return result;
  });
}

function withIosBluetooth(config) {
  return withInfoPlist(config, (result) => {
    result.modResults.NSBluetoothAlwaysUsageDescription =
      'Allow $(PRODUCT_NAME) to find and message people nearby.';
    return result;
  });
}

module.exports = (config) => withIosBluetooth(withAndroidBluetooth(config));

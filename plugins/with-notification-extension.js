const { withDangerousMod, withEntitlementsPlist, withInfoPlist, withXcodeProject } = require('expo/config-plugins');
const plist = require('@expo/plist');
const { cp, mkdir, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const journal = require('../src/db/migrations/meta/_journal.json');

const TARGET = 'PsstPsstNotificationService';

function vaultBuildSettings() {
  return {
    SWIFT_OBJC_BRIDGING_HEADER: `"${TARGET}/ExpoCryptoAcceleratorSecp256k1.h"`,
    HEADER_SEARCH_PATHS: [
      '"$(inherited)"',
      '"$(SRCROOT)/../modules/expo-crypto-accelerator/android/src/main/cpp/secp256k1/include"',
      '"$(SRCROOT)/../modules/expo-crypto-accelerator/android/src/main/cpp/secp256k1/src"',
    ],
    GCC_PREPROCESSOR_DEFINITIONS: [
      '"$(inherited)"', '"ENABLE_MODULE_EXTRAKEYS=1"', '"ENABLE_MODULE_SCHNORRSIG=1"',
      '"ECMULT_WINDOW_SIZE=15"', '"COMB_BLOCKS=43"', '"COMB_TEETH=6"', '"SECP256K1_NO_API_VISIBILITY_ATTRIBUTES=1"',
    ],
  };
}

module.exports = function withNotificationExtension(config) {
  const identity = config.ios.bundleIdentifier;
  const appGroup = `group.${identity}.notifications`;
  const legacyKeychainGroup = `$(AppIdentifierPrefix)${identity}.notifications`;
  const keychainGroup = `$(AppIdentifierPrefix)${identity}.messaging`;
  const extensionId = `${identity}.notifications`;
  const extensionEntitlements = {
    'com.apple.security.application-groups': [appGroup],
    'keychain-access-groups': [keychainGroup],
    // TODO(APNS_FILTERING_APPROVAL): Temporarily disabled so device builds can
    // be signed while Apple's Notification (NSE) Filtering approval is pending.
    // After approval for each extension App ID, uncomment the entitlement below,
    // regenerate provisioning profiles, and rerun prebuild for both app variants.
    // Without it, local suppression cannot guarantee that no system alert appears.
    // 'com.apple.developer.usernotifications.filtering': true,
  };
  config = withEntitlementsPlist(config, (mod) => {
    // Communication Notifications belongs to the containing app target.
    // The NSE provides INSendMessageIntent content without declaring this entitlement.
    mod.modResults['com.apple.developer.usernotifications.communication'] = true;
    const unique = (values) => [...new Set(values)];
    mod.modResults['com.apple.security.application-groups'] = unique([
      ...(mod.modResults['com.apple.security.application-groups'] ?? []), appGroup,
    ]);
    // SecureStore calls without an explicit accessGroup must remain app-private.
    // Only messaging credentials explicitly select the notification-sharing group.
    mod.modResults['keychain-access-groups'] = unique([
      `$(AppIdentifierPrefix)${identity}`,
      ...(mod.modResults['keychain-access-groups'] ?? []), legacyKeychainGroup, keychainGroup,
    ]);
    return mod;
  });
  config = withInfoPlist(config, (mod) => {
    mod.modResults.PsstPsstLegacyKeychainGroup = legacyKeychainGroup;
    mod.modResults.PsstPsstPrivateKeychainGroup = `$(AppIdentifierPrefix)${identity}`;
    // iOS uses APNs instead of periodic workers; remove their generated capabilities.
    if (Array.isArray(mod.modResults.UIBackgroundModes)) {
      const modes = mod.modResults.UIBackgroundModes.filter(
        (mode) => mode !== 'fetch' && mode !== 'processing',
      );
      if (modes.length) mod.modResults.UIBackgroundModes = modes;
      else delete mod.modResults.UIBackgroundModes;
    }
    if (Array.isArray(mod.modResults.BGTaskSchedulerPermittedIdentifiers)) {
      const identifiers = mod.modResults.BGTaskSchedulerPermittedIdentifiers.filter(
        (id) => id !== 'com.expo.modules.backgroundtask.processing',
      );
      if (identifiers.length) mod.modResults.BGTaskSchedulerPermittedIdentifiers = identifiers;
      else delete mod.modResults.BGTaskSchedulerPermittedIdentifiers;
    }
    mod.modResults.NSUserActivityTypes = [...new Set([
      ...(mod.modResults.NSUserActivityTypes ?? []), 'INSendMessageIntent',
    ])];
    mod.modResults.PsstPsstAppGroup = appGroup;
    mod.modResults.PsstPsstKeychainGroup = keychainGroup;
    return mod;
  });
  const existing = config.extra?.eas?.build?.experimental?.ios?.appExtensions ?? [];
  config.extra = {
    ...config.extra,
    eas: { ...config.extra?.eas, build: { ...config.extra?.eas?.build,
      experimental: { ...config.extra?.eas?.build?.experimental,
        ios: { ...config.extra?.eas?.build?.experimental?.ios,
          appExtensions: [...existing.filter((entry) => entry.targetName !== TARGET), {
            targetName: TARGET, bundleIdentifier: extensionId, entitlements: extensionEntitlements,
          }],
        },
      },
    } },
  };
  config = withDangerousMod(config, ['ios', async (mod) => {
    const root = mod.modRequest.projectRoot;
    const directory = join(mod.modRequest.platformProjectRoot, TARGET);
    await mkdir(directory, { recursive: true });
    for (const file of ['NotificationService.swift', 'NotificationRuntime.swift', 'bootstrap.js', 'SharedNotificationContext.swift', 'CommunicationNotification.swift']) {
      await cp(join(root, file.endsWith('Context.swift') || file === 'CommunicationNotification.swift' ? 'modules/expo-local-notifications/ios' : 'ios-notification-extension', file), join(directory, file));
    }
    for (const file of ['NativeKeyVault.swift', 'ExpoCryptoAcceleratorSecp256k1.h', 'ExpoCryptoAcceleratorSecp256k1.m']) {
      await cp(join(root, 'modules/expo-crypto-accelerator/ios', file), join(directory, file));
    }
    await writeFile(join(directory, 'VaultSecp256k1.c'), '#include "../../modules/expo-crypto-accelerator/ios/ExpoCryptoAcceleratorSecp256k1Lib.c"\n');
    await writeFile(join(directory, 'VaultChaCha.c'), '#include "../../modules/expo-crypto-accelerator/shared/VaultChaCha.c"\n#include "../../modules/expo-crypto-accelerator/shared/VaultPin.c"\n');
    const { buildNotificationExtension } = await import(pathToFileURL(join(root, 'scripts/build-notification-extension.mjs')).href);
    await buildNotificationExtension(join(directory, 'processor.js'));
    await writeFile(join(directory, 'Info.plist'), plist.default.build({
      CFBundleDisplayName: 'PsstPsst Notifications',
      CFBundleExecutable: '$(EXECUTABLE_NAME)',
      CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
      CFBundleInfoDictionaryVersion: '6.0',
      CFBundleName: '$(PRODUCT_NAME)',
      CFBundlePackageType: 'XPC!',
      CFBundleShortVersionString: config.version,
      CFBundleVersion: config.ios.buildNumber,
      PsstPsstAppGroup: appGroup,
      PsstPsstKeychainGroup: keychainGroup,
      PsstPsstSchemaVersion: journal.entries.at(-1).when,
      NSUserActivityTypes: ['INSendMessageIntent'],
      NSExtension: {
        NSExtensionAttributes: { IntentsSupported: ['INSendMessageIntent'] },
        NSExtensionPointIdentifier: 'com.apple.usernotifications.service',
        NSExtensionPrincipalClass: '$(PRODUCT_MODULE_NAME).NotificationService',
      },
    }));
    await writeFile(join(directory, `${TARGET}.entitlements`), plist.default.build(extensionEntitlements));
    return mod;
  }]);
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    if (project.pbxTargetByName(TARGET)) {
      const targetId = project.findTargetKey(TARGET);
      const groupId = project.findPBXGroupKey({ name: TARGET });
      // Existing generated projects need new sources and the same native vault settings.
      for (const file of ['CommunicationNotification.swift', 'NativeKeyVault.swift', 'ExpoCryptoAcceleratorSecp256k1.m', 'VaultSecp256k1.c', 'VaultChaCha.c']) {
        if (!project.hasFile(file)) project.addSourceFile(file, { target: targetId }, groupId);
      }
      const configurations = project.pbxXCBuildConfigurationSection();
      const target = project.pbxNativeTargetSection()[targetId];
      const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
      for (const reference of list.buildConfigurations) Object.assign(configurations[reference.value].buildSettings, vaultBuildSettings());
      return mod;
    }
    if (!project.pbxGroupByName('Resources')) {
      const resources = project.addPbxGroup([], 'Resources');
      project.addToPbxGroup(resources.uuid, project.getFirstProject().firstProject.mainGroup);
    }
    const target = project.addTarget(TARGET, 'app_extension', TARGET, extensionId);
    const group = project.addPbxGroup([], TARGET, TARGET);
    project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
    const bundlePhase = project.addBuildPhase([], 'PBXShellScriptBuildPhase', 'Bundle notification processor', target.uuid, {
      shellPath: '/bin/sh',
      shellScript: [
        'set -e',
        'if [ -f "$SRCROOT/.xcode.env" ]; then . "$SRCROOT/.xcode.env"; fi',
        'if [ -f "$SRCROOT/.xcode.env.local" ]; then . "$SRCROOT/.xcode.env.local"; fi',
        `export EXPO_PUBLIC_APP_ENV=${identity.endsWith('.dev') ? 'development' : 'production'}`,
        `"\${NODE_BINARY:-node}" "$SRCROOT/../scripts/build-notification-extension.mjs" "$SRCROOT/${TARGET}/processor.js"`,
      ].join('\n'),
      outputPaths: [`"$(SRCROOT)/${TARGET}/processor.js"`],
    });
    bundlePhase.buildPhase.alwaysOutOfDate = 1;
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
    for (const file of ['NotificationService.swift', 'NotificationRuntime.swift', 'SharedNotificationContext.swift', 'CommunicationNotification.swift', 'NativeKeyVault.swift', 'ExpoCryptoAcceleratorSecp256k1.m', 'VaultSecp256k1.c', 'VaultChaCha.c']) {
      project.addSourceFile(file, { target: target.uuid }, group.uuid);
    }
    for (const file of ['bootstrap.js', 'processor.js']) {
      project.addResourceFile(file, { target: target.uuid }, group.uuid);
    }
    const lists = project.pbxXCConfigurationList();
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const reference of lists[target.pbxNativeTarget.buildConfigurationList].buildConfigurations) {
      Object.assign(configurations[reference.value].buildSettings, {
        INFOPLIST_FILE: `${TARGET}/Info.plist`,
        CODE_SIGN_ENTITLEMENTS: `${TARGET}/${TARGET}.entitlements`,
        CODE_SIGN_STYLE: 'Automatic',
        DEVELOPMENT_TEAM: config.ios.appleTeamId,
        IPHONEOS_DEPLOYMENT_TARGET: '16.4',
        SWIFT_VERSION: '5.0',
        ...vaultBuildSettings(),
        TARGETED_DEVICE_FAMILY: '"1,2"',
        APPLICATION_EXTENSION_API_ONLY: 'YES',
        GENERATE_INFOPLIST_FILE: 'NO',
        ENABLE_USER_SCRIPT_SANDBOXING: 'NO',
        OTHER_LDFLAGS: '"$(inherited) -lsqlite3"',
        CURRENT_PROJECT_VERSION: config.ios.buildNumber,
        MARKETING_VERSION: config.version,
      });
    }
    return mod;
  });
};

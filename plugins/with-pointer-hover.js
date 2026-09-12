const { withAppDelegate, withInfoPlist, withMainApplication } = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-pointer-hover';
const IOS_START = `// @generated begin ${PLUGIN_NAME}`;
const IOS_END = `// @generated end ${PLUGIN_NAME}`;
const ANDROID_START = `// @generated begin ${PLUGIN_NAME}`;
const ANDROID_END = `// @generated end ${PLUGIN_NAME}`;
const ANDROID_IMPORT = 'import com.facebook.react.config.ReactFeatureFlags';

function applyIosInfoPlist(infoPlist) {
  infoPlist.UIApplicationSupportsIndirectInputEvents = true;
  return infoPlist;
}

function applyIosPointerEvents(contents) {
  if (contents.includes(IOS_START)) return contents;

  const factoryDeclaration = '    let delegate = ReactNativeDelegate()';
  if (!contents.includes(factoryDeclaration)) {
    throw new Error(`${PLUGIN_NAME}: unable to find the React Native factory setup`);
  }

  return contents.replace(
    factoryDeclaration,
    [
      `    ${IOS_START}`,
      '    RCTSetDispatchW3CPointerEvents(true)',
      `    ${IOS_END}`,
      factoryDeclaration,
    ].join('\n'),
  );
}

function applyAndroidPointerEvents(contents) {
  let next = contents;
  if (!next.includes(`${ANDROID_IMPORT}\n`)) {
    const packageDeclaration = /^package [^\n]+\n/m;
    if (!packageDeclaration.test(next)) {
      throw new Error(`${PLUGIN_NAME}: unable to find the MainApplication package declaration`);
    }
    next = next.replace(packageDeclaration, (match) => `${match}\n${ANDROID_IMPORT}\n`);
  }

  if (next.includes(ANDROID_START)) return next;

  const superCall = '    super.onCreate()';
  if (!next.includes(superCall)) {
    throw new Error(`${PLUGIN_NAME}: unable to find MainApplication.onCreate`);
  }

  return next.replace(
    superCall,
    [
      superCall,
      `    ${ANDROID_START}`,
      '    ReactFeatureFlags.dispatchPointerEvents = true',
      `    ${ANDROID_END}`,
    ].join('\n'),
  );
}

function withPointerHover(config) {
  config = withInfoPlist(config, (result) => {
    result.modResults = applyIosInfoPlist(result.modResults);
    return result;
  });

  config = withAppDelegate(config, (result) => {
    if (result.modResults.language !== 'swift') {
      throw new Error(`${PLUGIN_NAME}: only Swift AppDelegate files are supported`);
    }
    result.modResults.contents = applyIosPointerEvents(result.modResults.contents);
    return result;
  });

  config = withMainApplication(config, (result) => {
    if (result.modResults.language !== 'kt') {
      throw new Error(`${PLUGIN_NAME}: only Kotlin MainApplication files are supported`);
    }
    result.modResults.contents = applyAndroidPointerEvents(result.modResults.contents);
    return result;
  });

  return config;
}

module.exports = withPointerHover;
module.exports.applyAndroidPointerEvents = applyAndroidPointerEvents;
module.exports.applyIosInfoPlist = applyIosInfoPlist;
module.exports.applyIosPointerEvents = applyIosPointerEvents;

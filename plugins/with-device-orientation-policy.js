const { withInfoPlist, withMainActivity } = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-device-orientation-policy';
const POLICY_START = `// @generated begin ${PLUGIN_NAME}`;
const POLICY_END = `// @generated end ${PLUGIN_NAME}`;
const ON_CREATE_START = `// @generated begin ${PLUGIN_NAME} on-create`;
const ON_CREATE_END = `// @generated end ${PLUGIN_NAME} on-create`;

const PHONE_ORIENTATIONS = ['UIInterfaceOrientationPortrait'];
const LARGE_DISPLAY_ORIENTATIONS = [
  'UIInterfaceOrientationPortrait',
  'UIInterfaceOrientationPortraitUpsideDown',
  'UIInterfaceOrientationLandscapeLeft',
  'UIInterfaceOrientationLandscapeRight',
];

const ANDROID_IMPORTS = [
  'android.content.pm.ActivityInfo',
  'android.content.res.Configuration',
  'android.os.Build',
  'android.util.DisplayMetrics',
  'kotlin.math.min',
];

const ANDROID_POLICY = [
  `  ${POLICY_START}`,
  '  private fun isLargeDisplay(): Boolean {',
  '    val smallestWidthDp = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {',
  '      val bounds = windowManager.maximumWindowMetrics.bounds',
  '      min(bounds.width(), bounds.height()) / resources.displayMetrics.density',
  '    } else {',
  '      val metrics = DisplayMetrics()',
  '      @Suppress("DEPRECATION")',
  '      windowManager.defaultDisplay.getRealMetrics(metrics)',
  '      min(metrics.widthPixels, metrics.heightPixels) / metrics.density',
  '    }',
  '    return smallestWidthDp >= LARGE_DISPLAY_SMALLEST_WIDTH_DP',
  '  }',
  '',
  '  private fun applyDisplayOrientationPolicy() {',
  '    requestedOrientation = if (isLargeDisplay()) {',
  '      ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED',
  '    } else {',
  '      ActivityInfo.SCREEN_ORIENTATION_PORTRAIT',
  '    }',
  '  }',
  '',
  '  override fun onConfigurationChanged(newConfig: Configuration) {',
  '    super.onConfigurationChanged(newConfig)',
  '    applyDisplayOrientationPolicy()',
  '  }',
  '',
  '  private companion object {',
  '    const val LARGE_DISPLAY_SMALLEST_WIDTH_DP = 600f',
  '  }',
  `  ${POLICY_END}`,
].join('\n');

const ANDROID_ON_CREATE = [
  `    ${ON_CREATE_START}`,
  '    applyDisplayOrientationPolicy()',
  `    ${ON_CREATE_END}`,
].join('\n');

function applyIosOrientationPolicy(infoPlist) {
  infoPlist.UISupportedInterfaceOrientations = [...PHONE_ORIENTATIONS];
  infoPlist['UISupportedInterfaceOrientations~ipad'] = [...LARGE_DISPLAY_ORIENTATIONS];
  return infoPlist;
}

function ensureAndroidImports(contents) {
  const missing = ANDROID_IMPORTS.filter(
    (name) => !contents.includes(`import ${name}\n`),
  );
  if (missing.length === 0) return contents;

  const packageDeclaration = /^package [^\n]+\n/m;
  if (!packageDeclaration.test(contents)) {
    throw new Error(`${PLUGIN_NAME}: unable to find the MainActivity package declaration`);
  }
  return contents.replace(
    packageDeclaration,
    (match) => `${match}${missing.map((name) => `import ${name}`).join('\n')}\n`,
  );
}

function applyAndroidOrientationPolicy(contents) {
  let next = ensureAndroidImports(contents);

  if (!next.includes(POLICY_START)) {
    const classDeclaration = /class MainActivity\s*:\s*ReactActivity\(\)\s*\{\n/;
    if (!classDeclaration.test(next)) {
      throw new Error(`${PLUGIN_NAME}: unable to find the Kotlin MainActivity class`);
    }
    next = next.replace(classDeclaration, (match) => `${match}${ANDROID_POLICY}\n\n`);
  }

  if (!next.includes(ON_CREATE_START)) {
    const onCreateDeclaration = /(override fun onCreate\(savedInstanceState: Bundle\?\) \{\n)/;
    if (!onCreateDeclaration.test(next)) {
      throw new Error(`${PLUGIN_NAME}: unable to find MainActivity.onCreate`);
    }
    next = next.replace(onCreateDeclaration, (match) => `${match}${ANDROID_ON_CREATE}\n`);
  }

  return next;
}

function withDeviceOrientationPolicy(config) {
  config = withInfoPlist(config, (result) => {
    result.modResults = applyIosOrientationPolicy(result.modResults);
    return result;
  });

  config = withMainActivity(config, (result) => {
    if (result.modResults.language !== 'kt') {
      throw new Error(`${PLUGIN_NAME}: only Kotlin MainActivity files are supported`);
    }
    result.modResults.contents = applyAndroidOrientationPolicy(result.modResults.contents);
    return result;
  });

  return config;
}

module.exports = withDeviceOrientationPolicy;
module.exports.applyAndroidOrientationPolicy = applyAndroidOrientationPolicy;
module.exports.applyIosOrientationPolicy = applyIosOrientationPolicy;

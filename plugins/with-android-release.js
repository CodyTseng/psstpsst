const { withAppBuildGradle, withDangerousMod, withGradleProperties, withProjectBuildGradle } = require('expo/config-plugins');
const { mkdir, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

const MARKER = '// PsstPsst Android ABI outputs';
const GRADLE = `
${MARKER}
extensions.getByType(com.facebook.react.ReactExtension).getNodeExecutableAndArgs().set([System.getenv('NODE_BINARY') ?: 'node'])
// Keep ABI digits below the release counter so every new release upgrades all ABIs.
def psstpsstAbiCodes = ['armeabi-v7a': 1, 'arm64-v8a': 2, 'x86': 3, 'x86_64': 4]
def psstpsstBuildAbis = (findProperty('reactNativeArchitectures') ?: psstpsstAbiCodes.keySet().join(',')).split(',')
if (!psstpsstBuildAbis.every { psstpsstAbiCodes.containsKey(it) }) {
    throw new GradleException("Unsupported PsstPsst Android ABI: "+ psstpsstBuildAbis.join(','))
}
def psstpsstBaseVersionCode = android.defaultConfig.versionCode * 10
android.defaultConfig.versionCode = psstpsstBaseVersionCode
// Official releases are signed outside Gradle; local APK builds can opt into the debug key.
android.buildTypes.release.signingConfig = (findProperty('psstpsstDebugSigning') ?: 'false').toBoolean() ? android.signingConfigs.debug : null
android.splits.abi {
    enable = (findProperty('psstpsstAbiSplits') ?: 'false').toBoolean()
    reset()
    include(*psstpsstBuildAbis)
    // Keep the universal APK for direct downloads and Zapstore.
    universalApk = true
}
androidComponents {
    onVariants(selector().all()) { variant ->
        variant.outputs.each { output ->
            def abi = output.filters.find { it.filterType == com.android.build.api.variant.FilterConfiguration.FilterType.ABI }?.identifier
            output.versionCode.set(psstpsstBaseVersionCode + (abi == null ? 0 : psstpsstAbiCodes[abi]))
        }
    }
}
`;

function configureReleaseBuild(contents) {
  // Expo's template disables optimization in the non-optimized default rules.
  contents = contents.replaceAll('getDefaultProguardFile("proguard-android.txt")',
    'getDefaultProguardFile("proguard-android-optimize.txt")');
  return updateGeneratedBlock(contents, MARKER, GRADLE);
}

function updateGeneratedBlock(contents, marker, generated) {
  const endMarker = `// End ${marker.slice(3)}`;
  const block = `${generated.trim()}\n${endMarker}`;
  const start = contents.indexOf(marker);
  if (start === -1) return `${contents.trimEnd()}\n\n${block}\n`;
  const end = contents.indexOf(endMarker, start);
  if (end === -1) {
    throw new Error('Outdated generated Android configuration. Run the Android prebuild command with --clean.');
  }
  return contents.slice(0, start) + block + contents.slice(end + endMarker.length);
}

module.exports = function withAndroidRelease(config) {
  config = withDangerousMod(config, ['android', async (config) => {
    const directory = join(config.modRequest.platformProjectRoot, 'gradle');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'gradle-daemon-jvm.properties'), 'toolchainVersion=21\n');
    return config;
  }]);
  config = withProjectBuildGradle(config, (config) => {
    const marker = '// PsstPsst Android toolchain';
    config.modResults.contents = config.modResults.contents
      .replace('// PsstPsst Kotlin bytecode target', marker)
      .replace('// End PsstPsst Kotlin bytecode target', '// End PsstPsst Android toolchain');
    config.modResults.contents = updateGeneratedBlock(config.modResults.contents, marker, `
${marker}
// JDK 21 supplies the compiler; retain the framework's Java 17 bytecode target.
subprojects {
    plugins.withId('com.android.library') {
        androidComponents.finalizeDsl { library ->
            library.ndkVersion = rootProject.ext.ndkVersion
        }
    }
    plugins.withId('org.jetbrains.kotlin.android') {
        kotlin.compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}
`);
    return config;
  });
  config = withGradleProperties(config, (config) => {
    const properties = {
      'org.gradle.jvmargs': '-Xmx3072m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8',
    };
    if (['1', 'true'].includes(process.env.CI)) {
      properties['org.gradle.vfs.watch'] = 'false';
    }
    // Release resources must not embed the build host's address; development needs LAN discovery.
    if (process.env.EXPO_PUBLIC_APP_ENV !== 'development') {
      properties.reactNativeDevServerIp = '127.0.0.1';
    } else {
      // Also clear our production default when prebuild reuses an existing native project.
      config.modResults = config.modResults.filter((entry) => !(
        entry.type === 'property' && entry.key === 'reactNativeDevServerIp' && entry.value === '127.0.0.1'
      ));
    }
    for (const [key, value] of Object.entries(properties)) {
      const property = config.modResults.find((entry) => entry.type === 'property' && entry.key === key);
      if (property) property.value = value;
      else config.modResults.push({ type: 'property', key, value });
    }
    return config;
  });
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error('PsstPsst Android ABI splits require a Groovy app/build.gradle.');
    }
    config.modResults.contents = configureReleaseBuild(config.modResults.contents);
    return config;
  });
};

module.exports.configureReleaseBuild = configureReleaseBuild;

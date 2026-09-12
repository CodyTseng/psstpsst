const { withPodfile, withXcodeProject } = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-ios-warning-cleanup';
const VIEW_SHOT_PRIVACY_TARGET = 'react-native-view-shot-RNViewShotPrivacyInfo';

function removeDuplicateCppRuntimeFlag(project) {
  const configurations = project.pbxXCBuildConfigurationSection();

  for (const configuration of Object.values(configurations)) {
    if (!configuration || typeof configuration !== 'object' || configuration.isa !== 'XCBuildConfiguration') {
      continue;
    }

    const flags = configuration.buildSettings?.OTHER_LDFLAGS;
    if (!Array.isArray(flags)) {
      continue;
    }

    configuration.buildSettings.OTHER_LDFLAGS = flags.filter((flag) => flag !== '"-lc++"' && flag !== '-lc++');
  }

  return project;
}

function addViewShotPrivacyDeploymentTargetPatch(contents) {
  const startMarker = `# @generated begin ${PLUGIN_NAME}`;
  const endMarker = `# @generated end ${PLUGIN_NAME}`;

  if (contents.includes(startMarker)) {
    return contents;
  }

  const snippet = [
    '',
    `    ${startMarker}`,
    `    min_ios_target = podfile_properties['ios.deploymentTarget'] || '16.4'`,
    `    installer.pods_project.targets.each do |target|`,
    `      next unless target.name == '${VIEW_SHOT_PRIVACY_TARGET}'`,
    '',
    `      target.build_configurations.each do |build_configuration|`,
    `        build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = min_ios_target`,
    `      end`,
    `    end`,
    `    ${endMarker}`,
  ].join('\n');

  const postInstallCall = /^(\s*)react_native_post_install\(\n(?:.*\n)*?\1\)/m;
  if (!postInstallCall.test(contents)) {
    throw new Error(`${PLUGIN_NAME}: unable to find react_native_post_install in ios/Podfile`);
  }

  return contents.replace(postInstallCall, (match) => `${match}${snippet}`);
}

const withIosWarningCleanup = (config) => {
  config = withXcodeProject(config, (config) => {
    config.modResults = removeDuplicateCppRuntimeFlag(config.modResults);
    return config;
  });

  config = withPodfile(config, (config) => {
    config.modResults.contents = addViewShotPrivacyDeploymentTargetPatch(config.modResults.contents);
    return config;
  });

  return config;
};

module.exports = withIosWarningCleanup;

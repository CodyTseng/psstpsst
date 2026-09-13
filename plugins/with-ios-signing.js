const { IOSConfig, withXcodeProject } = require('@expo/config-plugins');

module.exports = function withIosSigning(config) {
  // Xcode mods execute in reverse registration order. Register this plugin before
  // plugins that create targets so newly created extensions receive the team too.
  return withXcodeProject(config, (config) => {
    if (config.ios?.appleTeamId) {
      IOSConfig.DevelopmentTeam.updateDevelopmentTeamForPbxproj(
        config.modResults,
        config.ios.appleTeamId,
      );
    }
    return config;
  });
};

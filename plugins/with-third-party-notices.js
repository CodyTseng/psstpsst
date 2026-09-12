const { withAppBuildGradle, withXcodeProject } = require('expo/config-plugins');

const PHASE_NAME = 'Copy third-party notices';
const GRADLE_MARKER = '// PsstPsst third-party notices';
const IOS_SCRIPT = [
  'set -eu',
  'notice_root="${PROJECT_DIR}/.."',
  'notice_output="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/ThirdPartyNotices"',
  'mkdir -p "$notice_output/licenses/third-party"',
  '/usr/bin/ditto "$notice_root/licenses/third-party/common" "$notice_output/licenses/third-party/common"',
  '/usr/bin/ditto "$notice_root/licenses/zxing-cpp" "$notice_output/licenses/zxing-cpp"',
  'cp "$notice_root/licenses/third-party/snapshots.json" "$notice_output/licenses/third-party/"',
  'cp "$notice_root/THIRD_PARTY_NOTICES.md" "$notice_root/LICENSE" "$notice_output/"',
].join('\n');

module.exports = function withThirdPartyNotices(config) {
  config = withXcodeProject(config, (config) => {
    const project = config.modResults;
    const phases = project.hash.project.objects.PBXShellScriptBuildPhase ?? {};
    if (!Object.values(phases).some((phase) => phase?.name === `"${PHASE_NAME}"`)) {
      const { buildPhase } = project.addBuildPhase([], 'PBXShellScriptBuildPhase', PHASE_NAME, null, {
        shellPath: '/bin/sh',
        shellScript: IOS_SCRIPT,
        inputPaths: [
          '"$(SRCROOT)/../licenses/third-party/common"',
          '"$(SRCROOT)/../licenses/zxing-cpp"',
          '"$(SRCROOT)/../licenses/third-party/snapshots.json"',
          '"$(SRCROOT)/../THIRD_PARTY_NOTICES.md"',
          '"$(SRCROOT)/../LICENSE"',
        ],
        outputPaths: ['"$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/ThirdPartyNotices"'],
      });
      // Files within these directories can change without changing the directory.
      buildPhase.alwaysOutOfDate = 1;
    }
    return config;
  });
  return withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes(GRADLE_MARKER)) {
      config.modResults.contents += `
${GRADLE_MARKER}
def thirdPartyNotices = tasks.register("copyPsstPsstThirdPartyNotices", Sync) {
    from(new File(rootProject.projectDir, "../licenses/third-party/common")) {
        into "ThirdPartyNotices/licenses/third-party/common"
    }
    from(new File(rootProject.projectDir, "../licenses/zxing-cpp")) {
        into "ThirdPartyNotices/licenses/zxing-cpp"
    }
    from(new File(rootProject.projectDir, "../licenses/zxing-cpp")) {
        into "zxing-cpp"
    }
    from(new File(rootProject.projectDir, "../licenses/third-party/snapshots.json")) {
        into "ThirdPartyNotices/licenses/third-party"
    }
    from(new File(rootProject.projectDir, "..")) {
        include "THIRD_PARTY_NOTICES.md", "LICENSE"
        into "ThirdPartyNotices"
    }
    into(layout.buildDirectory.dir("generated/thirdPartyNotices"))
}
android.sourceSets.main.assets.srcDir(layout.buildDirectory.dir("generated/thirdPartyNotices"))
tasks.named("preBuild").configure { dependsOn(thirdPartyNotices) }
`;
    }
    return config;
  });
};

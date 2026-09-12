const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');

const config = getDefaultConfig(__dirname);

// expo-sqlite's web adapter loads wa-sqlite as a WebAssembly asset.
config.resolver.assetExts.push('wasm');
// Original third-party notices remain assets, not JavaScript source strings.
config.resolver.assetExts.push('txt');

module.exports = withUniwindConfig(config, {
  cssEntryFile: './src/global.css',
  dtsFile: './src/uniwind-types.d.ts',
});

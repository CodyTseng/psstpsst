const { build } = require('./package.json');
const identities = require('../config/app-identities.json');

const development = process.env.EXPO_PUBLIC_APP_ENV === 'development';
const identity = development ? identities.development : identities.production;

module.exports = {
  ...build,
  appId: identity.id,
  productName: identity.name,
  protocols: [{ name: identity.name, schemes: [identity.scheme] }],
  extraMetadata: {
    name: identity.packageName,
    productName: identity.name,
    desktopName: `${identity.id}.desktop`,
  },
  linux: { ...build.linux, syncDesktopName: true },
  ...(development ? {
    directories: { ...build.directories, output: '../release/development' },
    publish: null,
    win: { ...build.win, publish: null },
  } : {}),
};

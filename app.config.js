const identities = require('./config/app-identities.json');

module.exports = ({ config }) => {
  const identity = process.env.EXPO_PUBLIC_APP_ENV === 'development'
    ? identities.development
    : identities.production;
  return {
    ...config,
    name: identity.name,
    scheme: identity.scheme,
    ios: { ...config.ios, bundleIdentifier: identity.id },
    android: { ...config.android, package: identity.id },
  };
};

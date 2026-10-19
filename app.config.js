const identities = require('./config/app-identities.json');

module.exports = ({ config }) => {
  const identity = process.env.EXPO_PUBLIC_APP_ENV === 'development'
    ? identities.development
    : identities.production;
  return {
    ...config,
    name: identity.name,
    scheme: identity.scheme,
    ios: {
      ...config.ios,
      bundleIdentifier: identity.id,
      infoPlist: {
        ...config.ios?.infoPlist,
        NSLocationWhenInUseUsageDescription: require('./src/i18n/en.json').napplets.browser_location_usage,
      },
      // Xcode replaces this with the selected provisioning profile's signed value.
      entitlements: { ...config.ios?.entitlements, 'aps-environment': 'development' },
    },
    android: { ...config.android, package: identity.id },
  };
};

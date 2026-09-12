export type AppEnvironment = 'development' | 'production';

/** Build-time product environment. Missing or unknown values fail closed to production. */
export const APP_ENVIRONMENT: AppEnvironment =
  process.env.EXPO_PUBLIC_APP_ENV === 'development' ? 'development' : 'production';

export const IS_DEVELOPMENT_BUILD = APP_ENVIRONMENT === 'development';

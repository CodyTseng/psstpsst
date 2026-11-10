/** First-use choices initialize ordinary rules; the selected preset is never persisted. */
export type AppAuthorizationPreset = 'manual' | 'routine' | 'trusted';
export const APP_AUTHORIZATION_PRESETS: readonly AppAuthorizationPreset[] = ['manual', 'routine', 'trusted'];
export function isAppAuthorizationPreset(value: unknown): value is AppAuthorizationPreset { return APP_AUTHORIZATION_PRESETS.includes(value as AppAuthorizationPreset); }
/** Presence means first-use consent completed, including Manual with no rules. */
export type AppAuthorization = { fullyTrusted: boolean };

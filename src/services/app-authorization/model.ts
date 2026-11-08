/** Application access and account authority; wallet and device consent remain separate. */
export type AppAuthorizationLevel = 'manual' | 'routine' | 'trusted';
export const APP_AUTHORIZATION_LEVELS: readonly AppAuthorizationLevel[] = ['manual', 'routine', 'trusted'];
export function isAppAuthorizationLevel(value: unknown): value is AppAuthorizationLevel { return APP_AUTHORIZATION_LEVELS.includes(value as AppAuthorizationLevel); }

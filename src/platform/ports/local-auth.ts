/**
 * Port for on-device user authentication (biometrics or device credential) —
 * used by the wallet to gate NWC payments (`services/wallet/wallet.service.ts`).
 * The prompt copy is supplied by the caller (it owns i18n); the port deals
 * only with the OS capability.
 *
 * Both methods reject when the OS authentication facility itself errors; the
 * caller maps rejections and `false` verdicts onto its own error taxonomy.
 *
 * All methods are async-first — see the module note in `secure-storage.ts`.
 */
export interface LocalAuthPort {
  /**
   * Whether the user has any authentication method enrolled (biometric or
   * device credential/PIN).
   */
  hasEnrolledAuth(): Promise<boolean>;
  /**
   * Run the OS authentication prompt. Resolves to whether the user
   * authenticated; falling back to the device credential is allowed.
   */
  authenticate(options: { promptMessage: string; cancelLabel: string }): Promise<boolean>;
}

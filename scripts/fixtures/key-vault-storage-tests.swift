import Foundation
import Security

/** Emulates Keychain matching so the real storage code can face raw SecureStore queries. */
private final class TestKeychain {
  var records: [[String: Any]] = []
  var failWrite = false
  var failDelete = false
  private func matches(_ record: [String: Any], _ query: [String: Any]) -> Bool {
    let controls = [kSecReturnData as String, kSecReturnAttributes as String, kSecMatchLimit as String]
    return query.allSatisfy { key, value in
      controls.contains(key) || (record[key].map { NSDictionary(dictionary: [key: $0]).isEqual(to: [key: value]) } ?? false)
    }
  }
  var operations: NativeVaultStorage.Keychain {
    NativeVaultStorage.Keychain(copy: { query in
      let found = self.records.filter { self.matches($0, query) }
      guard let first = found.first else { return (errSecItemNotFound, nil) }
      if query[kSecReturnAttributes as String] as? Bool == true { return (errSecSuccess, found as NSArray) }
      return (errSecSuccess, first[kSecValueData as String] as AnyObject?)
    }, add: { record in
      if self.failWrite { return errSecNotAvailable }
      if self.records.contains(where: { item in
        [kSecClass as String, kSecAttrService as String, kSecAttrServer as String, kSecAttrAccount as String, kSecAttrAccessGroup as String].allSatisfy { key in
          if item[key] == nil && record[key] == nil { return true }
          guard let old = item[key], let new = record[key] else { return false }
          return NSDictionary(dictionary: [key: old]).isEqual(to: [key: new])
        }
      }) { return errSecDuplicateItem }
      self.records.append(record); return errSecSuccess
    }, update: { query, values in
      if self.failWrite { return errSecNotAvailable }
      guard let index = self.records.firstIndex(where: { self.matches($0, query) }) else { return errSecItemNotFound }
      self.records[index].merge(values) { _, new in new }; return errSecSuccess
    }, delete: { query in
      if self.failDelete { return errSecNotAvailable }
      let count = self.records.count
      self.records.removeAll { self.matches($0, query) }
      return count == self.records.count ? errSecItemNotFound : errSecSuccess
    })
  }
  func legacy(_ name: String, _ value: String) {
    records.append([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "app:no-auth",
      kSecAttrAccount as String: Data(name.utf8), kSecAttrGeneric as String: Data(name.utf8), kSecValueData as String: Data(value.utf8)])
  }
  func rawRead(_ name: String, service: String = "app:no-auth") -> OSStatus {
    operations.copy([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: Data(name.utf8), kSecAttrGeneric as String: Data(name.utf8), kSecReturnData as String: true]).0
  }
}

func exerciseNativeStorage() throws {
  func require(_ value: @autoclosure () throws -> Bool) throws {
    guard try value() else { throw NSError(domain: "VaultStorageRegression", code: 1) }
  }
  let name = "identity_privkey_" + String(repeating: "a", count: 64)
  let injected = "nip46_client_privkey_" + String(repeating: "b", count: 64)
  let backend = TestKeychain(); backend.legacy(name, "original-secret")
  let first = NativeVaultStorage(keychain: backend.operations)
  try first.migrateLegacy()
  try require(first.read(name) == "original-secret")
  try require(backend.rawRead(name) == errSecItemNotFound)
  try require(backend.rawRead(name, service: "chat.psstpsst.vault.v1") == errSecItemNotFound)
  try require(backend.rawRead("vault:" + name, service: "chat.psstpsst.vault.v1") == errSecItemNotFound)
  backend.legacy(name, "replacement"); backend.legacy(injected, "attacker-client")
  let restarted = NativeVaultStorage(keychain: backend.operations)
  try restarted.migrateLegacy()
  try require(restarted.read(name) == "original-secret")
  try require(restarted.read(injected) == nil)
  try require(backend.rawRead(injected) == errSecItemNotFound)

  let failure = TestKeychain(); failure.legacy(name, "recoverable")
  failure.failWrite = true
  let retry = NativeVaultStorage(keychain: failure.operations)
  var failed = false
  do { try retry.migrateLegacy() } catch { failed = true }
  try require(failed)
  try require(failure.rawRead(name) == errSecSuccess)
  failure.failWrite = false; failure.failDelete = true
  failed = false
  do { try retry.migrateLegacy() } catch { failed = true }
  try require(failed)
  try require(failure.rawRead(name) == errSecSuccess)
  failure.failDelete = false
  try retry.migrateLegacy()
  try require(retry.read(name) == "recoverable")
  try require(failure.rawRead(name) == errSecItemNotFound)
  // An extension may launch before the app after an upgrade, but cannot read the app's private legacy group.
  let early = TestKeychain(); early.legacy(name, "private-app-secret")
  let notification = NativeVaultStorage(keychain: early.operations, isExtension: true)
  try notification.migrateLegacy()
  try require(early.rawRead(name) == errSecSuccess)
  try require(notification.read("__legacy_migration_v1") == nil)
  try require(notification.read("__wallet_migration_v1") == nil)
  let app = NativeVaultStorage(keychain: early.operations)
  try app.migrateLegacy()
  try require(app.read(name) == "private-app-secret")

  // Adding wallet migration must not reopen a completed signer migration.
  let upgrade = TestKeychain()
  let previous = NativeVaultStorage(keychain: upgrade.operations)
  try previous.write("__legacy_migration_v1", "complete")
  upgrade.legacy(injected, "attacker-client")
  let walletName = "psstpsst.nwc." + String(repeating: "a", count: 16) + ".legacy_wallet"
  upgrade.legacy(walletName, "existing-wallet-secret")
  let upgraded = NativeVaultStorage(keychain: upgrade.operations)
  try upgraded.migrateLegacy()
  try require(upgraded.read(injected) == nil)
  try require(upgraded.read(walletName) == "existing-wallet-secret")
  try require(upgrade.rawRead(walletName) == errSecItemNotFound)

  // Existing all-shared records move to explicit private or messaging groups.
  let scoped = TestKeychain()
  let messaging = "encryption_keys_" + String(repeating: "c", count: 64)
  let wallet = "wallet_credential_" + String(repeating: "a", count: 64) + "_wallet"
  for (key, value) in [(name, "identity"), (wallet, "wallet"), (messaging, "messages")] {
    scoped.records.append([kSecClass as String: kSecClassInternetPassword, kSecAttrServer as String: "chat.psstpsst.vault.v1",
      kSecAttrAccount as String: "vault:" + key, kSecAttrAccessGroup as String: "team.notifications", kSecValueData as String: Data(value.utf8)])
  }
  let scopedApp = NativeVaultStorage(keychain: scoped.operations, privateGroup: "team.app", sharedGroup: "team.messages", legacyGroup: "team.notifications")
  scoped.failWrite = true
  var scopeFailed = false
  do { try scopedApp.migrateLegacy() } catch { scopeFailed = true }
  try require(scopeFailed)
  try require(scoped.records.filter { $0[kSecAttrServer as String] as? String == "chat.psstpsst.vault.v1" }.count == 3)
  scoped.failWrite = false
  try scopedApp.migrateLegacy()
  try require(scopedApp.read(name) == "identity")
  try require(scopedApp.read(wallet) == "wallet")
  try require(!scoped.records.contains { $0[kSecAttrServer as String] as? String == "chat.psstpsst.vault.v1" })
  let scopedExtension = NativeVaultStorage(keychain: scoped.operations, isExtension: true, privateGroup: "team.extension", sharedGroup: "team.messages")
  try scopedExtension.migrateLegacy()
  try require(scopedExtension.read(name) == nil)
  try require(scopedExtension.read(wallet) == nil)
  try require(scopedExtension.read(messaging) == "messages")
  let exposed = scoped.records.filter { $0[kSecAttrAccessGroup as String] as? String == "team.messages" }
  try require(exposed.count == 1)
  try require(exposed.first?[kSecAttrAccount as String] as? String == "vault:" + messaging)

  // The previous native format is moved to a class that raw SecureStore can never query.
  let format = TestKeychain()
  format.records.append([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "chat.psstpsst.vault.v1",
    kSecAttrAccount as String: "vault:" + name, kSecValueData as String: Data("native-secret".utf8)])
  let current = NativeVaultStorage(keychain: format.operations)
  try current.migrateLegacy()
  try require(current.read(name) == "native-secret")
  try require(format.records.contains { ($0[kSecClass as String] as? String) == (kSecClassInternetPassword as String) && $0[kSecAttrAccount as String] as? String == "vault:" + name })
  try require(!format.records.contains { ($0[kSecClass as String] as? String) == (kSecClassGenericPassword as String) })
  format.records.append([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "chat.psstpsst.vault.v1",
    kSecAttrAccount as String: "vault:" + injected, kSecValueData as String: Data("attacker-client".utf8)])
  let afterRestart = NativeVaultStorage(keychain: format.operations)
  try afterRestart.migrateLegacy()
  try require(afterRestart.read(injected) == nil)

}

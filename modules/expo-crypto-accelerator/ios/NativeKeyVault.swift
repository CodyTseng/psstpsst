import CommonCrypto
import CryptoKit
import Foundation
import Security

/** Native-only Keychain records cannot match Expo SecureStore queries, even with custom options. */
public final class NativeVaultStorage {
  struct Keychain {
    var copy: ([String: Any]) -> (OSStatus, CFTypeRef?)
    var add: ([String: Any]) -> OSStatus
    var update: ([String: Any], [String: Any]) -> OSStatus
    var delete: ([String: Any]) -> OSStatus
    static let system = Keychain(copy: { query in
      var result: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &result)
      return (status, result)
    }, add: { SecItemAdd($0 as CFDictionary, nil) },
      update: { SecItemUpdate($0 as CFDictionary, $1 as CFDictionary) },
      delete: { SecItemDelete($0 as CFDictionary) })
  }
  private let keychain: Keychain
  private let extensionOverride: Bool?
  private let privateGroupOverride: String?
  private let sharedGroupOverride: String?
  private let legacyGroupOverride: String?
  private var isNotificationExtension: Bool { extensionOverride ?? (Bundle.main.object(forInfoDictionaryKey: "NSExtension") != nil) }
  public convenience init() { self.init(keychain: .system) }
  init(keychain: Keychain, isExtension: Bool? = nil, privateGroup: String? = nil, sharedGroup: String? = nil, legacyGroup: String? = nil) {
    self.keychain = keychain; self.extensionOverride = isExtension
    self.privateGroupOverride = privateGroup; self.sharedGroupOverride = sharedGroup; self.legacyGroupOverride = legacyGroup
  }
  private var privateGroup: String? {
    if let explicit = privateGroupOverride ?? Bundle.main.object(forInfoDictionaryKey: "PsstPsstPrivateKeychainGroup") as? String { return explicit }
    // Older generated projects already declare the app group first in entitlements.
    for suffix in [".notifications", ".messaging"] {
      if let group = sharedGroup, group.hasSuffix(suffix) { return String(group.dropLast(suffix.count)) }
    }
    return nil
  }
  private var sharedGroup: String? { sharedGroupOverride ?? Bundle.main.object(forInfoDictionaryKey: "PsstPsstKeychainGroup") as? String }
  private var legacyGroup: String? { legacyGroupOverride ?? Bundle.main.object(forInfoDictionaryKey: "PsstPsstLegacyKeychainGroup") as? String ?? sharedGroup }
  private func sharedKey(_ key: String) -> Bool { key.range(of: "^encryption_keys_[0-9a-fA-F]{64}$", options: .regularExpression) != nil }
  private func service(_ key: String) -> String { sharedKey(key) ? "chat.psstpsst.vault.messages.v1" : "chat.psstpsst.vault.private.v1" }
  private func allowed(_ key: String) -> Bool { (!isNotificationExtension || sharedKey(key)) && (sharedGroup == nil || sharedKey(key) || privateGroup != nil) }
  private func fail() -> Error { NSError(domain: "PsstVaultStorage", code: 1) }
  private func query(_ key: String, service: String, shared: Bool, legacy: Bool = false) -> [String: Any] {
    var result: [String: Any] = [kSecClass as String: legacy ? kSecClassGenericPassword : kSecClassInternetPassword,
      (legacy ? kSecAttrService : kSecAttrServer) as String: service, kSecAttrAccount as String: "vault:" + key]
    if legacy {
      let encoded = Data(key.utf8)
      result[kSecAttrAccount as String] = encoded
      result[kSecAttrGeneric as String] = encoded
    }
    let historical = legacy || service == "chat.psstpsst.vault.v1"
    if let group = shared ? (historical ? legacyGroup : sharedGroup) : privateGroup { result[kSecAttrAccessGroup as String] = group }
    return result
  }
  private var shared: Bool { sharedGroup != nil }
  private var legacyLocations: [(String, Bool)] {
    (shared ? [("psstpsst.notifications:no-auth", true)] : []) + (isNotificationExtension ? [] : [("app:no-auth", false), ("app", false)])
  }
  private func deleteLegacy(_ key: String) throws {
    if isNotificationExtension { return }
    for location in legacyLocations {
      let status = keychain.delete(query(key, service: location.0, shared: location.1, legacy: true))
      guard status == errSecSuccess || status == errSecItemNotFound else { throw fail() }
    }
  }
  private func migratePreviousNativeFormat() throws {
    let completed = try read("__native_storage_v2") != nil
    var search: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "chat.psstpsst.vault.v1",
      kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitAll]
    if let group = legacyGroup { search[kSecAttrAccessGroup as String] = group }
    let (status, result) = keychain.copy(search)
    if status != errSecItemNotFound {
      guard status == errSecSuccess, let records = result as? [[String: Any]] else { throw fail() }
      for record in records {
        guard let account = record[kSecAttrAccount as String] as? String, account.hasPrefix("vault:") else { continue }
        let name = String(account.dropFirst(6))
        if !allowed(name) { continue }
        var old: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "chat.psstpsst.vault.v1", kSecAttrAccount as String: account]
        if let group = search[kSecAttrAccessGroup as String] { old[kSecAttrAccessGroup as String] = group }
        if !completed, try read(name) == nil {
          var dataQuery = old; dataQuery[kSecReturnData as String] = true
          let (readStatus, value) = keychain.copy(dataQuery)
          guard readStatus == errSecSuccess, let bytes = value as? Data, let text = String(data: bytes, encoding: .utf8) else { throw fail() }
          try write(name, text)
        }
        let deleted = keychain.delete(old)
        guard deleted == errSecSuccess || deleted == errSecItemNotFound else { throw fail() }
      }
    }
    if !completed && !isNotificationExtension { try write("__native_storage_v2", "complete") }
  }
  /** Split the previous all-shared vault before examining its migration markers. */
  private func migrateUnscopedRecords() throws {
    var search: [String: Any] = [kSecClass as String: kSecClassInternetPassword,
      kSecAttrServer as String: "chat.psstpsst.vault.v1", kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitAll]
    if let group = legacyGroup { search[kSecAttrAccessGroup as String] = group }
    let (status, result) = keychain.copy(search)
    if status == errSecItemNotFound { return }
    guard status == errSecSuccess, let records = result as? [[String: Any]] else { throw fail() }
    for record in records {
      guard let account = record[kSecAttrAccount as String] as? String, account.hasPrefix("vault:") else { continue }
      let name = String(account.dropFirst(6))
      if !allowed(name) { continue }
      let old = query(name, service: "chat.psstpsst.vault.v1", shared: shared)
      if try read(name) == nil {
        var dataQuery = old; dataQuery[kSecReturnData as String] = true
        let (readStatus, value) = keychain.copy(dataQuery)
        guard readStatus == errSecSuccess, let data = value as? Data, let text = String(data: data, encoding: .utf8) else { throw fail() }
        try write(name, text)
      }
      let deleted = keychain.delete(old)
      guard deleted == errSecSuccess || deleted == errSecItemNotFound else { throw fail() }
    }
  }
  private static let migrationLock = NSLock()
  private var migrated = false
  /** Enumerate owned records so inactive accounts do not retain a general-storage copy. */
  public func migrateLegacy() throws {
    Self.migrationLock.lock(); defer { Self.migrationLock.unlock() }
    if migrated { return }
    // The app owns upgrades. An extension launched before it uses the generic
    // notification fallback until the app has populated the shared message store.
    if isNotificationExtension { migrated = true; return }
    try migrateUnscopedRecords()
    try migratePreviousNativeFormat()
    let completed = try read("__legacy_migration_v1") != nil
    let walletsCompleted = try read("__wallet_migration_v1") != nil
    for location in legacyLocations {
      var search: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: location.0,
        kSecReturnAttributes as String: true, kSecMatchLimit as String: kSecMatchLimitAll]
      if let group = location.1 ? legacyGroup : privateGroup { search[kSecAttrAccessGroup as String] = group }
      let (status, result) = keychain.copy(search)
      if status == errSecItemNotFound { continue }
      guard status == errSecSuccess, let records = result as? [[String: Any]] else { throw fail() }
      for record in records {
        guard let data = record[kSecAttrAccount as String] as? Data, let name = String(data: data, encoding: .utf8),
          (name.range(of: "^(identity_privkey_|encryption_keys_|nip46_client_privkey_|nip46_bunker_secret_|nip46_bunker_binding_|proximity_identity_privkey_|proximity_identity_noise_privkey_)[0-9a-fA-F]{64}$", options: .regularExpression) != nil || name.range(of: "^psstpsst\\.(nwc\\.[0-9a-fA-F]{16}\\.[A-Za-z0-9_-]{1,256}|wallet\\.pin\\.[0-9a-fA-F]{64})$", options: .regularExpression) != nil) else { continue }
        if !allowed(name) { continue }
        let isWallet = name.hasPrefix("psstpsst.")
        if isWallet ? walletsCompleted : completed { try deleteLegacy(name) } else { _ = try read(name, migrating: true) }
      }
    }
    // Extensions cannot see the app's private legacy group and must never close its migration window.
    if !isNotificationExtension {
      if !completed { try write("__legacy_migration_v1", "complete") }
      if !walletsCompleted { try write("__wallet_migration_v1", "complete") }
    }
    migrated = true
  }
  public func read(_ key: String, migrating: Bool = false) throws -> String? {
    guard allowed(key) else { return nil }
    let locations = [(service(key), sharedKey(key) && shared, false)] + (migrating ? legacyLocations.map { ($0.0, $0.1, true) } : [])
    for location in locations {
      var search = query(key, service: location.0, shared: location.1, legacy: location.2)
      search[kSecReturnData as String] = true
      let (status, result) = keychain.copy(search)
      if status == errSecItemNotFound { continue }
      guard status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) else { throw fail() }
      if location.2 { try write(key, value) } else { try deleteLegacy(key) }
      return value
    }
    return nil
  }
  public func write(_ key: String, _ value: String) throws {
    guard allowed(key) else { throw fail() }
    let search = query(key, service: service(key), shared: sharedKey(key) && shared)
    var insert = search
    insert[kSecValueData as String] = Data(value.utf8)
    insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = keychain.add(insert)
    if status == errSecDuplicateItem {
      guard keychain.update(search, [kSecValueData as String: Data(value.utf8)]) == errSecSuccess else { throw fail() }
    } else if status != errSecSuccess { throw fail() }
    try deleteLegacy(key)
  }
  public func remove(_ key: String) throws {
    guard allowed(key) else { throw fail() }
    try deleteLegacy(key)
    let status = keychain.delete(query(key, service: service(key), shared: sharedKey(key) && shared))
    guard status == errSecSuccess || status == errSecItemNotFound else { throw fail() }
  }
}

/** All callers serialize work on their vault queue. No method returns stored secrets. */
final class NativeKeyVault {
  private final class Pairing {
    var secretKey: String
    let pubkey: String
    var peer: String?
    let secret: String?
    let relays: [String]
    var connected = false
    var account: String?
    var pending: (id: String, operation: String)?
    var committed: [String: Any]?
    init(secretKey: String, pubkey: String, peer: String?, secret: String?, relays: [String]) {
      self.secretKey = secretKey; self.pubkey = pubkey; self.peer = peer; self.secret = secret; self.relays = relays
    }
  }
  private var pairings: [String: Pairing] = [:]

  private func verifyPairingEvent(_ event: [String: Any], expectedKind: Int = 24133) throws -> Bool {
    let pub = try string(event["pubkey"]); let signature = try string(event["sig"])
    guard signature.count == 128, let kind = event["kind"] as? Int, kind == expectedKind,
      let created = event["created_at"] as? Int, created >= 0, let tags = event["tags"] as? [[String]],
      let content = event["content"] as? String else { return false }
    let hash = Data(SHA256.hash(data: Data(try json([0, pub, created, kind, tags, content]).utf8)))
    guard encoded(hash) == event["id"] as? String else { return false }
    let sig = try hex(String(signature.prefix(64))) + hex(String(signature.suffix(64)))
    let publicBytes = try hex(pub)
    return sig.withUnsafeBytes { sig in hash.withUnsafeBytes { hash in publicBytes.withUnsafeBytes { pub in
      ExpoCryptoAcceleratorVerifySchnorr(sig.bindMemory(to: UInt8.self).baseAddress!, hash.bindMemory(to: UInt8.self).baseAddress!, pub.bindMemory(to: UInt8.self).baseAddress!)
    } } }
  }

  private func pairing(_ c: [String: Any]) throws -> Any {
    let method = try string(c["method"])
    if method == "beginBunkerPairing" {
      guard pairings.count < 8, let relays = c["relays"] as? [String], !relays.isEmpty else { throw fail() }
      let peer = c["peer"] as? String
      if let peer { _ = try hex(peer) }
      let key = try encoded(random(32)); let pub = try publicKey(key)
      let secret = peer == nil ? try encoded(random(32)) : c["secret"] as? String
      let session = try encoded(random(32))
      pairings[session] = Pairing(secretKey: key, pubkey: pub, peer: peer, secret: secret, relays: relays)
      var uri: Any = NSNull()
      if peer == nil {
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        let params = relays.map { ("relay", $0) } + [("secret", secret!), ("name", "PsstPsst")]
        uri = "nostrconnect://" + pub + "?" + params.map { $0.0 + "=" + $0.1.addingPercentEncoding(withAllowedCharacters: allowed)! }.joined(separator: "&")
      }
      return ["session": session, "clientPubkey": pub, "uri": uri]
    }
    let session = try string(c["session"])
    guard let pair = pairings[session] else { throw fail() }
    if method == "cancelBunkerPairing" { pair.secretKey = ""; pairings.removeValue(forKey: session); publicCache.removeAll(); return NSNull() }
    if method == "commitBunkerPairing" {
      if let committed = pair.committed { return committed }
      guard pair.connected, let account = pair.account, let peer = pair.peer else { throw fail() }
      let existing = try read("nip46_client_privkey_" + account)
      if existing == nil {
        // Keep the key last: incomplete writes cannot reuse a previous credential.
        try remove("nip46_bunker_secret_" + account); try remove("nip46_bunker_binding_" + account)
        if let secret = pair.secret { try write("nip46_bunker_secret_" + account, secret) }
        try write("nip46_bunker_binding_" + account, peer)
        try write("nip46_client_privkey_" + account, pair.secretKey)
      }
      let result: [String: Any] = ["pubkey": account, "pointer": ["pubkey": peer, "relays": pair.relays, "secret": NSNull()], "existing": existing != nil]
      pair.committed = result; pair.secretKey = ""; publicCache.removeAll(); invalidate(); return result
    }
    guard pair.committed == nil else { throw fail() }
    if method == "bunkerPairingRequest" {
      let operation = try string(c["operation"])
      guard let peer = pair.peer, operation == "connect" || (operation == "get_public_key" && pair.connected) else { throw fail() }
      let id = try encoded(random(32)); pair.pending = (id, operation)
      let params = operation == "connect" ? [peer, pair.secret ?? ""] : []
      let content = try crypt(pair.secretKey, peer, json(["id": id, "method": operation, "params": params]), "nip44", "encrypt", cache: false)
      return try sign(pair.secretKey, ["kind": 24133, "created_at": Int(Date().timeIntervalSince1970), "tags": [["p", peer]], "content": content])
    }
    if method == "bunkerPairingReceive" {
      do {
        guard let event = c["event"] as? [String: Any], try verifyPairingEvent(event),
          let tags = event["tags"] as? [[String]], tags.contains(where: { $0.count >= 2 && $0[0] == "p" && $0[1] == pair.pubkey }),
          let peer = event["pubkey"] as? String, pair.peer == nil || peer == pair.peer else { return ["type": "ignored"] }
        let text = try crypt(pair.secretKey, peer, string(event["content"]), "nip44", "decrypt", cache: false)
        guard let response = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any], response["method"] == nil, response["params"] == nil else { return ["type": "ignored"] }
        if pair.peer == nil {
          guard response["result"] as? String == pair.secret else { return ["type": "ignored"] }
          pair.peer = peer; return ["type": "peer", "peer": peer]
        }
        guard let pending = pair.pending, response["id"] as? String == pending.id else { return ["type": "ignored"] }
        if response["result"] as? String == "auth_url", let url = response["error"] as? String { return ["type": "auth", "url": url] }
        guard response["error"] == nil || response["error"] is NSNull, let result = response["result"] as? String else { return ["type": "rejected"] }
        pair.pending = nil
        if pending.operation == "connect" { pair.connected = true; return ["type": "connected"] }
        _ = try hex(result); pair.account = result; return ["type": "account", "pubkey": result]
      } catch { return ["type": "ignored"] }
    }
    throw fail()
  }

  private let revisionLock = NSLock()
  private var generation: UInt64 = 0
  var revision: UInt64 { revisionLock.lock(); defer { revisionLock.unlock() }; return generation }
  private func invalidate() { revisionLock.lock(); generation &+= 1; revisionLock.unlock() }
  func withRevision(_ expected: UInt64, action: () -> Void) -> Bool {
    revisionLock.lock(); defer { revisionLock.unlock() }
    guard generation == expected else { return false }; action(); return true
  }
  private let readOverride: ((String) throws -> String?)?
  private let writeOverride: ((String, String) throws -> Void)?
  private let removeOverride: ((String) throws -> Void)?
  init(read: ((String) throws -> String?)? = nil, write: ((String, String) throws -> Void)? = nil, remove: ((String) throws -> Void)? = nil) {
    self.readOverride = read; self.writeOverride = write; self.removeOverride = remove
  }
  private var resolvedKeys: [String: String] = [:]
  private var publicCache: [String: String] = [:]
  private var keyCache: [String: String] = [:]
  private var ephemeral: [String: (secret: String, purpose: String)] = [:]
  private var conversations: [String: Data] = [:]
  private var conversationOrder: [String] = []
  private func fail() -> NSError { NSError(domain: "PsstPsstKeyVault", code: 1, userInfo: [NSLocalizedDescriptionKey: "Key vault operation failed"]) }
  private func string(_ value: Any?) throws -> String { guard let value = value as? String else { throw fail() }; return value }
  private func hex(_ value: String) throws -> Data {
    guard value.count == 64 else { throw fail() }
    var result = Data(); var index = value.startIndex
    while index < value.endIndex {
      let next = value.index(index, offsetBy: 2)
      guard let byte = UInt8(value[index..<next], radix: 16) else { throw fail() }
      result.append(byte); index = next
    }
    return result
  }
  private func random(_ size: Int) throws -> Data {
    var data = Data(count: size)
    guard data.withUnsafeMutableBytes({ SecRandomCopyBytes(kSecRandomDefault, size, $0.baseAddress!) }) == errSecSuccess else { throw fail() }
    return data
  }
  private func encoded(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }
  private func publicKey(_ secret: String) throws -> String {
    if let value = publicCache[secret] { return value }
    var bytes = try hex(secret); defer { bytes.resetBytes(in: 0..<bytes.count) }
    var output = Data(count: 32)
    guard output.withUnsafeMutableBytes({ out in bytes.withUnsafeBytes { PsstVaultPublicKey($0.bindMemory(to: UInt8.self).baseAddress!, out.bindMemory(to: UInt8.self).baseAddress!) } }) else { throw fail() }
    let value = encoded(output); if publicCache.count >= 128 { publicCache.removeAll() }; publicCache[secret] = value; return value
  }
  private let storage = NativeVaultStorage()
  private func read(_ key: String) throws -> String? {
    if let cached = keyCache[key] { return cached }
    let value: String?
    if let readOverride { value = try readOverride(key) } else { value = try storage.read(key) }
    keyCache[key] = value
    return value
  }
  private func write(_ key: String, _ value: String) throws {
    resolvedKeys.removeAll(); keyCache.removeValue(forKey: key)
    if let writeOverride { try writeOverride(key, value) } else { try storage.write(key, value) }
  }
  private func remove(_ key: String) throws {
    resolvedKeys.removeAll(); keyCache.removeValue(forKey: key); publicCache.removeAll()
    if let removeOverride { try removeOverride(key) } else { try storage.remove(key) }
    conversations.removeAll(); conversationOrder.removeAll()
  }
  private func decodeNsec(_ input: String) throws -> String {
    guard input == input.lowercased() || input == input.uppercased() else { throw fail() }
    let input = input.lowercased()
    guard input.count == 63, input.hasPrefix("nsec1") else { throw fail() }
    let alphabet = Array("qpzry9x8gf2tvdw0s3jn54khce6mua7l")
    let words = try input.dropFirst(5).map { character -> UInt8 in
      guard let index = alphabet.firstIndex(of: character) else { throw fail() }; return UInt8(index)
    }
    let generators: [UInt32] = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
    var checksum: UInt32 = 1
    for value in [UInt8](arrayLiteral: 3, 3, 3, 3, 0, 14, 19, 5, 3) + words {
      let top = checksum >> 25; checksum = ((checksum & 0x1ffffff) << 5) ^ UInt32(value)
      for i in 0..<5 { if ((top >> i) & 1) != 0 { checksum ^= generators[i] } }
    }
    guard checksum == 1 else { throw fail() }
    var result = Data(); var accumulator = 0; var bits = 0
    defer { result.resetBytes(in: 0..<result.count) }
    for word in words.dropLast(6) {
      accumulator = ((accumulator << 5) | Int(word)) & 4095; bits += 5
      if bits >= 8 { bits -= 8; result.append(UInt8((accumulator >> bits) & 255)) }
    }
    guard result.count == 32, bits < 5, (accumulator & ((1 << bits) - 1)) == 0 else { throw fail() }
    return encoded(result)
  }
  private func noiseBinding(_ account: String, _ noise: String) throws -> String {
    let secret = try key(["account": account, "role": "proximity"])
    let publicBytes = try hex(publicKey(secret)); let noiseBytes = try hex(noise)
    let hash = Data(SHA256.hash(data: Data("PsstPsst Nearby Noise Binding/1".utf8) + publicBytes + noiseBytes))
    var bytes = try hex(secret); defer { bytes.resetBytes(in: 0..<bytes.count) }
    let auxiliary = try random(32); var signature = Data(count: 64)
    guard signature.withUnsafeMutableBytes({ output in bytes.withUnsafeBytes { sk in hash.withUnsafeBytes { digest in auxiliary.withUnsafeBytes { aux in
      PsstVaultSign(sk.bindMemory(to: UInt8.self).baseAddress!, digest.bindMemory(to: UInt8.self).baseAddress!, aux.bindMemory(to: UInt8.self).baseAddress!, output.bindMemory(to: UInt8.self).baseAddress!)
    } } } }) else { throw fail() }
    return encoded(signature)
  }
  private func json(_ value: Any) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .withoutEscapingSlashes])
    guard let result = String(data: data, encoding: .utf8) else { throw fail() }; return result
  }
  private func keys(_ account: String) throws -> [[String: Any]] {
    guard let raw = try read("encryption_keys_" + account) else { return [] }
    guard let array = try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [Any] else { throw fail() }
    let now = Int(Date().timeIntervalSince1970)
    let result: [[String: Any]] = try array.enumerated().map { index, item in
      if let legacy = item as? String { _ = try publicKey(legacy); return ["privkey": legacy.lowercased(), "createdAt": index == 0 ? now : NSNull()] }
      guard let item = item as? [String: Any] else { throw fail() }
      let secret = try string(item["privkey"]); _ = try publicKey(secret)
      let created = (item["createdAt"] as? Int).flatMap { $0 > 0 ? $0 : nil }
      let timestamp: Any = created.map { $0 as Any } ?? (index == 0 ? now as Any : NSNull())
      return ["privkey": secret.lowercased(), "createdAt": timestamp]
    }
    let normalized = try json(result)
    if normalized != raw { try write("encryption_keys_" + account, normalized) }
    return result
  }
  private func metadata(_ account: String, _ stored: [String: Any]) throws -> [String: Any] {
    let pub = try publicKey(string(stored["privkey"]))
    return ["pubkey": pub, "createdAt": stored["createdAt"] as? Int ?? 0,
      "key": ["account": account, "role": "messaging", "pubkey": pub]]
  }

  private func decryptMessaging(_ account: String, _ event: [String: Any]) throws -> [String: Any] {
    let records = try keys(account)
    guard (try? verifyPairingEvent(event, expectedKind: 1059)) == true else { return ["status": "failed"] }
    for record in records {
      do {
        let secret = try string(record["privkey"])
        let outer = try crypt(secret, string(event["pubkey"]), string(event["content"]), "nip44", "decrypt", cache: false)
        guard let seal = try JSONSerialization.jsonObject(with: Data(outer.utf8)) as? [String: Any],
          try verifyPairingEvent(seal, expectedKind: 13), let tags = seal["tags"] as? [[String]] else { continue }
        guard let tag = tags.first(where: { $0.first == "n" }) else {
          return ["status": "unsupported", "reason": "missing-encryption-key-tag"]
        }
        guard tag.count > 1 else { continue }
        _ = try hex(tag[1])
        let rumor = try crypt(secret, tag[1], string(seal["content"]), "nip44", "decrypt")
        return ["status": "decrypted", "seal": seal, "rumorJson": rumor, "senderEncryptionPubkey": tag[1]]
      } catch { continue }
    }
    return ["status": "failed"]
  }
  private func add(_ account: String, _ secret: String, _ created: Int) throws -> [String: Any] {
    _ = try publicKey(secret)
    let old = try keys(account)
    let existing = old.first { ($0["privkey"] as? String) == secret.lowercased() }
    let record: [String: Any] = ["privkey": secret.lowercased(), "createdAt": existing?["createdAt"] as? Int ?? created]
    let result = Array(([record] + old.filter { ($0["privkey"] as? String) != secret.lowercased() }).prefix(10))
    try write("encryption_keys_" + account, json(result))
    conversations.removeAll(); conversationOrder.removeAll()
    return try metadata(account, record)
  }
  private func key(_ ref: [String: Any]) throws -> String {
    let account = try string(ref["account"]); _ = try hex(account)
    let role = try string(ref["role"])
    let id = account + ":" + role + ":" + (ref["pubkey"] as? String ?? "")
    if let cached = resolvedKeys[id] { return cached }
    let secret: String
    switch role {
    case "ephemeral":
      guard let entry = ephemeral[account] else { throw fail() }; return entry.secret
    case "proximity":
      guard let value = try read("proximity_identity_privkey_" + account) else { throw fail() }; secret = value
    case "identity":
      guard let value = try read("identity_privkey_" + account), try publicKey(value) == account else { throw fail() }; secret = value
    case "nip46-client":
      guard let value = try read("nip46_client_privkey_" + account) else { throw fail() }; secret = value
    case "messaging":
      let pub = try string(ref["pubkey"])
      guard let stored = try keys(account).first(where: { try publicKey(string($0["privkey"])) == pub }) else { throw fail() }
      secret = try string(stored["privkey"])
    default: throw fail()
    }
    if role == "proximity", let expected = ref["pubkey"] as? String, try publicKey(secret) != expected { throw fail() }
    resolvedKeys[id] = secret
    return secret
  }
  private func hmac(_ key: Data, _ data: Data) -> Data { Data(HMAC<SHA256>.authenticationCode(for: data, using: SymmetricKey(data: key))) }
  private func shared(_ secret: String, _ peer: String) throws -> Data {
    var bytes = try hex(secret); let pub = try hex(peer); var out = Data(count: 32)
    defer { bytes.resetBytes(in: 0..<bytes.count) }
    guard out.withUnsafeMutableBytes({ output in bytes.withUnsafeBytes { sk in pub.withUnsafeBytes { pk in
      ExpoCryptoAcceleratorDeriveSharedX(sk.bindMemory(to: UInt8.self).baseAddress!, pk.bindMemory(to: UInt8.self).baseAddress!, output.bindMemory(to: UInt8.self).baseAddress!)
    } } }) else { throw fail() }; return out
  }
  private func conversation(_ secret: String, _ peer: String, cache: Bool) throws -> Data {
    let id = try publicKey(secret) + ":" + peer
    if cache, let value = conversations[id] { return value }
    let value = hmac(Data("nip44-v2".utf8), try shared(secret, peer))
    if cache {
      if conversations.count >= 256 { conversations.removeValue(forKey: conversationOrder.removeFirst()) }
      conversationOrder.append(id); conversations[id] = value
    }
    return value
  }
  private func expanded(_ key: Data, _ nonce: Data) -> Data {
    var result = Data(); var previous = Data()
    for counter: UInt8 in 1...3 { previous = hmac(key, previous + nonce + Data([counter])); result += previous }
    return result.prefix(76)
  }
  private func chacha(_ bytes: Data, _ keys: Data) -> Data {
    let key = Data(keys.prefix(32)); let nonce = Data(keys[32..<44]); var out = Data(count: bytes.count)
    out.withUnsafeMutableBytes { output in bytes.withUnsafeBytes { input in key.withUnsafeBytes { k in nonce.withUnsafeBytes { n in
      PsstVaultChaCha(k.bindMemory(to: UInt8.self).baseAddress!, n.bindMemory(to: UInt8.self).baseAddress!, input.bindMemory(to: UInt8.self).baseAddress!, UInt32(bytes.count), output.bindMemory(to: UInt8.self).baseAddress!)
    } } } }
    return out
  }
  private func paddedLength(_ length: Int) -> Int {
    if length <= 32 { return 32 }; var next = 1; while next < length { next *= 2 }
    let chunk = next <= 256 ? 32 : next / 8; return chunk * ((length - 1) / chunk + 1)
  }
  private func crypt(_ secret: String, _ peer: String, _ text: String, _ algorithm: String, _ operation: String, cache: Bool = true) throws -> String {
    guard operation == "encrypt" || operation == "decrypt" else { throw fail() }
    if algorithm == "nip04" {
      var key = try shared(secret, peer); defer { key.resetBytes(in: 0..<key.count) }
      let input: Data; let iv: Data
      if operation == "encrypt" { input = Data(text.utf8); iv = try random(16) }
      else {
        let parts = text.components(separatedBy: "?iv=")
        guard parts.count == 2, let data = Data(base64Encoded: parts[0]), let vector = Data(base64Encoded: parts[1]), vector.count == 16 else { throw fail() }
        input = data; iv = vector
      }
      let capacity = input.count + 16; var output = Data(count: capacity); var size = 0
      let status = output.withUnsafeMutableBytes { out in input.withUnsafeBytes { data in key.withUnsafeBytes { k in iv.withUnsafeBytes { vector in
        CCCrypt(operation == "encrypt" ? CCOperation(kCCEncrypt) : CCOperation(kCCDecrypt), CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionPKCS7Padding), k.baseAddress, 32, vector.baseAddress, data.baseAddress, input.count, out.baseAddress, capacity, &size)
      } } } }
      guard status == kCCSuccess else { throw fail() }; output.count = size
      if operation == "encrypt" { return output.base64EncodedString() + "?iv=" + iv.base64EncodedString() }
      guard let result = String(data: output, encoding: .utf8) else { throw fail() }; return result
    }
    guard algorithm == "nip44" else { throw fail() }
    let conversation = try conversation(secret, peer, cache: cache)
    if operation == "encrypt" {
      let input = Data(text.utf8); guard !input.isEmpty, input.count <= 16 * 1024 * 1024 else { throw fail() }
      let prefix = input.count >= 65536 ? 6 : 2
      var padded = Data(count: prefix + paddedLength(input.count))
      if prefix == 2 { padded[0] = UInt8(input.count >> 8); padded[1] = UInt8(input.count & 255) }
      else { for i in 0..<4 { padded[2+i] = UInt8((input.count >> (24-i*8)) & 255) } }
      padded.replaceSubrange(prefix..<prefix+input.count, with: input)
      let nonce = try random(32); let keys = expanded(conversation, nonce); let ciphertext = chacha(padded, keys)
      return (Data([2]) + nonce + ciphertext + hmac(Data(keys[44..<76]), nonce + ciphertext)).base64EncodedString()
    }
    guard text.count <= 24 * 1024 * 1024, let payload = Data(base64Encoded: text), payload.count >= 99, payload[0] == 2 else { throw fail() }
    let nonce = Data(payload[1..<33]); let ciphertext = Data(payload[33..<payload.count-32]); let keys = expanded(conversation, nonce)
    let expected = hmac(Data(keys[44..<76]), nonce + ciphertext)
    var difference: UInt8 = 0
    for i in 0..<32 { difference |= expected[i] ^ payload[payload.count-32+i] }
    guard difference == 0 else { throw fail() }
    let padded = chacha(ciphertext, keys); guard padded.count >= 2 else { throw fail() }
    var length = Int(padded[0]) * 256 + Int(padded[1]); var prefix = 2
    if length == 0 {
      guard padded.count >= 6 else { throw fail() }; prefix = 6; length = 0
      for i in 2..<6 { length = length * 256 + Int(padded[i]) }
      guard length >= 65536 else { throw fail() }
    }
    guard length > 0, length <= 16 * 1024 * 1024, padded.count == prefix + paddedLength(length), prefix + length <= padded.count,
      let result = String(data: padded[prefix..<prefix+length], encoding: .utf8) else { throw fail() }
    return result
  }
  private func sign(_ secret: String, _ template: [String: Any]) throws -> [String: Any] {
    let pub = try publicKey(secret)
    guard let kind = template["kind"] as? Int, kind >= 0, let created = template["created_at"] as? Int, created >= 0,
      let tags = template["tags"] as? [[String]], let content = template["content"] as? String else { throw fail() }
    let canonical = try json([0, pub, created, kind, tags, content])
    let hash = Data(SHA256.hash(data: Data(canonical.utf8)))
    var bytes = try hex(secret); defer { bytes.resetBytes(in: 0..<bytes.count) }
    let auxiliary = try random(32); var signature = Data(count: 64)
    guard signature.withUnsafeMutableBytes({ output in bytes.withUnsafeBytes { sk in hash.withUnsafeBytes { digest in auxiliary.withUnsafeBytes { aux in
      PsstVaultSign(sk.bindMemory(to: UInt8.self).baseAddress!, digest.bindMemory(to: UInt8.self).baseAddress!, aux.bindMemory(to: UInt8.self).baseAddress!, output.bindMemory(to: UInt8.self).baseAddress!)
    } } } }) else { throw fail() }
    return ["id": encoded(hash), "pubkey": pub, "created_at": created, "kind": kind, "tags": tags, "content": content, "sig": encoded(signature)]
  }
  func clearMemory() {
    invalidate()
    for pair in pairings.values { pair.secretKey = "" }; pairings.removeAll()
    for id in Array(conversations.keys) { conversations[id]?.resetBytes(in: 0..<32) }
    conversations.removeAll(); conversationOrder.removeAll(); keyCache.removeAll(); resolvedKeys.removeAll(); publicCache.removeAll(); ephemeral.removeAll()
  }

  func isBunkerBound(_ account: String, _ peer: String) throws -> Bool {
    _ = try hex(account); _ = try hex(peer)
    return try read("nip46_bunker_binding_" + account) == peer
  }
  func bindBunker(_ account: String, _ peer: String) throws {
    invalidate()
    _ = try hex(account); _ = try hex(peer)
    if let old = try read("nip46_bunker_binding_" + account), old != peer { throw fail() }
    try write("nip46_bunker_binding_" + account, peer)
  }

  /** The notification runtime cannot export keys or request arbitrary identity signatures. */
  func executeNotification(_ serialized: String) throws -> String {
    guard let c = try JSONSerialization.jsonObject(with: Data(serialized.utf8)) as? [String: Any] else { throw fail() }
    func authentication(_ value: Any?) throws {
      guard let template = value as? [String: Any], template["kind"] as? Int == 27235,
        template["content"] as? String == "", let tags = template["tags"] as? [[String]], tags.count == 2,
        tags.contains(["method", "GET"]), let url = tags.first(where: { $0.first == "u" })?.last,
        url.range(of: "^https://relay\\.psstpsst\\.chat/v1/events/[0-9a-f]{64}$", options: .regularExpression) != nil else { throw fail() }
    }
    switch try string(c["method"]) {
    case "publicKey", "getCurrentMessagingKey", "hasMessagingKey", "decryptMessaging", "endSession": break
    case "crypto":
      guard c["operation"] as? String == "decrypt", c["algorithm"] as? String == "nip44" else { throw fail() }
    case "signEvent": try authentication(c["template"])
    case "bunkerRequest":
      let operation = try string(c["operation"])
      if operation == "sign_event" {
        guard let params = c["params"] as? [String], let first = params.first else { throw fail() }
        try authentication(JSONSerialization.jsonObject(with: Data(first.utf8)))
      } else if operation != "connect" && operation != "get_public_key" { throw fail() }
    default: throw fail()
    }
    return try execute(serialized)
  }
  func execute(_ serialized: String) throws -> String {
    guard let command = try JSONSerialization.jsonObject(with: Data(serialized.utf8)) as? [String: Any] else { throw fail() }
    return try json(run(command))
  }
  /** Only trusted native input calls this operation. */
  func importIdentity(_ nsec: String) throws -> String {
    if readOverride == nil { try storage.migrateLegacy() }
    invalidate()
    let secret = try decodeNsec(nsec); let pub = try publicKey(secret)
    try write("identity_privkey_" + pub, secret)
    return try json(["pubkey": pub])
  }
  private func run(_ c: [String: Any]) throws -> Any {
    if readOverride == nil { try storage.migrateLegacy() }
    let method = try string(c["method"])
    if method == "migrateStorage" {
      guard let accounts = c["accounts"] as? [String], let wallets = c["wallets"] as? [[String: Any]] else { throw fail() }
      invalidate()
      for account in accounts { _ = try hex(account); _ = try keys(account) }
      for bunker in c["bunkers"] as? [[String: String]] ?? [] {
        let account = try string(bunker["account"]); let peer = try string(bunker["peer"])
        if !(try isBunkerBound(account, peer)) { try bindBunker(account, peer) }
      }
      for var wallet in wallets {
        let account = try string(wallet["account"]); _ = try hex(account)
        let id = try string(wallet["walletId"])
        if try walletBound(account, id) { try remove("psstpsst.nwc." + String(account.prefix(16)) + "." + id); continue }
        if try read("psstpsst.nwc." + String(account.prefix(16)) + "." + id) == nil { continue }
        wallet["method"] = "walletBindLegacy"
        _ = try walletCommand(wallet, trusted: true)
      }
      return NSNull()
    }
    if method.hasPrefix("wallet") { return try walletCommand(c) }
    if ["removeProximity", "persistIdentity", "releaseEphemeral", "commitBunkerPairing", "migrateBunkerSecret", "removeIdentity", "removeBunker", "removeMessaging", "generateMessaging", "importTransfer", "endSession"].contains(method) { invalidate() }
    if ["beginBunkerPairing", "bunkerPairingRequest", "bunkerPairingReceive", "commitBunkerPairing", "cancelBunkerPairing"].contains(method) { return try pairing(c) }
    let account = c["account"] as? String ?? ""
    if !account.isEmpty { _ = try hex(account) }
    switch method {
    case "endSession":
      keyCache.removeAll(); resolvedKeys.removeAll(); publicCache.removeAll(); conversations.removeAll(); conversationOrder.removeAll(); return NSNull()
    case "ensureProximity":
      _ = try hex(account)
      let name = "proximity_identity_privkey_" + account
      let secret: String
      if let saved = try read(name) { secret = saved } else { secret = try encoded(random(32)); try write(name, secret) }
      return ["pubkey": try publicKey(secret), "key": ["account": account, "role": "proximity"]]
    case "removeProximity": try remove("proximity_identity_privkey_" + account); return NSNull()
    case "bindProximityNoise": return try noiseBinding(account, string(c["noisePubkey"]))
    case "generateEphemeral":
      guard ephemeral.count < 64 else { throw fail() }
      let purpose = try string(c["purpose"])
      guard purpose == "account" || purpose == "key-sync" else { throw fail() }
      let secret = try encoded(random(32)); let pub = try publicKey(secret)
      ephemeral[pub] = (secret, purpose)
      return ["pubkey": pub, "createdAt": Int(Date().timeIntervalSince1970), "key": ["account": pub, "role": "ephemeral"]]
    case "releaseEphemeral": ephemeral.removeValue(forKey: account); return NSNull()
    case "persistIdentity":
      guard let entry = ephemeral[account] else {
        guard let saved = try read("identity_privkey_" + account), try publicKey(saved) == account else { throw fail() }
        return NSNull()
      }
      guard entry.purpose == "account" else { throw fail() }
      try write("identity_privkey_" + account, entry.secret); ephemeral.removeValue(forKey: account); return NSNull()
    case "migrateBunkerSecret":
      let peer = try string(c["peer"]); _ = try hex(peer)
      if try read("nip46_bunker_secret_" + account) != nil { return NSNull() }
      if let existing = try read("nip46_bunker_binding_" + account), existing != peer { throw fail() }
      if let secret = c["secret"] as? String {
        try write("nip46_bunker_secret_" + account, secret); try write("nip46_bunker_binding_" + account, peer)
      }
      return NSNull()
    case "removeBunker":
      for prefix in ["nip46_client_privkey_", "nip46_bunker_secret_", "nip46_bunker_binding_"] { try remove(prefix + account) }
      return NSNull()
    case "removeIdentity", "removeMessaging":
      try remove((method == "removeIdentity" ? "identity_privkey_" : "encryption_keys_") + account); return NSNull()
    case "publicKey", "signEvent", "crypto":
      guard let ref = c["key"] as? [String: Any] else { throw fail() }; let secret = try key(ref)
      if method == "publicKey" { return try publicKey(secret) }
      if method == "signEvent" { guard ["identity", "proximity"].contains(ref["role"] as? String ?? ""), let template = c["template"] as? [String: Any] else { throw fail() }; return try sign(secret, template) }
      guard ref["role"] as? String != "ephemeral" else { throw fail() }
      let algorithm = try string(c["algorithm"]); let operation = try string(c["operation"])
      guard ref["role"] as? String != "messaging" || operation != "decrypt" else { throw fail() }
      let isClient = (ref["role"] as? String) == "nip46-client"
      guard !isClient || (algorithm == "nip44" && operation == "decrypt") else { throw fail() }
      let result = try crypt(secret, string(c["peer"]), string(c["text"]), algorithm, operation, cache: (c["cache"] as? Bool) != false)
      if isClient {
        guard let response = try JSONSerialization.jsonObject(with: Data(result.utf8)) as? [String: Any],
          response["method"] == nil, response["params"] == nil, response["id"] is String,
          response["result"] is String || response["error"] is String else { throw fail() }
      }
      return result
    case "decryptMessaging":
      guard let event = c["event"] as? [String: Any] else { return ["status": "failed"] }
      return try decryptMessaging(account, event)
    case "getCurrentMessagingKey":
      guard let current = try keys(account).first else { return NSNull() }
      return try metadata(account, current)
    case "hasMessagingKey":
      guard let requested = c["pubkey"] as? String,
        requested.range(of: "^[0-9a-fA-F]{64}$", options: .regularExpression) != nil else { return false }
      return try keys(account).contains { try publicKey(string($0["privkey"])) == requested.lowercased() }
    case "generateMessaging": return try add(account, encoded(random(32)), Int(Date().timeIntervalSince1970))
    case "exportTransfer":
      let records = try keys(account); let requested = c["pubkey"] as? String
      let selected = try records.first { record in
        if requested == nil { return true }; return try publicKey(string(record["privkey"])) == requested
      }
      guard let selected else { throw fail() }; let ephemeral = try encoded(random(32))
      return ["senderPubkey": try publicKey(ephemeral), "content": try crypt(ephemeral, string(c["recipient"]), string(selected["privkey"]), "nip44", "encrypt", cache: false)]
    case "importTransfer":
      guard let client = c["client"] as? [String: Any], client["role"] as? String == "ephemeral",
        let clientAccount = client["account"] as? String, ephemeral[clientAccount]?.purpose == "key-sync" else { throw fail() }
      do {
        let secret = try crypt(key(c["client"] as? [String: Any] ?? [:]), string(c["sender"]), string(c["ciphertext"]), "nip44", "decrypt", cache: false)
        let pub = try publicKey(secret)
        if let expected = c["expectedPubkey"] as? String, pub != expected { return false }
        _ = try add(account, secret, c["createdAt"] as? Int ?? Int(Date().timeIntervalSince1970)); return true
      } catch { return false }
    case "bunkerRequest":
      guard try isBunkerBound(account, string(c["peer"])) else { throw fail() }
      let peer = try string(c["peer"]); let operation = try string(c["operation"])
      let secret = try key(["account": account, "role": "nip46-client"])
      let params = operation == "connect" ? [peer, try read("nip46_bunker_secret_" + account) ?? ""] : c["params"] as? [String] ?? []
      let text = try json(["id": string(c["id"]), "method": operation, "params": params])
      return try sign(secret, ["kind": 24133, "created_at": Int(Date().timeIntervalSince1970), "tags": [["p", peer]], "content": crypt(secret, peer, text, "nip44", "encrypt")])
    default: throw fail()
    }
  }
  private struct WalletPending { let account: String; let walletId: String; let method: String; let expires: TimeInterval }
  private var walletPending: [String: WalletPending] = [:]
  private func walletName(_ account: String, _ id: String) throws -> String {
    _ = try hex(account)
    guard id.range(of: "^[A-Za-z0-9_-]{1,256}$", options: .regularExpression) != nil else { throw fail() }
    return "wallet_credential_" + account + "_" + id
  }
  private func walletLegacyName(_ account: String, _ id: String) -> String { "psstpsst.nwc." + account.prefix(16) + "." + id }
  private func walletRelays(_ values: [String]) throws -> [String] {
    guard !values.isEmpty, values.count <= 32 else { throw fail() }
    func form(_ value: String) -> String {
      let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789*-._")
      return value.addingPercentEncoding(withAllowedCharacters: allowed)!.replacingOccurrences(of: "%20", with: "+")
    }
    var result: [String] = []
    for value in values {
      guard var url = URLComponents(string: value), let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased(), url.user == nil, url.password == nil else { throw fail() }
      url.scheme = scheme == "https" ? "wss" : scheme == "http" ? "ws" : scheme
      guard ["ws", "wss"].contains(url.scheme!) else { throw fail() }
      url.host = host; url.fragment = nil
      if (url.scheme == "ws" && url.port == 80) || (url.scheme == "wss" && url.port == 443) { url.port = nil }
      let path = url.percentEncodedPath.replacingOccurrences(of: "/+", with: "/", options: .regularExpression).replacingOccurrences(of: "/$", with: "", options: .regularExpression)
      url.percentEncodedPath = path.isEmpty ? "/" : path
      if let query = url.percentEncodedQuery, !query.isEmpty {
        let pairs = try query.split(separator: "&", omittingEmptySubsequences: true).map { item -> (String, String) in
          let parts = item.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
          guard let key = String(parts[0]).replacingOccurrences(of: "+", with: " ").removingPercentEncoding,
            let value = (parts.count > 1 ? String(parts[1]) : "").replacingOccurrences(of: "+", with: " ").removingPercentEncoding else { throw fail() }
          return (key, value)
        }.enumerated().sorted { a, b in a.element.0 == b.element.0 ? a.offset < b.offset : a.element.0.utf16.lexicographicallyPrecedes(b.element.0.utf16) }
        url.percentEncodedQuery = pairs.map { form($0.element.0) + "=" + form($0.element.1) }.joined(separator: "&")
      }
      guard let text = url.string else { throw fail() }
      if !result.contains(text) { result.append(text) }
    }
    return result
  }
  private func walletCredential(_ account: String, _ id: String) throws -> [String: Any] {
    guard let value = try read(walletName(account, id)), let record = try JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any] else { throw fail() }
    _ = try hex(string(record["secret"])); _ = try hex(string(record["peer"]))
    return record
  }
  func initializeStorage() throws { if readOverride == nil { try storage.migrateLegacy() } }
  func walletHasPin(_ account: String) throws -> Bool { if readOverride == nil { try storage.migrateLegacy() }; _ = try hex(account); return try read("psstpsst.wallet.pin." + account) != nil }
  private func walletPinDigest(_ pin: String, _ salt: String) throws -> Data {
    let pinBytes = Data(pin.utf8), saltBytes = Data(salt.utf8); var output = Data(count: 32)
    guard output.withUnsafeMutableBytes({ out in pinBytes.withUnsafeBytes { p in saltBytes.withUnsafeBytes { s in
      PsstVaultPinDigest(p.bindMemory(to: UInt8.self).baseAddress!, p.count, s.bindMemory(to: UInt8.self).baseAddress!, s.count, out.bindMemory(to: UInt8.self).baseAddress!)
    } } }) != 0 else { throw fail() }; return output
  }
  func walletSetPin(_ account: String, _ pin: String) throws {
    guard pin.range(of: "^[0-9]{6}$", options: .regularExpression) != nil, try !walletHasPin(account) else { throw fail() }
    let salt = try encoded(random(32)); var digest = try walletPinDigest(pin, salt); defer { digest.resetBytes(in: 0..<digest.count) }
    try write("psstpsst.wallet.pin." + account, json(["version": 1, "salt": salt, "digest": encoded(digest)]))
  }
  func walletVerifyPin(_ account: String, _ pin: String) throws -> Bool {
    _ = try hex(account)
    let now = Date().timeIntervalSince1970 * 1000
    guard pin.range(of: "^[0-9]{6}$", options: .regularExpression) != nil else { return false }
    guard let value = try read("psstpsst.wallet.pin." + account), var record = try JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any], record["version"] as? Int == 1,
      let salt = record["salt"] as? String, salt.count <= 256 else { return false }
    if (record["retryAtMs"] as? Double ?? 0) > now { return false }
    var expected = try hex(string(record["digest"])); var actual = try walletPinDigest(pin, salt)
    defer { expected.resetBytes(in: 0..<expected.count); actual.resetBytes(in: 0..<actual.count) }
    var difference: UInt8 = 0; for i in 0..<32 { difference |= expected[i] ^ actual[i] }
    let failures = difference == 0 ? 0 : min(32, (record["failures"] as? Int ?? 0) + 1)
    record["failures"] = failures
    record["retryAtMs"] = difference == 0 ? 0 : now + min(30000, 1000 * pow(2, Double(min(5, failures - 1))))
    try write("psstpsst.wallet.pin." + account, json(record))
    if difference == 0 { return true }
    return false
  }
  func walletBound(_ account: String, _ id: String) throws -> Bool { try read(walletName(account, id)) != nil }
  private func walletPaymentAmount(_ invoice: String) throws -> String {
    guard invoice.range(of: "^ln(?:bcrt|bc|tb)([0-9]+)([munp]?)1[023456789acdefghjklmnpqrstuvwxyz]+$", options: .regularExpression) != nil,
      let separator = invoice.lastIndex(of: "1") else { throw fail() }
    var amount = String(invoice[..<separator]); for prefix in ["lnbcrt", "lnbc", "lntb"] { if amount.hasPrefix(prefix) { amount.removeFirst(prefix.count); break } }
    let suffix = amount.last.map(String.init) ?? ""
    let unit = ["m": UInt64(100000000), "u": UInt64(100000), "n": UInt64(100), "p": UInt64(1)][suffix]
    if unit != nil { amount.removeLast() }
    guard amount.count <= 18, let digits = UInt64(amount) else { throw fail() }
    if suffix == "p", digits % 10 != 0 { throw fail() }
    let (multiplied, overflow) = digits.multipliedReportingOverflow(by: unit ?? 100000000000)
    let msat = suffix == "p" ? digits / 10 : multiplied
    guard !overflow, msat > 0, msat <= 2100000000000000000 else { throw fail() }
    let fraction = String(format: "%03llu", msat % 1000).replacingOccurrences(of: "0+$", with: "", options: .regularExpression)
    return String(msat / 1000) + (fraction.isEmpty ? "" : "." + fraction)
  }
  func walletPaymentDetails(_ c: [String: Any]) throws -> [String: String] {
    let record = try walletCredential(string(c["account"]), string(c["walletId"]))
    guard c["operation"] as? String == "pay_invoice", let params = c["params"] as? [String: Any], let invoice = params["invoice"] as? String, invoice.count <= 30000, params.keys.allSatisfy({ ["invoice", "metadata"].contains($0) }),
      params["metadata"] == nil || params["metadata"] is [String: Any] else { throw fail() }
    return ["peer": try string(record["peer"]), "invoice": invoice, "amountSats": try walletPaymentAmount(invoice)]
  }
  func executeTrustedWallet(_ serialized: String) throws -> String {
    guard let c = try JSONSerialization.jsonObject(with: Data(serialized.utf8)) as? [String: Any],
      c["method"] as? String == "walletBindLegacy" || (c["method"] as? String == "walletRequest" && c["operation"] as? String == "pay_invoice") else { throw fail() }
    return try json(walletCommand(c, trusted: true))
  }
  private func walletCommand(_ c: [String: Any], trusted: Bool = false) throws -> Any {
    let account = try string(c["account"]); _ = try hex(account); let method = try string(c["method"])
    if ["walletImport", "walletBindLegacy", "walletRemove", "walletRemovePin"].contains(method) { invalidate() }
    if method == "walletImport" {
      let text = try string(c["connectionString"]).trimmingCharacters(in: .whitespacesAndNewlines)
      guard text.count <= 32768, let url = URLComponents(string: text), url.scheme?.lowercased() == "nostr+walletconnect", let host = url.host else { throw fail() }
      let peer = host.lowercased(); _ = try hex(peer)
      let items = url.queryItems ?? []
      guard let secret = items.first(where: { $0.name == "secret" })?.value else { throw fail() }
      _ = try publicKey(secret)
      let relays = try walletRelays(items.filter { $0.name == "relay" }.compactMap { $0.value })
      let id = "nwc_" + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
      try write(walletName(account, id), json(["secret": secret, "peer": peer, "relays": relays]))
      return ["id": id, "walletPubkey": peer, "relays": relays]
    }
    if method == "walletRemovePin" { try remove("psstpsst.wallet.pin." + account); return NSNull() }
    let id = try string(c["walletId"]); let name = try walletName(account, id)
    if method == "walletBindLegacy" {
      guard trusted else { throw fail() }
      if try walletBound(account, id) { return NSNull() }
      let peer = try string(c["peer"]).lowercased(); _ = try hex(peer)
      guard let secret = try read(walletLegacyName(account, id)), let values = c["relays"] as? [String] else { throw fail() }
      _ = try publicKey(secret)
      try write(name, json(["secret": secret, "peer": peer, "relays": try walletRelays(values)]))
      try remove(walletLegacyName(account, id)); return NSNull()
    }
    if method == "walletRemove" {
      invalidate(); try remove(name); try remove(walletLegacyName(account, id))
      walletPending = walletPending.filter { $0.value.account != account || $0.value.walletId != id }; return NSNull()
    }
    let record = try walletCredential(account, id), secret = try string(record["secret"]), peer = try string(record["peer"])
    guard let relays = record["relays"] as? [String] else { throw fail() }
    let now = Date().timeIntervalSince1970
    if method == "walletRequest" {
      let operation = try string(c["operation"])
      guard ["get_info", "get_balance", "list_transactions", "make_invoice", "lookup_invoice", "pay_invoice"].contains(operation), operation != "pay_invoice" || trusted,
        let params = c["params"] as? [String: Any] else { throw fail() }
      if operation == "pay_invoice" { _ = try walletPaymentDetails(c) }
      walletPending = walletPending.filter { $0.value.expires >= now }; guard walletPending.count < 128 else { throw fail() }
      let content = try crypt(secret, peer, json(["method": operation, "params": params]), "nip04", "encrypt", cache: false)
      let event = try sign(secret, ["kind": 23194, "created_at": Int(now), "content": content, "tags": [["p", peer]]])
      walletPending[try string(event["id"])] = WalletPending(account: account, walletId: id, method: operation, expires: now + 60)
      return ["event": event, "peer": peer, "relays": relays]
    }
    if method == "walletReceive" {
      let request = try string(c["requestId"])
      guard let pending = walletPending[request], pending.account == account, pending.walletId == id, pending.expires >= now,
        let event = c["event"] as? [String: Any], event["pubkey"] as? String == peer, try verifyPairingEvent(event, expectedKind: 23195),
        let tags = event["tags"] as? [[String]], tags.contains(where: { $0.count >= 2 && $0[0] == "e" && $0[1] == request }) else { return NSNull() }
      let text = try crypt(secret, peer, string(event["content"]), "nip04", "decrypt", cache: false)
      guard let response = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any], response["result_type"] as? String == pending.method,
        response["result"] != nil || response["error"] != nil, response["method"] == nil, response["params"] == nil else { return NSNull() }
      walletPending.removeValue(forKey: request); return response
    }
    if method == "walletRelayAuth" {
      guard let template = c["template"] as? [String: Any], template["kind"] as? Int == 22242, template["content"] as? String == "", let tags = template["tags"] as? [[String]], tags.count == 2,
        tags.contains(where: { $0.count == 2 && $0[0] == "challenge" }), let relay = tags.first(where: { $0.count == 2 && $0[0] == "relay" })?.last,
        relays.contains(try walletRelays([relay])[0]) else { throw fail() }
      return try sign(secret, template)
    }
    throw fail()
  }

  /** Called exclusively after native confirmation; its value never crosses the JS bridge. */

  func backup(_ account: String) throws -> String? {
    if readOverride == nil { try storage.migrateLegacy() }
    _ = try hex(account)
    let temporary = ephemeral[account].flatMap { $0.purpose == "account" ? $0.secret : nil }
    guard let value = try read("identity_privkey_" + account) ?? temporary else { return nil }
    let bytes = try hex(value); var words: [UInt8] = []; var accumulator = 0; var bits = 0
    for byte in bytes { accumulator = ((accumulator << 8) | Int(byte)) & 4095; bits += 8; while bits >= 5 { bits -= 5; words.append(UInt8((accumulator >> bits) & 31)) } }
    if bits > 0 { words.append(UInt8((accumulator << (5-bits)) & 31)) }
    let prefix: [UInt8] = [3, 3, 3, 3, 0, 14, 19, 5, 3]
    let generators: [UInt32] = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
    var checksum: UInt32 = 1
    for value in prefix + words + [UInt8](repeating: 0, count: 6) {
      let top = checksum >> 25; checksum = ((checksum & 0x1ffffff) << 5) ^ UInt32(value)
      for i in 0..<5 { if ((top >> i) & 1) != 0 { checksum ^= generators[i] } }
    }
    checksum ^= 1
    for i in 0..<6 { words.append(UInt8((checksum >> (5 * (5-i))) & 31)) }
    let alphabet = Array("qpzry9x8gf2tvdw0s3jn54khce6mua7l")
    return "nsec1" + String(words.map { alphabet[Int($0)] })
  }
}

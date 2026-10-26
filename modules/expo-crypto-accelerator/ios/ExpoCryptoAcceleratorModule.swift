import CommonCrypto
import UIKit
import LocalAuthentication
import UniformTypeIdentifiers
import ExpoModulesCore

public class ExpoCryptoAcceleratorModule: Module {
  private let vault = NativeKeyVault()
  private let vaultQueue = DispatchQueue(label: "chat.psstpsst.key-vault", qos: .userInitiated)

  private lazy var consentCatalog: [String: [String: Any]] = {
    guard let url = Bundle.main.url(forResource: "VaultConsent", withExtension: "json"),
      let data = try? Data(contentsOf: url), let catalog = try? JSONSerialization.jsonObject(with: data) as? [String: [String: Any]] else { return [:] }
    return catalog
  }()
  private func consent(_ selection: [String: String], _ operation: String) -> [String: String]? {
    let language = selection["language"] ?? Locale.preferredLanguages.first ?? "en"
    guard let locale = consentCatalog[language] ?? consentCatalog[String(language.split(separator: "-").first ?? "en")] ?? consentCatalog["en"],
      let fields = locale[operation] as? [String: String], let cancel = locale["cancel"] as? String else { return nil }
    return ["title": fields["title"] ?? "", "message": fields["message"] ?? "", "confirmLabel": fields["confirm"] ?? "", "cancelLabel": cancel]
  }

  private var walletInputBusy = false
  private func walletCopy(_ selection: [String: String]) -> ([String: String], String)? {
    let language = selection["language"] ?? Locale.preferredLanguages.first ?? "en"
    guard let locale = consentCatalog[language] ?? consentCatalog[String(language.split(separator: "-").first ?? "en")] ?? consentCatalog["en"],
      let fields = locale["wallet"] as? [String: String], let cancel = locale["cancel"] as? String else { return nil }
    return (fields, cancel)
  }
  /** PIN fields live only in UIKit; the host never receives their contents or a reusable approval token. */
  private func walletAuthenticate(_ account: String, selection: [String: String], details: [String: String]? = nil, completion: @escaping (Bool) -> Void) {
    DispatchQueue.main.async {
      guard !self.walletInputBusy, let (copy, cancel) = self.walletCopy(selection), let presenter = self.appContext?.utilities?.currentViewController() else { completion(false); return }
      let context = LAContext(); var error: NSError?
      let system = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
      if system && details == nil { completion(true); return }
      self.walletInputBusy = true
      let finish: (Bool) -> Void = { result in DispatchQueue.main.async { self.walletInputBusy = false; completion(result) } }
      self.vaultQueue.async {
        do {
          let hasPin = try self.vault.walletHasPin(account)
          let setup = !system && !hasPin
          if !setup && details == nil { finish(true); return }
          DispatchQueue.main.async {
            let payment = details != nil
            let description = details.map { ($0["amountSats"] ?? "") + " " + (copy["sats_unit"] ?? "") + "\n\n" + ($0["peer"] ?? "") + "\n\n" + ($0["invoice"] ?? "") } ?? ""
            let alert = UIAlertController(title: copy[payment ? "confirm_payment" : "save_pin"],
              message: (copy[system ? "auth_prompt" : setup ? "pin_setup_hint" : "pin_prompt"] ?? "") + "\n\n" + description, preferredStyle: .alert)
            if !system {
              alert.addTextField { field in field.isSecureTextEntry = true; field.keyboardType = .numberPad; field.placeholder = copy["pin"]; field.textContentType = .password }
              if setup { alert.addTextField { field in field.isSecureTextEntry = true; field.keyboardType = .numberPad; field.placeholder = copy["confirm_pin"]; field.textContentType = .newPassword } }
            }
            alert.addAction(UIAlertAction(title: cancel, style: .cancel) { _ in finish(false) })
            alert.addAction(UIAlertAction(title: copy[payment ? "pay" : "save_pin"], style: .default) { _ in
              if system {
                context.localizedCancelTitle = cancel
                context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: copy["auth_prompt"] ?? "") { approved, _ in finish(approved) }
              } else {
                let pin = alert.textFields?.first?.text ?? ""
                let repeated = setup ? alert.textFields?.last?.text ?? "" : pin
                alert.textFields?.forEach { $0.text = "" }
                guard pin == repeated else { finish(false); return }
                self.vaultQueue.async {
                  do {
                    if setup { try self.vault.walletSetPin(account, pin); finish(true) }
                    else { finish(try self.vault.walletVerifyPin(account, pin)) }
                  } catch { finish(false) }
                }
              }
            })
            presenter.present(alert, animated: true)
          }
        } catch { finish(false) }
      }
    }
  }
  private func walletTrustedCommand(_ request: [String: Any], serialized: String, promise: Promise) throws {
    let account = request["account"] as? String ?? ""
    let selection = request["confirmation"] as? [String: String] ?? [:]
    let revision = vault.revision
    let execute: (Bool) -> Void = { approved in
      guard approved else { promise.reject("ERR_KEY_VAULT", "Wallet authentication failed"); return }
      self.vaultQueue.async {
        do {
          guard self.vault.revision == revision else { throw NSError(domain: "PsstWallet", code: 1) }
          promise.resolve(try self.vault.executeTrustedWallet(serialized))
        } catch { promise.reject("ERR_KEY_VAULT", "Wallet operation cancelled") }
      }
    }
    walletAuthenticate(account, selection: selection, details: try vault.walletPaymentDetails(request), completion: execute)
  }

  public func definition() -> ModuleDefinition {
    Name("ExpoCryptoAccelerator")

    AsyncFunction("importIdentity") { (nsec: String, promise: Promise) in
      self.vaultQueue.async {
        do { promise.resolve(try self.vault.importIdentity(nsec)) }
        catch { promise.reject("ERR_KEY_VAULT", "Identity import failed") }
      }
    }

    AsyncFunction("securityStatus") { (promise: Promise) in
      self.vaultQueue.async {
        do { try self.vault.initializeStorage(); promise.resolve("available") }
        catch { promise.reject("ERR_KEY_VAULT", "Credential storage unavailable") }
      }
    }

    AsyncFunction("ensureWalletProtection") { (account: String, serialized: String, promise: Promise) in
      self.vaultQueue.async {
        do {
          let selection = try JSONSerialization.jsonObject(with: Data(serialized.utf8)) as? [String: String] ?? [:]
          _ = try self.vault.walletHasPin(account)
          self.walletAuthenticate(account, selection: selection) { promise.resolve($0) }
        } catch { promise.reject("ERR_KEY_VAULT", "Wallet authentication unavailable") }
      }
    }

    AsyncFunction("vaultExecute") { (command: String, promise: Promise) in
      self.vaultQueue.async {
        do {
          guard let request = try JSONSerialization.jsonObject(with: Data(command.utf8)) as? [String: Any] else { throw NSError(domain: "PsstPsstKeyVault", code: 1) }
          if request["method"] as? String == "walletRequest" && request["operation"] as? String == "pay_invoice" {
            try self.walletTrustedCommand(request, serialized: command, promise: promise); return
          }
          let bindingNeeded: Bool
          if request["method"] as? String == "bunkerRequest" {
            bindingNeeded = !(try self.vault.isBunkerBound(request["account"] as? String ?? "", request["peer"] as? String ?? ""))
          } else { bindingNeeded = false }
          let revision = self.vault.revision
          let execute = {
            self.vaultQueue.async {
              do {
                guard self.vault.revision == revision else { throw NSError(domain: "PsstPsstKeyVault", code: 1) }
                if bindingNeeded { try self.vault.bindBunker(request["account"] as! String, request["peer"] as! String) }
                promise.resolve(try self.vault.execute(command))
              } catch { promise.reject("ERR_KEY_VAULT", "Key vault operation failed") }
            }
          }
          if request["method"] as? String == "exportTransfer" || bindingNeeded {
            DispatchQueue.main.async {
              guard let presenter = self.appContext?.utilities?.currentViewController(),
                let selection = request["confirmation"] as? [String: String],
                let options = self.consent(selection, bindingNeeded ? "bunker" : "transfer"), let account = request["account"] as? String,
                let recipient = request[bindingNeeded ? "peer" : "recipient"] as? String, recipient.count == 64
              else { promise.reject("ERR_KEY_VAULT", "Vault confirmation unavailable"); return }
              let code = String(recipient.prefix(4)).uppercased() + " " + String(recipient.dropFirst(4).prefix(4)).uppercased()
              let alert = UIAlertController(title: options["title"], message: (options["message"] ?? "") + "\n\n" + account + "\n\n" + code + "\n" + recipient, preferredStyle: .alert)
              alert.addAction(UIAlertAction(title: options["cancelLabel"], style: .cancel) { _ in promise.reject("ERR_KEY_VAULT", "Vault operation cancelled") })
              alert.addAction(UIAlertAction(title: options["confirmLabel"], style: .destructive) { _ in execute() })
              presenter.present(alert, animated: true)
            }
          } else { promise.resolve(try self.vault.execute(command)) }
        } catch { promise.reject("ERR_KEY_VAULT", "Key vault operation failed") }
      }
    }

    AsyncFunction("backupIdentity") { (account: String, serialized: String, promise: Promise) in
      let revision = self.vault.revision
      DispatchQueue.main.async {
        guard let presenter = self.appContext?.utilities?.currentViewController(),
          let selection = try? JSONSerialization.jsonObject(with: Data(serialized.utf8)) as? [String: String],
          let options = self.consent(selection, "backup")
        else { promise.resolve(false); return }
        let alert = UIAlertController(title: options["title"], message: options["message"], preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: options["cancelLabel"], style: .cancel) { _ in promise.resolve(false) })
        let copyAction = UIAlertAction(title: options["confirmLabel"], style: .default) { _ in
          self.vaultQueue.async {
            do {
              guard self.vault.revision == revision else { promise.resolve(false); return }
              guard let nsec = try self.vault.backup(account) else { promise.reject("ERR_NO_LOCAL_KEY", "No local identity key is available for backup"); return }
              DispatchQueue.main.async {
                guard presenter.viewIfLoaded?.window != nil else { promise.resolve(false); return }
                let copied = self.vault.withRevision(revision) {
                  UIPasteboard.general.setItems([[UTType.utf8PlainText.identifier: nsec]], options: [.localOnly: true])
                }
                promise.resolve(copied)
              }
            } catch { promise.reject("ERR_KEY_VAULT", "Key backup failed") }
          }
        }
        alert.addAction(copyAction)
        alert.preferredAction = copyAction
        presenter.present(alert, animated: true)
      }
    }

    AsyncFunction("getNip44ConversationKeyAsync") { (privkeyHex: String, pubkeyHex: String) in
      try deriveConversationKey(privkeyHex: privkeyHex, pubkeyHex: pubkeyHex).hexString
    }

    Function("verifySchnorr") { (signatureHex: String, messageHex: String, pubkeyHex: String) in
      verifySchnorr(signatureHex: signatureHex, messageHex: messageHex, pubkeyHex: pubkeyHex)
    }
  }
}

private func deriveConversationKey(privkeyHex: String, pubkeyHex: String) throws -> Data {
  let privkey = try Data(hex: privkeyHex)
  let xOnlyPubkey = try Data(hex: pubkeyHex)
  guard privkey.count == 32, xOnlyPubkey.count == 32 else {
    throw InvalidKeyException()
  }

  let sharedX = try deriveSharedX(privkey: privkey, pubkey: xOnlyPubkey)
  return hmacSha256(key: Data("nip44-v2".utf8), data: sharedX)
}

private func deriveSharedX(privkey: Data, pubkey: Data) throws -> Data {
  var sharedX = Data(count: 32)
  let ok = sharedX.withUnsafeMutableBytes { sharedBytes in
    privkey.withUnsafeBytes { privkeyBytes in
      pubkey.withUnsafeBytes { pubkeyBytes in
        ExpoCryptoAcceleratorDeriveSharedX(
          privkeyBytes.bindMemory(to: UInt8.self).baseAddress!,
          pubkeyBytes.bindMemory(to: UInt8.self).baseAddress!,
          sharedBytes.bindMemory(to: UInt8.self).baseAddress!
        )
      }
    }
  }
  guard ok else { throw Secp256k1Exception() }
  return sharedX
}

private func verifySchnorr(signatureHex: String, messageHex: String, pubkeyHex: String) -> Bool {
  guard
    let signature = try? Data(hex: signatureHex),
    let message = try? Data(hex: messageHex),
    let pubkey = try? Data(hex: pubkeyHex),
    signature.count == 64,
    message.count == 32,
    pubkey.count == 32
  else {
    return false
  }

  return signature.withUnsafeBytes { signatureBytes in
    message.withUnsafeBytes { messageBytes in
      pubkey.withUnsafeBytes { pubkeyBytes in
        ExpoCryptoAcceleratorVerifySchnorr(
          signatureBytes.bindMemory(to: UInt8.self).baseAddress!,
          messageBytes.bindMemory(to: UInt8.self).baseAddress!,
          pubkeyBytes.bindMemory(to: UInt8.self).baseAddress!
        )
      }
    }
  }
}

private func hmacSha256(key: Data, data: Data) -> Data {
  var mac = Data(count: Int(CC_SHA256_DIGEST_LENGTH))
  mac.withUnsafeMutableBytes { macBytes in
    key.withUnsafeBytes { keyBytes in
      data.withUnsafeBytes { dataBytes in
        CCHmac(
          CCHmacAlgorithm(kCCHmacAlgSHA256),
          keyBytes.baseAddress,
          key.count,
          dataBytes.baseAddress,
          data.count,
          macBytes.baseAddress
        )
      }
    }
  }
  return mac
}

private extension Data {
  init(hex: String) throws {
    guard hex.count % 2 == 0 else { throw InvalidHexException() }
    var bytes = [UInt8]()
    bytes.reserveCapacity(hex.count / 2)
    var index = hex.startIndex
    while index < hex.endIndex {
      let next = hex.index(index, offsetBy: 2)
      guard let byte = UInt8(hex[index..<next], radix: 16) else {
        throw InvalidHexException()
      }
      bytes.append(byte)
      index = next
    }
    self.init(bytes)
  }

  var hexString: String {
    map { String(format: "%02x", $0) }.joined()
  }
}

private final class InvalidHexException: Exception, @unchecked Sendable {
  override var reason: String {
    "Expected a lowercase or uppercase hex string."
  }
}

private final class InvalidKeyException: Exception, @unchecked Sendable {
  override var reason: String {
    "Expected a 32-byte private key and a 32-byte x-only public key."
  }
}

private final class Secp256k1Exception: Exception, @unchecked Sendable {
  override var reason: String {
    "secp256k1 conversation key derivation failed."
  }
}

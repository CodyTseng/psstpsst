import Foundation

@main
struct VaultHarness {
  static func main() {
    var storage: [String: String] = [:]
    let vault = NativeKeyVault(read: { storage[$0] }, write: { storage[$0] = $1 }, remove: { storage.removeValue(forKey: $0) })
    while let line = readLine() {
      do {
        let request = try JSONSerialization.jsonObject(with: Data(line.utf8)) as! [String: Any]
        if let nsec = request["testImportIdentity"] as? String {
          print("{\"value\":" + (try vault.importIdentity(nsec)) + "}")
        } else if request["testRevision"] as? Bool == true {
          print("{\"value\":\(vault.revision)}")
        } else if let expected = request["testWithRevision"] as? UInt64 {
          print("{\"value\":\(vault.withRevision(expected, action: {}))}")
        } else if let operation = request["testWallet"] as? [String: Any], let action = operation["action"] as? String, let account = operation["account"] as? String {
          let value: Any
          switch action {
          case "hasPin": value = try vault.walletHasPin(account)
          case "setPin": try vault.walletSetPin(account, operation["value"] as! String); value = NSNull()
          case "verifyPin": value = try vault.walletVerifyPin(account, operation["value"] as! String)
          case "details": value = try vault.walletPaymentDetails(operation["value"] as! [String: Any])
          case "trusted":
            let command = try JSONSerialization.data(withJSONObject: operation["value"]!)
            value = try JSONSerialization.jsonObject(with: Data(vault.executeTrustedWallet(String(decoding: command, as: UTF8.self)).utf8), options: .fragmentsAllowed)
          default: throw NSError(domain: "InvalidTestOperation", code: 1)
          }
          let data = try JSONSerialization.data(withJSONObject: ["value": value]); print(String(decoding: data, as: UTF8.self))
        } else if request["testStorage"] as? Bool == true {
          try exerciseNativeStorage(); print("{\"value\":true}")
        } else if let seed = request["testSeed"] as? [String: String] {
          for (key, value) in seed { storage[key] = value }; print("{\"value\":null}")
        } else if let binding = request["testBind"] as? [String] {
          try vault.bindBunker(binding[0], binding[1]); print("{\"value\":null}")
        } else if let account = request["testBackup"] as? String {
          let value = try vault.backup(account)
          let data = try JSONSerialization.data(withJSONObject: ["value": value as Any? ?? NSNull()])
          print(String(decoding: data, as: UTF8.self))
        } else {
          let result = try vault.execute(line)
          print(("{\"value\":" + result + "}").replacingOccurrences(of: "\u{2028}", with: "\\u2028").replacingOccurrences(of: "\u{2029}", with: "\\u2029"))
        }
      } catch { print("{\"error\":true}") }
      fflush(stdout)
    }
  }
}

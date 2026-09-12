import CommonCrypto
import ExpoModulesCore

public class ExpoCryptoAcceleratorModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoCryptoAccelerator")

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

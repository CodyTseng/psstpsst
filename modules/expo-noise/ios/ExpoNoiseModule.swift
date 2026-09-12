import ExpoModulesCore
import Foundation

private struct NoiseKeyPairRecord: Record {
  @Field var privateKey = Data()
  @Field var publicKey = Data()
}

private struct NoiseSessionRecord: Record {
  @Field var handle = ""
  @Field var sessionId = Data()
}

private struct NoiseOpenRecord: Record {
  @Field var type = 0
  @Field var payload = Data()
}

private final class NoiseHandshakeBox: @unchecked Sendable {
  private let lock = NSLock()
  private var pointer: OpaquePointer?

  init(pointer: OpaquePointer) {
    self.pointer = pointer
  }

  func access<T>(_ operation: (OpaquePointer) throws -> T) throws -> T {
    try lock.withLock {
      guard let pointer else { throw NoiseException("Noise handshake is closed") }
      return try operation(pointer)
    }
  }

  func close() {
    lock.withLock {
      if let pointer { psst_noise_handshake_destroy(pointer) }
      pointer = nil
    }
  }

  deinit { close() }
}

private final class NoiseSessionBox: @unchecked Sendable {
  private let lock = NSLock()
  private var pointer: OpaquePointer?

  init(pointer: OpaquePointer) {
    self.pointer = pointer
  }

  func access<T>(_ operation: (OpaquePointer) throws -> T) throws -> T {
    try lock.withLock {
      guard let pointer else { throw NoiseException("Noise session is closed") }
      return try operation(pointer)
    }
  }

  func close() {
    lock.withLock {
      if let pointer { psst_noise_session_destroy(pointer) }
      pointer = nil
    }
  }

  deinit { close() }
}

public final class ExpoNoiseModule: Module {
  private let registryLock = NSLock()
  private var handshakes: [String: NoiseHandshakeBox] = [:]
  private var sessions: [String: NoiseSessionBox] = [:]

  public func definition() -> ModuleDefinition {
    Name("ExpoNoise")

    AsyncFunction("generateKeyPairAsync") { (seed: Data?) -> NoiseKeyPairRecord in
      var privateKey = Data(count: 32)
      var publicKey = Data(count: 32)
      let error = privateKey.withUnsafeMutableBytes { privateBytes in
        publicKey.withUnsafeMutableBytes { publicBytes in
          seed?.withUnsafeBytes { seedBytes in
            psst_noise_keypair(
              seedBytes.bindMemory(to: UInt8.self).baseAddress,
              seedBytes.count,
              privateBytes.bindMemory(to: UInt8.self).baseAddress,
              publicBytes.bindMemory(to: UInt8.self).baseAddress
            )
          } ?? psst_noise_keypair(
            nil,
            0,
            privateBytes.bindMemory(to: UInt8.self).baseAddress,
            publicBytes.bindMemory(to: UInt8.self).baseAddress
          )
        }
      }
      try requireNoiseSuccess(error)
      return NoiseKeyPairRecord(privateKey: privateKey, publicKey: publicKey)
    }

    AsyncFunction("createHandshakeAsync") {
      (role: String, staticPrivateKey: Data, fixedEphemeralPrivateKey: Data?) -> String in
      guard role == "initiator" || role == "responder" else {
        throw NoiseException("Invalid Noise role")
      }
      var pointer: OpaquePointer?
      let error = staticPrivateKey.withUnsafeBytes { staticBytes in
        fixedEphemeralPrivateKey?.withUnsafeBytes { ephemeralBytes in
          psst_noise_handshake_create(
            role == "initiator" ? 1 : 0,
            staticBytes.bindMemory(to: UInt8.self).baseAddress,
            staticBytes.count,
            ephemeralBytes.bindMemory(to: UInt8.self).baseAddress,
            ephemeralBytes.count,
            &pointer
          )
        } ?? psst_noise_handshake_create(
          role == "initiator" ? 1 : 0,
          staticBytes.bindMemory(to: UInt8.self).baseAddress,
          staticBytes.count,
          nil,
          0,
          &pointer
        )
      }
      try requireNoiseSuccess(error)
      guard let pointer else { throw NoiseException("Noise handshake creation failed") }
      let handle = UUID().uuidString.lowercased()
      registryLock.withLock { handshakes[handle] = NoiseHandshakeBox(pointer: pointer) }
      return handle
    }

    AsyncFunction("writeHandshakeAsync") { (handle: String, payload: Data) -> Data in
      try handshake(handle).access { pointer in
        try withOutput(capacity: 65_535) { output, outputLength in
          payload.withUnsafeBytes { payloadBytes in
            psst_noise_handshake_write(
              pointer,
              payloadBytes.bindMemory(to: UInt8.self).baseAddress,
              payloadBytes.count,
              output,
              65_535,
              outputLength
            )
          }
        }
      }
    }

    AsyncFunction("readHandshakeAsync") { (handle: String, message: Data) -> Data in
      try handshake(handle).access { pointer in
        try withOutput(capacity: 65_535) { output, outputLength in
          message.withUnsafeBytes { messageBytes in
            psst_noise_handshake_read(
              pointer,
              messageBytes.bindMemory(to: UInt8.self).baseAddress,
              messageBytes.count,
              output,
              65_535,
              outputLength
            )
          }
        }
      }
    }

    AsyncFunction("getRemoteStaticKeyAsync") { (handle: String) -> Data in
      try handshake(handle).access { pointer in
        var output = Data(count: 32)
        let error = output.withUnsafeMutableBytes { bytes in
          psst_noise_handshake_remote_static(
            pointer,
            bytes.bindMemory(to: UInt8.self).baseAddress
          )
        }
        try requireNoiseSuccess(error)
        return output
      }
    }

    AsyncFunction("finishHandshakeAsync") {
      (handle: String, maxRecordSize: Int) -> NoiseSessionRecord in
      let box = try handshake(handle)
      let result = try box.access { pointer -> NoiseSessionRecord in
        var sessionPointer: OpaquePointer?
        var sessionId = Data(count: 32)
        let error = sessionId.withUnsafeMutableBytes { bytes in
          psst_noise_handshake_finish(
            pointer,
            maxRecordSize,
            &sessionPointer,
            bytes.bindMemory(to: UInt8.self).baseAddress
          )
        }
        try requireNoiseSuccess(error)
        guard let sessionPointer else { throw NoiseException("Noise split failed") }
        let sessionHandle = UUID().uuidString.lowercased()
        registryLock.withLock {
          sessions[sessionHandle] = NoiseSessionBox(pointer: sessionPointer)
        }
        return NoiseSessionRecord(handle: sessionHandle, sessionId: sessionId)
      }
      _ = registryLock.withLock { handshakes.removeValue(forKey: handle) }
      return result
    }

    AsyncFunction("destroyHandshakeAsync") { (handle: String) in
      registryLock.withLock { handshakes.removeValue(forKey: handle) }?.close()
    }

    AsyncFunction("shouldRotateSessionAsync") {
      (handle: String, nextPayloadLength: Int) -> Bool in
      try session(handle).access { pointer in
        var result: Int32 = 0
        try requireNoiseSuccess(
          psst_noise_session_should_rotate(pointer, nextPayloadLength, &result)
        )
        return result != 0
      }
    }

    AsyncFunction("sealAsync") { (handle: String, type: Int, payload: Data) -> Data in
      guard let packetType = UInt8(exactly: type) else {
        throw NoiseException("Invalid Noise packet type")
      }
      return try session(handle).access { pointer in
        try withOutput(capacity: payload.count + 64) { output, outputLength in
          payload.withUnsafeBytes { payloadBytes in
            psst_noise_session_seal(
              pointer,
              packetType,
              payloadBytes.bindMemory(to: UInt8.self).baseAddress,
              payloadBytes.count,
              output,
              payload.count + 64,
              outputLength
            )
          }
        }
      }
    }

    AsyncFunction("openAsync") { (handle: String, record: Data) -> NoiseOpenRecord in
      try session(handle).access { pointer in
        var type: UInt8 = 0
        let payload = try withOutput(capacity: max(1, record.count)) { output, outputLength in
          record.withUnsafeBytes { recordBytes in
            psst_noise_session_open(
              pointer,
              recordBytes.bindMemory(to: UInt8.self).baseAddress,
              recordBytes.count,
              &type,
              output,
              record.count,
              outputLength
            )
          }
        }
        return NoiseOpenRecord(type: Int(type), payload: payload)
      }
    }

    AsyncFunction("destroySessionAsync") { (handle: String) in
      registryLock.withLock { sessions.removeValue(forKey: handle) }?.close()
    }

    OnDestroy {
      let values = registryLock.withLock { () -> ([NoiseHandshakeBox], [NoiseSessionBox]) in
        let result = (Array(handshakes.values), Array(sessions.values))
        handshakes.removeAll()
        sessions.removeAll()
        return result
      }
      values.0.forEach { $0.close() }
      values.1.forEach { $0.close() }
    }
  }

  private func handshake(_ handle: String) throws -> NoiseHandshakeBox {
    guard let result = registryLock.withLock({ handshakes[handle] }) else {
      throw NoiseException("Unknown Noise handshake")
    }
    return result
  }

  private func session(_ handle: String) throws -> NoiseSessionBox {
    guard let result = registryLock.withLock({ sessions[handle] }) else {
      throw NoiseException("Unknown Noise session")
    }
    return result
  }
}

private func withOutput(
  capacity: Int,
  operation: (UnsafeMutablePointer<UInt8>, UnsafeMutablePointer<Int>) -> Int32
) throws -> Data {
  var output = Data(count: max(1, capacity))
  var outputLength = 0
  let error = output.withUnsafeMutableBytes { bytes in
    operation(bytes.bindMemory(to: UInt8.self).baseAddress!, &outputLength)
  }
  try requireNoiseSuccess(error)
  guard outputLength >= 0, outputLength <= capacity else {
    throw NoiseException("Invalid Noise output length")
  }
  output.count = outputLength
  return output
}

private func requireNoiseSuccess(_ error: Int32) throws {
  guard error == PSST_NOISE_OK else {
    throw NoiseException(String(cString: psst_noise_error_message(error)))
  }
}

private final class NoiseException: Exception, @unchecked Sendable {
  private let message: String

  init(_ message: String) {
    self.message = message
    super.init()
  }

  override var reason: String { message }
}

private extension NSLock {
  func withLock<T>(_ operation: () throws -> T) rethrows -> T {
    lock()
    defer { unlock() }
    return try operation()
  }
}

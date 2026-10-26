package chat.psstpsst.app.noise

import chat.psstpsst.app.cryptoaccelerator.NativeVaultStorage
import expo.modules.securestore.SecureStoreModule
import expo.modules.securestore.SecureStoreOptions
import expo.modules.kotlin.functions.Coroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

private class NoiseKeyPairRecord(
  @Field val privateKey: ByteArray,
  @Field val publicKey: ByteArray,
) : Record

private class NoiseSessionRecord(
  @Field val handle: String,
  @Field val sessionId: ByteArray,
) : Record

private class NoiseOpenRecord(
  @Field val type: Int,
  @Field val payload: ByteArray,
) : Record

private class HandshakeBox(private var pointer: Long) {
  @Synchronized
  fun <T> access(operation: (Long) -> T): T {
    check(pointer != 0L) { "Noise handshake is closed" }
    return operation(pointer)
  }

  @Synchronized
  fun finish(operation: (Long) -> ByteArray, destroy: (Long) -> Unit): ByteArray {
    check(pointer != 0L) { "Noise handshake is closed" }
    val current = pointer
    return try {
      operation(current)
    } finally {
      destroy(current)
      pointer = 0
    }
  }

  @Synchronized
  fun close(destroy: (Long) -> Unit) {
    if (pointer != 0L) destroy(pointer)
    pointer = 0
  }
}

private class SessionBox(private var pointer: Long) {
  @Synchronized
  fun <T> access(operation: (Long) -> T): T {
    check(pointer != 0L) { "Noise session is closed" }
    return operation(pointer)
  }

  @Synchronized
  fun close(destroy: (Long) -> Unit) {
    if (pointer != 0L) destroy(pointer)
    pointer = 0
  }
}

class ExpoNoiseModule : Module() {
  private val handshakes = ConcurrentHashMap<String, HandshakeBox>()
  private val sessions = ConcurrentHashMap<String, SessionBox>()

  private val identityMutex = Mutex()
  private val identityStore by lazy { NativeVaultStorage(appContext.reactContext ?: error("Vault context unavailable")) }
  private fun identityName(account: String): String {
    require(Regex("^[0-9a-fA-F]{64}$").matches(account)); return "proximity_identity_noise_privkey_$account"
  }
  private suspend fun identity(account: String, create: Boolean): ByteArray {
    val name = identityName(account)
    val legacy = appContext.registry.getModule<SecureStoreModule>() ?: error("Secure storage unavailable")
    identityStore.migrateLegacy(legacy)
    val saved = identityStore.read(name)
    legacy.deleteItemImpl(name, SecureStoreOptions())
    require(saved != null || create) { "Noise credential unavailable" }
    val seed = saved?.let { value ->
      require(Regex("^[0-9a-fA-F]{64}$").matches(value))
      ByteArray(32) { value.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }
    val result = try { generateKeyPairNative(seed) } finally { seed?.fill(0) }
    try {
      if (saved == null) identityStore.write(name, result.copyOfRange(0, 32).joinToString("") { "%02x".format(it) })
      return result
    } catch (error: Exception) { result.fill(0); throw error }
  }
  private fun createHandshake(role: String, staticPrivateKey: ByteArray, ephemeral: ByteArray?): String {
    require(role == "initiator" || role == "responder") { "Invalid Noise role" }
    val pointer = createHandshakeNative(role == "initiator", staticPrivateKey, ephemeral)
    check(pointer != 0L) { "Noise handshake creation failed" }
    val handle = UUID.randomUUID().toString(); handshakes[handle] = HandshakeBox(pointer); return handle
  }

  override fun definition() = ModuleDefinition {
    Name("ExpoNoise")

    AsyncFunction("ensureIdentityAsync") Coroutine { account: String ->
      withContext(Dispatchers.IO) { identityMutex.withLock {
        val pair = identity(account, true)
        try { pair.copyOfRange(32, 64) } finally { pair.fill(0) }
      } }
    }
    AsyncFunction("createAccountHandshakeAsync") Coroutine { account: String, role: String ->
      withContext(Dispatchers.IO) { identityMutex.withLock {
        val pair = identity(account, false); val secret = pair.copyOfRange(0, 32)
        try { createHandshake(role, secret, null) } finally { pair.fill(0); secret.fill(0) }
      } }
    }
    AsyncFunction("removeIdentityAsync") Coroutine { account: String ->
      withContext(Dispatchers.IO) { identityMutex.withLock {
        val name = identityName(account)
        val legacy = appContext.registry.getModule<SecureStoreModule>() ?: error("Secure storage unavailable")
        legacy.deleteItemImpl(name, SecureStoreOptions()); identityStore.remove(name)
      } }
    }

    AsyncFunction("generateKeyPairAsync") { seed: ByteArray? ->
      val result = generateKeyPairNative(seed)
      NoiseKeyPairRecord(result.copyOfRange(0, 32), result.copyOfRange(32, 64))
    }

    AsyncFunction("createHandshakeAsync") {
      role: String, staticPrivateKey: ByteArray, fixedEphemeralPrivateKey: ByteArray? ->
      createHandshake(role, staticPrivateKey, fixedEphemeralPrivateKey)
    }

    AsyncFunction("writeHandshakeAsync") { handle: String, payload: ByteArray ->
      handshake(handle).access { writeHandshakeNative(it, payload) }
    }

    AsyncFunction("readHandshakeAsync") { handle: String, message: ByteArray ->
      handshake(handle).access { readHandshakeNative(it, message) }
    }

    AsyncFunction("getRemoteStaticKeyAsync") { handle: String ->
      handshake(handle).access(::getRemoteStaticKeyNative)
    }

    AsyncFunction("finishHandshakeAsync") { handle: String, maxRecordSize: Int ->
      val box = handshake(handle)
      val result = box.finish(
        { finishHandshakeNative(it, maxRecordSize) },
        ::destroyHandshakeNative,
      )
      handshakes.remove(handle, box)
      var pointer = 0L
      for (index in 0 until 8) {
        pointer = pointer or ((result[index].toLong() and 0xff) shl (index * 8))
      }
      check(pointer != 0L) { "Noise split failed" }
      val sessionHandle = UUID.randomUUID().toString()
      sessions[sessionHandle] = SessionBox(pointer)
      NoiseSessionRecord(sessionHandle, result.copyOfRange(8, 40))
    }

    AsyncFunction("destroyHandshakeAsync") { handle: String ->
      handshakes.remove(handle)?.close(::destroyHandshakeNative)
    }

    AsyncFunction("shouldRotateSessionAsync") { handle: String, nextPayloadLength: Int ->
      session(handle).access { shouldRotateSessionNative(it, nextPayloadLength) }
    }

    AsyncFunction("sealAsync") { handle: String, type: Int, payload: ByteArray ->
      session(handle).access { sealNative(it, type, payload) }
    }

    AsyncFunction("openAsync") { handle: String, record: ByteArray ->
      val result = session(handle).access { openNative(it, record) }
      check(result.isNotEmpty()) { "Invalid Noise open result" }
      NoiseOpenRecord(result[0].toInt() and 0xff, result.copyOfRange(1, result.size))
    }

    AsyncFunction("destroySessionAsync") { handle: String ->
      sessions.remove(handle)?.close(::destroySessionNative)
    }

    OnDestroy {
      handshakes.values.forEach { it.close(::destroyHandshakeNative) }
      sessions.values.forEach { it.close(::destroySessionNative) }
      handshakes.clear()
      sessions.clear()
    }
  }

  private fun handshake(handle: String): HandshakeBox =
    handshakes[handle] ?: error("Unknown Noise handshake")

  private fun session(handle: String): SessionBox =
    sessions[handle] ?: error("Unknown Noise session")

  private external fun generateKeyPairNative(seed: ByteArray?): ByteArray
  private external fun createHandshakeNative(
    initiator: Boolean,
    staticPrivateKey: ByteArray,
    fixedEphemeralPrivateKey: ByteArray?,
  ): Long
  private external fun writeHandshakeNative(pointer: Long, payload: ByteArray): ByteArray
  private external fun readHandshakeNative(pointer: Long, message: ByteArray): ByteArray
  private external fun getRemoteStaticKeyNative(pointer: Long): ByteArray
  private external fun finishHandshakeNative(pointer: Long, maxRecordSize: Int): ByteArray
  private external fun destroyHandshakeNative(pointer: Long)
  private external fun shouldRotateSessionNative(pointer: Long, nextPayloadLength: Int): Boolean
  private external fun sealNative(pointer: Long, type: Int, payload: ByteArray): ByteArray
  private external fun openNative(pointer: Long, record: ByteArray): ByteArray
  private external fun destroySessionNative(pointer: Long)

  companion object {
    init {
      System.loadLibrary("expo-noise")
    }
  }
}

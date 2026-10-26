package chat.psstpsst.app.cryptoaccelerator

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Runs under the module's coroutine mutex, outside the React rendering thread. */
internal class NativeKeyVault(
  private val read: suspend (String) -> String?,
  private val write: suspend (String, String) -> Unit,
  private val remove: suspend (String) -> Unit,
  private val publicKeyBytes: (String) -> ByteArray,
  private val verifyBytes: (String, String, String) -> Boolean,
  private val pinDigestBytes: (String, String) -> ByteArray,
  private val signBytes: (String, String, ByteArray) -> ByteArray,
  private val sharedX: (String, String) -> ByteArray,
  private val chacha: (ByteArray, ByteArray, ByteArray) -> ByteArray,
) {
  private data class Pairing(
    var secretKey: String, val pubkey: String, var peer: String?, val secret: String?, val relays: List<String>,
    var connected: Boolean = false, var account: String? = null, var pending: Pair<String, String>? = null, var committed: JSONObject? = null,
  )
  private val pairings = mutableMapOf<String, Pairing>()

  private fun verifyPairingEvent(event: JSONObject, expectedKind: Int = 24133): Boolean {
    val pub = event.getString("pubkey"); val kind = event.getLong("kind"); val created = event.getLong("created_at")
    if (kind != expectedKind.toLong() || created < 0) return false
    val tags = event.getJSONArray("tags")
    for (i in 0 until tags.length()) { val tag = tags.getJSONArray(i); for (j in 0 until tag.length()) require(tag.get(j) is String) }
    val canonical = encode(JSONArray().put(0).put(pub).put(created).put(kind).put(tags).put(event.getString("content")))
    val digest = hex(MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(Charsets.UTF_8)))
    return event.getString("id") == digest && verifyBytes(event.getString("sig"), digest, pub)
  }

  private suspend fun pairing(c: JSONObject): Any {
    val method = c.getString("method")
    if (method == "beginBunkerPairing") {
      require(pairings.size < 8)
      val relays = c.getJSONArray("relays").let { values -> (0 until values.length()).map { values.getString(it) } }
      require(relays.isNotEmpty())
      val peer = if (c.isNull("peer")) null else c.getString("peer").also { bytes(it).fill(0) }
      val key = hex(randomBytes(32)); val pub = pub(key)
      val secret = if (peer == null) hex(randomBytes(32)) else if (c.isNull("secret")) null else c.getString("secret")
      val session = hex(randomBytes(32))
      pairings[session] = Pairing(key, pub, peer, secret, relays)
      val uri: Any = if (peer == null) android.net.Uri.Builder().scheme("nostrconnect").authority(pub).apply {
        relays.forEach { appendQueryParameter("relay", it) }; appendQueryParameter("secret", secret); appendQueryParameter("name", "PsstPsst")
      }.build().toString() else JSONObject.NULL
      return JSONObject().put("session", session).put("clientPubkey", pub).put("uri", uri)
    }
    val session = c.getString("session"); val pair = pairings[session] ?: error("Pairing session ended")
    if (method == "cancelBunkerPairing") { pair.secretKey = ""; pairings.remove(session); publicCache.clear(); return JSONObject.NULL }
    if (method == "commitBunkerPairing") {
      pair.committed?.let { return it }
      val account = pair.account ?: error("Pairing is incomplete"); val peer = pair.peer ?: error("Pairing is incomplete")
      require(pair.connected)
      val existing = read("nip46_client_privkey_$account")
      if (existing == null) {
        // Never combine a new client with a previously saved credential.
        remove("nip46_bunker_secret_$account"); remove("nip46_bunker_binding_$account")
        pair.secret?.let { write("nip46_bunker_secret_$account", it) }
        write("nip46_bunker_binding_$account", peer)
        write("nip46_client_privkey_$account", pair.secretKey)
        clear()
      }
      val result = JSONObject().put("pubkey", account).put("existing", existing != null)
        .put("pointer", JSONObject().put("pubkey", peer).put("relays", JSONArray(pair.relays)).put("secret", JSONObject.NULL))
      pair.committed = result; pair.secretKey = ""; publicCache.clear(); return result
    }
    require(pair.committed == null)
    if (method == "bunkerPairingRequest") {
      val peer = pair.peer ?: error("Bunker is not known"); val operation = c.getString("operation")
      require(operation == "connect" || (operation == "get_public_key" && pair.connected))
      val id = hex(randomBytes(32)); pair.pending = id to operation
      val params = if (operation == "connect") JSONArray().put(peer).put(pair.secret ?: "") else JSONArray()
      val text = encode(JSONObject().put("id", id).put("method", operation).put("params", params))
      return sign(pair.secretKey, JSONObject().put("kind", 24133).put("created_at", System.currentTimeMillis() / 1000)
        .put("tags", JSONArray().put(JSONArray().put("p").put(peer))).put("content", crypt(pair.secretKey, peer, text, "nip44", "encrypt", false)))
    }
    if (method == "bunkerPairingReceive") {
      try {
        val event = c.getJSONObject("event"); val peer = event.getString("pubkey")
        val tags = event.getJSONArray("tags")
        val target = (0 until tags.length()).any { val tag = tags.getJSONArray(it); tag.length() >= 2 && tag.getString(0) == "p" && tag.getString(1) == pair.pubkey }
        if (!verifyPairingEvent(event) || !target || (pair.peer != null && peer != pair.peer)) return JSONObject().put("type", "ignored")
        val response = JSONObject(crypt(pair.secretKey, peer, event.getString("content"), "nip44", "decrypt", false))
        if (response.has("method") || response.has("params")) return JSONObject().put("type", "ignored")
        if (pair.peer == null) {
          if (response.opt("result") != pair.secret) return JSONObject().put("type", "ignored")
          pair.peer = peer; return JSONObject().put("type", "peer").put("peer", peer)
        }
        val pending = pair.pending
        if (pending == null || response.opt("id") != pending.first) return JSONObject().put("type", "ignored")
        if (response.opt("result") == "auth_url" && response.opt("error") is String) return JSONObject().put("type", "auth").put("url", response.getString("error"))
        if (!response.isNull("error") || response.opt("result") !is String) return JSONObject().put("type", "rejected")
        pair.pending = null
        if (pending.second == "connect") { pair.connected = true; return JSONObject().put("type", "connected") }
        val account = response.getString("result"); bytes(account).fill(0); pair.account = account
        return JSONObject().put("type", "account").put("pubkey", account)
      } catch (_: Exception) { return JSONObject().put("type", "ignored") }
    }
    error("Invalid pairing operation")
  }

  private val revisionLock = Any()
  private var generation = 0L
  val revision: Long get() = synchronized(revisionLock) { generation }
  private fun invalidate() { synchronized(revisionLock) { generation++ } }
  fun withRevision(expected: Long, action: () -> Unit): Boolean = synchronized(revisionLock) {
    if (generation != expected) false else { action(); true }
  }
  private val resolvedKeys = mutableMapOf<String, String>()
  private val publicCache = mutableMapOf<String, String>()
  private val keyCache = mutableMapOf<String, String>()
  private data class TemporaryKey(val secret: String, val purpose: String)
  private val ephemeral = mutableMapOf<String, TemporaryKey>()
  private val random = SecureRandom()
  private val conversations = LinkedHashMap<String, ByteArray>()
  private fun randomBytes(size: Int) = ByteArray(size).also(random::nextBytes)
  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
  private fun bytes(value: String): ByteArray {
    require(value.matches(Regex("[a-fA-F0-9]{64}"))) { "Invalid key" }
    return ByteArray(32) { value.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
  }
  private fun pub(value: String): String = publicCache.getOrPut(value) { if (publicCache.size >= 128) publicCache.clear(); bytes(value).fill(0); hex(publicKeyBytes(value)) }
  private fun encode(value: Any): String = when (value) {
    is JSONObject -> value.toString()
    is JSONArray -> value.toString()
    else -> JSONArray().put(value).toString().let { it.substring(1, it.length - 1) }
  }.replace("\\/", "/")
  private fun b64(value: ByteArray) = Base64.encodeToString(value, Base64.NO_WRAP)
  private fun decode(value: String): ByteArray {
    require(value.length <= 24 * 1024 * 1024 && value.matches(Regex("[A-Za-z0-9+/]*={0,2}"))) { "Invalid payload" }
    return Base64.decode(value, Base64.NO_WRAP)
  }
  private fun hmac(key: ByteArray, data: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run {
    init(SecretKeySpec(key, "HmacSHA256")); doFinal(data)
  }
  private suspend fun cachedRead(key: String): String? {
    keyCache[key]?.let { return it }
    return read(key)?.also { keyCache[key] = it }
  }
  private fun clear() { resolvedKeys.clear(); keyCache.clear(); publicCache.clear(); conversations.values.forEach { it.fill(0) }; conversations.clear() }
  private suspend fun keys(account: String): List<JSONObject> {
    val raw = cachedRead("encryption_keys_$account") ?: return emptyList()
    val values = JSONArray(raw)
    val now = System.currentTimeMillis() / 1000
    val result = (0 until values.length()).map { index ->
      val value = values.get(index)
      if (value is String) {
        pub(value)
        JSONObject().put("privkey", value.lowercase()).put("createdAt", if (index == 0) now else JSONObject.NULL)
      } else {
        val record = value as JSONObject
        val secret = record.getString("privkey").lowercase(); pub(secret)
        val created = record.optLong("createdAt", 0)
        JSONObject().put("privkey", secret).put("createdAt", if (created > 0) created else if (index == 0) now else JSONObject.NULL)
      }
    }
    val normalized = encode(JSONArray(result))
    if (normalized != raw) {
      write("encryption_keys_$account", normalized)
      keyCache["encryption_keys_$account"] = normalized
    }
    return result
  }
  private fun metadata(account: String, stored: JSONObject): JSONObject {
    val pub = pub(stored.getString("privkey"))
    return JSONObject().put("pubkey", pub).put("createdAt", stored.optLong("createdAt", 0))
      .put("key", JSONObject().put("account", account).put("role", "messaging").put("pubkey", pub))
  }

  private suspend fun decryptMessaging(account: String, event: JSONObject?): JSONObject {
    val records = keys(account)
    val failed = JSONObject().put("status", "failed")
    if (event == null || !runCatching { verifyPairingEvent(event, 1059) }.getOrDefault(false)) return failed
    for (record in records) {
      try {
        val secret = record.getString("privkey")
        val outer = crypt(secret, event.getString("pubkey"), event.getString("content"), "nip44", "decrypt", false)
        val seal = JSONObject(outer)
        if (!verifyPairingEvent(seal, 13)) continue
        val tags = seal.getJSONArray("tags")
        val tag = (0 until tags.length()).map { tags.getJSONArray(it) }.firstOrNull { it.optString(0) == "n" }
          ?: return JSONObject().put("status", "unsupported").put("reason", "missing-encryption-key-tag")
        val peer = tag.getString(1)
        val rumor = crypt(secret, peer, seal.getString("content"), "nip44", "decrypt")
        return JSONObject().put("status", "decrypted").put("seal", seal).put("rumorJson", rumor).put("senderEncryptionPubkey", peer)
      } catch (_: Exception) { /* Try the next retained key for malformed or unrelated ciphertext. */ }
    }
    return failed
  }
  private suspend fun add(account: String, secret: String, created: Long): JSONObject {
    pub(secret)
    val records = keys(account)
    val old = records.firstOrNull { it.getString("privkey") == secret.lowercase() }
    val record = JSONObject().put("privkey", secret.lowercase()).put("createdAt", old?.optLong("createdAt", 0)?.takeIf { it > 0 } ?: created)
    write("encryption_keys_$account", encode(JSONArray((listOf(record) + records.filter { it.getString("privkey") != secret.lowercase() }).take(10))))
    clear(); return metadata(account, record)
  }
  private suspend fun key(ref: JSONObject): String {
    val account = ref.getString("account"); bytes(account).fill(0)
    val role = ref.getString("role")
    val id = account + ":" + role + ":" + ref.optString("pubkey", "")
    resolvedKeys[id]?.let { return it }
    val secret = when (role) {
      "proximity" -> cachedRead("proximity_identity_privkey_$account")
      "ephemeral" -> ephemeral[account]?.secret
      "identity" -> cachedRead("identity_privkey_$account")
      "nip46-client" -> cachedRead("nip46_client_privkey_$account")
      "messaging" -> keys(account).firstOrNull { pub(it.getString("privkey")) == ref.getString("pubkey") }?.getString("privkey")
      else -> error("Invalid key role")
    } ?: error("Key not found")
    if (role == "identity") require(pub(secret) == account)
    if (role == "proximity" && ref.has("pubkey")) require(pub(secret) == ref.getString("pubkey"))
    if (role != "ephemeral") resolvedKeys[id] = secret
    return secret
  }
  private fun conversation(secret: String, peer: String, cache: Boolean): ByteArray {
    bytes(peer).fill(0)
    val id = pub(secret) + ":" + peer
    if (cache) conversations[id]?.let { return it }
    val shared = sharedX(secret, peer)
    val result = try { hmac("nip44-v2".toByteArray(Charsets.UTF_8), shared) } finally { shared.fill(0) }
    if (cache) {
      if (conversations.size >= 256) {
        val oldest = conversations.keys.first(); conversations.remove(oldest)?.fill(0)
      }
      conversations[id] = result
    }
    return result
  }
  private fun expanded(conversation: ByteArray, nonce: ByteArray): ByteArray {
    var previous = byteArrayOf(); var result = byteArrayOf()
    for (counter in 1..3) { previous = hmac(conversation, previous + nonce + byteArrayOf(counter.toByte())); result += previous }
    return result.copyOf(76).also { result.fill(0); previous.fill(0) }
  }
  private fun paddedLength(size: Int): Int {
    if (size <= 32) return 32
    var next = 1; while (next < size) next *= 2
    val chunk = if (next <= 256) 32 else next / 8
    return chunk * ((size - 1) / chunk + 1)
  }
  private fun crypt(secret: String, peer: String, text: String, algorithm: String, operation: String, cache: Boolean = true): String {
    require(operation == "encrypt" || operation == "decrypt")
    if (algorithm == "nip04") {
      val shared = sharedX(secret, peer)
      try {
        val parts = if (operation == "decrypt") text.split("?iv=") else emptyList()
        require(operation != "decrypt" || parts.size == 2)
        val iv = if (operation == "encrypt") randomBytes(16) else decode(parts[1])
        require(iv.size == 16)
        val input = if (operation == "encrypt") text.toByteArray(Charsets.UTF_8) else decode(parts[0])
        val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
        cipher.init(if (operation == "encrypt") Cipher.ENCRYPT_MODE else Cipher.DECRYPT_MODE, SecretKeySpec(shared, "AES"), IvParameterSpec(iv))
        val result = cipher.doFinal(input)
        return if (operation == "encrypt") b64(result) + "?iv=" + b64(iv) else result.toString(Charsets.UTF_8)
      } finally { shared.fill(0) }
    }
    require(algorithm == "nip44")
    val conversation = conversation(secret, peer, cache)
    try {
      if (operation == "encrypt") {
        val input = text.toByteArray(Charsets.UTF_8)
        require(input.isNotEmpty() && input.size <= 16 * 1024 * 1024)
        val prefix = if (input.size >= 65536) 6 else 2
        val padded = ByteArray(prefix + paddedLength(input.size))
        if (prefix == 2) { padded[0] = (input.size ushr 8).toByte(); padded[1] = input.size.toByte() }
        else for (i in 0..3) padded[2 + i] = (input.size ushr (24 - i * 8)).toByte()
        input.copyInto(padded, prefix)
        val nonce = randomBytes(32); val keys = expanded(conversation, nonce)
        try {
          val ciphertext = chacha(keys.copyOfRange(0, 32), keys.copyOfRange(32, 44), padded)
          return b64(byteArrayOf(2) + nonce + ciphertext + hmac(keys.copyOfRange(44, 76), nonce + ciphertext))
        } finally { keys.fill(0); padded.fill(0) }
      }
      val payload = decode(text); require(payload.size >= 99 && payload[0] == 2.toByte())
      val nonce = payload.copyOfRange(1, 33); val ciphertext = payload.copyOfRange(33, payload.size - 32)
      val keys = expanded(conversation, nonce)
      try {
        val expected = hmac(keys.copyOfRange(44, 76), nonce + ciphertext)
        require(MessageDigest.isEqual(expected, payload.copyOfRange(payload.size - 32, payload.size)))
        val padded = chacha(keys.copyOfRange(0, 32), keys.copyOfRange(32, 44), ciphertext)
        try {
          require(padded.size >= 2)
          var length = (padded[0].toInt() and 255) * 256 + (padded[1].toInt() and 255); var prefix = 2
          if (length == 0) {
            require(padded.size >= 6); prefix = 6
            for (i in 2..5) length = length * 256 + (padded[i].toInt() and 255)
            require(length >= 65536)
          }
          require(length in 1..16 * 1024 * 1024 && padded.size == prefix + paddedLength(length) && prefix + length <= padded.size)
          return padded.copyOfRange(prefix, prefix + length).toString(Charsets.UTF_8)
        } finally { padded.fill(0) }
      } finally { keys.fill(0) }
    } finally { if (!cache) conversation.fill(0) }
  }
  private fun sign(secret: String, template: JSONObject): JSONObject {
    val pub = pub(secret); val kind = template.getLong("kind"); val created = template.getLong("created_at")
    require(kind >= 0 && created >= 0 && kind <= 9007199254740991L && created <= 9007199254740991L)
    val tags = template.getJSONArray("tags")
    for (i in 0 until tags.length()) { val tag = tags.getJSONArray(i); for (j in 0 until tag.length()) require(tag.get(j) is String) }
    val content = template.getString("content")
    val canonical = encode(JSONArray().put(0).put(pub).put(created).put(kind).put(tags).put(content))
    val digest = hex(MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(Charsets.UTF_8)))
    return JSONObject().put("id", digest).put("pubkey", pub).put("created_at", created).put("kind", kind)
      .put("tags", tags).put("content", content).put("sig", hex(signBytes(secret, digest, randomBytes(32))))
  }
  private data class WalletPending(val account: String, val walletId: String, val method: String, val expires: Long)
  private val walletPending = mutableMapOf<String, WalletPending>()
  private fun walletName(account: String, id: String): String {
    bytes(account).fill(0); require(Regex("^[A-Za-z0-9_-]{1,256}$").matches(id)); return "wallet_credential_${account}_$id"
  }
  private fun walletLegacyName(account: String, id: String) = "psstpsst.nwc.${account.take(16)}.$id"
  private fun walletRelays(values: List<String>): List<String> {
    require(values.isNotEmpty() && values.size <= 32)
    return values.map { text ->
      val uri = java.net.URI(text); val scheme = when (uri.scheme?.lowercase()) { "https" -> "wss"; "http" -> "ws"; else -> uri.scheme?.lowercase() }
      require(scheme in listOf("ws", "wss") && uri.host != null && uri.userInfo == null)
      val host = uri.host.lowercase()
      val port = if (uri.port < 0 || scheme == "ws" && uri.port == 80 || scheme == "wss" && uri.port == 443) "" else ":${uri.port}"
      val path = (uri.rawPath ?: "").replace(Regex("/+"), "/").removeSuffix("/").ifEmpty { "/" }
      val query = uri.rawQuery?.takeIf { it.isNotEmpty() }?.split("&")?.filter { it.isNotEmpty() }?.map { item ->
        val parts = item.split("=", limit = 2)
        java.net.URLDecoder.decode(parts[0], "UTF-8") to java.net.URLDecoder.decode(parts.getOrElse(1) { "" }, "UTF-8")
      }?.sortedBy { it.first }?.joinToString("&") { java.net.URLEncoder.encode(it.first, "UTF-8") + "=" + java.net.URLEncoder.encode(it.second, "UTF-8") }
      "$scheme://$host$port$path" + if (query.isNullOrEmpty()) "" else "?$query"
    }.distinct()
  }
  private suspend fun walletCredential(account: String, id: String): JSONObject {
    val record = JSONObject(read(walletName(account, id)) ?: error("Wallet credential requires binding"))
    bytes(record.getString("secret")).fill(0); bytes(record.getString("peer")).fill(0); return record
  }
  suspend fun walletHasPin(account: String): Boolean { bytes(account).fill(0); return read("psstpsst.wallet.pin.$account") != null }
  suspend fun walletSetPin(account: String, pin: String) {
    require(Regex("^[0-9]{6}$").matches(pin) && !walletHasPin(account))
    val salt = hex(randomBytes(32)); val digest = pinDigestBytes(pin, salt)
    try { write("psstpsst.wallet.pin.$account", encode(JSONObject().put("version", 1).put("salt", salt).put("digest", hex(digest)))) }
    finally { digest.fill(0) }
  }
  suspend fun walletVerifyPin(account: String, pin: String): Boolean {
    bytes(account).fill(0); val now = System.currentTimeMillis()
    if (!Regex("^[0-9]{6}$").matches(pin)) return false
    val record = JSONObject(read("psstpsst.wallet.pin.$account") ?: return false)
    require(record.getInt("version") == 1 && record.getString("salt").length <= 256)
    if (record.optLong("retryAtMs", 0) > now) return false
    val expected = bytes(record.getString("digest")); val actual = pinDigestBytes(pin, record.getString("salt"))
    var difference = 0
    try { for (i in 0 until 32) difference = difference or (expected[i].toInt() xor actual[i].toInt()) }
    finally { expected.fill(0); actual.fill(0) }
    val attempts = if (difference == 0) 0 else minOf(32, record.optInt("failures", 0) + 1)
    record.put("failures", attempts).put("retryAtMs", if (difference == 0) 0L else now + minOf(30000L, 1000L * (1 shl minOf(5, attempts - 1))))
    write("psstpsst.wallet.pin.$account", encode(record))
    if (difference == 0) return true
    return false
  }
  suspend fun walletBound(account: String, id: String) = read(walletName(account, id)) != null
  private fun walletPaymentAmount(invoice: String): String {
    val match = Regex("^ln(?:bcrt|bc|tb)([0-9]+)([munp]?)1[023456789acdefghjklmnpqrstuvwxyz]+$").matchEntire(invoice) ?: error("Invalid payment invoice")
    require(match.groupValues[1].length <= 18)
    val digits = java.math.BigInteger(match.groupValues[1]); val suffix = match.groupValues[2]
    val multiplier = mapOf("" to "100000000000", "m" to "100000000", "u" to "100000", "n" to "100", "p" to "1")[suffix]!!
    if (suffix == "p") require(digits.mod(java.math.BigInteger.TEN) == java.math.BigInteger.ZERO)
    val msat = if (suffix == "p") digits.divide(java.math.BigInteger.TEN) else digits.multiply(java.math.BigInteger(multiplier))
    require(msat.signum() > 0 && msat <= java.math.BigInteger("2100000000000000000"))
    return java.math.BigDecimal(msat).movePointLeft(3).stripTrailingZeros().toPlainString()
  }
  suspend fun walletPaymentDetails(c: JSONObject): JSONObject {
    val record = walletCredential(c.getString("account"), c.getString("walletId"))
    require(c.getString("operation") == "pay_invoice")
    val params = c.getJSONObject("params")
    require(params.keys().asSequence().all { it in listOf("invoice", "metadata") } && (!params.has("metadata") || params.opt("metadata") is JSONObject))
    val invoice = params.getString("invoice"); require(invoice.length <= 30000)
    return JSONObject().put("peer", record.getString("peer")).put("invoice", invoice).put("amountSats", walletPaymentAmount(invoice))
  }
  suspend fun executeTrustedWallet(serialized: String): String {
    val c = JSONObject(serialized)
    require(c.getString("method") == "walletBindLegacy" || (c.getString("method") == "walletRequest" && c.getString("operation") == "pay_invoice"))
    return encode(walletCommand(c, true))
  }
  private suspend fun walletCommand(c: JSONObject, trusted: Boolean = false): Any {
    val account = c.getString("account"); bytes(account).fill(0); val method = c.getString("method")
    if (method in listOf("walletImport", "walletBindLegacy", "walletRemove", "walletRemovePin")) invalidate()
    if (method == "walletImport") {
      val text = c.getString("connectionString").trim(); require(text.length <= 32768)
      val uri = android.net.Uri.parse(text); require(uri.scheme?.lowercase() == "nostr+walletconnect")
      val peer = uri.host?.lowercase() ?: error("Invalid wallet connection"); bytes(peer).fill(0)
      val secret = uri.getQueryParameter("secret") ?: error("Invalid wallet connection"); pub(secret)
      val relays = walletRelays(uri.getQueryParameters("relay"))
      val id = "nwc_" + java.util.UUID.randomUUID().toString().replace("-", "")
      write(walletName(account, id), encode(JSONObject().put("secret", secret).put("peer", peer).put("relays", JSONArray(relays))))
      return JSONObject().put("id", id).put("walletPubkey", peer).put("relays", JSONArray(relays))
    }
    if (method == "walletRemovePin") { remove("psstpsst.wallet.pin.$account"); return JSONObject.NULL }
    val id = c.getString("walletId"); val name = walletName(account, id)
    if (method == "walletBindLegacy") {
      require(trusted); if (walletBound(account, id)) return JSONObject.NULL
      val peer = c.getString("peer").lowercase(); bytes(peer).fill(0)
      val secret = read(walletLegacyName(account, id)) ?: error("Missing wallet credential"); pub(secret)
      val values = c.getJSONArray("relays"); val relays = walletRelays((0 until values.length()).map { values.getString(it) })
      write(name, encode(JSONObject().put("secret", secret).put("peer", peer).put("relays", JSONArray(relays))))
      remove(walletLegacyName(account, id)); return JSONObject.NULL
    }
    if (method == "walletRemove") {
      remove(name); remove(walletLegacyName(account, id)); walletPending.entries.removeAll { it.value.account == account && it.value.walletId == id }; return JSONObject.NULL
    }
    val record = walletCredential(account, id); val secret = record.getString("secret"); val peer = record.getString("peer")
    val relayValues = record.getJSONArray("relays"); val relays = (0 until relayValues.length()).map { relayValues.getString(it) }
    val now = System.currentTimeMillis()
    if (method == "walletRequest") {
      val operation = c.getString("operation")
      require(operation in listOf("get_info", "get_balance", "list_transactions", "make_invoice", "lookup_invoice", "pay_invoice") && (operation != "pay_invoice" || trusted))
      if (operation == "pay_invoice") walletPaymentDetails(c)
      walletPending.entries.removeAll { it.value.expires < now }; require(walletPending.size < 128)
      val content = crypt(secret, peer, encode(JSONObject().put("method", operation).put("params", c.getJSONObject("params"))), "nip04", "encrypt", false)
      val event = sign(secret, JSONObject().put("kind", 23194).put("created_at", now / 1000).put("content", content).put("tags", JSONArray().put(JSONArray().put("p").put(peer))))
      walletPending[event.getString("id")] = WalletPending(account, id, operation, now + 60000)
      return JSONObject().put("event", event).put("peer", peer).put("relays", JSONArray(relays))
    }
    if (method == "walletReceive") {
      val request = c.getString("requestId"); val pending = walletPending[request] ?: return JSONObject.NULL
      val event = c.getJSONObject("event"); val tags = event.getJSONArray("tags")
      if (pending.account != account || pending.walletId != id || pending.expires < now || event.getString("pubkey") != peer || !verifyPairingEvent(event, 23195)
        || !(0 until tags.length()).any { val tag = tags.getJSONArray(it); tag.length() >= 2 && tag.getString(0) == "e" && tag.getString(1) == request }) return JSONObject.NULL
      val response = JSONObject(crypt(secret, peer, event.getString("content"), "nip04", "decrypt", false))
      if (response.optString("result_type") != pending.method || (!response.has("result") && !response.has("error")) || response.has("method") || response.has("params")) return JSONObject.NULL
      walletPending.remove(request); return response
    }
    if (method == "walletRelayAuth") {
      val template = c.getJSONObject("template"); val tags = template.getJSONArray("tags")
      require(template.getInt("kind") == 22242 && template.getString("content") == "" && tags.length() == 2)
      val values = (0 until tags.length()).map { tags.getJSONArray(it) }
      require(values.any { it.length() == 2 && it.getString(0) == "challenge" }
        && values.any { it.length() == 2 && it.getString(0) == "relay" && relays.contains(walletRelays(listOf(it.getString(1)))[0]) })
      return sign(secret, template)
    }
    error("Invalid wallet operation")
  }

  private fun decodeNsec(input: String): String {
    require(input == input.lowercase() || input == input.uppercase())
    val value = input.lowercase()
    require(value.length == 63 && value.startsWith("nsec1"))
    val alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
    val words = value.drop(5).map { alphabet.indexOf(it).also { index -> require(index >= 0) } }
    val generators = intArrayOf(0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3)
    var checksum = 1
    for (word in listOf(3, 3, 3, 3, 0, 14, 19, 5, 3) + words) {
      val top = checksum ushr 25; checksum = ((checksum and 0x1ffffff) shl 5) xor word
      for (i in 0..4) if (((top ushr i) and 1) != 0) checksum = checksum xor generators[i]
    }
    require(checksum == 1)
    val result = mutableListOf<Byte>(); var accumulator = 0; var bits = 0
    for (word in words.dropLast(6)) {
      accumulator = ((accumulator shl 5) or word) and 4095; bits += 5
      if (bits >= 8) { bits -= 8; result.add(((accumulator ushr bits) and 255).toByte()) }
    }
    require(result.size == 32 && bits < 5 && (accumulator and ((1 shl bits) - 1)) == 0)
    val bytes = result.toByteArray()
    return try { hex(bytes) } finally { bytes.fill(0); result.fill(0) }
  }
  /** Only trusted native input calls this operation. */
  suspend fun importIdentity(nsec: String): String {
    invalidate()
    val secret = decodeNsec(nsec); val pub = pub(secret)
    write("identity_privkey_$pub", secret); clear()
    return encode(JSONObject().put("pubkey", pub))
  }
  suspend fun execute(serialized: String): String {
    val c = JSONObject(serialized)
    val method = c.getString("method")
    if (method == "migrateStorage") {
      invalidate()
      val accounts = c.getJSONArray("accounts"); val wallets = c.getJSONArray("wallets")
      for (i in 0 until accounts.length()) { val account = accounts.getString(i); bytes(account).fill(0); keys(account) }
      val bunkers = c.optJSONArray("bunkers") ?: JSONArray()
      for (i in 0 until bunkers.length()) {
        val bunker = bunkers.getJSONObject(i); val account = bunker.getString("account"); val peer = bunker.getString("peer")
        if (!isBunkerBound(account, peer)) bindBunker(account, peer)
      }
      for (i in 0 until wallets.length()) {
        val wallet = wallets.getJSONObject(i); val account = wallet.getString("account"); bytes(account).fill(0)
        val id = wallet.getString("walletId")
        if (walletBound(account, id)) { remove("psstpsst.nwc.${account.take(16)}.$id"); continue }
        if (read("psstpsst.nwc.${account.take(16)}.$id") == null) continue
        wallet.put("method", "walletBindLegacy"); walletCommand(wallet, true)
      }
      return "null"
    }
    if (method.startsWith("wallet")) return encode(walletCommand(c))
    if (method in listOf("removeProximity", "persistIdentity", "releaseEphemeral", "commitBunkerPairing", "migrateBunkerSecret", "removeIdentity", "removeBunker", "removeMessaging", "generateMessaging", "importTransfer", "endSession")) invalidate()
     val account = c.optString("account", "")
    if (account.isNotEmpty()) bytes(account).fill(0)
    if (method in listOf("beginBunkerPairing", "bunkerPairingRequest", "bunkerPairingReceive", "commitBunkerPairing", "cancelBunkerPairing")) return encode(pairing(c))
    val result: Any = when (method) {
      "endSession" -> { clear(); JSONObject.NULL }
      "ensureProximity" -> {
        bytes(account).fill(0)
        val name = "proximity_identity_privkey_$account"
        val secret = read(name) ?: hex(randomBytes(32)).also { write(name, it) }
        JSONObject().put("pubkey", pub(secret)).put("key", JSONObject().put("account", account).put("role", "proximity"))
      }
      "removeProximity" -> { remove("proximity_identity_privkey_$account"); clear(); JSONObject.NULL }
      "bindProximityNoise" -> {
        val secret = key(JSONObject().put("account", account).put("role", "proximity"))
        val noise = bytes(c.getString("noisePubkey"))
        val digest = MessageDigest.getInstance("SHA-256").digest("PsstPsst Nearby Noise Binding/1".toByteArray(Charsets.UTF_8) + bytes(pub(secret)) + noise)
        hex(signBytes(secret, hex(digest), randomBytes(32)))
      }
      "generateEphemeral" -> {
        require(ephemeral.size < 64)
        val secret = hex(randomBytes(32)); val pub = pub(secret)
        val purpose = c.getString("purpose"); require(purpose == "account" || purpose == "key-sync")
        ephemeral[pub] = TemporaryKey(secret, purpose)
        JSONObject().put("pubkey", pub).put("createdAt", System.currentTimeMillis() / 1000).put("key", JSONObject().put("account", pub).put("role", "ephemeral"))
      }
      "releaseEphemeral" -> { ephemeral.remove(account); JSONObject.NULL }
      "persistIdentity" -> {
        val entry = ephemeral[account]
        if (entry == null) {
          val saved = read("identity_privkey_$account") ?: error("Key session ended")
          require(pub(saved) == account); JSONObject.NULL
        } else {
          require(entry.purpose == "account")
          write("identity_privkey_$account", entry.secret); ephemeral.remove(account); JSONObject.NULL
        }
      }
      "migrateBunkerSecret" -> {
        val peer = c.getString("peer"); bytes(peer).fill(0)
        if (read("nip46_bunker_secret_$account") == null && !c.isNull("secret")) {
          val existing = read("nip46_bunker_binding_$account"); require(existing == null || existing == peer)
          write("nip46_bunker_secret_$account", c.getString("secret")); write("nip46_bunker_binding_$account", peer); clear()
        }
        JSONObject.NULL
      }
      "removeBunker" -> {
        listOf("nip46_client_privkey_", "nip46_bunker_secret_", "nip46_bunker_binding_").forEach { remove(it + account) }; clear(); JSONObject.NULL
      }
      "removeIdentity", "removeMessaging" -> {
        remove((if (method == "removeIdentity") "identity_privkey_" else "encryption_keys_") + account); clear(); JSONObject.NULL
      }
      "publicKey" -> pub(key(c.getJSONObject("key")))
      "signEvent" -> { require(c.getJSONObject("key").getString("role") in listOf("identity", "proximity")); sign(key(c.getJSONObject("key")), c.getJSONObject("template")) }
      "crypto" -> {
        val ref = c.getJSONObject("key"); val algorithm = c.getString("algorithm"); val operation = c.getString("operation")
        require(ref.getString("role") != "ephemeral")
        require(ref.getString("role") != "messaging" || operation != "decrypt")
        val isClient = ref.getString("role") == "nip46-client"
        require(!isClient || (algorithm == "nip44" && operation == "decrypt"))
        val result = crypt(key(ref), c.getString("peer"), c.getString("text"), algorithm, operation, c.optBoolean("cache", true))
        if (isClient) {
          val response = JSONObject(result)
          require(!response.has("method") && !response.has("params") && response.opt("id") is String && (response.opt("result") is String || response.opt("error") is String))
        }
        result
      }
      "decryptMessaging" -> decryptMessaging(account, c.optJSONObject("event"))
      "getCurrentMessagingKey" -> keys(account).firstOrNull()?.let { metadata(account, it) } ?: JSONObject.NULL
      "hasMessagingKey" -> {
        val requested = c.optString("pubkey", "")
        Regex("^[0-9a-fA-F]{64}$").matches(requested) && keys(account).any { pub(it.getString("privkey")) == requested.lowercase() }
      }
      "generateMessaging" -> add(account, hex(randomBytes(32)), System.currentTimeMillis() / 1000)
      "exportTransfer" -> {
        val records = keys(account); val requested = if (c.isNull("pubkey")) null else c.getString("pubkey")
        val selected = records.firstOrNull { requested == null || pub(it.getString("privkey")) == requested } ?: error("Key not found")
        val ephemeral = hex(randomBytes(32))
        JSONObject().put("senderPubkey", pub(ephemeral)).put("content", crypt(ephemeral, c.getString("recipient"), selected.getString("privkey"), "nip44", "encrypt", false))
      }
      "importTransfer" -> {
        val client = c.getJSONObject("client")
        require(client.getString("role") == "ephemeral" && ephemeral[client.getString("account")]?.purpose == "key-sync")
        try {
          val secret = crypt(key(c.getJSONObject("client")), c.getString("sender"), c.getString("ciphertext"), "nip44", "decrypt", false)
          val pub = pub(secret)
          if (!c.isNull("expectedPubkey") && pub != c.getString("expectedPubkey")) false
          else { add(account, secret, c.getLong("createdAt")); true }
        } catch (_: Exception) { false }
      }
      "bunkerRequest" -> {
        val peer = c.getString("peer"); require(isBunkerBound(account, peer)); val operation = c.getString("operation")
        val secret = key(JSONObject().put("account", account).put("role", "nip46-client"))
        val params = if (operation == "connect") JSONArray().put(peer).put(read("nip46_bunker_secret_$account") ?: "") else c.getJSONArray("params")
        val text = encode(JSONObject().put("id", c.getString("id")).put("method", operation).put("params", params))
        sign(secret, JSONObject().put("kind", 24133).put("created_at", System.currentTimeMillis() / 1000).put("tags", JSONArray().put(JSONArray().put("p").put(peer))).put("content", crypt(secret, peer, text, "nip44", "encrypt")))
      }
      else -> error("Unknown vault operation")
    }
    return encode(result)
  }
  suspend fun isBunkerBound(account: String, peer: String): Boolean {
    bytes(account).fill(0); bytes(peer).fill(0)
    return cachedRead("nip46_bunker_binding_$account") == peer
  }
  suspend fun bindBunker(account: String, peer: String) {
    invalidate()
    bytes(account).fill(0); bytes(peer).fill(0)
    val existing = cachedRead("nip46_bunker_binding_$account")
    require(existing == null || existing == peer)
    write("nip46_bunker_binding_$account", peer); keyCache.remove("nip46_bunker_binding_$account")
  }
  /** Native confirmation is required by the sole caller; this never returns to JS. */

  suspend fun backup(account: String): String? {
    bytes(account).fill(0)
    val secret = read("identity_privkey_$account") ?: ephemeral[account]?.takeIf { it.purpose == "account" }?.secret ?: return null
    val data = bytes(secret)
    try {
      val words = mutableListOf<Int>(); var accumulator = 0; var bits = 0
      for (byte in data) {
        accumulator = ((accumulator shl 8) or (byte.toInt() and 255)) and 4095; bits += 8
        while (bits >= 5) { bits -= 5; words.add((accumulator ushr bits) and 31) }
      }
      if (bits > 0) words.add((accumulator shl (5 - bits)) and 31)
      var checksum = 1
      val generators = intArrayOf(0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3)
      for (value in listOf(3, 3, 3, 3, 0, 14, 19, 5, 3) + words + List(6) { 0 }) {
        val top = checksum ushr 25; checksum = ((checksum and 0x1ffffff) shl 5) xor value
        for (i in 0..4) if (((top ushr i) and 1) != 0) checksum = checksum xor generators[i]
      }
      checksum = checksum xor 1
      for (i in 0..5) words.add((checksum ushr (5 * (5 - i))) and 31)
      val alphabet = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
      return "nsec1" + words.map { alphabet[it] }.joinToString("")
    } finally { data.fill(0) }
  }
}

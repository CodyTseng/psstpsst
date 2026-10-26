package chat.psstpsst.app.cryptoaccelerator

import expo.modules.securestore.SecureStoreModule
import expo.modules.securestore.SecureStoreOptions
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.security.MessageDigest
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Native-only ciphertext format and Keystore alias, disjoint from Expo SecureStore. */
class NativeVaultStorage(context: Context) {
  private val directory = File(context.noBackupFilesDir, "psst_native_vault_v1").apply { check(mkdirs() || isDirectory) }
  private fun entry(name: String) = AtomicFile(File(directory, MessageDigest.getInstance("SHA-256")
    .digest(name.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }))
  private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  /** Migrate every owned legacy record before permitting vault work, including inactive accounts. */
  suspend fun migrateLegacy(legacy: SecureStoreModule) = MIGRATION_MUTEX.withLock {
    if (migrated) return@withLock
    val owned = Regex("^(identity_privkey_|encryption_keys_|nip46_client_privkey_|nip46_bunker_secret_|nip46_bunker_binding_|proximity_identity_privkey_|proximity_identity_noise_privkey_)[0-9a-fA-F]{64}$")
    val completed = read(MIGRATION_MARKER) != null
    val walletsCompleted = read("__wallet_migration_v1") != null
    val walletNames = Regex("^psstpsst\\.(nwc\\.[0-9a-fA-F]{16}\\.[A-Za-z0-9_-]{1,256}|wallet\\.pin\\.[0-9a-fA-F]{64})$")
    val names = legacy.getSharedPreferences().all.keys.map { it.removePrefix("key_v1-") }.filter { owned.matches(it) || walletNames.matches(it) }.distinct()
    for (name in names) {
      val alreadyMigrated = if (walletNames.matches(name)) walletsCompleted else completed
      if (!alreadyMigrated && read(name) == null) legacy.getItemImpl(name, SecureStoreOptions())?.let { write(name, it) }
      legacy.deleteItemImpl(name, SecureStoreOptions())
    }
    if (!completed) write(MIGRATION_MARKER, "complete")
    if (!walletsCompleted) write("__wallet_migration_v1", "complete")
    migrated = true
  }

  private fun key(create: Boolean): SecretKey = synchronized(KEY_LOCK) {
    (keyStore.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    check(create) { "Vault encryption key unavailable" }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
      init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256).setRandomizedEncryptionRequired(true).build())
      generateKey()
    }
  }

  @Synchronized
  fun read(name: String): String? {
    val entry = entry(name)
    if (!entry.baseFile.exists()) return null
    val bytes = entry.readFully()
    check(bytes.size >= 28) { "Invalid vault ciphertext" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(false), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
    cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
    val plaintext = cipher.doFinal(bytes, 12, bytes.size - 12)
    return try { plaintext.toString(Charsets.UTF_8) } finally { plaintext.fill(0) }
  }

  @Synchronized
  fun write(name: String, value: String) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key(true))
    cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
    val plaintext = value.toByteArray(Charsets.UTF_8)
    val ciphertext = try { cipher.iv + cipher.doFinal(plaintext) } finally { plaintext.fill(0) }
    val entry = entry(name)
    val output = entry.startWrite()
    try {
      output.write(ciphertext)
      entry.finishWrite(output)
    } catch (error: Exception) { entry.failWrite(output); throw error }
  }

  @Synchronized
  fun remove(name: String) { val entry = entry(name); entry.delete(); check(!entry.baseFile.exists()) { "Vault deletion failed" } }

  companion object {
    // SecureStore aliases start with their cipher name; JS cannot select this alias.
    private const val MIGRATION_MARKER = "__legacy_migration_v1"
    private val MIGRATION_MUTEX = Mutex()
    private var migrated = false
    private val KEY_LOCK = Any()
    private const val ALIAS = "chat.psstpsst.native-vault.v1"
  }
}

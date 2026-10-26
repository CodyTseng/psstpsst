package chat.psstpsst.app.cryptoaccelerator

import android.app.KeyguardManager
import android.widget.EditText
import android.widget.LinearLayout
import android.text.InputType
import android.text.InputFilter
import androidx.fragment.app.FragmentActivity
import androidx.biometric.BiometricPrompt
import androidx.biometric.BiometricManager
import androidx.core.content.ContextCompat
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
import expo.modules.kotlin.functions.Coroutine
import expo.modules.securestore.SecureStoreModule
import expo.modules.securestore.SecureStoreOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import kotlin.coroutines.resume
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class ExpoCryptoAcceleratorModule : Module() {
  private val vaultMutex = Mutex()
  private val store by lazy { appContext.registry.getModule<SecureStoreModule>() ?: error("Secure storage unavailable") }
  private val storage by lazy { NativeVaultStorage(appContext.reactContext ?: error("Vault context unavailable")) }
  private val vault by lazy {
    NativeKeyVault(
      read = { key ->
        storage.migrateLegacy(store)
        // Once migration commits, generic storage can never inject another vault key.
        store.deleteItemImpl(key, SecureStoreOptions())
        storage.read(key)
      },
      write = { key, value ->
        storage.migrateLegacy(store)
        storage.write(key, value)
        store.deleteItemImpl(key, SecureStoreOptions())
      },
      remove = { key ->
        storage.migrateLegacy(store)
        store.deleteItemImpl(key, SecureStoreOptions())
        storage.remove(key)
      },
      publicKeyBytes = ::vaultPublicNative,
      signBytes = ::vaultSignNative,
      pinDigestBytes = ::pinDigestNative,
      verifyBytes = ::verifySchnorrNative,
      sharedX = ::deriveSharedXNative,
      chacha = ::vaultChaChaNative,
    )
  }

  private val walletInputMutex = Mutex()
  private fun walletCopy(selection: JSONObject): Pair<JSONObject, String> {
    val context = appContext.reactContext ?: error("Wallet confirmation unavailable")
    val catalog = JSONObject(context.resources.openRawResource(R.raw.psst_vault_consent).bufferedReader(Charsets.UTF_8).use { it.readText() })
    val language = selection.optString("language", context.resources.configuration.locales[0].toLanguageTag())
    val locale = catalog.optJSONObject(language) ?: catalog.optJSONObject(language.substringBefore('-')) ?: catalog.getJSONObject("en")
    return locale.getJSONObject("wallet") to locale.getString("cancel")
  }
  /** Native fields and system authentication never return a PIN or approval token to JS. */
  private suspend fun walletAuthenticate(account: String, selection: JSONObject, details: JSONObject? = null): Boolean {
    if (!walletInputMutex.tryLock()) return false
    try {
      val hasPin = withContext(Dispatchers.IO) { vaultMutex.withLock { storage.migrateLegacy(store); vault.walletHasPin(account) } }
      val context = appContext.reactContext ?: return false
      val system = (context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isDeviceSecure
      if (details == null && (system || hasPin)) return true
      val (copy, cancel) = walletCopy(selection)
      val detailText = details?.let { it.getString("amountSats") + " " + copy.getString("sats_unit") + "\n\n" + it.getString("peer") + "\n\n" + it.getString("invoice") } ?: ""
      if (system) {
        val approved = withContext(Dispatchers.Main) { suspendCancellableCoroutine<Boolean> { continuation ->
          val activity = appContext.currentActivity
          if (activity == null || activity.isFinishing) { continuation.resume(false); return@suspendCancellableCoroutine }
          val dialog = AlertDialog.Builder(activity).setTitle(copy.getString("confirm_payment")).setMessage(detailText)
            .setNegativeButton(cancel) { _, _ -> if (continuation.isActive) continuation.resume(false) }
            .setPositiveButton(copy.getString("pay")) { _, _ -> if (continuation.isActive) continuation.resume(true) }
            .setOnCancelListener { if (continuation.isActive) continuation.resume(false) }.create()
          continuation.invokeOnCancellation { activity.runOnUiThread { dialog.dismiss() } }; dialog.show()
        } }
        if (!approved) return false
        return withContext(Dispatchers.Main) { suspendCancellableCoroutine<Boolean> { continuation ->
          val activity = appContext.currentActivity as? FragmentActivity
          if (activity == null || activity.isFinishing) { continuation.resume(false); return@suspendCancellableCoroutine }
          val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { if (continuation.isActive) continuation.resume(true) }
            override fun onAuthenticationError(code: Int, message: CharSequence) { if (continuation.isActive) continuation.resume(false) }
          })
          continuation.invokeOnCancellation { activity.runOnUiThread { prompt.cancelAuthentication() } }
          prompt.authenticate(BiometricPrompt.PromptInfo.Builder().setTitle(copy.getString("auth_prompt"))
            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL).build())
        } }
      }
      val setup = !hasPin
      val entered = withContext(Dispatchers.Main) { suspendCancellableCoroutine<Pair<String, String>?> { continuation ->
        val activity = appContext.currentActivity
        if (activity == null || activity.isFinishing) { continuation.resume(null); return@suspendCancellableCoroutine }
        val fields = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        fun field(label: String) = EditText(activity).apply {
          hint = label; inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
          filters = arrayOf(InputFilter.LengthFilter(6)); fields.addView(this)
        }
        val pin = field(copy.getString("pin")); val repeated = if (setup) field(copy.getString("confirm_pin")) else null
        val dialog = AlertDialog.Builder(activity).setTitle(copy.getString(if (details == null) "save_pin" else "confirm_payment"))
          .setMessage(copy.getString(if (setup) "pin_setup_hint" else "pin_prompt") + "\n\n" + detailText).setView(fields)
          .setNegativeButton(cancel) { _, _ -> if (continuation.isActive) continuation.resume(null) }
          .setPositiveButton(copy.getString(if (details == null) "save_pin" else "pay")) { _, _ ->
            val candidate = pin.text.toString(); val confirmation = repeated?.text?.toString() ?: candidate
            pin.text.clear(); repeated?.text?.clear()
            if (continuation.isActive) continuation.resume(candidate to confirmation)
          }.setOnCancelListener { if (continuation.isActive) continuation.resume(null) }.create()
        continuation.invokeOnCancellation { activity.runOnUiThread { dialog.dismiss() } }; dialog.show()
      } } ?: return false
      if (entered.first != entered.second) return false
      return withContext(Dispatchers.IO) { vaultMutex.withLock {
        if (setup) { vault.walletSetPin(account, entered.first); true } else vault.walletVerifyPin(account, entered.first)
      } }
    } finally { walletInputMutex.unlock() }
  }

  override fun definition() = ModuleDefinition {
    Name("ExpoCryptoAccelerator")

    AsyncFunction("importIdentity") Coroutine { nsec: String ->
      try { withContext(Dispatchers.IO) { vaultMutex.withLock { storage.migrateLegacy(store); vault.importIdentity(nsec) } } }
      catch (_: Exception) { throw VaultException() }
    }

    AsyncFunction("securityStatus") Coroutine { ->
      try { withContext(Dispatchers.IO) { vaultMutex.withLock { storage.migrateLegacy(store) } }; "available" }
      catch (_: Exception) { throw VaultException() }
    }

    AsyncFunction("ensureWalletProtection") Coroutine { account: String, selection: String ->
      try { walletAuthenticate(account, JSONObject(selection)) } catch (_: Exception) { throw VaultException() }
    }

    AsyncFunction("vaultExecute") Coroutine { command: String ->
      try {
        val request = JSONObject(command)
        val revision = withContext(Dispatchers.IO) { vaultMutex.withLock { storage.migrateLegacy(store); vault.revision } }
        if (request.getString("method") == "walletRequest" && request.optString("operation") == "pay_invoice") {
          val account = request.getString("account")
          val selection = request.optJSONObject("confirmation") ?: JSONObject()
          val details = withContext(Dispatchers.IO) { vaultMutex.withLock { vault.walletPaymentDetails(request) } }
          if (!walletAuthenticate(account, selection, details)) throw IllegalStateException()
          if (vault.revision != revision) throw IllegalStateException()
          return@Coroutine withContext(Dispatchers.IO) { vaultMutex.withLock {
            if (vault.revision != revision) throw IllegalStateException()
            vault.executeTrustedWallet(command)
          } }
        }
        val bindingNeeded = request.getString("method") == "bunkerRequest" && !withContext(Dispatchers.IO) {
          vaultMutex.withLock { vault.isBunkerBound(request.getString("account"), request.getString("peer")) }
        }
        val confirmationNeeded = request.getString("method") == "exportTransfer" || bindingNeeded
        if (confirmationNeeded) {
          val recipient = request.getString(if (bindingNeeded) "peer" else "recipient"); require(recipient.length == 64)
          val detail = request.getString("account") + "\n\n" + recipient.take(4).uppercase() + " " + recipient.drop(4).take(4).uppercase() + "\n" + recipient
          if (!confirmVault(request.getJSONObject("confirmation"), detail, if (bindingNeeded) "bunker" else "transfer")) throw IllegalStateException()
        }
        withContext(Dispatchers.IO) { vaultMutex.withLock {
          if (confirmationNeeded && vault.revision != revision) throw IllegalStateException()
          if (bindingNeeded) vault.bindBunker(request.getString("account"), request.getString("peer"))
          vault.execute(command)
        } }
      } catch (_: Exception) { throw VaultException() }
    }

    AsyncFunction("backupIdentity") Coroutine { account: String, serialized: String ->
      val options = JSONObject(serialized)
      val revision = withContext(Dispatchers.IO) { vaultMutex.withLock { storage.migrateLegacy(store); vault.revision } }
      val approved = confirmVault(options, "", "backup")
      if (!approved || vault.revision != revision) return@Coroutine false
      val nsec = withContext(Dispatchers.IO) { vaultMutex.withLock { vault.backup(account) } } ?: throw VaultException()
      withContext(Dispatchers.Main) {
        val activity = appContext.currentActivity ?: return@withContext false
        if (activity.isFinishing) return@withContext false
        val clip = ClipData.newPlainText("", nsec)
        if (Build.VERSION.SDK_INT >= 33) clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
        vault.withRevision(revision) {
          (activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(clip)
        }
      }
    }

    AsyncFunction("getNip44ConversationKeyAsync") { privkeyHex: String, pubkeyHex: String ->
      val sharedX = try {
        deriveSharedXNative(privkeyHex, pubkeyHex)
      } catch (_: IllegalArgumentException) {
        throw InvalidKeyException()
      } catch (_: RuntimeException) {
        throw Secp256k1Exception()
      }
      hmacSha256("nip44-v2".toByteArray(Charsets.UTF_8), sharedX).toHex()
    }

    Function("verifySchnorr") { signatureHex: String, messageHex: String, pubkeyHex: String ->
      verifySchnorrNative(signatureHex, messageHex, pubkeyHex)
    }
  }

  private suspend fun confirmVault(selection: JSONObject, detail: String, operation: String): Boolean = withContext(Dispatchers.Main) {
        val context = appContext.reactContext ?: error("Vault confirmation unavailable")
        val catalog = JSONObject(context.resources.openRawResource(R.raw.psst_vault_consent).bufferedReader(Charsets.UTF_8).use { it.readText() })
        val language = selection.optString("language", context.resources.configuration.locales[0].toLanguageTag())
        val locale = catalog.optJSONObject(language) ?: catalog.optJSONObject(language.substringBefore('-')) ?: catalog.getJSONObject("en")
        val fields = locale.getJSONObject(operation)
        val options = JSONObject().put("title", fields.getString("title")).put("message", fields.getString("message"))
          .put("confirmLabel", fields.getString("confirm")).put("cancelLabel", locale.getString("cancel"))
        suspendCancellableCoroutine<Boolean> { continuation ->
          val activity = appContext.currentActivity
          if (activity == null || activity.isFinishing) { continuation.resume(false); return@suspendCancellableCoroutine }
          val dialog = AlertDialog.Builder(activity)
            .setTitle(options.getString("title"))
            .setMessage(options.getString("message") + if (detail.isEmpty()) "" else "\n\n$detail")
            .setNegativeButton(options.getString("cancelLabel")) { _, _ -> if (continuation.isActive) continuation.resume(false) }
            .setPositiveButton(options.getString("confirmLabel")) { _, _ -> if (continuation.isActive) continuation.resume(true) }
            .setOnCancelListener { if (continuation.isActive) continuation.resume(false) }.create()
          continuation.invokeOnCancellation { activity.runOnUiThread { dialog.dismiss() } }
          dialog.show()
        }
      }

  private external fun pinDigestNative(pin: String, salt: String): ByteArray
  private external fun vaultPublicNative(secret: String): ByteArray
  private external fun vaultSignNative(secret: String, digest: String, auxiliary: ByteArray): ByteArray
  private external fun vaultChaChaNative(key: ByteArray, nonce: ByteArray, input: ByteArray): ByteArray
  private external fun deriveSharedXNative(privkeyHex: String, pubkeyHex: String): ByteArray
  private external fun verifySchnorrNative(
    signatureHex: String,
    messageHex: String,
    pubkeyHex: String
  ): Boolean

  companion object {
    init {
      System.loadLibrary("expo-crypto-accelerator")
    }
  }
}

private fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray {
  val mac = Mac.getInstance("HmacSHA256")
  mac.init(SecretKeySpec(key, "HmacSHA256"))
  return mac.doFinal(data)
}

private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it.toInt() and 0xff) }

private class InvalidKeyException : CodedException(
  "Expected a valid 32-byte private key and 32-byte x-only public key."
)

private class Secp256k1Exception : CodedException("secp256k1 conversation key derivation failed.")

private class VaultException : CodedException("Key vault operation failed")

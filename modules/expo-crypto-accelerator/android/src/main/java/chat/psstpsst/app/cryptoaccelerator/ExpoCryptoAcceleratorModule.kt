package chat.psstpsst.app.cryptoaccelerator

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class ExpoCryptoAcceleratorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoCryptoAccelerator")

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

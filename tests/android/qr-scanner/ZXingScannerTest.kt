package expo.modules.camera.analyzers

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.Rect
import androidx.camera.core.ImageInfo
import androidx.camera.core.ImageProxy
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import expo.modules.camera.records.BarcodeType
import expo.modules.camera.utils.BarCodeScannerResult
import expo.modules.kotlin.types.EnumTypeConverter
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.lang.reflect.Proxy
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicInteger

/** Exercises the shipped Android JNI reader, not a JS mock or the desktop decoder. */
@RunWith(AndroidJUnit4::class)
class ZXingScannerTest {
  private fun qr(text: String, size: Int = 720, inverted: Boolean = false): Bitmap {
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, mapOf(
      EncodeHintType.CHARACTER_SET to "UTF-8", EncodeHintType.MARGIN to 4
    ))
    val pixels = IntArray(size * size) { index ->
      if (matrix[index % size, index / size] != inverted) Color.BLACK else Color.WHITE
    }
    return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.ARGB_8888)
  }

  private fun decode(bitmap: Bitmap) = runBlocking { ZXingBarcodeScanner(listOf(BarcodeType.QR)).scan(bitmap) }

  @Test fun barcodeSettingsAcceptTheJavaScriptQrString() {
    val converter = EnumTypeConverter(BarcodeType::class.java)
    assertEquals(BarcodeType.QR, converter.convertFromAny("qr", null, false))
    assertEquals("qr", BarcodeType.mapFormatToString(BarcodeType.QR.id))
  }

  @Test fun photoInputsPreserveRawTextIncludingDenseAndUnicodePayloads() {
    for (payload in listOf(
      "nostr:npub1" + "q".repeat(58),
      "lightning:lnbc2500u1" + "qpzry9x8gf2tvdw0s3jn54khce6mua7l".repeat(35),
      "bunker://" + "ab".repeat(32) + "?relay=wss%3A%2F%2Frelay.example&secret=AbC123",
      "https://example.org/支付?memo=café&value=001.00\n keep spaces "
    )) {
      val bitmap = qr(payload)
      try {
        val result = decode(bitmap).single()
        assertEquals(payload, result.value)
        assertEquals(payload, result.raw)
        assertEquals(BarcodeType.QR.id, result.type)
        assertEquals(720, result.width)
        assertEquals(8, result.cornerPoints.size)
        val bundle = BarCodeScannerResultSerializer.toBundle(result, 1f)
        assertEquals(payload, bundle.getString("data"))
        assertTrue(result.boundingBox.width > 0)
      } finally { bitmap.recycle() }
    }
  }

  @Test fun rotatedInvertedAndRgb565PhotosDecode() {
    val payload = "nostr:npub1" + "z".repeat(58)
    val inverted = qr(payload, inverted = true)
    val normal = qr(payload)
    val rotated = Bitmap.createBitmap(normal, 0, 0, normal.width, normal.height, Matrix().apply { postRotate(90f) }, true)
    val rgb565 = normal.copy(Bitmap.Config.RGB_565, false)
    try {
      for (bitmap in listOf(inverted, rotated, rgb565)) assertEquals(payload, decode(bitmap).single().value)
      assertFalse(rgb565.isRecycled)
    } finally {
      listOf(inverted, normal, rotated, rgb565).distinct().forEach { it.recycle() }
    }
  }

  @Test fun blankImagesAndExcludedFormatsReturnNoResults() {
    val blank = Bitmap.createBitmap(320, 240, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.WHITE) }
    val code = qr("nostr:npub1" + "q".repeat(58))
    try {
      assertTrue(decode(blank).isEmpty())
      assertTrue(runBlocking { ZXingBarcodeScanner(listOf(BarcodeType.EAN13)).scan(code) }.isEmpty())
      assertEquals(1, runBlocking { ZXingBarcodeScanner(emptyList()).scan(code) }.size)
    } finally { blank.recycle(); code.recycle() }
  }

  private data class Frame(val image: ImageProxy, val closed: AtomicInteger)

  /** Emulates padded CameraX Y planes and a nonzero crop without copying through JPEG. */
  private fun frame(bitmap: Bitmap, rotation: Int = 0, invalid: Boolean = false): Frame {
    val width = bitmap.width + 32
    val height = bitmap.height + 16
    val stride = width + 24
    val buffer = ByteBuffer.allocateDirect(stride * height)
    repeat(buffer.capacity()) { buffer.put(it, 255.toByte()) }
    for (y in 0 until bitmap.height) for (x in 0 until bitmap.width) {
      buffer.put((y + 8) * stride + x + 16, Color.red(bitmap.getPixel(x, y)).toByte())
    }
    val plane = object : ImageProxy.PlaneProxy {
      override fun getBuffer() = buffer
      override fun getPixelStride() = 1
      override fun getRowStride() = stride
    }
    val info = Proxy.newProxyInstance(ImageInfo::class.java.classLoader, arrayOf(ImageInfo::class.java)) { _, method, _ ->
      when (method.name) { "getRotationDegrees" -> rotation; "getTimestamp" -> 0L; else -> null }
    } as ImageInfo
    val closed = AtomicInteger()
    val image = Proxy.newProxyInstance(ImageProxy::class.java.classLoader, arrayOf(ImageProxy::class.java)) { _, method, _ ->
      when (method.name) {
        "getFormat" -> if (invalid) ImageFormat.JPEG else ImageFormat.YUV_420_888
        "getWidth" -> width
        "getHeight" -> height
        "getPlanes" -> arrayOf(plane)
        "getCropRect" -> Rect(16, 8, width - 16, height - 8)
        "getImageInfo" -> info
        "close" -> { closed.incrementAndGet(); null }
        else -> null
      }
    } as ImageProxy
    return Frame(image, closed)
  }

  @Test fun cameraFramesRespectStrideCropRotationAndCloseAfterDelivery() {
    val payload = "lightning:LNURL1DP68GURN8GHJ7MRWW4EXCTN0D3SKCCNE9E3K7MF0"
    val bitmap = qr(payload, size = 480)
    val wide = Bitmap.createBitmap(640, 480, Bitmap.Config.ARGB_8888).apply {
      eraseColor(Color.WHITE)
      android.graphics.Canvas(this).drawBitmap(bitmap, 80f, 0f, null)
    }
    try {
      for (rotation in listOf(0, 90, 180, 270)) {
        val frame = frame(wide, rotation)
        val results = mutableListOf<BarCodeScannerResult>()
        BarcodeAnalyzer(listOf(BarcodeType.QR)) { results.add(it) }.analyze(frame.image)
        assertEquals(payload, results.single().value)
        assertEquals(if (rotation % 180 == 0) 640 else 480, results.single().width)
        assertEquals(if (rotation % 180 == 0) 480 else 640, results.single().height)
        assertEquals(1, frame.closed.get())
      }
    } finally { bitmap.recycle(); wide.recycle() }
  }

  @Test fun skippedEmptyAndInvalidFramesAreClosed() {
    val blank = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.WHITE) }
    try {
      val analyzer = BarcodeAnalyzer(listOf(BarcodeType.QR)) { fail("No barcode expected") }
      val frames = listOf(frame(blank), frame(blank), frame(blank, invalid = true))
      frames.forEach { analyzer.analyze(it.image) }
      frames.forEach { assertEquals(1, it.closed.get()) }
      val invalid = frame(blank, invalid = true)
      BarcodeAnalyzer(listOf(BarcodeType.QR)) { fail("No barcode expected") }.analyze(invalid.image)
      assertEquals(1, invalid.closed.get())
    } finally { blank.recycle() }
  }
}

package chat.psstpsst.app.filedrop

import android.app.Activity
import android.database.Cursor
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.view.DragEvent
import android.view.View
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

private data class DroppedFile(
  val uri: String,
  val name: String,
  val mime: String,
  val size: Long
) {
  fun payload() = mapOf("uri" to uri, "name" to name, "mime" to mime, "size" to size)
}

class ExpoFileDropModule : Module() {
  private var targetView: View? = null
  private var generation = 0
  private val ioExecutor = Executors.newSingleThreadExecutor()
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun definition() = ModuleDefinition {
    Name("ExpoFileDrop")
    Events("onDragStateChanged", "onDrop")

    AsyncFunction("setEnabledAsync") { enabled: Boolean ->
      appContext.currentActivity?.runOnUiThread { setEnabled(enabled) }
    }
  }

  private fun setEnabled(enabled: Boolean) {
    generation += 1
    targetView?.setOnDragListener(null)
    targetView = null
    sendEvent("onDragStateChanged", mapOf("active" to false))
    if (!enabled) return
    val view = appContext.currentActivity?.window?.decorView ?: return
    view.setOnDragListener { _, event -> handleDragEvent(event) }
    targetView = view
  }

  private fun handleDragEvent(event: DragEvent): Boolean {
    when (event.action) {
      DragEvent.ACTION_DRAG_STARTED -> return event.clipDescription != null
      DragEvent.ACTION_DRAG_ENTERED -> {
        sendEvent("onDragStateChanged", mapOf("active" to true))
        return true
      }
      DragEvent.ACTION_DRAG_EXITED -> {
        sendEvent("onDragStateChanged", mapOf("active" to false))
        return true
      }
      DragEvent.ACTION_DROP -> {
        sendEvent("onDragStateChanged", mapOf("active" to false))
        copyDrop(event)
        return true
      }
      DragEvent.ACTION_DRAG_ENDED -> {
        sendEvent("onDragStateChanged", mapOf("active" to false))
        return true
      }
      else -> return true
    }
  }

  private fun copyDrop(event: DragEvent) {
    val dropGeneration = generation
    val clipData = event.clipData ?: return
    val activity = appContext.currentActivity as? Activity
    val permissions = activity?.requestDragAndDropPermissions(event)
    val uris = (0 until clipData.itemCount).mapNotNull { clipData.getItemAt(it).uri }
    if (uris.isEmpty()) {
      permissions?.release()
      return
    }
    ioExecutor.execute {
      try {
        val files = uris.mapNotNull(::copyToCache)
        if (files.isNotEmpty()) {
          mainHandler.post {
            if (dropGeneration == generation && targetView != null) {
              sendEvent("onDrop", mapOf("files" to files.map(DroppedFile::payload)))
            } else {
              files.forEach { Uri.parse(it.uri).path?.let(::File)?.delete() }
            }
          }
        }
      } finally {
        permissions?.release()
      }
    }
  }

  private fun copyToCache(sourceUri: Uri): DroppedFile? {
    val context = appContext.reactContext ?: return null
    val resolver = context.contentResolver
    val directory = File(context.cacheDir, "file-drops")
    var target: File? = null
    return try {
      val metadata = queryMetadata(sourceUri)
      val mime = resolver.getType(sourceUri) ?: "application/octet-stream"
      val fallbackExtension = android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
      val fallbackName = "dropped-file" + (fallbackExtension?.let { ".$it" } ?: "")
      val name = sanitizeFilename(metadata.first ?: sourceUri.lastPathSegment ?: fallbackName)
      val targetFile = File(directory, "${UUID.randomUUID()}-$name")
      target = targetFile
      directory.mkdirs()
      resolver.openInputStream(sourceUri)?.use { input ->
        targetFile.outputStream().use { output -> input.copyTo(output) }
      } ?: return null
      DroppedFile(
        uri = Uri.fromFile(targetFile).toString(),
        name = name,
        mime = mime,
        size = if (metadata.second >= 0) metadata.second else targetFile.length()
      )
    } catch (_: Exception) {
      target?.delete()
      null
    }
  }

  private fun queryMetadata(uri: Uri): Pair<String?, Long> {
    val context = appContext.reactContext ?: return null to -1L
    var cursor: Cursor? = null
    return try {
      cursor = context.contentResolver.query(
        uri,
        arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
        null,
        null,
        null
      )
      if (cursor?.moveToFirst() == true) {
        val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
        val name = if (nameIndex >= 0 && !cursor.isNull(nameIndex)) cursor.getString(nameIndex) else null
        val size = if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) cursor.getLong(sizeIndex) else -1L
        name to size
      } else {
        null to -1L
      }
    } catch (_: Exception) {
      null to -1L
    } finally {
      cursor?.close()
    }
  }

  private fun sanitizeFilename(name: String): String {
    val cleaned = name.replace('/', '_').replace('\\', '_')
    return if (cleaned == "." || cleaned == ".." || cleaned.isBlank()) "dropped-file" else cleaned
  }
}

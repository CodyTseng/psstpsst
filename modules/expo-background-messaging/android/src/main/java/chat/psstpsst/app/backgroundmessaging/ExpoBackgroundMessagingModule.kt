package chat.psstpsst.app.backgroundmessaging

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.ReactContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues

class ExpoBackgroundMessagingModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoBackgroundMessaging")
    Events("onPulse")

    AsyncFunction("schedulePulseAsync") { deadline: Double? ->
      BackgroundMessagingPulse.schedule(deadline?.toLong())
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("isBatteryOptimizationExemptAsync") {
      val context = appContext.reactContext?.applicationContext
        ?: return@AsyncFunction false
      isBatteryOptimizationExempt(context)
    }

    AsyncFunction("requestBatteryOptimizationExemptionAsync") {
      val context = appContext.reactContext?.applicationContext
        ?: return@AsyncFunction false
      if (isBatteryOptimizationExempt(context)) return@AsyncFunction true

      val packageUri = Uri.parse("package:${context.packageName}")
      val request = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, packageUri)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(request)
        true
      } catch (error: ActivityNotFoundException) {
        val settings = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
          context.startActivity(settings)
          true
        } catch (fallbackError: ActivityNotFoundException) {
          Log.w(TAG, "Battery-optimization settings are unavailable.", fallbackError)
          false
        }
      }
    }

    AsyncFunction("startAsync") { channelName: String, message: String ->
      val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction false
      val reactContext = appContext.reactContext as? ReactContext ?: return@AsyncFunction false
      val intent = BackgroundMessagingService.createStartIntent(context, channelName, message)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
        BackgroundMessagingHeadlessTask.start(reactContext)
        BackgroundMessagingPulse.start { sendEvent("onPulse") }
        true
      } catch (error: RuntimeException) {
        BackgroundMessagingPulse.stop()
        BackgroundMessagingHeadlessTask.stop()
        Log.w(TAG, "Unable to start the background messaging service.", error)
        false
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stopAsync") {
      BackgroundMessagingPulse.stop()
      BackgroundMessagingHeadlessTask.stop()
      appContext.reactContext?.applicationContext?.let { context ->
        context.stopService(Intent(context, BackgroundMessagingService::class.java))
      }
      Unit
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      BackgroundMessagingPulse.stop()
      BackgroundMessagingHeadlessTask.stop()
    }
  }

  private fun isBatteryOptimizationExempt(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true
    val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
      ?: return false
    return powerManager.isIgnoringBatteryOptimizations(context.packageName)
  }

  private companion object {
    const val TAG = "ExpoBackgroundMessaging"
  }
}

/** One-shot main-looper deadline, independent of background Choreographer frames. */
internal object BackgroundMessagingPulse {
  private val handler = Handler(Looper.getMainLooper())
  private var callback: (() -> Unit)? = null
  private var deadline: Long? = null
  private val pulse = Runnable {
    deadline = null
    callback?.invoke()
  }

  fun start(onPulse: () -> Unit) {
    callback = onPulse
    arm()
  }

  fun schedule(at: Long?) {
    deadline = at
    arm()
  }

  private fun arm() {
    handler.removeCallbacks(pulse)
    val at = deadline ?: return
    if (callback != null) handler.postDelayed(pulse, (at - System.currentTimeMillis()).coerceAtLeast(0))
  }

  fun stop() {
    // Service/module destruction may originate outside the main queue.
    val clear = Runnable {
      callback = null
      handler.removeCallbacks(pulse)
    }
    if (Looper.myLooper() == Looper.getMainLooper()) clear.run() else handler.post(clear)
  }
}

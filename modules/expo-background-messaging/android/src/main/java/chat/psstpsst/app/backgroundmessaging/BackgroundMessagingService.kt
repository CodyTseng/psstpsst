package chat.psstpsst.app.backgroundmessaging

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class BackgroundMessagingService : Service() {
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val channelName = intent?.getStringExtra(EXTRA_CHANNEL_NAME)
      ?.takeIf(String::isNotBlank)
      ?: applicationInfo.loadLabel(packageManager).toString()
    val message = intent?.getStringExtra(EXTRA_MESSAGE)
      ?.takeIf(String::isNotBlank)
      ?: applicationInfo.loadLabel(packageManager).toString()

    createChannel(channelName)
    val notification = createNotification(message)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING,
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }

    // The service protects the already-running React Native relay session. A
    // process restarted without the application UI cannot safely reconstruct
    // account keys and subscriptions, so wait for the next explicit app launch.
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    BackgroundMessagingPulse.stop()
    BackgroundMessagingHeadlessTask.stop()
    super.onDestroy()
  }

  private fun createChannel(name: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_LOW).apply {
      description = name
      setShowBadge(false)
      setSound(null, null)
      enableVibration(false)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun createNotification(message: String): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = launchIntent?.let {
      PendingIntent.getActivity(
        this,
        0,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    val notificationIcon = resources.getIdentifier("notification_icon", "drawable", packageName)
      .takeIf { it != 0 }
      ?: applicationInfo.icon
    return builder
      .setSmallIcon(notificationIcon)
      .setContentTitle(applicationInfo.loadLabel(packageManager))
      .setContentText(message)
      .setContentIntent(contentIntent)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .build()
  }

  companion object {
    private const val CHANNEL_ID = "background-messaging"
    private const val NOTIFICATION_ID = 0x50535354
    private const val EXTRA_CHANNEL_NAME = "channelName"
    private const val EXTRA_MESSAGE = "message"

    fun createStartIntent(context: Context, channelName: String, message: String): Intent =
      Intent(context, BackgroundMessagingService::class.java)
        .putExtra(EXTRA_CHANNEL_NAME, channelName)
        .putExtra(EXTRA_MESSAGE, message)
  }
}

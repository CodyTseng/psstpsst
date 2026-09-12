package chat.psstpsst.app.localnotifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.graphics.drawable.IconCompat
import com.facebook.react.common.LifecycleState
import com.facebook.react.bridge.ReactContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import me.leolin.shortcutbadger.ShortcutBadger

class ExpoLocalNotificationsModule : Module() {
  private val notificationLock = Any()
  private var generation = 0L

  override fun definition() = ModuleDefinition {
    Name("ExpoLocalNotifications")

    AsyncFunction("hasPermissionAsync") {
      appContext.reactContext?.let(::hasPermission) ?: false
    }

    AsyncFunction("ensurePermissionAsync") { channelName: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(false)
      } else {
        ensureChannel(context, channelName, rename = true)
        if (Build.VERSION.SDK_INT >= 33 && !hasPermission(context)) {
          val permissions = appContext.permissions
          if (permissions == null) {
            promise.resolve(false)
          } else {
            permissions.askForPermissions(
              { promise.resolve(hasPermission(context)) },
              Manifest.permission.POST_NOTIFICATIONS,
            )
          }
        } else {
          promise.resolve(hasPermission(context))
        }
      }
    }

    AsyncFunction("presentAsync") {
      title: String, subtitle: String?, body: String?, avatarPath: String?, badgeCount: Int ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val epoch = synchronized(notificationLock) { generation }
      val appName = context.applicationInfo.loadLabel(context.packageManager).toString()
      ensureChannel(context, appName)
      if (!hasPermission(context)) return@AsyncFunction false
      val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      val contentIntent = launchIntent?.let {
        PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      }
      val icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
        .takeIf { it != 0 } ?: context.applicationInfo.icon
      val builder = NotificationCompat.Builder(context, MESSAGE_CHANNEL_ID)
        .setSmallIcon(icon)
        .setContentTitle(title)
        .setContentIntent(contentIntent)
        .setAutoCancel(true)
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setDefaults(NotificationCompat.DEFAULT_ALL)
        .setNumber(badgeCount.coerceAtLeast(0))
      subtitle?.takeIf(String::isNotBlank)?.let(builder::setSubText)
      body?.takeIf(String::isNotBlank)?.let {
        builder.setContentText(it).setStyle(NotificationCompat.BigTextStyle().bigText(it))
      }
      // AsyncFunction runs this bounded bitmap decode away from the UI thread.
      val avatar = avatarPath?.let(::decodeAvatar)
      if (avatar != null) {
        val sender = Person.Builder().setName(title)
          .setIcon(IconCompat.createWithAdaptiveBitmap(avatar)).build()
        val user = Person.Builder().setName(appName).build()
        builder.setStyle(NotificationCompat.MessagingStyle(user).setGroupConversation(false)
          .addMessage(body.orEmpty(), System.currentTimeMillis(), sender))
      }
      synchronized(notificationLock) {
        // A return to the app or account cleanup must win over in-flight avatar decoding.
        if (generation != epoch || (context as? ReactContext)?.lifecycleState == LifecycleState.RESUMED) return@synchronized true
        try {
          manager(context).notify(MESSAGE_NOTIFICATION_ID, builder.build())
          true
        } catch (_: SecurityException) {
          false
        }
      }
    }

    AsyncFunction("dismissAllAsync") {
      synchronized(notificationLock) {
        generation++
        // Keep the ongoing background-messaging service notification intact.
        appContext.reactContext?.let { manager(it).cancel(MESSAGE_NOTIFICATION_ID) }
      }
    }

    AsyncFunction("setBadgeCountAsync") { count: Int ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      val value = count.coerceAtLeast(0)
      if (value == 0) {
        synchronized(notificationLock) {
          generation++
          manager(context).cancel(MESSAGE_NOTIFICATION_ID)
        }
      }
      ShortcutBadger.applyCount(context.applicationContext, value)
    }
  }

  private fun manager(context: Context) = context.getSystemService(NotificationManager::class.java)

  private fun hasPermission(context: Context): Boolean {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
    return Build.VERSION.SDK_INT < 26 ||
      manager(context).getNotificationChannel(MESSAGE_CHANNEL_ID)?.importance != NotificationManager.IMPORTANCE_NONE
  }

  private fun ensureChannel(context: Context, name: String, rename: Boolean = false) {
    if (Build.VERSION.SDK_INT >= 26) {
      val existing = manager(context).getNotificationChannel(MESSAGE_CHANNEL_ID)
      // Re-creation only renames existing channels; Android preserves user preferences.
      val channel = existing ?: NotificationChannel(MESSAGE_CHANNEL_ID, name, NotificationManager.IMPORTANCE_HIGH)
        .apply { enableVibration(true); setShowBadge(true) }
      // A background delivery must not overwrite the localized channel name.
      if (rename) channel.name = name
      if (existing == null || rename) manager(context).createNotificationChannel(channel)
    }
  }

  private fun decodeAvatar(uri: String): Bitmap? = try {
    val path = Uri.parse(uri).path ?: uri
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) null else {
      var sample = 1
      while (bounds.outWidth / sample > 512 || bounds.outHeight / sample > 512) sample *= 2
      BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
    }
  } catch (_: Exception) {
    null
  }

  private companion object {
    const val MESSAGE_CHANNEL_ID = "messages"
    const val MESSAGE_NOTIFICATION_ID = 0x50535355
  }
}

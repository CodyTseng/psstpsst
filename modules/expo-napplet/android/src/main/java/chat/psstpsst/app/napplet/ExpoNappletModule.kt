package chat.psstpsst.app.napplet

import android.content.Context
import android.util.Base64
import android.webkit.*
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.functions.Queues
import java.lang.ref.WeakReference
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.views.ExpoView
import expo.modules.kotlin.viewevent.EventDispatcher
import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl


private class FetchTask { @Volatile var call: Call? = null; val cancelled = AtomicBoolean(false) }

class ExpoNappletModule : Module() {
  private var websiteNotification = 0
  private val views = mutableMapOf<String, WeakReference<NappletView>>()
  private val executor = Executors.newFixedThreadPool(4)
  private val calls = ConcurrentHashMap<String, FetchTask>()
  private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
    .connectTimeout(10, TimeUnit.SECONDS).callTimeout(20, TimeUnit.SECONDS)
    .proxy(java.net.Proxy.NO_PROXY)
    .dns(PublicDns()).build()
  override fun definition() = ModuleDefinition {
    Name("ExpoNapplet")
    Events("onTaskActive", "onTaskClosed")
    OnActivityResult { _, result -> BrowserPickers.result(result.requestCode, result.resultCode, result.data) }
    OnCreate { ApplicationTasks.emit = { event, payload -> sendEvent(event, payload) } }
    OnActivityEntersForeground {
      ApplicationTasks.foreground((appContext.currentActivity as? ApplicationTaskActivity)?.applicationTaskId)
    }
    Function("supportsApplicationTasks") { true }
    Function("activeTask") { ApplicationTasks.active }
    AsyncFunction("openBrowserExternalAsync") { url: String ->
      require(url.length <= 8192) { "invalid-url" }
      val context = appContext.reactContext ?: return@AsyncFunction false
      val blocked = setOf("javascript", "data", "file", "content", "app", "about", "chrome", "devtools", "shell", "powershell", "cmd", "psstpsst-file")
      val parsed = android.net.Uri.parse(url)
      require(parsed.scheme?.lowercase() !in blocked) { "invalid-url" }
      val intent = if (parsed.scheme == "intent") android.content.Intent.parseUri(url, android.content.Intent.URI_INTENT_SCHEME)
        else android.content.Intent(android.content.Intent.ACTION_VIEW, parsed)
      require(intent.data?.scheme?.lowercase() !in blocked) { "invalid-url" }
      val fallback = intent.getStringExtra("browser_fallback_url")
      intent.action = android.content.Intent.ACTION_VIEW
      intent.component = null; intent.selector = null
      intent.addCategory(android.content.Intent.CATEGORY_BROWSABLE)
      intent.flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK
      try { context.startActivity(intent); true }
      catch (_: android.content.ActivityNotFoundException) {
        if (fallback != null && android.net.Uri.parse(fallback).scheme in setOf("http", "https")) {
          context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(fallback)).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)); true
        } else false
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("notifyWebsiteAsync") { application: String, title: String, body: String ->
      val context = appContext.reactContext ?: return@AsyncFunction false
      require(application.length <= 256 && title.length <= 256 && body.length <= 4096) { "invalid-notification" }
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
      val channel = "psstpsst-websites"
      if (android.os.Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(android.app.NotificationChannel(channel, application, android.app.NotificationManager.IMPORTANCE_DEFAULT))
      val builder = androidx.core.app.NotificationCompat.Builder(context, channel)
        .setSmallIcon(context.applicationInfo.icon).setContentTitle("$application · $title").setContentText(body)
        .setStyle(androidx.core.app.NotificationCompat.BigTextStyle().bigText(body)).setAutoCancel(true)
      context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { intent ->
        builder.setContentIntent(android.app.PendingIntent.getActivity(context, 0, intent, android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE))
      }
      try { manager.notify("psst-web", websiteNotification++ % 32, builder.build()); true } catch (_: SecurityException) { false }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("openTaskAsync") { id: String, title: String ->
      ApplicationTasks.open(appContext.reactContext ?: error("context-unavailable"), id, title)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("focusTaskAsync") { id: String ->
      val context = appContext.reactContext ?: error("context-unavailable")
      val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as android.app.ActivityManager
      val task = manager.appTasks.firstOrNull { it.taskInfo.baseIntent.getStringExtra("taskId") == id }
      if (task != null) task.moveToFront()
      else require(ApplicationTasks.admitted.contains(id)) { "task-unavailable" }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("closeTaskAsync") { id: String ->
      ApplicationTasks.close(appContext.reactContext ?: error("context-unavailable"), id)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("showTaskHostAsync") {
      val context = appContext.reactContext ?: error("context-unavailable")
      val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: error("host-unavailable")
      context.startActivity(intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
    }.runOnQueue(Queues.MAIN)
    Function("isAvailable") { WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) }
    Function("supportsResourceHeaders") { true }
    Function("isExploreAvailable") { WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) && WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) }
    AsyncFunction("fetchResourceAsync") { id: String, value: String, max: Int, accept: String?, promise: Promise ->
      val task = FetchTask()
      val admitted = synchronized(calls) { if (calls.size >= 12 || id.length > 128 || value.length > 4096) false else { calls[id] = task; true } }
      if (!admitted) promise.reject("ERR_RESOURCE", "quota-exceeded", null)
      else executor.execute {
        try {
          require(accept == null || accept in listOf("*/*", "application/json", "application/nostr+json")) { "invalid-accept" }
          require(!task.cancelled.get()) { "cancelled" }
          var url = value.toHttpUrl()
          var redirects = 0
          val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20)
          var downloaded: String? = null
          while (downloaded == null) {
            require(!task.cancelled.get()) { "cancelled" }
            val literalHost = url.host.matches(Regex("[0-9.]+")) || url.host.contains(":")
            require(url.toString().length <= 4096 && (!literalHost || publicAddress(InetAddress.getByName(url.host))) &&
              url.isHttps && url.username.isEmpty() && url.password.isEmpty() && url.port == 443 && max in 1..26214400) { "blocked-by-policy" }
            val remaining = deadline - System.nanoTime()
            require(remaining > 0) { "timeout" }
            val call = client.newCall(Request.Builder().url(url).header("Accept", accept ?: "*/*").header("Accept-Encoding", "identity").build())
            call.timeout().timeout(remaining, TimeUnit.NANOSECONDS)
            task.call = call
            if (task.cancelled.get()) call.cancel()
            call.execute().use { response ->
              if (response.code in listOf(301, 302, 303, 307, 308)) {
                require(redirects++ < 5) { "redirect-limit" }
                val location = response.header("Location") ?: error("resource-unavailable")
                require(location.length <= 4096) { "blocked-by-policy" }
                url = url.resolve(location) ?: error("resource-unavailable")
              } else {
                require(response.code == 200 && (response.header("Content-Encoding") == null || response.header("Content-Encoding") == "identity")) { "resource-unavailable" }
                val body = response.body ?: error("resource-unavailable")
                require(body.contentLength() <= max) { "too-large" }
                val output = java.io.ByteArrayOutputStream()
                body.byteStream().use { input ->
                  val buffer = ByteArray(16384)
                  while (true) { val count = input.read(buffer); if (count < 0) break
                    require(output.size() + count <= max) { "too-large" }; output.write(buffer, 0, count)
                  }
                }
                downloaded = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)
              }
            }
          }
          promise.resolve(downloaded)
        } catch (error: Exception) { promise.reject("ERR_RESOURCE", error.message ?: "network-error", error) }
        finally { calls.remove(id) }
      }
    }
    AsyncFunction("cancelResourceAsync") { id: String -> calls[id]?.let { it.cancelled.set(true); it.call?.cancel() }; Unit }
    AsyncFunction("clearPageDataAsync") { storageId: String ->
      if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
        val hash=java.security.MessageDigest.getInstance("SHA-256").digest(storageId.toByteArray()).joinToString("") { "%02x".format(it) }
        androidx.webkit.ProfileStore.getInstance().deleteProfile("explore-$hash")
      }
      Unit
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("sendAsync") { id: String, message: String -> views[id]?.get()?.reply(message); Unit }.runOnQueue(Queues.MAIN)
    AsyncFunction("closeAsync") { id: String -> views.remove(id)?.get()?.dispose(); Unit }.runOnQueue(Queues.MAIN)
    AsyncFunction("goBackAsync") { id: String -> views[id]?.get()?.navigateBack() ?: false }.runOnQueue(Queues.MAIN)
    View(NappletView::class) {
      Events("onMessage")
      Prop("page") { view: NappletView, page: String -> if (page.isNotEmpty()) view.loadPage(page) }
      Prop("html") { view: NappletView, html: String -> view.load(html) }
      Prop("surfaceId") { view: NappletView, id: String -> views[id] = WeakReference(view) }
      OnViewDestroys { view: NappletView -> views.entries.removeAll { it.value.get() === view }; view.dispose() }
    }
    OnDestroy { ApplicationTasks.emit = null; calls.values.forEach { it.cancelled.set(true); it.call?.cancel() }; executor.shutdownNow() }
  }
}

class NappletView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  val onMessage by EventDispatcher()
  private val web = NappletWebView(context) { raw -> onMessage(mapOf("message" to raw)) }
  init { addView(web, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)) }
  fun loadPage(value: String) = web.loadPage(value)
  fun load(value: String) = web.loadDocument(value)
  fun reply(value: String) = web.reply(value)
  fun navigateBack() = web.navigateBack()
  fun dispose() { removeView(web); web.dispose() }
}

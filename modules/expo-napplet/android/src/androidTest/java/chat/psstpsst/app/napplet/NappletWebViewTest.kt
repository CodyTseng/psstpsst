package chat.psstpsst.app.napplet

import android.app.Activity
import android.content.Intent
import android.webkit.WebChromeClient
import android.webkit.ConsoleMessage
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class NappletTestActivity : Activity()

class NappletWebViewTest {
  @Test fun shippedWrapperLoadsAndHandshakesInsideTheAndroidSandbox() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val activity = instrumentation.startActivitySync(
      Intent(instrumentation.targetContext, NappletTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    )
    val html = instrumentation.context.assets.open("napplet-fixture.html").bufferedReader().use { it.readText() }
    val completed = CountDownLatch(1)
    val navigation = java.util.concurrent.LinkedBlockingQueue<Int>()
    var result: JSONObject? = null
    val console = java.util.concurrent.CopyOnWriteArrayList<String>()
    lateinit var web: NappletWebView
    var serial = 0
    instrumentation.runOnMainSync {
      web = NappletWebView(activity) { raw ->
        val message = JSONObject(raw)
        val reply = when (message.optString("type")) {
          "shell.ready" -> JSONObject().put("type", "shell.init")
            .put("capabilities", JSONObject().put("domains", JSONArray(listOf("shell", "identity"))))
            .put("services", JSONArray())
          "identity.getPublicKey" -> JSONObject().put("type", "identity.getPublicKey.result")
            .put("id", message.getString("id")).put("pubkey", "a".repeat(64))
          "test.result" -> { result = message; completed.countDown(); null }
          "test.navigation" -> { navigation.offer(message.getInt("page")); null }
          else -> null
        }
        if (reply != null) web.post {
          web.reply(JSONArray().put(JSONObject().put("serial", ++serial).put("message", reply.toString())).toString())
        }
      }
      web.webChromeClient = object : WebChromeClient() {
        override fun onConsoleMessage(message: ConsoleMessage): Boolean {
          console.add(message.message()); return true
        }
      }
      activity.setContentView(web)
      web.loadDocument(html)
    }
    try {
      assertTrue("Runtime did not complete: $console", completed.await(15, TimeUnit.SECONDS))
      val message = result!!
      assertFalse(message.toString(), message.has("error"))
      val values = message.getJSONObject("result")
      assertEquals("a".repeat(64), values.getString("pubkey"))
      assertTrue("Local data image was blocked: $console", values.getBoolean("image"))
      assertTrue(values.getBoolean("wasm"))
      assertFalse(values.getBoolean("parentReadable"))
      assertFalse(values.getBoolean("storage"))
      assertFalse(values.getBoolean("network"))
      assertEquals("undefined", values.getString("bridge"))
      instrumentation.runOnMainSync {
        assertFalse("The initial wrapper must not count as app history", web.navigateBack())
        web.evaluateJavascript("document.querySelector('iframe').contentWindow.postMessage({type:'test.push'},'*')", null)
      }
      assertEquals(2, navigation.poll(5, TimeUnit.SECONDS))
      instrumentation.runOnMainSync { assertTrue(web.navigateBack()) }
      val firstBack = navigation.poll(5, TimeUnit.SECONDS)
      var historyIndex = -1
      instrumentation.runOnMainSync { historyIndex = web.copyBackForwardList().currentIndex }
      assertEquals("History index=$historyIndex, console=$console", 1, firstBack)
      instrumentation.runOnMainSync { assertTrue(web.navigateBack()) }
      assertEquals(0, navigation.poll(5, TimeUnit.SECONDS))
      instrumentation.runOnMainSync { assertFalse(web.navigateBack()) }
    } finally {
      instrumentation.runOnMainSync { web.dispose(); activity.finish() }
    }
  }
}

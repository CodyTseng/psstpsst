package chat.psstpsst.app.napplet

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.test.filters.SdkSuppress
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class ApplicationBackTestActivity : ComponentActivity() {
  var completedBacks = 0
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() { completedBacks++ }
    })
    installApplicationBackGesture(this)
    if (Build.VERSION.SDK_INT >= 27) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    }
  }
}

@SdkSuppress(minSdkVersion = 34)
class ApplicationBackGestureTest {
  @Test fun predictiveBackCancelsPageFeedbackWithoutChangingNormalLongPresses() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val activity = instrumentation.startActivitySync(
      Intent(instrumentation.targetContext, ApplicationBackTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    ) as ApplicationBackTestActivity
    val focused = CountDownLatch(1)
    lateinit var web: NappletWebView
    instrumentation.runOnMainSync {
      web = NappletWebView(activity) {}
      activity.setContentView(web)
      web.viewTreeObserver.addOnWindowFocusChangeListener { if (it) focused.countDown() }
      if (web.hasWindowFocus()) focused.countDown()
    }
    val results = mutableMapOf<String, Boolean>()
    try {
      assertTrue("Test window did not gain focus", focused.await(5, TimeUnit.SECONDS))
      instrumentation.runOnMainSync {
        fun touch(action: Int) {
          val time = SystemClock.uptimeMillis()
          val event = MotionEvent.obtain(time, time, action, 40f, 40f, 0)
          try { web.dispatchTouchEvent(event) } finally { event.recycle() }
        }
        fun longPress() = web.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
        touch(MotionEvent.ACTION_DOWN)
        results["active"] = longPress()
        touch(MotionEvent.ACTION_CANCEL)
        results["cancelled"] = longPress()
        results["other-feedback"] = web.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
        touch(MotionEvent.ACTION_DOWN)
        results["next-touch"] = longPress()
        touch(MotionEvent.ACTION_UP)
        results["released"] = longPress()
        touch(MotionEvent.ACTION_DOWN)
        web.cancelPendingInputEvents()
        results["pending-cancelled"] = longPress()
        touch(MotionEvent.ACTION_DOWN)
        activity.onBackPressedDispatcher.dispatchOnBackStarted(BackEventCompat(0f, 0f, 0f, BackEventCompat.EDGE_LEFT))
        results["back-started"] = longPress()
        activity.onBackPressedDispatcher.dispatchOnBackCancelled()
        touch(MotionEvent.ACTION_DOWN)
        results["after-back-cancelled"] = longPress()
        activity.onBackPressedDispatcher.dispatchOnBackStarted(BackEventCompat(0f, 0f, 0f, BackEventCompat.EDGE_LEFT))
        activity.onBackPressedDispatcher.onBackPressed()
        results["back-committed"] = longPress()
        assertEquals(1, activity.completedBacks)
      }
    } finally { instrumentation.runOnMainSync { web.dispose(); activity.finish() } }
    org.junit.Assume.assumeTrue("Device haptics must be enabled to observe accepted feedback", results["active"] == true)
    assertEquals(false, results["cancelled"])
    assertEquals(true, results["other-feedback"])
    assertEquals(true, results["next-touch"])
    assertEquals(true, results["released"])
    assertEquals(false, results["pending-cancelled"])
    assertEquals(false, results["back-started"])
    assertEquals(true, results["after-back-cancelled"])
    assertEquals(false, results["back-committed"])
  }
}

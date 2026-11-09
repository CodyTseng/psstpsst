package chat.psstpsst.app.napplet

import android.content.Intent
import android.graphics.Rect
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import androidx.test.filters.SdkSuppress
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.*
import org.junit.Test

@SdkSuppress(minSdkVersion = 29)
class ApplicationHandleGestureExclusionTest {
  @Test fun exclusionFollowsTheTranslatedDrawerAndLeavesOtherEdgePositionsAvailable() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val activity = instrumentation.startActivitySync(
      Intent(instrumentation.targetContext, ApplicationBackTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    ) as ApplicationBackTestActivity
    val reported = AtomicReference<List<Rect>>(emptyList())
    lateinit var drawer: View
    lateinit var exclusion: ApplicationHandleGestureExclusion
    val density = activity.resources.displayMetrics.density
    val point = IntArray(2)
    fun covered() = reported.get().any { it.contains(point[0], point[1]) }
    fun awaitCondition(message: String, condition: () -> Boolean) {
      val deadline = SystemClock.uptimeMillis() + 5000
      while (!condition() && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(20)
      assertTrue(message, condition())
    }
    try {
      instrumentation.runOnMainSync {
        val root = FrameLayout(activity)
        activity.setContentView(root)
        activity.window.decorView.viewTreeObserver.addOnSystemGestureExclusionRectsChangedListener { rects ->
          reported.set(rects.map { Rect(it) })
        }
        drawer = View(activity).apply {
          translationX = 144 * density
        }
        root.addView(drawer, FrameLayout.LayoutParams((168 * density).toInt(), (56 * density).toInt(), Gravity.RIGHT or Gravity.TOP).apply {
          topMargin = (100 * density).toInt()
        })
        exclusion = ApplicationHandleGestureExclusion(drawer)
      }
      instrumentation.waitForIdleSync()
      instrumentation.runOnMainSync {
        val bounds = Rect()
        assertTrue(drawer.getGlobalVisibleRect(bounds))
        point[0] = bounds.right - (4 * density).toInt(); point[1] = bounds.centerY()
      }
      awaitCondition("The tucked drawer must exclude its visible right-edge bounds", ::covered)
      instrumentation.runOnMainSync { drawer.translationY = 160 * density }
      awaitCondition("Moving the drawer must release its previous edge position") { !covered() }
      point[1] += (160 * density).toInt()
      awaitCondition("The exclusion must follow UI-thread translation without JS updates", ::covered)

      instrumentation.runOnMainSync { exclusion.dispose() }
      awaitCondition("Disposing the drawer must remove its exclusion", { !covered() })
    } finally { instrumentation.runOnMainSync { activity.finish() } }
  }
}

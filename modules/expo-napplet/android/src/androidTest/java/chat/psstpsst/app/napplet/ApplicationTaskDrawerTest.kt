package chat.psstpsst.app.napplet

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.os.SystemClock
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test

class ApplicationTaskDrawerTest {
  @Test fun nativeHandleMovesBothAxesWithoutCapturingDocumentInputAndFillsItsFeedbackRegion() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val activity = instrumentation.startActivitySync(
      Intent(instrumentation.targetContext, ApplicationBackTestActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    ) as ApplicationBackTestActivity
    val density = activity.resources.displayMetrics.density
    lateinit var drawer: FrameLayout
    lateinit var handle: View
    lateinit var controller: ApplicationTaskDrawer
    val changes = mutableListOf<Boolean>()
    val placements = mutableListOf<Double>()
    val options = ApplicationTaskDrawerOptions().apply {
      travel = 144.0; margin = 8.0; feedbackColor = 0x33000000; active = true
    }
    try {
      instrumentation.runOnMainSync {
        val root = FrameLayout(activity)
        activity.setContentView(root)
        drawer = FrameLayout(activity)
        handle = View(activity).apply { setBackgroundColor(Color.WHITE) }
        root.addView(drawer, FrameLayout.LayoutParams((168 * density).toInt(), (56 * density).toInt(), Gravity.TOP or Gravity.RIGHT).apply { topMargin = (8 * density).toInt() })
        drawer.addView(handle, FrameLayout.LayoutParams((24 * density).toInt(), (56 * density).toInt()))
      }
      instrumentation.waitForIdleSync()
      instrumentation.runOnMainSync {
        controller = ApplicationTaskDrawer(drawer, handle) { expanded, offsetY ->
          if (changes.lastOrNull() != expanded) changes.add(expanded)
          placements.add(offsetY)
        }
        controller.configure(options)
        assertEquals((drawer.translationY / density).toDouble(), placements.last(), 0.01)
        changes.clear()
        val rect = Rect()
        assertTrue(handle.getGlobalVisibleRect(rect))
        var downTime = SystemClock.uptimeMillis()
        fun touch(action: Int, x: Float, y: Float): Boolean {
          if (action == MotionEvent.ACTION_DOWN) downTime = SystemClock.uptimeMillis()
          val event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, x, y, 0)
          return try { controller.touch(event) } finally { event.recycle() }
        }
        fun pixel(x: Int, y: Int): Int {
          val bitmap = Bitmap.createBitmap(handle.width, handle.height, Bitmap.Config.ARGB_8888)
          try { handle.draw(Canvas(bitmap)); return bitmap.getPixel(x, y) }
          finally { bitmap.recycle() }
        }
        assertFalse("Collapsed chrome must not capture page touches", touch(MotionEvent.ACTION_DOWN, rect.left - 80 * density, rect.centerY().toFloat()))
        val x = rect.centerX().toFloat(); val y = rect.centerY().toFloat()
        assertTrue(touch(MotionEvent.ACTION_DOWN, x, y))
        assertNotEquals("Feedback must reach the handle's first corner", Color.WHITE, pixel(0, 0))
        assertEquals("Feedback must cover the whole rectangle", pixel(0, 0), pixel(handle.width - 1, handle.height - 1))
        assertTrue(touch(MotionEvent.ACTION_MOVE, x - 144 * density, y))
        assertEquals(0f, drawer.translationX, 1f)
        assertTrue(touch(MotionEvent.ACTION_UP, x - 144 * density, y))
        assertEquals(listOf(true), changes)
        assertEquals(Color.WHITE, pixel(0, 0))

        options.expanded = true; controller.configure(options)
        assertTrue(handle.getGlobalVisibleRect(rect))
        val startY = drawer.translationY
        val nextX = rect.centerX().toFloat(); val nextY = rect.centerY().toFloat()
        touch(MotionEvent.ACTION_DOWN, nextX, nextY)
        touch(MotionEvent.ACTION_MOVE, nextX, nextY - 80 * density)
        touch(MotionEvent.ACTION_UP, nextX, nextY - 80 * density)
        assertEquals(startY - 80 * density, drawer.translationY, 1f)
        assertEquals("Renderer receives final placement for action hit testing", (drawer.translationY / density).toDouble(), placements.last(), 0.01)
        assertEquals(0f, drawer.translationX, 1f)
        controller.configure(options)
        assertEquals("React updates must retain vertical placement", startY - 80 * density, drawer.translationY, 1f)

        assertTrue(handle.getGlobalVisibleRect(rect))
        val closeX = rect.centerX().toFloat(); val closeY = rect.centerY().toFloat()
        touch(MotionEvent.ACTION_DOWN, closeX, closeY)
        touch(MotionEvent.ACTION_MOVE, closeX + 144 * density, closeY)
        touch(MotionEvent.ACTION_UP, closeX + 144 * density, closeY)
        assertEquals(listOf(true, false), changes)
        assertEquals(144 * density, drawer.translationX, 1f)
        options.active = false; controller.configure(options)
        assertFalse(touch(MotionEvent.ACTION_DOWN, closeX, closeY))
        controller.dispose()
      }
    } finally { instrumentation.runOnMainSync { activity.finish() } }
  }
}

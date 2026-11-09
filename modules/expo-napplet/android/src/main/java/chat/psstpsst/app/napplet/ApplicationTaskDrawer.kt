package chat.psstpsst.app.napplet

import android.animation.ValueAnimator
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import android.widget.OverScroller
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlin.math.abs

class ApplicationTaskDrawerOptions : Record {
  @Field var viewTag: Int = 0
  @Field var handleTag: Int = 0
  @Field var travel: Double = 0.0
  @Field var margin: Double = 0.0
  @Field var feedbackColor: Int = 0
  @Field var active: Boolean = false
  @Field var expanded: Boolean = false
}

/** Only handle-origin touches are captured; movement, exclusion and feedback stay on the UI thread. */
internal class ApplicationTaskDrawer(
  val view: View,
  private val handle: View,
  private val changed: (Boolean, Double) -> Unit,
) {
  private companion object {
    const val TAP_SETTLE_DURATION_MS = 120
  }
  private val density = view.resources.displayMetrics.density
  private val slop = ViewConfiguration.get(view.context).scaledTouchSlop
  private val bounds = Rect()
  private val feedback = ColorDrawable()
  private val scroller = OverScroller(view.context)
  private val exclusion = ApplicationHandleGestureExclusion(view, slop)
  private var tracker: VelocityTracker? = null
  private var active = false
  private var expanded = false
  private var captured = false
  private var hovered = false
  private var axis = 0
  private var downX = 0f
  private var downY = 0f
  private var startX = 0f
  private var startY = 0f
  private var travel = 0f
  private var margin = 0f
  private var fraction = 0.5f
  private var color = Color.TRANSPARENT
  private var published: Pair<Boolean, Float>? = null
  private val parent = view.parent as View
  private val layout = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> place() }
  private val tick = object : Runnable {
    override fun run() {
      if (scroller.computeScrollOffset()) {
        view.translationX = scroller.currX.toFloat()
        if (scroller.isFinished) publish() else view.postOnAnimation(this)
      } else publish()
    }
  }

  init {
    handle.overlay.add(feedback)
    parent.addOnLayoutChangeListener(layout)
    view.addOnLayoutChangeListener(layout)
    handle.addOnLayoutChangeListener(layout)
  }

  private fun range() = (parent.height - view.height - margin * 2).coerceAtLeast(0f)
  private fun place() {
    if (!captured) view.translationY = fraction * range()
    feedback.setBounds(0, 0, handle.width, handle.height)
    publish()
  }
  private fun publish() {
    if (captured || !scroller.isFinished) return
    val snapshot = expanded to (view.translationY / density)
    if (published == snapshot) return
    published = snapshot
    changed(snapshot.first, snapshot.second.toDouble())
  }
  private fun paint() {
    feedback.color = if (active && (captured || hovered)) color else Color.TRANSPARENT
    handle.invalidate()
  }
  private fun stop() { view.removeCallbacks(tick); scroller.abortAnimation() }
  private fun settle(quick: Boolean = false) {
    stop()
    val target = if (expanded) 0 else travel.toInt()
    if (Build.VERSION.SDK_INT >= 26 && !ValueAnimator.areAnimatorsEnabled()) view.translationX = target.toFloat()
    else if (quick && view.translationX.toInt() != target) {
      scroller.startScroll(view.translationX.toInt(), 0, target - view.translationX.toInt(), 0, TAP_SETTLE_DURATION_MS)
      view.postOnAnimation(tick)
    }
    else if (scroller.springBack(view.translationX.toInt(), 0, target, target, 0, 0)) view.postOnAnimation(tick)
    else view.translationX = target.toFloat()
    publish()
  }
  private fun open(next: Boolean, quick: Boolean = false) {
    expanded = next
    settle(quick)
  }
  fun configure(options: ApplicationTaskDrawerOptions) {
    val first = travel == 0f
    val reposition = first || expanded != options.expanded
    travel = options.travel.toFloat() * density
    margin = options.margin.toFloat() * density
    color = options.feedbackColor
    active = options.active
    if (!active) { captured = false; hovered = false; releaseTracker() }
    expanded = active && options.expanded
    if (first || !active) { stop(); view.translationX = if (expanded) 0f else travel }
    else if (reposition && !captured) settle(quick = true)
    view.alpha = if (active) 1f else 0f
    place(); paint()
  }
  private fun hit(event: MotionEvent, padded: Boolean = false): Boolean {
    if (!active || !handle.isShown || !handle.getGlobalVisibleRect(bounds)) return false
    if (padded) bounds.inset(-slop, 0)
    return bounds.contains(event.rawX.toInt(), event.rawY.toInt())
  }
  fun hover(event: MotionEvent) {
    hovered = event.actionMasked != MotionEvent.ACTION_HOVER_EXIT && hit(event)
    paint()
  }
  private fun releaseTracker() { tracker?.recycle(); tracker = null }
  fun touch(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN) {
      if (!hit(event, padded = true)) return false
      stop(); captured = true; axis = 0
      downX = event.rawX; downY = event.rawY
      startX = view.translationX; startY = view.translationY
      releaseTracker(); tracker = VelocityTracker.obtain()
      paint()
    }
    if (!captured) return false
    tracker?.addMovement(event)
    when (event.actionMasked) {
      MotionEvent.ACTION_MOVE -> {
        val dx = event.rawX - downX; val dy = event.rawY - downY
        if (axis == 0 && maxOf(abs(dx), abs(dy)) > slop) axis = if (abs(dx) > abs(dy)) 1 else 2
        if (axis == 1) view.translationX = (startX + dx).coerceIn(0f, travel)
        if (axis == 2) view.translationY = (startY + dy).coerceIn(0f, range())
      }
      MotionEvent.ACTION_UP -> {
        tracker?.computeCurrentVelocity(1000)
        val velocity = tracker?.xVelocity ?: 0f
        captured = false
        if (axis == 2) fraction = if (range() > 0f) view.translationY / range() else 0.5f
        if (axis == 0) open(!expanded, quick = true)
        else if (axis == 1) open(if (abs(velocity) > 500 * density) velocity < 0 else view.translationX < travel / 2)
        else settle()
        releaseTracker(); paint()
      }
      MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_POINTER_DOWN -> {
        captured = false; releaseTracker(); place(); settle(); paint()
      }
    }
    return true
  }
  fun dispose() {
    active = false; captured = false
    stop(); releaseTracker(); exclusion.dispose()
    parent.removeOnLayoutChangeListener(layout)
    view.removeOnLayoutChangeListener(layout)
    handle.removeOnLayoutChangeListener(layout)
    handle.overlay.remove(feedback)
  }
}

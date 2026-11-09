package chat.psstpsst.app.napplet

import android.graphics.Rect
import android.os.Build
import android.view.View
import android.view.ViewTreeObserver

/** The task window owns the edge exclusion, following the drawer's clipped screen bounds. */
internal class ApplicationHandleGestureExclusion(private val view: View, private val horizontalPadding: Int = 0) {
  private var root: View? = null
  private var original: List<Rect> = emptyList()
  private var last: Rect? = null
  private val visible = Rect()
  private val origin = IntArray(2)
  private val draw = ViewTreeObserver.OnPreDrawListener { update(); true }
  private val layout = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> update() }
  private val attachment = object : View.OnAttachStateChangeListener {
    override fun onViewAttachedToWindow(view: View) { attach() }
    override fun onViewDetachedFromWindow(view: View) { clear() }
  }

  init {
    view.addOnLayoutChangeListener(layout)
    view.addOnAttachStateChangeListener(attachment)
    attach()
  }

  private fun attach() {
    if (Build.VERSION.SDK_INT < 29 || !view.isAttachedToWindow) return
    val owner = view.rootView
    if (root !== owner) {
      clear()
      root = owner
      original = owner.systemGestureExclusionRects.map { Rect(it) }
      owner.viewTreeObserver.addOnPreDrawListener(draw)
    }
    update()
  }

  private fun update() {
    if (Build.VERSION.SDK_INT < 29) return
    val owner = root ?: return
    val shown = view.isShown && view.getGlobalVisibleRect(visible)
    if (shown) {
      owner.getLocationOnScreen(origin)
      visible.offset(-origin[0], -origin[1])
      visible.left -= horizontalPadding
      // Include the physical edge even when the host has a horizontal safe inset.
      visible.right = owner.width
      visible.intersect(0, 0, owner.width, owner.height)
    }
    val next = if (shown && !visible.isEmpty) visible else null
    if (next == last) return
    last = next?.let { Rect(it) }
    owner.systemGestureExclusionRects = original + listOfNotNull(last)
  }

  private fun clear() {
    val owner = root ?: return
    if (owner.viewTreeObserver.isAlive) owner.viewTreeObserver.removeOnPreDrawListener(draw)
    if (Build.VERSION.SDK_INT >= 29) owner.systemGestureExclusionRects = original
    root = null; last = null; original = emptyList()
  }

  fun dispose() {
    view.removeOnLayoutChangeListener(layout)
    view.removeOnAttachStateChangeListener(attachment)
    clear()
  }
}

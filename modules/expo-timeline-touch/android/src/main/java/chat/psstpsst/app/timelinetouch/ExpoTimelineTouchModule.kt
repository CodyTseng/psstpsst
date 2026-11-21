package chat.psstpsst.app.timelinetouch

import android.content.Context
import android.view.MotionEvent
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class ExpoTimelineTouchModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoTimelineTouch")

    View(TimelineTouchView::class) {
      Events("onTouchCancelled")
    }
  }
}

class TimelineTouchView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onTouchCancelled by EventDispatcher<Unit>()

  // React Native lays out the translated child through Yoga.
  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    val cancelled = event.actionMasked == MotionEvent.ACTION_CANCEL
    val handled = super.dispatchTouchEvent(event)
    if (cancelled) onTouchCancelled(Unit)
    return handled
  }
}

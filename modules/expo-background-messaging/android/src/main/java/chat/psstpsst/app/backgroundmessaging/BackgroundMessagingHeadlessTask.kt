package chat.psstpsst.app.backgroundmessaging

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext

/** Keeps the React Native background task active while the foreground service owns the process. */
internal object BackgroundMessagingHeadlessTask {
  private const val TASK_KEY = "PsstPsstBackgroundMessaging"
  private val lock = Any()
  private var reactContext: ReactContext? = null
  private var taskId: Int? = null

  fun start(context: ReactContext) {
    UiThreadUtil.runOnUiThread {
      synchronized(lock) {
        if (reactContext === context && taskId != null) return@synchronized
        finishTaskLocked()
        reactContext = context
        startTaskLocked(context)
      }
    }
  }

  fun stop() {
    UiThreadUtil.runOnUiThread {
      synchronized(lock) {
        finishTaskLocked()
        reactContext = null
      }
    }
  }

  private fun startTaskLocked(context: ReactContext) {
    taskId = HeadlessJsTaskContext.getInstance(context).startTask(
      HeadlessJsTaskConfig(
        TASK_KEY,
        Arguments.createMap(),
        0,
        true,
      ),
    )
  }

  private fun finishTaskLocked() {
    val context = reactContext
    val id = taskId
    taskId = null
    if (context != null && id != null) {
      HeadlessJsTaskContext.getInstance(context).finishTask(id)
    }
  }
}

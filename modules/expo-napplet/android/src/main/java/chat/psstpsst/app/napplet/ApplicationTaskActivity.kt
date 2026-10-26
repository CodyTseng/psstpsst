package chat.psstpsst.app.napplet

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import java.lang.ref.WeakReference

/** Opaque in-process sessions cannot be restored with stale account authority after process death. */
internal object ApplicationTasks {
  val activities = mutableMapOf<String, WeakReference<ApplicationTaskActivity>>()
  val admitted = mutableSetOf<String>()
  var emit: ((String, Map<String, Any?>) -> Unit)? = null
  var active: String? = null
  fun open(context: Context, id: String, title: String) {
    require(id.length in 1..128 && title.length <= 200 && admitted.size < 16) { "quota-exceeded" }
    require(admitted.add(id)) { "task-already-open" }
    try {
      context.startActivity(Intent(context, ApplicationTaskActivity::class.java)
        .setData(Uri.parse("psst-task://application/$id"))
        .putExtra("taskId", id).putExtra("taskTitle", title)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_DOCUMENT or Intent.FLAG_ACTIVITY_MULTIPLE_TASK or Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (error: Exception) { admitted.remove(id); throw error }
  }
  fun close(context: Context, id: String) {
    val activity = activities[id]?.get()
    if (activity != null) activity.finishAndRemoveTask()
    else {
      val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      manager.appTasks.firstOrNull { it.taskInfo.baseIntent.getStringExtra("taskId") == id }?.finishAndRemoveTask()
      admitted.remove(id)
    }
  }
  fun foreground(id: String?) {
    active = id
    emit?.invoke("onTaskActive", mapOf("id" to id))
  }
}

/** Each application owns a Recents card and a React surface on the shared ReactHost. */
class ApplicationTaskActivity : ReactActivity() {
  val applicationTaskId: String get() = intent.getStringExtra("taskId") ?: ""
  override fun getMainComponentName() = "PsstApplicationTask"
  override fun createReactActivityDelegate() = object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
    override fun getLaunchOptions() = Bundle().apply { putString("taskId", applicationTaskId) }
  }
  override fun onCreate(savedInstanceState: Bundle?) {
    if (!ApplicationTasks.admitted.contains(applicationTaskId)) {
      super.onCreate(null)
      finishAndRemoveTask()
      return
    }
    super.onCreate(null)
    installApplicationBackGesture(this)
    ApplicationTasks.activities[applicationTaskId] = WeakReference(this)
    @Suppress("DEPRECATION")
    setTaskDescription(ActivityManager.TaskDescription(intent.getStringExtra("taskTitle") ?: "PsstPsst"))
  }
  override fun onResume() {
    super.onResume()
    ApplicationTasks.foreground(applicationTaskId)
  }
  override fun invokeDefaultOnBackPressed() { finishAndRemoveTask() }
  override fun onDestroy() {
    if (isFinishing) {
      ApplicationTasks.activities.remove(applicationTaskId)
      ApplicationTasks.admitted.remove(applicationTaskId)
      ApplicationTasks.emit?.invoke("onTaskClosed", mapOf("id" to applicationTaskId))
    }
    super.onDestroy()
  }
}

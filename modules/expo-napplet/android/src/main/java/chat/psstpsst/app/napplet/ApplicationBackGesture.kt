package chat.psstpsst.app.napplet

import androidx.activity.BackEventCompat
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback

/** Cancel page input at predictive-back start, before the platform sends touch cancellation. */
fun installApplicationBackGesture(activity: ComponentActivity) {
  activity.onBackPressedDispatcher.addCallback(activity, object : OnBackPressedCallback(true) {
    override fun handleOnBackStarted(backEvent: BackEventCompat) {
      activity.window.decorView.cancelPendingInputEvents()
    }

    override fun handleOnBackPressed() {
      // Keep React Native, modal and page-history handling on the existing dispatcher.
      isEnabled = false
      try { activity.onBackPressedDispatcher.onBackPressed() }
      finally { isEnabled = true }
    }
  })
}

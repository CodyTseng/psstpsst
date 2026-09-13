package chat.psstpsst.app.proximity

/**
 * Gives a discovered advertiser time to initiate the shared BLE link first.
 * All methods and scheduled callbacks run on the transport's serial handler.
 */
internal class DiscoveryConnectionQueue(
  private val schedule: (Runnable, Long) -> Unit,
  private val cancel: (Runnable) -> Unit,
  private val maximumPending: Int = 16,
) {
  private class Attempt(val connect: () -> Unit) {
    lateinit var timer: Runnable
  }

  private val pending = mutableMapOf<String, Attempt>()
  var isScanning = false
    private set

  fun startScan() {
    isScanning = true
  }

  /** Stop accepting advertisements without cancelling already discovered peers. */
  fun stopScan() {
    isScanning = false
  }

  fun enqueue(endpoint: String, delayMs: Long, connect: () -> Unit) {
    if (!isScanning) return
    scheduleAttempt(endpoint, delayMs, connect)
  }

  private fun scheduleAttempt(endpoint: String, delayMs: Long, connect: () -> Unit) {
    if (endpoint in pending || pending.size >= maximumPending) return
    val attempt = Attempt(connect)
    attempt.timer = Runnable {
      if (pending[endpoint] !== attempt) return@Runnable
      pending.remove(endpoint)
      attempt.connect()
    }
    pending[endpoint] = attempt
    schedule(attempt.timer, delayMs)
  }

  /** The peer is already reading our service; reuse its connection now. */
  fun promote(endpoint: String) {
    val attempt = pending.remove(endpoint) ?: return
    cancel(attempt.timer)
    attempt.connect()
  }

  /** Let an incoming link finish service discovery before the fallback runs. */
  fun defer(endpoint: String, delayMs: Long) {
    val attempt = pending.remove(endpoint) ?: return
    cancel(attempt.timer)
    scheduleAttempt(endpoint, delayMs, attempt.connect)
  }

  fun remove(endpoint: String) {
    pending.remove(endpoint)?.let { cancel(it.timer) }
  }

  fun stopSession() {
    stopScan()
    pending.values.forEach { cancel(it.timer) }
    pending.clear()
  }
}

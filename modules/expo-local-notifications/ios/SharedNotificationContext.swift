import Darwin
import Foundation

/** A foreground-only lock rejects stale lifecycle preferences without blocking suspension. */
enum SharedNotificationContext {
  private static let presenceLock = NotificationPresenceLock()
  private static var group: String? { Bundle.main.object(forInfoDictionaryKey: "PsstPsstAppGroup") as? String }
  private static var defaults: UserDefaults? { group.flatMap(UserDefaults.init(suiteName:)) }
  private static var lockPath: String? {
    group.flatMap { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: $0) }?
      .appendingPathComponent("app-presence.lock").path
  }

  static func startMainProcess() {
    setUserPresent(false)
    defaults?.removeObject(forKey: "activeConversation")
  }

  static func setUserPresent(_ present: Bool) {
    let isPresent = presenceLock.setPresent(present, path: lockPath) {
      defaults?.set(true, forKey: "userPresent")
    }
    defaults?.set(isPresent, forKey: "userPresent")
  }

  static func setActiveConversation(account: String?, conversation: String?) {
    if let account, let conversation {
      defaults?.set(["accountPubkey": account, "conversationKey": conversation], forKey: "activeConversation")
    } else { defaults?.removeObject(forKey: "activeConversation") }
  }

  static var databaseChanged: String { "\(group ?? "chat.psstpsst").database-changed" }

  static func publishDatabaseChanged() {
    CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(),
      CFNotificationName(databaseChanged as CFString), nil, nil, true)
  }

  static func snapshot() -> [String: Any] {
    guard let path = lockPath else { return ["userPresent": false] }
    let descriptor = open(path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard descriptor != -1 else { return ["userPresent": false] }
    defer { close(descriptor) }
    let result = flock(descriptor, LOCK_EX | LOCK_NB)
    let appIsPresent = result != 0 && errno == EWOULDBLOCK
    if result == 0 { _ = flock(descriptor, LOCK_UN) }
    return ["userPresent": appIsPresent && (defaults?.bool(forKey: "userPresent") ?? false),
      "activeConversation": appIsPresent ? defaults?.dictionary(forKey: "activeConversation") as Any : NSNull()]
  }
}

/** Lifecycle updates and asynchronous contention retries run on the main thread. */
final class NotificationPresenceLock {
  private var descriptor: Int32 = -1
  private var generation: UInt = 0
  private var retry: DispatchWorkItem?

  @discardableResult
  func setPresent(_ present: Bool, path: String?, onAcquired: (() -> Void)? = nil) -> Bool {
    generation &+= 1
    retry?.cancel()
    retry = nil
    guard present else {
      release()
      return false
    }
    if descriptor != -1 { return true }
    guard let path else { return false }
    return acquire(path: path, generation: generation, delay: 0.02, onAcquired: onAcquired)
  }

  private func acquire(path: String, generation: UInt, delay: TimeInterval, onAcquired: (() -> Void)?) -> Bool {
    let candidate = open(path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard candidate != -1 else { return false }
    guard flock(candidate, LOCK_EX | LOCK_NB) == 0 else {
      let contended = errno == EWOULDBLOCK
      close(candidate)
      if contended {
        // The extension's snapshot briefly takes this lock. Yield rather than
        // blocking the main thread, and invalidate all retries on backgrounding.
        let work = DispatchWorkItem { [weak self] in
          guard let self, self.generation == generation else { return }
          self.retry = nil
          if self.acquire(path: path, generation: generation, delay: min(delay * 2, 0.5), onAcquired: onAcquired) {
            onAcquired?()
          }
        }
        retry = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
      }
      return false
    }
    descriptor = candidate
    return true
  }

  private func release() {
    guard descriptor != -1 else { return }
    _ = flock(descriptor, LOCK_UN)
    close(descriptor)
    descriptor = -1
  }

  deinit {
    retry?.cancel()
    release()
  }
}

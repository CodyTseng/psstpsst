import Darwin
import Foundation

@main
struct PresenceLockHarness {
  static func main() throws {
    let path = CommandLine.arguments[1]
    if CommandLine.arguments.count > 2 {
      let descriptor = open(path, O_RDWR)
      precondition(descriptor != -1)
      defer { close(descriptor) }
      let result = flock(descriptor, LOCK_EX | LOCK_NB)
      if result == 0 {
        _ = flock(descriptor, LOCK_UN)
        print("available")
      } else {
        precondition(errno == EWOULDBLOCK)
        print("held")
      }
      return
    }

    func probe() throws -> String {
      let process = Process()
      let output = Pipe()
      process.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
      process.arguments = [path, "probe"]
      process.standardOutput = output
      try process.run()
      process.waitUntilExit()
      precondition(process.terminationStatus == 0)
      return String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)!
        .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    let presence = NotificationPresenceLock()
    // A background launch must neither create nor hold the presence lock.
    precondition(!presence.setPresent(false, path: path))
    precondition(!FileManager.default.fileExists(atPath: path))
    for _ in 0..<20 {
      precondition(presence.setPresent(true, path: path))
      precondition(presence.setPresent(true, path: path))
      let active = try probe()
      precondition(active == "held")

      let contender = NotificationPresenceLock()
      precondition(!contender.setPresent(true, path: path))
      precondition(!presence.setPresent(false, path: path))
      precondition(!presence.setPresent(false, path: path))
      let background = try probe()
      precondition(background == "available")

      // A failed contender must be able to acquire after the owner backgrounds.
      precondition(contender.setPresent(true, path: path))
      precondition(!contender.setPresent(false, path: path))
    }
    precondition(!presence.setPresent(true, path: nil))
    precondition(!presence.setPresent(true, path: path + "/missing/lock"))
    do {
      let transient = NotificationPresenceLock()
      precondition(transient.setPresent(true, path: path))
    }
    let released = try probe()
    precondition(released == "available")

    func pump(until done: () -> Bool, timeout: TimeInterval = 2) {
      let deadline = Date().addingTimeInterval(timeout)
      while !done() && Date() < deadline {
        RunLoop.main.run(until: Date().addingTimeInterval(0.01))
      }
      precondition(done())
    }

    let extensionProbe = NotificationPresenceLock()
    precondition(extensionProbe.setPresent(true, path: path))
    var recovered = false
    precondition(!presence.setPresent(true, path: path) { recovered = true })
    // Let multiple asynchronous attempts encounter contention before it clears.
    RunLoop.main.run(until: Date().addingTimeInterval(0.08))
    precondition(!recovered)
    precondition(!extensionProbe.setPresent(false, path: path))
    pump(until: { recovered })
    let recoveredLock = try probe()
    precondition(recoveredLock == "held")
    precondition(!presence.setPresent(false, path: path))

    precondition(extensionProbe.setPresent(true, path: path))
    var cancelledRetryRan = false
    precondition(!presence.setPresent(true, path: path) { cancelledRetryRan = true })
    precondition(!presence.setPresent(false, path: path))
    precondition(!extensionProbe.setPresent(false, path: path))
    RunLoop.main.run(until: Date().addingTimeInterval(0.1))
    precondition(!cancelledRetryRan)
    let backgroundLock = try probe()
    precondition(backgroundLock == "available")

    // A new foreground session must not publish an earlier session's callback.
    precondition(extensionProbe.setPresent(true, path: path))
    precondition(!presence.setPresent(true, path: path) { cancelledRetryRan = true })
    precondition(!presence.setPresent(false, path: path))
    var resumed = false
    precondition(!presence.setPresent(true, path: path) { resumed = true })
    precondition(!extensionProbe.setPresent(false, path: path))
    pump(until: { resumed })
    precondition(!cancelledRetryRan)
    precondition(!presence.setPresent(false, path: path))

    // Permanent open failures must not schedule foreground recovery callbacks.
    var invalidPathRecovered = false
    precondition(!presence.setPresent(true, path: path + "/missing/lock") { invalidPathRecovered = true })
    RunLoop.main.run(until: Date().addingTimeInterval(0.1))
    precondition(!invalidPathRecovered)
    print("ok")
  }
}

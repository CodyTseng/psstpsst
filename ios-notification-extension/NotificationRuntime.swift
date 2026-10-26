import CryptoKit
import Foundation
import JavaScriptCore
import Security
import SQLite3

/** A fresh, serial JSContext owns one bounded notification job. */
final class NotificationRuntime: NSObject, URLSessionDataDelegate, URLSessionWebSocketDelegate {
  private let databaseLocation: (() throws -> (String, NSNumber))?
  private let scriptLoader: ((String) throws -> String)?
  private let credentialAccess: ((String, [Any]) throws -> Any)?

  init(databaseLocation: (() throws -> (String, NSNumber))? = nil,
    scriptLoader: ((String) throws -> String)? = nil,
    credentialAccess: ((String, [Any]) throws -> Any)? = nil) {
    self.databaseLocation = databaseLocation
    self.scriptLoader = scriptLoader
    self.credentialAccess = credentialAccess
    super.init()
  }

  private lazy var keyVault: NativeKeyVault = {
    guard let credentials = self.credentialAccess else { return NativeKeyVault() }
    return NativeKeyVault(read: { try credentials("keyGet", [$0]) as? String },
      write: { _ = try credentials("keySet", [$0, $1]) }, remove: { _ = try credentials("keyDelete", [$0]) })
  }()

  private static let executionGate = DispatchSemaphore(value: 1)
  private var ownsExecutionGate = false
  private var deadline = Date()
  private let queue = DispatchQueue(label: "chat.psstpsst.notification-runtime", qos: .userInitiated)
  private var context: JSContext?
  private var database: OpaquePointer?
  private var finished = false
  private var complete: (([String: Any]?) -> Void)?
  private var serial = 0
  private var timers: [Int: (work: DispatchWorkItem, callback: JSValue)] = [:]
  private var fetches: [Int: (callback: JSValue, body: Data, response: HTTPURLResponse?)] = [:]
  private var sockets: [Int: (task: URLSessionWebSocketTask, callback: JSValue)] = [:]
  private var sessionStarted = false
  private lazy var session: URLSession = {
    self.sessionStarted = true
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 12
    configuration.timeoutIntervalForResource = 20
    configuration.urlCache = nil
    return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
  }()

  func start(payload: [AnyHashable: Any], completion: @escaping ([String: Any]?) -> Void) {
    deadline = Date().addingTimeInterval(24)
    queue.async {
      self.complete = completion
      guard Self.executionGate.wait(timeout: .now() + max(0, self.deadline.timeIntervalSinceNow)) == .success else { self.finish(nil); return }
      self.ownsExecutionGate = true
      do {
        guard self.deadline > Date() else { throw self.failure() }
        try self.openDatabase()
        guard let context = JSContext() else { throw self.failure() }
        self.context = context
        context.exceptionHandler = { [weak self] _, _ in self?.finish(nil) }
        self.installBridge(context)
        for file in ["bootstrap", "processor"] {
          if let loader = self.scriptLoader {
            context.evaluateScript(try loader(file))
          } else {
            guard let url = Bundle.main.url(forResource: file, withExtension: "js") else { throw self.failure() }
            context.evaluateScript(try String(contentsOf: url, encoding: .utf8), withSourceURL: url)
          }
          if self.finished { return }
        }
        let data = try JSONSerialization.data(withJSONObject: payload)
        guard data.count <= 8_192, let serialized = String(data: data, encoding: .utf8) else { throw self.failure() }
        context.objectForKeyedSubscript("PsstPsstNotification")?.invokeMethod("receive", withArguments: [serialized])
      } catch { self.finish(nil) }
    }
  }

  func stop() { queue.async { self.finish(nil) } }

  private func openDatabase() throws {
    let path: String
    let expected: NSNumber
    if let location = databaseLocation {
      (path, expected) = try location()
    } else {
      guard let group = Bundle.main.object(forInfoDictionaryKey: "PsstPsstAppGroup") as? String,
        let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
        let version = Bundle.main.object(forInfoDictionaryKey: "PsstPsstSchemaVersion") as? NSNumber
      else { throw failure() }
      path = container.appendingPathComponent("SQLite/psstpsst.db").path
      expected = version
    }
    // Never create a second empty database, run migrations or upgrade beyond the app.
    guard sqlite3_open_v2(path, &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else { throw failure() }
    sqlite3_busy_timeout(database, 1_000)
    try exec("PRAGMA foreign_keys = ON")
    let rows = try query("SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1", [], objects: false)
    guard let current = (rows.first as? [Any])?.first as? NSNumber, current == expected
    else { throw failure() }
  }

  private func installBridge(_ context: JSContext) {
    context.setObject(deadline.timeIntervalSince1970 * 1000, forKeyedSubscript: "__deadlineTime" as NSString)
    context.setObject(SharedNotificationContext.snapshot(), forKeyedSubscript: "__receiveContext" as NSString)
    context.setObject(Locale.preferredLanguages.first ?? "en", forKeyedSubscript: "__locale" as NSString)
    let complete: @convention(block) (String) -> Void = { [weak self] value in
      guard let data = value.data(using: .utf8), let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { self?.finish(nil); return }
      self?.finish(result)
    }
    context.setObject(complete, forKeyedSubscript: "__complete" as NSString)
    let call: @convention(block) (String, [Any], JSValue) -> Void = { [weak self] method, args, callback in
      self?.queue.async { [weak self] in
        guard let self, !self.finished else { return }
        do { callback.call(withArguments: [NSNull(), try self.call(method, args)]) }
        catch { callback.call(withArguments: ["Notification I/O unavailable", NSNull()]) }
      }
    }
    context.setObject(call, forKeyedSubscript: "__nativeCall" as NSString)
    let encode: @convention(block) (String) -> [UInt8] = { Array($0.utf8) }
    let decode: @convention(block) ([UInt8]) -> String = { String(decoding: $0, as: UTF8.self) }
    context.setObject(encode, forKeyedSubscript: "__encodeUTF8" as NSString)
    context.setObject(decode, forKeyedSubscript: "__decodeUTF8" as NSString)
    let random: @convention(block) (Int) -> [UInt8] = { [weak self] count in
      guard (0...65536).contains(count) else { return [] }
      var bytes = [UInt8](repeating: 0, count: count)
      guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else {
        self?.context?.exception = JSValue(newErrorFromMessage: "Random source unavailable", in: self?.context)
        return []
      }
      return bytes
    }
    context.setObject(random, forKeyedSubscript: "__randomBytes" as NSString)
    let base64Encode: @convention(block) (String) -> String = { Data($0.utf16.map { UInt8(truncatingIfNeeded: $0) }).base64EncodedString() }
    let base64Decode: @convention(block) (String) -> String = { String(data: Data(base64Encoded: $0) ?? Data(), encoding: .isoLatin1) ?? "" }
    context.setObject(base64Encode, forKeyedSubscript: "__base64Encode" as NSString)
    context.setObject(base64Decode, forKeyedSubscript: "__base64Decode" as NSString)
    let parseURL: @convention(block) (String, String) -> Any = { value, base in
      guard let url = URL(string: value, relativeTo: base.isEmpty ? nil : URL(string: base))?.absoluteURL,
        let components = URLComponents(url: url, resolvingAgainstBaseURL: true), let scheme = components.scheme,
        let host = components.host else { return NSNull() }
      return ["protocol": "\(scheme):", "host": host + (components.port.map { ":\($0)" } ?? ""),
        "pathname": components.percentEncodedPath.isEmpty ? "/" : components.percentEncodedPath,
        "search": components.percentEncodedQuery.map { "?\($0)" } ?? "",
        "hash": components.percentEncodedFragment.map { "#\($0)" } ?? ""]
    }
    context.setObject(parseURL, forKeyedSubscript: "__parseURL" as NSString)
    let timer: @convention(block) (JSValue, Double) -> Int = { [weak self] callback, delay in
      guard let self else { return 0 }
      self.serial += 1
      let id = self.serial
      let work = DispatchWorkItem { [weak self] in
        guard let self, !self.finished, let timer = self.timers.removeValue(forKey: id) else { return }
        timer.callback.call(withArguments: [])
      }
      self.timers[id] = (work, callback)
      self.queue.asyncAfter(deadline: .now() + min(max(delay, 0), 2_147_483_647) / 1000, execute: work)
      return id
    }
    let clear: @convention(block) (Int) -> Void = { [weak self] id in self?.timers.removeValue(forKey: id)?.work.cancel() }
    context.setObject(timer, forKeyedSubscript: "__setTimer" as NSString)
    context.setObject(clear, forKeyedSubscript: "__clearTimer" as NSString)
    let fetch: @convention(block) (String, String, [String: String], JSValue, JSValue) -> Int = { [weak self] url, method, headers, body, callback in
      guard let self, let url = URL(string: url), url.scheme == "https" else { return 0 }
      var request = URLRequest(url: url)
      request.httpMethod = method
      request.allHTTPHeaderFields = headers
      if !body.isNull && !body.isUndefined { request.httpBody = body.toString().data(using: .utf8) }
      let task = self.session.dataTask(with: request)
      self.fetches[task.taskIdentifier] = (callback, Data(), nil)
      task.resume()
      return task.taskIdentifier
    }
    let cancelFetch: @convention(block) (Int) -> Void = { [weak self] id in
      self?.session.getAllTasks { tasks in tasks.first { $0.taskIdentifier == id }?.cancel() }
    }
    context.setObject(fetch, forKeyedSubscript: "__fetch" as NSString)
    context.setObject(cancelFetch, forKeyedSubscript: "__cancelFetch" as NSString)
    let openSocket: @convention(block) (String, JSValue) -> Int = { [weak self] value, callback in
      guard let self, let url = URL(string: value), url.scheme == "wss" else { return 0 }
      let task = self.session.webSocketTask(with: url)
      task.maximumMessageSize = 1_048_576
      self.sockets[task.taskIdentifier] = (task, callback)
      task.resume()
      self.readSocket(task)
      return task.taskIdentifier
    }
    let sendSocket: @convention(block) (Int, String) -> Void = { [weak self] id, message in
      self?.sockets[id]?.task.send(.string(message)) { _ in }
    }
    let closeSocket: @convention(block) (Int) -> Void = { [weak self] id in
      self?.sockets[id]?.task.cancel(with: .normalClosure, reason: nil)
    }
    context.setObject(openSocket, forKeyedSubscript: "__openSocket" as NSString)
    context.setObject(sendSocket, forKeyedSubscript: "__sendSocket" as NSString)
    context.setObject(closeSocket, forKeyedSubscript: "__closeSocket" as NSString)
  }

  private func call(_ method: String, _ args: [Any]) throws -> Any {
    switch method {
    case "uuid": return UUID().uuidString.lowercased()
    case "sha256": return SHA256.hash(data: Data(args[0] as! [UInt8])).map { String(format: "%02x", $0) }.joined()
    case "exec": try exec(args[0] as! String); return NSNull()
    case "sql":
      let rows = try query(args[0] as! String, args[1] as! [Any], objects: false)
      let method = args[2] as! String
      return ["rows": method == "get" ? rows.first ?? NSNull() : rows]
    case "query": return try query(args[0] as! String, args[1] as! [Any], objects: true)
    case "vault": return try keyVault.executeNotification(args[0] as! String)
    default: throw failure()
    }
  }

  private func exec(_ sql: String) throws {
    guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw failure() }
  }

  private func query(_ sql: String, _ params: [Any], objects: Bool) throws -> [Any] {
    var statement: OpaquePointer?
    guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else { throw failure() }
    defer { sqlite3_finalize(statement) }
    let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    for (index, value) in params.enumerated() {
      let position = Int32(index + 1)
      let status: Int32
      if value is NSNull { status = sqlite3_bind_null(statement, position) }
      else if let number = value as? NSNumber { status = sqlite3_bind_double(statement, position, number.doubleValue) }
      else if let string = value as? String { status = sqlite3_bind_text(statement, position, string, -1, transient) }
      else { throw failure() }
      guard status == SQLITE_OK else { throw failure() }
    }
    var rows: [Any] = []
    var status = sqlite3_step(statement)
    while status == SQLITE_ROW {
      var values: [Any] = []
      var record: [String: Any] = [:]
      for index in 0..<sqlite3_column_count(statement) {
        let value: Any
        switch sqlite3_column_type(statement, index) {
        case SQLITE_INTEGER: value = NSNumber(value: sqlite3_column_int64(statement, index))
        case SQLITE_FLOAT: value = NSNumber(value: sqlite3_column_double(statement, index))
        case SQLITE_TEXT: value = String(cString: sqlite3_column_text(statement, index))
        case SQLITE_NULL: value = NSNull()
        default: throw failure()
        }
        values.append(value)
        record[String(cString: sqlite3_column_name(statement, index))] = value
      }
      rows.append(objects ? record : values)
      // Core intake queries are bounded; never let accidental history reads exhaust the extension.
      guard rows.count <= 10_000 else { throw failure() }
      status = sqlite3_step(statement)
    }
    guard status == SQLITE_DONE else { throw failure() }
    return rows
  }

  private func finish(_ result: [String: Any]?) {
    guard !finished else { return }
    finished = true
    keyVault.clearMemory()
    timers.values.forEach { $0.work.cancel() }
    timers.removeAll()
    if sessionStarted { session.invalidateAndCancel() }
    fetches.removeAll()
    sockets.removeAll()
    if let database, sqlite3_total_changes(database) > 0 { SharedNotificationContext.publishDatabaseChanged() }
    if let database { sqlite3_exec(database, "ROLLBACK", nil, nil, nil); sqlite3_close(database) }
    database = nil
    context?.exceptionHandler = nil
    context = nil
    let callback = complete
    complete = nil
    if ownsExecutionGate { ownsExecutionGate = false; Self.executionGate.signal() }
    callback?(result)
  }

  private func failure() -> NSError { NSError(domain: "PsstPsstNotificationRuntime", code: 1) }

  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    // Never forward account-authenticated NIP-98 requests to a redirect target.
    completionHandler(nil)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    queue.async {
      guard !self.finished, response.expectedContentLength <= 1_048_576 else { completionHandler(.cancel); return }
      self.fetches[dataTask.taskIdentifier]?.response = response as? HTTPURLResponse
      completionHandler(.allow)
    }
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    queue.async {
      guard !self.finished, var fetch = self.fetches[dataTask.taskIdentifier] else { return }
      if fetch.body.count + data.count > 1_048_576 { dataTask.cancel(); return }
      fetch.body.append(data)
      self.fetches[dataTask.taskIdentifier] = fetch
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    queue.async {
      guard !self.finished, let fetch = self.fetches.removeValue(forKey: task.taskIdentifier) else { return }
      guard error == nil, let response = fetch.response, let body = String(data: fetch.body, encoding: .utf8) else {
        fetch.callback.call(withArguments: ["Network request failed", NSNull()]); return
      }
      fetch.callback.call(withArguments: [NSNull(), ["status": response.statusCode, "body": body]])
    }
  }

  func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
    queue.async { if !self.finished { self.sockets[webSocketTask.taskIdentifier]?.callback.call(withArguments: ["open", ""]) } }
  }

  func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
    queue.async {
      guard !self.finished else { return }
      self.sockets.removeValue(forKey: webSocketTask.taskIdentifier)?.callback.call(withArguments: ["close", ""])
    }
  }

  private func readSocket(_ task: URLSessionWebSocketTask) {
    task.receive { [weak self] result in
      guard let self else { return }
      self.queue.async {
        guard !self.finished, let socket = self.sockets[task.taskIdentifier] else { return }
        switch result {
        case .success(.string(let message)): socket.callback.call(withArguments: ["message", message]); self.readSocket(task)
        case .success(.data(let data)): socket.callback.call(withArguments: ["message", String(decoding: data, as: UTF8.self)]); self.readSocket(task)
        case .failure: self.sockets.removeValue(forKey: task.taskIdentifier); socket.callback.call(withArguments: ["error", "Socket failed"]); socket.callback.call(withArguments: ["close", ""])
        @unknown default: task.cancel(with: .unsupportedData, reason: nil)
        }
      }
    }
  }
}

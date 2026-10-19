import ExpoModulesCore
import Foundation
import Network
import Security
import WebKit
import CryptoKit
import UserNotifications

private func exploreProfileID(_ value: String) -> UUID {
  let hex = SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  let parts = [0..<8, 8..<12, 12..<16, 16..<20, 20..<32].map { range in String(hex[hex.index(hex.startIndex, offsetBy: range.lowerBound)..<hex.index(hex.startIndex, offsetBy: range.upperBound)]) }
  return UUID(uuidString: parts.joined(separator: "-"))!
}

private let wrapperOrigin = "https://napplet.psstpsst.invalid/"

private func publicIP(_ value: String) -> Bool {
  if value.contains(":") {
    let lower = value.lowercased()
    return (lower.first == "2" || lower.first == "3") && !lower.hasPrefix("2001:db8:")
  }
  let parts = value.split(separator: ".").compactMap { Int($0) }
  guard parts.count == 4, parts.allSatisfy({ $0 >= 0 && $0 <= 255 }) else { return false }
  let a = parts[0], b = parts[1]
  return !(a == 0 || a == 10 || a == 127 || a >= 224 || (a == 169 && b == 254)
    || (a == 172 && b >= 16 && b <= 31) || (a == 192 && (b == 0 || b == 168))
    || (a == 100 && b >= 64 && b <= 127) || (a == 198 && b >= 18 && b <= 19))
}

/** Connect to the validated numeric address while retaining hostname TLS verification. */
private final class PublicFetch {
  private let queue = DispatchQueue(label: "psstpsst.napplet.resource")
  private var connection: NWConnection?
  private var terminal = false
  private var redirects = 0
  private var deadlineStarted = false
  private let promise: Promise
  private let finished: () -> Void
  init(_ promise: Promise, finished: @escaping () -> Void) { self.promise = promise; self.finished = finished }
  func cancel() { queue.async { self.finish(nil, "cancelled") } }
  private func finish(_ data: Data?, _ error: String? = nil) {
    guard !terminal else { return }; terminal = true
    connection?.stateUpdateHandler = nil; connection?.cancel(); connection = nil; finished()
    if let data { promise.resolve(data.base64EncodedString()) }
    else { promise.reject("ERR_RESOURCE", error ?? "network-error") }
  }
  func start(_ value: String, max: Int, accept: String = "*/*") {
    queue.async {
      guard !self.deadlineStarted else { return }
      self.deadlineStarted = true
      self.queue.asyncAfter(deadline: .now() + 20) { self.finish(nil, "timeout") }
    }
    DispatchQueue.global(qos: .utility).async {
      guard ["*/*", "application/json", "application/nostr+json"].contains(accept),
        value.utf8.count <= 4096, let url = URL(string: value), url.scheme == "https", let host = url.host,
        url.user == nil, url.password == nil, url.port == nil || url.port == 443,
        max > 0, max <= 26214400 else { self.queue.async { self.finish(nil, "blocked-by-policy") }; return }
      var hints = addrinfo()
      hints.ai_family = AF_UNSPEC; hints.ai_socktype = SOCK_STREAM
      var result: UnsafeMutablePointer<addrinfo>?
      guard getaddrinfo(host, "443", &hints, &result) == 0 else { self.queue.async { self.finish(nil) }; return }
      defer { freeaddrinfo(result) }
      var addresses: [String] = []
      var current = result
      while let item = current {
        var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        if getnameinfo(item.pointee.ai_addr, item.pointee.ai_addrlen, &buffer, socklen_t(buffer.count), nil, 0, NI_NUMERICHOST) == 0 {
          addresses.append(String(cString: buffer))
        }
        current = item.pointee.ai_next
      }
      guard let address = addresses.first, addresses.allSatisfy(publicIP) else { self.queue.async { self.finish(nil, "blocked-by-policy") }; return }
      self.queue.async {
        guard !self.terminal else { return }
        let tls = NWProtocolTLS.Options()
        sec_protocol_options_set_tls_server_name(tls.securityProtocolOptions, host)
        sec_protocol_options_set_min_tls_protocol_version(tls.securityProtocolOptions, .TLSv12)
        let connection = NWConnection(host: NWEndpoint.Host(address), port: 443, using: NWParameters(tls: tls))
        self.connection = connection
        var received = Data()
        func receive() {
          connection.receive(minimumIncompleteLength: 1, maximumLength: 32768) { data, _, complete, error in
            guard !self.terminal, self.connection === connection else { return }
            if let data { received.append(data) }
            guard received.count <= max + 65536 else { self.finish(nil, "too-large"); return }
            if error != nil { self.finish(nil); return }
            if complete {
              if let target = Self.redirect(received, from: url) {
                guard self.redirects < 5 else { self.finish(nil, "redirect-limit"); return }
                self.redirects += 1
                connection.stateUpdateHandler = nil
                self.connection = nil
                connection.cancel()
                self.start(target.absoluteString, max: max, accept: accept)
                return
              }
              do { self.finish(try Self.body(received, max: max)) }
              catch { self.finish(nil, "resource-unavailable") }
            } else { receive() }
          }
        }
        connection.stateUpdateHandler = { state in
          guard !self.terminal, self.connection === connection else { return }
          switch state {
          case .ready:
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
            let target = (components.percentEncodedPath.isEmpty ? "/" : components.percentEncodedPath) + (components.percentEncodedQuery.map { "?" + $0 } ?? "")
            let request = "GET \(target) HTTP/1.1\r\nHost: \(host)\r\nAccept: \(accept)\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n"
            connection.send(content: Data(request.utf8), completion: .contentProcessed { error in
              if error != nil { self.finish(nil) } else { receive() }
            })
          case .failed: self.finish(nil)
          default: break
          }
        }
        connection.start(queue: self.queue)
      }
    }
  }
  private static func redirect(_ data: Data, from url: URL) -> URL? {
    guard let boundary = data.range(of: Data("\r\n\r\n".utf8)), boundary.lowerBound <= 32768,
      let header = String(data: data[..<boundary.lowerBound], encoding: .utf8) else { return nil }
    let lines = header.components(separatedBy: "\r\n")
    guard let status = lines.first?.split(separator: " ").dropFirst().first,
      ["301", "302", "303", "307", "308"].contains(String(status)) else { return nil }
    for line in lines.dropFirst() {
      guard let colon = line.firstIndex(of: ":"), line[..<colon].lowercased() == "location" else { continue }
      let location = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
      return URL(string: location, relativeTo: url)?.absoluteURL
    }
    return nil
  }
  private static func body(_ data: Data, max: Int) throws -> Data {
    struct Invalid: Error {}
    guard let boundary = data.range(of: Data("\r\n\r\n".utf8)), boundary.lowerBound <= 32768,
      let header = String(data: data[..<boundary.lowerBound], encoding: .utf8) else { throw Invalid() }
    let lines = header.components(separatedBy: "\r\n")
    guard lines.first?.split(separator: " ").dropFirst().first == "200" else { throw Invalid() }
    let headers = lines.dropFirst().reduce(into: [String: String]()) { result, line in
      guard let colon = line.firstIndex(of: ":") else { return }
      result[String(line[..<colon]).lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces).lowercased()
    }
    guard headers["content-encoding"] == nil || headers["content-encoding"] == "identity" else { throw Invalid() }
    var body = Data(data[boundary.upperBound...])
    if headers["transfer-encoding"] == "chunked" {
      var output = Data()
      while true {
        guard let end = body.range(of: Data("\r\n".utf8)), let line = String(data: body[..<end.lowerBound], encoding: .ascii),
          let count = Int(line.split(separator: ";")[0], radix: 16), count >= 0, output.count + count <= max else { throw Invalid() }
        body = Data(body[end.upperBound...])
        if count == 0 { return output }
        guard body.count >= count + 2 else { throw Invalid() }
        output.append(body.prefix(count)); body = Data(body.dropFirst(count + 2))
      }
    }
    guard body.count <= max else { throw Invalid() }
    if let expected = headers["content-length"], Int(expected) != body.count { throw Invalid() }
    return body
  }
}

public class ExpoNappletModule: Module {
  private var requests: [String: PublicFetch] = [:]
  private let views = NSMapTable<NSString, NappletView>(keyOptions: .strongMemory, valueOptions: .weakMemory)
  private let lock = NSLock()
  public func definition() -> ModuleDefinition {
    Name("ExpoNapplet")
    AsyncFunction("notifyWebsiteAsync") { (application: String, title: String, body: String) async throws -> Bool in
      guard application.count <= 256, title.count <= 256, body.count <= 4096 else { return false }
      let center = UNUserNotificationCenter.current()
      let settings = await center.notificationSettings()
      guard [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) else { return false }
      let content = UNMutableNotificationContent()
      content.title = "\(application) · \(title)"; content.body = body; content.sound = .default
      content.userInfo = ["psstWebsite": true]
      let identifier = "psst-web-\(Int.random(in: 0..<32))"
      try await center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
      return true
    }
    Function("isAvailable") { true }
    Function("supportsResourceHeaders") { true }
    Function("isExploreAvailable") { true }
    AsyncFunction("fetchResourceAsync") { (id: String, url: String, max: Int, accept: String?, promise: Promise) in
      self.lock.lock()
      guard self.requests.count < 12 else { self.lock.unlock(); promise.reject("ERR_RESOURCE", "quota-exceeded"); return }
      let request = PublicFetch(promise) { [weak self] in
        guard let self else { return }
        self.lock.lock(); self.requests.removeValue(forKey: id); self.lock.unlock()
      }
      self.requests[id] = request; self.lock.unlock()
      request.start(url, max: max, accept: accept ?? "*/*")
    }
    AsyncFunction("cancelResourceAsync") { (id: String) in
      self.lock.lock(); let request = self.requests.removeValue(forKey: id); self.lock.unlock(); request?.cancel()
    }
    AsyncFunction("clearPageDataAsync") { (storageId: String, promise: Promise) in
      for view in self.views.objectEnumerator()?.allObjects as? [NappletView] ?? [] {
        if view.storageId == storageId { view.dispose() }
      }
      if #available(iOS 17.0, *) {
        WKWebsiteDataStore.remove(forIdentifier: exploreProfileID(storageId)) { error in
          if let error { promise.reject("ERR_EXPLORE", error.localizedDescription) } else { promise.resolve() }
        }
      } else { promise.resolve() }
    }.runOnQueue(.main)
    AsyncFunction("sendAsync") { (id: String, message: String) in self.views.object(forKey: id as NSString)?.reply(message) }.runOnQueue(.main)
    AsyncFunction("goBackAsync") { (id: String) -> Bool in
      self.views.object(forKey: id as NSString)?.navigateBack() ?? false
    }.runOnQueue(.main)
    AsyncFunction("closeAsync") { (id: String) in
      self.views.object(forKey: id as NSString)?.dispose(); self.views.removeObject(forKey: id as NSString)
    }.runOnQueue(.main)
    View(NappletView.self) {
      Events("onMessage")
      Prop("page") { (view: NappletView, page: String) in if !page.isEmpty { view.loadPage(page) } }
      Prop("html") { (view: NappletView, html: String) in view.load(html) }
      Prop("surfaceId") { (view: NappletView, id: String) in self.views.setObject(view, forKey: id as NSString) }
    }
  }
}

private final class MessageProxy: NSObject, WKScriptMessageHandler {
  weak var owner: NappletView?
  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.frameInfo.isMainFrame,
      let raw = message.body as? String, raw.utf8.count <= 1500000 else { return }
    guard let owner else { return }
    if owner.isExplore { owner.receive(raw, origin: message.frameInfo.securityOrigin) }
    else if message.frameInfo.securityOrigin.host == "napplet.psstpsst.invalid" { owner.onMessage(["message": raw]) }
  }
}

private final class ExploreFiles: NSObject, WKURLSchemeHandler {
  var files: [String: [String: String]] = [:]
  var network = false
  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    guard let url = urlSchemeTask.request.url else { return }
    let path = url.path
    let file = files[path] ?? (path.hasSuffix("/") ? files[path + "index.html"] : nil)
    guard let file, let body = file["body"], let data = Data(base64Encoded: body) else {
      urlSchemeTask.didFailWithError(NSError(domain: "Explore", code: 404)); return
    }
    let connections = network ? "https: http: wss: ws:" : ""
    let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": file["mime"] ?? "application/octet-stream",
      "Content-Security-Policy": "default-src 'self' data: blob: \(connections); script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: \(connections); style-src 'self' 'unsafe-inline' \(connections); worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'self'", "Referrer-Policy": "no-referrer"])!
    urlSchemeTask.didReceive(response); urlSchemeTask.didReceive(data); urlSchemeTask.didFinish()
  }
  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

final class NappletView: ExpoView, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, UIDocumentPickerDelegate {
  let onMessage = EventDispatcher()
  private let proxy = MessageProxy()
  private var web: WKWebView!
  private var html = ""
  private var browserRequests: [String: (Bool) -> Void] = [:]
  private var browserLabels: [String: String] = [:]
  private var scriptDialogs: [UUID: () -> Void] = [:]
  private var committedURL: URL?
  private var downloads: [ObjectIdentifier: (WKDownload, URL)] = [:]
  private var exports: [UIDocumentPickerViewController: URL] = [:]
  private func originURL(_ source: WKSecurityOrigin) -> URL? {
    URL(string: "\(source.protocol)://\(source.host)" + (source.port > 0 ? ":\(source.port)" : ""))
  }
  private func requestBrowser(_ action: String, url: String? = nil, resources: [String]? = nil, filename: String? = nil, principal: URL? = nil, completion: @escaping (Bool) -> Void = { _ in }) {
    guard isExplore, browserRequests.count < 16, let current = principal ?? committedURL ?? web?.url else { completion(false); return }
    let id = "browser:\(UUID().uuidString)"
    browserRequests[id] = completion
    var browser: [String: Any] = ["id": id, "action": action]
    if let url { browser["url"] = url }; if let resources { browser["resources"] = resources }; if let filename { browser["filename"] = filename }
    let origin = self.origin(current)
    let value: [String: Any] = ["type": "explore.browser", "document": document, "origin": origin, "url": current.absoluteString, "browser": browser]
    if let data = try? JSONSerialization.data(withJSONObject: value), let raw = String(data: data, encoding: .utf8) { onMessage(["message": raw]) }
  }
  private func cancelBrowser() { let pending = Array(browserRequests.values); browserRequests.removeAll(); pending.forEach { $0(false) } }
  private func presentBrowser(_ controller: UIViewController) {
    var owner = web?.window?.rootViewController
    while let presented = owner?.presentedViewController { owner = presented }
    owner?.present(controller, animated: true)
  }
  private func presentScript(_ alert: UIAlertController, id: UUID, cancel: @escaping () -> Void) {
    scriptDialogs[id] = { [weak alert] in alert?.dismiss(animated: false); cancel() }
    guard web?.window != nil else { scriptDialogs.removeValue(forKey: id)?(); return }
    presentBrowser(alert)
  }
  private func finishScript(_ id: UUID, action: () -> Void) {
    guard scriptDialogs.removeValue(forKey: id) != nil else { return }; action()
  }
  private func cancelScripts() { let pending = Array(scriptDialogs.values); scriptDialogs.removeAll(); pending.forEach { $0() } }
  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let id = UUID(), alert = UIAlertController(title: originURL(frame.securityOrigin)?.host, message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: browserLabels["ok"] ?? NSLocalizedString("OK", comment: ""), style: .default) { [weak self] _ in self?.finishScript(id) { completionHandler() } })
    presentScript(alert, id: id, cancel: completionHandler)
  }
  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let id = UUID(), alert = UIAlertController(title: originURL(frame.securityOrigin)?.host, message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: browserLabels["cancel"] ?? NSLocalizedString("Cancel", comment: ""), style: .cancel) { [weak self] _ in self?.finishScript(id) { completionHandler(false) } })
    alert.addAction(UIAlertAction(title: browserLabels["ok"] ?? NSLocalizedString("OK", comment: ""), style: .default) { [weak self] _ in self?.finishScript(id) { completionHandler(true) } })
    presentScript(alert, id: id) { completionHandler(false) }
  }
  func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
    let id = UUID(), alert = UIAlertController(title: originURL(frame.securityOrigin)?.host, message: prompt, preferredStyle: .alert)
    alert.addTextField { $0.text = defaultText }
    alert.addAction(UIAlertAction(title: browserLabels["cancel"] ?? NSLocalizedString("Cancel", comment: ""), style: .cancel) { [weak self] _ in self?.finishScript(id) { completionHandler(nil) } })
    alert.addAction(UIAlertAction(title: browserLabels["ok"] ?? NSLocalizedString("OK", comment: ""), style: .default) { [weak self, weak alert] _ in self?.finishScript(id) { completionHandler(alert?.textFields?.first?.text) } })
    presentScript(alert, id: id) { completionHandler(nil) }
  }
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let url = action.request.url { requestBrowser("window", url: url.absoluteString) }; return nil
  }
  func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
    guard frame.isMainFrame else { decisionHandler(.deny); return }
    let resources = type == .camera ? ["video"] : type == .microphone ? ["audio"] : ["video", "audio"]
    requestBrowser("permission", resources: resources, principal: originURL(origin)) { decisionHandler($0 ? .grant : .deny) }
  }
  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    let attachment = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().contains("attachment") == true
    if isExplore && response.isForMainFrame && (!response.canShowMIMEType || attachment) {
      requestBrowser("download", url: response.response.url?.absoluteString, filename: response.response.suggestedFilename) { decisionHandler($0 ? .download : .cancel) }
    } else { decisionHandler(.allow) }
  }
  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("psst-download-\(UUID().uuidString)", isDirectory: true)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let target = directory.appendingPathComponent(URL(fileURLWithPath: suggestedFilename).lastPathComponent)
    downloads[ObjectIdentifier(download)] = (download, target); completionHandler(target)
  }
  func downloadDidFinish(_ download: WKDownload) {
    guard let (_, file) = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
    let picker = UIDocumentPickerViewController(forExporting: [file], asCopy: true)
    picker.delegate = self; exports[picker] = file; presentBrowser(picker)
  }
  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    if let (_, file) = downloads.removeValue(forKey: ObjectIdentifier(download)) { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
    NSLog("[explore] Download failed: %@", error.localizedDescription)
  }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finishExport(controller) }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finishExport(controller) }
  private func finishExport(_ controller: UIDocumentPickerViewController) {
    if let file = exports.removeValue(forKey: controller) { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
  }
  private var lastReply = 0
  private var pageValue = ""
  private var pageURL: URL?
  private var pageRemote = false
  private var document = UUID().uuidString
  private let pageFiles = ExploreFiles()
  private(set) var storageId = ""
  var isExplore: Bool { !pageValue.isEmpty }
  private func origin(_ url: URL?) -> String {
    guard let url, let scheme = url.scheme, let host = url.host else { return "" }
    let port = url.port
    let suffix = port != nil && !(scheme == "https" && port == 443) && !(scheme == "http" && port == 80) ? ":\(port!)" : ""
    return "\(scheme)://\(host)\(suffix)"
  }
  private func emit(_ type: String, _ raw: String? = nil, sourceURL: URL? = nil) {
    let source = sourceURL ?? web.url ?? pageURL
    var envelope: [String: Any] = ["type": type, "document": document, "origin": origin(source), "url": source?.absoluteString ?? ""]
    if let raw { envelope["raw"] = raw }
    if type == "explore.error" { envelope["error"] = raw }
    if let bytes = try? JSONSerialization.data(withJSONObject: envelope), let text = String(data: bytes, encoding: .utf8) { onMessage(["message": text]) }
  }
  func receive(_ raw: String, origin source: WKSecurityOrigin) {
    guard let current = [web.url, committedURL].compactMap({ $0 }).first(where: { current in
      current.scheme == source.protocol && current.host == source.host &&
        ((current.port ?? (current.scheme == "https" ? 443 : current.scheme == "http" ? 80 : 0)) == source.port || source.port == 0 && current.port == nil)
    }) else { return }
    emit("explore.request", raw, sourceURL: current)
  }
  func loadPage(_ value: String) {
    guard web != nil, value != pageValue, let data = value.data(using: .utf8),
      let page = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let script = page["script"] as? String else { return }
    pageValue = value
    browserLabels = page["labels"] as? [String: String] ?? [:]
    storageId = page["storageId"] as? String ?? page["sourceId"] as? String ?? ""
    web.stopLoading(); web.configuration.userContentController.removeScriptMessageHandler(forName: "nappletHost")
    web.navigationDelegate = nil; web.removeFromSuperview()
    let configuration = WKWebViewConfiguration()
    if #available(iOS 17.0, *) { configuration.websiteDataStore = WKWebsiteDataStore(forIdentifier: exploreProfileID(storageId)) }
    else { configuration.websiteDataStore = .nonPersistent() }
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    configuration.setURLSchemeHandler(pageFiles, forURLScheme: "psst-explore")
    configuration.userContentController.add(proxy, name: "nappletHost")
    web = WKWebView(frame: bounds, configuration: configuration)
    web.isOpaque = false; web.backgroundColor = .clear; web.scrollView.backgroundColor = .clear
    web.navigationDelegate = self; web.uiDelegate = self; addSubview(web)
    pageRemote = page["url"] != nil
    let host = SHA256.hash(data: Data((page["sourceId"] as? String ?? "").utf8)).map { String(format: "%02x", $0) }.joined()
    pageURL = URL(string: page["url"] as? String ?? "psst-explore://\(host)/index.html")
    pageFiles.network = page["network"] as? Bool ?? false
    pageFiles.files = Dictionary(uniqueKeysWithValues: (page["files"] as? [[String: String]] ?? []).compactMap { file in file["path"].map { ($0, file) } })
    web.configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    committedURL = pageURL
    if let pageURL { web.load(URLRequest(url: pageURL)) }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.setURLSchemeHandler(pageFiles, forURLScheme: "psst-explore")
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    proxy.owner = self
    configuration.userContentController.add(proxy, name: "nappletHost")
    web = WKWebView(frame: .zero, configuration: configuration)
    web.isOpaque = false
    web.backgroundColor = .clear
    web.scrollView.backgroundColor = .clear
    web.navigationDelegate = self; web.uiDelegate = self
    addSubview(web)
  }
  override func layoutSubviews() { super.layoutSubviews(); web?.frame = bounds }
  func load(_ value: String) {
    guard web != nil, !value.isEmpty, !isExplore, value != html else { return }; html = value
    web.loadHTMLString(value, baseURL: URL(string: wrapperOrigin))
  }
  func reply(_ value: String) {
    guard let web else { return }
    guard let data = value.data(using: .utf8), let entries = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
    for envelope in entries {
      guard let serial = envelope["serial"] as? Int, serial > lastReply, let raw = envelope["message"] as? String else { continue }
      lastReply = serial
      if isExplore {
        guard let bytes = raw.data(using: .utf8), let response = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
          response["document"] as? String == document, let reply = response["reply"] as? [String: Any],
          let replyData = try? JSONSerialization.data(withJSONObject: reply), let replyText = String(data: replyData, encoding: .utf8) else { continue }
        if reply["type"] as? String == "browser.result", let id = reply["id"] as? String { browserRequests.removeValue(forKey: id)?(reply["result"] as? Bool ?? false); continue }
        web.callAsyncJavaScript("const reply = JSON.parse(raw); if(reply.type === 'theme' || window.__exploreDocumentToken === reply.nonce) { window.__exploreReceive && window.__exploreReceive(reply); }", arguments: ["raw": replyText], in: nil, in: .page, completionHandler: nil)
        continue
      }
      web.callAsyncJavaScript("window.__hostReceive && window.__hostReceive(JSON.parse(raw))", arguments: ["raw": raw], in: nil, in: .page, completionHandler: nil)
    }
  }

  func navigateBack() -> Bool {
    guard let web, let previous = web.backForwardList.backItem else { return false }
    web.go(to: previous)
    return true
  }
  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if isExplore {
      let target = action.request.url
      if action.shouldPerformDownload {
        requestBrowser("download", url: target?.absoluteString) { decisionHandler($0 ? .download : .cancel) }; return
      }
      let allowed = pageRemote ? ["http", "https"].contains(target?.scheme ?? "") : target?.scheme == "psst-explore" && target?.host == pageURL?.host
      if !allowed, let target { requestBrowser(["http", "https"].contains(target.scheme ?? "") ? "window" : "external", url: target.absoluteString) }
      decisionHandler(allowed ? .allow : .cancel); return
    }
    let url = action.request.url?.absoluteString ?? ""
    let localURL = url.components(separatedBy: "#")[0]
    let localNavigation = action.navigationType == .other || action.navigationType == .backForward
    decisionHandler(localNavigation && (localURL == wrapperOrigin || localURL == "about:blank" || localURL == "about:srcdoc") ? .allow : .cancel)
  }
  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    if isExplore { cancelBrowser();cancelScripts();document = UUID().uuidString; emit("explore.navigation") }
  }
  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) { committedURL = webView.url }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    let failure = error as NSError
    if failure.code != NSURLErrorCancelled && !(failure.domain == "WebKitErrorDomain" && failure.code == 102) { emit("explore.error", failure.localizedDescription) }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    if (error as NSError).code != NSURLErrorCancelled { emit("explore.error", error.localizedDescription) }
  }
  func dispose() {
    guard let view = web else { return }
    cancelBrowser(); cancelScripts()
    for (picker, file) in exports { picker.dismiss(animated: false); try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }; exports.removeAll()
    for (_, (download, file)) in downloads { download.cancel { _ in }; try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }; downloads.removeAll()
    view.isHidden = true
    view.stopLoading(); view.configuration.userContentController.removeScriptMessageHandler(forName: "nappletHost")
    view.removeFromSuperview(); web = nil
  }
  deinit { web?.configuration.userContentController.removeScriptMessageHandler(forName: "nappletHost") }
}

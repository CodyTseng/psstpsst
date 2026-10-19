import ExpoModulesCore
import Foundation
import Network
import Security
import WebKit
import CryptoKit

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

final class NappletView: ExpoView, WKNavigationDelegate, WKUIDelegate {
  let onMessage = EventDispatcher()
  private let proxy = MessageProxy()
  private var web: WKWebView!
  private var html = ""
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
  private func emit(_ type: String, _ raw: String? = nil) {
    var envelope: [String: Any] = ["type": type, "document": document, "origin": origin(web.url ?? pageURL), "url": (web.url ?? pageURL)?.absoluteString ?? ""]
    if let raw { envelope["raw"] = raw }
    if let bytes = try? JSONSerialization.data(withJSONObject: envelope), let text = String(data: bytes, encoding: .utf8) { onMessage(["message": text]) }
  }
  func receive(_ raw: String, origin source: WKSecurityOrigin) {
    guard let current = web.url, current.scheme == source.protocol, current.host == source.host,
      (current.port ?? (current.scheme == "https" ? 443 : current.scheme == "http" ? 80 : 0)) == source.port || source.port == 0 && current.port == nil else { return }
    emit("explore.request", raw)
  }
  func loadPage(_ value: String) {
    guard web != nil, value != pageValue, let data = value.data(using: .utf8),
      let page = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let script = page["script"] as? String else { return }
    pageValue = value
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
      let allowed = pageRemote ? ["http", "https"].contains(target?.scheme ?? "") : target?.scheme == "psst-explore" && target?.host == pageURL?.host
      decisionHandler(allowed ? .allow : .cancel); return
    }
    let url = action.request.url?.absoluteString ?? ""
    let localURL = url.components(separatedBy: "#")[0]
    let localNavigation = action.navigationType == .other || action.navigationType == .backForward
    decisionHandler(localNavigation && (localURL == wrapperOrigin || localURL == "about:blank" || localURL == "about:srcdoc") ? .allow : .cancel)
  }
  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
    if isExplore { document = UUID().uuidString; emit("explore.navigation") }
  }
  func dispose() {
    guard let view = web else { return }
    view.isHidden = true
    view.stopLoading(); view.configuration.userContentController.removeScriptMessageHandler(forName: "nappletHost")
    view.removeFromSuperview(); web = nil
  }
  deinit { web?.configuration.userContentController.removeScriptMessageHandler(forName: "nappletHost") }
}

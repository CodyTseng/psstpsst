import ExpoModulesCore
import Foundation
import Network
import Security
import WebKit

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
  func start(_ value: String, max: Int) {
    DispatchQueue.global(qos: .utility).async {
      guard let url = URL(string: value), url.scheme == "https", let host = url.host,
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
            guard !self.terminal else { return }
            if let data { received.append(data) }
            guard received.count <= max + 65536 else { self.finish(nil, "too-large"); return }
            if error != nil { self.finish(nil); return }
            if complete {
              do { self.finish(try Self.body(received, max: max)) }
              catch { self.finish(nil, "resource-unavailable") }
            } else { receive() }
          }
        }
        connection.stateUpdateHandler = { state in
          switch state {
          case .ready:
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
            let target = (components.percentEncodedPath.isEmpty ? "/" : components.percentEncodedPath) + (components.percentEncodedQuery.map { "?" + $0 } ?? "")
            let request = "GET \(target) HTTP/1.1\r\nHost: \(host)\r\nAccept: */*\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n"
            connection.send(content: Data(request.utf8), completion: .contentProcessed { error in
              if error != nil { self.finish(nil) } else { receive() }
            })
          case .failed: self.finish(nil)
          default: break
          }
        }
        connection.start(queue: self.queue)
        self.queue.asyncAfter(deadline: .now() + 20) { self.finish(nil, "timeout") }
      }
    }
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
    AsyncFunction("fetchResourceAsync") { (id: String, url: String, max: Int, promise: Promise) in
      self.lock.lock()
      guard self.requests.count < 12 else { self.lock.unlock(); promise.reject("ERR_RESOURCE", "quota-exceeded"); return }
      let request = PublicFetch(promise) { [weak self] in
        guard let self else { return }
        self.lock.lock(); self.requests.removeValue(forKey: id); self.lock.unlock()
      }
      self.requests[id] = request; self.lock.unlock()
      request.start(url, max: max)
    }
    AsyncFunction("cancelResourceAsync") { (id: String) in
      self.lock.lock(); let request = self.requests.removeValue(forKey: id); self.lock.unlock(); request?.cancel()
    }
    AsyncFunction("sendAsync") { (id: String, message: String) in self.views.object(forKey: id as NSString)?.reply(message) }.runOnQueue(.main)
    AsyncFunction("closeAsync") { (id: String) in
      self.views.object(forKey: id as NSString)?.dispose(); self.views.removeObject(forKey: id as NSString)
    }.runOnQueue(.main)
    View(NappletView.self) {
      Events("onMessage")
      Prop("html") { (view: NappletView, html: String) in view.load(html) }
      Prop("surfaceId") { (view: NappletView, id: String) in self.views.setObject(view, forKey: id as NSString) }
    }
  }
}

private final class MessageProxy: NSObject, WKScriptMessageHandler {
  weak var owner: NappletView?
  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == "napplet.psstpsst.invalid",
      let raw = message.body as? String, raw.utf8.count <= 1500000 else { return }
    owner?.onMessage(["message": raw])
  }
}

final class NappletView: ExpoView, WKNavigationDelegate, WKUIDelegate {
  let onMessage = EventDispatcher()
  private let proxy = MessageProxy()
  private var web: WKWebView!
  private var html = ""
  private var lastReply = 0
  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    proxy.owner = self
    configuration.userContentController.add(proxy, name: "nappletHost")
    web = WKWebView(frame: .zero, configuration: configuration)
    web.navigationDelegate = self; web.uiDelegate = self
    addSubview(web)
  }
  override func layoutSubviews() { super.layoutSubviews(); web?.frame = bounds }
  func load(_ value: String) {
    guard web != nil, value != html else { return }; html = value
    web.loadHTMLString(value, baseURL: URL(string: wrapperOrigin))
  }
  func reply(_ value: String) {
    guard let web else { return }
    guard let data = value.data(using: .utf8), let entries = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
    for envelope in entries {
      guard let serial = envelope["serial"] as? Int, serial > lastReply, let raw = envelope["message"] as? String else { continue }
      lastReply = serial
      web.callAsyncJavaScript("window.__hostReceive && window.__hostReceive(JSON.parse(raw))", arguments: ["raw": raw], in: nil, in: .page, completionHandler: nil)
    }
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    let url = action.request.url?.absoluteString ?? ""
    decisionHandler(action.navigationType == .other && (url == wrapperOrigin || url == "about:blank" || url == "about:srcdoc") ? .allow : .cancel)
  }
  func dispose() {
    guard let view = web else { return }
    view.stopLoading(); view.configuration.userContentController.removeScriptMessageHandler(forName: "nappletHost")
    view.loadHTMLString("", baseURL: nil); view.removeFromSuperview(); web = nil
  }
  deinit { web?.configuration.userContentController.removeScriptMessageHandler(forName: "nappletHost") }
}

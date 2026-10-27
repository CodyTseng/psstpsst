import Foundation

enum LocalRelayEvents {
  private static let name = Notification.Name("psstpsst.localRelayEvent")

  static func publish(_ message: String) {
    NotificationCenter.default.post(name: name, object: nil, userInfo: ["message": message])
  }

  static func subscribe(_ listener: @escaping (String) -> Void) -> NSObjectProtocol {
    NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { notification in
      if let message = notification.userInfo?["message"] as? String { listener(message) }
    }
  }

  static func unsubscribe(_ observer: NSObjectProtocol) {
    NotificationCenter.default.removeObserver(observer)
  }
}

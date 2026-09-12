import ExpoModulesCore
import UIKit
import UserNotifications

public final class LocalNotificationsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    UNUserNotificationCenter.current().delegate = LocalNotificationDelegate.shared
    return true
  }
}

private final class LocalNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
  static let shared = LocalNotificationDelegate()

  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    // The app owns foreground rendering; a delivery racing with resume must not show stale content.
    completionHandler([])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    // Opening the app is sufficient: local aggregates contain no account or conversation identifiers.
    completionHandler()
  }
}

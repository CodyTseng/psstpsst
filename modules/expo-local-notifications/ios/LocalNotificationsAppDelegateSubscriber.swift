import ExpoModulesCore
import UIKit
import UserNotifications

public final class LocalNotificationsAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func applicationDidBecomeActive(_ application: UIApplication) {
    SharedNotificationContext.setUserPresent(true)
  }

  public func applicationWillResignActive(_ application: UIApplication) {
    SharedNotificationContext.setUserPresent(false)
  }

  public func applicationDidEnterBackground(_ application: UIApplication) {
    SharedNotificationContext.setUserPresent(false)
  }

  public func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    PushRegistration.shared.receive(deviceToken)
  }

  public func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    PushRegistration.shared.fail(error)
  }

  public func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    SharedNotificationContext.startMainProcess()
    SharedNotificationContext.setUserPresent(application.applicationState == .active)
    UNUserNotificationCenter.current().delegate = LocalNotificationDelegate.shared
    return true
  }
}

private final class LocalNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
  static let shared = LocalNotificationDelegate()

  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    // The app owns foreground rendering; a delivery racing with resume must not show stale content.
    completionHandler(notification.request.content.userInfo["psstWebsite"] as? Bool == true ? [.banner, .sound] : [])
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    // Opening the app is sufficient: local aggregates contain no account or conversation identifiers.
    completionHandler()
  }
}

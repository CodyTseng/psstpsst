#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <node_api.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  napi_deferred deferred;
  bool granted;
  char *error;
} PermissionResult;

static void Finalize(napi_env env, void *data, void *hint) {
  PermissionResult *result = data;
  free(result->error);
  free(result);
}

// Apple completes on a private queue; settle the promise only on Node's thread.
static void Settle(napi_env env, napi_value callback, void *context, void *data) {
  if (!env) return;
  PermissionResult *result = context;
  napi_value value;
  if (result->error) {
    napi_value message;
    napi_create_string_utf8(env, result->error, NAPI_AUTO_LENGTH, &message);
    napi_create_error(env, NULL, message, &value);
    napi_reject_deferred(env, result->deferred, value);
  } else {
    napi_get_boolean(env, result->granted, &value);
    napi_resolve_deferred(env, result->deferred, value);
  }
}

static void Complete(napi_threadsafe_function completion, PermissionResult *result,
                     bool granted, NSString *error) {
  result->granted = granted;
  if (error) result->error = strdup(error.UTF8String);
  // A closing environment releases our acquisition itself.
  if (napi_call_threadsafe_function(completion, NULL, napi_tsfn_nonblocking) != napi_closing) {
    napi_release_threadsafe_function(completion, napi_tsfn_release);
  }
}

static bool IsGranted(UNNotificationSettings *settings) {
  return settings.authorizationStatus == UNAuthorizationStatusAuthorized ||
         settings.authorizationStatus == UNAuthorizationStatusProvisional;
}

static napi_value Permission(napi_env env, bool request) {
  PermissionResult *result = calloc(1, sizeof(PermissionResult));
  if (!result) {
    napi_throw_error(env, NULL, "Unable to allocate notification permission request");
    return NULL;
  }
  napi_value promise;
  if (napi_create_promise(env, &result->deferred, &promise) != napi_ok) {
    free(result);
    return NULL;
  }
  napi_value name;
  napi_create_string_utf8(env, "notificationPermission", NAPI_AUTO_LENGTH, &name);
  napi_threadsafe_function completion;
  if (napi_create_threadsafe_function(env, NULL, NULL, name, 0, 1, result,
                                     Finalize, result, Settle, &completion) != napi_ok) {
    free(result);
    napi_throw_error(env, NULL, "Unable to create notification permission callback");
    return NULL;
  }
  @try {
    UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
    [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
      if (!request || settings.authorizationStatus != UNAuthorizationStatusNotDetermined) {
        Complete(completion, result, IsGranted(settings), nil);
        return;
      }
      [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert |
                                               UNAuthorizationOptionSound |
                                               UNAuthorizationOptionBadge)
                           completionHandler:^(BOOL granted, NSError *error) {
        if (error) {
          Complete(completion, result, false, error.localizedDescription);
          return;
        }
        [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *updated) {
          Complete(completion, result, IsGranted(updated), nil);
        }];
      }];
    }];
  } @catch (NSException *exception) {
    Complete(completion, result, false, exception.reason);
  }
  return promise;
}

static napi_value HasPermission(napi_env env, napi_callback_info info) {
  return Permission(env, false);
}

static napi_value RequestPermission(napi_env env, napi_callback_info info) {
  return Permission(env, true);
}

NAPI_MODULE_INIT() {
  napi_property_descriptor methods[] = {
    {"hasPermission", NULL, HasPermission, NULL, NULL, NULL, napi_default, NULL},
    {"requestPermission", NULL, RequestPermission, NULL, NULL, NULL, napi_default, NULL},
  };
  napi_define_properties(env, exports, 2, methods);
  return exports;
}

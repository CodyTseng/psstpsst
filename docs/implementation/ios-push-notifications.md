# iOS APNs notifications

The iOS notification toggle is opt-in. A new installation does not request
permission, obtain an APNs token or register with a relay until the user enables
it. An existing explicit enabled preference is preserved. Android and Electron
retain their local delivery adapters. iOS does not define or register periodic
background polls; its native build excludes the background-task and task-manager
modules and removes their background-processing capability. APNs handles
background delivery, while opening the app resumes normal relay sync.

The iOS toggle is unavailable until the current account's saved message relays
include `wss://relay.psstpsst.chat/`. Removing the relay preserves an enabled
preference while disabling the control. Inline guidance opens message-relay
settings with the required address prefilled; adding and saving remain explicit.

## Registration

The project-owned native module exposes APNs registration and token changes
through the push-notification port. Registration requires the bundled notification
processor; an older native binary cannot enable the new push integration through
an OTA JavaScript update alone.

The adapter reads the signed APNs environment using
[`expo-application`](https://docs.expo.dev/versions/v57.0.0/sdk/application/).
Store installations without an embedded profile use production APNs; unknown
or unconfigured topic/environment combinations fail before token acquisition.
Development `chat.psstpsst.app.dev` uses sandbox and production
`chat.psstpsst.app` uses production. Production APNs for the `.dev` topic is not
configured by the relay. JavaScript environment flags do not select APNs.

Account-configured root `wss://` inbox relays are discovered using NIP-11. Relays
must advertise NIP-98 and `psstpsst.push.version: 1`. PUT/DELETE use the account
identity signer, exact URL/method, exact body SHA-256, standard Base64, a fresh
mutation nonce, and empty 204 success. Requests time out after 12 seconds;
transient failures have three bounded retries with backoff and jitter.

Every stored account is eligible. Token changes, account/relay changes,
foreground activation and restored connectivity reconcile durable registration
state. Messaging credentials migrate to shared Keychain before token acquisition.
Disabling unregisters APNs and revokes relay registrations. Write-ahead state
retains uncertain PUTs and failed DELETEs across restarts. Account removal revokes
before deleting signing material; offline revocation failure preserves the
account for retry. A durable removal marker prevents independent receivers from
recreating account rows during cleanup.

## Receiving while the app is stopped

1. iOS starts `PsstPsstNotificationService`, independently of the main app.
2. A fresh JavaScriptCore context installs asynchronous native database,
   Keychain, network and crypto primitives, then loads the compiled shared
   TypeScript processor. React Native and Expo are excluded from this bundle.
3. `resolveApnsGiftWrap` identifies the receiving local account from `p` and
   performs an indexed account-scoped processed-ID lookup. A completed event
   skips signing, HTTP, decryption, persistence and notification evaluation.
4. Inline events continue directly. ID references fetch the complete event from
   `https://relay.psstpsst.chat/v1/events/{event_id}` with account-signed NIP-98
   GET authorization. No request body or redirect is allowed. The returned ID
   must match; a second processed lookup absorbs concurrent WebSocket delivery.
5. `DmService.receiveGiftWrap` receives explicit account, keys, source relays,
   presence, active-conversation and cancellation context. It invokes the same
   receiver used by live subscriptions, history and recovery. APNs always records
   `wss://relay.psstpsst.chat/` as its source.
6. Common intake verifies the outer event, recipient, signed seal, author binding
   and canonical rumor ID, tries retained encryption keys, applies blocking and
   direct/group admission, then maintains messages and conversation read models
   through the existing storage code. SQLite uniqueness determines the winning
   insertion across processes and envelopes. Failed or unavailable decryption
   is not permanently marked processed.
7. Only freshly inserted eligible rumors reach the shared notification policy:
   enabled preference, user presence, quiet hours, conversation acceptance,
   mute, and authorship. A valid reaction alerts only for a visible message authored
   by the local account, with no change to message unread counts. Muted,
   disabled, or quiet-hours arrivals still persist; blocked messages do not. There is no later quiet-hours catch-up alert.
8. The shared preview builder applies sender/content opt-ins and localization.
   The extension returns the allowed content to iOS or empty content to suppress
   delivery. A foreground delegate also suppresses foreground presentation.
   Local delivery is no longer disabled for an entire APNs-registered account.

A running app publishes presence and the visible conversation into its App Group.
A lifetime file lock distinguishes a live process from stale preferences after
termination. Stopped apps therefore supply no active conversation. External
extension writes notify foreground live queries and invalidate bounded warm-tail
and peer-key caches. Peer evidence updates use an atomic signed-order condition.

The extension serializes processor contexts, bounds HTTP/socket responses and
query results, and stops within a 25-second execution budget. It opens only an
existing database whose migration version matches its bundled schema; the main
app owns migrations. The app moves its existing SQLite database using SQLite
backup, including committed WAL pages, and removes the original only after
successful publication. A durable marker resumes interrupted cleanup. Both
processes reserve writers before transaction reads to avoid WAL snapshot races.
Only messaging credentials are shared, using device-only Keychain access after
the first unlock; wallet and unrelated secrets remain private to the app.

## Signing and device verification

The config plugin creates and embeds the notification extension for each app
identity, rebuilds its TypeScript bundle on every Xcode build, and configures
matching App Group and Keychain access groups. Rebuild the native application;
JavaScript-only updates cannot add the extension or shared-storage capabilities.

Enable Push Notifications on the main App IDs, register each notification App
Group, and provision both extension IDs (`chat.psstpsst.app.notifications` and
`chat.psstpsst.app.dev.notifications`). The extension requires Apple's approved
[`com.apple.developer.usernotifications.filtering`](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.usernotifications.filtering)
capability for reliable local alert suppression. Its entitlement declaration is
**temporarily disabled while Apple approval is pending**, allowing signed-device
integration testing without filtering. Find `TODO(APNS_FILTERING_APPROVAL)` in
`plugins/with-notification-extension.js` to restore it after approval for each
extension App ID. Regenerate provisioning profiles and rerun prebuild for both
app variants, then inspect the actual signed entitlements before testing filtering.
Until restored, duplicate, muted and other suppressed events may still produce
a generic system alert even though local processing decides not to notify.

Errors, unavailable keys, incompatible schema and an exhausted execution window
return empty content. Complete suppression depends on the approved entitlement
and the extension actually executing: if iOS kills it before completion, the
original generic APNs alert may be displayed. Messages not ingested recover
through ordinary relay synchronization. A remote signer that needs interactive
approval cannot finish an ID fetch in a stopped app's execution window. Taps open
the app; automatic account/conversation navigation is not wired. When sender previews are enabled, both APNs and local delivery use an incoming
`INSendMessageIntent` to display communication notifications with sender identity
and avatar. APNs loads the profile avatar over HTTPS with a three-second timeout,
a 1 MiB streaming limit and 256-pixel downsampling; failure falls back to text.
A five-minute in-memory avatar cache is bounded to 16 entries and 2 MiB.
It never downloads message attachments. Sender previews disabled means no avatar
request or communication-intent donation. The extension keeps a verified text
fallback for its execution deadline and rechecks foreground presence at delivery.
The Communication Notifications entitlement is configured only on the containing
main app target, following Apple's sample. The extension provides intent-based
content without declaring that entitlement. `INSendMessageIntent` activity metadata
is configured for both. Enable Communication Notifications on the main App ID
and refresh its provisioning profile; filtering remains separately gated on
Apple's approval.

Run `npm run test:notification-extension` for real encrypted-event/database tests.
On macOS it also compiles the shipping Swift bridge and runs the same processor
inside JavaScriptCore. These checks complement, but do not replace, signed-device
verification of APNs, shared Keychain/container access, memory use, first-unlock
behavior and filtering. Verify both payload types, inactive accounts, duplicate
push/live arrivals, mute/block/request/quiet-hours settings, foreground,
background, termination, token rotation, offline opt-out/reconnect and removal.

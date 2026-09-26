# PsstPsst Design System

> The visual and interaction charter for PsstPsst. Read this file before any UI
> change. Keep it about durable conventions; component implementation belongs
> in code and system mechanisms belong in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

The theme files under `src/theme/` are the source of truth for numeric token
values. Shared component APIs live under `src/components/common/`. This document
defines how those tokens and components are used.

## 1. Personality

PsstPsst is calm, professional, private, and content-first.

- Prefer restraint over decoration.
- Let messages and people dominate the screen; chrome stays quiet.
- Use plain language, especially in security flows.
- Use motion to explain state changes, never to entertain.
- Keep user expression inside content. Emoji, GIFs, and media are not chrome.

Avoid candy colours, excessive roundness, decorative illustrations, loud
gradients, emoji in navigation, and bouncy motion.

## 2. Colour and theme

All colours come from `useThemeColors()` in `src/theme/index.ts`. Components
must never contain raw hex or rgba values.

| Token family | Role |
| --- | --- |
| `background` | App and navigation canvas |
| `surface*`, `insetFill` | Cards, controls, bubbles, and inset content |
| `interactionOverlay` | Shared theme-aware hover and pressed overlay |
| `border` | Hairlines and outlines |
| `text`, `textMuted` | Primary and secondary information |
| `accent`, `accentSoft`, `accentForeground*` | Primary actions, links, own bubbles, and focus |
| `danger*` | Destructive actions and destructive state only |
| `warning*`, `success*` | Semantic status |
| `notification` | Unread counts and notification dots |
| `overlay*`, `lightboxBackdrop`, `onOverlay` | Media and modal overlays |

The surface ladder is consistent in both modes: page background, muted
surface, normal surface, elevated surface. Light mode uses a grey page with
white cards; dark mode uses a near-black page with lighter cards. Do not give a
single screen its own palette.

The app follows the system colour scheme unless the user selects Light or Dark.
Read the effective scheme through `useThemeColors()` or
`useEffectiveColorScheme()`, never React Native's `useColorScheme()` directly.
The root owns the single system-appearance subscription so every region changes
palette in the same render commit. Every screen must work in both modes.

Accent colour is user-selectable from the closed `ACCENTS` set. Adding an
accent requires a light/dark pair and a localized name. Other semantic colours
do not change with the accent.

Use accent sparingly. It is not a page background or default icon colour. Use
danger only when an action destroys or removes something. Use `notification`,
not danger, for unread state.

Muted conversation unread counts and disconnected Nearby radar markers use the
shared neutral overlay colour with `textMuted` foregrounds. Conversation-list
secondary text and status marks share `textMuted` without extra opacity.

Nearby device availability and messaging connection status are separate. Device
availability is online or offline; a live connection is disconnected,
connecting, or connected. Connecting starts only when a handshake begins and
continues through authentication and access approval; discovery and retry scans
alone keep the connection disconnected. Conversation radar markers and title
metadata show the connection status: success for connected, warning for connecting, and muted
for disconnected. A failed attempt is action feedback, not a persistent
connection state. The Nearby list retains a trusted, connected peer when its
advertisement signal is unavailable. A connected known-device row shows muted
messaging readiness instead of radio signal and keeps its success-tone
connection status at the trailing edge; other visible rows show radio signal
with connection status where applicable. Connection liveness must not be
presented as fresh device availability. Within each Nearby section, fresh
devices are ranked by coarse signal tier, rows keep their first-seen session
order inside a tier, and smoothed RSSI uses hysteresis before changing tiers.
Devices without a fresh signal follow the signal tiers.

## 3. Typography and direction

All text uses `AppText`. Semantic variants and platform-specific metrics live
only in `src/theme/typography.ts`.

| Variant | Purpose |
| --- | --- |
| `amount` | Wallet amounts |
| `display` | Page-level identity or onboarding titles |
| `title` | Section and card titles |
| `subtitle` | List names and important secondary titles |
| `message` | Message body text |
| `body` | Ordinary copy, inputs, and buttons |
| `caption` | Metadata, labels, and supporting text |
| `code` | Keys, hashes, addresses, and technical values |
| `micro` | Tab labels and compact numeric badges only |

Do not define `fontSize`, `lineHeight`, `letterSpacing`, or `textTransform` in a
screen. Controlled artwork and emoji sizes remain named theme/component
constants rather than typography variants.

Text is start-aligned by default. Center only a standalone block with no visual
anchor, such as an empty state, onboarding prompt, dialog, or pairing code.
Text beside an icon, avatar, control, or metadata stays start-aligned.
Captions beneath circular profile actions are centered within equal-width
columns and wrap to show the full label.

Arabic and Persian use RTL. Use `AppText` logical alignment and logical layout
properties (`start`, `end`, `marginStart`, `paddingEnd`). Directional icons
mirror; symmetric icons and structured code do not. Never hard-code left/right
text alignment.
Verbatim third-party notices retain their original wording and source language;
their text direction follows that language independently of the app locale.

## 4. Spacing and layout

Spacing comes from the closed, multiples-of-four scale in `src/theme/index.ts`:
`xs`, `sm`, `md`, `lg`, `xl`, `2xl`, and `3xl`. Do not use arbitrary margins,
padding, or gaps. The sole optical exception is the tighter semantic gap
between a message bubble and its reaction row.

- The default page and sheet gutter is `spacing.lg` (16px).
- Sections normally use `spacing.xl` separation.
- Settings lists and forms start `spacing.sm` below the header clearance,
  matching the Me hub in both single-pane and split-pane layouts.
- Safe-area insets belong to `AppScreen` and navigation chrome, not screens.
- Headers, lists, bubbles, and the composer align to the same content gutter.
- Persistent top and bottom chrome uses a hairline border, not a shadow.
- Scroll-driven top chrome is borderless at the visual top and shows a themed
  hairline when content is hidden above the viewport. Inverted lists use their
  visual top, not offset zero. With fixed search, filters, or other controls
  below the title, the line belongs at the bottom of that whole fixed region.
  Lines overlay their boundary without shifting content. Non-scrolling task
  screens and immersive artwork stay borderless; chat chrome keeps its fixed
  separator.
- Pinned section headers reuse the title bar's frosted material when content
  scrolls beneath them, with equal top and bottom padding. Their in-flow labels
  share the same spacing so pinning does not shift the text.
- Do not nest scrolling containers unless the shared component explicitly owns
  that pattern.
- Single-line names and titles truncate within the available width. Adjacent
  status marks, timestamps, and actions retain their space, including in selection mode.

Message reactions sit in a compact, separate row directly below the bubble,
with the dedicated `messageLayout.reactionGap` and without overlap or a
canvas-coloured cutout.
The reaction row adds no bottom margin; the following message row owns the
inter-message separation. Reactions share the message's logical edge: start for
received messages, end for sent messages. Own reactions retain an accent
outline.

## 5. Shape and elevation

Radius values come from the theme scale. Ordinary controls use medium/large
radii, cards use `xl`, and only inherently circular elements use `full`. Avoid
super-rounded containers and nested cards.

Chat message bubbles use equal radii on all four corners, regardless of sender.

On-page cards are shadowless. Use surface contrast and a hairline border.
Frosted chrome and floating capsules share a mostly opaque, strongly blurred
material: underlying content supplies a faint wash without competing with text.
`shadow.float` is reserved for content that physically floats over another
surface, such as a menu. `shadow.mediaText` is only for text over unpredictable
media.

## 6. Motion and feedback

Motion is short, restrained, interruptible, and tied to a state transition.

Message bubbles accept swipe-to-reply in either horizontal direction. The
reply affordance appears at the edge exposed by the drag, with the same trigger
distance and feedback in both directions.

- Press feedback is immediate.
- Ordinary transitions use the shared duration and easing tokens.
- Avoid decorative bounce, looping motion, and layout jumps.
- Keep gesture-driven animation on the UI thread.
- Honour Reduce Motion by removing displacement while preserving state clarity.
- Use haptics only for committed actions, destructive warnings, or a threshold
  crossing; never for routine navigation.

Pointer hover reuses the pressed visual language. Framed controls and tappable
surfaces retain their resting fill and composite `interactionOverlay` above it
for both hover and press. The overlay darkens in light mode and lightens in dark
mode, so the same feedback adapts to neutral and semantic fills. Controls over
media use a mostly opaque neutral fill that lightens equally on hover and press,
maintaining visible feedback and white-glyph contrast over both bright and dark
images in either theme.
Disabled or busy actions keep their disabled appearance on hover and press.
Image and video message surfaces keep their original appearance on pointer
hover; hovering must not dim or recolour the media.

Surface tokens describe resting or dragged containers, not hover or pressed
states. Text-only actions use opacity feedback without introducing a shape.

Tappable identity cards use the same hover, press, and selection overlays as
settings rows, preserving their base surface and content opacity.
Rows in edge-to-edge lists use rectangular, full-width feedback. Rounded row
feedback belongs to cards and sheet options.

File drop targets reuse `FileDropZone` for a scoped overlay with an action icon,
a release prompt, and brief guidance. Busy targets reject drops; accepted files
continue through the action's existing progress and result feedback.

Interactive wallet amounts use opacity-only hover and press feedback, with no
background fill.
On Electron, receipt amount keypads also accept physical number and deletion
keys while active; text entry and modal tasks retain their own keyboard input.
Transient multi-selection modes consume Android back and desktop Escape to
cancel before normal navigation.

## 7. Icons

Use Lucide for foundational functional glyphs: check, close, add/remove,
directional chevrons, drag handles, and transfer controls. Import each Lucide
icon through its `lucide-react-native/icons/<name>` entry point. Use
`@solar-icons/react-native` through narrow imports for descriptive and domain
icons; use Linear icons by default and Bold for selected states and muted
conversation status marks. Icons
inherit semantic theme colours and use shared sizes. Do not substitute emoji,
text glyphs, or one-off SVGs for ordinary interface icons.
Lucide glyphs use the shared default stroke width to match Solar Linear in both
themes. Tiny check and dismiss glyphs retain the compact stroke for legibility;
specialist controls may keep an explicitly tuned stroke.
An unframed status mark may use a shared minimal SVG when the registered icon
libraries only provide framed versions.

Mute actions use Linear `BellOff`; unmute actions use Linear `Bell` across all
surfaces.
Language selection uses Lucide's `Languages` glyph.
Personal identifiers use an unframed `@` glyph so the symbol stays recognizable.

Every icon-only action uses `IconButton` and has an accessibility label.

## 8. Component vocabulary

Build screens from shared components. Component source and props are the API;
this table records when to choose each primitive.

| Need | Component |
| --- | --- |
| Screen root and safe area | `AppScreen` |
| Full-page form scrolling and keyboard avoidance | `AppFormScrollView` |
| Text | `AppText` |
| Labelled action | `AppButton` |
| Icon-only action | `IconButton` |
| Confirm/cancel action group | `ActionRow` |
| Text entry and validation | `AppInput` |
| Content container | `AppCard` |
| Navigation title bar | `ScreenHeader` |
| Settings/value row | `ListRow` inside `ListGroup` |
| Single-choice indicator | `RadioIndicator` inside a radio `ListRow` |
| Contact or conversation row | `ContactListItem` / `ConversationListItem` |
| Section heading | `SectionLabel` |
| Summoned task, picker, or form | `BottomSheet` |
| Short decision or notice | `platform.confirmationDialog` |
| Small Electron value entry | `InputDialog` |
| Time-of-day entry | `TimeOfDayPicker` (native `@expo/ui` wheel/clock on touch, `InputDialog` on Electron) |
| Brief success acknowledgement | `Toast` |

Transient toasts remain visible above an active sheet or modal.

`AppButton` and `IconButton` are the only button primitives. A specialist
interactive surface may use `InteractivePressable`, but it must not recreate a
button, row, menu, switch, or segmented control.

Button roles are semantic:

- `primary`: the one main action on a screen.
- `secondary`: a visible alternative or cancel action.
- `ghost`, `text`, `accentText`: lightweight chrome and navigation.
- `danger`: destructive confirmation only.

Secondary text and icon buttons share the same `surfaceElevated` resting fill
as list rows in both themes, with a hairline border and the shared interaction
overlay.

Value rows that open a name editor use a trailing directional chevron, not a
pencil icon, matching other editable settings rows.

Single-choice lists use a trailing `RadioIndicator` on every row and expose
radio-group, radio, and checked semantics. A checkmark communicates completion,
not mutually exclusive choice.

Quiet destructive icon actions use a soft danger fill with a danger-coloured
glyph; solid danger fills remain reserved for prominent destructive actions.

Use `ActionRow` for action groups so order, role, spacing, and RTL behaviour do
not drift. `AppInput` owns its field label above the control and its supporting
text below it; an error replaces the description in the same slot.

Reuse an existing component before creating another. If a new reusable visual
concept is genuinely needed, add or extend the shared component and record the
new convention here in the same change. Do not document individual screens or
copy component implementation into this file.

## 9. Density and responsive layout

Mobile is touch-first. Electron uses the same semantic components with compact
density tokens, pointer hover, keyboard shortcuts, and native-first fonts.
macOS Electron window chrome uses a compact title bar while preserving native
traffic-light clearance and a reliable drag region.
Electron suppresses Chromium focus outlines across all controls; keyboard
shortcuts remain supported, but visible keyboard-focus navigation is not a
product interaction convention.
The Electron tray opens the app on primary activation. Secondary activation
opens its `Show PsstPsst` and `Quit` context menu; Linux follows the host tray's
activation conventions.
The onboarding artwork may extend behind Electron's title bar. In that mode the
title bar stays draggable, native window controls remain clear, and the product
title is hidden so the artwork reads as one continuous surface. Non-interactive
onboarding artwork acts as a window drag region on Electron. On wide
onboarding screens the artwork uses a shared bounded visual rail rather than an
equal-width split; narrow pushed forms stay content-only. The boot screen uses
no onboarding artwork at any width so account initialization remains focused.
About may reuse a
restrained, tappable crop when the brand lockup and version are integrated into
the image rather than repeated beside it. The full artwork may be viewed and
saved from the shared media viewer; the artwork is not general page decoration.
Do not choose density from window width; choose it from the runtime.
Embedded media previews fit the available message width and keep artwork
bounded on wide conversation panes.
Conversation media galleries keep compact square thumbnails and derive their
column count from the available pane width instead of using a fixed grid.
Custom-emoji grids keep artwork bounded and derive their column count from the
available container width on both touch devices and Electron.
Image framing and full-screen image viewing on Electron provide explicit zoom
controls, pointer dragging while zoomed, and trackpad two-finger zooming and
panning; essential actions must not depend on multi-touch gestures.
Full-screen media viewers use opacity-only entrance and dismissal. Dismissal
finishes before the viewer is removed or a context action navigates elsewhere;
Reduce Motion is respected.

At the responsive split threshold, tablets and Electron present a persistent
primary pane and a detail pane using the same navigation state. Narrow windows
show the normal single-stack presentation. An unselected detail pane shows only
a quiet, centered prompt to select a chat, without branding. Resizing must not
reset navigation, selection, drafts, or scroll state. Tablet primary panes
support direct touch resizing at a thin divider with a compact centred grip and
a 48-point touch target. Electron primary panes support pointer and keyboard
resizing there. Double-tapping the divider restores its default position on
both platforms; on tablets it also resumes responsive default sizing until the
user adjusts the divider again. Both stay bounded to keep each pane usable.
Each platform's preferred width survives navigation, temporary switches to a
narrow window, and app restarts. Electron restores window bounds and
maximization on launch, keeping the window reachable when the available
displays change.
Screenshot preview starts the Electron content canvas at 960x720, remains
resizable, and restores the prior window geometry and resize behaviour on exit.

Ordinary web is not a supported product platform. React Native Web is an
Electron renderer implementation detail.

## 10. Overlays and focus

While a compact-layout chat is open, a new incoming message from another
unmuted conversation uses one small floating notice directly below the title
bar. It fits the avatar, single-line name, and single-line message preview in
one row; tapping it switches chats. Wide split layouts rely on the visible
conversation list instead of duplicating this notice.

Use the shared, state-driven `BottomSheet` for task flows. Do not use
`@gorhom/bottom-sheet` or introduce another overlay system.

Camera scanning surfaces omit the title bar and use a floating close action at
the top start edge. On narrow touch layouts, scanner entry slides up from the
bottom; Reduce Motion removes that displacement.

A short, self-explanatory action sheet may use handle-only chrome. Every task
or detail sheet uses the shared fixed sheet header: a close action at the start,
a truly centred single-line title, and at most one task-scoped action at the end.
Both sheet-header actions use Lucide icons only, with localized accessibility labels.
They reuse the title bar's icon size and circular control shape, with equal
insets from the sheet's top and side edges, using the standard sheet gutter.
The title clears the grabber and stays vertically centred with both actions.
Quiet actions use the secondary fill, border, and shared interaction overlay.
Edit uses Lucide's square-pen glyph; Done uses a filled primary action
with a contrasting check glyph. Keep the grabber and header
compact rather than stacking a standalone handle's drag padding above the task
controls.
Every sheet header reserves `spacing.sm` below its controls before
the body or fixed business content, such as recipient summaries, search, or
filters. Sheet titles never scroll with the body. The full emoji
picker is the registered tool-surface exception: its search and category rail
replace the standard header.

Search fields keep the same geometry when focused. Focusing an empty search
keeps the resting content visible; search results replace it only after the
query contains non-whitespace text.

Only one native modal may be presented at a time. Close the current modal and
start the next action from `onClosed`. Do not coordinate modal sequencing with
delays guessed at call sites.

Menus consume Android Back and Electron Escape while open, closing before
route or page handling.
With no menu open, Electron Escape cancels an active message reply before page
handling.

On Electron, short decisions use the shared confirmation dialog and small value
entries use `InputDialog`; larger pickers and task flows remain sheets or pages.

Touch sheets whose primary task is text entry focus their first field through
the shared `BottomSheet` presentation-aware focus contract; do not use
`autoFocus` inside a `BottomSheet`. A multi-step sheet focuses when it enters an
input step. Browsing and picker steps do not summon the keyboard preemptively.

On pushed screens, focus inputs with `useFocusAfterTransition` so the keyboard
does not animate with the navigation transition. Modal-owned inputs may focus
from the modal's supported presentation callback.
Opening a conversation on Electron focuses its composer immediately; printable
typing elsewhere in the conversation restores composer focus unless a shortcut,
modal, or another text editor owns the event. Mobile conversation entry does not
raise the software keyboard.

Focused inputs stay visible above the software keyboard with breathing room.
Full-page forms use `AppFormScrollView` to scroll the active field into view;
do not wrap it in another keyboard-avoidance container. Sheets and chat own
their keyboard placement within their existing containers. Inputs do not move
the page themselves.

## 11. States, copy, and accessibility

Loading, empty, error, and disabled are distinct states.
Profile avatars with a remote picture keep a quiet surface while loading and
show their pubkey-derived gradient only if the picture fails. Without a picture,
they show the gradient immediately.

Notification controls show the effective app preference and OS permission together
where permission can be queried. Otherwise, keep visible guidance to enable
notifications in system settings and explain that system permission cannot be checked.
When the OS denies permission, explain how to enable it in system settings and
refresh the control when the user returns.
Disabling new-message indicators hides unread counts, dots, dividers, arrival
banners, and manual read/unread actions without disabling system notifications.

Electron application updates require separate download and install
confirmations. Declining either action must not start it implicitly later.
Manual update checks provide explicit result feedback and allow users to revisit
a previously declined update.

- Never infer “loaded” from an empty array. Wait for an explicit resolved flag.
- Fast local reads use a blank stable placeholder; genuinely slow remote reads
  may use a skeleton that matches the final layout.
- An empty state has an icon, a short title, and optional guidance/action.
- Show recoverable errors where the failed action lives; use a dialog only when
  the user must decide or acknowledge something.
- Keep control geometry stable while loading.

Recent wallet activity includes pending transactions until they expire.
Completed payments remain visible after their invoice expiry.

User-facing copy is concise and ordinary. Avoid protocol jargon in `src/i18n/`.
Say “public key”, “private key”, “message relay”, and “media server” rather than
Nostr encodings, event kinds, or implementation names. Nostr may be named where
the source itself matters, such as importing a Nostr contact list. Technical
documentation and the About screen may remain precise.

Call NIP-05 identifiers “personal identifiers” in user-facing copy, localized
consistently across profiles, registration, search, and chat entry. Profile
display and editing labels include “(NIP-05)” to identify the standard; ordinary
prompts and actions use the short name. Do not imply an app-specific address or
identity certification.
Inline identity verification marks share one size and reserved space across
states. Failed or unreachable verification uses a muted question mark to convey
uncertainty without an alarming warning treatment.

Conversation-list draft previews appear only after the user leaves that
conversation. An active split-pane row never mirrors live composer input.

Image attachments default to optimized quality. After selection, the send
preview shows the chosen images and exposes one quiet `Image quality` row;
tapping it switches the per-batch choice to original quality. The same preview
provides one optional message field paired with its send icon below the
attachment controls, and closes from the header instead of a footer action row.

An active attachment transfer shows its progress ring around a pause glyph.
Pausing a download replaces it with a download glyph; pausing an upload uses an
upload glyph. Tapping that primary control resumes the transfer. An outgoing
transfer starts with the ring immediately, includes preparation in its progress,
and never labels internal phases. It keeps a separate compact circular control,
with a soft danger fill and danger-coloured close glyph, that stops and discards it. The
transfer source never replaces or decorates the primary pause/resume action.
Failed outgoing transfers never add an inline action row: the same destructive
close control discards them, while tapping the failure glyph opens details with
a retry action.
Failed attachment downloads use a warning-coloured side action facing the
conversation centre. Attachment side actions share a borderless circular soft
fill and a single unframed mark: a danger-coloured close mark for discard, and
a warning-coloured exclamation mark for download or integrity failure. Their
visual size, spacing, and touch targets match. The download action's reserved
space and minimum row height stay constant
across transfer states. It opens a retry dialog; integrity failures require
explicit confirmation before revealing content. Media keeps its failure scrim
without inline error content; audio waveforms, clocks, and file metadata stay
visible.
Within one upload attempt, aggregate progress is monotonic across server
fallbacks. The final publication handoff keeps the ring visually stable instead
of flashing a transient completion state.

Media resources sent by non-contacts require an explicit tap before downloading,
even in accepted conversations. This restriction applies to attachments, custom
emoji, and sticker artwork; remote media URLs remain ordinary actionable links.
Profile cards (including avatars), public-event text, and sticker-pack metadata
load regardless of the sender's contact status and never become load buttons.
Downloaded resources render from local files regardless of sender status and
never revert to download prompts. Resolve the local cache before showing a
download action; contact policy gates only a new network download. Unresolved relationships and
navigation transitions retain static rich-content geometry without a load action;
show that action only for resources requiring explicit download consent. Gallery
thumbnails follow the same download rule.

Sticker-pack message cards reserve their heading and two preview rows from the
first render, including while loading, when unavailable, and for smaller packs.

Contact and own image and audio attachments auto-download only when their declared
plaintext and ciphertext sizes are at most 20 MiB. A larger declared size
requires an explicit tap; missing size metadata preserves automatic loading.

Video attachments use a local first-frame poster while sending and carry a
compact poster placeholder for the received bubble. The generic video glyph is
only the fallback when poster extraction is unavailable. Message metadata is
hidden while the inline video player is active so native playback controls stay
unobstructed.

Every attachment context menu includes Save. Images and videos save to the
photo library on mobile and a user-selected location on Electron; audio and
other files use the system file destination picker. Unsupported video on
Electron is an inert status, not a link to another application. A completed
Electron Save As needs no follow-up success dialog.

Audio playback clocks use monospaced, fixed-width digits so advancing time never
changes the waveform geometry. Hour-long media keeps an hour field throughout.
Audio waveform bars share a bottom baseline. Audio message clocks sit below the
waveform at the logical start, with message metadata at the trailing edge.
Text and audio messages share compact bubble insets. Audio play controls add
their own vertical inset so their visual gaps above, below, and at the leading
bubble edge match at the default text size.

Nearby conversations show an available composer while local ownership checks
resolve, then switch to a read-only notice only after a confirmed identity
mismatch. Composer controls retain their normal geometry during the check; the
send service remains the final authorization gate.

Recoverable Nearby handshake failures use an action-local toast when the user
initiated the connection; after the attempt ends, the live status is
disconnected. Development diagnostics must not trigger a native error overlay.
A trusted peer's declined reconnect remains idle across launches and chat
opens. The conversation presents an explicit reconnect action; opening the
conversation or queueing another message does not retry it. That action opens
the standard pairwise-code waiting sheet until the request settles.
The peer that removed the relationship gets the same reconnect action with
"You removed this connection" instead of rejection copy.
Explicit connection actions require fresh Nearby discovery; while the device
is absent, the action is disabled and labelled offline. Discovery enables it
again without treating cached connection state as fresh presence.
In-chat notices directly below the title bar share one compact height and
vertical alignment. Their measured bottom edge is the top boundary for lifted
message bubbles, reaction pills, and action menus.

Do not use em dashes in UI strings. Localize every visible string. Preserve
logical reading order, accessible labels, dynamic text growth, and sufficiently
large touch targets.

Legal policy links use a quiet text footer on welcome and standard rows in
About, available before sign-in and during everyday use.

Generated Nearby names follow the current app language's word order and grammar.
Saved names remain stable across language changes; explicit regeneration uses
the newly selected language.

## 12. Hard Rules

Breaking a rule requires explicit approval and a reason in the PR or commit
message.

1. **No raw colours.** Use theme tokens.
2. **No raw font metrics.** Use `AppText` variants and typography tokens.
3. **No raw spacing.** Use the spacing scale.
4. **Use shared primitives.** Every route starts with `AppScreen`; text, inputs,
   cards, and actions use their shared components.
5. **No new UI library without approval.** The registered exceptions are
   `@expo/ui` for native controls, `lucide-react-native` for foundational
   functional icons, and `@solar-icons/react-native` for descriptive and domain
   icons.
6. **No page-specific theme.** Read the effective app theme.
7. **Verify light and dark mode.** New UI must support both.
8. **Empty states are complete.** Use icon, title, and optional guidance/action.
9. **Only one primary action per screen.**
10. **No emoji decoration in chrome.** Emoji belongs to user content.
11. **Reuse first.** Extend a shared component instead of duplicating it.
12. **Only two button primitives.** Use `AppButton` or `IconButton`, never a raw
    `Pressable` styled as a button.
13. **Typography is closed.** New levels or exceptions require a design-system
    change first.
14. **Use logical direction.** No hard-coded left/right text alignment.
15. **Record new conventions here.** Keep implementation narratives out.
16. **Use plain-language UI copy.** Protocol terminology stays out of ordinary
    product surfaces.
17. **Never flash an empty state while loading.** Gate on resolved state.
18. **Do not use `autoFocus` on pushed screens.** Use
    `useFocusAfterTransition`.
19. **Do not use em dashes in UI strings.**

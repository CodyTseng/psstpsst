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
Embedded application safe-area canvases may use validated document colours:
prefer the current HTML theme colour, then an opaque page background, then the
host theme. Follow live document and light/dark changes. Status text retains
contrast; host title bars and approval controls keep their own theme palette.

| Token family | Role |
| --- | --- |
| `background` | App and navigation canvas |
| `surface*`, `insetFill` | Cards, controls, bubbles, floating notices, and inset content |
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
danger for destructive actions and blocking prerequisites that require user action. Use `notification`,
not danger, for unread state.
The Contacts tab shows a small dot when unread message requests exist, without
a number. The Chats tab retains its unread message count.

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
| `micro` | Tab labels, compact action-rail labels, and numeric badges only |

Do not define `fontSize`, `lineHeight`, `letterSpacing`, or `textTransform` in a
screen. Controlled artwork and emoji sizes remain named theme/component
constants rather than typography variants.

Text is start-aligned by default. Center only a standalone block with no visual
anchor, such as an empty state, onboarding prompt, dialog, or pairing code.
Text beside an icon, avatar, control, or metadata stays start-aligned.
Captions beneath circular profile actions are centered within equal-width
columns and wrap to show the full label.
Action rails use fixed equal-width slots for each icon and caption; labels and
temporary confirmation text never resize the slots.

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
- Embedded web content receives only safe-area insets not already reserved by
  its host, so websites do not apply the same spacing twice.
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
- Compact horizontal rails use `HorizontalScrollView` without edge fades.
  Extend the viewport through surrounding gutters so partially visible items
  reveal overflow; content padding preserves first/last alignment at rest.
  Native and Electron overlay scrollbars stay hidden.
- Single-line names and titles truncate within the available width. Adjacent
  status marks, timestamps, and actions retain their space, including in selection mode.
- In a wide layout, opening a conversation freezes any existing draft preview
  in its active primary row. Composer keystrokes stay local; leaving the
  conversation reveals the latest draft once, while clearing or sending removes
  the frozen preview immediately.
- Ordinary group-conversation previews prefix the resolved sender name on the
  same truncated line. Drafts and group system actions keep their own labels.

Message reactions sit in a compact, separate row directly below the bubble,
with the dedicated `messageLayout.reactionGap` and without overlap or a
canvas-coloured cutout.
The reaction row adds no bottom margin; the following message row owns the
inter-message separation. Reactions share the message's logical edge: start for
received messages, end for sent messages. Own reactions retain an accent
outline.

Chat system events use centered, single-line caption text and stay anchored at
their event position in the message timeline. The text is muted at rest and
uses the normal text colour on pointer hover. They never join the floating
sticky date indicator. A system event may own the inline date boundary or
unread boundary at its position and always breaks bubble grouping across it.
Group actions follow ordinary-message unread, badge, preview, activity, and
notification behavior.
Own authored system events reserve one fixed-size delivery-status slot while
incoming system events do not. Every system event opens the standard message
detail when pressed.
System events remain single-line. Dynamic arguments such as member and group
names truncate independently with end ellipses so localized action words remain
visible; accessibility exposes the complete untruncated sentence. At their
maximum width, system events retain an additional horizontal inset beyond the
chat content gutter instead of approaching the page edge.
System events never enter message selection or content actions such as
copy, reply, react, quote, and forward.

Received group-message runs show the sender name once at the run start and the
sender avatar beside the run's final bubble. The logical-start avatar column is
reserved across the run. The sender name uses semibold text at reduced opacity
and aligns with the bubble's text inset. The avatar diameter matches a one-line text bubble's height,
stays attached to the final bubble, and scrolls with it; it never floats
independently. Reserve group-message geometry from the first route render;
asynchronous conversation metadata must never shift existing bubbles. Own-message
runs show neither. In message-selection mode, the received avatar column moves
with its bubbles as one motion unit so the selector owns the leading slot
without overlap or a second avatar animation target. Group sender labels move
with that unit but remain outside the selected-row wash and selector alignment.

The group conversation header opens group information. Sender names and avatars
open that member's profile, as do member rows on group information. Add, remove,
and leave controls remain on group information. The global profile screen may
link to a read-only list of common groups, but never gains group-specific
actions. Common-group rows open their chat histories.

Private-chat and group-chat creation use separate tasks. Private-chat contact
rows open a conversation immediately; group creation owns multi-selection and
a persistent bottom create action.

Adding a group member offers both eligible saved contacts and the same public
key, personal-identifier, and QR search paths used by the new-chat and user
search flows. Search results replace the contact list, open the full profile
when pressed, and expose a separate trailing invite action. Existing members
are rejected before an invite is sent.

The group directory is an explicit saved list, not a membership mirror.
Established-group information owns its saved-list switch. Deleting a
conversation or being removed never changes its saved state. Saving accepts the
group for the main conversation list, and later messages restore it there after
deletion. Actively leaving turns the switch off and removes the group from the
directory.

Automatically derived group titles resolve at most three member names in a
stable order, followed by a localized remaining-member count. When present,
that count represents at least two members; a four-member group therefore shows
two names and a remaining count of two. Full member rosters use virtualized
lists. Derived group avatars show up to nine members in a stable, compact
overlapping cluster; larger groups keep the first nine-member composition.

Multi-copy delivery details use a horizontally scrollable avatar tab for each
target, including self delivery to other devices, with the selected target's
relay detail shown below. Selection never changes avatar size, and status marks
use equal logical-end and bottom insets near the avatar edge without obscuring
its centre. The selected tab uses an accent ring around an accent-soft surface;
the ring uses nested fills instead of a platform border stroke so its curved
and straight segments stay visually even. Its frame, hover region, and tap
region share one fixed geometry. Own messages always expose Resend in their
detail summary and long-press or pointer context menu, regardless of delivery
status or originating device. Read-only Nearby history retains its identity
ownership restriction. The summary keeps a single-line height. Failed relay rows expand in
place to show their failure reason. Targets stay in stable
identity order while statuses update, with the user's own copy labelled as
themselves and kept last. Avatar tabs use a compact gap and sit close to the
selected target detail. The rail extends through the sheet
body gutter while its resting tabs retain that gutter, so scrolling content is
never clipped at the inner padding boundary. Status changes never reorder the
tabs.

## 5. Shape and elevation

Radius values come from the theme scale. Ordinary controls use medium/large
radii, cards use `xl`, and only inherently circular elements use `full`. Avoid
super-rounded containers and nested cards.

Chat message bubbles use equal radii on all four corners, regardless of sender.

On-page cards are shadowless. Use surface contrast and a hairline border.
Frosted chrome and floating capsules share a mostly opaque, strongly blurred
material: underlying content supplies a faint wash without competing with text.
`shadow.float` is reserved for content that physically floats over another
surface, such as a menu. Transient arrival notices use `surfaceFloating` and
`shadow.notice` for quiet separation from changing page content.
`shadow.mediaText` is only for text over unpredictable media.

## 6. Motion and feedback

Motion is short, restrained, interruptible, and tied to a state transition.

Message bubbles accept swipe-to-reply from the trailing edge toward the leading
edge. The physical direction reverses in RTL layouts.

Quoted replies in messages and the composer jump to their source message when
pressed. The composer's cancel action only dismisses the reply.
Composer quote feedback fills the input's upper region and follows its outer
top corners, without a separate rounded card.

- Press feedback is immediate.
- Ordinary transitions use the shared duration and easing tokens.
- Avoid decorative bounce, looping motion, and layout jumps.
- Keep gesture-driven animation on the UI thread.
- Honour Reduce Motion by removing displacement while preserving state clarity.
- Use haptics only for committed actions, destructive warnings, a threshold
  crossing, or a new-message notice; never for routine navigation.

Connection and media-server settings acknowledge successful saves in place and
retain the form for further edits.

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

Rounded framed surfaces use one full-size hover/pressed overlay clipped by the
outer container. Do not give an inset content layer its own rounded hover fill;
independent rounded contours leave visible gaps between feedback and the border.

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
Title-bar icon actions use the header control and icon density tokens, including
floating camera-close controls and task-dialog headers; generic icon-button defaults
are reserved for body actions.

Human avatars are circular. Mini-app icons are rounded squares at every size,
including compact identity rows and loading or fallback artwork.
Signed-site icons use declared artwork or one conventional icon from the signed
file list; missing or unavailable artwork uses the shared fallback without
fetching page metadata.
Website identities retain cached artwork while refreshing in the background;
temporary network failures must not replace usable artwork with a fallback.
Mini-app publisher attribution uses a separate labelled information row between
the app heading and description. Supporting metadata rows fit their visible content with expanded touch targets
and remain borderless, with text aligned to the surrounding content gutter. Hover and press
feedback reduce only the identity avatar and name's opacity, without adding a
background. Publisher rows open that publisher's application catalogue from the
whole row, across application details and runtime information surfaces.
Application reviews keep a top-level composer above an avatar-led thread,
with compact avatars, muted author metadata distinct from the body, accent text reply actions, and logical guides connecting parent and
reply avatars across rows. Reply actions expand a focused composer directly
below the selected review while preserving the top-level draft. All review
composers omit posting-identity captions. Reply composers appear only on demand, omit redundant
quotes and pair equal-height Cancel and Post
buttons in one action row.
Review rows keep metadata, body, and reply actions closely grouped. Composers
keep their action row close to the input. Separate threads use compact
whitespace rather than horizontal rules; reply guides carry the hierarchy.
Application details place a compact primary Open action beside the app identity
in the scrolling header. Launching and reviewing are independent action
contexts, each with a primary action. Failed posts retain the draft.
Review text follows its own writing direction independently of the interface.

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
| Contact-list destination or identity row | `IdentityListItem` |
| Contact or conversation row | `ContactListItem` / `ConversationListItem` |
| Section heading | `SectionLabel` |
| Scrollable horizontal rail | `HorizontalScrollView` |
| Summoned task, picker, or form | `BottomSheet` |
| Short decision or notice | `platform.confirmationDialog` |
| Small Electron value entry | `InputDialog` |
| Time-of-day entry | `TimeOfDayPicker` (native `@expo/ui` wheel/clock on touch, `InputDialog` on Electron) |
| Brief success acknowledgement | `Toast` |

Transient toasts remain visible above an active sheet or modal.
Toasts scoped to a split-pane column sit at that column's bottom centre and
follow its resized bounds. Unscoped toasts and single-pane layouts use the
whole window's bottom centre.

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
Clicking unused space inside an editable input focuses its editor.
Input placeholders share the caret and entered text's alignment and content
area, excluding inline actions.

Reuse an existing component before creating another. If a new reusable visual
concept is genuinely needed, add or extend the shared component and record the
new convention here in the same change. Do not document individual screens or
copy component implementation into this file.

Destinations embedded in a contact list use `IdentityListItem` with the same
row height, leading-visual size, and text column as contact rows. Symbolic
destinations place their icon in a neutral circular surface occupying the avatar
slot.

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
Message image and video containers retain minimum width and height so controls
and metadata remain visible. Media keeps its aspect ratio without cropping;
unused space uses the theme's muted grey surface, including pending previews.
Local video previews use cached frame images in chat and media lists. Players
are mounted only for playback; unavailable posters retain the ThumbHash or neutral fallback.
Local media sends resolve available preview dimensions before showing the pending
bubble, so upload progress does not replace a guessed aspect ratio mid-send.
Conversation media galleries keep compact square thumbnails and derive their
column count from the available pane width instead of using a fixed grid.
Custom-emoji grids keep artwork bounded and derive their column count from the
available container width on both touch devices and Electron.
Standalone custom emoji use larger artwork than Unicode emoji, independently
of inline custom-emoji sizes. Standalone custom-emoji runs wrap to fit the
available conversation width.
Message custom-emoji artwork retains its original corners without rounded clipping.
Standalone Unicode emoji keep the timestamp and delivery-status capsule below
the artwork at the trailing edge, so it never obscures the expression. Keep this
stack compact without an added metadata gap. Use natural system-font height on
every platform and preserve Android font padding; never force a fixed line height
to tighten emoji spacing.
Image framing and full-screen image viewing on Electron provide explicit zoom
controls, pointer dragging while zoomed, and trackpad two-finger zooming and
panning; essential actions must not depend on multi-touch gestures.
On Electron, full-screen media viewers expose Copy for images, Save for savable
media, and Go to message when opened from the media gallery through the shared
pointer context menu. Message-origin viewers omit that navigation action.
Opening or selecting a video in the media viewer starts its download and playback;
unselected neighbouring pages neither download nor keep playback players mounted.
Video message posters open the shared conversation media viewer once the file is
available. Viewer videos fit within both dimensions of the viewport without cropping.
On Electron, the player's fullscreen control presents the video on the display
through system fullscreen; exiting restores the application's previous window.
Mobile media viewers already fill the screen and omit the player's fullscreen control.
Touch video previews stay immersive, with a separate progress rail above the
bottom playback, mute, and speed actions. Do not enclose them in a card.
Touch video viewers hide top and bottom actions together after inactivity during
playback and toggle both when the canvas is tapped; scrubbing keeps them visible.
Playback speed opens a choice menu marking the current rate; controls remain
visible until the menu closes.
The speaker toggles mute. Active mobile videos allow device rotation; leaving restores
the normal phone/tablet orientation policy. Rotation retains the selected media
surface and playback position without revealing neighbouring previews.
Visible playback chrome adapts smoothly to viewport changes while actions retain
their size; Reduce Motion removes the layout transition.
Playback chrome shares the media action styling and stays clear of window safe areas.
Top and bottom media actions align to the same horizontal gutters.
Scrubbing previews the video frame, retains touch ownership outside the rail,
and restores the preceding playback intent when released.
Full-screen image neighbours display cached images without starting downloads.
Full-screen media viewers hide native and Electron overlay scrollbars.
Cached image surfaces remain mounted when they become the selected page.
Desktop viewers prepare a bounded set of further cached neighbours before
consecutive swipes and retain their image surfaces through selection.
Cached desktop neighbours load before entering the viewport, with the selected
image taking priority over offscreen preparation.
Undownloaded images use previews fitted to the media's declared aspect ratio;
previews fill that rectangle rather than the viewport.
Full-screen media viewers use opacity-only entrance and dismissal. Dismissal
finishes before the viewer is removed or a context action navigates elsewhere;
Reduce Motion is respected.
On touch devices, images at fit size and videos support vertical drag or flick
to dismiss while horizontal swipes page through media. Video playback controls
remain interactive.
On Electron, full-screen media paging also exposes side arrows for available
neighbours and accepts Left/Right keys in the same visual direction. Paging
pauses while an image is zoomed; text entry retains its own arrow-key handling.
Left/Right keys prioritize media paging even when native video controls have focus.
Desktop swipes retain direct scrolling and the system's settling animation;
inertial scrolling stops at the next page instead of skipping media. Subsequent
swipes remain available without moving the pointer or waiting for a paging lock.
Opening, resizing, or extending a media window retains the selected image;
scroll snapping starts only after its surface is mounted and positioned.

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

New incoming messages from eligible conversations use one small floating notice
directly below the title bar whenever neither Chats nor the message's conversation
is visible. In split layouts, check the selected primary tab and the active detail
together. The notice fits the avatar, single-line name, and single-line message
preview in one row; tapping it opens that conversation.
Arrival uses a brief fade with slight downward movement and no bounce; Reduce
Motion keeps only the fade. Message updates within a visible notice do not
repeat its entrance.
Each appearance gives one notification-style haptic. Notices track upward dragging; release
past the dismissal threshold carries the notice fully offscreen, otherwise it
settles back. Touch interaction pauses expiry, and dragging never opens the chat.

Chat-originated forwards keep the source conversation open and offer a brief
shortcut above the composer to enter each target conversation. The notice shows
a check icon and fixed Sent confirmation at the logical start and the conversation action at
the logical end. It omits conversation names and close buttons, expires two
seconds after appearing, pauses expiry while hovered, and restarts the two-second
window when the pointer leaves. It does not support swipe dismissal. Composer
feedback uses a transparent envelope that remains stable when content disappears,
so the message viewport and input never shift during dismissal. Detailed delivery
status belongs to the target conversation. Multi-target forwards use one passive
Sent notice without a conversation action. External shares reuse the recipient
and confirmation flow and open the first selected target conversation without
an additional Sent notice. Multi-target forwarding notices do not support clicking. External images, videos, and files use the
same pending bubbles, upload progress, and pause, retry, and discard controls as
attachments sent inside a conversation. Opening a shared destination resets the
detail history so Back returns to the primary pane instead of a previous chat.

Use the shared, state-driven `BottomSheet` for task flows. Do not use
`@gorhom/bottom-sheet` or introduce another overlay system.

Camera scanning surfaces omit the title bar and use a floating close action at
the top start edge. On narrow touch layouts, scanner entry slides up from the
bottom; Reduce Motion removes that displacement.

A short, self-explanatory action sheet may use handle-only chrome. Every task
or detail sheet uses the shared fixed sheet header: a close action at the start,
a truly centred single-line title, and at most one task-scoped action at the end.
Sheet-header action buttons use Lucide icons only, with localized accessibility
labels. The trailing slot may instead contain a passive circular account avatar
with the same outer diameter as the close control.
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
Dragging a tab's resting list during an empty search exits search mode so its
search field scrolls with the list.

A sheet body gesture that starts below the scroll origin remains a scroll until
release, even after reaching the top. Only a fresh downward gesture begun at the
top can drag the sheet; fixed chrome remains directly draggable.

A closing sheet retains its last presented content and geometry until its exit
transition completes, including automatic timeout dismissal.

Only one native modal may be presented at a time. Close the current modal and
start the next action from `onClosed`. Do not coordinate modal sequencing with
delays guessed at call sites.

Menus consume Android Back and Electron Escape while open, closing before
route or page handling.
Mini-app chrome places Close at the start and More at the end. System Back
traverses the embedded application's history before closing it at its root.
Mini-app container and initial document canvases follow the host background in
both themes, including loading and teardown. Apps may supply their own page fill.
Opening a mini-app enters its container immediately; loading, cancellation and
recoverable launch errors belong there rather than replacing the app grid.
Cached apps retain a quiet themed canvas until their first frame. When local
app code is missing or invalid, show its icon and loading state during download
and retain that state until the first frame replaces it.
Native sheets retain the underlying mini-app page behind their normal dimming
backdrop and block its input through the full sheet exit transition.
All host sheets and dialogs cover embedded application containers, including
account switching. Runtime More opens app information and permission management
inside a sheet for napplets, napps, nsites, and websites.
Header action menus open below their trigger on all platforms, accounting for
each platform's modal coordinates.
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
modal, or another text editor owns the event. Attachment menus expose Copy only for content supported by the platform
clipboard; copying hands off the actual image or file. Pasting files anywhere in the
active conversation opens the attachment preview under the same ownership
rules; ordinary text paste stays with the focused editor. Mobile conversation
entry does not raise the software keyboard.

Focused inputs stay visible above the software keyboard with breathing room.
Full-page forms use `AppFormScrollView` to scroll the active field into view;
do not wrap it in another keyboard-avoidance container. Sheets and chat own
their keyboard placement within their existing containers. Inputs do not move
the page themselves.

## 11. States, copy, and accessibility

Loading, empty, error, and disabled are distinct states.
Custom emoji retain their frame with a neutral grey placeholder until the image
is displayed. Active loading shows a centred muted spinner; failed or deferred
downloads keep a static placeholder.
Profile avatars with a remote picture keep a quiet surface while loading and
show their pubkey-derived gradient only if the picture fails. Without a picture,
they show the gradient immediately.

Notification controls show the effective app preference and OS permission together
where permission can be queried. Otherwise, keep visible guidance to enable
notifications in system settings and explain that system permission cannot be checked.
When the OS denies permission, explain how to enable it in system settings and
refresh the control when the user returns.
iOS notifications start disabled and require the user's notification toggle
before registering the device for remote delivery. Its toggle is disabled unless
the current account includes the APNs relay among its message relays; removing
that relay preserves the preference. Prerequisite guidance and its settings action
live in a standard navigation row below the notification toggle in the same group.
Disabled notification controls use muted labels and icons; missing relay guidance
uses the danger tone while its settings destination remains available.
Disabling new-message indicators hides unread counts, dots, dividers, arrival
banners, and manual read/unread actions without disabling system notifications.
In-app arrival banners and system notifications share conversation eligibility:
only accepted, unmuted conversations qualify; message requests never notify.

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
- Clipboard actions report failures with a localized toast. Show copied
  confirmation only after the platform accepts the write, on the latest copied
  field, and clear it after two seconds.
- Keep control geometry stable while loading.

Recent wallet activity includes pending transactions until they expire.
Completed payments remain visible after their invoice expiry.
Lightning payment flows always preserve access to the raw request, its QR code,
and external-wallet handoff. A connected wallet may be the primary action but
never removes these alternatives; connecting a wallet remains optional.

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
Conversation lists display and sort by the conversation's updated time; lists
supporting pins keep pinned rows first. This time is the latest previewed
message's authored time, or creation time when there are no messages. Arrival
time, reactions, and draft edits never independently change it.
List timestamps and chat date labels follow the selected app language's clock,
date order, and month naming, using compact month labels in lists.
Quiet-hours settings display times in 24-hour format, matching Android's picker
and Electron's time entry.
A conversation with neither messages nor a draft reserves the normal preview
line height without showing placeholder copy.
Read-only group conversations may retain a hidden local draft, but their list
rows show the latest visible message or system event until membership returns.

Image attachments default to optimized quality. After selection, the send
preview shows the chosen images and exposes one quiet `Image quality` row;
tapping it switches the per-batch choice to original quality. The same preview
provides one optional message field paired with its send icon below the
attachment controls, and closes from the header instead of a footer action row.

An active attachment transfer shows its progress ring around a pause glyph,
including ordinary network downloads. The ring appears before byte progress is
available, and the primary control can pause the request. Messages and viewer
pages referencing the same attachment URL show the same download progress and
pause/resume state, including controls that did not start the task.
Image and video uploads use the prepared file's aspect ratio before transfer
begins; upload metadata keeps the pending-to-sent geometry consistent.
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

Image attachment previews fill their container without cropping or letterboxing.
The decoded image preserves its aspect ratio and replaces the preview only when
displayed, without a crossfade.

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

Explore keeps compact Favorites/Discover mode selection beside Scan in its fixed
header, without a redundant Explore title. Like Chats and Contacts, its resting
search field belongs to the scrolling content; tapping it opens the shared search
transition, with editable chrome fixed only while search is active. Discover
pull-to-refresh uses the native platform control below the resting search field;
the field collapses during upward scrolling and stays still during pull/rebound.
Explore loading indicators use muted gray; refresh indicator sizing stays native.
Brief local reads do not flash a spinner; pending reads show loading feedback
only after a short delay, without showing an unresolved empty state.
Background reloads never open the refresh control. Request errors appear only
when there are no usable results; partial and cached results stay visible without
an error banner.
The first three tabs keep the shared title-row height and begin their search
fields immediately below that row, without extra top padding.
Keywords persist across mode changes: Favorites searches saved shortcuts, while
Discover searches the already-fetched catalogue. Both scopes match application
names, descriptions and resolved publisher names. Both Explore and home scanning
open exact application naddr references in their details page and website URLs
in their application container, without changing the selected search scope.
Explicit Lightning/LNURL links retain their wallet flow in the home scanner.
Empty Favorites opens Discover rather than a separate address-entry task.
Discover lists verified napps and napplets, excluding nsites, without recording visits or adding
shortcuts until the user chooses an action. Exact naddr and URL input selects address lookup:
local matches appear first, naddr hints choose manifest relays, and hintless
addresses use author write relays plus format-specific sources. Address results
remain separate from the curated directory. Scrolling reveals
more results in newest-first order, with quiet loading feedback at the list end.
Application rows give artwork and text a comfortable vertical inset. Artwork
approximates the combined title/description height and aligns with the title top,
with a single-line description and publisher avatar/name below the title. Artwork
has no format border, and rows omit format badges. Application information shows
the format as muted caption text
beneath the title. Both modes open the shared application
details. Favorites displays only saved shortcuts in its vertically scrolling
grid without a redundant section heading. Favorites reads and reveals local
application metadata in pages of 50 as the user scrolls. Both Explore modes keep the leading
header history action, which opens the dedicated recent-use page;
recent apps do not appear inline in Favorites. History loads on entry and appends
50 older entries at a time as the user scrolls. History reuses Discover application
rows with artwork, a single-line description and publisher identity. Pressing a
history row opens application details. Running-state dots remain
clearly visible, straddle the icon artwork's logical bottom-end corner, and use
a page-background ring to separate them from artwork. Compact list icons use a
smaller dot. Hover and press dim only
the icon artwork, leaving labels and the page canvas unchanged. Rounded clipping
belongs to icon artwork, never the caption beneath it. Outer icon
artwork aligns with the content gutter; wider interaction cells extend into that
gutter. Responsive grids prioritize recognizable artwork over extra columns:
icons stay at least 60px and grow to 68px when the pane allows. Column counts and
distributed gaps adapt around that size. History scrolls vertically with Back navigation in most-recently-used order.
Launching an app updates only recency. Electron
opens app menus with right-click and sorts desktop icons by direct dragging.
Grid menus center on the icon, prefer the space above it, fall back below, and
shift inward at pane edges. Available menu space excludes native window controls
and safe areas, including when the overlay spans the full window. App menus follow the shared platform density, icon sizing and stroke conventions.
Menu width accommodates localized action text within the available viewport.
The active icon caption hides without changing layout only while its menu is below
the icon; menus above leave the caption visible. Sorting actions stay out of the visual menu.
On mobile, holding a desktop icon first opens its menu; moving the held icon dismisses the menu
and begins sorting. On mobile, opening an app menu by holding gives one light
haptic at the hold threshold, without repeating during dragging. App cells remain
unframed in every state, including sorting; icon artwork disables browser-native
image dragging so it cannot interrupt sorting; other icons preview their new slots
while dragging; only release commits the order. Released positions stay visible
until the committed layout takes over, without restoring the old order. Recent
apps never drag or share desktop selection feedback. Discover and history rows
share right-click and long-press menus near the pointer or touch position, clamped
to safe viewport bounds. Right-clicking another visible app replaces the open menu
and its action target. Menu-enabled row text does not enter text selection
during a hold. Their menus offer details, permissions, sharing and
Favorite/Unfavorite. Every history row also offers danger-tone Remove, including
favorited apps. The application-detail header menu exposes the same permissions,
sharing and Favorite/Unfavorite actions, plus Copy. History removal belongs to
the recent-use list, not application details. Runtime menu sheets include Favorite/Unfavorite in their bottom
action rail. Every menu favorite change confirms success with a bottom toast;
failures show error feedback. Favorite removal is labelled Unfavorite throughout Explore. Removing recent usage preserves the
desktop shortcut and application state. Cancelling a drag leaves the desktop intact.
There is no pin state or browser-style forward/back toolbar. The address entry accepts both Nostr addresses and website URLs. Pointer menus and accessibility actions
provide equivalent add, move and remove operations. Removing a shortcut preserves
recent usage, app data, permissions and default task-handler choices. When the
desktop is empty, omit its entire section, including the heading and guidance.

Website artwork prefers the site's highest-resolution declared icon, then its
conventional favicon, and falls back to a globe when unavailable. Signed sites
and napps prefer their explicit artwork, then discover high-resolution icons
from their verified HTML, Web App Manifest and conventional favicon files.

Explore formats share their detail page, runtime chrome, information panel, and
permission controls. Format-specific capabilities supply content within those
shared layouts rather than defining separate page designs.
Application details prioritize app identity, a readable description and expanded
required access. The primary action stays fixed above the bottom safe area while information
scrolls. It always reads Open, regardless of installation or access approval state. Explicit consent on this page replaces the duplicate launch prompt;
viewing app details alone never grants access. Details and runtime information share the app identity, publisher, description
and required access. Approval sheets show a compact requester identity and the
exact requested access, omitting publisher rows and marketing descriptions. Applications with no effective required access open without
launch consent. First-use consent uses the same sheet across Explore formats,
identifies the current account with the shared header avatar when account-bound.
Access confirmation fixes one horizontal action row below the scrolling content,
with Cancel at the start and Allow at the end. Optional
access is omitted from app details and launch consent sheets; it stays off until
enabled in permission management.
Details have the same layout regardless of format or installation state, without maintenance
actions or a separate permissions entry. Permission controls live in the management
view reached from the app menu. Protocol hashes stay out of ordinary app information
surfaces.

Action handoffs explicitly ask which app should open the requested content
and name the requesting app. Candidate rows reuse the discovery list's app icon,
name, description and publisher attribution. Choosing a row opens that app;
The sheet's Close action dismisses only this handoff, without a duplicate Cancel
footer. These choosers omit access-review language,
signing-account labels and raw protocol action names.

Mini-app More opens app information with Copy address, Share, Permissions and
Reload actions. Copy omits the `nostr:` prefix; sharing includes it. Both retain
relay hints and use a coordinate for replaceable applications or an event pointer
for immutable applications. Copy keeps the sheet open with brief in-place
confirmation after the clipboard accepts the write.
On iOS, runtime swipe gestures navigate embedded page history without dismissing
the host route; leaving the runtime uses its explicit Close action.
On Electron and Android, napps and napplets always open in an independent
window or task. Nsites and ordinary websites default to the current host;
their account-scoped opening preference appears on the details page and below
the identity information in the runtime sheet. Keep the shared header clearance
and equal section spacing above and below the opening control. Action menus
omit opening preferences. Website runtime sheets include a default-browser
action with the Solar Linear Global icon. Preference labels explicitly describe
the default for future opens, distinct from immediate opening actions.
Preferences apply to subsequent opens and never move a running page. Independent hosts reuse
the account/application instance with its state intact. Open applications show a
small success-green dot beside their icons in app grids and lists; closing the
last independent instance clears it.
Inline websites expose a Solar Linear MaximizeSquareMinimalistic window-opening action
beside More in the header. Opening a
window succeeds before the current inline page closes, without changing its
saved opening preference; failures leave the page available.
A running app prompts once for each newer release when it is foreground and no
other approval is visible. Later keeps the current page; Restart uses the normal
permission review for the new release. Background metadata refresh never replaces
a running page without consent.
Independent windows merge application
identity and menu actions into their native title bar, reserve the system caption
controls, and omit duplicate page headers. Android opens applications as independent
system tasks with their own app-named Recents cards. Independent application
and website content has no host title bar, Close button or floating More control.
Pages in the main host retain the shared Close and More header. System Back
traverses the app's history, then closes its task; switching tasks preserves each running app.
System back gestures cancel pending webpage touches when the gesture starts,
so navigation never also triggers a page long press.
Application management remains available from the host's app list. All formats
reuse the shared application sheets. Action-rail captions
use concise labels; accessible action names may retain the full wording.
Permissions closes the menu before navigating to the dedicated management page.
Menu actions use square icon controls with single-line micro labels below.
Keep their equal-width slots compact in an ordered horizontal rail that scrolls
when needed rather than stretching actions across the available width. Gaps
between controls stay narrower than the body gutter to reveal overflowing actions.
Application action rails extend through the sheet gutter; their first and last visible controls
align with the body gutter at the corresponding scroll boundary. Host permissions expose
app access and remembered signing decisions. Each rule is one editing target,
with Ask every time, Automatically allow and Automatically reject choices and
an independent duration. Saved changes take effect immediately. Choosing Ask
deletes the persisted decision but keeps its row visible for the current visit;
the next visit omits it. Status follows the title with semantic colour; long
titles yield space to it, and Kind/duration shares the title's start edge. Disclosures align
with section headings. Permission management omits account chrome; protocol hashes
and history stay out of its default view. Permission reset uses the shared danger
button and destructive confirmation. Sharing keeps the current app mounted and returns to it after
confirmation or cancellation.

Webpage new-window links, external-app links, downloads and device permissions
ask before proceeding and identify the current site and target/resource. Downloads
use a system save destination picker. Native webpage dialogs keep
the originating site visible. Permission reviews name each concrete requested
resource, preserving unknown resource names rather than hiding them behind
generic access wording. Targets and filenames stay separate from permission names. Text and image copying do not show host confirmation;
clipboard reads require it. Permission queries describe these same decisions.

All approval sheets lead with the operation and a compact requester identity.
Signing reviews emphasize the event's readable type, kind and content before
secondary consequences; relevant event, account and authentication targets stay
visible before the JSON disclosure. Profile and application-data previews expose
bounded readable fields. Approval bodies use regular body text for identities,
values and explanations; caption text is reserved for labels and technical
metadata. Combine event type and kind on one muted metadata line instead of
adding nested headings. Disclosure and duration controls use regular text;
header and decision-button emphasis remains shared chrome. Never show a
pending-request count.
Keep the requesting app icon and name in a compact body row with balanced
space between the header controls and the following content. Show the signing
account only as a circular avatar in the trailing title-bar slot, with an
accessible account-name label. Keep the event kind visible before disclosure;
replaceable and addressable events also show the full d-tag value from the event,
with empty and missing values distinguishable. A centred disclosure with
a directional chevron expands directly into the event JSON, followed by relay
destinations. All signing content, including previews, event JSON, identities
and relay addresses, disables text selection to preserve scrolling and gestures.
Event JSON provides an explicit Copy action. Authentication keeps the server identity visible for the decision.
Public-file upload reviews show the filename, type, size and storage services,
with a plain-language public-access notice. They reuse the signer duration and
Allow/Reject controls; remembered choices apply to uploads by this app to the
reviewed storage services. Event JSON is not required for upload reviews.
Public-key access, encryption and decryption reuse the signing approval layout
and its Once, timed and Always decisions. Reviews identify the account and current
host-verified source; crypto reviews also identify the algorithm in a distinct summary.
Public-key reviews show the exact public key the application will receive.
These operations omit event-kind labels and event JSON. Their remembered rules
remain separate by method and algorithm, apply across peers, and use the shared permission editor.
Launching an application never grants these signer methods. Application configuration reuses the host's
settings form and serialized overlay lifecycle. Text clipboard writes do not
show a host confirmation. File saves identify the file and require consent
before opening the system destination picker.
A fixed footer contains a single-level duration menu showing the current choice
above two horizontal Allow/Reject actions. The menu floats above its trigger
without changing sheet layout. Duration applies to either decision and defaults
to one request; remembered decisions retain the displayed operation's scope.
Every valid ordinary event-signing request, including HTTP authentication,
profiles, follow lists and application settings, offers the same duration choices.
Event kind alone never forces one-request authorization. Relay authentication
and uploads also default to review with the same duration choices; remembered
AUTH controls state that remembered decisions cover all relays used by this
application; permission management shows that scope explicitly. Upload decisions
retain the reviewed storage-service destinations. No event
kind or app-data identifier is categorically blocked from user-approved publication.
Signing approvals show the remaining seconds in the Reject button, based on
a fresh review deadline when each request becomes visible. Adding queued requests
never restarts the active countdown.
Each decision closes its approval sheet completely before another review opens.
Queued permissions recheck the latest saved decision and skip review when it applies.
Closing an approval sheet through its backdrop, X or system Back rejects only
the current request. Approval sheets expose no bulk rejection or cooldown action;
ordinary dismissal never blocks later requests.

Encryption approval shows the exact plaintext with a bounded preview and an
explicit full-text disclosure. Approval payloads remain transient and never
become part of saved grants or permission history.

Website capability prompts use the same duration selector as signing prompts.
Routine clipboard writes and persistent-storage requests do not show a consent
sheet. Sensitive capabilities expose one-visit, timed, and permanent decisions;
screen capture and unknown capabilities require a fresh decision. Saved website
capabilities can be changed or reset in application permissions.

## 12. Hard Rules

Breaking a rule requires explicit approval and a reason in the PR or commit
message.

1. **No raw colours.** Use theme tokens; embedded safe-area canvases may use
   validated document colours as defined in §2.
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
9. **Only one primary action per screen**, except the independent launch and
   review contexts on application details.
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

# PsstPsst design constraints

Shared visual and interaction rules for a consistent app across iOS, Android,
and Electron. Read this charter before changing UI. Theme values live in
[`src/theme/`](../src/theme/) and shared primitives in
[`src/components/common/`](../src/components/common/).

## 1. Visual character

Keep the interface calm, private, and content-first. Use restrained chrome and
decoration. Reserve expressive media and emoji for user content.

## 2. Colour and theme

- Use semantic colours from `useThemeColors()`. Follow the effective app theme,
  including the user's Light or Dark override. Use the shared surface ladder.
- Use accent for primary actions, links, focus, and sent messages. Anything on
  an accent fill uses its paired foreground, including metadata, icons, and QR
  backgrounds. Explicit accent foreground choices apply consistently.
- Keep light and dark custom accent edits in a local preview until confirmed.
  Theme previews and exported QR codes use the same colour pairs as the
  surfaces they represent.
- Reserve danger for destructive actions, errors, and blocking prerequisites.
  Unread indicators use notification colours. Conversation-list metadata and
  secondary status marks use `textMuted` without additional opacity.
- Chats badges count unread messages. Contacts badges count unread request
  conversations, and each request row counts its unread messages. Quiet
  requests use dots in both places.
- Present Nearby radio availability and connection separately. Use success for
  connected, warning for connecting, and muted for disconnected. Discovery
  alone does not indicate connecting. Report failed attempts as action feedback.
- Embedded app canvases and runtime chrome prefer the validated document
  theme colour, then an opaque page background, then the host theme. Recompute
  foreground contrast when the effective colour changes. Loading, errors,
  trusted approvals, and host overlays use the host palette.
- Preserve original artwork colours. Colour-picker artwork may render the
  spectrum and the selected RGB directly.

## 3. Typography and direction

- Use `AppText` with the closed typography scale. Select variants by role.
  Navigation and labels are non-selectable. Enable selection for copyable
  content and keep native editing behaviour in inputs.
- Align text to the logical start. Centre standalone prompts and captions
  under centred actions. Use logical insets and mirror directional icons in
  RTL. Preserve the direction of code, source-language notices, and text
  whose direction is independent of the interface.
- Keep titles and names bounded. Reserve space for status, timestamps, and
  trailing actions so changes in text, state, or selection do not move them.
  Accessibility labels carry the full text when the display truncates it.

## 4. Spacing and layout

- Use the shared spacing scale and page gutters. Align persistent chrome and
  content to the same gutter. Shared screen and navigation primitives own safe
  areas. Embedded content receives only insets the host has yet to reserve.
- Use hairlines to separate persistent chrome. Scroll-driven chrome reveals
  its separator when content passes underneath, without shifting layout.
  Chat chrome retains its fixed separator.
- Use equal-width action slots and fixed selection-indicator slots. Preserve
  control and content geometry as loading, selection, and feedback change.
- Keep chat reactions directly below the bubble at the same logical edge.
  Keep sender, reply, and delivery metadata legible without shifting bubble
  geometry. Centre system events at their chronological position and keep
  them visually distinct from message content.
- Avoid nested scroll containers unless a shared primitive owns them. For
  horizontal rails, preserve resting gutters and let partial items signal
  overflow.

## 5. Shape and elevation

Use the radius scale. Reserve circular shapes for inherently circular elements,
keep chat bubble corners even, and avoid nested cards. Use surface contrast and
hairlines on page cards. Reserve shadows for floating surfaces and text over
media. Frosted chrome must stay opaque enough for clear text.

## 6. Motion and feedback

- Give immediate press feedback. Use shared motion tokens for short,
  interruptible state transitions. Keep gesture-driven animation on the UI
  thread. With Reduce Motion, remove displacement while preserving clarity.
- Fade and collapse deleted messages that are visible in the timeline. With
  Reduce Motion enabled, remove them immediately.
- Reuse pressed feedback for pointer hover. Framed surfaces composite one
  shared interaction overlay over the resting fill and clip it to the outer
  contour. Edge-to-edge rows use full-width rectangular feedback. Use opacity
  for text-only actions. Keep disabled controls and media artwork stable.
- Give haptics for committed actions, destructive warnings, meaningful
  thresholds, and arrivals. Routine navigation stays quiet.
- Swipe to reply from logical trailing toward leading. A quoted reply jumps
  to its source. When the first unread message is offscreen, prioritize its
  jump action over the jump to latest.

## 7. Icons and identity

- Use Lucide for foundational controls and Solar Linear for domain and
  descriptive icons. Use Solar Bold for selected states and muted conversation
  status marks. Use narrow imports, shared sizes, and semantic colours.
- Icon-only actions use `IconButton` with a localized accessibility label.
  Title bars and task headers use shared header control sizes. Use Lucide for
  sheet-header actions.
- Human avatars are circular. App artwork is a rounded square at every size.
  Keep the same silhouette during loading and fallback, and retain usable cached
  artwork during refresh failures.

## 8. Shared primitives

- Start routes with `AppScreen`. Use the common text, input, card, header,
  settings row, and action components. Extend a shared primitive when a new
  reusable pattern is needed.
- Use `AppButton` and `IconButton` for buttons. Use `ActionRow` for grouped
  actions and keep roles consistent. A screen has one primary action, with
  independent launch and review actions on app details.
- Use a consistent indicator slot and radio semantics for single-choice
  lists. Checkmarks indicate completion. Put labels above fields and replace
  supporting text with validation feedback in the same slot.

## 9. Density and responsive layout

Choose density from the runtime. Mobile is touch-first. Electron uses compact
tokens, pointer feedback, and keyboard shortcuts. Provide equivalent essential
actions for touch and pointer, including an alternative to multi-touch gestures.

Use a single stack in narrow layouts and a persistent primary pane with a detail
pane in wide layouts. Preserve navigation, drafts, selections, and scroll
position during resizing. Keep the primary pane usable while detail is open.
Fit media to available space, preserve aspect ratio, and reserve geometry before
loading so actions and metadata stay accessible.

## 10. Overlays and focus

- Use the shared `BottomSheet` for tasks and the platform confirmation dialog
  for short decisions. On Electron use `InputDialog` for small value-entry
  tasks and sheets or pages for larger pickers and forms. Use fixed task-sheet
  chrome with close at logical start, a centred title, and at most one task
  action. Use full-width sheets in single-pane layouts and the shared centred
  width cap in split layouts.
  Short action sheets may use handle-only chrome. The full emoji picker uses
  its search and category rail in place of the standard header.
- A drag that starts in scrolled sheet content remains a scroll until release.
  A new downward drag at the top or on fixed chrome can dismiss the sheet.
- Menus and transient selection consume Back or Escape before page navigation.
  Host overlays cover embedded apps and retain input ownership through
  dismissal. Keep closing sheets and their content stable until dismissal
  finishes. Toasts appear above active overlays.
- On touch, place the message action panel and quick reactions in separate
  bounds. Keep the message preview aligned to the original bubble. Try both
  sides and use the optional top gutter before clipping the preview. Scroll
  the action panel when the full menu exceeds the safe viewport.
- Focused search preserves field geometry and keeps the resting content
  visible until there is a non-blank query.
- Focus pushed inputs with `useFocusAfterTransition`. Use presentation-aware
  focus for sheet inputs and bring up the keyboard only when the task calls
  for text entry. Use `AppFormScrollView` for full-page form keyboard handling.
- Identify the requesting source and review scope in trusted prompts. Keep
  consequential decisions explicit and visually distinct from embedded content.

## 11. States, copy, and accessibility

- Distinguish loading, empty, failed, and disabled states. Wait for resolved
  data before showing an empty state. Use quiet stable placeholders for brief
  local reads and layout-matched loading feedback for slower remote reads.
  Retain settled content while it refreshes.
- Keep errors beside affected form controls. Use the shared error toast for
  action failures and a persistent recovery state when content cannot open.
  Acknowledge success only after the operation succeeds.
- Use plain localized copy. Use “public key”, “private key”, “message relay”,
  “media server”, and “personal identifier” in ordinary flows. Keep exact
  protocol language where it helps the user identify a source or action.
- Pair status colour with a label, shape, or glyph. Provide accessible names
  and state on controls and preserve usable targets and layouts with larger
  text, RTL, and both colour schemes.

## 12. Hard Rules

Pinned compatibility UI kits may retain their upstream visual tokens inside an
embedded application document. Only validated document appearance hints may color
runtime chrome as defined in §2; trusted approval surfaces retain the host theme.
Their exposed surface and text colors follow the effective host theme.

Breaking a rule requires explicit approval and a reason in the PR or commit
message.

1. **No raw colours.** Use theme tokens; embedded safe-area canvases may use
   validated document colours and colour-space picker artwork as defined in §2.
2. **No raw font metrics.** Use `AppText` variants and typography tokens.
3. **No raw spacing.** Use the spacing scale.
4. **Use shared primitives.** Every route starts with `AppScreen`; text, inputs,
   cards, and actions use their shared components.
5. **No new UI library without approval.** The registered exceptions are
   `@expo/ui` for native controls, `lucide-react-native` for foundational
   functional icons, and `@solar-icons/react-native` for descriptive and domain
   icons.
6. **No arbitrary page-specific theme.** Read the effective app theme; runtime
   chrome may follow validated document appearance as defined in §2.
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
    product surfaces, except exact action and intent identifiers in application
    handoff choosers and default-application settings.
17. **Never flash an empty state while loading.** Gate on resolved state.
18. **Do not use `autoFocus` on pushed screens.** Use
    `useFocusAfterTransition`.
19. **Do not use em dashes in UI strings.**

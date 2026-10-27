// Shared UI primitives — the small design system for this app, and for napps:
// one that declares `requires: ["ui"]` gets this module as /napp-ui.js
// (window.napp.ui) and the CSS as /napp-ui.css, both built by vite.config.ts.
//
// CONVENTION: build interactive controls through these helpers, never by
// hand-rolling `document.createElement("button")` + bespoke CSS:
//   • button({ variant, label, onClick, … })  → a `.btn .btn-<variant>`
//   • chip({ label, active, icon, onClick, … }) → a `.btn .btn-chip` (selectable)
//   • tab({ label, active, onClick, … })        → a `.ui-tab` text tab
//   • icon(name, { flush })                     → an inline `<svg>` (currentColor); flush: its ink at the edge
//   • appIcon({ src, size, fade })              → a `.ui-app-icon`, a napp's picture on a plate
//   • author(pubkey, { picture, petname, … })   → a `.ui-author`, a person: the name, a picture
//     when asked for; it fills itself in. authors.use/set/viewer/name feed it
//   • details({ summary, open, … }, …children)  → a `.ui-details` disclosure; summary: text,
//     or parts in a line; fold: `.ui-fold`, the small one under content
//   • code(text)                                → a `.ui-code`, code in a line
//   • codeBlock(text)                           → a `.ui-code-block`, code in lines on a tinted plate
//   • input({ type, placeholder, … })           → a `.ui-input` text field; states are
//     attributes: required, aria-invalid, readonly
//   • class `ui-writing` on a textarea          → somewhere to write, borderless, reading size
//   • class `ui-compact` on a list              → its text, fields, rows and buttons a size down
//   • class `ui-divided` on anything            → a hairline between its children
//   • sticky(el, { top, bottom })               → `.ui-sticky`: stays in view as the rest scrolls,
//     at the top or the bottom (or both), each at an offset. Class `ui-sticky`
//     (+ bottom, --sticky-top/--sticky-bottom) for markup; details({ sticky }) for a summary
//   • check({ checked, onChange, … })           → a `.ui-check` checkbox
//   • overline(text)                            → a `.ui-overline` caption
//   • badge(text, { tone })                     → a `.ui-badge` small-caps label
//   • ring(word)                                → a `.ui-ring` word set round a circle, turning
//   • class `ui-title` on any text              → the window title's voice
//   • class `ui-heading` on a heading           → bold, as written, xl; or `ui-heading-xxl`
//   • itemList() + item({ label }, …controls)   → `.ui-items` / `.ui-item` rows
//   • rowList() + row(list, …summary)           → `.ui-rows` / `.ui-row` rows that open
//   • addControl({ label, onAdd, … })           → the two-step "add an item" form
//   • empty(text)                               → a `.ui-empty` line for when there's nothing
//   • notice(text, { tone })                    → a `.ui-notice`, a glyph and a line to heed
//   • busy(el, on)                              → `.ui-busy` on it: it breathes while something works
//   • spinner()                                 → a `.ui-spinner`, a ring turning, 1em
//   • class `ui-links` on a row of <a>          → dimmed links, lit on hover
//   • class `ui-quote` on quoted text           → a bar on the left, the text a little in
// And a layer over them that owns the state and the structure, so a screen is
// a few calls:
//   • button({ icon, … })                       → a glyph before the label, or alone
//   • tabs({ items, active, onChange })         → `.ui-tabs`, a row owning its selection;
//     segmented: `.ui-segments`, a window's sections
//   • check({ label, note, … })                 → the box and its text as one <label>
//   • radios({ name, options, value, onChange }) → `.ui-radios`, one of N, labelled
//   • field({ label, control, note })           → `.ui-field`, the form line
//   • list({ items, label, controls, add })     → `.ui-list`: rows, add control, add/delete/items
//   • el(tag, class, …children), stack(…), bar(…) → plain glue, a column, a row
//   • flow(…children)                           → `.ui-flow`, text-like content spaced as it reads
// Variants: primary | outline | danger | warning | ghost. Layout (align-self,
// margins, placement) belongs on the parent/context, not the variant. CSS lives
// in src/ui.css, the one file the launcher and the napps share.
//
// list() is the one list component, and all it knows is structure: the column,
// the add control under it, the operations. What a row means — which controls
// it carries, what they do — stays the context's, given as `controls`. For any
// other shape, compose itemList/item/check/addControl directly.

export type ButtonVariant = "primary" | "outline" | "danger" | "warning" | "ghost" | "link"

export interface ButtonOpts {
  label?: string
  onClick?: (e: MouseEvent) => void
  variant?: ButtonVariant
  title?: string
  type?: "button" | "submit"
  disabled?: boolean
  /** A glyph before the label. Alone, the title names the button for assistive tech. */
  icon?: string
  /** Extra classes for layout/context (e.g. "apps-relay-delete"). */
  class?: string
}

// ─── icons ────────────────────────────────────────────────────────
// Inline SVG glyphs (stroke = currentColor, 1em) so they sit consistently next
// to text and follow the theme — no more mismatched unicode characters. The
// body of a 16×16 viewBox per name; exported so a napp can add its own.
export const icons: Record<string, string> = {
  tile: '<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>',
  pack: '<path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4"/>',
  grid: '<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M8 2v12M2 8h12"/>',
  list: '<path d="M2 3h12M2 8h12M2 13h12"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  minus: '<path d="M3.5 8h9"/>',
  save: '<path d="M8 2.5v6M5.5 6L8 8.5 10.5 6"/><path d="M3 11v1.5h10V11"/>',
  reset: '<path d="M13 13.5V9.5a4 4 0 0 0-4-4H4"/><path d="M7 2.5 4 5.5 7 8.5"/>',
  reload: '<path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5"/><path d="M3 3v2.7h2.7"/>',
  back: '<path d="M13 8H3.5M7 4 3.5 8 7 12"/>',
  forward: '<path d="M3 8h9.5M9 4 12.5 8 9 12"/>',
  move: '<path d="M2 8h8"/><path d="M7 5l3 3-3 3"/><path d="M13 4v8"/>',
  window: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6h12"/>',
  close: '<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
  check: '<path d="M3 8.5l3 3 7-7"/>',
  chevron: '<path d="M4 6l4 4 4-4"/>',
  link: '<path d="M6.5 9.5l3-3"/><path d="M7.3 4.7l1.2-1.2a2.4 2.4 0 0 1 3.4 3.4l-1.2 1.2"/><path d="M8.7 11.3l-1.2 1.2a2.4 2.4 0 0 1-3.4-3.4l1.2-1.2"/>',
  warn: '<path d="M8 2.5 14 13H2z"/><path d="M8 6.5v3M8 11.3v.1"/>'
}

// How far each glyph's ink sits in from the start and the end of its box, in
// em, the stroke's round ends included: what flush-start and flush-end take
// back so the ink meets the edge. An icon a napp adds can have its entry too.
export const iconInk: Record<string, [number, number]> = {
  tile: [0.0813, 0.0813],
  pack: [0.0813, 0.0813],
  grid: [0.0813, 0.0813],
  list: [0.0813, 0.0813],
  plus: [0.175, 0.175],
  minus: [0.175, 0.175],
  save: [0.1437, 0.1437],
  reset: [0.2062, 0.1437],
  reload: [0.1437, 0.1563],
  back: [0.175, 0.1437],
  forward: [0.1437, 0.175],
  move: [0.0813, 0.1437],
  window: [0.0813, 0.0813],
  close: [0.2375, 0.2375],
  trash: [0.1437, 0.1437],
  check: [0.1437, 0.1437],
  chevron: [0.2062, 0.2062],
  link: [0.1685, 0.1685],
  warn: [0.0813, 0.0813]
}

export interface IconOpts {
  /** The ink at that edge instead of the box: for an icon that ends (or
   *  starts) a line and lines up with text above or below it. */
  flush?: "start" | "end"
}

export function icon(name: string, opts: IconOpts = {}): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  svg.setAttribute("viewBox", "0 0 16 16")
  svg.setAttribute("width", "1em")
  svg.setAttribute("height", "1em")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "1.4")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.classList.add("ui-icon")
  if (opts.flush) {
    svg.classList.add(`flush-${opts.flush}`)
    // The box narrows to the ink (CSS); the glyph keeps its size, cropped on
    // the far side, where its box is empty.
    svg.setAttribute(
      "preserveAspectRatio",
      opts.flush === "end" ? "xMinYMid slice" : "xMaxYMid slice"
    )
  }
  const ink = iconInk[name]
  if (ink) {
    svg.style.setProperty("--ink-start", `${ink[0]}em`)
    svg.style.setProperty("--ink-end", `${ink[1]}em`)
  }
  svg.innerHTML = icons[name] || ""
  return svg
}

export type AppIconSize = "xs" | "s" | "m" | "l" | "xl"

export interface AppIconOpts {
  src?: string
  /** xs: an author's, in a line of text; s: in a row, m: beside a name
   *  (default), l: on a card, xl: on its detail. */
  size?: AppIconSize
  /** Ease the picture in once it has loaded, for icons that come in late. */
  fade?: boolean
  class?: string
}

export type AppIcon = HTMLSpanElement & { img: HTMLImageElement }

// A napp's picture (`.ui-app-icon`): a rounded square on a faint plate that
// holds its place until the image lands. The <img> is .img, in the plate from
// the moment it is reached for: set its src then, or listen for its error to
// drop the icon.
export function appIcon(opts: AppIconOpts = {}): AppIcon {
  const plate = document.createElement("span") as AppIcon
  plate.className = `ui-app-icon ui-app-icon-${opts.size || "m"}${opts.fade ? " fade" : ""}${opts.class ? ` ${opts.class}` : ""}`
  const img = document.createElement("img")
  img.alt = ""
  img.addEventListener("load", () => img.classList.add("loaded"))
  img.addEventListener("error", () => img.classList.remove("loaded"))
  // The <img> goes in with a picture: one given here, or the first time .img
  // is reached for to set one. Until then the plate stands alone, with no
  // empty image in it to draw a frame.
  Object.defineProperty(plate, "img", {
    get: () => {
      if (img.parentNode !== plate) plate.append(img)
      return img
    }
  })
  if (opts.src) plate.img.src = opts.src
  return plate
}

// Create a styled <button>. Variant drives appearance; layout stays on the
// parent (pass `class` for context-specific positioning if needed).
export function button(opts: ButtonOpts = {}): HTMLButtonElement {
  const b = document.createElement("button")
  b.type = opts.type || "button"
  b.className = `btn btn-${opts.variant || "outline"}${opts.class ? ` ${opts.class}` : ""}`
  if (opts.label != null) b.textContent = opts.label
  if (opts.icon) {
    b.prepend(icon(opts.icon))
    if (opts.label == null && opts.title) b.setAttribute("aria-label", opts.title)
  }
  if (opts.title) b.title = opts.title
  if (opts.disabled) b.disabled = true
  if (opts.onClick) b.addEventListener("click", opts.onClick)
  return b
}

export interface ChipOpts {
  label: string
  onClick?: (e: MouseEvent) => void
  active?: boolean
  icon?: string
  title?: string
  class?: string
}

// A selectable chip (window/space switcher etc.). Built on the button system:
// active → primary, otherwise ghost; the label truncates with an ellipsis.
export function chip(o: ChipOpts): HTMLButtonElement {
  const b = button({
    variant: o.active ? "primary" : "ghost",
    title: o.title,
    onClick: o.onClick,
    class: `btn-chip${o.class ? ` ${o.class}` : ""}`
  })
  if (o.icon) b.appendChild(icon(o.icon))
  const label = document.createElement("span")
  label.className = "btn-chip-label"
  label.textContent = o.label
  b.appendChild(label)
  return b
}

export interface TabOpts {
  label: string
  onClick?: (e: MouseEvent) => void
  active?: boolean
  title?: string
  /** Extra classes for context (e.g. "spaces-tab" for the drag handler). */
  class?: string
}

// A text tab: dimmed label, underline when active (spaces bar, apps type
// filter). Its own primitive rather than a button variant — the flat,
// borderless look fights the .btn backgrounds, which is why these used to be
// hand-rolled. Toggle `.active` on the returned element to change selection.
export function tab(o: TabOpts): HTMLButtonElement {
  const b = document.createElement("button")
  b.type = "button"
  b.className = `ui-tab${o.active ? " active" : ""}${o.class ? ` ${o.class}` : ""}`
  b.textContent = o.label
  if (o.title) b.title = o.title
  if (o.onClick) b.addEventListener("click", o.onClick)
  return b
}

export interface TabItem<T extends string = string> {
  value: T
  /** Shown text; the value if not given. */
  label?: string
  title?: string
  class?: string
}

export interface TabsOpts<T extends string = string> {
  items: Array<T | TabItem<T>>
  active?: T
  onChange?: (value: T) => void
  /** Blocks sharing the row, the selected one filled: a window's sections. */
  segmented?: boolean
  class?: string
}

export type Tabs<T extends string = string> = HTMLDivElement & {
  /** Move the selection without reporting it (restoring state, say). */
  select(value: T): void
  readonly value: T | undefined
}

// A row of tabs that owns the selection: a click moves it and reports the
// value, once, when it changes. Built from tab(); the row is `.ui-tabs`.
export function tabs<T extends string = string>(opts: TabsOpts<T>): Tabs<T> {
  const row = document.createElement("div") as Tabs<T>
  row.className = `${opts.segmented ? "ui-segments" : "ui-tabs"}${opts.class ? ` ${opts.class}` : ""}`
  row.setAttribute("role", "tablist")
  const buttons = new Map<T, HTMLButtonElement>()
  let current = opts.active
  const select = (value: T) => {
    current = value
    for (const [v, b] of buttons) {
      b.classList.toggle("active", v === value)
      b.setAttribute("aria-selected", String(v === value))
    }
  }
  for (const it of opts.items) {
    const t: TabItem<T> = typeof it === "string" ? { value: it } : it
    const b = tab({
      label: t.label ?? t.value,
      title: t.title,
      class: t.class,
      active: t.value === current,
      onClick: () => {
        if (t.value === current) return
        select(t.value)
        opts.onChange?.(t.value)
      }
    })
    if (opts.segmented) b.className = b.className.replace(/^ui-tab\b/, "ui-segment")
    b.setAttribute("role", "tab")
    b.setAttribute("aria-selected", String(t.value === current))
    b.dataset.value = t.value
    buttons.set(t.value, b)
    row.append(b)
  }
  row.select = select
  Object.defineProperty(row, "value", { get: () => current })
  return row
}

export interface DetailsOpts {
  /** The always-visible header: text, or parts in a line (a title, then a
   *  count or a status badge). Keep the parts to update them in place. */
  summary: string | Node | Array<string | Node>
  /** Start expanded (default collapsed). */
  open?: boolean
  /** The small one under content (`.ui-fold`): a rule above, a dimmed summary. */
  fold?: boolean
  /** The summary stays at the top while the content scrolls under it; an
   *  offset keeps it that far down, under something else that sticks. */
  sticky?: boolean | { top: number | string }
  /** Extra classes for context. */
  class?: string
}

// A collapsible disclosure (<details>/<summary>): the summary, then the
// children, which can also be appended later. Parts of a summary go in a
// `.ui-summary` line; a text one can be reset later with
// `d.querySelector("summary")!.textContent = …`.
export function details(opts: DetailsOpts, ...children: Array<Node | string>): HTMLDetailsElement {
  const d = document.createElement("details")
  d.className = [opts.fold ? "ui-fold" : "ui-details", opts.sticky && "sticky", opts.class]
    .filter(Boolean)
    .join(" ")
  if (opts.open) d.open = true
  const s = document.createElement("summary")
  if (opts.sticky && typeof opts.sticky === "object") s.style.setProperty("--sticky-top", stickyLength(opts.sticky.top))
  if (typeof opts.summary === "string") s.textContent = opts.summary
  else s.append(el("span", "ui-summary", ...[opts.summary].flat()))
  d.append(s, ...children)
  return d
}

export interface InputOpts {
  type?: string
  placeholder?: string
  value?: string
  autocomplete?: string
  spellcheck?: boolean
  /** Extra classes for layout/context. */
  class?: string
}

// A styled text input (`.ui-input`). Appearance comes from the class; layout
// (flex/width) belongs on the parent/context.
export function input(opts: InputOpts = {}): HTMLInputElement {
  const el = document.createElement("input")
  el.type = opts.type || "text"
  el.className = `ui-input${opts.class ? ` ${opts.class}` : ""}`
  if (opts.placeholder != null) el.placeholder = opts.placeholder
  if (opts.value != null) el.value = opts.value
  if (opts.autocomplete) el.setAttribute("autocomplete", opts.autocomplete)
  if (opts.spellcheck === false) el.spellcheck = false
  return el
}

export interface FieldOpts {
  label: string
  control: HTMLElement
  /** A dimmed line under the control. */
  note?: string
  class?: string
}

// A form line (`.ui-field`): an overline caption, the control under it filling
// the width, a note under that. A <label>, so the caption focuses the control.
export function field(opts: FieldOpts): HTMLLabelElement {
  const l = document.createElement("label")
  l.className = `ui-field${opts.class ? ` ${opts.class}` : ""}`
  l.append(overline(opts.label), opts.control)
  if (opts.note) {
    const n = document.createElement("span")
    n.className = "ui-field-note"
    n.textContent = opts.note
    l.append(n)
  }
  return l
}

export interface CheckOpts {
  checked?: boolean
  title?: string
  onChange?: (checked: boolean) => void
  /** Extra classes: on the box, or on the <label> when there is one. */
  class?: string
  /** Text beside the box, as one <label> with it: the words toggle it too. The box is its `.control`. */
  label?: string
  /** A dimmed line under the label. */
  note?: string
}

function box(opts: CheckOpts, type: "checkbox" | "radio"): HTMLInputElement {
  const c = document.createElement("input")
  c.type = type
  c.className = `ui-check${type === "radio" ? " ui-radio" : ""}${opts.class && !opts.label ? ` ${opts.class}` : ""}`
  if (opts.checked) c.checked = true
  if (opts.title) c.title = opts.title
  if (opts.onChange) c.addEventListener("change", () => opts.onChange!(c.checked))
  return c
}

// The box and its text as one <label> (`.ui-check-label`).
function labeled(input: HTMLInputElement, opts: CheckOpts): HTMLLabelElement {
  const l = document.createElement("label")
  l.className = `ui-check-label${opts.class ? ` ${opts.class}` : ""}`
  const text = document.createElement("span")
  text.className = "ui-check-text"
  text.textContent = opts.label!
  if (opts.note) {
    const n = document.createElement("span")
    n.className = "ui-check-note"
    n.textContent = opts.note
    text.append(n)
  }
  l.append(input, text)
  return l
}

// A themeable checkbox (`.ui-check`): checked takes a --surface fill with a
// --text border and check, so it flips with the theme (same as the napps').
// With a label, the box comes with its text as one <label>.
export function check(opts: CheckOpts & { label: string }): HTMLLabelElement
export function check(opts?: CheckOpts): HTMLInputElement
export function check(opts: CheckOpts = {}): HTMLElement {
  const c = box(opts, "checkbox")
  return opts.label ? labeled(c, opts) : c
}

// Same visual as check(), round — for one-of-N picks. radios() builds the group.
export function radio(opts: CheckOpts & { name: string; label: string }): HTMLLabelElement
export function radio(opts: CheckOpts & { name: string }): HTMLInputElement
export function radio(opts: CheckOpts & { name: string }): HTMLElement {
  const r = box(opts, "radio")
  r.name = opts.name
  return opts.label ? labeled(r, opts) : r
}

export interface RadioItem<T extends string = string> {
  value: T
  /** Shown text; the value if not given. */
  label?: string
  title?: string
  note?: string
}

export interface RadiosOpts<T extends string = string> {
  name: string
  options: Array<T | RadioItem<T>>
  value?: T
  onChange?: (value: T) => void
  /** A caption before the options, in the overline's voice. */
  label?: string
  /** One line until clicked, in the overline's voice: the caption and the
   *  pick. Clicked, the options take the pick's place; choosing folds it back. */
  collapse?: boolean
  class?: string
}

export type Radios<T extends string = string> = HTMLDivElement & { value: T | undefined }

// One of N, labelled, as a group (`.ui-radios`): `.value` reads and sets the
// pick, onChange reports it. A row that wraps; a class of the context's can
// stack it.
export function radios<T extends string = string>(opts: RadiosOpts<T>): Radios<T> {
  const group = document.createElement("div") as Radios<T>
  group.className = ["ui-radios", opts.collapse && "collapse", opts.class].filter(Boolean).join(" ")
  group.setAttribute("role", "radiogroup")
  if (opts.label) {
    group.setAttribute("aria-label", opts.label)
    group.append(overline(opts.label))
  }
  // Collapsed, the pick stands in for the options until it's clicked.
  const pick = opts.collapse ? el("button", "ui-radios-value ui-overline") : null
  const inputs = new Map<T, HTMLInputElement>()
  const names = new Map<T, string>()
  const show = (v: T | undefined) => {
    if (pick) pick.textContent = v === undefined ? "" : (names.get(v) ?? v)
  }
  if (pick) {
    pick.type = "button"
    pick.addEventListener("click", () => {
      group.classList.add("open")
      ;([...inputs.values()].find(i => i.checked) ?? inputs.values().next().value)?.focus()
    })
    // Choosing folds it back, the pick already chosen too (it fires no change).
    group.addEventListener("click", e => {
      if (e.target instanceof HTMLInputElement) group.classList.remove("open")
    })
    group.addEventListener("keydown", e => {
      if (e.key !== "Escape" || !group.classList.contains("open")) return
      group.classList.remove("open")
      pick.focus()
    })
    group.append(pick)
  }
  for (const o of opts.options) {
    const it: RadioItem<T> = typeof o === "string" ? { value: o } : o
    const l = radio({
      name: opts.name,
      label: it.label ?? it.value,
      note: it.note,
      title: it.title,
      checked: it.value === opts.value,
      onChange: () => {
        show(it.value)
        opts.onChange?.(it.value)
      }
    })
    if (pick) l.querySelector(".ui-check-text")?.classList.add("ui-overline")
    inputs.set(it.value, l.control as HTMLInputElement)
    names.set(it.value, it.label ?? it.value)
    group.append(l)
  }
  show(opts.value)
  Object.defineProperty(group, "value", {
    get: () => [...inputs].find(([, i]) => i.checked)?.[0],
    set: (v: T) => {
      for (const [k, i] of inputs) i.checked = k === v
      show(v)
    }
  })
  return group
}

// Small uppercase letter-spaced caption (`.ui-overline`) — control captions,
// metadata badges, counts.
export function overline(text: string, cls?: string): HTMLSpanElement {
  const s = document.createElement("span")
  s.className = `ui-overline${cls ? ` ${cls}` : ""}`
  s.textContent = text
  return s
}

export interface BadgeOpts {
  /** Colors it for a state and takes the dimming off. */
  tone?: "good" | "danger" | "warn"
  title?: string
  class?: string
}

// A short label in small sans capitals, dimmed (`.ui-badge`): a state, a type,
// what a napp handles.
export function badge(text: string, opts: BadgeOpts = {}): HTMLSpanElement {
  const b = document.createElement("span")
  b.className = ["ui-badge", opts.tone, opts.class].filter(Boolean).join(" ")
  b.textContent = text
  if (opts.title) b.title = opts.title
  return b
}

// A word set around a circle (`.ui-ring`), slowly turning — the overline's
// voice bent into a stamp. Geometry is in em of the ring's text (the font-size
// on .ui-ring, the overline's by default) and the svg sizes itself to fit, like
// icon(). The word goes round once, its letters spread to fill the
// circumference (textLength on the textPath — where Blink reads it), and a dot
// sits centred in the seam: its own run, since a fitted run gets no gap after
// its last glyph. Orange by default, glyphs only; placement is the context's.
let ringSeq = 0
export function ring(word: string, cls?: string): SVGElement {
  const NS = "http://www.w3.org/2000/svg"
  // Drawn at 100 units per em: Blink measures a path by flattening it to a
  // fixed tolerance in user units, so a circle a few units wide comes out
  // short and glyphs placed past its "end" are dropped.
  const em = 100
  const r = 1.6 * em // the baseline circle's radius
  const box = 2 * (r + 0.8 * em) // the glyphs stand outside the path: room for them
  const c = box / 2
  const circ = 2 * Math.PI * r
  const n = word.length
  const glyph = 0.6 * em // ≈ an uppercase glyph's advance, tracking included
  const dot = 0.3 * em
  // n − 1 gaps inside the word and one either side of the dot, all equal.
  const gap = (circ - n * glyph - dot) / (n + 1)
  const span = n * glyph + (n - 1) * gap // the word's run along the path
  const svg = document.createElementNS(NS, "svg")
  svg.setAttribute("viewBox", `0 0 ${box} ${box}`)
  svg.setAttribute("width", `${box / em}em`)
  svg.setAttribute("height", `${box / em}em`)
  svg.setAttribute("aria-hidden", "true")
  svg.classList.add("ui-ring")
  if (cls) svg.classList.add(...cls.split(" "))
  const id = `ui-ring-${++ringSeq}`
  const defs = document.createElementNS(NS, "defs")
  const path = document.createElementNS(NS, "path")
  path.id = id
  // A full circle from the top, clockwise, so the text reads the right way up
  // along the outside.
  path.setAttribute("d", `M${c} ${c - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}`)
  defs.appendChild(path)
  const run = (content: string, attrs: Record<string, string>) => {
    const text = document.createElementNS(NS, "text")
    text.setAttribute("font-size", String(em))
    const tp = document.createElementNS(NS, "textPath")
    tp.setAttribute("href", `#${id}`)
    for (const [k, v] of Object.entries(attrs)) tp.setAttribute(k, v)
    tp.textContent = content
    text.appendChild(tp)
    return text
  }
  const wordRun = run(word, { textLength: span.toFixed(1), lengthAdjust: "spacing" })
  const dotRun = run("·", { startOffset: ((span + circ) / 2).toFixed(1) })
  dotRun.setAttribute("text-anchor", "middle")
  svg.append(defs, wordRun, dotRun)
  return svg
}

// ─── item lists ───────────────────────────────────────────────────
// The editable-list shape (relays napp look): itemList() is the column, item()
// one hairline-separated row — its text, cut with an ellipsis, plus whatever
// controls the context needs on the right — and addControl() the deliberate
// two-step add affordance. Compose per context; there is no monolithic list
// component on purpose.

export function itemList(cls?: string): HTMLDivElement {
  const el = document.createElement("div")
  el.className = `ui-items${cls ? ` ${cls}` : ""}`
  return el
}

export interface ItemOpts {
  /** The row's text, one line cut with an ellipsis. Its voice is what's in
   *  it: text takes the row's, an element brings its own (code(url) for an
   *  id or a url). */
  label: string | HTMLElement
  /** Tooltip; defaults to the label's text. */
  title?: string
  /** A row that failed: its label and caption in the danger color. */
  tone?: "danger"
  class?: string
}

export function item(opts: ItemOpts, ...controls: HTMLElement[]): HTMLDivElement {
  const row = document.createElement("div")
  row.className = ["ui-item", opts.tone, opts.class].filter(Boolean).join(" ")
  const label = typeof opts.label === "string" ? el("span", "", opts.label) : opts.label
  label.classList.add("ui-item-label")
  label.title = opts.title || label.textContent || ""
  row.appendChild(label)
  for (const c of controls) row.appendChild(c)
  return row
}

// Rows that open: rowList() holds them, row() is a line that opens to whatever
// is appended to it. They read like item rows, with a +/– at the end. A list's
// rows share a details name, so one opens at a time, and while one is open
// the list shows only it (CSS, .ui-rows). A row goes on the end of its list
// itself; other lines you append.
let rowListSerial = 0

export function rowList(cls?: string): HTMLDivElement {
  const el = document.createElement("div")
  el.className = `ui-rows${cls ? ` ${cls}` : ""}`
  el.dataset.rows = `ui-rows-${rowListSerial++}`
  // The rest of the list unfolds when the open row closes, and only then: its
  // @starting-style would otherwise run whenever the list shows up again (a
  // space switched back to, a parent disclosure opened). A mutation callback
  // runs before the next frame, so the class is there when the rows come back.
  let settle = 0
  new MutationObserver(changes => {
    for (const c of changes) {
      const row = c.target as HTMLDetailsElement
      if (row.parentElement !== el || row.open || c.oldValue === null) continue
      if (el.querySelector(":scope > .ui-row[open]")) continue
      el.classList.add("ui-rows-unfolding")
      clearTimeout(settle)
      settle = window.setTimeout(() => el.classList.remove("ui-rows-unfolding"), 300)
    }
  }).observe(el, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
    attributeOldValue: true
  })
  return el
}

export function row(list: HTMLElement, ...summary: Array<string | Node>): HTMLDetailsElement {
  const el = document.createElement("details")
  el.className = "ui-row"
  el.setAttribute("name", list.dataset.rows || "")
  const line = document.createElement("summary")
  line.append(...summary)
  el.appendChild(line)
  list.append(el)
  return el
}

export interface AddControlOpts {
  /** Collapsed button label, e.g. "add a relay". */
  label: string
  placeholder?: string
  class?: string
  /** Return an error message to show it inline; return nothing on success —
   *  the input clears and stays open so several entries can be added in a row. */
  onAdd: (value: string) => string | void
}

// Collapsed: a single outline button. Clicked: an input + add button in its
// place (and focused), so adding is one deliberate step.
export function addControl(opts: AddControlOpts): HTMLDivElement {
  const wrap = document.createElement("div")
  wrap.className = `ui-add${opts.class ? ` ${opts.class}` : ""}`
  const error = document.createElement("div")
  error.className = "ui-add-error"
  const open = () => {
    const form = document.createElement("form")
    form.className = "ui-add-form"
    const inp = input({ placeholder: opts.placeholder, class: "ui-add-input", spellcheck: false })
    inp.setAttribute("autocomplete", "off")
    inp.setAttribute("autocapitalize", "off") // an id, a url: as typed, on a phone too
    inp.addEventListener("input", () => (error.textContent = ""))
    form.append(inp, button({ label: "add", variant: "outline", type: "submit" }))
    form.addEventListener("submit", e => {
      e.preventDefault()
      const err = opts.onAdd(inp.value)
      error.textContent = typeof err === "string" ? err : ""
      if (typeof err !== "string") inp.value = ""
      inp.focus()
    })
    wrap.replaceChildren(form, error)
    inp.focus()
  }
  wrap.appendChild(button({ label: opts.label, variant: "outline", onClick: open }))
  return wrap
}

export interface ListOpts<T> {
  items?: T[]
  /** The row's text (see item()); String(item) if not given. */
  label?: (item: T) => string | HTMLElement
  /** The label's tooltip; the label if not given. */
  title?: (item: T) => string
  /** The controls after the label: the context's pick. `row` is the element, for a class or a data attribute. */
  controls?: (item: T, row: HTMLDivElement) => HTMLElement[]
  /** The two-step add control under the rows. onAdd refuses with an error; otherwise it takes the value in with add(). */
  add?: AddControlOpts
  /** A dimmed line while there are no rows. */
  empty?: string
  class?: string
}

export type List<T> = HTMLDivElement & {
  add(item: T): HTMLDivElement
  delete(item: T): void
  /** The items, in order; assign to replace them all. */
  items: T[]
}

// A list of things (`.ui-list`): the rows column, the add control under it,
// and the operations, with each row built by item() from the label and the
// controls the context gives. Items are keyed by identity.
export function list<T>(opts: ListOpts<T> = {}): List<T> {
  const root = document.createElement("div") as List<T>
  root.className = `ui-list${opts.class ? ` ${opts.class}` : ""}`
  const rows = itemList()
  const entries = new Map<T, HTMLDivElement>()
  const none = empty(opts.empty ?? "")
  const settle = () => (none.hidden = !opts.empty || entries.size > 0)
  const add = (entry: T) => {
    const label = opts.label ? opts.label(entry) : String(entry)
    const r = item({ label, title: opts.title ? opts.title(entry) : undefined })
    if (opts.controls) r.append(...opts.controls(entry, r))
    entries.get(entry)?.remove()
    entries.set(entry, r)
    rows.append(r)
    settle()
    return r
  }
  root.add = add
  root.delete = (entry: T) => {
    entries.get(entry)?.remove()
    entries.delete(entry)
    settle()
  }
  Object.defineProperty(root, "items", {
    get: () => [...entries.keys()],
    set: (items: T[]) => {
      for (const r of entries.values()) r.remove()
      entries.clear()
      for (const entry of items) add(entry)
      settle()
    }
  })
  root.append(rows, none)
  if (opts.add) root.append(addControl(opts.add))
  root.items = opts.items ?? []
  return root
}

// The line for when a list or a section has nothing yet (`.ui-empty`). It takes
// the size of where it sits.
export function empty(text: string, cls?: string): HTMLDivElement {
  const e = document.createElement("div")
  e.className = `ui-empty${cls ? ` ${cls}` : ""}`
  e.textContent = text
  return e
}

// Code in a line (`.ui-code`): the mono voice at 0.85em of the text around
// it. For a row's label, a method in a sentence, an id.
export function code(text: string, cls?: string): HTMLElement {
  return el("code", `ui-code${cls ? ` ${cls}` : ""}`, text)
}

// Code or data in lines, on a tinted plate (`.ui-code-block`): a <pre> whose
// long lines wrap. A height cap is the context's.
export function codeBlock(text: string, cls?: string): HTMLPreElement {
  return el("pre", `ui-code-block${cls ? ` ${cls}` : ""}`, text)
}

export interface NoticeOpts {
  /** Colors the glyph: warn (default), danger, good. */
  tone?: "warn" | "danger" | "good"
  /** The glyph; warn, or check for good, if not given. */
  icon?: string
  class?: string
}

// A line to heed (`.ui-notice`): a glyph in the tone's color, the text beside
// it, wrapping under itself.
export function notice(text: string, opts: NoticeOpts = {}): HTMLDivElement {
  const tone = opts.tone || "warn"
  const n = el("div", `ui-notice ${tone}${opts.class ? ` ${opts.class}` : ""}`)
  n.append(icon(opts.icon || (tone === "good" ? "check" : "warn")), el("span", "", text))
  return n
}

// Something working on it (`.ui-busy`): it breathes until done, and says so to
// assistive tech. busy(el, false) when it's done.
export function busy<T extends HTMLElement>(el: T, on = true): T {
  el.classList.toggle("ui-busy", on)
  if (on) el.setAttribute("aria-busy", "true")
  else el.removeAttribute("aria-busy")
  return el
}

// A ring turning (`.ui-spinner`), 1em in the text's color: next to text as it
// is, bigger through its font-size.
export function spinner(cls?: string): HTMLSpanElement {
  const s = el("span", `ui-spinner${cls ? ` ${cls}` : ""}`)
  s.setAttribute("role", "status")
  s.setAttribute("aria-label", "loading")
  return s
}

// ─── author ───────────────────────────────────────────────────────
// A person, the same wherever one is named (`.ui-author`): the name, a picture
// before it when asked for, and after it, when asked for, the petname and a
// check for someone followed. The name is, in this order: the profile's name,
// the petname the viewer gave them, the profile's display name, the short
// npub. It shows at once with what is known and fills itself in when the
// profile lands: every element for a pubkey is filed under it, so one arrival
// repaints exactly those. Lookups go out a few at a time, so a long list
// doesn't fire one per row in a burst.
//
// The kit has no bridge and no codec of its own; `authors.use()` gives it
// what it needs (the launcher at startup, napp-ui.js for napps). A context
// that already holds profiles hands them over with `authors.set()`.

export interface AuthorOpts {
  /** A picture before the name: true for the one that sits in a line of text
   *  (xs, 1rem), or an app icon size for a bigger one (s in a row). */
  picture?: boolean | AppIconSize
  /** After the name, dimmed: the viewer's petname for them, when it isn't
   *  already the name shown. */
  petname?: boolean
  /** After the name: a check when the viewer follows them. */
  follows?: boolean
  /** Text before the name: a mention's "@". */
  prefix?: string
  /** false: a plain element, for a row that is itself the control. */
  link?: boolean
  /** What a click does, instead of opening the profile. */
  onClick?: (pubkey: string, e: MouseEvent) => void
  class?: string
}

export interface AuthorsConfig {
  /** The profile for a pubkey: what loadNostrUser gives, or a kind 0's content.
   *  null: the context looks profiles up itself and hands them over with set(). */
  load?: ((pubkey: string) => Promise<unknown>) | null
  /** The npub for a hex pubkey. */
  npub?: (pubkey: string) => string
  /** What a click on an author does: open the profile. */
  open?: (pubkey: string) => void
  /** Who an authorPicker lists for a term: rows of { pubkey, follows, …a kind
   *  0's content }, best first; remote: relay search may fill up the rest.
   *  nip05: names resolved and each row's nip-05 checked. Napps get the
   *  launcher's findAuthors. */
  search?: (
    term: string,
    opts: { limit?: number; remote?: boolean; nip05?: boolean }
  ) => Promise<unknown[]>
}

interface AuthorInfo {
  name: string
  displayName: string
  picture: string
}

const authorsConfig: AuthorsConfig = {}
const authorInfo = new Map<string, AuthorInfo>() // what a profile gave
const authorAsked = new Map<string, number>() // when a lookup last went out
const authorEls = new Map<string, Set<WeakRef<HTMLElement>>>() // the elements to repaint
const authorOpts = new WeakMap<HTMLElement, AuthorOpts>()
let authorPetnames = new Map<string, string>() // the viewer's follows: pubkey → petname, "" for none
const authorQueue: string[] = []
let authorTimer = 0
const AUTHOR_PER_TICK = 32
const AUTHOR_TICK_MS = 120
const AUTHOR_ASK_AGAIN = 5 * 60e3 // a profile not found is asked for again after this

// An element that's gone takes its entry with it.
const authorGone = new FinalizationRegistry<[string, WeakRef<HTMLElement>]>(([pubkey, ref]) => {
  const set = authorEls.get(pubkey)
  if (!set) return
  set.delete(ref)
  if (!set.size) authorEls.delete(pubkey)
})

function authorFrom(user: unknown): AuthorInfo {
  const u = (user && typeof user === "object" ? user : {}) as Record<string, unknown>
  const m = (u.metadata && typeof u.metadata === "object" ? u.metadata : u) as Record<
    string,
    unknown
  >
  const text = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "")
  const picture = text(u.image) || text(m.picture)
  return {
    name: text(m.name),
    displayName: text(m.display_name),
    picture: /^(https?:\/\/|data:image\/)/i.test(picture) ? picture : ""
  }
}

function authorNpub(pubkey: string): string {
  try {
    return authorsConfig.npub?.(pubkey) || pubkey
  } catch {
    return pubkey
  }
}

function authorShort(pubkey: string): string {
  const npub = authorNpub(pubkey)
  return npub === pubkey ? `${pubkey.slice(0, 8)}…` : `${npub.slice(0, 8)}…${npub.slice(-4)}`
}

function authorName(pubkey: string): string {
  const info = authorInfo.get(pubkey)
  return (
    info?.name || authorPetnames.get(pubkey) || info?.displayName || authorShort(pubkey)
  )
}

function authorPaint(el: HTMLElement) {
  const pubkey = el.dataset.pubkey || ""
  const opts = authorOpts.get(el) || {}
  const shown = authorName(pubkey)
  const name = el.querySelector(".ui-author-name")
  const text = (opts.prefix || "") + shown
  if (name && name.textContent !== text) name.textContent = text
  el.title = authorNpub(pubkey)
  // The picture goes in once there is one and comes out again if it fails:
  // the plate alone holds its place, never an empty or a broken image.
  const picture = authorInfo.get(pubkey)?.picture
  const plate = el.querySelector<AppIcon>(".ui-app-icon")
  if (plate && picture && plate.dataset.failed !== picture) {
    const img = plate.img
    if (img.getAttribute("src") !== picture) {
      img.referrerPolicy = "no-referrer"
      img.loading = "lazy"
      img.onerror = () => {
        plate.dataset.failed = img.getAttribute("src") || ""
        img.remove()
      }
      img.src = picture
    }
  }
  const pet = el.querySelector<HTMLElement>(".ui-author-pet")
  if (pet) {
    const petname = authorPetnames.get(pubkey) || ""
    pet.textContent = petname !== shown ? petname : ""
    pet.hidden = !pet.textContent
  }
  const follows = el.querySelector<HTMLElement>(".ui-author-follows")
  if (follows) follows.hidden = !authorPetnames.has(pubkey)
}

function authorRepaint(pubkey: string) {
  for (const ref of authorEls.get(pubkey) || []) {
    const el = ref.deref()
    if (el) authorPaint(el)
  }
}

function authorAsk(pubkey: string) {
  if (!authorsConfig.load || authorInfo.has(pubkey)) return
  const asked = authorAsked.get(pubkey)
  if (asked && Date.now() - asked < AUTHOR_ASK_AGAIN) return
  authorAsked.set(pubkey, Date.now())
  authorQueue.push(pubkey)
  if (!authorTimer) authorTimer = window.setTimeout(authorTick, 0)
}

function authorTick() {
  authorTimer = 0
  for (const pubkey of authorQueue.splice(0, AUTHOR_PER_TICK)) {
    Promise.resolve()
      .then(() => authorsConfig.load!(pubkey))
      .then(user => authors.set(pubkey, user))
      .catch(() => {})
  }
  if (authorQueue.length) authorTimer = window.setTimeout(authorTick, AUTHOR_TICK_MS)
}

export const authors = {
  /** Give the kit its ways in: how to load a profile, encode an npub, open a profile. */
  use(config: AuthorsConfig) {
    Object.assign(authorsConfig, config)
  },
  /** A profile that landed some other way (a feed's own lookups, a kind 0 in
   *  hand): what loadNostrUser gives, or a kind 0's content. Nothing in it
   *  leaves what's held alone. */
  set(pubkey: string, user: unknown) {
    const info = authorFrom(user)
    // An empty profile still caches — known is what stops the re-asks — but
    // never over a fuller one already in hand (a junk set must not blank it).
    if (!info.name && !info.displayName && !info.picture && authorInfo.has(pubkey)) return
    authorInfo.set(pubkey, info)
    authorRepaint(pubkey)
  },
  /** The viewer's follow list, a kind 3 (or null, logged out): its petnames
   *  name people the profile doesn't, and its p tags are who is followed. */
  viewer(follows: { tags?: unknown } | null) {
    authorPetnames = new Map()
    const tags = Array.isArray(follows?.tags) ? follows.tags : []
    for (const t of tags) {
      if (!Array.isArray(t) || t[0] !== "p" || typeof t[1] !== "string") continue
      const pubkey = t[1].toLowerCase()
      if (!authorPetnames.has(pubkey))
        authorPetnames.set(pubkey, typeof t[3] === "string" ? t[3].trim() : "")
    }
    for (const pubkey of authorEls.keys()) authorRepaint(pubkey)
  },
  /** The name as text, as known right now: for a toast, a title, a filter. */
  name(pubkey: string): string {
    authorAsk(pubkey)
    return authorName(pubkey)
  },
  /** Whether the viewer follows them. */
  follows(pubkey: string): boolean {
    return authorPetnames.has(pubkey)
  }
}

export function author(pubkey: string, opts: AuthorOpts = {}): HTMLElement {
  const link = opts.link !== false
  const a = document.createElement(link ? "a" : "span")
  a.className = `ui-author${opts.class ? ` ${opts.class}` : ""}`
  a.dataset.pubkey = pubkey
  if (link) {
    ;(a as HTMLAnchorElement).href = "#"
    a.addEventListener("click", e => {
      e.preventDefault()
      if (opts.onClick) opts.onClick(pubkey, e as MouseEvent)
      else authorsConfig.open?.(pubkey)
    })
  }
  // the plate now, its picture when there is one (authorPaint)
  if (opts.picture) a.append(appIcon({ size: opts.picture === true ? "xs" : opts.picture }))
  a.append(el("span", "ui-author-name"))
  if (opts.petname) a.append(code("", "ui-author-pet"))
  if (opts.follows) {
    const mark = el("span", "ui-author-follows", icon("check"))
    mark.title = "you follow them"
    a.append(mark)
  }
  authorOpts.set(a, opts)
  const ref = new WeakRef<HTMLElement>(a)
  let set = authorEls.get(pubkey)
  if (!set) authorEls.set(pubkey, (set = new Set()))
  set.add(ref)
  authorGone.register(a, [pubkey, ref])
  authorPaint(a)
  authorAsk(pubkey)
  return a
}

// ─── author picker ────────────────────────────────────────────────
// People to pick from as one types, the same in every napp. Attached to a
// text box with a trigger ("@"), the trigger after a space or at a line's
// start opens a list at it and what follows filters it; attached to a field
// without one, the field's value is the query (a pasted npub, nprofile, hex
// or nip-05 is that one person). The focus stays in the text: ↑/↓ move, Enter
// or Tab picks, Esc shuts it until the word is left. What a pick puts in the
// text is onPick's to say. The list is a top-layer popover, so no container
// clips it. Its rows come from authors.use({ search }): known profiles only,
// unless the build asks for relay search (remote) or nip-05 checks (nip05) —
// then a second pass, once typing pauses, brings what those add.

export interface PickedAuthor {
  pubkey: string
  name?: string
  display_name?: string
  picture?: string
  nip05?: string
  follows?: boolean
}

export interface AuthorPickerOpts {
  /** Text box mode: a word starting with this opens the list. Without it,
   *  field mode: the whole value is the query. */
  trigger?: string
  /** A pick. Text box mode: what replaces the trigger and the query;
   *  field mode: the field's new value. Nothing returned: left as typed. */
  onPick: (author: PickedAuthor) => string | void
  /** Rows at most, 8 by default. */
  limit?: number
  /** Relay search fills up a list the known profiles don't. Off by default. */
  remote?: boolean
  /** A typed name@domain resolves to its person, and a row's nip-05 shows
   *  only once it's checked to point back at them. Off by default: the
   *  nip-05 a profile claims shows as it is. */
  nip05?: boolean
  class?: string
}

export interface AuthorPicker {
  close(): void
  /** Takes the listeners and the list away. */
  detach(): void
}

let pickerSerial = 0

const CARET_STYLE = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "fontStretch",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textTransform",
  "textIndent",
  "tabSize"
] as const

// Where a character of a text box sits on screen: a hidden copy of the box
// with the text up to it, and a marker there.
function caretPoint(field: HTMLTextAreaElement | HTMLInputElement, index: number) {
  const cs = getComputedStyle(field)
  const copy = document.createElement("div")
  const style = copy.style as unknown as Record<string, string>
  for (const prop of CARET_STYLE) style[prop] = cs[prop]
  Object.assign(copy.style, {
    position: "absolute",
    visibility: "hidden",
    top: "0",
    left: "-9999px",
    height: "auto",
    overflow: "hidden",
    whiteSpace: field instanceof HTMLTextAreaElement ? "pre-wrap" : "pre",
    overflowWrap: "break-word"
  })
  copy.textContent = field.value.slice(0, index)
  const mark = document.createElement("span")
  mark.textContent = field.value.slice(index).split(/\s/)[0] || "."
  copy.append(mark)
  document.body.append(copy)
  const box = field.getBoundingClientRect()
  const top = box.top + mark.offsetTop - field.scrollTop
  const left = box.left + mark.offsetLeft - field.scrollLeft
  const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2
  copy.remove()
  return { left, top, bottom: top + line }
}

export function authorPicker(
  target: HTMLTextAreaElement | HTMLInputElement,
  opts: AuthorPickerOpts
): AuthorPicker {
  const limit = Math.max(1, opts.limit ?? 8)
  const trigger = opts.trigger || ""
  const remote = opts.remote === true
  const nip05 = opts.nip05 === true
  const list = el("div", `ui-author-picker${opts.class ? ` ${opts.class}` : ""}`)
  list.id = `ui-author-picker-${pickerSerial++}`
  list.setAttribute("role", "listbox")
  const layered = typeof list.showPopover === "function"
  if (layered) list.popover = "manual"
  list.hidden = !layered
  let rows: PickedAuthor[] = []
  let active = 0
  let query: { start: number; end: number; text: string } | null = null
  let ask = 0 // the current question; an answer to an older one is dropped
  let settled = 0 // the question whose second pass has answered
  let localTimer = 0
  let remoteTimer = 0
  let shut = -1 // Esc: the trigger at this position stays shut while it's being typed
  let quiet = false // our own input event, after a pick

  const isOpen = () => (layered ? list.matches(":popover-open") : !list.hidden)
  const show = () => {
    if (!list.isConnected) document.body.append(list)
    if (layered && !isOpen()) list.showPopover()
    if (!layered) list.hidden = false
    place()
  }
  const close = () => {
    ask++
    clearTimeout(localTimer)
    clearTimeout(remoteTimer)
    query = null
    rows = []
    if (isOpen()) {
      if (layered) list.hidePopover()
      else list.hidden = true
    }
    target.removeAttribute("aria-activedescendant")
  }

  function currentQuery() {
    const value = target.value
    const caret = target.selectionStart ?? value.length
    if (target.selectionEnd !== caret) return null
    if (!trigger) return { start: 0, end: value.length, text: value.trim() }
    const before = value.slice(0, caret)
    const at = before.lastIndexOf(trigger)
    if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]))) return null
    const text = before.slice(at + trigger.length)
    if (/\s/.test(text) || text.length > 64) return null
    return { start: at, end: caret, text }
  }

  function refresh() {
    if (quiet) return
    const q = currentQuery()
    if (!q) shut = -1
    if (!q || q.start === shut || document.activeElement !== target) return close()
    // Nothing is looked up before a character follows the trigger: the list
    // opens at it with just that said (a field waits for its first character).
    if (!q.text) {
      close()
      if (!trigger) return
      query = q
      list.replaceChildren(empty("type to search"))
      show()
      return
    }
    query = q
    const n = ++ask
    clearTimeout(localTimer)
    clearTimeout(remoteTimer)
    localTimer = window.setTimeout(() => lookup(q.text, false, n), 60)
    if (remote || nip05) remoteTimer = window.setTimeout(() => lookup(q.text, true, n), 450)
  }

  // First pass: known profiles. Second (when asked for): what relay search
  // and nip-05 checks add, replacing the first's rows.
  async function lookup(text: string, second: boolean, n: number) {
    const search = authorsConfig.search
    if (!search) return
    // nothing for a second pass to add: a full list, and no nip-05s to check
    if (second && !nip05 && rows.length >= limit) return
    let found: unknown[] = []
    try {
      found = await search(text, second ? { limit, remote, nip05 } : { limit })
    } catch {}
    if (n !== ask || (!second && settled === n)) return
    if (second) settled = n
    const picked = rows[active]?.pubkey
    rows = (Array.isArray(found) ? found : [])
      .filter(
        (r): r is PickedAuthor =>
          !!r &&
          typeof (r as PickedAuthor).pubkey === "string" &&
          /^[0-9a-f]{64}$/.test((r as PickedAuthor).pubkey)
      )
      .slice(0, limit)
    // unchecked nip-05s wait for the second pass
    if (nip05 && !second) rows = rows.map(r => ({ ...r, nip05: "" }))
    for (const r of rows) authors.set(r.pubkey, r)
    active = Math.max(
      0,
      rows.findIndex(r => r.pubkey === picked)
    )
    if (rows.length) render()
    else if (second || !(remote || nip05)) {
      list.replaceChildren(empty("no one found"))
      show()
    }
  }

  function render() {
    list.replaceChildren(
      ...rows.map((r, i) => {
        const row = el("div", "ui-author-pick", author(r.pubkey, { picture: "s", link: false }))
        row.id = `${list.id}-${i}`
        row.setAttribute("role", "option")
        if (r.nip05) row.append(code(r.nip05, "ui-author-pick-nip05"))
        if (r.follows) {
          const mark = el("span", "ui-author-follows", icon("check"))
          mark.title = "you follow them"
          row.append(mark)
        }
        // mousedown, not click: the text keeps its focus and its caret
        row.addEventListener("mousedown", e => {
          e.preventDefault()
          pick(i)
        })
        row.addEventListener("mousemove", () => {
          if (active !== i) setActive(i)
        })
        return row
      })
    )
    setActive(active)
    show()
  }

  function setActive(i: number) {
    active = i
    list.querySelectorAll(".ui-author-pick").forEach((row, j) => {
      row.classList.toggle("active", j === i)
      row.setAttribute("aria-selected", String(j === i))
      if (j === i) {
        row.scrollIntoView({ block: "nearest" })
        target.setAttribute("aria-activedescendant", row.id)
      }
    })
  }

  function pick(i: number) {
    const r = rows[i]
    const q = query
    close()
    if (!r || !q) return
    const out = opts.onPick(r)
    if (typeof out !== "string") return
    if (trigger) target.setRangeText(out, q.start, q.end, "end")
    else target.value = out
    quiet = true
    target.dispatchEvent(new Event("input", { bubbles: true }))
    quiet = false
  }

  // Under the trigger (text box mode) or the field, above it when the room
  // below runs out, and never past the window's edges.
  function place() {
    const box = target.getBoundingClientRect()
    let left = box.left
    let below = box.bottom
    let above = box.top
    if (trigger && query) {
      const at = caretPoint(target, query.start)
      left = at.left
      below = at.bottom
      above = at.top
    }
    const w = list.offsetWidth
    const h = list.offsetHeight
    const top = below + h > window.innerHeight - 4 && above - h >= 4 ? above - h : below
    list.style.left = `${Math.max(4, Math.min(left, window.innerWidth - w - 4))}px`
    list.style.top = `${Math.max(4, top)}px`
  }

  function onKey(e: KeyboardEvent) {
    if (!isOpen() || e.isComposing) return
    const n = rows.length
    if (e.key === "Escape") {
      if (trigger && query) shut = query.start
      close()
    } else if (!n) {
      return
    } else if (e.key === "ArrowDown") setActive((active + 1) % n)
    else if (e.key === "ArrowUp") setActive((active - 1 + n) % n)
    else if ((e.key === "Enter" || e.key === "Tab") && !e.metaKey && !e.ctrlKey && !e.altKey)
      pick(active)
    else return
    e.preventDefault()
    e.stopImmediatePropagation()
  }

  const onScroll = () => {
    if (isOpen()) place()
  }
  const onBlur = () => close()
  // the caret moved without typing: in or out of a trigger's word
  const onKeyUp = (e: KeyboardEvent) => {
    if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) refresh()
  }
  // the listeners on the element as such: the field union types events loosely
  const node: HTMLElement = target
  node.addEventListener("input", refresh)
  node.addEventListener("keyup", onKeyUp)
  node.addEventListener("click", refresh)
  node.addEventListener("focus", refresh)
  node.addEventListener("keydown", onKey, true)
  node.addEventListener("blur", onBlur)
  node.addEventListener("scroll", onScroll)
  window.addEventListener("resize", onScroll)
  target.setAttribute("aria-controls", list.id)

  return {
    close,
    detach() {
      close()
      node.removeEventListener("input", refresh)
      node.removeEventListener("keyup", onKeyUp)
      node.removeEventListener("click", refresh)
      node.removeEventListener("focus", refresh)
      node.removeEventListener("keydown", onKey, true)
      node.removeEventListener("blur", onBlur)
      node.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      target.removeAttribute("aria-controls")
      list.remove()
    }
  }
}

// ─── sticky ───────────────────────────────────────────────────────

export interface StickyOpts {
  /** Stick to the top, this far from it (a number is px, a string any CSS
   *  length). The default when neither edge is given: the top, at 0. */
  top?: number | string
  /** Stick to the bottom, this far from it. With top too, it sticks at both. */
  bottom?: number | string
}

function stickyLength(v: number | string): string {
  return typeof v === "number" ? `${v}px` : v
}

// Keep an element in view while what's around it scrolls (`.ui-sticky`): at
// the top, at the bottom, or both, each at an offset. Returns the element.
export function sticky<T extends HTMLElement>(el: T, opts: StickyOpts = {}): T {
  const bottom = opts.bottom != null
  el.classList.add("ui-sticky")
  el.classList.toggle("bottom", bottom)
  el.classList.toggle("top", bottom && opts.top != null)
  if (opts.top != null) el.style.setProperty("--sticky-top", stickyLength(opts.top))
  if (bottom) el.style.setProperty("--sticky-bottom", stickyLength(opts.bottom!))
  return el
}

// ─── glue ─────────────────────────────────────────────────────────
// Plain elements for what sits between the parts: el("p", "", "text"),
// el("div", "my-class", child, child).
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  e.append(...children)
  return e
}

// The two layouts every screen needs: stack() a column with a gap (grid),
// bar() a row of controls (flex, wrapping). Layout is the parent's; these are
// the parent.
export function stack(...children: Array<Node | string>): HTMLDivElement {
  return el("div", "ui-stack", ...children)
}

export function bar(...children: Array<Node | string>): HTMLDivElement {
  return el("div", "ui-bar", ...children)
}

// Text-like content (`.ui-flow`): headings, paragraphs, code, lists, spaced
// as they read, by the flow and not by margins of their own.
export function flow(...children: Array<Node | string>): HTMLDivElement {
  return el("div", "ui-flow", ...children)
}

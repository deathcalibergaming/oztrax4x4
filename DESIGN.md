---
name: TrailTracker
description: A warm, analogue instrument cluster for driving remote Australia offline.
colors:
  near-black: "#14181B"
  panel: "#1B211D"
  panel-head: "#171C19"
  panel-raised: "#232B26"
  card: "#161B18"
  field: "#111513"
  warm-sand: "#D8CBAA"
  burnt-orange: "#CC5A2E"
  burnt-orange-lit: "#DC8767"
  burnt-orange-ink: "#12100E"
  signal-green: "#8FB93E"
  signal-green-ink: "#12160B"
  caution-yellow: "#E8B923"
  caution-yellow-ink: "#171204"
  alert-red: "#CF533D"
  alert-red-lit: "#E07C63"
  alert-red-ink: "#170B08"
  navigation-blue: "#4FA8E8"
  navigation-blue-lit: "#7FC1F0"
  instrument-white: "#FFFFFF"
  hairline: "rgba(216,203,170,.22)"
  hairline-strong: "rgba(216,203,170,.48)"
  muted-sand: "rgba(216,203,170,.72)"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "26px"
    letterSpacing: "0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    letterSpacing: "0.18em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "13px"
    lineHeight: 1.4
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "11.5px"
    fontWeight: 700
    letterSpacing: "0.12em"
  readout:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.05
  micro:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "8.5px"
    letterSpacing: "0.14em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "7px"
  xl: "10px"
  pill: "20px"
  full: "50%"
spacing:
  xs: "6px"
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "14px"
components:
  button-primary:
    backgroundColor: "{colors.burnt-orange}"
    textColor: "{colors.burnt-orange-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "11px 12px"
  button-go:
    backgroundColor: "{colors.signal-green}"
    textColor: "{colors.signal-green-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "11px 12px"
  button-warn:
    backgroundColor: "{colors.caution-yellow}"
    textColor: "{colors.caution-yellow-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "11px 12px"
  button-danger:
    backgroundColor: "{colors.alert-red}"
    textColor: "{colors.alert-red-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "11px 12px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.warm-sand}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "11px 12px"
  button-xs:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.warm-sand}"
    rounded: "{rounded.md}"
    padding: "6px 9px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.warm-sand}"
    rounded: "{rounded.lg}"
    padding: "10px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.warm-sand}"
    rounded: "{rounded.sm}"
    padding: "9px 10px"
    fontSize: "16px"
  chip-category:
    backgroundColor: "#0F1311"
    textColor: "{colors.muted-sand}"
    rounded: "9px"
    padding: "5px 10px 5px 5px"
    height: "36px"
  chip-category-on:
    backgroundColor: "rgba(255,255,255,.05)"
    rounded: "9px"
    padding: "5px 10px 5px 5px"
    height: "36px"
  chip-category-choice:
    backgroundColor: "{colors.field}"
    textColor: "{colors.muted-sand}"
    rounded: "5px"
    padding: "8px 6px"
  chip-category-choice-on:
    backgroundColor: "#1E2420"
    textColor: "{colors.warm-sand}"
    rounded: "5px"
    padding: "8px 6px"
  pin-waypoint:
    size: "26px"
  pin-poi:
    size: "22px"
  popup:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.warm-sand}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
---

# Design System: TrailTracker

## Overview

**Creative North Star: "The Instrument Cluster"**

TrailTracker is fitted to a vehicle, not added to a website. The two bars
that frame the map are gauges: labelled, unit-suffixed, monospaced, and read
at a glance by someone whose eyes belong on the track. The map between them
is the windscreen. Everything else — panels, popups, pins — is an object
resting on that view, never a page the map happens to be printed on.

The materials are warm and analogue rather than machined and cold. The ground
is a near-black with green in it, not a neutral grey; the text is a warm sand
rather than white; the accent is a burnt orange that belongs to oxide and
ochre. Panel faces carry a shallow bevel and a hairline along their edge, so
a surface reads as a face with an edge rather than a rectangle with a fill.
The result should feel like well-kept equipment — a logbook, a marked map, a
dash that has been in the sun — not like software with a dark theme switched
on.

Restraint is the operating principle. Controls are precise and quiet so the
map and the readings lead; colour is used to classify, not to decorate; and
the interface says plainly when it does not know something rather than
maintaining a confident surface. Confirmed anti-references: consumer nav apps
(rounded white cards, blue accents, floating pill search bars) and generic
dark-mode SaaS (purple gradients, glassmorphism, large radii, soft ambient
shadow everywhere).

**Key Characteristics:**

- Warm dark ground with sand text; never grey-on-grey
- Monospaced readouts for anything numeric and glanceable
- Tight radii (4–10px) and hairline borders, with exactly two components
  closing into a true pill (the status pill, the map chips) and nothing
  blobby beyond them
- Every overlay sits above the map with a real, dark shadow
- Colour classifies; size and weight carry hierarchy
- Uppercase, wide-tracked labels on every control

## Colors

A warm dark palette: a near-black ground with green in it, sand for text, and
a single oxide accent, plus a small set of status colours and a 24-entry
categorical scale for places.

### Primary

- **Burnt Orange** (`#CC5A2E`): the single accent. Primary buttons, the input
  focus ring, and the one persistent mode a driver actually chose — Heading
  Up is currently the only toggle that qualifies. It is the only colour that
  means "this is the action", not "this is some state right now" — a status
  the driver fell into rather than chose is Caution Yellow. See The One
  Accent Rule.
- **Burnt Orange Lit** (`#DC8767`): the same accent where it has to be read
  rather than filled — the second half of the wordmark, the map chip, an
  active action-bar label, the caret. Same hue, same saturation, raised until
  a word set in it clears 4.5:1. It is not a second accent; it is the accent
  at the height you can read it. See The Mark Versus Ink Rule.

### Secondary

- **Signal Green** (`#8FB93E`): affirmative and go. The recorded trail line,
  confirm buttons, free camps.
- **Caution Yellow** (`#E8B923`): attention without alarm, and the colour
  for a state the driver did not choose so much as fall into. Warnings,
  fuel, a paused recording, a simulated drive, a manually placed map centre
  — none of them is the one thing in a view Burnt Orange is reserved for,
  and all of them are the same kind of fact: what you are looking at right
  now is not the plain, live, chosen thing.
- **Alert Red** (`#CF533D`): destructive and urgent. Delete actions, hazards.
- **Alert Red Lit** (`#E07C63`): the same red as ink — a diagnostic that
  failed, the recording state line, an over-budget figure, an error toast.
- **Navigation Blue** (`#4FA8E8`) and **Navigation Blue Lit** (`#7FC1F0`):
  the destination and the route to it — the polyline, the destination pin,
  the navigation panel. Chrome rather than a category of place, which is why
  it has a name of its own instead of borrowing a fuel grade's hex. Ink is
  drawn on a pale map and stays dark; lit sits on a dark panel and stays
  light. Neither survives the other's ground.

### Neutral

- **Warm Sand** (`#D8CBAA`): all body text, icons and borders. The identity
  colour of the system — everything neutral is a transparency of it, which is
  what keeps the greys warm.
- **Muted Sand** (`rgba(216,203,170,.72)`): secondary text, units, inactive
  chips. It runs 5.4:1 to 6.5:1 against every surface in the app, and is
  still plainly quieter than sand at 10:1 — the tier is carried by the gap,
  not by being close to the ground.
- **Hairline** (`rgba(216,203,170,.22)`) and **Hairline Strong**
  (`rgba(216,203,170,.48)`): dividers and control borders. Structure is drawn
  with one-pixel lines, not with fills — so Hairline Strong has to clear
  3:1 on every surface it is drawn on, because with the surface ramp as flat
  as it is, that line is the only thing saying where a control stops.
- **Near Black** (`#14181B`): the app ground and the browser theme colour.
- **Panel** (`#1B211D`), **Panel Head** (`#171C19`), **Panel Raised**
  (`#232B26`), **Card** (`#161B18`), **Field** (`#111513`): the surface ramp.
  Depth is signalled by small steps of lightness across these, not by tint.
- **Instrument White** (`#FFFFFF`): reserved. See the rule below.

### The categorical scale

Twenty-four fixed colours identify place categories — fuel, mechanic, water,
camp, hospital, toilets and the rest — and each appears on that category's
pin, its dot in a list, and its filter chip, so a colour learned once is
recognised everywhere. The scale is defined in `POI_META` in
`docs/index.html`; it is a closed set, not a palette to draw from.

Every colour in it is chosen as a mark and clears 3:1 as one — against the
pale map behind a pin, and against the dark ground behind a chip's dot.
None is chosen as ink, and thirteen of the thirty across this scale and the
six waypoint categories cannot carry a word unaided. `inkOf()` lifts those
at render time so a popup title or an active chip label is legible while the
pin keeps its exact colour. Add a colour here for how it reads as a mark;
the ink takes care of itself.

### Named Rules

**The Full Sun Rule.** The two instrument bars use Instrument White
(`#FFFFFF`), not sand, and their labels and units use it too. Even Warm Sand
at full strength is a warm off-white, and a reading taken at 80 km/h through
sunglasses cannot afford the difference. Size and weight separate a label
from its number, so nothing is lost by taking colour out of that job. Any new
element read at speed inherits this rule.

The rule runs the whole ramp, not just the bars. Everything below them is
read at a stop rather than at speed, but it is read in the same light, so
every text colour in the system clears 4.5:1 against the surface it is set
on and every control border clears 3:1. Nothing is exempt for being small,
secondary, or a caption; small type is the type that needs it most.

**The Mark Versus Ink Rule.** A colour chosen to be a mark and a colour used
as ink are different jobs with different floors. A pin, a dot, a route line
or a status lamp is a mark, and clears 3:1. The moment the same hex is set
as a word — a popup title, a chip label, a button face — it is ink, and has
to clear 4.5:1 against its ground. Where a mark colour cannot, it is lifted
in lightness with its hue and saturation held, and only the text moves; the
mark keeps its exact colour. Burnt Orange Lit and Alert Red Lit are this
rule written down for the accents, and `inkOf()` in `docs/index.html` is the
same rule applied to the categorical scales at render time. Never solve it
by picking a different colour.

The rule runs in both directions, because a colour can be on either side of
the contrast. `Legible.ink()` raises a category colour until it can be read
*on* the panel. `Legible.ground()` raises it until near-black can be read
*on it* — which is what a cluster pin needs, since the count inside it is a
number and therefore text at 4.5:1, not a glyph at 3:1. Seven of the
twenty-four could not carry near-black at the text bar and are lifted; the
single pin keeps the category colour exactly, and only the pile moves.

A colour that has to carry text is also opaque. The cluster badge went to
full opacity for this: three percent of whatever terrain happened to be
behind it was enough to drag a lifted fill from 4.6 back to 4.4 over dark
ground, and a contrast that depends on the map is not a contrast.

**The One Accent Rule.** Burnt Orange means action and nothing else. A screen
should carry it on one control. If two things are orange, one of them is
wrong. Its lit twin is the same colour under this rule, not a second one — a
control cannot use both to look like two things. The test for which control
that is: did the driver deliberately choose this as the mode they are in, or
is it a status they are currently in the middle of? A choice earns the
accent; a status — paused, simulated, off the live position — takes Caution
Yellow instead. Two controls answering "yes" to the first question at once
is the violation this rule bans; a chosen mode and a fallen-into status
lighting different colours at the same time is not one, because nothing
about them claims to be the same fact.

**The Ink On Fill Rule.** A solid accent fill needs a word to sit on it
somewhere — Save, Go, Pause, Delete — and neither the fill colour nor its
lit twin can carry that word: the lit twin exists precisely so the accent
can be read as a small mark or a line of text on a dark ground, not so it
can read as ink on top of its own, brighter self. So the ink goes the other
way instead: near-black, tinted a few degrees toward the fill under it,
never plain black. Burnt Orange takes `#12100E`, Signal Green `#12160B`,
Caution Yellow `#171204`, Alert Red `#170B08` — four different blacks, each
one degree warmer or cooler than the last, so a button face and its label
never fight for which of them is actually the colour.

**The Closed Scale Rule.** Category colour comes from the 24-entry scale or
it does not exist. Never invent a colour to distinguish a new kind of place;
add it to the scale or reuse the category that already fits. A colour added
to the scale is chosen as a mark and only has to clear 3:1 there; The Mark
Versus Ink Rule makes it legible wherever it is set as a word, so it does
not need a hand-picked text variant and must not be given one.

## Typography

**UI Font:** system sans (`-apple-system, BlinkMacSystemFont, Segoe UI,
Roboto, Helvetica Neue, Arial, sans-serif`)
**Readout Font:** system mono (`ui-monospace, SFMono-Regular, Menlo,
Consolas, Liberation Mono, monospace`)

**Character:** No webfont is loaded, and that is deliberate — the app is one
file that must open with no network. The personality comes from treatment
rather than typeface: wide uppercase tracking on every label, and monospace
reserved strictly for values that change.

### Hierarchy

- **Display** (26px, letter-spacing .02em): a single large figure in a panel
  — a distance, a count, a total. Sand, not white.
- **Title** (700, 13px, letter-spacing .18em, uppercase): panel and drawer
  headings. The widest tracking in the system.
- **Body** (13px, line-height 1.4): popup and card prose.
- **Label** (700, 11.5px, letter-spacing .12em, uppercase): a button reached
  at a stop — drawer, dialog and panel buttons — and section summaries.
  Controls never use sentence case.
- **Readout** (mono, 600, 17px, line-height 1.05): the instrument values —
  speed, heading, altitude, distance, time — in Instrument White.
- **Micro** (8.5px, letter-spacing .14em, uppercase): a control read at
  speed rather than reached at a stop — the stat bar's own labels and the
  action bar's button labels, the same size for the same reason. The zoom
  column reads at speed too but currently carries no text at all, label or
  otherwise; see The Instrument Label Rule. Units drop to 8px. `KM/H`, never
  `km/h`.

### Named Rules

**The Monospace Rule.** Monospace is for values that change: readings,
prices, coordinates, counts, timestamps. Prose is never monospaced, and a
number that never moves is not a readout.

**The Shouting Labels Rule.** Every control label is uppercase with tracking
of at least .09em. Tracking widens as type shrinks, so an 8.5px gauge label
tracks further than a 13px heading.

**The Instrument Label Rule.** There are two button-label sizes, chosen by
scene rather than by any property of the button itself — the same split
`--tap` and `--tap-sm` already make for touch targets. Micro is for a
control read while the vehicle is moving: the stat bar, the action bar. Label
is for a control reached at a stop: the drawer, dialogs, panels. The same
button never needs to ask which one it is, because it never leaves its
scene.

## Layout

A fixed, full-screen app shell that never scrolls as a page. `body` is
`overflow:hidden`; only panel bodies scroll, with overscroll contained.

The vertical stack is a 50px top bar (`--topH`), a 56px instrument row
(`--statsH`), the map stage, and an action bar that matches the instrument
row's height (`--actH: var(--statsH)`). In landscape both bars stand on end
at a shared 80px width (`--railW`) so the columns cannot drift apart.
Safe-area insets are added to the top bar and every bottom-anchored element,
never ignored.

Panels overlay the map rather than displacing it: a left drawer, a POI panel,
and a bottom panel stack that splits width when two are open at once. Spacing
is tight throughout — gaps of 6–14px, card padding 10px — because the density
of the instrument face is the point.

Only two width-or-height breakpoints exist, and both are about landscape
height rather than phone width: `(orientation: landscape) and (max-height:
520px)`, with a tighter variant at `max-width: 720px` that gives buttons
their own row when name, readings and controls cannot share one line.

The third query is not about the screen at all. `(pointer: fine)` asks what
is doing the pressing, and it is the only place the layout changes for
anything other than the shape of the glass.

### Named Rules

**The One Screen Rule.** The application never scrolls. Anything that does
not fit belongs in a panel that scrolls inside itself.

**The Rail Follows Itself Rule.** The bars' heights and widths are single
custom properties, and everything that must clear them measures from those
properties. Never hard-code a bar's size into another element's offset.

**The Nothing Behind The Glass Rule.** A panel moved off screen with a
transform is still in the tab order and still in the accessibility tree. The
drawer and the POI panel go to `visibility:hidden` at the end of their slide
out and back to visible at the start of the slide in, so what a keyboard can
reach is what an eye can see. Overlays that hide with `display:none` already
do this; anything that hides by moving has to be told.

**The Frozen Layer Rule.** Pinch does nothing anywhere in this app, and has
to do nothing. Browser page zoom is off and Leaflet's `touchZoom` is off,
for one reason with two faces. The shell is `position: fixed` across the
viewport with two full-screen
`will-change: transform` layers under the map, so a pinch magnifies a frozen
layer rather than reflowing anything — and forces both promoted layers to
re-rasterise mid-gesture, which flashes and drops to the stage's near-black
on real hardware. Making type bigger here is the app's own job, and Settings
carries it: Text Size, at 1 or 1.15.

Leaflet's own pinch fails the same way. It scales the map pane with a CSS
transform for the length of the gesture, and that pane is inside those two
promoted wrappers — so a pinch re-rasterises two full-screen layers while a
finger is moving. Map zoom is the + and − buttons, 44px and one-handed,
which a driver can reach without putting two fingers on the glass.

Every `font-size` in the file derives from `--uiScale` — twenty tokens named
for the pixel value they start at, because the ramp has twenty steps and
inventing six roles to hold them would be renaming the design rather than
describing it. The two bar heights and the landscape rail scale with the
type, or a larger label would be clipped by a height that did not move.

Three things deliberately sit outside it. The tap sizes, because 44px is a
thumb and not a letter. The map, which has its own zoom. And the speed sign,
whose numerals are cut to sit inside a 47px ring on a 56px plate — a road
sign is a road sign at one size.

**The Two Hands Rule.** Every control is sized from `--tap` (44px) or
`--tap-sm` (36px), never from a number, and the choice between them is the
scene rather than the screen: `--tap` for what is pressed while the vehicle
is moving — the map controls, the action rail, the navigation panel, a
popup's buttons — and `--tap-sm` for what is pressed at a stop, which is the
drawer, the settings and the cards. A control that will not read right at
44px keeps its shape and grows an invisible target instead; the switch is
48×28 with a 64×44 hit area.

Coarse is the base, because the vehicle is the base. `(pointer: fine)` hands
the density back for the desk, where the trip gets planned and where a
pointer lands exactly where it is put. Never key this off viewport width: a
phone held in landscape is still a thumb, and a touchscreen laptop is still
a mouse.

**The Elbow Room Rule.** Where a destructive control shares a row with the
ones you meant to press, it takes its own end of that row and the gap that
comes with it. Size is not separation — Delete at 36px next to Go To at 36px
is the same mis-tap with a bigger surface. On a fine pointer it goes back in
line; the distance is for the thumb, not for the caution.

## Elevation & Depth

Layered, and the layering is literal: the map is the ground plane and every
panel, popup, chip and pin is a physical object resting on it. Shadow says
"this is on top of the world". Nothing that lives on the map is flat.

Depth within a panel is different — there it is done with the surface ramp
and a bevel, not shadow. Instrument faces carry a shallow linear gradient
with a 3px lip at one edge and a matching `border-image` hairline, so a face
reads as a face with a machined edge. Dividers stop where the face stops
rather than running across the bevel.

### Shadow Vocabulary

- **Pin** (`0 2px 5px rgba(0,0,0,.55)`): map markers.
- **Floating control** (`0 2px 10px rgba(0,0,0,.55)`): the speed sign and map
  chips.
- **Popup** (`0 8px 24px rgba(0,0,0,.6)`): map popups.
- **Panel** (`0 8px 22px rgba(0,0,0,.6)` to `0 12px 34px rgba(0,0,0,.62)`):
  the bottom panel stack.
- **Drawer** (`8px 0 28px rgba(0,0,0,.5)`): the side drawer, cast sideways.
- **Modal** (`0 16px 42px rgba(0,0,0,.7)`): the deepest, for dialogs.

### Named Rules

**The Above The Map Rule.** Anything drawn over the map casts a shadow from
this vocabulary. Anything inside a panel does not — it uses the surface ramp
and the bevel instead.

## Shapes

Small, hard-edged geometry. Radii run 3–10px with 6px for controls, 7px for
cards and 4px for fields. Borders are one-pixel sand transparencies, so form
is drawn with a line rather than a fill.

Two components stand outside that range on purpose: the header's GPS/battery
status pill and the map's floating chips (`rounded.pill`, 20px) are both
short enough top to bottom that the radius runs the full height and closes
into a true capsule, not a rectangle with a large corner. A stadium is a
different shape family from a rounded rectangle — every other surface in the
system stays legibly rectangular at its radius, which is what The Tight
Corner Rule actually governs.

Two pin silhouettes carry most of the identity and are deliberately different
from each other:

- **Waypoint pin** — a 26px square with `border-radius: 50% 50% 2px 50%`
  rotated 45°, giving a teardrop with one sharp point at the bottom. The
  point marks the spot.
- **POI pin** — a 22px circle with a 1.5px **dashed** border at 92% opacity.

### Named Rules

**The Mine Versus Mapped Rule.** A solid, pointed pin is something the driver
put there. A dashed circle is something the map knows about. The silhouette
carries that distinction before any colour or icon does; never blur it.

**The Tight Corner Rule.** No radius exceeds 10px on a surface that stays a
rectangle at that radius. Large radii read as a consumer app and are out of
character with the instrument face. The status pill and the map chips are
not an exception to this — a capsule whose radius has closed into a stadium
is a different shape, not a rectangle wearing a bigger number, and this rule
has no opinion on it. It has an opinion on the next control that is tempted
to round a card or a panel past 10px and call itself a pill to get there.

## Components

### Buttons

Precise and restrained: flat colour, a hairline border, uppercase tracked
labels, and a brighten-on-press instead of a hover state, because there is no
cursor in a moving vehicle.

- **Shape:** gently squared (6px radius)
- **Primary:** Burnt Orange fill, near-black text (`#12100E`), padding
  11px 12px
- **Go / Warn / Danger:** the same shape in Signal Green, Caution Yellow or
  Alert Red, each with a matched near-black text colour
- **Ghost:** transparent fill, hairline-strong border, sand text
- **Selected:** the chosen half of a segmented pair — Metric against
  Imperial, Normal against Large, On against Off — is filled exactly as
  Primary is, and its unchosen twin stays Ghost. A tint was tried here and
  read as a difference you had to look for rather than one you could see.
  Note that these buttons are Ghost in the markup, so a selected rule has
  to outrank `.ghost`'s transparent fill or the ink lands on nothing; the
  shipped rule does it with an id, and adding `.primary` to the markup
  instead is the way this was broken once already
- **Press:** `filter: brightness(1.25)` — the lamp behind the switch
- **Sizes:** `sm` (8px 10px, 10px type) and `xs` (6px 9px, 9px type). Both
  carry a 36px floor on touch and shed it for a mouse; `xs`
  does not stretch
- **Disabled:** 40% opacity and pointer-events off

### Chips

Two chips share a shape family and mean different things, because filtering
what is already on the map and choosing one category for a new waypoint are
different tasks.

**The filter chip** (`chip-category` / `chip-category-on`) turns POI
categories on and off on the map — several can be on at once. A dot in the
category's colour, a label that takes the slack, and a count pushed to a
shared right edge.

- **Style:** `#0F1311` fill, hairline-strong border, 9px radius, minimum
  height 36px (`--tap-sm`)
- **State:** off is muted-sand text at 80% opacity. On lifts to full opacity
  and a wash of `rgba(255,255,255,.05)`, and its border and text take that
  category's own colour, lifted for contrast the same way a pin's ink is —
  see The Mark Versus Ink Rule. The dot itself never changes; it is always
  the category's colour, on or off.

**The choice chip** (`chip-category-choice` / `chip-category-choice-on`)
picks the one category a new waypoint belongs to — exactly one is on. Field
(`#111513`) fill, hairline border, 5px radius. Selected trades the border and
text for Warm Sand and lifts the fill one step, to `#1E2420` — a neutral
"this one" rather than the category's own colour, because a waypoint's icon
already carries that colour and the chip does not need to repeat it.

### Cards

- **Corner Style:** 7px
- **Background:** Card (`#161B18`)
- **Border:** hairline
- **Shadow:** none — cards live inside panels (see Elevation)
- **Padding:** 10px, with an 8px gap between the mark and the text column
- **Overflow:** titles and subtitles clip with an ellipsis on one line so a
  long name cannot widen the list

### Inputs

- **Style:** Field (`#111513`) fill, hairline-strong border, 4px radius,
  16px type — the better size to type into on a phone, and it keeps the
  field independent of what the viewport meta happens to allow
- **Focus:** border becomes Burnt Orange; no glow, no ring. Every field type
  has one, selects included — the native outline is removed here, so a
  control that does not replace it has no focus state at all
- **Select:** the native arrow is replaced with two muted-sand gradients
- **Caret:** Burnt Orange Lit, so the insertion point belongs to the palette
  rather than to the browser

### Instrument Gauge

The signature component. A column carrying an uppercase micro label, a
monospaced value in Instrument White, and a unit beneath it, separated from
its neighbour by a hairline that stops short of the panel's bevel. Columns
are sized to their content rather than split equally, because a three-letter
cardinal and a five-character clock do not need the same room.

### Speed Sign

A literal Australian speed-limit sign: a 56px white rounded square holding a
47px circle with a 5.5px `#C8102E` ring and near-black numerals. It is not
themed and does not follow the palette — it is a road sign, and it is
recognisable because it looks exactly like one. Three digits drop the type
size to keep the ring clear.

### Popups

Panel fill, hairline-strong border, 6px radius, popup shadow. An uppercase
title in the category's colour lifted to ink, an optional second line for a
place that has one, then a monospaced meta line of category, source and
distance.

### Dialogs

Panel fill in a 10px box on a near-black scrim, capped at 360px wide and at
the viewport height less 32px, with the modal shadow. A head carrying the
title, a scrolling body, a foot of buttons.

- **Semantics:** `role="dialog"`, `aria-modal="true"`, and
  `aria-labelledby` pointing at the title — a dialog that claims the screen
  has to say so and has to have a name
- **Keyboard:** Tab is held inside the box and wraps at both ends; Escape
  closes; focus goes to the first field on open and back where it came from
  on close
- **Closed:** `display:none`, so nothing inside is reachable or announced

### Switches

A 48×28 track with a 22px knob, and a 64×44 hit area it does not draw. Built
as a `<button role="switch">` carrying `aria-checked` — the state is the
control's, not a class's, so a screen reader and the stylesheet read the same
truth.

### Text Size

A two-step segmented control in Settings — Normal and Large — built like the
Units and Screen Lock rows beside it, and the app's answer to page zoom
rather than an extra on top of it. At Large the 8.5px gauge labels read at
9.8px and the instrument values at 19.6px, and the panels reflow around them
instead of being magnified.

There was a third step at 1.3, and it is gone. The bars scale with the type,
so it took about 32px off the map on a phone — tested in the vehicle and
judged not worth the trade. Large takes 16, which is. A saved 1.3 migrates
up to Large rather than down to Normal: whoever chose it wanted bigger.

Any new rule inherits this for free by using a size token; there is nothing
to remember. A literal `font-size` in px is now the exception and should
carry a comment saying why it does not scale.

### Motion

There is no focal moment and there should not be one. An instrument cluster
does not perform. Motion here does exactly three jobs: a panel slides so you
know where it came from, a control changes colour so you know it took the
press, and the recording dot pulses so you know the track is still running.

- **Panels and drawers:** 0.24s on `cubic-bezier(.3,.7,.3,1)`
- **Controls:** 0.12s on background and border; the press itself is
  `filter: brightness(1.25)` with no transition, because feedback that
  arrives late reads as latency
- **Reduced motion:** spatial movement goes, feedback stays. Panels appear
  rather than travel, the sign stops sliding, the switch knob stops moving
  but still changes colour. This is not a blanket `0.01ms` kill — a driver
  tapping controls that give nothing back is a worse interface, not a
  gentler one.

**The Ring Instead Of A Pulse Rule.** Where an animation is the only thing
distinguishing two states, reduced motion has to replace it, not remove it.
The recording dot pulses when live and sits still when paused; stop the
pulse and the two differ by colour alone, which this system forbids
everywhere else. Under reduced motion the live dot wears a ring instead.
Same information, no movement.

## Do's and Don'ts

### Do:

- **Do** use Instrument White (`#FFFFFF`) for anything read at speed —
  values, their labels and their units — and keep every other text colour
  above 4.5:1 and every control border above 3:1, because the rest of the
  interface is read in the same light.
- **Do** give every map overlay a shadow from the vocabulary, and give panel
  internals none.
- **Do** keep radii between 3px and 10px, and draw structure with one-pixel
  sand transparencies rather than filled dividers.
- **Do** set control labels in uppercase with at least .09em tracking, and
  widen the tracking as the type shrinks.
- **Do** size a control from `--tap` or `--tap-sm` rather than a number, and
  pick between them by asking whether it gets pressed while the vehicle is
  moving.
- **Do** give a destructive control its own end of a row. Size does not fix
  adjacency; a bigger Delete beside a bigger Go To is the same mistake at a
  larger scale.
- **Do** reserve monospace for values that change, and say the unit in
  uppercase beside it (`KM/H`).
- **Do** size type from a scale token, never a literal px. A literal is the
  exception and has to say why it is one.
- **Do** lift a mark colour rather than substitute one when it has to carry
  a word, and leave the mark itself alone.
- **Do** theme the surfaces the browser would otherwise paint for itself —
  the selection, the caret, the scrollbar, the focus ring. A system-blue
  selection belongs to no palette here.
- **Do** give a message that appears and disappears a live region, so what
  the interface says out loud matches what it shows. The toast is
  `role="status"`, or `role="alert"` when it is carrying an error.
- **Do** state absence plainly in the interface — an unmapped road, a stale
  price, a straight-line fallback. A confident surface over missing data is a
  defect here, not a polish win.

### Don't:

- **Don't** reach for rounded white cards, blue accents, floating pill search
  bars or friendly illustration. That is the phone's built-in map, and it is
  a confirmed anti-reference.
- **Don't** introduce purple gradients, glassmorphism, large radii or soft
  ambient shadow. That is dark-mode SaaS, and it is the other confirmed
  anti-reference.
- **Don't** dim text with element `opacity` stacked on an already
  transparent colour. The two multiply, and the result is not visible in
  either value.
- **Don't** put a row of controls in a flex line without `flex-wrap` and
  `min-width: 0`. A flex item will not shrink below its longest word, so a
  row that fits at one text size hangs off the edge at a larger one.
- **Don't** use colour as the only difference between a label and its value;
  size and weight already do that job, and colour is needed for classifying.
- **Don't** add a category colour outside the 24-entry scale.
- **Don't** put Burnt Orange on more than one control in a view.
- **Don't** make the application scroll; put overflow inside a panel.
- **Don't** load a webfont, a script, a stylesheet or anything else from the
  network into the shell. The map library is embedded in the file for this
  reason; the file has to open, render and be legible with no connection and
  no server, from a copy on a stick.
- **Don't** give a POI pin a solid outline or a waypoint pin a dashed one —
  the silhouettes mean different things.

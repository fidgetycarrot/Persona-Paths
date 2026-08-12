# Persona Paths

## v0.1.19 — Lumiverse message-layout compatibility fix

- Persona Paths now mounts cards inside Lumiverse's vertical message-content stack instead of the horizontal BubbleMessage root. This prevents Path cards from becoming flex siblings that squeeze or shove the actual chat content sideways.
- Added strict width/min-width/box-sizing guards to the injection wrapper, cards, and choice buttons to prevent intrinsic-width overflow from affecting Lumiverse's virtualized message layout.
- Includes the v0.1.18 sparse inner-thought convention and all earlier features.

## v0.1.18 — Sparse inner-thought convention

Persona Paths now explicitly teaches the CYOA model how to handle direct inner thoughts: they are optional, rare, and only useful when they add meaningful subtext or conflict that action/dialogue cannot express as well. A normal set should contain zero or one direct-thought choice unless the scene is unusually introspective. Direct thoughts use single-asterisk Markdown italics (`*This is a terrible idea.*`) and are never placed in quotation marks.

Path cards visually render those Markdown thought spans as italics while preserving the literal `*...*` in the underlying choice text, so clicking a choice still inserts ordinary Markdown into the Lumiverse composer. Prism dialogue coloring remains separate and continues to apply only to quoted speech.

This build also includes the v0.1.17 Prism-compatible dialogue quote normalization and the v0.1.16 **Scene Advancer** behavior.
Version 0.1.19

Persona Paths is a Lumiverse/Spindle extension that creates private, persona-aware next-move choices after character/assistant role-play replies.

## Important repository layout

This repository intentionally keeps its compiled entry files at the repository root:

- `backend.js`
- `frontend.js`

`spindle.json` points directly to those files. This makes GitHub web uploads resilient even when folders are flattened.

The editable TypeScript sources are also kept at root (`backend.ts`, `frontend.ts`). `bun run build` recompiles them in place.


### Recent UI fixes
- Connection selection uses Lumiverse's native searchable select with portal rendering, so the menu escapes the drawer instead of being clipped into a tiny popup.
- The floating Paths launcher uses Lumiverse's native draggable float widget. It starts on the left so it stays out of the right-side drawer, can be dragged anywhere, snaps to an edge, and Lumiverse provides hide/reset-position controls.

## Features

- Hard context isolation: generated choices and private relationship notes are never appended to the RP chat or inserted into normal prompt assembly.
- Persona fidelity using the active persona plus recent examples of how the player actually portrays them.
- Relationship-conditioned behavior instead of averaging contradictory traits into generic behavior.
- Action-first, detailed choices rather than four alternate quips.
- Choices control only the player's persona; NPC reactions, discoveries, consequences, and world state remain with the story model.
- Configurable Auto/First/Second/Third person and Auto/Present/Past tense.
- Configurable Compact/Normal/Detailed choice length and 3–6 choices.
- Separate Lumiverse LLM connection and optional model override.
- Private relationship memory.
- Swipe-aware choice regeneration.
- Click-to-fill composer without auto-send.

## Opening Persona Paths

When the frontend loads successfully, Persona Paths exposes:

- a `Paths` drawer tab,
- `Open Persona Paths` in the chat input Extras menu,
- a floating `Paths` launcher.

The panel displays its installed extension version.

## Permissions

Persona Paths requests only:

- `generation`
- `personas`
- `chats` — resolves the active chat for manual generation
- `chat_mutation`
- `ui_panels` — only for Lumiverse's native draggable floating launcher

It does not request interceptor or context-handler permissions.

## Build

```bash
bun install
bun run build
```


## v0.1.5 — Operator-scope user context fix
- Passes the frontend/event `userId` to `spindle.connections.list(userId)` and `spindle.personas.getActive(userId)`.
- Includes `userId` in direct `spindle.generate.raw(...)` requests, which Lumiverse requires for operator-scoped generation.
- Stops calling user-scoped APIs from permission-change callbacks, because those callbacks do not carry a user ID.
- Isolates persona lookup errors from connection lookup errors so the panel still renders useful diagnostics.
- Keeps the Refresh connections button from v0.1.4.


## v0.1.9 trigger fix

CYOA generation is now triggered by the browser-side `GENERATION_ENDED` event and forwarded to the backend. This preserves the active user's scope for operator-installed extensions. Swipe changes follow the same path.


## v0.1.9 — Provider-safe repair pass

- Fixes Moonshot/Kimi HTTP 400 errors when a first generation returns empty or unusable content.
- Repair attempts no longer insert the failed output as an `assistant` message.
- Repair is now a fresh system+user request, with previous output included only as quoted context.
- Adds clearer diagnostics if a provider returns empty content twice or produces invalid JSON after repair.


## v0.1.9

- Kimi-aware output budgeting: always-thinking Kimi models automatically receive at least 16k output tokens.
- Kimi K3 uses low reasoning effort when Persona Paths reasoning is disabled (K3 cannot fully disable thinking).
- Kimi K2.6/K2.5 still use their real thinking-off switch when reasoning is disabled.
- Kimi fixed-temperature models no longer receive Persona Paths' generic temperature override.
- Length-truncated repair attempts automatically receive additional output headroom.

## v0.1.10 — manual generation

Persona Paths now has a first-class **Generate Paths for latest reply** action in the drawer and in Lumiverse's chat-input Extras menu. Manual runs resolve the user's currently active chat, find its latest non-empty assistant reply, and force a fresh Persona Paths generation even if automatic generation is disabled or the browser/app was refreshed and the old Retry card disappeared.

Manual generation requires Lumiverse's `chats` permission in addition to the existing `chat_mutation` permission: `chats` is used only to resolve the currently active chat; `chat_mutation` reads its messages. Choices remain extension-private and are never injected into the story prompt.


## v0.1.11 — OOC guard

- Adds **Skip OOC exchanges** (enabled by default).
- Recognizes common leading markers including `[OOC]`, `[OOC]:`, `[ooc}:`, `(OOC):`, and `OOC:`.
- If a user message is OOC, its paired assistant reply is also treated as OOC even when the assistant does not repeat the marker.
- Persona Paths does not generate choices for OOC assistant replies.
- OOC user/assistant turns are excluded from Persona Paths scene context and user-portrayal examples, so meta discussion cannot distort characterization.
- OOC turns never update Persona Paths relationship memory because no CYOA generation runs for them.
- Manual generation respects the same guard and reports that the latest reply was skipped.

## v0.1.13 — Prism-aware choices

- Adds **Prism integration: Auto / Off**. Auto is the default.
- Persona Paths strips portable `<font color>`, escaped font-color tags, and BBCode color tags from RP scene context and portrayal examples before sending them to the CYOA model. Formatting is treated as presentation metadata, not characterization.
- The CYOA prompt explicitly forbids emitting Prism/HTML/BBCode color markup, and generated choice text is sanitized again before it is cached or placed into the composer.
- In Auto mode, Persona Paths resolves Prism's `{{prismHexes}}` macro non-destructively and prefers an exact active-persona registry match when Prism exposes one.
- If Prism does not expose the persona in its registry, Persona Paths falls back to Prism's canonical `lumi_dialogue_color` metadata from the latest colored USER turn. It deliberately does **not** guess a persona color by copying arbitrary `<font>` tags.
- Only quoted dialogue in the Persona Paths choice cards is painted with the detected persona color. The underlying choice remains plain text, so clicking a choice inserts no HTML/color markup into Lumiverse's composer; Prism remains responsible for coloring the sent message.
- Existing cached choices from older Persona Paths versions are sanitized on startup so stale model-copied color tags do not reappear after an update or refresh.


## v0.1.14 — manual Prism persona color

- Adds **Prism integration: Auto / Manual / Off**.
- Manual mode stores a `#RRGGBB` color per active persona and makes that value authoritative for Persona Paths card rendering.
- Manual color overrides historical Prism metadata/markup, so stale colors cannot outvote the user's explicit selection.
- Existing cached choices repaint with the current resolved/manual Prism color instead of letting an old cached color win.
- Choice text and composer insertion remain plain text; Prism still owns formatting of the actual sent message.


## v0.1.16 — guided regeneration

- Adds **Regenerate with guidance** (✎) to every Persona Paths card.
- Guidance is one-shot by default and applies only to that regeneration.
- The rejected paths are included as reference so the model is told to produce genuinely new trajectories rather than paraphrasing them.
- Optional **Save this as active persona guidance** appends the correction to that persona's private Persona Paths guidance.
- Saved guidance is per persona and immediately updates the existing Active persona guidance field.
- Useful for persistent corrections such as `Never call Sovi “Price”; use Sovi's established name.` while leaving situational steering unsaved.

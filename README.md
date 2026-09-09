# Persona Paths

## v0.1.34 — visible, editable model IDs

- OpenRouter picker rows and selected values show the exact API model ID as the main label, with the friendly name and capabilities underneath.
- Paths and User Writer each keep an editable model ID field visible, including after catalog selection and refresh. Blank follows the connection model.
- Settings refreshes preserve model ID edits while the field has focus; quick changes to different settings are saved together.
- Includes all v0.1.33 persona-selection improvements.

## v0.1.33 — per-chat persona selection

- Select **Persona for this chat**, defaulting to **Use Lumiverse active persona**. Available personas load from Lumiverse, including when no persona is active.
- **Writing as** shows the resolved persona. Its private guidance is editable before any Paths card exists, and both Paths and User Writer use its full persona card and guidance.
- Selection persists per user/chat; guidance remains per persona. Switching clears obsolete Paths and writer draft history. Missing selected personas show an error instead of silently writing as someone else.
- Existing OpenRouter search, separate writer model, mobile steering, manual OOC override, Cortex/current-moment context, and latest-widget-only rendering remain in place. No new permissions.
- Install by replacing the repository files with this package, then updating the extension in Lumiverse. Existing configuration is migrated automatically.
- Validation: `npm ci`, `npm run typecheck`, `bun run build`, `npm test`, and `node --check backend.js` / `node --check frontend.js`.

## v0.1.32 — searchable OpenRouter model pickers

- Replaces the copy/paste-only model override workflow with **searchable model pickers** for OpenRouter connections in both Persona Paths and User Writer.
- The picker loads OpenRouter’s public live model catalog through Lumiverse’s server-side CORS proxy, filters it to text-output models, and lets you search by friendly model name or exact OpenRouter ID.
- Each model entry shows the exact ID plus useful catalog metadata such as context length and reasoning support when OpenRouter reports it.
- **Use connection model** remains the default, so existing connection profiles continue working without an override. Existing saved overrides are preserved automatically.
- **Manual model ID…** remains available for aliases, custom IDs, brand-new models, or catalog failures. Non-OpenRouter connections keep this manual fallback.
- The selected override is moved near the top of the model results for faster switching, and the OpenRouter catalog is cached for one hour with a manual refresh button.
- Adds the `cors_proxy` permission solely to retrieve OpenRouter’s public model catalog; Persona Paths still never receives or exposes the API key stored in your Lumiverse connection.
- Keeps the independent User Writer connection/model introduced in v0.1.31 and all latest-widget-only performance safeguards.

## v0.1.31 — independent User Writer model + always-available writer

- **User Writer no longer depends on a Persona Paths card.** The host-managed floating launcher now has a persistent `✦` button next to `Paths`; it works even when automatic Paths are disabled, skipped, blocked by the provider, or fail. The existing card button and Lumiverse Extras action remain available too.
- Path loading/error cards keep the `✦` User Writer control visible instead of hiding it with the failed CYOA UI.
- Adds a dedicated **User Writer connection** selector. Default is **Same as Persona Paths**, but Write For Me / Rewrite can use an entirely different Lumiverse connection/provider.
- Adds independent **Writer model override, temperature, max output tokens, and reasoning/thinking** settings. Paths keep their existing model/tuning untouched.
- Write For Me and Rewrite still use Current Moment, persona guidance, recent portrayal, private relationship notes, and read-only Memory Cortex continuity; they never auto-send.
- Manual User Writer remains usable on OOC exchanges: the targeted OOC assistant reply can be the immediate Current Moment without being used as portrayal evidence or as the Memory Cortex query text.
- Keeps the v0.1.26 latest-widget-only virtualization/performance architecture.

## v0.1.30 — User Writer + numbered steering

- The ✦ action is now **User Writer**: with text in the composer it conservatively rewrites/polishes your draft; with an empty composer it writes a fresh in-character user turn from the current scene.
- User Writer opens a host-managed Lumiverse modal with an optional one-shot direction field, clear working/error/success feedback, and duplicate-call protection.
- Keeps a small in-session draft history (original + generated drafts) with Older/Newer navigation and a **Use selected draft** restore button.
- Preserves selected Persona Path intents when rewriting combined/edited Paths where available.
- Uses Persona Paths' Current Moment anchor, recent scene, persona guidance, recent portrayal, private relationship notes, and Memory Cortex rather than scraping rendered chat DOM.
- Guided regeneration now labels previous choices explicitly as **#1, #2, #3…**, so directions like “expand on #3,” “#2 but less hostile,” or “combine #1 and #5” are unambiguous.
- Keeps Persona Paths isolated from the story model; User Writer output is only placed in the composer and never auto-sent.

## v0.1.29 — manual OOC override

- **Generate Paths for latest reply** now explicitly overrides the OOC guard when you invoke it manually.
- Automatic generation still skips `[OOC]`, `[OOC]:`, `[ooc}:`, `(OOC):`, and `OOC:` exchanges.
- A forced OOC generation can use that specific exchange as the immediate target, but OOC content stays out of portrayal examples, Memory Cortex / long-term-memory query context, and private relationship-memory learning.
- Regenerate and guided regenerate continue to work on a manually forced OOC Paths card.
- Manually forced OOC cards survive refresh/restoration instead of being deleted by the automatic OOC guard.

## v0.1.28 — mobile-safe steering modal

- On touch-first/mobile devices, **Regenerate with guidance** opens in Lumiverse's host-managed modal instead of expanding a textarea inside the virtualized message widget.
- Keeps the existing inline steering panel on desktop/hover-capable devices.
- Uses a 16px mobile textarea to avoid iOS Safari focus zoom, and delays widget rerender very briefly after submission so the keyboard can dismiss cleanly.
- Preserves **Save this as active persona guidance** in the mobile modal.

## v0.1.27 — scan-first Path cards

Adds compact current-state metadata and progressive disclosure without changing the v0.1.26 virtualization strategy. Each fresh generation returns the persona's final **location** and **current beat** as a sanity-check header, plus a 1–3 **intensity** rating for every Path. Detailed Path text is blurred by default so intent labels can be scanned quickly; desktop hover reveals the text and touch devices use tap-to-reveal / tap-again-to-add. Intensity dots expose a tooltip (`Intensity 1/3 — Low impact`, `2/3 — Decisive`, `3/3 — Volatile`). The card remains a single Lumiverse-managed widget attached only to the latest actionable assistant reply.

## v0.1.26 — Lumiverse virtualization/performance pass

Optimizes Persona Paths for Lumiverse's current virtualized message list. Older builds restored up to 40 historical Path cards and reacted to every `CHARACTER_MESSAGE_RENDERED` remount by re-rendering a sandbox widget or requesting cached choices from the backend. On long chats, ordinary scrolling could therefore create repeated widget teardown/recreation, iframe resize work, backend RPCs, and virtual-row remeasurement.

v0.1.26 keeps **at most one Path widget active: the latest actionable assistant reply**. Historical choices remain saved privately but are no longer mounted while scrolling. Message remounts do no backend work, identical widget payloads are render-deduplicated, chat restore loads only the latest cached Path, and starting a new story generation retires the previous widget immediately. All v0.1.25 features — Current Moment anchoring, Memory Cortex, Draft Polish, Prism, guided regeneration, combining Paths, etc. — remain intact.

Version 0.1.32

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
- Long-term continuity via Lumiverse Memory Cortex (memories, entities, relationships, narrative arc), with chat-memory fallback and the current scene always authoritative.
- Relationship-conditioned behavior instead of averaging contradictory traits into generic behavior.
- Action-first, detailed choices rather than four alternate quips.
- Choices control only the player's persona; NPC reactions, discoveries, consequences, and world state remain with the story model.
- Configurable Auto/First/Second/Third person and Auto/Present/Past tense.
- Configurable Compact/Normal/Detailed choice length and 3–6 choices.
- Separate Persona Paths and User Writer Lumiverse LLM connections, with searchable OpenRouter model pickers plus manual override fallback; User Writer also has independent temperature/token/reasoning tuning.
- Private relationship memory.
- Swipe-aware choice regeneration.
- Click-to-append composer without auto-send, allowing multiple Paths to be combined in one user turn.

## Opening Persona Paths

When the frontend loads successfully, Persona Paths exposes:

- a `Paths` drawer tab,
- `Open Persona Paths` in the chat input Extras menu,
- a floating `Paths` launcher with a persistent `✦` User Writer button.

The panel displays its installed extension version.

## Permissions

Persona Paths requests only:

- `generation`
- `cors_proxy` — loads OpenRouter’s public model catalog for the searchable model pickers; no stored API key is exposed
- `personas`
- `chats` — resolves the active chat for manual generation and provides read-only chat-memory fallback
- `memories` — read-only Memory Cortex retrieval (the permission itself is broader; Persona Paths does not mutate memory state)
- `chat_mutation`
- `ui_panels` — only for Lumiverse's native draggable floating launcher

It does not request interceptor or context-handler permissions. The new CORS proxy access is used only for the public OpenRouter model-list request.

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


# Persona Paths

Version 0.1.8

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


## v0.1.7 trigger fix

CYOA generation is now triggered by the browser-side `GENERATION_ENDED` event and forwarded to the backend. This preserves the active user's scope for operator-installed extensions. Swipe changes follow the same path.


## v0.1.8 — Provider-safe repair pass

- Fixes Moonshot/Kimi HTTP 400 errors when a first generation returns empty or unusable content.
- Repair attempts no longer insert the failed output as an `assistant` message.
- Repair is now a fresh system+user request, with previous output included only as quoted context.
- Adds clearer diagnostics if a provider returns empty content twice or produces invalid JSON after repair.

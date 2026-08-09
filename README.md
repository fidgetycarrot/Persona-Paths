# Persona Paths

Persona Paths is a Lumiverse/Spindle extension that creates private, persona-aware next-move choices after character/assistant role-play replies.

## What makes it different

- **Hard context isolation:** Persona Paths reads the role-play, but its generated choices and private relationship notes are never appended to the chat and never inserted into normal prompt assembly.
- **Persona fidelity:** It uses the active persona card plus recent examples of how you actually play the persona.
- **Relationship-conditioned behavior:** It explicitly avoids averaging contradictory traits. A brash character can be gentle with one person and abrasive with everyone else.
- **Action-first choices:** Options must contain meaningful action or decisions, not four alternate quips.
- **Player authorship:** Choices control only the player's persona. The CYOA model is told not to invent NPC reactions, world outcomes, discoveries, or consequences.
- **Useful-sized turns:** Compact, Normal, and Detailed modes produce paste-ready user turns instead of tiny seeds that force the story model to invent the whole branch.
- **Configurable style:** Auto/First/Second/Third person and Auto/Present/Past tense.
- **Separate model:** Pick any Lumiverse LLM connection profile, plus an optional exact model override.
- **Private relationship memory:** Optional short behavior/relationship notes are stored only in the extension's scoped storage.
- **Swipe-aware:** If the assistant reply changes via swipe, Persona Paths regenerates choices for the new content.
- **Click to edit:** Clicking a choice fills the normal Lumiverse composer but never auto-sends it.

## Permissions

Persona Paths deliberately requests only:

- `generation` — to make the private CYOA model call and list connection profiles
- `personas` — to read the active persona
- `chat_mutation` — to read the role-play transcript

It does **not** request interceptor/context-handler permissions and does not write CYOA material into chat messages.

## Install from a GitHub repo

Lumiverse installs Spindle extensions from GitHub. Put this folder in a GitHub repository, replace the placeholder `github` and `homepage` URLs in `spindle.json`, commit the included `dist/` files, then install the repository URL in Lumiverse's Extensions panel.

The `dist/` files are prebuilt. For development, Lumiverse can also auto-build from `src/`, or you can run:

```bash
bun install
bun run build
```

## Suggested defaults

- Choices: 4
- Detail: Normal
- POV: Auto
- Tense: Auto
- Scene messages: 12
- User portrayal examples: 6
- Temperature: 0.85
- Private relationship memory: On
- Reasoning: Off

## Design boundary

Data flow is intentionally one-way:

```text
Role-play transcript + active persona
              |
              v
      Persona Paths model
              |
      private extension state
              |
              v
        choice UI cards
              |
     click -> Lumiverse composer
              |
       human edits/sends
              v
       normal RP pipeline
```

There is no automatic CYOA-to-story-context path.

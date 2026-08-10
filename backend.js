const CONFIG_PATH = 'config.json';
const CACHE_PATH = 'choices.json';
const MEMORY_PATH = 'relationship_memory.json';
const DEFAULT_CONFIG = {
    enabled: true,
    choiceCount: 4,
    contextMessages: 12,
    recentUserExamples: 6,
    pov: 'auto',
    tense: 'auto',
    detail: 'normal',
    generationDelaySeconds: 3,
    skipOoc: true,
    adultContent: 'match_scene',
    temperature: 0.85,
    maxTokens: 1400,
    connectionId: '',
    modelOverride: '',
    relationshipMemory: true,
    useReasoning: false,
    globalInstructions: '',
    personaOverrides: {},
};
let config = { ...DEFAULT_CONFIG };
let cache = {};
let relationshipMemory = {};
const inFlight = new Set();
function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return fallback;
    return Math.max(min, Math.min(max, n));
}
function normalizeConfig(input) {
    const next = { ...DEFAULT_CONFIG, ...(input || {}) };
    next.choiceCount = Math.round(clampNumber(next.choiceCount, 3, 6, DEFAULT_CONFIG.choiceCount));
    next.contextMessages = Math.round(clampNumber(next.contextMessages, 6, 30, DEFAULT_CONFIG.contextMessages));
    next.recentUserExamples = Math.round(clampNumber(next.recentUserExamples, 2, 12, DEFAULT_CONFIG.recentUserExamples));
    next.temperature = clampNumber(next.temperature, 0, 2, DEFAULT_CONFIG.temperature);
    next.maxTokens = Math.round(clampNumber(next.maxTokens, 500, 32000, DEFAULT_CONFIG.maxTokens));
    next.generationDelaySeconds = clampNumber(next.generationDelaySeconds, 0, 15, DEFAULT_CONFIG.generationDelaySeconds);
    next.skipOoc = next.skipOoc !== false;
    if (!['auto', 'first', 'second', 'third'].includes(next.pov))
        next.pov = 'auto';
    if (!['auto', 'present', 'past'].includes(next.tense))
        next.tense = 'auto';
    if (!['compact', 'normal', 'detailed'].includes(next.detail))
        next.detail = 'normal';
    if (!['match_scene', 'allow_explicit', 'suggestive'].includes(next.adultContent))
        next.adultContent = 'match_scene';
    if (!next.personaOverrides || typeof next.personaOverrides !== 'object')
        next.personaOverrides = {};
    next.globalInstructions = String(next.globalInstructions || '');
    next.connectionId = String(next.connectionId || '');
    next.modelOverride = String(next.modelOverride || '');
    return next;
}
async function loadState() {
    config = normalizeConfig(await spindle.storage.getJson(CONFIG_PATH, { fallback: DEFAULT_CONFIG }));
    cache = await spindle.storage.getJson(CACHE_PATH, { fallback: {} });
    relationshipMemory = await spindle.storage.getJson(MEMORY_PATH, { fallback: {} });
}
async function saveConfig() {
    await spindle.storage.setJson(CONFIG_PATH, config, { indent: 2 });
}
async function saveCache() {
    const entries = Object.values(cache).sort((a, b) => b.createdAt - a.createdAt).slice(0, 250);
    cache = Object.fromEntries(entries.map((entry) => [entry.messageId, entry]));
    await spindle.storage.setJson(CACHE_PATH, cache, { indent: 2 });
}
async function saveRelationshipMemory() {
    const entries = Object.entries(relationshipMemory)
        .sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0))
        .slice(0, 150);
    relationshipMemory = Object.fromEntries(entries);
    await spindle.storage.setJson(MEMORY_PATH, relationshipMemory, { indent: 2 });
}
function startsWithOocMarker(text) {
    const clean = String(text || '').trimStart();
    // Common role-play conventions plus a forgiving `[ooc}:` variant. The marker
    // must be at the beginning so ordinary prose that merely mentions OOC is not skipped.
    return /^(?:\[\s*ooc\s*[\]\}]\s*:?\s*|\(\s*ooc\s*\)\s*:?\s*|ooc\s*:)/i.test(clean);
}
function collectOocMessageIds(messages) {
    const ids = new Set();
    let waitingForAssistantReply = false;
    for (const message of messages || []) {
        const role = String(message?.role || '');
        const id = String(message?.id || '');
        if (role === 'user') {
            const isOoc = startsWithOocMarker(String(message?.content || ''));
            waitingForAssistantReply = isOoc;
            if (isOoc && id)
                ids.add(id);
            continue;
        }
        if (role === 'assistant') {
            const isOoc = waitingForAssistantReply || startsWithOocMarker(String(message?.content || ''));
            if (isOoc && id)
                ids.add(id);
            waitingForAssistantReply = false;
        }
    }
    return ids;
}
function hashText(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1)
        hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
    return (hash >>> 0).toString(36);
}
function compactText(text, max = 3600) {
    const clean = String(text || '').trim();
    if (clean.length <= max)
        return clean;
    return clean.slice(0, max) + '\n[…truncated…]';
}
function stripFences(text) {
    const trimmed = String(text || '').trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced ? fenced[1].trim() : trimmed;
}
function parseJsonObject(text) {
    const cleaned = stripFences(text);
    try {
        return JSON.parse(cleaned);
    }
    catch { }
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first >= 0 && last > first)
        return JSON.parse(cleaned.slice(first, last + 1));
    throw new Error('Model response was not valid JSON');
}
function validateResult(result, expectedCount, detail) {
    const issues = [];
    if (!result || !Array.isArray(result.choices))
        issues.push('choices is missing');
    const choices = Array.isArray(result?.choices) ? result.choices : [];
    if (choices.length !== expectedCount)
        issues.push(`expected exactly ${expectedCount} choices`);
    const intents = new Set();
    const minLength = detail === 'compact' ? 55 : detail === 'detailed' ? 180 : 100;
    for (let i = 0; i < choices.length; i += 1) {
        const c = choices[i] || {};
        if (!String(c.intent || '').trim())
            issues.push(`choice ${i + 1} has no intent`);
        if (!String(c.title || '').trim())
            issues.push(`choice ${i + 1} has no title`);
        if (String(c.text || '').trim().length < minLength)
            issues.push(`choice ${i + 1} is too short`);
        const intent = String(c.intent || '').trim().toLowerCase();
        if (intent && intents.has(intent))
            issues.push(`choice ${i + 1} repeats another intent`);
        if (intent)
            intents.add(intent);
    }
    return issues;
}
function detailInstruction(detail) {
    if (detail === 'compact')
        return 'Each choice should be 1–2 substantial sentences, usually 45–90 words.';
    if (detail === 'detailed')
        return 'Each choice should be 4–7 sentences, usually 120–220 words, with clear action, body language, intent, and optional dialogue.';
    return 'Each choice should be 2–5 sentences, usually 75–150 words, with enough concrete action and intent for the story model to react to.';
}
function adultContentInstruction(mode) {
    const shared = 'Sexual content is permitted only when every involved character is clearly an adult (18+). Never sexualize minors or age-ambiguous characters.';
    if (mode === 'allow_explicit') {
        return `${shared} When the current adult scene or relationship plausibly supports sexual action, explicit sexual language and actions are allowed. Do not euphemize or sanitize merely because the content is sexual. Do not force sexual escalation into unrelated scenes.`;
    }
    if (mode === 'suggestive') {
        return `${shared} Sexual or romantic choices may be suggestive, sensual, or clearly intimate, but keep the choice text non-graphic and avoid explicit anatomical detail.`;
    }
    return `${shared} Match the established scene's level of adult sexual explicitness. If the scene is already explicit, you may remain explicit without sanitizing it; if the scene is only romantic/suggestive or nonsexual, do not artificially escalate it.`;
}
function buildSystemPrompt(cfg) {
    const requestedPov = cfg.pov === 'auto'
        ? 'Infer POV only from the player\'s recent USER turns. If ambiguous, use first person.'
        : `Use ${cfg.pov} person.`;
    const requestedTense = cfg.tense === 'auto'
        ? 'Infer tense only from the player\'s recent USER turns. If ambiguous, use present tense.'
        : `Use ${cfg.tense} tense.`;
    return `You are Persona Paths, a private role-play next-move generator. Your output is NEVER shown to the story-writing model unless the human player manually chooses and sends one option.

Your task: produce exactly ${cfg.choiceCount} distinct, paste-ready candidate USER turns for the player's persona after the latest assistant/story reply.

CORE CHARACTERIZATION RULES
- Role-play the PLAYER PERSONA faithfully. Do not optimize for politeness, niceness, cooperation, safety, or generic social desirability unless those traits are actually appropriate here.
- Personality is contextual, not a bag of averaged adjectives. A brash person can be gentle with one lover, hostile to strangers, deferential to one mentor, playful with a friend, and vicious with an enemy without becoming a generic middle-ground personality.
- Do NOT average contradictory traits into a bland compromise.
- Characterization priority: (1) current scene and current emotional state, (2) demonstrated behavior toward the person currently involved, (3) established relationship with that person, (4) the player's recent demonstrated portrayal, (5) persona description, (6) generic assumptions.
- A relationship can change HOW a trait is expressed without deleting the underlying trait.
- Recent behavior can override stale relationship notes. Treat private relationship memory as a hint, never an authority.

CHOICE QUALITY RULES
- These are meaningful courses of action, not four alternate quips.
- Every choice must contain a concrete non-dialogue action, physical decision, deliberate stillness, change of objective, or other story-moving behavior. Dialogue is optional and should support the choice rather than BE the entire choice.
- Consider movement, leaving the scene, travel, investigation, preparation, physical interaction, escalation, retreat, concealment, waiting, observation, helping, refusing, changing objectives, interacting with the environment, or intentionally doing nothing when those are plausible.
- The choices must differ in TRAJECTORY, not merely wording, tone, or punchline.
- Do not force artificial categories. If the scene strongly favors several similar emotional responses, keep them plausible while making their actual objectives/actions meaningfully different.
- The player is allowed to walk away, end a conversation, leave town, pack up, set off down the trail, ignore a hook, or choose a direction the assistant did not explicitly invite.
- ${detailInstruction(cfg.detail)}

AUTHORSHIP BOUNDARY
- Control ONLY the player's persona: their actions, speech, thoughts, intentions, posture, preparation, and immediately available choices.
- Do not write other characters' dialogue, reactions, thoughts, decisions, or future behavior.
- Do not decide world outcomes, discoveries, encounters, success/failure, passage of long periods, or consequences that belong to the story model.
- Good: "I shoulder my pack and start down the northern trail alone."
- Bad: "I head north and three hours later discover a bandit watchtower."
- If the persona has a secret capability or identity, you may use it when the persona themselves would plausibly act on it, but never imply that NPCs know the secret unless the transcript establishes that they do.

STYLE
- ${requestedPov}
- ${requestedTense}
- Match the player's established voice, including bluntness, profanity, humor, tenderness, formality, or roughness when supported.
- ADULT CONTENT: ${adultContentInstruction(cfg.adultContent)}
- The choice text must be ready to paste directly into the user's composer. Do not put labels or explanations inside the pasted text.

PRIVATE RELATIONSHIP NOTES
- Return concise, observable updates for relationships that matter in the current scene. Do not invent a named relationship if the transcript does not support one.
- Use one entry per person/relationship. Preserve nuance: for example, a persona may be soft with Elena while remaining brash with everyone else.
- These updates are extension-private. Do not write analysis, chain-of-thought, or hidden reasoning.

OUTPUT
Return JSON only, with this exact shape:
{
  "style": { "pov": "first|second|third", "tense": "present|past" },
  "relationship_updates": [
    { "subject": "Elena", "notes": ["unusually patient", "protective", "still blunt and teasing"] }
  ],
  "choices": [
    { "intent": "short unique trajectory", "title": "2–5 word UI title", "text": "paste-ready user turn" }
  ]
}
No markdown. No commentary.`;
}
function buildUserPrompt(args) {
    const { persona, personaOverride, memoryNotes, recentUserTurns, sceneMessages, globalInstructions } = args;
    const personaBlock = persona
        ? `NAME: ${persona.name || 'Unnamed'}\nTITLE: ${persona.title || ''}\nDESCRIPTION:\n${compactText(persona.description || '(none)', 6000)}`
        : 'No active persona card is available. Infer the player character only from USER turns.';
    const userExamples = recentUserTurns.length
        ? recentUserTurns.map((m, i) => `USER EXAMPLE ${i + 1}:\n${compactText(m.content, 2600)}`).join('\n\n')
        : '(none)';
    const scene = sceneMessages.map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}:\n${compactText(m.content, 3400)}`).join('\n\n');
    return `PLAYER PERSONA\n${personaBlock}

PERSONA-SPECIFIC GUIDANCE FROM THE HUMAN\n${personaOverride.trim() || '(none)'}

GLOBAL EXTENSION GUIDANCE FROM THE HUMAN\n${globalInstructions.trim() || '(none)'}

PRIVATE RELATIONSHIP MEMORY FROM PRIOR CYOA PASSES\n${memoryNotes.length ? memoryNotes.map(x => `- ${x}`).join('\n') : '(none yet)'}

RECENT EXAMPLES OF HOW THE HUMAN ACTUALLY PLAYS THIS PERSONA\n${userExamples}

CURRENT ROLE-PLAY SCENE\n${scene}

Generate the next-move choices for the USER now. Current scene evidence outranks stale notes.`;
}
async function resolveConnection(cfg, userId) {
    if (!spindle.permissions.has('generation')) {
        throw new Error('Generation permission is not granted. Enable it for Persona Paths in Lumiverse Extensions.');
    }
    const connections = await spindle.connections.list(userId);
    if (!Array.isArray(connections) || !connections.length)
        throw new Error('No Lumiverse LLM connection profiles are available.');
    let conn = cfg.connectionId ? connections.find((c) => c.id === cfg.connectionId) : null;
    if (!conn)
        conn = connections.find((c) => c.is_default) || connections[0];
    return { conn, connections };
}
function getKimiTraits(provider, model) {
    const p = String(provider || '').toLowerCase();
    const m = String(model || '').toLowerCase();
    const isKimi = p.includes('moonshot') || m.startsWith('kimi-');
    const isK3 = isKimi && m.includes('kimi-k3');
    const isK27 = isKimi && m.includes('kimi-k2.7-code');
    const isK26 = isKimi && m.includes('kimi-k2.6');
    const isK25 = isKimi && m.includes('kimi-k2.5');
    return { isKimi, isK3, isK27, isK26, isK25, alwaysThinking: isK3 || isK27 };
}
function buildGenerationTuning(conn, model, cfg, repair = false) {
    const traits = getKimiTraits(conn?.provider, model);
    const params = {};
    let reasoning = undefined;
    let effectiveMaxTokens = cfg.maxTokens;
    if (traits.isKimi) {
        // Moonshot's current Kimi families use fixed temperatures. Do not send the
        // generic extension temperature because Kimi rejects non-fixed values.
        // Thinking tokens share the same output budget as final content.
        if (!cfg.useReasoning) {
            if (traits.isK3) {
                // K3 cannot disable thinking. "Reasoning off" in Persona Paths therefore
                // means low-effort reasoning. Set the provider-native field explicitly;
                // raw parameter values take precedence over Lumiverse's translated value.
                params.reasoning_effort = 'low';
                reasoning = { source: 'custom', apiReasoning: true, effort: 'low' };
                effectiveMaxTokens = Math.max(effectiveMaxTokens, 16000);
            }
            else if (traits.isK27) {
                // K2.7 Code also always thinks and has no effort switch.
                reasoning = { source: 'custom', apiReasoning: true, effort: 'low' };
                effectiveMaxTokens = Math.max(effectiveMaxTokens, 16000);
            }
            else {
                // K2.6 / K2.5 support a real thinking-off switch.
                reasoning = { source: 'off' };
            }
        }
        else {
            // If thinking is requested, Kimi needs substantially more room because
            // reasoning_content and content consume the same max-token budget.
            reasoning = { source: 'inherit' };
            effectiveMaxTokens = Math.max(effectiveMaxTokens, 16000);
        }
    }
    else {
        params.temperature = cfg.temperature;
        if (!cfg.useReasoning)
            reasoning = { source: 'off' };
    }
    if (repair && effectiveMaxTokens > 0) {
        // A length-truncated repair should get more headroom rather than repeating
        // the exact same doomed budget. 32k is within the documented K2.5/K2.6
        // defaults and is modest for K3.
        effectiveMaxTokens = Math.min(Math.max(effectiveMaxTokens * 2, traits.isKimi ? 32000 : effectiveMaxTokens), 64000);
    }
    params.max_tokens = effectiveMaxTokens;
    return { params, reasoning, effectiveMaxTokens, traits };
}
async function generatePaths(args, userId) {
    const { conn } = await resolveConnection(config, userId);
    const system = buildSystemPrompt(config);
    const user = buildUserPrompt({
        ...args,
        globalInstructions: config.globalInstructions,
    });
    const model = config.modelOverride.trim() || conn.model;
    const tuning = buildGenerationTuning(conn, model, config, false);
    const request = {
        provider: conn.provider,
        model,
        connection_id: conn.id,
        // Raw generation is also user-scoped for operator-installed extensions.
        // The host reads userId directly from the generation input payload.
        userId,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ],
        parameters: tuning.params,
    };
    if (tuning.reasoning)
        request.reasoning = tuning.reasoning;
    if (tuning.traits.isKimi) {
        spindle.log.info(`Persona Paths Kimi tuning: model=${model}, max_tokens=${tuning.effectiveMaxTokens}, reasoning=${config.useReasoning ? 'connection' : (tuning.traits.alwaysThinking ? 'low/always-on' : 'off')}`);
    }
    let response = await spindle.generate.raw(request);
    let responseText = String(response?.content || '').trim();
    let parsed;
    try {
        parsed = parseJsonObject(responseText);
    }
    catch (err) {
        parsed = null;
    }
    let issues = validateResult(parsed, config.choiceCount, config.detail);
    if (issues.length) {
        // Do not round-trip the failed model output as an assistant message. Some
        // OpenAI-compatible providers (notably Moonshot/Kimi) reject an assistant
        // message whose content is empty. A blank first response used to make the
        // repair request fail with HTTP 400 before the model even saw it.
        //
        // Instead, retry as a fresh system+user request and include any prior output
        // only as quoted repair context inside the user message. This is also more
        // portable across providers with stricter message-role validation.
        const priorForRepair = responseText
            ? compactText(responseText, 12000)
            : '(The previous attempt returned no usable final content.)';
        const repairUser = `${user}

REPAIR PASS
The previous attempt did not satisfy the required JSON contract. Problems detected: ${issues.join('; ')}.

PREVIOUS OUTPUT (reference only; it may be empty, malformed, or truncated):
${priorForRepair}

Generate the answer again from scratch. Return one corrected JSON object only. Preserve strong persona fidelity, concrete action, distinct trajectories, the selected POV/tense, and the authorship boundary. Do not mention this repair pass.`;
        const repairTuning = buildGenerationTuning(conn, model, config, response?.finish_reason === 'length');
        const repairRequest = {
            ...request,
            parameters: repairTuning.params,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: repairUser },
            ],
        };
        if (repairTuning.reasoning)
            repairRequest.reasoning = repairTuning.reasoning;
        else
            delete repairRequest.reasoning;
        response = await spindle.generate.raw(repairRequest);
        responseText = String(response?.content || '').trim();
        if (!responseText) {
            throw new Error(`CYOA provider returned empty content twice${response?.finish_reason ? ` (finish reason: ${response.finish_reason})` : ''}. Persona Paths already expanded the retry budget; if this is an always-thinking model, try another model or enable a larger manual Max output token budget.`);
        }
        try {
            parsed = parseJsonObject(responseText);
        }
        catch (err) {
            throw new Error(`CYOA repair response was not valid JSON${response?.finish_reason ? ` (finish reason: ${response.finish_reason})` : ''}.`);
        }
        issues = validateResult(parsed, config.choiceCount, config.detail);
    }
    if (issues.length)
        throw new Error(`CYOA output failed validation after repair: ${issues.join('; ')}`);
    parsed.choices = parsed.choices.map((choice) => ({
        intent: String(choice.intent || '').trim(),
        title: String(choice.title || '').trim(),
        text: String(choice.text || '').trim(),
    }));
    parsed.relationship_updates = Array.isArray(parsed.relationship_updates)
        ? parsed.relationship_updates.map((item) => ({
            subject: String(item?.subject || '').trim(),
            notes: Array.isArray(item?.notes) ? item.notes.map((x) => String(x).trim()).filter(Boolean).slice(0, 6) : [],
        })).filter((item) => item.subject && item.notes.length).slice(0, 4)
        : [];
    parsed.style = {
        pov: ['first', 'second', 'third'].includes(String(parsed.style?.pov)) ? String(parsed.style?.pov) : (config.pov === 'auto' ? 'first' : config.pov),
        tense: ['present', 'past'].includes(String(parsed.style?.tense)) ? String(parsed.style?.tense) : (config.tense === 'auto' ? 'present' : config.tense),
    };
    return parsed;
}
async function handleAssistantMessage(chatId, messageId, force = false, userId) {
    if (!config.enabled && !force)
        return;
    const key = `${chatId}:${messageId}`;
    if (inFlight.has(key))
        return;
    inFlight.add(key);
    try {
        const messages = await spindle.chat.getMessages(chatId);
        const target = messages.find((m) => m.id === messageId);
        if (!target || target.role !== 'assistant')
            return;
        const oocMessageIds = config.skipOoc ? collectOocMessageIds(messages) : new Set();
        if (config.skipOoc && oocMessageIds.has(messageId)) {
            if (cache[messageId]) {
                delete cache[messageId];
                await saveCache();
            }
            spindle.log.info(`Persona Paths skipped OOC exchange for ${messageId}.`);
            spindle.sendToFrontend({ type: 'choices_skipped', chatId, messageId, reason: 'ooc' }, userId);
            return;
        }
        const contentHash = hashText(String(target.content || ''));
        const existing = cache[messageId];
        if (!force && existing && existing.contentHash === contentHash) {
            spindle.sendToFrontend({ type: 'choices_ready', data: existing }, userId);
            return;
        }
        spindle.sendToFrontend({ type: 'choices_loading', chatId, messageId }, userId);
        const persona = await spindle.personas.getActive(userId);
        const personaId = persona?.id || 'no_persona';
        const memoryKey = `${chatId}::${personaId}`;
        const storedMemory = relationshipMemory[memoryKey];
        const memoryNotes = config.relationshipMemory && storedMemory
            ? Object.entries(storedMemory.subjects || {}).map(([subject, notes]) => `${subject}: ${(notes || []).join('; ')}`).slice(0, 12)
            : [];
        // Deliberately exclude system messages. Persona Paths observes the played story,
        // not preset/system instructions that may contain unrelated hidden context.
        const storyMessages = messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && (!config.skipOoc || !oocMessageIds.has(String(m.id || ''))));
        const targetIndex = storyMessages.findIndex((m) => m.id === messageId);
        const throughTarget = targetIndex >= 0 ? storyMessages.slice(0, targetIndex + 1) : storyMessages;
        const sceneMessages = throughTarget.slice(-config.contextMessages);
        const recentUserTurns = throughTarget.filter((m) => m.role === 'user').slice(-config.recentUserExamples);
        const result = await generatePaths({
            persona,
            personaOverride: persona?.id ? (config.personaOverrides[persona.id] || '') : '',
            memoryNotes,
            recentUserTurns,
            sceneMessages,
        }, userId);
        const entry = {
            chatId,
            messageId,
            contentHash,
            style: result.style,
            choices: result.choices,
            createdAt: Date.now(),
        };
        cache[messageId] = entry;
        await saveCache();
        if (config.relationshipMemory && result.relationship_updates?.length) {
            const previousSubjects = relationshipMemory[memoryKey]?.subjects || {};
            const nextSubjects = { ...previousSubjects };
            for (const update of result.relationship_updates) {
                const existingKey = Object.keys(nextSubjects).find(k => k.toLowerCase() === update.subject.toLowerCase());
                const keyName = existingKey || update.subject;
                nextSubjects[keyName] = update.notes;
            }
            const trimmedSubjects = Object.fromEntries(Object.entries(nextSubjects).slice(-16));
            relationshipMemory[memoryKey] = {
                subjects: trimmedSubjects,
                updatedAt: Date.now(),
                messageId,
            };
            await saveRelationshipMemory();
        }
        spindle.sendToFrontend({ type: 'choices_ready', data: entry }, userId);
    }
    catch (err) {
        const message = err?.message || String(err);
        spindle.log.error(`Persona Paths failed for ${messageId}: ${message}`);
        spindle.sendToFrontend({ type: 'choices_error', chatId, messageId, error: message }, userId);
    }
    finally {
        inFlight.delete(key);
    }
}
async function sendState(userId) {
    const generationGranted = spindle.permissions.has('generation');
    let connections = [];
    let connectionError = '';
    if (!generationGranted) {
        connectionError = 'Generation permission is not granted to Persona Paths.';
    }
    else {
        try {
            // Explicitly carry the frontend caller's user scope into the connection lookup.
            // This matters in runtimes where an ambient user cannot be inferred reliably.
            const listed = await spindle.connections.list(userId);
            connections = Array.isArray(listed) ? listed : [];
            if (!connections.length)
                connectionError = 'Lumiverse returned zero LLM connection profiles for this user.';
        }
        catch (err) {
            connectionError = err?.message || String(err);
            spindle.log.error(`Persona Paths connection lookup failed: ${connectionError}`);
        }
    }
    let persona = null;
    let personaError = '';
    try {
        persona = await spindle.personas.getActive(userId);
    }
    catch (err) {
        personaError = err?.message || String(err);
        spindle.log.error(`Persona Paths active persona lookup failed: ${personaError}`);
    }
    spindle.sendToFrontend({
        type: 'state',
        config,
        connections,
        generationGranted,
        connectionError,
        personaError,
        activePersona: persona ? { id: persona.id, name: persona.name, title: persona.title || '' } : null,
    }, userId);
}
spindle.onFrontendMessage(async (payload, userId) => {
    try {
        if (!payload || typeof payload !== 'object')
            return;
        if (payload.type === 'get_state') {
            await sendState(userId);
            return;
        }
        if (payload.type === 'save_config') {
            config = normalizeConfig({ ...config, ...(payload.patch || {}) });
            await saveConfig();
            await sendState(userId);
            return;
        }
        if (payload.type === 'set_persona_override') {
            const personaId = String(payload.personaId || '');
            if (personaId) {
                config.personaOverrides[personaId] = String(payload.text || '');
                await saveConfig();
            }
            await sendState(userId);
            return;
        }
        if (payload.type === 'load_choices') {
            const ids = Array.isArray(payload.messageIds) ? payload.messageIds.map(String) : [String(payload.messageId || '')];
            const grouped = new Map();
            for (const id of ids) {
                const entry = id ? cache[id] : null;
                if (!entry)
                    continue;
                const list = grouped.get(entry.chatId) || [];
                list.push(id);
                grouped.set(entry.chatId, list);
            }
            let cacheChanged = false;
            for (const [chatId, messageIds] of grouped) {
                let blocked = new Set();
                if (config.skipOoc) {
                    try {
                        const messages = await spindle.chat.getMessages(chatId);
                        blocked = collectOocMessageIds(messages);
                    }
                    catch (err) {
                        spindle.log.warn(`Persona Paths could not verify OOC state while restoring cached choices: ${err?.message || String(err)}`);
                    }
                }
                for (const id of messageIds) {
                    if (config.skipOoc && blocked.has(id)) {
                        delete cache[id];
                        cacheChanged = true;
                        spindle.sendToFrontend({ type: 'choices_skipped', chatId, messageId: id, reason: 'ooc' }, userId);
                    }
                    else if (cache[id]) {
                        spindle.sendToFrontend({ type: 'choices_ready', data: cache[id] }, userId);
                    }
                }
            }
            if (cacheChanged)
                await saveCache();
            return;
        }
        if (payload.type === 'ensure_choices') {
            const chatId = String(payload.chatId || '');
            const messageId = String(payload.messageId || '');
            if (!userId)
                throw new Error('Persona Paths could not resolve the current Lumiverse user for CYOA generation.');
            if (chatId && messageId)
                await handleAssistantMessage(chatId, messageId, false, userId);
            return;
        }
        if (payload.type === 'regenerate') {
            const chatId = String(payload.chatId || '');
            const messageId = String(payload.messageId || '');
            if (chatId && messageId)
                await handleAssistantMessage(chatId, messageId, true, userId);
            return;
        }
        if (payload.type === 'manual_generate_latest') {
            if (!userId)
                throw new Error('Persona Paths could not resolve the current Lumiverse user for manual generation.');
            if (!spindle.permissions.has('chats')) {
                throw new Error('The Chats permission is required for manual generation so Persona Paths can resolve the active chat after a refresh.');
            }
            const activeChat = await spindle.chats.getActive(userId);
            if (!activeChat?.id)
                throw new Error('Open a Lumiverse chat before running Persona Paths manually.');
            const messages = await spindle.chat.getMessages(activeChat.id);
            const latestAssistant = [...messages].reverse().find((m) => m?.role === 'assistant' && String(m?.content || '').trim().length > 0);
            if (!latestAssistant?.id)
                throw new Error('The active chat does not have an assistant reply to generate paths for yet.');
            spindle.sendToFrontend({
                type: 'manual_target',
                chatId: activeChat.id,
                messageId: latestAssistant.id,
            }, userId);
            // Force=true deliberately replaces/retries any cached result for this reply,
            // and bypasses the automatic-generation enabled toggle.
            await handleAssistantMessage(activeChat.id, String(latestAssistant.id), true, userId);
            return;
        }
        if (payload.type === 'clear_relationship_memory') {
            relationshipMemory = {};
            await saveRelationshipMemory();
            spindle.sendToFrontend({ type: 'memory_cleared' }, userId);
            return;
        }
    }
    catch (err) {
        const error = err?.message || String(err);
        spindle.log.error(`Frontend request failed: ${error}`);
        if (payload?.type === 'manual_generate_latest') {
            spindle.sendToFrontend({ type: 'manual_error', error }, userId);
        }
        else {
            spindle.sendToFrontend({ type: 'request_error', error }, userId);
        }
    }
});
// CYOA generation triggers are intentionally received from the frontend via
// onFrontendMessage so operator-scoped installs always carry the active userId.
// The frontend listens to GENERATION_ENDED and MESSAGE_SWIPED.
spindle.permissions.onChanged(({ permission }) => {
    // Permission-change callbacks do not carry a userId. For an operator-scoped
    // extension, do not call user-scoped APIs from here. The panel's Refresh
    // button/get_state request provides the frontend user's scope safely.
    if (permission === 'generation') {
        spindle.log.info('Persona Paths generation permission changed; refresh the panel to reload connections.');
    }
});
void loadState().then(() => {
    spindle.log.info('Persona Paths loaded — private CYOA context is isolated from normal prompt assembly.');
}).catch((err) => {
    spindle.log.error(`Persona Paths state load failed: ${err?.message || String(err)}`);
});

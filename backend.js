// @bun
// backend.ts
var CONFIG_PATH = "config.json";
var CACHE_PATH = "choices.json";
var MEMORY_PATH = "relationship_memory.json";
var draftRewritesInFlight = new Set;
var DEFAULT_CONFIG = {
  enabled: true,
  choiceCount: 5,
  contextMessages: 12,
  recentUserExamples: 6,
  pov: "auto",
  tense: "auto",
  detail: "normal",
  generationDelaySeconds: 3,
  skipOoc: true,
  adultContent: "match_scene",
  prismIntegration: "auto",
  prismColorOverrides: {},
  temperature: 0.85,
  maxTokens: 1400,
  connectionId: "",
  modelOverride: "",
  relationshipMemory: true,
  longTermStoryMemory: true,
  storyMemoryChunks: 6,
  useReasoning: false,
  globalInstructions: "",
  personaOverrides: {}
};
var config = { ...DEFAULT_CONFIG };
var cache = {};
var relationshipMemory = {};
var inFlight = new Set;
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n))
    return fallback;
  return Math.max(min, Math.min(max, n));
}
function normalizeConfig(input) {
  const next = { ...DEFAULT_CONFIG, ...input || {} };
  next.choiceCount = Math.round(clampNumber(next.choiceCount, 3, 6, DEFAULT_CONFIG.choiceCount));
  next.contextMessages = Math.round(clampNumber(next.contextMessages, 6, 40, DEFAULT_CONFIG.contextMessages));
  next.recentUserExamples = Math.round(clampNumber(next.recentUserExamples, 2, 12, DEFAULT_CONFIG.recentUserExamples));
  next.storyMemoryChunks = Math.round(clampNumber(next.storyMemoryChunks, 1, 12, DEFAULT_CONFIG.storyMemoryChunks));
  next.longTermStoryMemory = next.longTermStoryMemory !== false;
  next.temperature = clampNumber(next.temperature, 0, 2, DEFAULT_CONFIG.temperature);
  next.maxTokens = Math.round(clampNumber(next.maxTokens, 500, 32000, DEFAULT_CONFIG.maxTokens));
  next.generationDelaySeconds = clampNumber(next.generationDelaySeconds, 0, 15, DEFAULT_CONFIG.generationDelaySeconds);
  next.skipOoc = next.skipOoc !== false;
  if (!["auto", "first", "second", "third"].includes(next.pov))
    next.pov = "auto";
  if (!["auto", "present", "past"].includes(next.tense))
    next.tense = "auto";
  if (!["compact", "normal", "detailed"].includes(next.detail))
    next.detail = "normal";
  if (!["match_scene", "allow_explicit", "suggestive"].includes(next.adultContent))
    next.adultContent = "match_scene";
  if (!["auto", "manual", "off"].includes(next.prismIntegration))
    next.prismIntegration = "auto";
  if (!next.prismColorOverrides || typeof next.prismColorOverrides !== "object")
    next.prismColorOverrides = {};
  next.prismColorOverrides = Object.fromEntries(Object.entries(next.prismColorOverrides).map(([key, value]) => [key, normalizeHex(value)]).filter(([, value]) => !!value));
  if (!next.personaOverrides || typeof next.personaOverrides !== "object")
    next.personaOverrides = {};
  next.globalInstructions = String(next.globalInstructions || "");
  next.connectionId = String(next.connectionId || "");
  next.modelOverride = String(next.modelOverride || "");
  return next;
}
async function loadState() {
  config = normalizeConfig(await spindle.storage.getJson(CONFIG_PATH, { fallback: DEFAULT_CONFIG }));
  cache = await spindle.storage.getJson(CACHE_PATH, { fallback: {} });
  relationshipMemory = await spindle.storage.getJson(MEMORY_PATH, { fallback: {} });
  let cacheChanged = false;
  for (const entry of Object.values(cache || {})) {
    if (!entry || !Array.isArray(entry.choices))
      continue;
    entry.choices = entry.choices.map((choice) => {
      const before = String(choice?.text || "");
      const after = cleanGeneratedChoiceText(before);
      if (after !== before.trim())
        cacheChanged = true;
      return { ...choice, text: after };
    });
  }
  if (cacheChanged)
    await saveCache();
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
  const entries = Object.entries(relationshipMemory).sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0)).slice(0, 150);
  relationshipMemory = Object.fromEntries(entries);
  await spindle.storage.setJson(MEMORY_PATH, relationshipMemory, { indent: 2 });
}
function startsWithOocMarker(text) {
  const clean = String(text || "").trimStart();
  return /^(?:\[\s*ooc\s*[\]\}]\s*:?\s*|\(\s*ooc\s*\)\s*:?\s*|ooc\s*:)/i.test(clean);
}
function collectOocMessageIds(messages) {
  const ids = new Set;
  let waitingForAssistantReply = false;
  for (const message of messages || []) {
    const role = String(message?.role || "");
    const id = String(message?.id || "");
    if (role === "user") {
      const isOoc = startsWithOocMarker(String(message?.content || ""));
      waitingForAssistantReply = isOoc;
      if (isOoc && id)
        ids.add(id);
      continue;
    }
    if (role === "assistant") {
      const isOoc = waitingForAssistantReply || startsWithOocMarker(String(message?.content || ""));
      if (isOoc && id)
        ids.add(id);
      waitingForAssistantReply = false;
    }
  }
  return ids;
}
function hashText(text) {
  let hash = 5381;
  for (let i = 0;i < text.length; i += 1)
    hash = (hash << 5) + hash ^ text.charCodeAt(i);
  return (hash >>> 0).toString(36);
}
function compactText(text, max = 3600) {
  const clean = String(text || "").trim();
  if (clean.length <= max)
    return clean;
  return clean.slice(0, max) + `
[\u2026truncated\u2026]`;
}
function compactTextPreserveEnds(text, max = 4800, tailRatio = 0.68) {
  const clean = String(text || "").trim();
  if (clean.length <= max)
    return clean;
  const marker = `
[\u2026middle truncated; final beat preserved\u2026]
`;
  const usable = Math.max(200, max - marker.length);
  const tailSize = Math.max(120, Math.floor(usable * tailRatio));
  const headSize = Math.max(80, usable - tailSize);
  return clean.slice(0, headSize).trimEnd() + marker + clean.slice(-tailSize).trimStart();
}
function compactTailText(text, max = 5200) {
  const clean = String(text || "").trim();
  if (clean.length <= max)
    return clean;
  return `[\u2026earlier part omitted; this is the END of the reply\u2026]
${clean.slice(-max)}`;
}
function normalizeHex(value) {
  const raw = String(value || "").trim();
  const short = raw.match(/^#?([0-9a-f]{3})$/i);
  if (short)
    return `#${short[1].split("").map((c) => c + c).join("").toUpperCase()}`;
  const full = raw.match(/^#?([0-9a-f]{6})$/i);
  return full ? `#${full[1].toUpperCase()}` : "";
}
function stripColorMarkup(text) {
  return String(text || "").replace(/&lt;\s*\/?\s*font\b[^&]*?&gt;/gi, "").replace(/\\?<\s*\/?\s*font\b[^>]*>/gi, "").replace(/\[\s*\/?\s*color(?:\s*=\s*[^\]]+)?\s*\]/gi, "");
}
function cleanRoleplayText(text) {
  return stripColorMarkup(text).trim();
}
function normalizePrismDialogueQuotes(text) {
  const source = String(text || "");
  return source.replace(/(^|[\s([{>\u2014\u2013-])\u2018([^\u2018\n]*?)\u2019(?=$|[\s)\]}>.,!?;:\u2014\u2013-])/gm, (_match, boundary, inner) => `${boundary}\u201C${inner}\u201D`);
}
function cleanGeneratedChoiceText(text) {
  return normalizePrismDialogueQuotes(cleanRoleplayText(text)).trim();
}
function extractPrismColorsFromUserContent(text) {
  const source = String(text || "");
  const found = [];
  const add = (value) => {
    const color = normalizeHex(value);
    if (color && !found.includes(color))
      found.push(color);
  };
  for (const match of source.matchAll(/<font\b[^>]*\bcolor\s*=\s*["']?\s*(#?[0-9a-f]{6}|#?[0-9a-f]{3})\s*["']?[^>]*>/gi))
    add(match[1]);
  for (const match of source.matchAll(/&lt;\s*font\b[^&]*?\bcolor\s*=\s*(?:&quot;|&#39;|["'])?\s*(#?[0-9a-f]{6}|#?[0-9a-f]{3})/gi))
    add(match[1]);
  for (const match of source.matchAll(/\[\s*color\s*=\s*["']?\s*(#?[0-9a-f]{6}|#?[0-9a-f]{3})\s*["']?\s*\]/gi))
    add(match[1]);
  return found;
}
function inferPrismPersonaColorFromUserMessages(messages) {
  for (let i = (messages || []).length - 1;i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "user")
      continue;
    const color = normalizeHex(message?.metadata?.lumi_dialogue_color) || normalizeHex(message?.extra?.spindle_metadata?.lumi_dialogue_color);
    if (color)
      return { color, source: "Prism user-message metadata" };
  }
  const votes = new Map;
  let considered = 0;
  for (let i = (messages || []).length - 1;i >= 0 && considered < 12; i -= 1) {
    const message = messages[i];
    if (message?.role !== "user")
      continue;
    considered += 1;
    const colors = extractPrismColorsFromUserContent(message?.content);
    if (colors.length !== 1)
      continue;
    const color = colors[0];
    const current = votes.get(color) || { count: 0, newestIndex: i };
    current.count += 1;
    current.newestIndex = Math.max(current.newestIndex, i);
    votes.set(color, current);
  }
  const winner = [...votes.entries()].sort((a, b) => b[1].count - a[1].count || b[1].newestIndex - a[1].newestIndex)[0];
  if (winner)
    return { color: winner[0], source: "Prism user-message markup" };
  return { color: "", source: "" };
}
function parsePrismHexRows(text) {
  const rows = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^\s*(.+?)\s*:\s*(#[0-9a-f]{6})(?:\s*\(provisional\))?\s*$/i);
    if (!match)
      continue;
    const name = String(match[1] || "").trim();
    const color = normalizeHex(match[2]);
    if (!name || !color)
      continue;
    rows.push({ name, color, provisional: /\(provisional\)\s*$/i.test(line) });
  }
  return rows;
}
async function resolvePrismInfo(chatId, userId, persona, messages) {
  if (config.prismIntegration === "off") {
    return { mode: "off", available: false, color: "", source: "", status: "Prism integration is off." };
  }
  if (config.prismIntegration === "manual") {
    const personaId = String(persona?.id || "");
    const color = personaId ? normalizeHex(config.prismColorOverrides?.[personaId]) : "";
    if (color) {
      return {
        mode: "manual",
        available: true,
        color,
        source: "Persona Paths manual override",
        status: `Manual Prism persona color: ${color}.`
      };
    }
    return {
      mode: "manual",
      available: false,
      color: "",
      source: "",
      status: personaId ? "Manual Prism color is selected. Enter a valid #RRGGBB color for this persona." : "Manual Prism color is selected, but there is no active persona."
    };
  }
  const userEvidence = inferPrismPersonaColorFromUserMessages(messages);
  if (userEvidence.color) {
    return {
      mode: "auto",
      available: true,
      color: userEvidence.color,
      source: userEvidence.source,
      status: `${userEvidence.source === "Prism user-message metadata" ? "Prism persona color" : "Prism persona color inferred from your colored turns"}: ${userEvidence.color}.`
    };
  }
  let macroAvailable = false;
  let macroStatus = "";
  try {
    const resolved = await spindle.macros.resolve("{{prismHexes}}", { chatId, userId, commit: false });
    const text = String(resolved?.text || "");
    const diagnostics = Array.isArray(resolved?.diagnostics) ? resolved.diagnostics : [];
    const unknown = diagnostics.some((d) => /unknown.*prismhexes|prismhexes.*unknown/i.test(String(d?.message || ""))) || text.includes("{{prismHexes}}");
    macroAvailable = !unknown;
    const rows = parsePrismHexRows(text);
    const personaName = String(persona?.name || "").trim().toLocaleLowerCase();
    if (personaName) {
      const exact = rows.find((row) => row.name.trim().toLocaleLowerCase() === personaName && !row.provisional) || rows.find((row) => row.name.trim().toLocaleLowerCase() === personaName);
      if (exact) {
        return {
          mode: "auto",
          available: true,
          color: exact.color,
          source: "Prism registry",
          status: `Prism: ${persona?.name || "persona"} uses ${exact.color}.`
        };
      }
    }
    if (macroAvailable)
      macroStatus = rows.length ? "Prism registry found. The active persona is not exposed there, and no colored user-turn evidence was available yet." : "Prism is available, but no persona color was exposed yet.";
  } catch (err) {
    macroStatus = `Prism macro lookup unavailable: ${err?.message || String(err)}`;
  }
  return {
    mode: "auto",
    available: macroAvailable,
    color: "",
    source: "",
    status: macroStatus || "Prism was not detected. Choices will use normal Lumiverse text color."
  };
}
function stripFences(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}
function parseJsonObject(text) {
  const cleaned = stripFences(text);
  try {
    return JSON.parse(cleaned);
  } catch {}
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first)
    return JSON.parse(cleaned.slice(first, last + 1));
  throw new Error("Model response was not valid JSON");
}
function validateResult(result, expectedCount, detail) {
  const issues = [];
  if (!result || !Array.isArray(result.choices))
    issues.push("choices is missing");
  const state = result?.scene_state;
  const location = String(state?.location || "").trim();
  const moment = String(state?.moment || "").trim();
  if (!location)
    issues.push("scene_state.location is missing");
  if (!moment)
    issues.push("scene_state.moment is missing");
  if (location && location.split(/\s+/).filter(Boolean).length > 8)
    issues.push("scene_state.location is too long");
  if (moment && moment.split(/\s+/).filter(Boolean).length > 10)
    issues.push("scene_state.moment is too long");
  const choices = Array.isArray(result?.choices) ? result.choices : [];
  if (choices.length !== expectedCount)
    issues.push(`expected exactly ${expectedCount} choices`);
  const intents = new Set;
  let sceneAdvancers = 0;
  const minLength = detail === "compact" ? 55 : detail === "detailed" ? 180 : 100;
  for (let i = 0;i < choices.length; i += 1) {
    const c = choices[i] || {};
    if (!String(c.intent || "").trim())
      issues.push(`choice ${i + 1} has no intent`);
    const title = String(c.title || "").trim();
    if (!title)
      issues.push(`choice ${i + 1} has no title`);
    else {
      const titleWords = title.split(/\s+/).filter(Boolean).length;
      if (titleWords > 5)
        issues.push(`choice ${i + 1} title is too long; use a 2\u20134 word scan label`);
    }
    if (String(c.text || "").trim().length < minLength)
      issues.push(`choice ${i + 1} is too short`);
    const intensity = Number(c.intensity);
    if (!Number.isInteger(intensity) || intensity < 1 || intensity > 3)
      issues.push(`choice ${i + 1} intensity must be 1, 2, or 3`);
    const intent = String(c.intent || "").trim().toLowerCase();
    if (intent && intents.has(intent))
      issues.push(`choice ${i + 1} repeats another intent`);
    if (intent)
      intents.add(intent);
    if (c.advances_scene === true)
      sceneAdvancers += 1;
  }
  if (sceneAdvancers !== 1)
    issues.push(`expected exactly one scene-advancing choice, got ${sceneAdvancers}`);
  return issues;
}
function detailInstruction(detail) {
  if (detail === "compact")
    return "Each choice should be 1\u20132 substantial sentences, usually 45\u201390 words.";
  if (detail === "detailed")
    return "Each choice should be 4\u20137 sentences, usually 120\u2013220 words, with clear action, body language, intent, and optional dialogue.";
  return "Each choice should be 2\u20135 sentences, usually 75\u2013150 words, with enough concrete action and intent for the story model to react to.";
}
function adultContentInstruction(mode) {
  const shared = "Sexual content is permitted only when every involved character is clearly an adult (18+). Never sexualize minors or age-ambiguous characters.";
  if (mode === "allow_explicit") {
    return `${shared} When the current adult scene or relationship plausibly supports sexual action, explicit sexual language and actions are allowed. Do not euphemize or sanitize merely because the content is sexual. Do not force sexual escalation into unrelated scenes.`;
  }
  if (mode === "suggestive") {
    return `${shared} Sexual or romantic choices may be suggestive, sensual, or clearly intimate, but keep the choice text non-graphic and avoid explicit anatomical detail.`;
  }
  return `${shared} Match the established scene's level of adult sexual explicitness. If the scene is already explicit, you may remain explicit without sanitizing it; if the scene is only romantic/suggestive or nonsexual, do not artificially escalate it.`;
}
function memoryChunkRange(chunk) {
  const meta = chunk?.metadata || {};
  const start = Number(meta.startIndex ?? meta.start_index);
  const end = Number(meta.endIndex ?? meta.end_index);
  return {
    start: Number.isFinite(start) ? start : null,
    end: Number.isFinite(end) ? end : null
  };
}
function chunkOverlapsIndexSet(chunk, indexes) {
  if (!indexes.size)
    return false;
  const range = memoryChunkRange(chunk);
  if (range.start == null || range.end == null)
    return false;
  for (const index of indexes) {
    if (index >= range.start && index <= range.end)
      return true;
  }
  return false;
}
function containsOocMarkerAnywhere(text) {
  return /(?:^|\n)\s*(?:\[\s*ooc\s*[\]\}]\s*:?\s*|\(\s*ooc\s*\)\s*:?\s*|ooc\s*:)/i.test(String(text || ""));
}
function emptyStoryMemoryContext(note = "") {
  return { source: "none", memories: [], entities: [], relationships: [], arc: "", note };
}
function normalizedMemoryText(value) {
  return cleanRoleplayText(value).replace(/\s+/g, " ").trim().toLowerCase();
}
function compactJson(value, max = 1800) {
  try {
    const text = JSON.stringify(value);
    return compactText(text === undefined ? "" : text, max);
  } catch {
    return "";
  }
}
function formatCortexEntity(entity) {
  if (!entity)
    return "";
  if (typeof entity === "string")
    return compactText(cleanRoleplayText(entity), 1600);
  const name = String(entity.name || entity.canonicalName || entity.label || "").trim();
  const type = String(entity.type || entity.entityType || "").trim();
  const status = String(entity.status || "").trim();
  const aliases = Array.isArray(entity.aliases) ? entity.aliases.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 5) : [];
  const factsRaw = Array.isArray(entity.facts) ? entity.facts : Array.isArray(entity.memoryFacts) ? entity.memoryFacts : Array.isArray(entity.factList) ? entity.factList : [];
  const facts = factsRaw.map((x) => cleanRoleplayText(typeof x === "string" ? x : x?.content || x?.fact || x?.text || "")).filter(Boolean).slice(0, 8);
  const description = cleanRoleplayText(entity.summary || entity.description || entity.context || "");
  const valence = entity.emotionalValence && typeof entity.emotionalValence === "object" ? Object.entries(entity.emotionalValence).filter(([, v]) => Number(v) !== 0).slice(0, 6).map(([k, v]) => `${k}=${Number(v).toFixed(2)}`).join(", ") : "";
  const header = [name || "(unnamed entity)", type ? `[${type}]` : "", status ? `status=${status}` : ""].filter(Boolean).join(" ");
  const parts = [header];
  if (aliases.length)
    parts.push(`Aliases: ${aliases.join(", ")}`);
  if (description)
    parts.push(`Context: ${compactText(description, 900)}`);
  if (facts.length)
    parts.push(`Facts: ${facts.join("; ")}`);
  if (valence)
    parts.push(`Emotional context: ${valence}`);
  return compactText(parts.filter(Boolean).join(`
`), 2200);
}
function formatCortexRelationship(rel) {
  if (!rel)
    return "";
  if (typeof rel === "string")
    return compactText(cleanRoleplayText(rel), 1400);
  const source = String(rel.sourceName || rel.source?.name || rel.source || rel.fromName || rel.from || "").trim();
  const target = String(rel.targetName || rel.target?.name || rel.target || rel.toName || rel.to || "").trim();
  const type = String(rel.type || rel.relationType || "").trim();
  const label = cleanRoleplayText(rel.label || rel.description || rel.context || "");
  const sentiment = Number(rel.sentiment);
  const bits = [];
  if (source || target)
    bits.push(`${source || "?"} -> ${target || "?"}`);
  if (type)
    bits.push(`type=${type}`);
  if (label)
    bits.push(label);
  if (Number.isFinite(sentiment))
    bits.push(`sentiment=${sentiment.toFixed(2)}`);
  if (bits.length)
    return compactText(bits.join(" | "), 1600);
  return compactJson(rel, 1600);
}
function formatCortexArc(arc) {
  if (!arc)
    return "";
  if (typeof arc === "string")
    return compactText(cleanRoleplayText(arc), 2600);
  const title = cleanRoleplayText(arc.title || arc.name || arc.label || "");
  const body = cleanRoleplayText(arc.summary || arc.content || arc.description || arc.text || "");
  if (title || body)
    return compactText([title, body].filter(Boolean).join(`
`), 3200);
  return compactJson(arc, 3200);
}
function buildCortexQueryText(sceneMessages, persona) {
  const recentMessages = (sceneMessages || []).slice(-8);
  const recent = recentMessages.map((m, index) => {
    const role = m?.role === "user" ? "PLAYER" : "STORY";
    const cleaned = cleanRoleplayText(m?.content);
    const isNewest = index === recentMessages.length - 1;
    const body = isNewest ? compactTextPreserveEnds(cleaned, 2000, 0.76) : compactTextPreserveEnds(cleaned, 1200, 0.58);
    return `${role}: ${body}`;
  }).filter(Boolean).join(`

`);
  const personaName = String(persona?.name || "").trim();
  return compactTextPreserveEnds(`Retrieve earlier story facts, promises, secrets, injuries, decisions, relationship changes, known information, unresolved threads, and prior events relevant to choosing what ${personaName || "the player persona"} would plausibly do next. Prefer established continuity over generic similarity. The END of the newest story reply defines the current physical state.

CURRENT SCENE:
${recent}`, 1e4, 0.7);
}
async function retrieveChatMemoryFallback(chatId, userId, allMessages, oocMessageIds, recentSceneStartIndex) {
  if (!spindle.permissions.has("chats"))
    return emptyStoryMemoryContext("Chat-memory fallback permission unavailable.");
  try {
    const requested = Math.min(24, config.storyMemoryChunks + 4);
    const result = await spindle.chats.getMemories(chatId, { topK: requested, userId });
    if (!result?.enabled || !Array.isArray(result?.chunks) || !result.chunks.length) {
      spindle.log.info(`Persona Paths chat-memory fallback unavailable for ${chatId}: enabled=${!!result?.enabled}, available=${Number(result?.chunksAvailable || 0)}, pending=${Number(result?.chunksPending || 0)}`);
      return emptyStoryMemoryContext("No vectorized chat-memory chunks were available.");
    }
    const oocIndexes = new Set;
    for (let i = 0;i < allMessages.length; i += 1) {
      if (oocMessageIds.has(String(allMessages[i]?.id || "")))
        oocIndexes.add(i);
    }
    const seen = new Set;
    const memories = [];
    for (const chunk of result.chunks) {
      if (memories.length >= config.storyMemoryChunks)
        break;
      const range = memoryChunkRange(chunk);
      if (recentSceneStartIndex >= 0 && range.end != null && range.end >= recentSceneStartIndex)
        continue;
      if (config.skipOoc && chunkOverlapsIndexSet(chunk, oocIndexes))
        continue;
      const cleaned = cleanRoleplayText(chunk?.content);
      if (!cleaned || config.skipOoc && containsOocMarkerAnywhere(cleaned))
        continue;
      const normalized = normalizedMemoryText(cleaned);
      if (!normalized || seen.has(normalized))
        continue;
      seen.add(normalized);
      memories.push(compactText(cleaned, 4200));
    }
    spindle.log.info(`Persona Paths chat-memory fallback for ${chatId}: using ${memories.length}/${result.count || result.chunks.length} retrieved chunks.`);
    return {
      source: "chat_memory",
      memories,
      entities: [],
      relationships: [],
      arc: "",
      note: "Memory Cortex was unavailable; using Lumiverse chat-memory fallback."
    };
  } catch (err) {
    spindle.log.warn(`Persona Paths chat-memory fallback failed for ${chatId}: ${err?.message || String(err)}`);
    return emptyStoryMemoryContext("Memory Cortex and chat-memory fallback were unavailable.");
  }
}
async function retrieveStoryMemoryContext(chatId, userId, allMessages, oocMessageIds, recentSceneStartIndex, sceneMessages, persona) {
  if (!config.longTermStoryMemory)
    return emptyStoryMemoryContext("Story-memory context is disabled in Persona Paths.");
  if (!spindle.permissions.has("memories")) {
    spindle.log.warn(`Persona Paths Memory Cortex permission is not granted for ${chatId}; trying chat-memory fallback.`);
    return retrieveChatMemoryFallback(chatId, userId, allMessages, oocMessageIds, recentSceneStartIndex);
  }
  try {
    const requested = Math.min(24, config.storyMemoryChunks + 4);
    const queryText = buildCortexQueryText(sceneMessages, persona);
    const result = await spindle.memories.cortex.query({
      chatId,
      queryText,
      topK: requested,
      includeConsolidations: true,
      includeRelationships: true,
      userId
    });
    const recentNormalized = normalizedMemoryText((sceneMessages || []).map((m) => cleanRoleplayText(m?.content)).join(`
`));
    const seen = new Set;
    const memories = [];
    for (const memory of Array.isArray(result?.memories) ? result.memories : []) {
      if (memories.length >= config.storyMemoryChunks)
        break;
      const cleaned = cleanRoleplayText(memory?.content ?? memory?.text ?? memory);
      if (!cleaned || config.skipOoc && containsOocMarkerAnywhere(cleaned))
        continue;
      const normalized = normalizedMemoryText(cleaned);
      if (!normalized || seen.has(normalized))
        continue;
      const sample = normalized.slice(0, Math.min(220, normalized.length));
      if (sample.length >= 80 && recentNormalized.includes(sample))
        continue;
      seen.add(normalized);
      memories.push(compactText(cleaned, 4200));
    }
    let rawEntities = Array.isArray(result?.entityContext) ? result.entityContext : [];
    if (!rawEntities.length) {
      try {
        const listed = await spindle.memories.entities.list(chatId, { activeOnly: true, limit: 12, userId });
        rawEntities = Array.isArray(listed) ? listed : [];
      } catch (err) {
        spindle.log.warn(`Persona Paths Cortex entity fallback failed for ${chatId}: ${err?.message || String(err)}`);
      }
    }
    const enrichedEntities = await Promise.all(rawEntities.slice(0, 12).map(async (entity) => {
      const hasFacts = Array.isArray(entity?.facts) && entity.facts.length;
      const entityId = String(entity?.id || entity?.entityId || "");
      if (hasFacts || !entityId)
        return entity;
      try {
        const facts = await spindle.memories.entities.getFacts(entityId, userId);
        return Array.isArray(facts) && facts.length ? { ...entity, facts } : entity;
      } catch {
        return entity;
      }
    }));
    const entities = enrichedEntities.map(formatCortexEntity).filter(Boolean).slice(0, 12);
    let relationships = [];
    const directRelationships = result?.relationshipContext ?? result?.relationships ?? result?.relations;
    if (Array.isArray(directRelationships)) {
      relationships = directRelationships.map(formatCortexRelationship).filter(Boolean).slice(0, 12);
    }
    if (!relationships.length) {
      const ids = rawEntities.map((entity) => String(entity?.id || entity?.entityId || "")).filter(Boolean).slice(0, 10);
      if (ids.length) {
        try {
          const rels = await spindle.memories.relations.forEntities(chatId, ids, { limit: 12, userId });
          relationships = (Array.isArray(rels) ? rels : []).map(formatCortexRelationship).filter(Boolean).slice(0, 12);
        } catch (err) {
          spindle.log.warn(`Persona Paths Cortex relationship fallback failed for ${chatId}: ${err?.message || String(err)}`);
        }
      }
    }
    let arc = formatCortexArc(result?.arcContext);
    if (!arc) {
      try {
        arc = formatCortexArc(await spindle.memories.consolidations.latestArc(chatId, userId));
      } catch (err) {
        spindle.log.warn(`Persona Paths Cortex arc fallback failed for ${chatId}: ${err?.message || String(err)}`);
      }
    }
    if (!memories.length && !entities.length && !relationships.length && !arc) {
      spindle.log.info(`Persona Paths Memory Cortex returned no usable context for ${chatId}; trying chat-memory fallback.`);
      return retrieveChatMemoryFallback(chatId, userId, allMessages, oocMessageIds, recentSceneStartIndex);
    }
    spindle.log.info(`Persona Paths Memory Cortex for ${chatId}: ${memories.length} memories, ${entities.length} entities, ${relationships.length} relationships, arc=${arc ? "yes" : "no"}.`);
    return {
      source: "cortex",
      memories,
      entities,
      relationships,
      arc,
      note: "Read-only context retrieved from Lumiverse Memory Cortex."
    };
  } catch (err) {
    spindle.log.warn(`Persona Paths Memory Cortex lookup failed for ${chatId}; trying chat-memory fallback: ${err?.message || String(err)}`);
    return retrieveChatMemoryFallback(chatId, userId, allMessages, oocMessageIds, recentSceneStartIndex);
  }
}
function buildSystemPrompt(cfg) {
  const requestedPov = cfg.pov === "auto" ? "Infer POV only from the player's recent USER turns. If ambiguous, use first person." : `Use ${cfg.pov} person.`;
  const requestedTense = cfg.tense === "auto" ? "Infer tense only from the player's recent USER turns. If ambiguous, use present tense." : `Use ${cfg.tense} tense.`;
  return `You are Persona Paths, a private role-play next-move generator. Your output is NEVER shown to the story-writing model unless the human player manually chooses and sends one option.

Your task: produce exactly ${cfg.choiceCount} distinct, paste-ready candidate USER turns for the player's persona after the latest assistant/story reply.

CORE CHARACTERIZATION RULES
- Role-play the PLAYER PERSONA faithfully. Do not optimize for politeness, niceness, cooperation, safety, or generic social desirability unless those traits are actually appropriate here.
- Personality is contextual, not a bag of averaged adjectives. A brash person can be gentle with one lover, hostile to strangers, deferential to one mentor, playful with a friend, and vicious with an enemy without becoming a generic middle-ground personality.
- Do NOT average contradictory traits into a bland compromise.
- Characterization priority: (1) current scene and current emotional state, (2) demonstrated behavior toward the person currently involved, (3) established relationship with that person, including relevant Memory Cortex history, (4) the player's recent demonstrated portrayal, (5) persona description, (6) generic assumptions.
- A relationship can change HOW a trait is expressed without deleting the underlying trait.
- Recent behavior can override stale relationship notes. Treat private relationship memory as a hint, never an authority.
- Memory Cortex context is continuity evidence: use it to remember established facts, promises, secrets, prior decisions, injuries, locations, relationship changes, entity facts, active narrative arcs, and unresolved plot threads. Never let an older retrieved memory override a clearly newer event in the CURRENT ROLE-PLAY SCENE.
- If Memory Cortex or fallback history conflicts with the current scene, trust the current scene. Treat retrieved memories, entities, relations, and arc summaries as evidence that may lag behind the newest turn.

CURRENT-MOMENT ANCHOR
- The LATEST ASSISTANT REPLY is chronological. Events and physical changes near its END supersede earlier setup within that same reply.
- Before writing choices, silently identify the player's FINAL location, body position, restraints/contact, held items, injuries, and ongoing action at the very end of the latest assistant reply.
- Every choice must begin from that final state unless the choice's first explicit action changes it. Never reset the persona to an earlier beat merely because it appeared near the beginning of the assistant reply.
- Example: if the assistant reply begins with the persona entering a room but ends with them being pushed into a chair, the choices begin with the persona IN THE CHAIR. A choice may then stand up, leave, struggle, stay seated, etc.; it may not act as though they are still at the doorway.
- The dedicated CURRENT MOMENT block at the end of the user prompt has the highest continuity priority. Memory is background; the final beat is NOW.

CHOICE QUALITY RULES
- These are meaningful courses of action, not four alternate quips.
- Every choice must contain a concrete non-dialogue action, physical decision, deliberate stillness, change of objective, or other story-moving behavior. Dialogue is optional and should support the choice rather than BE the entire choice.
- Consider movement, leaving the scene, travel, investigation, preparation, physical interaction, escalation, retreat, concealment, waiting, observation, helping, refusing, changing objectives, interacting with the environment, or intentionally doing nothing when those are plausible.
- The choices must differ in TRAJECTORY, not merely wording, tone, or punchline.
- Each choice title is a SCAN LABEL, not a miniature summary of the first action. Make it 2\u20134 words whenever possible and describe the option's emotional/strategic direction, intent, or likely immediate trajectory at a glance. Include emotional stance when it materially distinguishes the option (for example: "Angry pushback", "Protective regroup", "Playful deflection", "Quiet withdrawal", "Commit to leaving", "Investigate carefully").
- Do NOT use generic action-only titles such as "Move to the couch", "Ask a question", "Raid the fridge", or "Talk to Sovi" when a more informative intent label is possible. The player should be able to skip obviously wrong emotional directions by reading titles alone.
- For every choice, return an integer "intensity" from 1 to 3 describing the option's immediate commitment/volatility, NOT morality and NOT chance of success: 1 = quiet/low-impact/easy to reverse, 2 = decisive/meaningful commitment, 3 = volatile/high-impact/hard to walk back. Do not force an even spread; rate what the option actually does.
- EXACTLY ONE choice must be the SCENE ADVANCER. Mark only that choice with "advances_scene": true; all other choices must use false.
- The Scene Advancer must commit the persona to a meaningful next beat that materially changes the situation instead of merely continuing the current conversational/emotional loop. Examples include leaving or entering a place, beginning travel, starting or abandoning a task, initiating an investigation, making a decisive physical move, acting on a plan, changing the immediate objective, or otherwise creating a new state for the story model to respond to.
- "Advance the scene" does NOT mean "be reckless", "escalate", or "invent a twist". It must remain plausible for this persona and moment, and it must still obey the authorship boundary below. A quiet departure, going to sleep, beginning preparations, or setting off down a trail can advance the scene when appropriate.
- The Scene Advancer may initiate an action but must not decide its external result. Example: GOOD: "I shoulder my pack and start down the trail." BAD: "I shoulder my pack, reach town by dawn, and find the missing merchant."
- The remaining choices should stay organic and persona-faithful; do not force them into fixed categories. If the scene strongly favors several similar emotional responses, keep them plausible while making their actual objectives/actions meaningfully different.
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
- Do NOT emit HTML, <font> tags, BBCode color tags, CSS, or Prism color markup. Persona Paths handles presentation separately.
- Spoken dialogue MUST use double quotation marks, preferably typographic \u201C \u201D. Never use single quotation marks \u2018 \u2019 as dialogue delimiters; Prism does not treat them as persona dialogue. Apostrophes inside words are fine.
- Inner thoughts are OPTIONAL and should be used sparingly. Most choices should contain no direct inner thought. Across a normal set of choices, prefer zero or one choices with direct inner thought unless the scene is unusually introspective.
- Include a direct inner thought only when it adds meaningful subtext, conflict, hesitation, desire, or information that action/dialogue cannot convey as well. Do not use thoughts merely to explain an action that is already obvious.
- When a direct inner thought is used, format it as Markdown italics with single asterisks, for example: *This is a terrible idea.* Never put inner thoughts in quotation marks.
- ADULT CONTENT: ${adultContentInstruction(cfg.adultContent)}
- The choice text must be ready to paste directly into the user's composer. Do not put labels or explanations inside the pasted text.

CURRENT-STATE METADATA
- Return a tiny scene_state object describing where the PLAYER PERSONA physically is at the END of the latest assistant reply and the immediate beat they are in.
- scene_state.location should be a 2\u20136 word physical anchor such as "Living room couch", "Passenger seat", "Forest trail", or "Kitchen doorway". It must reflect the FINAL state, not an earlier location from the same reply.
- scene_state.moment should be a 2\u20138 word immediate beat/status such as "Pinned in the chair", "Hannah awaiting an answer", "Microwave running", or "Argument just broke". Keep it observable/grounded and do not invent an outcome.
- This metadata is for the human's UI sanity check. If you cannot reconcile it with CURRENT MOMENT, trust CURRENT MOMENT.

PRIVATE RELATIONSHIP NOTES
- Return concise, observable updates for relationships that matter in the current scene. Do not invent a named relationship if the transcript does not support one.
- Use one entry per person/relationship. Preserve nuance: for example, a persona may be soft with Elena while remaining brash with everyone else.
- These updates are extension-private. Do not write analysis, chain-of-thought, or hidden reasoning.

OUTPUT
Return JSON only, with this exact shape:
{
  "style": { "pov": "first|second|third", "tense": "present|past" },
  "scene_state": { "location": "Living room couch", "moment": "Hannah awaiting an answer" },
  "relationship_updates": [
    { "subject": "Elena", "notes": ["unusually patient", "protective", "still blunt and teasing"] }
  ],
  "choices": [
    { "intent": "short unique trajectory", "title": "2\u20134 word emotional/strategic scan label", "text": "paste-ready user turn", "intensity": 2, "advances_scene": false }
  ]
}
No markdown. No commentary.`;
}
function buildUserPrompt(args) {
  const { persona, personaOverride, memoryNotes, recentUserTurns, sceneMessages, storyMemory, globalInstructions, regenerationGuidance = "", rejectedChoices = [] } = args;
  const personaBlock = persona ? `NAME: ${persona.name || "Unnamed"}
TITLE: ${persona.title || ""}
DESCRIPTION:
${compactText(persona.description || "(none)", 6000)}` : "No active persona card is available. Infer the player character only from USER turns.";
  const userExamples = recentUserTurns.length ? recentUserTurns.map((m, i) => `USER EXAMPLE ${i + 1}:
${compactText(cleanRoleplayText(m.content), 2600)}`).join(`

`) : "(none)";
  const newestIndex = sceneMessages.length - 1;
  const scene = sceneMessages.map((m, i) => {
    const cleaned = cleanRoleplayText(m.content);
    const isNewestAssistant = i === newestIndex && m.role === "assistant";
    const body = isNewestAssistant ? compactTextPreserveEnds(cleaned, 9000, 0.74) : compactTextPreserveEnds(cleaned, 3600, 0.58);
    return `${m.role === "user" ? "USER" : "ASSISTANT"}:
${body}`;
  }).join(`

`);
  const latestAssistant = [...sceneMessages].reverse().find((m) => m?.role === "assistant");
  const currentMoment = latestAssistant ? compactTailText(cleanRoleplayText(latestAssistant.content), 5200) : "(No assistant reply was available.)";
  const guidance = String(regenerationGuidance || "").trim();
  const rejectedBlock = rejectedChoices.length ? rejectedChoices.slice(0, 8).map((choice, i) => `REJECTED PATH ${i + 1} \u2014 ${choice.title || choice.intent || "Untitled"}:
${compactText(cleanRoleplayText(choice.text), 1800)}`).join(`

`) : "(none)";
  const regenerationBlock = guidance ? `

GUIDED REGENERATION REQUEST FROM THE HUMAN
${guidance}

PREVIOUS PATHS THE HUMAN REJECTED
${rejectedBlock}

Use the guidance as a directional preference, correction, or possibility \u2014 not as a requirement that every new option perform the exact same action. Produce genuinely new trajectories rather than paraphrasing the rejected paths. If the guidance corrects characterization, naming, relationship behavior, or voice, obey that correction throughout all choices.` : "";
  return `PLAYER PERSONA
${personaBlock}

PERSONA-SPECIFIC GUIDANCE FROM THE HUMAN
${personaOverride.trim() || "(none)"}

GLOBAL EXTENSION GUIDANCE FROM THE HUMAN
${globalInstructions.trim() || "(none)"}

PRIVATE RELATIONSHIP MEMORY FROM PRIOR CYOA PASSES
${memoryNotes.length ? memoryNotes.map((x) => `- ${x}`).join(`
`) : "(none yet)"}

LUMIVERSE STORY MEMORY SOURCE
${storyMemory.source === "cortex" ? "Memory Cortex (preferred)" : storyMemory.source === "chat_memory" ? "Long-term chat-memory fallback" : "None available"}${storyMemory.note ? `
${storyMemory.note}` : ""}

MEMORY CORTEX / EARLIER STORY EVENTS
${storyMemory.memories.length ? storyMemory.memories.map((x, i) => `MEMORY ${i + 1}:
${x}`).join(`

`) : "(none retrieved)"}

MEMORY CORTEX ENTITY CONTEXT
${storyMemory.entities.length ? storyMemory.entities.map((x, i) => `ENTITY ${i + 1}:
${x}`).join(`

`) : "(none retrieved)"}

MEMORY CORTEX RELATIONSHIP CONTEXT
${storyMemory.relationships.length ? storyMemory.relationships.map((x, i) => `RELATIONSHIP ${i + 1}:
${x}`).join(`

`) : "(none retrieved)"}

MEMORY CORTEX ACTIVE NARRATIVE ARC
${storyMemory.arc || "(none retrieved)"}
Use all memory material for continuity only. It may be incomplete or stale. The CURRENT ROLE-PLAY SCENE below is authoritative when anything conflicts.

RECENT EXAMPLES OF HOW THE HUMAN ACTUALLY PLAYS THIS PERSONA
${userExamples}

CURRENT ROLE-PLAY SCENE
${scene}${regenerationBlock}

CURRENT MOMENT \u2014 END OF THE LATEST ASSISTANT REPLY (HIGHEST PRIORITY)
${currentMoment}

Start every candidate from the physical and situational state that exists at the END of that block. Later events inside the latest reply supersede earlier ones. Do not continue from an earlier location, posture, action, or conversational beat unless the choice explicitly moves back there.

Generate the next-move choices for the USER now. CURRENT MOMENT outranks the broader scene; the broader scene outranks retrieved memory.`;
}
async function resolveConnection(cfg, userId) {
  if (!spindle.permissions.has("generation")) {
    throw new Error("Generation permission is not granted. Enable it for Persona Paths in Lumiverse Extensions.");
  }
  const connections = await spindle.connections.list(userId);
  if (!Array.isArray(connections) || !connections.length)
    throw new Error("No Lumiverse LLM connection profiles are available.");
  let conn = cfg.connectionId ? connections.find((c) => c.id === cfg.connectionId) : null;
  if (!conn)
    conn = connections.find((c) => c.is_default) || connections[0];
  return { conn, connections };
}
function getKimiTraits(provider, model) {
  const p = String(provider || "").toLowerCase();
  const m = String(model || "").toLowerCase();
  const isKimi = p.includes("moonshot") || m.startsWith("kimi-");
  const isK3 = isKimi && m.includes("kimi-k3");
  const isK27 = isKimi && m.includes("kimi-k2.7-code");
  const isK26 = isKimi && m.includes("kimi-k2.6");
  const isK25 = isKimi && m.includes("kimi-k2.5");
  return { isKimi, isK3, isK27, isK26, isK25, alwaysThinking: isK3 || isK27 };
}
function buildGenerationTuning(conn, model, cfg, repair = false) {
  const traits = getKimiTraits(conn?.provider, model);
  const params = {};
  let reasoning = undefined;
  let effectiveMaxTokens = cfg.maxTokens;
  if (traits.isKimi) {
    if (!cfg.useReasoning) {
      if (traits.isK3) {
        params.reasoning_effort = "low";
        reasoning = { source: "custom", apiReasoning: true, effort: "low" };
        effectiveMaxTokens = Math.max(effectiveMaxTokens, 16000);
      } else if (traits.isK27) {
        reasoning = { source: "custom", apiReasoning: true, effort: "low" };
        effectiveMaxTokens = Math.max(effectiveMaxTokens, 16000);
      } else {
        reasoning = { source: "off" };
      }
    } else {
      reasoning = { source: "inherit" };
      effectiveMaxTokens = Math.max(effectiveMaxTokens, 16000);
    }
  } else {
    params.temperature = cfg.temperature;
    if (!cfg.useReasoning)
      reasoning = { source: "off" };
  }
  if (repair && effectiveMaxTokens > 0) {
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
    globalInstructions: config.globalInstructions
  });
  const model = config.modelOverride.trim() || conn.model;
  const tuning = buildGenerationTuning(conn, model, config, false);
  const request = {
    provider: conn.provider,
    model,
    connection_id: conn.id,
    userId,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    parameters: tuning.params
  };
  if (tuning.reasoning)
    request.reasoning = tuning.reasoning;
  if (tuning.traits.isKimi) {
    spindle.log.info(`Persona Paths Kimi tuning: model=${model}, max_tokens=${tuning.effectiveMaxTokens}, reasoning=${config.useReasoning ? "connection" : tuning.traits.alwaysThinking ? "low/always-on" : "off"}`);
  }
  let response = await spindle.generate.raw(request);
  let responseText = String(response?.content || "").trim();
  let parsed;
  try {
    parsed = parseJsonObject(responseText);
  } catch (err) {
    parsed = null;
  }
  if (parsed && Array.isArray(parsed.choices)) {
    parsed.choices = parsed.choices.map((choice) => ({
      ...choice,
      text: cleanGeneratedChoiceText(choice?.text),
      intensity: Number(choice?.intensity),
      advances_scene: choice?.advances_scene === true
    }));
  }
  let issues = validateResult(parsed, config.choiceCount, config.detail);
  if (issues.length) {
    const priorForRepair = responseText ? compactText(responseText, 12000) : "(The previous attempt returned no usable final content.)";
    const repairUser = `${user}

REPAIR PASS
The previous attempt did not satisfy the required JSON contract. Problems detected: ${issues.join("; ")}.

PREVIOUS OUTPUT (reference only; it may be empty, malformed, or truncated):
${priorForRepair}

Generate the answer again from scratch. Return one corrected JSON object only. Preserve strong persona fidelity, concrete action, distinct trajectories, the selected POV/tense, and the authorship boundary. Do not mention this repair pass.`;
    const repairTuning = buildGenerationTuning(conn, model, config, response?.finish_reason === "length");
    const repairRequest = {
      ...request,
      parameters: repairTuning.params,
      messages: [
        { role: "system", content: system },
        { role: "user", content: repairUser }
      ]
    };
    if (repairTuning.reasoning)
      repairRequest.reasoning = repairTuning.reasoning;
    else
      delete repairRequest.reasoning;
    response = await spindle.generate.raw(repairRequest);
    responseText = String(response?.content || "").trim();
    if (!responseText) {
      throw new Error(`CYOA provider returned empty content twice${response?.finish_reason ? ` (finish reason: ${response.finish_reason})` : ""}. Persona Paths already expanded the retry budget; if this is an always-thinking model, try another model or enable a larger manual Max output token budget.`);
    }
    try {
      parsed = parseJsonObject(responseText);
    } catch (err) {
      throw new Error(`CYOA repair response was not valid JSON${response?.finish_reason ? ` (finish reason: ${response.finish_reason})` : ""}.`);
    }
    if (parsed && Array.isArray(parsed.choices)) {
      parsed.choices = parsed.choices.map((choice) => ({
        ...choice,
        text: cleanGeneratedChoiceText(choice?.text),
        advances_scene: choice?.advances_scene === true
      }));
    }
    issues = validateResult(parsed, config.choiceCount, config.detail);
  }
  if (issues.length)
    throw new Error(`CYOA output failed validation after repair: ${issues.join("; ")}`);
  parsed.choices = parsed.choices.map((choice) => ({
    intent: String(choice.intent || "").trim(),
    title: String(choice.title || "").trim(),
    text: cleanGeneratedChoiceText(choice.text),
    intensity: Math.max(1, Math.min(3, Math.round(Number(choice?.intensity) || 2))),
    advances_scene: choice?.advances_scene === true
  }));
  parsed.scene_state = {
    location: String(parsed.scene_state?.location || "").trim(),
    moment: String(parsed.scene_state?.moment || "").trim()
  };
  parsed.relationship_updates = Array.isArray(parsed.relationship_updates) ? parsed.relationship_updates.map((item) => ({
    subject: String(item?.subject || "").trim(),
    notes: Array.isArray(item?.notes) ? item.notes.map((x) => String(x).trim()).filter(Boolean).slice(0, 6) : []
  })).filter((item) => item.subject && item.notes.length).slice(0, 4) : [];
  parsed.style = {
    pov: ["first", "second", "third"].includes(String(parsed.style?.pov)) ? String(parsed.style?.pov) : config.pov === "auto" ? "first" : config.pov,
    tense: ["present", "past"].includes(String(parsed.style?.tense)) ? String(parsed.style?.tense) : config.tense === "auto" ? "present" : config.tense
  };
  return parsed;
}
function buildDraftRewriteSystemPrompt(cfg) {
  const requestedPov = cfg.pov === "auto" ? "Preserve the POV/person used in the DRAFT. If the draft is ambiguous, infer it from recent USER turns." : `Keep the rewritten draft in ${cfg.pov} person unless the human deliberately wrote otherwise.`;
  const requestedTense = cfg.tense === "auto" ? "Preserve the tense used in the DRAFT. If ambiguous, infer it from recent USER turns." : `Keep the rewritten draft in ${cfg.tense} tense unless the human deliberately wrote otherwise.`;
  return `You are Persona Paths Draft Polish. Rewrite a HUMAN PLAYER'S partially edited role-play response into one smooth, paste-ready USER turn.

The human may have selected one or more Persona Paths suggestions, manually changed them, added new ideas, or written the whole draft themselves. Their draft is the authority for WHAT they intend to do.

PRESERVATION RULES
- Preserve every meaningful decision, action, intention, factual assertion, named person, destination, refusal, promise, emotional choice, and user-added idea in the draft unless it is an obvious duplicate caused by concatenating Paths.
- Smooth transitions, remove accidental repetition, reconcile pronouns, and make combined fragments read like one naturally authored turn.
- Do NOT replace the human's idea with a different or "better" choice. This is rewriting, not next-move generation.
- Do NOT make the persona nicer, safer, calmer, more polite, more cautious, or more generic than the draft/persona establishes.
- Do NOT invent other characters' dialogue, reactions, thoughts, decisions, consent, or future behavior.
- Do NOT invent world outcomes, discoveries, success/failure, or time skips that the human did not write.
- If the draft deliberately contains multiple sequential actions, preserve their order unless a tiny reorder is necessary for grammar/continuity and does not change intent.

CONTINUITY
- The END of the latest assistant reply defines the starting physical state. If that reply moves the persona from a doorway into a chair, the polished draft must begin from the chair unless the human's draft explicitly has them stand/move.
- Memory Cortex is background continuity only. Current scene and the human's draft outrank memory.

VOICE & FORMATTING
- Match the persona's established voice and the human's recent portrayal.
- ${requestedPov}
- ${requestedTense}
- Spoken dialogue must use \u201Cdouble curly quotation marks\u201D (or straight double quotes if already present), never \u2018single curly dialogue quotes\u2019.
- Direct inner thoughts are optional and rare; format them as *single-asterisk italics*, never quotation marks.
- Preserve the draft's established explicitness rather than sanitizing or gratuitously escalating it.
- Return ONLY the rewritten USER turn as plain Markdown text. No JSON, title, label, explanation, critique, notes, or quotation fence.`;
}
function buildDraftRewritePrompt(args) {
  const personaBlock = args.persona ? `NAME: ${args.persona.name || "Unnamed"}
TITLE: ${args.persona.title || ""}
DESCRIPTION:
${compactText(args.persona.description || "(none)", 6000)}` : "No active persona card is available. Infer the player persona from recent USER turns.";
  const examples = args.recentUserTurns.length ? args.recentUserTurns.map((m, i) => `USER EXAMPLE ${i + 1}:
${compactTextPreserveEnds(cleanRoleplayText(m.content), 2200, 0.58)}`).join(`

`) : "(none)";
  const newestIndex = args.sceneMessages.length - 1;
  const scene = args.sceneMessages.map((m, i) => {
    const cleaned = cleanRoleplayText(m.content);
    const isNewestAssistant = i === newestIndex && m.role === "assistant";
    return `${m.role === "user" ? "USER" : "ASSISTANT"}:
${isNewestAssistant ? compactTextPreserveEnds(cleaned, 7600, 0.76) : compactTextPreserveEnds(cleaned, 2600, 0.58)}`;
  }).join(`

`);
  const latestAssistant = [...args.sceneMessages].reverse().find((m) => m?.role === "assistant");
  const currentMoment = latestAssistant ? compactTailText(cleanRoleplayText(latestAssistant.content), 5000) : "(none)";
  const memory = [
    args.storyMemory.arc ? `ACTIVE ARC:
${args.storyMemory.arc}` : "",
    args.storyMemory.memories.length ? `RELEVANT HISTORY:
${args.storyMemory.memories.slice(0, 5).map((x, i) => `${i + 1}. ${x}`).join(`
`)}` : "",
    args.storyMemory.relationships.length ? `RELATIONSHIPS:
${args.storyMemory.relationships.slice(0, 6).join(`
`)}` : ""
  ].filter(Boolean).join(`

`) || "(none retrieved)";
  return `PLAYER PERSONA
${personaBlock}

PERSONA-SPECIFIC GUIDANCE
${String(args.personaOverride || "").trim() || "(none)"}

PRIVATE RELATIONSHIP NOTES
${args.memoryNotes.length ? args.memoryNotes.map((x) => `- ${x}`).join(`
`) : "(none)"}

RELEVANT MEMORY CORTEX CONTINUITY
${memory}

RECENT EXAMPLES OF THE HUMAN'S VOICE
${examples}

CURRENT ROLE-PLAY SCENE
${scene}

CURRENT MOMENT \u2014 END OF LATEST ASSISTANT REPLY
${currentMoment}

DRAFT TO POLISH \u2014 PRESERVE ITS INTENT AND CONTENT
${String(args.draft || "").trim()}

Rewrite that draft into one seamless USER turn. Preserve the human's choices and added ideas; fix prose, flow, duplicated seams, and voice only.`;
}
async function handleDraftRewrite(chatId, messageId, draft, userId) {
  const cleanDraft = cleanGeneratedChoiceText(draft);
  if (!cleanDraft)
    throw new Error("Write or select something in the composer before using Polish Draft.");
  if (!chatId || !messageId)
    throw new Error("Persona Paths needs the current chat and assistant reply to polish this draft.");
  const messages = await spindle.chat.getMessages(chatId);
  const target = messages.find((m) => String(m?.id || "") === messageId);
  if (!target || target.role !== "assistant")
    throw new Error("The assistant reply associated with this Persona Paths card is no longer available.");
  const oocMessageIds = config.skipOoc ? collectOocMessageIds(messages) : new Set;
  const persona = await spindle.personas.getActive(userId);
  const personaId = persona?.id || "no_persona";
  const memoryKey = `${chatId}::${personaId}`;
  const storedMemory = relationshipMemory[memoryKey];
  const memoryNotes = config.relationshipMemory && storedMemory ? Object.entries(storedMemory.subjects || {}).map(([subject, notes]) => `${subject}: ${(notes || []).join("; ")}`).slice(0, 12) : [];
  const storyMessages = messages.filter((m) => (m.role === "user" || m.role === "assistant") && (!config.skipOoc || !oocMessageIds.has(String(m.id || ""))));
  const targetIndex = storyMessages.findIndex((m) => String(m?.id || "") === messageId);
  const throughTarget = targetIndex >= 0 ? storyMessages.slice(0, targetIndex + 1) : storyMessages;
  const sceneMessages = throughTarget.slice(-config.contextMessages);
  const recentUserTurns = throughTarget.filter((m) => m.role === "user").slice(-config.recentUserExamples);
  const firstSceneMessageId = String(sceneMessages[0]?.id || "");
  const recentSceneStartIndex = firstSceneMessageId ? messages.findIndex((m) => String(m?.id || "") === firstSceneMessageId) : -1;
  const storyMemory = await retrieveStoryMemoryContext(chatId, userId, messages, oocMessageIds, recentSceneStartIndex, sceneMessages, persona);
  const { conn } = await resolveConnection(config, userId);
  const model = config.modelOverride.trim() || conn.model;
  const tuning = buildGenerationTuning(conn, model, config, false);
  if (!tuning.traits.isKimi && typeof tuning.params.temperature === "number")
    tuning.params.temperature = Math.min(Number(tuning.params.temperature), 0.6);
  const request = {
    provider: conn.provider,
    model,
    connection_id: conn.id,
    userId,
    messages: [
      { role: "system", content: buildDraftRewriteSystemPrompt(config) },
      { role: "user", content: buildDraftRewritePrompt({
        persona,
        personaOverride: persona?.id ? config.personaOverrides[persona.id] || "" : "",
        memoryNotes,
        recentUserTurns,
        sceneMessages,
        storyMemory,
        draft: cleanDraft
      }) }
    ],
    parameters: tuning.params
  };
  if (tuning.reasoning)
    request.reasoning = tuning.reasoning;
  const response = await spindle.generate.raw(request);
  const raw = String(response?.content || "").trim();
  if (!raw)
    throw new Error(`Draft-polish model returned no final content${response?.finish_reason ? ` (finish reason: ${response.finish_reason})` : ""}.`);
  const rewritten = cleanGeneratedChoiceText(stripFences(raw));
  if (!rewritten)
    throw new Error("Draft-polish model returned an empty rewrite.");
  spindle.sendToFrontend({ type: "draft_rewrite_ready", chatId, messageId, text: rewritten }, userId);
  try {
    spindle.toast.success("Draft polished.");
  } catch {}
}
async function handleAssistantMessage(chatId, messageId, force = false, userId, regenerationGuidance = "", saveAsPersonaGuidance = false, allowOocOverride = false) {
  if (!config.enabled && !force)
    return;
  const key = `${chatId}:${messageId}`;
  if (inFlight.has(key))
    return;
  inFlight.add(key);
  try {
    const messages = await spindle.chat.getMessages(chatId);
    const target = messages.find((m) => m.id === messageId);
    if (!target || target.role !== "assistant")
      return;
    const oocMessageIds = config.skipOoc ? collectOocMessageIds(messages) : new Set;
    const targetIsOoc = config.skipOoc && oocMessageIds.has(messageId);
    if (targetIsOoc && !allowOocOverride) {
      const existingForced = cache[messageId];
      const currentHash = hashText(String(target.content || ""));
      if (existingForced?.oocForced && existingForced.contentHash === currentHash) {
        spindle.sendToFrontend({ type: "choices_ready", data: existingForced }, userId);
        return;
      }
      if (cache[messageId]) {
        delete cache[messageId];
        await saveCache();
      }
      spindle.log.info(`Persona Paths skipped OOC exchange for ${messageId}.`);
      spindle.sendToFrontend({ type: "choices_skipped", chatId, messageId, reason: "ooc" }, userId);
      return;
    }
    const contentHash = hashText(String(target.content || ""));
    const existing = cache[messageId];
    const rejectedChoices = force && String(regenerationGuidance || "").trim() && existing?.choices ? existing.choices.map((choice) => ({ ...choice })) : [];
    if (!force && existing && existing.contentHash === contentHash) {
      spindle.sendToFrontend({ type: "choices_ready", data: existing }, userId);
      return;
    }
    spindle.sendToFrontend({ type: "choices_loading", chatId, messageId }, userId);
    const persona = await spindle.personas.getActive(userId);
    const personaId = persona?.id || "no_persona";
    const cleanGuidance = String(regenerationGuidance || "").trim();
    if (saveAsPersonaGuidance && cleanGuidance) {
      if (!persona?.id)
        throw new Error("An active persona is required to save regeneration guidance.");
      const previous = String(config.personaOverrides[persona.id] || "").trim();
      const duplicate = previous.split(/\n+/).map((line) => line.replace(/^[-\u2022]\s*/, "").trim().toLowerCase()).filter(Boolean).includes(cleanGuidance.toLowerCase());
      if (!duplicate) {
        config.personaOverrides[persona.id] = previous ? `${previous}
${cleanGuidance}` : cleanGuidance;
        await saveConfig();
      }
      spindle.sendToFrontend({
        type: "persona_guidance_saved",
        personaId: persona.id,
        messageId,
        text: config.personaOverrides[persona.id] || ""
      }, userId);
    }
    const personaOverride = persona?.id ? config.personaOverrides[persona.id] || "" : "";
    const memoryKey = `${chatId}::${personaId}`;
    const storedMemory = relationshipMemory[memoryKey];
    const memoryNotes = config.relationshipMemory && storedMemory ? Object.entries(storedMemory.subjects || {}).map(([subject, notes]) => `${subject}: ${(notes || []).join("; ")}`).slice(0, 12) : [];
    const storyMessages = messages.filter((m) => (m.role === "user" || m.role === "assistant") && (!config.skipOoc || !oocMessageIds.has(String(m.id || ""))));
    let throughTarget;
    if (targetIsOoc && allowOocOverride) {
      const originalTargetIndex = messages.findIndex((m) => String(m?.id || "") === messageId);
      const priorNormal = originalTargetIndex >= 0 ? messages.slice(0, originalTargetIndex).filter((m) => (m.role === "user" || m.role === "assistant") && !oocMessageIds.has(String(m.id || ""))) : storyMessages;
      const preceding = originalTargetIndex > 0 ? messages[originalTargetIndex - 1] : null;
      const forcedExchange = preceding && preceding.role === "user" && oocMessageIds.has(String(preceding.id || "")) ? [preceding, target] : [target];
      throughTarget = [...priorNormal, ...forcedExchange];
      spindle.log.info(`Persona Paths manually overriding OOC guard for ${messageId}.`);
    } else {
      const targetIndex = storyMessages.findIndex((m) => m.id === messageId);
      throughTarget = targetIndex >= 0 ? storyMessages.slice(0, targetIndex + 1) : storyMessages;
    }
    const sceneMessages = throughTarget.slice(-config.contextMessages);
    const recentUserTurns = throughTarget.filter((m) => m.role === "user" && (!config.skipOoc || !oocMessageIds.has(String(m.id || "")))).slice(-config.recentUserExamples);
    const memorySceneMessages = sceneMessages.filter((m) => !oocMessageIds.has(String(m.id || "")));
    const firstSceneMessageId = String((memorySceneMessages[0] || sceneMessages[0])?.id || "");
    const recentSceneStartIndex = firstSceneMessageId ? messages.findIndex((m) => String(m?.id || "") === firstSceneMessageId) : -1;
    const storyMemory = await retrieveStoryMemoryContext(chatId, userId, messages, oocMessageIds, recentSceneStartIndex, memorySceneMessages.length ? memorySceneMessages : sceneMessages, persona);
    const prismInfo = await resolvePrismInfo(chatId, userId, persona, throughTarget);
    const result = await generatePaths({
      persona,
      personaOverride,
      memoryNotes,
      recentUserTurns,
      sceneMessages,
      storyMemory,
      regenerationGuidance: cleanGuidance,
      rejectedChoices
    }, userId);
    const entry = {
      chatId,
      messageId,
      contentHash,
      style: result.style,
      sceneState: {
        location: String(result.scene_state?.location || "").trim(),
        moment: String(result.scene_state?.moment || "").trim()
      },
      choices: result.choices,
      prismColor: prismInfo.color || undefined,
      oocForced: targetIsOoc && allowOocOverride ? true : undefined,
      createdAt: Date.now()
    };
    cache[messageId] = entry;
    await saveCache();
    if (config.relationshipMemory && result.relationship_updates?.length && !(targetIsOoc && allowOocOverride)) {
      const previousSubjects = relationshipMemory[memoryKey]?.subjects || {};
      const nextSubjects = { ...previousSubjects };
      for (const update of result.relationship_updates) {
        const existingKey = Object.keys(nextSubjects).find((k) => k.toLowerCase() === update.subject.toLowerCase());
        const keyName = existingKey || update.subject;
        nextSubjects[keyName] = update.notes;
      }
      const trimmedSubjects = Object.fromEntries(Object.entries(nextSubjects).slice(-16));
      relationshipMemory[memoryKey] = {
        subjects: trimmedSubjects,
        updatedAt: Date.now(),
        messageId
      };
      await saveRelationshipMemory();
    }
    spindle.sendToFrontend({ type: "choices_ready", data: entry }, userId);
  } catch (err) {
    const message = err?.message || String(err);
    spindle.log.error(`Persona Paths failed for ${messageId}: ${message}`);
    spindle.sendToFrontend({ type: "choices_error", chatId, messageId, error: message }, userId);
  } finally {
    inFlight.delete(key);
  }
}
async function sendState(userId) {
  const generationGranted = spindle.permissions.has("generation");
  const memoriesGranted = spindle.permissions.has("memories");
  let connections = [];
  let connectionError = "";
  if (!generationGranted) {
    connectionError = "Generation permission is not granted to Persona Paths.";
  } else {
    try {
      const listed = await spindle.connections.list(userId);
      connections = Array.isArray(listed) ? listed : [];
      if (!connections.length)
        connectionError = "Lumiverse returned zero LLM connection profiles for this user.";
    } catch (err) {
      connectionError = err?.message || String(err);
      spindle.log.error(`Persona Paths connection lookup failed: ${connectionError}`);
    }
  }
  let persona = null;
  let personaError = "";
  try {
    persona = await spindle.personas.getActive(userId);
  } catch (err) {
    personaError = err?.message || String(err);
    spindle.log.error(`Persona Paths active persona lookup failed: ${personaError}`);
  }
  let prismInfo = { mode: config.prismIntegration, available: false, color: "", source: "", status: config.prismIntegration === "off" ? "Prism integration is off." : "Open a chat to detect Prism." };
  if (persona && config.prismIntegration === "manual") {
    prismInfo = await resolvePrismInfo("", userId, persona, []);
  } else if (config.prismIntegration === "auto" && persona && spindle.permissions.has("chats")) {
    try {
      const activeChat = await spindle.chats.getActive(userId);
      if (activeChat?.id) {
        const activeMessages = await spindle.chat.getMessages(activeChat.id);
        prismInfo = await resolvePrismInfo(String(activeChat.id), userId, persona, activeMessages);
      }
    } catch (err) {
      prismInfo = { mode: "auto", available: false, color: "", source: "", status: `Prism detection unavailable: ${err?.message || String(err)}` };
    }
  }
  spindle.sendToFrontend({
    type: "state",
    config,
    connections,
    generationGranted,
    memoriesGranted,
    connectionError,
    personaError,
    prismInfo,
    activePersona: persona ? { id: persona.id, name: persona.name, title: persona.title || "" } : null
  }, userId);
}
spindle.onFrontendMessage(async (payload, userId) => {
  try {
    if (!payload || typeof payload !== "object")
      return;
    if (payload.type === "get_state") {
      await sendState(userId);
      return;
    }
    if (payload.type === "save_config") {
      config = normalizeConfig({ ...config, ...payload.patch || {} });
      await saveConfig();
      await sendState(userId);
      return;
    }
    if (payload.type === "set_persona_override") {
      const personaId = String(payload.personaId || "");
      if (personaId) {
        config.personaOverrides[personaId] = String(payload.text || "");
        await saveConfig();
      }
      await sendState(userId);
      return;
    }
    if (payload.type === "set_prism_color_override") {
      const personaId = String(payload.personaId || "");
      if (personaId) {
        const color = normalizeHex(payload.color);
        if (color)
          config.prismColorOverrides[personaId] = color;
        else
          delete config.prismColorOverrides[personaId];
        await saveConfig();
      }
      await sendState(userId);
      return;
    }
    if (payload.type === "load_choices") {
      const ids = Array.isArray(payload.messageIds) ? payload.messageIds.map(String) : [String(payload.messageId || "")];
      const grouped = new Map;
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
        let blocked = new Set;
        if (config.skipOoc) {
          try {
            const messages = await spindle.chat.getMessages(chatId);
            blocked = collectOocMessageIds(messages);
          } catch (err) {
            spindle.log.warn(`Persona Paths could not verify OOC state while restoring cached choices: ${err?.message || String(err)}`);
          }
        }
        for (const id of messageIds) {
          if (config.skipOoc && blocked.has(id) && !cache[id]?.oocForced) {
            delete cache[id];
            cacheChanged = true;
            spindle.sendToFrontend({ type: "choices_skipped", chatId, messageId: id, reason: "ooc" }, userId);
          } else if (cache[id]) {
            spindle.sendToFrontend({ type: "choices_ready", data: cache[id] }, userId);
          }
        }
      }
      if (cacheChanged)
        await saveCache();
      return;
    }
    if (payload.type === "ensure_choices") {
      const chatId = String(payload.chatId || "");
      const messageId = String(payload.messageId || "");
      if (!userId)
        throw new Error("Persona Paths could not resolve the current Lumiverse user for CYOA generation.");
      if (chatId && messageId)
        await handleAssistantMessage(chatId, messageId, false, userId);
      return;
    }
    if (payload.type === "regenerate") {
      const chatId = String(payload.chatId || "");
      const messageId = String(payload.messageId || "");
      if (chatId && messageId)
        await handleAssistantMessage(chatId, messageId, true, userId, "", false, true);
      return;
    }
    if (payload.type === "regenerate_with_guidance") {
      const chatId = String(payload.chatId || "");
      const messageId = String(payload.messageId || "");
      const guidance = String(payload.guidance || "").trim();
      const saveAsPersonaGuidance = !!payload.saveAsPersonaGuidance;
      if (!chatId || !messageId)
        throw new Error("A chat and assistant reply are required for guided regeneration.");
      if (!guidance)
        throw new Error("Enter some guidance before regenerating Persona Paths.");
      await handleAssistantMessage(chatId, messageId, true, userId, guidance, saveAsPersonaGuidance, true);
      return;
    }
    if (payload.type === "rewrite_draft") {
      const chatId = String(payload.chatId || "");
      const messageId = String(payload.messageId || "");
      const draft = String(payload.draft || "");
      const rewriteKey = `${userId || "unknown"}::${chatId}::${messageId}`;
      if (draftRewritesInFlight.has(rewriteKey))
        return;
      draftRewritesInFlight.add(rewriteKey);
      try {
        await handleDraftRewrite(chatId, messageId, draft, userId);
      } catch (err) {
        const message = err?.message || String(err);
        spindle.log.error(`Persona Paths draft rewrite failed: ${message}`);
        try {
          spindle.toast.error(message, { title: "Draft Polish" });
        } catch {}
        spindle.sendToFrontend({ type: "draft_rewrite_error", chatId, messageId, error: message }, userId);
      } finally {
        draftRewritesInFlight.delete(rewriteKey);
      }
      return;
    }
    if (payload.type === "manual_rewrite_latest") {
      const draft = String(payload.draft || "");
      const rewriteKey = `${userId || "unknown"}::manual`;
      if (draftRewritesInFlight.has(rewriteKey))
        return;
      draftRewritesInFlight.add(rewriteKey);
      try {
        if (!draft.trim())
          throw new Error("Write or select something in the composer before using Polish Draft.");
        if (!spindle.permissions.has("chats"))
          throw new Error("The Chats permission is required to resolve the active chat for Draft Polish.");
        const activeChat = await spindle.chats.getActive(userId);
        if (!activeChat?.id)
          throw new Error("Open a Lumiverse chat before using Draft Polish.");
        const messages = await spindle.chat.getMessages(activeChat.id);
        const latestAssistant = [...messages].reverse().find((m) => m?.role === "assistant" && String(m?.content || "").trim());
        if (!latestAssistant?.id)
          throw new Error("The active chat does not have an assistant reply to anchor this draft rewrite.");
        await handleDraftRewrite(String(activeChat.id), String(latestAssistant.id), draft, userId);
      } catch (err) {
        const message = err?.message || String(err);
        spindle.log.error(`Persona Paths manual draft rewrite failed: ${message}`);
        try {
          spindle.toast.error(message, { title: "Draft Polish" });
        } catch {}
        spindle.sendToFrontend({ type: "draft_rewrite_error", error: message }, userId);
      } finally {
        draftRewritesInFlight.delete(rewriteKey);
      }
      return;
    }
    if (payload.type === "manual_generate_latest") {
      if (!userId)
        throw new Error("Persona Paths could not resolve the current Lumiverse user for manual generation.");
      if (!spindle.permissions.has("chats")) {
        throw new Error("The Chats permission is required for manual generation so Persona Paths can resolve the active chat after a refresh.");
      }
      const activeChat = await spindle.chats.getActive(userId);
      if (!activeChat?.id)
        throw new Error("Open a Lumiverse chat before running Persona Paths manually.");
      const messages = await spindle.chat.getMessages(activeChat.id);
      const latestAssistant = [...messages].reverse().find((m) => m?.role === "assistant" && String(m?.content || "").trim().length > 0);
      if (!latestAssistant?.id)
        throw new Error("The active chat does not have an assistant reply to generate paths for yet.");
      const manualOocIds = config.skipOoc ? collectOocMessageIds(messages) : new Set;
      const isOocOverride = config.skipOoc && manualOocIds.has(String(latestAssistant.id));
      spindle.sendToFrontend({
        type: "manual_target",
        chatId: activeChat.id,
        messageId: latestAssistant.id,
        oocOverride: isOocOverride
      }, userId);
      await handleAssistantMessage(activeChat.id, String(latestAssistant.id), true, userId, "", false, true);
      return;
    }
    if (payload.type === "clear_relationship_memory") {
      relationshipMemory = {};
      await saveRelationshipMemory();
      spindle.sendToFrontend({ type: "memory_cleared" }, userId);
      return;
    }
  } catch (err) {
    const error = err?.message || String(err);
    spindle.log.error(`Frontend request failed: ${error}`);
    if (payload?.type === "manual_generate_latest") {
      spindle.sendToFrontend({ type: "manual_error", error }, userId);
    } else {
      spindle.sendToFrontend({ type: "request_error", error }, userId);
    }
  }
});
spindle.permissions.onChanged(({ permission }) => {
  if (permission === "generation") {
    spindle.log.info("Persona Paths generation permission changed; refresh the panel to reload connections.");
  } else if (permission === "memories") {
    spindle.log.info("Persona Paths Memory Cortex permission changed; refresh the panel to update Cortex status.");
  }
});
loadState().then(() => {
  spindle.log.info("Persona Paths loaded \u2014 private CYOA context is isolated from normal prompt assembly.");
}).catch((err) => {
  spindle.log.error(`Persona Paths state load failed: ${err?.message || String(err)}`);
});

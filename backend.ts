declare const spindle: any

type Choice = {
  intent: string
  title: string
  text: string
  intensity?: 1 | 2 | 3
  advances_scene?: boolean
}

type PathResult = {
  style?: { pov?: string; tense?: string }
  scene_state?: { location?: string; moment?: string }
  relationship_updates?: Array<{ subject: string; notes: string[] }>
  choices: Choice[]
}

type StoryMemoryContext = {
  source: 'cortex' | 'chat_memory' | 'none'
  memories: string[]
  entities: string[]
  relationships: string[]
  arc: string
  note?: string
}

type OpenRouterModel = {
  id: string
  name: string
  contextLength: number
  reasoning: boolean
}

type Config = {
  enabled: boolean
  choiceCount: number
  contextMessages: number
  recentUserExamples: number
  pov: 'auto' | 'first' | 'second' | 'third'
  tense: 'auto' | 'present' | 'past'
  detail: 'compact' | 'normal' | 'detailed'
  generationDelaySeconds: number
  skipOoc: boolean
  adultContent: 'match_scene' | 'allow_explicit' | 'suggestive'
  prismIntegration: 'auto' | 'manual' | 'off'
  prismColorOverrides: Record<string, string>
  temperature: number
  maxTokens: number
  connectionId: string
  modelOverride: string
  writerConnectionId: string
  writerModelOverride: string
  writerTemperature: number
  writerMaxTokens: number
  writerUseReasoning: boolean
  relationshipMemory: boolean
  longTermStoryMemory: boolean
  storyMemoryChunks: number
  useReasoning: boolean
  globalInstructions: string
  chatPersonas: Record<string, string>
  personaOverrides: Record<string, string>
}

type CachedPath = {
  chatId: string
  messageId: string
  contentHash: string
  personaId?: string
  style: { pov: string; tense: string }
  sceneState?: { location: string; moment: string }
  choices: Choice[]
  prismColor?: string
  oocForced?: boolean
  createdAt: number
}

const CONFIG_PATH = 'config.json'
const CACHE_PATH = 'choices.json'
const MEMORY_PATH = 'relationship_memory.json'

const DEFAULT_CONFIG: Config = {
  enabled: true,
  choiceCount: 5,
  contextMessages: 12,
  recentUserExamples: 6,
  pov: 'auto',
  tense: 'auto',
  detail: 'normal',
  generationDelaySeconds: 3,
  skipOoc: true,
  adultContent: 'match_scene',
  prismIntegration: 'auto',
  prismColorOverrides: {},
  temperature: 0.85,
  maxTokens: 1400,
  connectionId: '',
  modelOverride: '',
  writerConnectionId: '',
  writerModelOverride: '',
  writerTemperature: 0.75,
  writerMaxTokens: 2200,
  writerUseReasoning: false,
  relationshipMemory: true,
  longTermStoryMemory: true,
  storyMemoryChunks: 6,
  useReasoning: false,
  globalInstructions: '',
  chatPersonas: {},
  personaOverrides: {},
}

let config: Config = { ...DEFAULT_CONFIG }
let cache: Record<string, CachedPath> = {}
let relationshipMemory: Record<string, { subjects: Record<string, string[]>; updatedAt: number; messageId: string }> = {}
const inFlight = new Set<string>()

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'
const OPENROUTER_MODEL_TTL_MS = 60 * 60 * 1000
let openRouterCatalogCache: { fetchedAt: number; models: OpenRouterModel[] } = { fetchedAt: 0, models: [] }

function extractOpenRouterRows(result: any): any[] {
  const candidates = [result, result?.body, result?.data, result?.json]
  for (const candidate of candidates) {
    let value = candidate
    if (typeof value === 'string') {
      try { value = JSON.parse(value) } catch { continue }
    }
    if (Array.isArray(value)) return value
    if (value && Array.isArray(value.data)) return value.data
  }
  return []
}

function normalizeOpenRouterModels(rows: any[]): OpenRouterModel[] {
  const seen = new Set<string>()
  const models: OpenRouterModel[] = []
  for (const row of rows || []) {
    const id = String(row?.id || '').trim()
    if (!id || seen.has(id)) continue
    const outputModalities = Array.isArray(row?.architecture?.output_modalities)
      ? row.architecture.output_modalities.map((x: any) => String(x).toLowerCase())
      : []
    // The generic OpenRouter catalog now includes image/audio/embedding models.
    // Persona Paths can only use models that produce text. Keep older records
    // that omit modality metadata so a newly-added text model is not hidden.
    if (outputModalities.length && !outputModalities.includes('text')) continue
    seen.add(id)
    const supported = Array.isArray(row?.supported_parameters)
      ? row.supported_parameters.map((x: any) => String(x).toLowerCase())
      : []
    const contextLength = Number(row?.context_length || row?.top_provider?.context_length || 0)
    models.push({
      id,
      name: String(row?.name || id).trim() || id,
      contextLength: Number.isFinite(contextLength) && contextLength > 0 ? Math.round(contextLength) : 0,
      reasoning: supported.includes('reasoning') || supported.some((x: string) => x.startsWith('reasoning.')),
    })
  }
  return models.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

async function getOpenRouterModels(force = false): Promise<{ models: OpenRouterModel[]; cached: boolean; fetchedAt: number }> {
  if (!spindle.permissions.has('cors_proxy')) {
    throw new Error('Grant Persona Paths the CORS Proxy permission to load the searchable OpenRouter model catalog. Manual model IDs still work without it.')
  }
  const now = Date.now()
  if (!force && openRouterCatalogCache.models.length && now - openRouterCatalogCache.fetchedAt < OPENROUTER_MODEL_TTL_MS) {
    return { ...openRouterCatalogCache, cached: true }
  }
  const result = await spindle.cors(OPENROUTER_MODELS_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  const models = normalizeOpenRouterModels(extractOpenRouterRows(result))
  if (!models.length) throw new Error('OpenRouter returned no usable text models. Manual model IDs remain available.')
  openRouterCatalogCache = { fetchedAt: now, models }
  return { ...openRouterCatalogCache, cached: false }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function normalizeConfig(input: Partial<Config> | null | undefined): Config {
  const next = { ...DEFAULT_CONFIG, ...(input || {}) } as Config
  next.choiceCount = Math.round(clampNumber(next.choiceCount, 3, 6, DEFAULT_CONFIG.choiceCount))
  next.contextMessages = Math.round(clampNumber(next.contextMessages, 6, 40, DEFAULT_CONFIG.contextMessages))
  next.recentUserExamples = Math.round(clampNumber(next.recentUserExamples, 2, 12, DEFAULT_CONFIG.recentUserExamples))
  next.storyMemoryChunks = Math.round(clampNumber(next.storyMemoryChunks, 1, 12, DEFAULT_CONFIG.storyMemoryChunks))
  next.longTermStoryMemory = next.longTermStoryMemory !== false
  next.temperature = clampNumber(next.temperature, 0, 2, DEFAULT_CONFIG.temperature)
  next.maxTokens = Math.round(clampNumber(next.maxTokens, 500, 32000, DEFAULT_CONFIG.maxTokens))
  next.writerTemperature = clampNumber(next.writerTemperature, 0, 2, DEFAULT_CONFIG.writerTemperature)
  next.writerMaxTokens = Math.round(clampNumber(next.writerMaxTokens, 500, 32000, DEFAULT_CONFIG.writerMaxTokens))
  next.writerUseReasoning = !!next.writerUseReasoning
  next.generationDelaySeconds = clampNumber(next.generationDelaySeconds, 0, 15, DEFAULT_CONFIG.generationDelaySeconds)
  next.skipOoc = next.skipOoc !== false
  if (!['auto', 'first', 'second', 'third'].includes(next.pov)) next.pov = 'auto'
  if (!['auto', 'present', 'past'].includes(next.tense)) next.tense = 'auto'
  if (!['compact', 'normal', 'detailed'].includes(next.detail)) next.detail = 'normal'
  if (!['match_scene', 'allow_explicit', 'suggestive'].includes(next.adultContent)) next.adultContent = 'match_scene'
  if (!['auto', 'manual', 'off'].includes(next.prismIntegration)) next.prismIntegration = 'auto'
  if (!next.prismColorOverrides || typeof next.prismColorOverrides !== 'object') next.prismColorOverrides = {}
  next.prismColorOverrides = Object.fromEntries(Object.entries(next.prismColorOverrides).map(([key, value]) => [key, normalizeHex(value)]).filter(([, value]) => !!value))
  if (!next.personaOverrides || typeof next.personaOverrides !== 'object') next.personaOverrides = {}
  next.chatPersonas = Object.fromEntries(Object.entries(next.chatPersonas || {}).filter(([key, value]) => key && typeof value === 'string' && value))
  next.globalInstructions = String(next.globalInstructions || '')
  next.connectionId = String(next.connectionId || '')
  next.modelOverride = String(next.modelOverride || '')
  next.writerConnectionId = String(next.writerConnectionId || '')
  next.writerModelOverride = String(next.writerModelOverride || '')
  return next
}

async function loadState() {
  config = normalizeConfig(await spindle.storage.getJson(CONFIG_PATH, { fallback: DEFAULT_CONFIG }))
  cache = await spindle.storage.getJson(CACHE_PATH, { fallback: {} })
  relationshipMemory = await spindle.storage.getJson(MEMORY_PATH, { fallback: {} })

  // v0.1.12 migration: old cached paths may contain model-copied Prism <font>
  // markup. Remove it once on load so an update/refresh cannot resurrect it.
  let cacheChanged = false
  for (const entry of Object.values(cache || {})) {
    if (!entry || !Array.isArray((entry as any).choices)) continue
    ;(entry as any).choices = (entry as any).choices.map((choice: any) => {
      const before = String(choice?.text || '')
      const after = cleanGeneratedChoiceText(before)
      if (after !== before.trim()) cacheChanged = true
      return { ...choice, text: after }
    })
  }
  if (cacheChanged) await saveCache()
}

async function saveConfig() {
  await spindle.storage.setJson(CONFIG_PATH, config, { indent: 2 })
}

async function saveCache() {
  const entries = Object.values(cache).sort((a: any, b: any) => b.createdAt - a.createdAt).slice(0, 250)
  cache = Object.fromEntries(entries.map((entry: any) => [entry.messageId, entry]))
  await spindle.storage.setJson(CACHE_PATH, cache, { indent: 2 })
}

async function saveRelationshipMemory() {
  const entries = Object.entries(relationshipMemory)
    .sort((a: any, b: any) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0))
    .slice(0, 150)
  relationshipMemory = Object.fromEntries(entries)
  await spindle.storage.setJson(MEMORY_PATH, relationshipMemory, { indent: 2 })
}

function startsWithOocMarker(text: string) {
  const clean = String(text || '').trimStart()
  // Common role-play conventions plus a forgiving `[ooc}:` variant. The marker
  // must be at the beginning so ordinary prose that merely mentions OOC is not skipped.
  return /^(?:\[\s*ooc\s*[\]\}]\s*:?\s*|\(\s*ooc\s*\)\s*:?\s*|ooc\s*:)/i.test(clean)
}

function collectOocMessageIds(messages: any[]) {
  const ids = new Set<string>()
  let waitingForAssistantReply = false

  for (const message of messages || []) {
    const role = String(message?.role || '')
    const id = String(message?.id || '')
    if (role === 'user') {
      const isOoc = startsWithOocMarker(String(message?.content || ''))
      waitingForAssistantReply = isOoc
      if (isOoc && id) ids.add(id)
      continue
    }
    if (role === 'assistant') {
      const isOoc = waitingForAssistantReply || startsWithOocMarker(String(message?.content || ''))
      if (isOoc && id) ids.add(id)
      waitingForAssistantReply = false
    }
  }

  return ids
}

function hashText(text: string) {
  let hash = 5381
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash) ^ text.charCodeAt(i)
  return (hash >>> 0).toString(36)
}

function compactText(text: string, max = 3600) {
  const clean = String(text || '').trim()
  if (clean.length <= max) return clean
  return clean.slice(0, max) + '\n[…truncated…]'
}

// Story replies are chronological. For continuity-sensitive context, dropping the
// tail is much more dangerous than dropping the middle because the tail contains
// the persona's CURRENT location, posture, injuries, possessions, and immediate
// situation. Preserve both ends and bias toward the newest/final portion.
function compactTextPreserveEnds(text: string, max = 4800, tailRatio = 0.68) {
  const clean = String(text || '').trim()
  if (clean.length <= max) return clean
  const marker = '\n[…middle truncated; final beat preserved…]\n'
  const usable = Math.max(200, max - marker.length)
  const tailSize = Math.max(120, Math.floor(usable * tailRatio))
  const headSize = Math.max(80, usable - tailSize)
  return clean.slice(0, headSize).trimEnd() + marker + clean.slice(-tailSize).trimStart()
}

function compactTailText(text: string, max = 5200) {
  const clean = String(text || '').trim()
  if (clean.length <= max) return clean
  return `[…earlier part omitted; this is the END of the reply…]\n${clean.slice(-max)}`
}

function normalizeHex(value: unknown) {
  const raw = String(value || '').trim()
  const short = raw.match(/^#?([0-9a-f]{3})$/i)
  if (short) return `#${short[1].split('').map((c) => c + c).join('').toUpperCase()}`
  const full = raw.match(/^#?([0-9a-f]{6})$/i)
  return full ? `#${full[1].toUpperCase()}` : ''
}

// Prism intentionally stores portable color tags in some user/assistant messages.
// They are presentation/speaker identity metadata, not characterization. Remove
// them before the CYOA model sees examples so it cannot learn/copy stale or NPC colors.
function stripColorMarkup(text: unknown) {
  return String(text || '')
    .replace(/&lt;\s*\/?\s*font\b[^&]*?&gt;/gi, '')
    .replace(/\\?<\s*\/?\s*font\b[^>]*>/gi, '')
    .replace(/\[\s*\/?\s*color(?:\s*=\s*[^\]]+)?\s*\]/gi, '')
}

function cleanRoleplayText(text: unknown) {
  return stripColorMarkup(text).trim()
}

// Prism recognizes spoken dialogue delimited by double quotes. Some CYOA
// models stylistically emit curly single quotation marks instead. Normalize
// only dialogue-looking paired curly singles in GENERATED Path text so the
// visible card and the subsequently sent plain-text user turn remain Prism-
// compatible. Interior apostrophes such as don’t are preserved because a
// closing quote is only accepted at a dialogue boundary.
function normalizePrismDialogueQuotes(text: unknown) {
  const source = String(text || '')
  return source.replace(/(^|[\s([{>—–-])‘([^‘\n]*?)’(?=$|[\s)\]}>.,!?;:—–-])/gm, (_match, boundary, inner) => `${boundary}“${inner}”`)
}

function cleanGeneratedChoiceText(text: unknown) {
  return normalizePrismDialogueQuotes(cleanRoleplayText(text)).trim()
}


function extractPrismColorsFromUserContent(text: unknown) {
  const source = String(text || '')
  const found: string[] = []
  const add = (value: unknown) => {
    const color = normalizeHex(value)
    if (color && !found.includes(color)) found.push(color)
  }

  // Prism's canonical stored form. We inspect USER messages only; assistant
  // markup may belong to any NPC and is never trusted as the persona color.
  for (const match of source.matchAll(/<font\b[^>]*\bcolor\s*=\s*["']?\s*(#?[0-9a-f]{6}|#?[0-9a-f]{3})\s*["']?[^>]*>/gi)) add(match[1])
  for (const match of source.matchAll(/&lt;\s*font\b[^&]*?\bcolor\s*=\s*(?:&quot;|&#39;|["'])?\s*(#?[0-9a-f]{6}|#?[0-9a-f]{3})/gi)) add(match[1])
  for (const match of source.matchAll(/\[\s*color\s*=\s*["']?\s*(#?[0-9a-f]{6}|#?[0-9a-f]{3})\s*["']?\s*\]/gi)) add(match[1])
  return found
}

function inferPrismPersonaColorFromUserMessages(messages: any[]) {
  // First choice: Prism's own metadata on a user message. Lumiverse exposes
  // spindle_metadata separately as message.metadata.
  for (let i = (messages || []).length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.role !== 'user') continue
    const color = normalizeHex(message?.metadata?.lumi_dialogue_color)
      || normalizeHex(message?.extra?.spindle_metadata?.lumi_dialogue_color)
    if (color) return { color, source: 'Prism user-message metadata' }
  }

  // Compatibility fallback: Prism may already have persisted canonical <font>
  // markup while metadata is absent/stale. A USER turn represents the active
  // persona, so a single unambiguous color in that turn is much safer than
  // sampling arbitrary assistant markup. Require consistency and prefer recent
  // evidence so old persona colors do not win after a palette change.
  const votes = new Map<string, { count: number; newestIndex: number }>()
  let considered = 0
  for (let i = (messages || []).length - 1; i >= 0 && considered < 12; i -= 1) {
    const message = messages[i]
    if (message?.role !== 'user') continue
    considered += 1
    const colors = extractPrismColorsFromUserContent(message?.content)
    if (colors.length !== 1) continue
    const color = colors[0]
    const current = votes.get(color) || { count: 0, newestIndex: i }
    current.count += 1
    current.newestIndex = Math.max(current.newestIndex, i)
    votes.set(color, current)
  }
  const winner = [...votes.entries()].sort((a, b) => b[1].count - a[1].count || b[1].newestIndex - a[1].newestIndex)[0]
  if (winner) return { color: winner[0], source: 'Prism user-message markup' }
  return { color: '', source: '' }
}

function parsePrismHexRows(text: unknown) {
  const rows: Array<{ name: string; color: string; provisional: boolean }> = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^\s*(.+?)\s*:\s*(#[0-9a-f]{6})(?:\s*\(provisional\))?\s*$/i)
    if (!match) continue
    const name = String(match[1] || '').trim()
    const color = normalizeHex(match[2])
    if (!name || !color) continue
    rows.push({ name, color, provisional: /\(provisional\)\s*$/i.test(line) })
  }
  return rows
}

async function resolvePrismInfo(chatId: string, userId: string | undefined, persona: any, messages: any[]) {
  if (config.prismIntegration === 'off') {
    return { mode: 'off', available: false, color: '', source: '', status: 'Prism integration is off.' }
  }

  if (config.prismIntegration === 'manual') {
    const personaId = String(persona?.id || '')
    const color = personaId ? normalizeHex(config.prismColorOverrides?.[personaId]) : ''
    if (color) {
      return {
        mode: 'manual', available: true, color, source: 'Persona Paths manual override',
        status: `Manual Prism persona color: ${color}.`,
      }
    }
    return {
      mode: 'manual', available: false, color: '', source: '',
      status: personaId ? 'Manual Prism color is selected. Enter a valid #RRGGBB color for this persona.' : 'Manual Prism color is selected, but there is no active persona.',
    }
  }

  // Prism does NOT expose the active persona in {{prismHexes}} by default
  // (personaInCast defaults false). Prefer the persona-specific evidence Prism
  // writes onto USER turns, then use the registry when the persona is exposed.
  const userEvidence = inferPrismPersonaColorFromUserMessages(messages)
  if (userEvidence.color) {
    return {
      mode: 'auto', available: true, color: userEvidence.color, source: userEvidence.source,
      status: `${userEvidence.source === 'Prism user-message metadata' ? 'Prism persona color' : 'Prism persona color inferred from your colored turns'}: ${userEvidence.color}.`,
    }
  }

  let macroAvailable = false
  let macroStatus = ''
  try {
    const resolved = await spindle.macros.resolve('{{prismHexes}}', { chatId, userId, commit: false })
    const text = String(resolved?.text || '')
    const diagnostics = Array.isArray(resolved?.diagnostics) ? resolved.diagnostics : []
    const unknown = diagnostics.some((d: any) => /unknown.*prismhexes|prismhexes.*unknown/i.test(String(d?.message || '')))
      || text.includes('{{prismHexes}}')
    macroAvailable = !unknown
    const rows = parsePrismHexRows(text)
    const personaName = String(persona?.name || '').trim().toLocaleLowerCase()
    if (personaName) {
      const exact = rows.find((row) => row.name.trim().toLocaleLowerCase() === personaName && !row.provisional)
        || rows.find((row) => row.name.trim().toLocaleLowerCase() === personaName)
      if (exact) {
        return {
          mode: 'auto', available: true, color: exact.color, source: 'Prism registry',
          status: `Prism: ${persona?.name || 'persona'} uses ${exact.color}.`,
        }
      }
    }
    if (macroAvailable) macroStatus = rows.length
      ? 'Prism registry found. The active persona is not exposed there, and no colored user-turn evidence was available yet.'
      : 'Prism is available, but no persona color was exposed yet.'
  } catch (err: any) {
    macroStatus = `Prism macro lookup unavailable: ${err?.message || String(err)}`
  }

  return {
    mode: 'auto', available: macroAvailable, color: '', source: '',
    status: macroStatus || 'Prism was not detected. Choices will use normal Lumiverse text color.',
  }
}

function stripFences(text: string) {
  const trimmed = String(text || '').trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

function parseJsonObject(text: string): any {
  const cleaned = stripFences(text)
  try { return JSON.parse(cleaned) } catch {}
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1))
  throw new Error('Model response was not valid JSON')
}

function validateResult(result: any, expectedCount: number, detail: Config['detail']) {
  const issues: string[] = []
  if (!result || !Array.isArray(result.choices)) issues.push('choices is missing')
  const state = result?.scene_state as any
  const location = String(state?.location || '').trim()
  const moment = String(state?.moment || '').trim()
  if (!location) issues.push('scene_state.location is missing')
  if (!moment) issues.push('scene_state.moment is missing')
  if (location && location.split(/\s+/).filter(Boolean).length > 8) issues.push('scene_state.location is too long')
  if (moment && moment.split(/\s+/).filter(Boolean).length > 10) issues.push('scene_state.moment is too long')

  const choices: Choice[] = Array.isArray(result?.choices) ? result.choices : []
  if (choices.length !== expectedCount) issues.push(`expected exactly ${expectedCount} choices`)

  const intents = new Set<string>()
  let sceneAdvancers = 0
  const minLength = detail === 'compact' ? 55 : detail === 'detailed' ? 180 : 100

  for (let i = 0; i < choices.length; i += 1) {
    const c: any = choices[i] || {}
    if (!String(c.intent || '').trim()) issues.push(`choice ${i + 1} has no intent`)
    const title = String(c.title || '').trim()
    if (!title) issues.push(`choice ${i + 1} has no title`)
    else {
      const titleWords = title.split(/\s+/).filter(Boolean).length
      if (titleWords > 5) issues.push(`choice ${i + 1} title is too long; use a 2–4 word scan label`)
    }
    if (String(c.text || '').trim().length < minLength) issues.push(`choice ${i + 1} is too short`)
    const intensity = Number(c.intensity)
    if (!Number.isInteger(intensity) || intensity < 1 || intensity > 3) issues.push(`choice ${i + 1} intensity must be 1, 2, or 3`)
    const intent = String(c.intent || '').trim().toLowerCase()
    if (intent && intents.has(intent)) issues.push(`choice ${i + 1} repeats another intent`)
    if (intent) intents.add(intent)
    if (c.advances_scene === true) sceneAdvancers += 1
  }

  if (sceneAdvancers !== 1) issues.push(`expected exactly one scene-advancing choice, got ${sceneAdvancers}`)

  return issues
}

function detailInstruction(detail: Config['detail']) {
  if (detail === 'compact') return 'Each choice should be 1–2 substantial sentences, usually 45–90 words.'
  if (detail === 'detailed') return 'Each choice should be 4–7 sentences, usually 120–220 words, with clear action, body language, intent, and optional dialogue.'
  return 'Each choice should be 2–5 sentences, usually 75–150 words, with enough concrete action and intent for the story model to react to.'
}

function adultContentInstruction(mode: Config['adultContent']) {
  const shared = 'Sexual content is permitted only when every involved character is clearly an adult (18+). Never sexualize minors or age-ambiguous characters.'
  if (mode === 'allow_explicit') {
    return `${shared} When the current adult scene or relationship plausibly supports sexual action, explicit sexual language and actions are allowed. Do not euphemize or sanitize merely because the content is sexual. Do not force sexual escalation into unrelated scenes.`
  }
  if (mode === 'suggestive') {
    return `${shared} Sexual or romantic choices may be suggestive, sensual, or clearly intimate, but keep the choice text non-graphic and avoid explicit anatomical detail.`
  }
  return `${shared} Match the established scene's level of adult sexual explicitness. If the scene is already explicit, you may remain explicit without sanitizing it; if the scene is only romantic/suggestive or nonsexual, do not artificially escalate it.`
}


function memoryChunkRange(chunk: any) {
  const meta = chunk?.metadata || {}
  const start = Number(meta.startIndex ?? meta.start_index)
  const end = Number(meta.endIndex ?? meta.end_index)
  return {
    start: Number.isFinite(start) ? start : null,
    end: Number.isFinite(end) ? end : null,
  }
}

function chunkOverlapsIndexSet(chunk: any, indexes: Set<number>) {
  if (!indexes.size) return false
  const range = memoryChunkRange(chunk)
  if (range.start == null || range.end == null) return false
  for (const index of indexes) {
    if (index >= range.start && index <= range.end) return true
  }
  return false
}

function containsOocMarkerAnywhere(text: string) {
  return /(?:^|\n)\s*(?:\[\s*ooc\s*[\]\}]\s*:?\s*|\(\s*ooc\s*\)\s*:?\s*|ooc\s*:)/i.test(String(text || ''))
}

function emptyStoryMemoryContext(note = ''): StoryMemoryContext {
  return { source: 'none', memories: [], entities: [], relationships: [], arc: '', note }
}

function normalizedMemoryText(value: unknown) {
  return cleanRoleplayText(value).replace(/\s+/g, ' ').trim().toLowerCase()
}

function compactJson(value: unknown, max = 1800) {
  try {
    const text = JSON.stringify(value)
    return compactText(text === undefined ? '' : text, max)
  } catch {
    return ''
  }
}

function formatCortexEntity(entity: any) {
  if (!entity) return ''
  if (typeof entity === 'string') return compactText(cleanRoleplayText(entity), 1600)
  const name = String(entity.name || entity.canonicalName || entity.label || '').trim()
  const type = String(entity.type || entity.entityType || '').trim()
  const status = String(entity.status || '').trim()
  const aliases = Array.isArray(entity.aliases)
    ? entity.aliases.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 5)
    : []
  const factsRaw = Array.isArray(entity.facts) ? entity.facts
    : Array.isArray(entity.memoryFacts) ? entity.memoryFacts
      : Array.isArray(entity.factList) ? entity.factList
        : []
  const facts = factsRaw
    .map((x: any) => cleanRoleplayText(typeof x === 'string' ? x : (x?.content || x?.fact || x?.text || '')))
    .filter(Boolean)
    .slice(0, 8)
  const description = cleanRoleplayText(entity.summary || entity.description || entity.context || '')
  const valence = entity.emotionalValence && typeof entity.emotionalValence === 'object'
    ? Object.entries(entity.emotionalValence)
        .filter(([, v]) => Number(v) !== 0)
        .slice(0, 6)
        .map(([k, v]) => `${k}=${Number(v).toFixed(2)}`)
        .join(', ')
    : ''
  const header = [name || '(unnamed entity)', type ? `[${type}]` : '', status ? `status=${status}` : '']
    .filter(Boolean)
    .join(' ')
  const parts = [header]
  if (aliases.length) parts.push(`Aliases: ${aliases.join(', ')}`)
  if (description) parts.push(`Context: ${compactText(description, 900)}`)
  if (facts.length) parts.push(`Facts: ${facts.join('; ')}`)
  if (valence) parts.push(`Emotional context: ${valence}`)
  return compactText(parts.filter(Boolean).join('\n'), 2200)
}

function formatCortexRelationship(rel: any) {
  if (!rel) return ''
  if (typeof rel === 'string') return compactText(cleanRoleplayText(rel), 1400)
  const source = String(rel.sourceName || rel.source?.name || rel.source || rel.fromName || rel.from || '').trim()
  const target = String(rel.targetName || rel.target?.name || rel.target || rel.toName || rel.to || '').trim()
  const type = String(rel.type || rel.relationType || '').trim()
  const label = cleanRoleplayText(rel.label || rel.description || rel.context || '')
  const sentiment = Number(rel.sentiment)
  const bits: string[] = []
  if (source || target) bits.push(`${source || '?'} -> ${target || '?'}`)
  if (type) bits.push(`type=${type}`)
  if (label) bits.push(label)
  if (Number.isFinite(sentiment)) bits.push(`sentiment=${sentiment.toFixed(2)}`)
  if (bits.length) return compactText(bits.join(' | '), 1600)
  return compactJson(rel, 1600)
}

function formatCortexArc(arc: any) {
  if (!arc) return ''
  if (typeof arc === 'string') return compactText(cleanRoleplayText(arc), 2600)
  const title = cleanRoleplayText(arc.title || arc.name || arc.label || '')
  const body = cleanRoleplayText(arc.summary || arc.content || arc.description || arc.text || '')
  if (title || body) return compactText([title, body].filter(Boolean).join('\n'), 3200)
  return compactJson(arc, 3200)
}

function buildCortexQueryText(sceneMessages: any[], persona: any) {
  const recentMessages = (sceneMessages || []).slice(-8)
  const recent = recentMessages
    .map((m: any, index: number) => {
      const role = m?.role === 'user' ? 'PLAYER' : 'STORY'
      const cleaned = cleanRoleplayText(m?.content)
      const isNewest = index === recentMessages.length - 1
      const body = isNewest
        ? compactTextPreserveEnds(cleaned, 2000, 0.76)
        : compactTextPreserveEnds(cleaned, 1200, 0.58)
      return `${role}: ${body}`
    })
    .filter(Boolean)
    .join('\n\n')
  const personaName = String(persona?.name || '').trim()
  return compactTextPreserveEnds(
    `Retrieve earlier story facts, promises, secrets, injuries, decisions, relationship changes, known information, unresolved threads, and prior events relevant to choosing what ${personaName || 'the player persona'} would plausibly do next. Prefer established continuity over generic similarity. The END of the newest story reply defines the current physical state.\n\nCURRENT SCENE:\n${recent}`,
    10000,
    0.7,
  )
}

async function retrieveChatMemoryFallback(
  chatId: string,
  userId: string | undefined,
  allMessages: any[],
  oocMessageIds: Set<string>,
  recentSceneStartIndex: number,
): Promise<StoryMemoryContext> {
  if (!spindle.permissions.has('chats')) return emptyStoryMemoryContext('Chat-memory fallback permission unavailable.')
  try {
    const requested = Math.min(24, config.storyMemoryChunks + 4)
    const result = await spindle.chats.getMemories(chatId, { topK: requested, userId })
    if (!result?.enabled || !Array.isArray(result?.chunks) || !result.chunks.length) {
      spindle.log.info(`Persona Paths chat-memory fallback unavailable for ${chatId}: enabled=${!!result?.enabled}, available=${Number(result?.chunksAvailable || 0)}, pending=${Number(result?.chunksPending || 0)}`)
      return emptyStoryMemoryContext('No vectorized chat-memory chunks were available.')
    }
    const oocIndexes = new Set<number>()
    for (let i = 0; i < allMessages.length; i += 1) {
      if (oocMessageIds.has(String(allMessages[i]?.id || ''))) oocIndexes.add(i)
    }
    const seen = new Set<string>()
    const memories: string[] = []
    for (const chunk of result.chunks) {
      if (memories.length >= config.storyMemoryChunks) break
      const range = memoryChunkRange(chunk)
      if (recentSceneStartIndex >= 0 && range.end != null && range.end >= recentSceneStartIndex) continue
      if (config.skipOoc && chunkOverlapsIndexSet(chunk, oocIndexes)) continue
      const cleaned = cleanRoleplayText(chunk?.content)
      if (!cleaned || (config.skipOoc && containsOocMarkerAnywhere(cleaned))) continue
      const normalized = normalizedMemoryText(cleaned)
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      memories.push(compactText(cleaned, 4200))
    }
    spindle.log.info(`Persona Paths chat-memory fallback for ${chatId}: using ${memories.length}/${result.count || result.chunks.length} retrieved chunks.`)
    return {
      source: 'chat_memory', memories, entities: [], relationships: [], arc: '',
      note: 'Memory Cortex was unavailable; using Lumiverse chat-memory fallback.',
    }
  } catch (err: any) {
    spindle.log.warn(`Persona Paths chat-memory fallback failed for ${chatId}: ${err?.message || String(err)}`)
    return emptyStoryMemoryContext('Memory Cortex and chat-memory fallback were unavailable.')
  }
}

async function retrieveStoryMemoryContext(
  chatId: string,
  userId: string | undefined,
  allMessages: any[],
  oocMessageIds: Set<string>,
  recentSceneStartIndex: number,
  sceneMessages: any[],
  persona: any,
): Promise<StoryMemoryContext> {
  if (!config.longTermStoryMemory) return emptyStoryMemoryContext('Story-memory context is disabled in Persona Paths.')
  if (!spindle.permissions.has('memories')) {
    spindle.log.warn(`Persona Paths Memory Cortex permission is not granted for ${chatId}; trying chat-memory fallback.`)
    return retrieveChatMemoryFallback(chatId, userId, allMessages, oocMessageIds, recentSceneStartIndex)
  }
  try {
    const requested = Math.min(24, config.storyMemoryChunks + 4)
    const queryText = buildCortexQueryText(sceneMessages, persona)
    const result = await spindle.memories.cortex.query({
      chatId,
      queryText,
      topK: requested,
      includeConsolidations: true,
      includeRelationships: true,
      userId,
    })

    const recentNormalized = normalizedMemoryText((sceneMessages || []).map((m: any) => cleanRoleplayText(m?.content)).join('\n'))
    const seen = new Set<string>()
    const memories: string[] = []
    for (const memory of Array.isArray(result?.memories) ? result.memories : []) {
      if (memories.length >= config.storyMemoryChunks) break
      const cleaned = cleanRoleplayText(memory?.content ?? memory?.text ?? memory)
      if (!cleaned || (config.skipOoc && containsOocMarkerAnywhere(cleaned))) continue
      const normalized = normalizedMemoryText(cleaned)
      if (!normalized || seen.has(normalized)) continue
      const sample = normalized.slice(0, Math.min(220, normalized.length))
      if (sample.length >= 80 && recentNormalized.includes(sample)) continue
      seen.add(normalized)
      memories.push(compactText(cleaned, 4200))
    }

    let rawEntities = Array.isArray(result?.entityContext) ? result.entityContext : []
    if (!rawEntities.length) {
      try {
        const listed = await spindle.memories.entities.list(chatId, { activeOnly: true, limit: 12, userId })
        rawEntities = Array.isArray(listed) ? listed : []
      } catch (err: any) {
        spindle.log.warn(`Persona Paths Cortex entity fallback failed for ${chatId}: ${err?.message || String(err)}`)
      }
    }
    const enrichedEntities = await Promise.all(rawEntities.slice(0, 12).map(async (entity: any) => {
      const hasFacts = Array.isArray(entity?.facts) && entity.facts.length
      const entityId = String(entity?.id || entity?.entityId || '')
      if (hasFacts || !entityId) return entity
      try {
        const facts = await spindle.memories.entities.getFacts(entityId, userId)
        return Array.isArray(facts) && facts.length ? { ...entity, facts } : entity
      } catch {
        return entity
      }
    }))
    const entities = enrichedEntities.map(formatCortexEntity).filter(Boolean).slice(0, 12)

    let relationships: string[] = []
    const directRelationships = result?.relationshipContext ?? result?.relationships ?? result?.relations
    if (Array.isArray(directRelationships)) {
      relationships = directRelationships.map(formatCortexRelationship).filter(Boolean).slice(0, 12)
    }
    if (!relationships.length) {
      const ids = rawEntities.map((entity: any) => String(entity?.id || entity?.entityId || '')).filter(Boolean).slice(0, 10)
      if (ids.length) {
        try {
          const rels = await spindle.memories.relations.forEntities(chatId, ids, { limit: 12, userId })
          relationships = (Array.isArray(rels) ? rels : []).map(formatCortexRelationship).filter(Boolean).slice(0, 12)
        } catch (err: any) {
          spindle.log.warn(`Persona Paths Cortex relationship fallback failed for ${chatId}: ${err?.message || String(err)}`)
        }
      }
    }

    let arc = formatCortexArc(result?.arcContext)
    if (!arc) {
      try {
        arc = formatCortexArc(await spindle.memories.consolidations.latestArc(chatId, userId))
      } catch (err: any) {
        spindle.log.warn(`Persona Paths Cortex arc fallback failed for ${chatId}: ${err?.message || String(err)}`)
      }
    }

    if (!memories.length && !entities.length && !relationships.length && !arc) {
      spindle.log.info(`Persona Paths Memory Cortex returned no usable context for ${chatId}; trying chat-memory fallback.`)
      return retrieveChatMemoryFallback(chatId, userId, allMessages, oocMessageIds, recentSceneStartIndex)
    }

    spindle.log.info(`Persona Paths Memory Cortex for ${chatId}: ${memories.length} memories, ${entities.length} entities, ${relationships.length} relationships, arc=${arc ? 'yes' : 'no'}.`)
    return {
      source: 'cortex', memories, entities, relationships, arc,
      note: 'Read-only context retrieved from Lumiverse Memory Cortex.',
    }
  } catch (err: any) {
    spindle.log.warn(`Persona Paths Memory Cortex lookup failed for ${chatId}; trying chat-memory fallback: ${err?.message || String(err)}`)
    return retrieveChatMemoryFallback(chatId, userId, allMessages, oocMessageIds, recentSceneStartIndex)
  }
}

function buildSystemPrompt(cfg: Config) {
  const requestedPov = cfg.pov === 'auto'
    ? 'Infer POV only from the player\'s recent USER turns. If ambiguous, use first person.'
    : `Use ${cfg.pov} person.`
  const requestedTense = cfg.tense === 'auto'
    ? 'Infer tense only from the player\'s recent USER turns. If ambiguous, use present tense.'
    : `Use ${cfg.tense} tense.`

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
- Each choice title is a SCAN LABEL, not a miniature summary of the first action. Make it 2–4 words whenever possible and describe the option's emotional/strategic direction, intent, or likely immediate trajectory at a glance. Include emotional stance when it materially distinguishes the option (for example: "Angry pushback", "Protective regroup", "Playful deflection", "Quiet withdrawal", "Commit to leaving", "Investigate carefully").
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
- Spoken dialogue MUST use double quotation marks, preferably typographic “ ”. Never use single quotation marks ‘ ’ as dialogue delimiters; Prism does not treat them as persona dialogue. Apostrophes inside words are fine.
- Inner thoughts are OPTIONAL and should be used sparingly. Most choices should contain no direct inner thought. Across a normal set of choices, prefer zero or one choices with direct inner thought unless the scene is unusually introspective.
- Include a direct inner thought only when it adds meaningful subtext, conflict, hesitation, desire, or information that action/dialogue cannot convey as well. Do not use thoughts merely to explain an action that is already obvious.
- When a direct inner thought is used, format it as Markdown italics with single asterisks, for example: *This is a terrible idea.* Never put inner thoughts in quotation marks.
- ADULT CONTENT: ${adultContentInstruction(cfg.adultContent)}
- The choice text must be ready to paste directly into the user's composer. Do not put labels or explanations inside the pasted text.

CURRENT-STATE METADATA
- Return a tiny scene_state object describing where the PLAYER PERSONA physically is at the END of the latest assistant reply and the immediate beat they are in.
- scene_state.location should be a 2–6 word physical anchor such as "Living room couch", "Passenger seat", "Forest trail", or "Kitchen doorway". It must reflect the FINAL state, not an earlier location from the same reply.
- scene_state.moment should be a 2–8 word immediate beat/status such as "Pinned in the chair", "Hannah awaiting an answer", "Microwave running", or "Argument just broke". Keep it observable/grounded and do not invent an outcome.
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
    { "intent": "short unique trajectory", "title": "2–4 word emotional/strategic scan label", "text": "paste-ready user turn", "intensity": 2, "advances_scene": false }
  ]
}
No markdown. No commentary.`
}

function buildUserPrompt(args: {
  persona: any
  personaOverride: string
  memoryNotes: string[]
  recentUserTurns: any[]
  sceneMessages: any[]
  storyMemory: StoryMemoryContext
  globalInstructions: string
  regenerationGuidance?: string
  rejectedChoices?: Choice[]
}) {
  const { persona, personaOverride, memoryNotes, recentUserTurns, sceneMessages, storyMemory, globalInstructions, regenerationGuidance = '', rejectedChoices = [] } = args
  const personaBlock = persona
    ? `NAME: ${persona.name || 'Unnamed'}\nTITLE: ${persona.title || ''}\nDESCRIPTION:\n${compactText(persona.description || '(none)', 6000)}`
    : 'No active persona card is available. Infer the player character only from USER turns.'

  const userExamples = recentUserTurns.length
    ? recentUserTurns.map((m, i) => `USER EXAMPLE ${i + 1}:\n${compactText(cleanRoleplayText(m.content), 2600)}`).join('\n\n')
    : '(none)'

  const newestIndex = sceneMessages.length - 1
  const scene = sceneMessages.map((m, i) => {
    const cleaned = cleanRoleplayText(m.content)
    const isNewestAssistant = i === newestIndex && m.role === 'assistant'
    const body = isNewestAssistant
      ? compactTextPreserveEnds(cleaned, 9000, 0.74)
      : compactTextPreserveEnds(cleaned, 3600, 0.58)
    return `${m.role === 'user' ? 'USER' : 'ASSISTANT'}:\n${body}`
  }).join('\n\n')

  const latestAssistant = [...sceneMessages].reverse().find((m: any) => m?.role === 'assistant')
  const currentMoment = latestAssistant
    ? compactTailText(cleanRoleplayText(latestAssistant.content), 5200)
    : '(No assistant reply was available.)'

  const guidance = String(regenerationGuidance || '').trim()
  const rejectedBlock = rejectedChoices.length
    ? rejectedChoices.slice(0, 8).map((choice, i) => `PATH #${i + 1} — ${choice.title || choice.intent || 'Untitled'}:\n${compactText(cleanRoleplayText(choice.text), 1800)}`).join('\n\n')
    : '(none)'
  const regenerationBlock = guidance
    ? `\n\nGUIDED REGENERATION REQUEST FROM THE HUMAN\n${guidance}\n\nPREVIOUS PATHS (NUMBERED FOR HUMAN REFERENCES)\n${rejectedBlock}\n\nWhen the human refers to #1, #2, etc., those numbers refer exactly to the numbered PREVIOUS PATHS above. Use the guidance as a directional preference, correction, or possibility — not as a requirement that every new option perform the exact same action. Produce genuinely new trajectories rather than paraphrasing the rejected paths. If the guidance corrects characterization, naming, relationship behavior, or voice, obey that correction throughout all choices.`
    : ''

  return `PLAYER PERSONA\n${personaBlock}

PERSONA-SPECIFIC GUIDANCE FROM THE HUMAN\n${personaOverride.trim() || '(none)'}

GLOBAL EXTENSION GUIDANCE FROM THE HUMAN\n${globalInstructions.trim() || '(none)'}

PRIVATE RELATIONSHIP MEMORY FROM PRIOR CYOA PASSES\n${memoryNotes.length ? memoryNotes.map(x => `- ${x}`).join('\n') : '(none yet)'}

LUMIVERSE STORY MEMORY SOURCE
${storyMemory.source === 'cortex' ? 'Memory Cortex (preferred)' : storyMemory.source === 'chat_memory' ? 'Long-term chat-memory fallback' : 'None available'}${storyMemory.note ? `\n${storyMemory.note}` : ''}

MEMORY CORTEX / EARLIER STORY EVENTS
${storyMemory.memories.length ? storyMemory.memories.map((x, i) => `MEMORY ${i + 1}:\n${x}`).join('\n\n') : '(none retrieved)'}

MEMORY CORTEX ENTITY CONTEXT
${storyMemory.entities.length ? storyMemory.entities.map((x, i) => `ENTITY ${i + 1}:\n${x}`).join('\n\n') : '(none retrieved)'}

MEMORY CORTEX RELATIONSHIP CONTEXT
${storyMemory.relationships.length ? storyMemory.relationships.map((x, i) => `RELATIONSHIP ${i + 1}:\n${x}`).join('\n\n') : '(none retrieved)'}

MEMORY CORTEX ACTIVE NARRATIVE ARC
${storyMemory.arc || '(none retrieved)'}
Use all memory material for continuity only. It may be incomplete or stale. The CURRENT ROLE-PLAY SCENE below is authoritative when anything conflicts.

RECENT EXAMPLES OF HOW THE HUMAN ACTUALLY PLAYS THIS PERSONA\n${userExamples}

CURRENT ROLE-PLAY SCENE\n${scene}${regenerationBlock}

CURRENT MOMENT — END OF THE LATEST ASSISTANT REPLY (HIGHEST PRIORITY)\n${currentMoment}

Start every candidate from the physical and situational state that exists at the END of that block. Later events inside the latest reply supersede earlier ones. Do not continue from an earlier location, posture, action, or conversational beat unless the choice explicitly moves back there.

Generate the next-move choices for the USER now. CURRENT MOMENT outranks the broader scene; the broader scene outranks retrieved memory.`
}

async function resolveConnection(cfg: Config, userId?: string) {
  if (!spindle.permissions.has('generation')) {
    throw new Error('Generation permission is not granted. Enable it for Persona Paths in Lumiverse Extensions.')
  }
  const connections = await spindle.connections.list(userId)
  if (!Array.isArray(connections) || !connections.length) throw new Error('No Lumiverse LLM connection profiles are available.')
  let conn = cfg.connectionId ? connections.find((c: any) => c.id === cfg.connectionId) : null
  if (!conn) conn = connections.find((c: any) => c.is_default) || connections[0]
  return { conn, connections }
}

async function resolveWriterConnection(cfg: Config, userId?: string) {
  const { conn: pathsConn, connections } = await resolveConnection(cfg, userId)
  if (!cfg.writerConnectionId) return { conn: pathsConn, connections, followsPaths: true }
  const writerConn = connections.find((c: any) => c.id === cfg.writerConnectionId)
  return { conn: writerConn || pathsConn, connections, followsPaths: !writerConn }
}

function getKimiTraits(provider: string, model: string) {
  const p = String(provider || '').toLowerCase()
  const m = String(model || '').toLowerCase()
  const isKimi = p.includes('moonshot') || m.startsWith('kimi-')
  const isK3 = isKimi && m.includes('kimi-k3')
  const isK27 = isKimi && m.includes('kimi-k2.7-code')
  const isK26 = isKimi && m.includes('kimi-k2.6')
  const isK25 = isKimi && m.includes('kimi-k2.5')
  return { isKimi, isK3, isK27, isK26, isK25, alwaysThinking: isK3 || isK27 }
}

function buildGenerationTuning(conn: any, model: string, cfg: Config, repair = false) {
  const traits = getKimiTraits(conn?.provider, model)
  const params: Record<string, unknown> = {}
  let reasoning: any = undefined
  let effectiveMaxTokens = cfg.maxTokens

  if (traits.isKimi) {
    // Moonshot's current Kimi families use fixed temperatures. Do not send the
    // generic extension temperature because Kimi rejects non-fixed values.
    // Thinking tokens share the same output budget as final content.
    if (!cfg.useReasoning) {
      if (traits.isK3) {
        // K3 cannot disable thinking. "Reasoning off" in Persona Paths therefore
        // means low-effort reasoning. Set the provider-native field explicitly;
        // raw parameter values take precedence over Lumiverse's translated value.
        params.reasoning_effort = 'low'
        reasoning = { source: 'custom', apiReasoning: true, effort: 'low' }
        effectiveMaxTokens = Math.max(effectiveMaxTokens, 16000)
      } else if (traits.isK27) {
        // K2.7 Code also always thinks and has no effort switch.
        reasoning = { source: 'custom', apiReasoning: true, effort: 'low' }
        effectiveMaxTokens = Math.max(effectiveMaxTokens, 16000)
      } else {
        // K2.6 / K2.5 support a real thinking-off switch.
        reasoning = { source: 'off' }
      }
    } else {
      // If thinking is requested, Kimi needs substantially more room because
      // reasoning_content and content consume the same max-token budget.
      reasoning = { source: 'inherit' }
      effectiveMaxTokens = Math.max(effectiveMaxTokens, 16000)
    }
  } else {
    params.temperature = cfg.temperature
    if (!cfg.useReasoning) reasoning = { source: 'off' }
  }

  if (repair && effectiveMaxTokens > 0) {
    // A length-truncated repair should get more headroom rather than repeating
    // the exact same doomed budget. 32k is within the documented K2.5/K2.6
    // defaults and is modest for K3.
    effectiveMaxTokens = Math.min(Math.max(effectiveMaxTokens * 2, traits.isKimi ? 32000 : effectiveMaxTokens), 64000)
  }

  params.max_tokens = effectiveMaxTokens
  return { params, reasoning, effectiveMaxTokens, traits }
}

async function generatePaths(args: {
  persona: any
  personaOverride: string
  memoryNotes: string[]
  recentUserTurns: any[]
  sceneMessages: any[]
  storyMemory: StoryMemoryContext
  regenerationGuidance?: string
  rejectedChoices?: Choice[]
}, userId?: string) {
  const { conn } = await resolveConnection(config, userId)
  const system = buildSystemPrompt(config)
  const user = buildUserPrompt({
    ...args,
    globalInstructions: config.globalInstructions,
  })
  const model = config.modelOverride.trim() || conn.model
  const tuning = buildGenerationTuning(conn, model, config, false)

  const request: any = {
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
  }
  if (tuning.reasoning) request.reasoning = tuning.reasoning

  if (tuning.traits.isKimi) {
    spindle.log.info(`Persona Paths Kimi tuning: model=${model}, max_tokens=${tuning.effectiveMaxTokens}, reasoning=${config.useReasoning ? 'connection' : (tuning.traits.alwaysThinking ? 'low/always-on' : 'off')}`)
  }

  let response = await spindle.generate.raw(request)
  let responseText = String(response?.content || '').trim()
  let parsed: PathResult
  try {
    parsed = parseJsonObject(responseText)
  } catch (err: any) {
    parsed = null as any
  }

  if (parsed && Array.isArray(parsed.choices)) {
    parsed.choices = parsed.choices.map((choice: any) => ({
      ...choice,
      text: cleanGeneratedChoiceText(choice?.text),
      intensity: Number(choice?.intensity),
      advances_scene: choice?.advances_scene === true,
    }))
  }
  let issues = validateResult(parsed, config.choiceCount, config.detail)
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
      : '(The previous attempt returned no usable final content.)'

    const repairUser = `${user}

REPAIR PASS
The previous attempt did not satisfy the required JSON contract. Problems detected: ${issues.join('; ')}.

PREVIOUS OUTPUT (reference only; it may be empty, malformed, or truncated):
${priorForRepair}

Generate the answer again from scratch. Return one corrected JSON object only. Preserve strong persona fidelity, concrete action, distinct trajectories, the selected POV/tense, and the authorship boundary. Do not mention this repair pass.`

    const repairTuning = buildGenerationTuning(conn, model, config, response?.finish_reason === 'length')
    const repairRequest: any = {
      ...request,
      parameters: repairTuning.params,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: repairUser },
      ],
    }
    if (repairTuning.reasoning) repairRequest.reasoning = repairTuning.reasoning
    else delete repairRequest.reasoning

    response = await spindle.generate.raw(repairRequest)
    responseText = String(response?.content || '').trim()
    if (!responseText) {
      throw new Error(`CYOA provider returned empty content twice${response?.finish_reason ? ` (finish reason: ${response.finish_reason})` : ''}. Persona Paths already expanded the retry budget; if this is an always-thinking model, try another model or enable a larger manual Max output token budget.`)
    }

    try {
      parsed = parseJsonObject(responseText)
    } catch (err: any) {
      throw new Error(`CYOA repair response was not valid JSON${response?.finish_reason ? ` (finish reason: ${response.finish_reason})` : ''}.`)
    }
    if (parsed && Array.isArray(parsed.choices)) {
      parsed.choices = parsed.choices.map((choice: any) => ({
        ...choice,
        text: cleanGeneratedChoiceText(choice?.text),
        advances_scene: choice?.advances_scene === true,
      }))
    }
    issues = validateResult(parsed, config.choiceCount, config.detail)
  }

  if (issues.length) throw new Error(`CYOA output failed validation after repair: ${issues.join('; ')}`)

  parsed.choices = parsed.choices.map((choice: any) => ({
    intent: String(choice.intent || '').trim(),
    title: String(choice.title || '').trim(),
    text: cleanGeneratedChoiceText(choice.text),
    intensity: Math.max(1, Math.min(3, Math.round(Number(choice?.intensity) || 2))) as 1 | 2 | 3,
    advances_scene: choice?.advances_scene === true,
  }))
  parsed.scene_state = {
    location: String(parsed.scene_state?.location || '').trim(),
    moment: String(parsed.scene_state?.moment || '').trim(),
  }
  parsed.relationship_updates = Array.isArray(parsed.relationship_updates)
    ? parsed.relationship_updates.map((item: any) => ({
        subject: String(item?.subject || '').trim(),
        notes: Array.isArray(item?.notes) ? item.notes.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 6) : [],
      })).filter((item: any) => item.subject && item.notes.length).slice(0, 4)
    : []
  parsed.style = {
    pov: ['first', 'second', 'third'].includes(String(parsed.style?.pov)) ? String(parsed.style?.pov) : (config.pov === 'auto' ? 'first' : config.pov),
    tense: ['present', 'past'].includes(String(parsed.style?.tense)) ? String(parsed.style?.tense) : (config.tense === 'auto' ? 'present' : config.tense),
  }
  return parsed
}

function buildUserWriterSystemPrompt(cfg: Config, hasDraft: boolean) {
  const requestedPov = cfg.pov === 'auto'
    ? (hasDraft ? 'Preserve the POV/person used in the DRAFT. If the draft is ambiguous, infer it from recent USER turns.' : 'Infer POV/person from recent USER turns; default to first person if ambiguous.')
    : `Keep the rewritten draft in ${cfg.pov} person unless the human deliberately wrote otherwise.`
  const requestedTense = cfg.tense === 'auto'
    ? (hasDraft ? 'Preserve the tense used in the DRAFT. If ambiguous, infer it from recent USER turns.' : 'Infer tense from recent USER turns; default to present tense if ambiguous.')
    : `Keep the rewritten draft in ${cfg.tense} tense unless the human deliberately wrote otherwise.`

  const task = hasDraft
    ? `Rewrite a HUMAN PLAYER'S partially edited role-play response into one smooth, paste-ready USER turn. The human may have selected one or more Persona Paths suggestions, manually changed them, added new ideas, or written the whole draft themselves. Their draft is the authority for WHAT they intend to do.`
    : `Write the HUMAN PLAYER'S next in-character role-play turn from scratch. Use the current scene, persona, recent portrayal, guidance, and story memory to produce a plausible user-side continuation. Do not write the assistant/NPC side of the scene.`

  return `You are Persona Paths User Writer. ${task}

PRESERVATION RULES
- Preserve every meaningful decision, action, intention, factual assertion, named person, destination, refusal, promise, emotional choice, and user-added idea in the draft unless it is an obvious duplicate caused by concatenating Paths.
- Smooth transitions, remove accidental repetition, reconcile pronouns, and make combined fragments read like one naturally authored turn.
- When a draft exists, do NOT replace the human's idea with a different or "better" choice. This is rewriting, not next-move generation.
- When no draft exists, choose a plausible in-character direction that responds directly to CURRENT MOMENT; do not merely summarize the scene.
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
- Spoken dialogue must use “double curly quotation marks” (or straight double quotes if already present), never ‘single curly dialogue quotes’.
- Direct inner thoughts are optional and rare; format them as *single-asterisk italics*, never quotation marks.
- Preserve the scene/draft's established explicitness rather than sanitizing or gratuitously escalating it.
- Return ONLY the finished USER turn as plain Markdown text. No JSON, title, label, explanation, critique, notes, or quotation fence.`
}

function buildUserWriterPrompt(args: {
  persona: any
  personaOverride: string
  memoryNotes: string[]
  recentUserTurns: any[]
  sceneMessages: any[]
  storyMemory: StoryMemoryContext
  draft: string
  direction?: string
  sourceIntents?: string[]
}) {
  const personaBlock = args.persona
    ? `NAME: ${args.persona.name || 'Unnamed'}\nTITLE: ${args.persona.title || ''}\nDESCRIPTION:\n${compactText(args.persona.description || '(none)', 6000)}`
    : 'No active persona card is available. Infer the player persona from recent USER turns.'
  const examples = args.recentUserTurns.length
    ? args.recentUserTurns.map((m, i) => `USER EXAMPLE ${i + 1}:\n${compactTextPreserveEnds(cleanRoleplayText(m.content), 2200, 0.58)}`).join('\n\n')
    : '(none)'
  const newestIndex = args.sceneMessages.length - 1
  const scene = args.sceneMessages.map((m, i) => {
    const cleaned = cleanRoleplayText(m.content)
    const isNewestAssistant = i === newestIndex && m.role === 'assistant'
    return `${m.role === 'user' ? 'USER' : 'ASSISTANT'}:\n${isNewestAssistant ? compactTextPreserveEnds(cleaned, 7600, 0.76) : compactTextPreserveEnds(cleaned, 2600, 0.58)}`
  }).join('\n\n')
  const latestAssistant = [...args.sceneMessages].reverse().find((m: any) => m?.role === 'assistant')
  const currentMoment = latestAssistant ? compactTailText(cleanRoleplayText(latestAssistant.content), 5000) : '(none)'
  const memory = [
    args.storyMemory.arc ? `ACTIVE ARC:\n${args.storyMemory.arc}` : '',
    args.storyMemory.memories.length ? `RELEVANT HISTORY:\n${args.storyMemory.memories.slice(0, 5).map((x, i) => `${i + 1}. ${x}`).join('\n')}` : '',
    args.storyMemory.relationships.length ? `RELATIONSHIPS:\n${args.storyMemory.relationships.slice(0, 6).join('\n')}` : '',
  ].filter(Boolean).join('\n\n') || '(none retrieved)'

  return `PLAYER PERSONA\n${personaBlock}

PERSONA-SPECIFIC GUIDANCE\n${String(args.personaOverride || '').trim() || '(none)'}

PRIVATE RELATIONSHIP NOTES\n${args.memoryNotes.length ? args.memoryNotes.map(x => `- ${x}`).join('\n') : '(none)'}

RELEVANT MEMORY CORTEX CONTINUITY\n${memory}

RECENT EXAMPLES OF THE HUMAN'S VOICE\n${examples}

CURRENT ROLE-PLAY SCENE\n${scene}

CURRENT MOMENT — END OF LATEST ASSISTANT REPLY\n${currentMoment}

${String(args.direction || '').trim() ? `ONE-SHOT WRITING DIRECTION FROM THE HUMAN\n${String(args.direction || '').trim()}\n` : ''}
${Array.isArray(args.sourceIntents) && args.sourceIntents.length ? `SOURCE PATH INTENTS TO PRESERVE\n${args.sourceIntents.slice(0, 6).map((x, i) => `#${i + 1}: ${x}`).join('\n')}\n` : ''}
${String(args.draft || '').trim()
  ? `DRAFT TO REWRITE — PRESERVE ITS INTENT AND CONTENT\n${String(args.draft || '').trim()}\n\nRewrite that draft into one seamless USER turn. Preserve the human's choices and added ideas; fix prose, flow, duplicated seams, and voice only.`
  : `NO DRAFT WAS PROVIDED.\nWrite one complete, paste-ready USER turn from scratch. Respond directly to CURRENT MOMENT, stay faithful to the persona and relationship context, and do not invent NPC/world outcomes.`}`
}
async function handleUserWriter(chatId: string, messageId: string, draft: string, direction = '', sourceIntents: string[] = [], userId?: string) {
  const cleanDraft = cleanGeneratedChoiceText(draft)
  const cleanDirection = String(direction || '').trim()
  if (!chatId || !messageId) throw new Error('Persona Paths needs the current chat and assistant reply for User Writer.')

  const messages = await spindle.chat.getMessages(chatId)
  const target = messages.find((m: any) => String(m?.id || '') === messageId)
  if (!target || target.role !== 'assistant') throw new Error('The assistant reply associated with this Persona Paths card is no longer available.')

  const oocMessageIds = config.skipOoc ? collectOocMessageIds(messages) : new Set<string>()
  const persona = await resolvePersona(chatId, userId)
  const personaId = persona?.id || 'no_persona'
  const memoryKey = `${chatId}::${personaId}`
  const storedMemory = relationshipMemory[memoryKey]
  const memoryNotes = config.relationshipMemory && storedMemory
    ? Object.entries(storedMemory.subjects || {}).map(([subject, notes]) => `${subject}: ${(notes || []).join('; ')}`).slice(0, 12)
    : []

  const storyMessages = messages.filter((m: any) =>
    (m.role === 'user' || m.role === 'assistant') && (!config.skipOoc || !oocMessageIds.has(String(m.id || '')))
  )
  const targetIsOoc = config.skipOoc && oocMessageIds.has(messageId)
  const targetIndex = storyMessages.findIndex((m: any) => String(m?.id || '') === messageId)
  const throughTarget = targetIndex >= 0 ? storyMessages.slice(0, targetIndex + 1) : storyMessages
  // User Writer is a manual tool, so OOC suppression must never make it unusable.
  // Keep OOC out of portrayal examples / Cortex query context, but allow the
  // explicitly targeted latest assistant reply to be the immediate Current Moment.
  const cleanSceneMessages = throughTarget.slice(-config.contextMessages)
  const sceneMessages = targetIsOoc && !cleanSceneMessages.some((m: any) => String(m?.id || '') === messageId)
    ? [...cleanSceneMessages.slice(-(Math.max(1, config.contextMessages - 1))), target]
    : cleanSceneMessages
  const recentUserTurns = throughTarget.filter((m: any) => m.role === 'user').slice(-config.recentUserExamples)
  const firstSceneMessageId = String(sceneMessages[0]?.id || '')
  const recentSceneStartIndex = firstSceneMessageId
    ? messages.findIndex((m: any) => String(m?.id || '') === firstSceneMessageId)
    : -1
  const storyMemory = await retrieveStoryMemoryContext(
    chatId, userId, messages, oocMessageIds, recentSceneStartIndex, cleanSceneMessages, persona,
  )

  const { conn } = await resolveWriterConnection(config, userId)
  const model = config.writerModelOverride.trim() || conn.model
  const writerConfig = {
    ...config,
    temperature: config.writerTemperature,
    maxTokens: config.writerMaxTokens,
    useReasoning: config.writerUseReasoning,
  } as Config
  const tuning = buildGenerationTuning(conn, model, writerConfig, false)

  const request: any = {
    provider: conn.provider,
    model,
    connection_id: conn.id,
    userId,
    messages: [
      { role: 'system', content: buildUserWriterSystemPrompt(config, !!cleanDraft) },
      { role: 'user', content: buildUserWriterPrompt({
          persona,
          personaOverride: persona?.id ? (config.personaOverrides[persona.id] || '') : '',
          memoryNotes,
          recentUserTurns,
          sceneMessages,
          storyMemory,
          draft: cleanDraft,
          direction: cleanDirection,
          sourceIntents,
        }) },
    ],
    parameters: tuning.params,
  }
  if (tuning.reasoning) request.reasoning = tuning.reasoning

  const response = await spindle.generate.raw(request)
  const raw = String(response?.content || '').trim()
  if (!raw) throw new Error(`User Writer model returned no final content${response?.finish_reason ? ` (finish reason: ${response.finish_reason})` : ''}.`)
  const rewritten = cleanGeneratedChoiceText(stripFences(raw))
  if (!rewritten) throw new Error('User Writer model returned an empty response.')

  spindle.sendToFrontend({ type: 'draft_rewrite_ready', chatId, messageId, text: rewritten, writerMode: cleanDraft ? 'rewrite' : 'write' }, userId)
  try { spindle.toast.success(cleanDraft ? 'Draft polished.' : 'Draft written.') } catch {}
}

async function handleAssistantMessage(chatId: string, messageId: string, force = false, userId?: string, regenerationGuidance = '', saveAsPersonaGuidance = false, allowOocOverride = false) {
  if (!config.enabled && !force) return
  const key = `${chatId}:${messageId}`
  if (inFlight.has(key)) return
  inFlight.add(key)

  try {
    const messages = await spindle.chat.getMessages(chatId)
    const target = messages.find((m: any) => m.id === messageId)
    if (!target || target.role !== 'assistant') return

    const persona = await resolvePersona(chatId, userId)
    const personaId = persona?.id || 'no_persona'
    const oocMessageIds = config.skipOoc ? collectOocMessageIds(messages) : new Set<string>()
    const targetIsOoc = config.skipOoc && oocMessageIds.has(messageId)
    if (targetIsOoc && !allowOocOverride) {
      const existingForced = cache[messageId]
      const currentHash = hashText(String(target.content || ''))
      if (existingForced?.oocForced && existingForced.personaId === personaId && existingForced.contentHash === currentHash) {
        // Restoring a choice set the human explicitly forced is not the same as
        // automatically generating on OOC. Keep that manual decision durable.
        spindle.sendToFrontend({ type: 'choices_ready', data: existingForced }, userId)
        return
      }
      if (cache[messageId]) {
        delete cache[messageId]
        await saveCache()
      }
      spindle.log.info(`Persona Paths skipped OOC exchange for ${messageId}.`)
      spindle.sendToFrontend({ type: 'choices_skipped', chatId, messageId, reason: 'ooc' }, userId)
      return
    }

    const contentHash = hashText(String(target.content || ''))
    const existing = cache[messageId]
    const rejectedChoices = force && String(regenerationGuidance || '').trim() && existing?.choices
      ? existing.choices.map(choice => ({ ...choice }))
      : []
    if (!force && existing && existing.personaId === personaId && existing.contentHash === contentHash) {
      spindle.sendToFrontend({ type: 'choices_ready', data: existing }, userId)
      return
    }

    spindle.sendToFrontend({ type: 'choices_loading', chatId, messageId }, userId)

    const cleanGuidance = String(regenerationGuidance || '').trim()
    if (saveAsPersonaGuidance && cleanGuidance) {
      if (!persona?.id) throw new Error('An active persona is required to save regeneration guidance.')
      const previous = String(config.personaOverrides[persona.id] || '').trim()
      const duplicate = previous
        .split(/\n+/)
        .map(line => line.replace(/^[-•]\s*/, '').trim().toLowerCase())
        .filter(Boolean)
        .includes(cleanGuidance.toLowerCase())
      if (!duplicate) {
        config.personaOverrides[persona.id] = previous ? `${previous}\n${cleanGuidance}` : cleanGuidance
        await saveConfig()
      }
      spindle.sendToFrontend({
        type: 'persona_guidance_saved',
        personaId: persona.id,
        messageId,
        text: config.personaOverrides[persona.id] || '',
      }, userId)
    }
    const personaOverride = persona?.id ? (config.personaOverrides[persona.id] || '') : ''
    const memoryKey = `${chatId}::${personaId}`
    const storedMemory = relationshipMemory[memoryKey]
    const memoryNotes = config.relationshipMemory && storedMemory
      ? Object.entries(storedMemory.subjects || {}).map(([subject, notes]) => `${subject}: ${(notes || []).join('; ')}`).slice(0, 12)
      : []

    // Deliberately exclude system messages. Persona Paths observes the played story,
    // not preset/system instructions that may contain unrelated hidden context.
    const storyMessages = messages.filter((m: any) =>
      (m.role === 'user' || m.role === 'assistant') && (!config.skipOoc || !oocMessageIds.has(String(m.id || '')))
    )

    // OOC protection is an automation guard, not a hard prohibition. A manual/explicit
    // run may target an OOC assistant reply, but OOC turns still stay out of portrayal
    // examples, Cortex/long-term-memory query context, and relationship learning.
    let throughTarget: any[]
    if (targetIsOoc && allowOocOverride) {
      const originalTargetIndex = messages.findIndex((m: any) => String(m?.id || '') === messageId)
      const priorNormal = originalTargetIndex >= 0
        ? messages.slice(0, originalTargetIndex).filter((m: any) =>
            (m.role === 'user' || m.role === 'assistant') && !oocMessageIds.has(String(m.id || ''))
          )
        : storyMessages
      const preceding = originalTargetIndex > 0 ? messages[originalTargetIndex - 1] : null
      const forcedExchange = preceding && preceding.role === 'user' && oocMessageIds.has(String(preceding.id || ''))
        ? [preceding, target]
        : [target]
      throughTarget = [...priorNormal, ...forcedExchange]
      spindle.log.info(`Persona Paths manually overriding OOC guard for ${messageId}.`)
    } else {
      const targetIndex = storyMessages.findIndex((m: any) => m.id === messageId)
      throughTarget = targetIndex >= 0 ? storyMessages.slice(0, targetIndex + 1) : storyMessages
    }

    const sceneMessages = throughTarget.slice(-config.contextMessages)
    const recentUserTurns = throughTarget
      .filter((m: any) => m.role === 'user' && (!config.skipOoc || !oocMessageIds.has(String(m.id || ''))))
      .slice(-config.recentUserExamples)

    const memorySceneMessages = sceneMessages.filter((m: any) => !oocMessageIds.has(String(m.id || '')))
    const firstSceneMessageId = String((memorySceneMessages[0] || sceneMessages[0])?.id || '')
    const recentSceneStartIndex = firstSceneMessageId
      ? messages.findIndex((m: any) => String(m?.id || '') === firstSceneMessageId)
      : -1
    const storyMemory = await retrieveStoryMemoryContext(
      chatId,
      userId,
      messages,
      oocMessageIds,
      recentSceneStartIndex,
      memorySceneMessages.length ? memorySceneMessages : sceneMessages,
      persona,
    )

    const prismInfo = await resolvePrismInfo(chatId, userId, persona, throughTarget)

    const result = await generatePaths({
      persona,
      personaOverride,
      memoryNotes,
      recentUserTurns,
      sceneMessages,
      storyMemory,
      regenerationGuidance: cleanGuidance,
      rejectedChoices,
    }, userId)

    const entry: CachedPath = {
      chatId,
      messageId,
      contentHash,
      personaId,
      style: result.style as any,
      sceneState: {
        location: String(result.scene_state?.location || '').trim(),
        moment: String(result.scene_state?.moment || '').trim(),
      },
      choices: result.choices,
      prismColor: prismInfo.color || undefined,
      oocForced: targetIsOoc && allowOocOverride ? true : undefined,
      createdAt: Date.now(),
    }
    cache[messageId] = entry
    await saveCache()

    if (config.relationshipMemory && result.relationship_updates?.length && !(targetIsOoc && allowOocOverride)) {
      const previousSubjects = relationshipMemory[memoryKey]?.subjects || {}
      const nextSubjects: Record<string, string[]> = { ...previousSubjects }
      for (const update of result.relationship_updates) {
        const existingKey = Object.keys(nextSubjects).find(k => k.toLowerCase() === update.subject.toLowerCase())
        const keyName = existingKey || update.subject
        nextSubjects[keyName] = update.notes
      }
      const trimmedSubjects = Object.fromEntries(Object.entries(nextSubjects).slice(-16))
      relationshipMemory[memoryKey] = {
        subjects: trimmedSubjects,
        updatedAt: Date.now(),
        messageId,
      }
      await saveRelationshipMemory()
    }

    spindle.sendToFrontend({ type: 'choices_ready', data: entry }, userId)
  } catch (err: any) {
    const message = err?.message || String(err)
    spindle.log.error(`Persona Paths failed for ${messageId}: ${message}`)
    spindle.sendToFrontend({ type: 'choices_error', chatId, messageId, error: message }, userId)
  } finally {
    inFlight.delete(key)
  }
}

function personaSelectionKey(chatId: string, userId?: string) {
  return JSON.stringify([userId || '', chatId])
}

async function resolvePersona(chatId: string, userId?: string) {
  const id = config.chatPersonas[personaSelectionKey(chatId, userId)]
  if (!id) return spindle.personas.getActive(userId)
  const persona = await spindle.personas.get(id, userId)
  if (!persona) throw new Error('The selected persona is unavailable. Choose another persona or Use Lumiverse active persona.')
  return persona
}

async function listPersonas(userId?: string) {
  const personas: any[] = []
  for (let offset = 0; ; ) {
    const page = await spindle.personas.list({ userId, limit: 100, offset })
    const data = page?.data || []
    personas.push(...data)
    offset += data.length
    if (!data.length || offset >= page.total) break
  }
  return personas.map(({ id, name, title }) => ({ id, name, title }))
}

async function sendState(userId?: string) {
  const generationGranted = spindle.permissions.has('generation')
  const memoriesGranted = spindle.permissions.has('memories')
  const corsGranted = spindle.permissions.has('cors_proxy')
  let connections: any[] = []
  let connectionError = ''

  if (!generationGranted) {
    connectionError = 'Generation permission is not granted to Persona Paths.'
  } else {
    try {
      // Explicitly carry the frontend caller's user scope into the connection lookup.
      // This matters in runtimes where an ambient user cannot be inferred reliably.
      const listed = await spindle.connections.list(userId)
      connections = Array.isArray(listed) ? listed : []
      if (!connections.length) connectionError = 'Lumiverse returned zero LLM connection profiles for this user.'
    } catch (err: any) {
      connectionError = err?.message || String(err)
      spindle.log.error(`Persona Paths connection lookup failed: ${connectionError}`)
    }
  }

  let persona: any = null
  let personas: any[] = []
  let activeChatId = ''
  let personaListError = ''
  try { personas = await listPersonas(userId) } catch (err: any) { personaListError = err?.message || String(err) }
  let personaError = ''
  try {
    activeChatId = String((await spindle.chats.getActive(userId))?.id || '')
    persona = await resolvePersona(activeChatId, userId)
  } catch (err: any) {
    personaError = err?.message || String(err)
    spindle.log.error(`Persona Paths active persona lookup failed: ${personaError}`)
  }

  let prismInfo: any = { mode: config.prismIntegration, available: false, color: '', source: '', status: config.prismIntegration === 'off' ? 'Prism integration is off.' : 'Open a chat to detect Prism.' }
  if (persona && config.prismIntegration === 'manual') {
    prismInfo = await resolvePrismInfo('', userId, persona, [])
  } else if (config.prismIntegration === 'auto' && persona && spindle.permissions.has('chats')) {
    try {
      const activeChat = await spindle.chats.getActive(userId)
      if (activeChat?.id) {
        const activeMessages = await spindle.chat.getMessages(activeChat.id)
        prismInfo = await resolvePrismInfo(String(activeChat.id), userId, persona, activeMessages)
      }
    } catch (err: any) {
      prismInfo = { mode: 'auto', available: false, color: '', source: '', status: `Prism detection unavailable: ${err?.message || String(err)}` }
    }
  }

  spindle.sendToFrontend({
    type: 'state',
    config,
    connections,
    generationGranted,
    memoriesGranted,
    corsGranted,
    connectionError,
    personaError,
    personaListError,
    personas,
    activeChatId,
    selectedPersonaId: config.chatPersonas[personaSelectionKey(activeChatId, userId)] || '',
    prismInfo,
    activePersona: persona ? { id: persona.id, name: persona.name, title: persona.title || '' } : null,
  }, userId)
}

spindle.onFrontendMessage(async (payload: any, userId: string) => {
  try {
    if (!payload || typeof payload !== 'object') return

    if (payload.type === 'get_state') {
      await sendState(userId)
      return
    }

    if (payload.type === 'get_openrouter_models') {
      try {
        const catalog = await getOpenRouterModels(!!payload.force)
        spindle.sendToFrontend({
          type: 'openrouter_models',
          models: catalog.models,
          fetchedAt: catalog.fetchedAt,
          cached: catalog.cached,
        }, userId)
      } catch (err: any) {
        const message = err?.message || String(err)
        spindle.log.warn(`Persona Paths OpenRouter catalog unavailable: ${message}`)
        spindle.sendToFrontend({ type: 'openrouter_models_error', error: message }, userId)
      }
      return
    }

    if (payload.type === 'save_config') {
      config = normalizeConfig({ ...config, ...(payload.patch || {}) })
      await saveConfig()
      await sendState(userId)
      return
    }

    if (payload.type === 'set_chat_persona') {
      const chatId = String(payload.chatId || '')
      const activeChat = await spindle.chats.getActive(userId)
      if (!chatId || activeChat?.id !== chatId) throw new Error('The chat changed. Refresh the persona selection.')
      const personaId = String(payload.personaId || '')
      if (personaId && !(await spindle.personas.get(personaId, userId))) throw new Error('That persona is unavailable.')
      if (Array.from(inFlight).some(key => key.startsWith(`${chatId}:`))) throw new Error('Wait for generation to finish before changing persona.')
      const key = personaSelectionKey(chatId, userId)
      if (personaId) config.chatPersonas[key] = personaId
      else delete config.chatPersonas[key]
      for (const [id, entry] of Object.entries(cache)) {
        if (entry.chatId === chatId) delete cache[id]
      }
      await saveConfig()
      await saveCache()
      spindle.sendToFrontend({ type: 'persona_selection_changed', chatId }, userId)
      await sendState(userId)
      return
    }

    if (payload.type === 'set_persona_override') {
      const personaId = String(payload.personaId || '')
      if (personaId) {
        config.personaOverrides[personaId] = String(payload.text || '')
        await saveConfig()
      }
      await sendState(userId)
      return
    }

    if (payload.type === 'set_prism_color_override') {
      const personaId = String(payload.personaId || '')
      if (personaId) {
        const color = normalizeHex(payload.color)
        if (color) config.prismColorOverrides[personaId] = color
        else delete config.prismColorOverrides[personaId]
        await saveConfig()
      }
      await sendState(userId)
      return
    }

    if (payload.type === 'load_choices') {
      const ids = Array.isArray(payload.messageIds) ? payload.messageIds.map(String) : [String(payload.messageId || '')]
      const grouped = new Map<string, string[]>()
      for (const id of ids) {
        const entry = id ? cache[id] : null
        if (!entry) continue
        const list = grouped.get(entry.chatId) || []
        list.push(id)
        grouped.set(entry.chatId, list)
      }

      let cacheChanged = false
      for (const [chatId, messageIds] of grouped) {
        const personaId = (await resolvePersona(chatId, userId))?.id || 'no_persona'
        let blocked = new Set<string>()
        if (config.skipOoc) {
          try {
            const messages = await spindle.chat.getMessages(chatId)
            blocked = collectOocMessageIds(messages)
          } catch (err: any) {
            spindle.log.warn(`Persona Paths could not verify OOC state while restoring cached choices: ${err?.message || String(err)}`)
          }
        }
        for (const id of messageIds) {
          if (config.skipOoc && blocked.has(id) && !cache[id]?.oocForced) {
            delete cache[id]
            cacheChanged = true
            spindle.sendToFrontend({ type: 'choices_skipped', chatId, messageId: id, reason: 'ooc' }, userId)
          } else if (cache[id]?.personaId === personaId) {
            spindle.sendToFrontend({ type: 'choices_ready', data: cache[id] }, userId)
          }
        }
      }
      if (cacheChanged) await saveCache()
      return
    }

    if (payload.type === 'ensure_choices') {
      const chatId = String(payload.chatId || '')
      const messageId = String(payload.messageId || '')
      if (!userId) throw new Error('Persona Paths could not resolve the current Lumiverse user for CYOA generation.')
      if (chatId && messageId) await handleAssistantMessage(chatId, messageId, false, userId)
      return
    }

    if (payload.type === 'regenerate') {
      const chatId = String(payload.chatId || '')
      const messageId = String(payload.messageId || '')
      if (chatId && messageId) await handleAssistantMessage(chatId, messageId, true, userId, '', false, true)
      return
    }

    if (payload.type === 'regenerate_with_guidance') {
      const chatId = String(payload.chatId || '')
      const messageId = String(payload.messageId || '')
      const guidance = String(payload.guidance || '').trim()
      const saveAsPersonaGuidance = !!payload.saveAsPersonaGuidance
      if (!chatId || !messageId) throw new Error('A chat and assistant reply are required for guided regeneration.')
      if (!guidance) throw new Error('Enter some guidance before regenerating Persona Paths.')
      await handleAssistantMessage(chatId, messageId, true, userId, guidance, saveAsPersonaGuidance, true)
      return
    }

    if (payload.type === 'rewrite_draft' || payload.type === 'user_writer') {
      const chatId = String(payload.chatId || '')
      const messageId = String(payload.messageId || '')
      const draft = String(payload.draft || '')
      const direction = String(payload.direction || '')
      const sourceIntents = Array.isArray(payload.sourceIntents) ? payload.sourceIntents.map((x: any) => String(x)).filter(Boolean).slice(0, 6) : []
      try {
        await handleUserWriter(chatId, messageId, draft, direction, sourceIntents, userId)
      } catch (err: any) {
        const message = err?.message || String(err)
        spindle.log.error(`Persona Paths User Writer failed: ${message}`)
        try { spindle.toast.error(message, { title: 'User Writer' }) } catch {}
        spindle.sendToFrontend({ type: 'draft_rewrite_error', chatId, messageId, error: message }, userId)
      }
      return
    }

    if (payload.type === 'manual_rewrite_latest' || payload.type === 'manual_user_writer_latest') {
      const draft = String(payload.draft || '')
      const direction = String(payload.direction || '')
      const sourceIntents = Array.isArray(payload.sourceIntents) ? payload.sourceIntents.map((x: any) => String(x)).filter(Boolean).slice(0, 6) : []
      try {
        if (!spindle.permissions.has('chats')) throw new Error('The Chats permission is required to resolve the active chat for User Writer.')
        const activeChat = await spindle.chats.getActive(userId)
        if (!activeChat?.id) throw new Error('Open a Lumiverse chat before using User Writer.')
        const messages = await spindle.chat.getMessages(activeChat.id)
        const latestAssistant = [...messages].reverse().find((m: any) => m?.role === 'assistant' && String(m?.content || '').trim())
        if (!latestAssistant?.id) throw new Error('The active chat does not have an assistant reply to anchor User Writer.')
        await handleUserWriter(String(activeChat.id), String(latestAssistant.id), draft, direction, sourceIntents, userId)
      } catch (err: any) {
        const message = err?.message || String(err)
        spindle.log.error(`Persona Paths manual User Writer failed: ${message}`)
        try { spindle.toast.error(message, { title: 'User Writer' }) } catch {}
        spindle.sendToFrontend({ type: 'draft_rewrite_error', error: message }, userId)
      }
      return
    }

    if (payload.type === 'resolve_writer_latest') {
      if (!spindle.permissions.has('chats')) throw new Error('The Chats permission is required to resolve the active chat for User Writer.')
      const activeChat = await spindle.chats.getActive(userId)
      if (!activeChat?.id) throw new Error('Open a Lumiverse chat before using User Writer.')
      const messages = await spindle.chat.getMessages(activeChat.id)
      const latestAssistant = [...messages].reverse().find((m: any) => m?.role === 'assistant' && String(m?.content || '').trim())
      if (!latestAssistant?.id) throw new Error('The active chat does not have an assistant reply to anchor User Writer.')
      spindle.sendToFrontend({ type: 'writer_anchor', chatId: String(activeChat.id), messageId: String(latestAssistant.id) }, userId)
      return
    }

    if (payload.type === 'manual_generate_latest') {
      if (!userId) throw new Error('Persona Paths could not resolve the current Lumiverse user for manual generation.')
      if (!spindle.permissions.has('chats')) {
        throw new Error('The Chats permission is required for manual generation so Persona Paths can resolve the active chat after a refresh.')
      }

      const activeChat = await spindle.chats.getActive(userId)
      if (!activeChat?.id) throw new Error('Open a Lumiverse chat before running Persona Paths manually.')

      const messages = await spindle.chat.getMessages(activeChat.id)
      const latestAssistant = [...messages].reverse().find((m: any) =>
        m?.role === 'assistant' && String(m?.content || '').trim().length > 0
      )
      if (!latestAssistant?.id) throw new Error('The active chat does not have an assistant reply to generate paths for yet.')

      const manualOocIds = config.skipOoc ? collectOocMessageIds(messages) : new Set<string>()
      const isOocOverride = config.skipOoc && manualOocIds.has(String(latestAssistant.id))

      spindle.sendToFrontend({
        type: 'manual_target',
        chatId: activeChat.id,
        messageId: latestAssistant.id,
        oocOverride: isOocOverride,
      }, userId)

      // Force=true deliberately replaces/retries any cached result for this reply and
      // bypasses the automatic-generation enabled toggle. allowOocOverride=true makes
      // the manual action authoritative even when the latest exchange is tagged OOC.
      await handleAssistantMessage(activeChat.id, String(latestAssistant.id), true, userId, '', false, true)
      return
    }

    if (payload.type === 'clear_relationship_memory') {
      relationshipMemory = {}
      await saveRelationshipMemory()
      spindle.sendToFrontend({ type: 'memory_cleared' }, userId)
      return
    }
  } catch (err: any) {
    const error = err?.message || String(err)
    spindle.log.error(`Frontend request failed: ${error}`)
    if (payload?.type === 'manual_generate_latest') {
      spindle.sendToFrontend({ type: 'manual_error', error }, userId)
    } else {
      spindle.sendToFrontend({ type: 'request_error', error }, userId)
      if (payload?.type === 'set_chat_persona') await sendState(userId)
    }
  }
})

// CYOA generation triggers are intentionally received from the frontend via
// onFrontendMessage so operator-scoped installs always carry the active userId.
// The frontend listens to GENERATION_ENDED and MESSAGE_SWIPED.

spindle.permissions.onChanged(({ permission }) => {
  // Permission-change callbacks do not carry a userId. For an operator-scoped
  // extension, do not call user-scoped APIs from here. The panel's Refresh
  // button/get_state request provides the frontend user's scope safely.
  if (permission === 'generation') {
    spindle.log.info('Persona Paths generation permission changed; refresh the panel to reload connections.')
  } else if (permission === 'cors_proxy') {
    spindle.log.info('Persona Paths CORS Proxy permission changed; refresh the panel to reload the OpenRouter model catalog.')
  } else if (permission === 'memories') {
    spindle.log.info('Persona Paths Memory Cortex permission changed; refresh the panel to update Cortex status.')
  }
})

void loadState().then(() => {
  spindle.log.info('Persona Paths loaded — private CYOA context is isolated from normal prompt assembly.')
}).catch((err: any) => {
  spindle.log.error(`Persona Paths state load failed: ${err?.message || String(err)}`)
})

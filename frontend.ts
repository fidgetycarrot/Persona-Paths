type Ctx = any

const EXT_VERSION = '0.1.8'
const PATHS_ICON = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 4v5a3 3 0 0 0 3 3h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6 20v-3a5 5 0 0 1 5-5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m15 8 4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="4" r="2" fill="currentColor"/></svg>`

type Choice = { intent: string; title: string; text: string }
type CachedPath = {
  chatId: string
  messageId: string
  style: { pov: string; tense: string }
  choices: Choice[]
}

function createLabeledField(ctx: Ctx, label: string, control: HTMLElement, hint?: string) {
  const wrap = ctx.dom.createElement('label', { class: 'pp-field' }) as HTMLElement
  const title = ctx.dom.createElement('span', { class: 'pp-label' }) as HTMLElement
  title.textContent = label
  wrap.appendChild(title)
  wrap.appendChild(control)
  if (hint) {
    const h = ctx.dom.createElement('span', { class: 'pp-hint' }) as HTMLElement
    h.textContent = hint
    wrap.appendChild(h)
  }
  return wrap
}

function setNativeValue(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
  if (descriptor?.set) descriptor.set.call(el, value)
  else (el as any).value = value
}

async function fillComposer(text: string) {
  const selectors = [
    '[data-component="InputArea"] textarea[name="chat-message"]',
    '[data-component="InputArea"] textarea',
    'textarea[name="chat-message"]',
    '[data-component="InputArea"] [contenteditable="true"]',
  ]
  const el = selectors.map(s => document.querySelector(s)).find(Boolean) as HTMLElement | null
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    setNativeValue(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.focus()
    return true
  }
  if (el && el.getAttribute('contenteditable') === 'true') {
    el.textContent = text
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    el.focus()
    return true
  }
  try {
    await navigator.clipboard.writeText(text)
    return false
  } catch {
    return false
  }
}

function titleCaseStyle(style: any) {
  const pov = style?.pov === 'second' ? '2nd' : style?.pov === 'third' ? '3rd' : '1st'
  const tense = style?.tense === 'past' ? 'Past' : 'Present'
  return `${pov} · ${tense}`
}

export function setup(ctx: Ctx) {
  const cards = new Map<string, HTMLElement>()
  const dataByMessage = new Map<string, CachedPath>()
  let currentState: any = null
  let saveTimer: any = null
  const renderedMessages = new Set<string>()
  const awaitingRender = new Map<string, string>()
  const choiceTimers = new Map<string, { timer: any; chatId: string }>()
  const renderFallbackTimers = new Map<string, { timer: any; chatId: string }>()

  const removeStyle = ctx.dom.addStyle(`
    .pp-card {
      margin: 12px 0 2px;
      padding: 10px;
      border: 1px solid var(--lumiverse-border);
      border-radius: 14px;
      background: color-mix(in srgb, var(--lumiverse-fill-subtle) 88%, transparent);
      box-shadow: 0 5px 18px rgba(0,0,0,.12);
    }
    .pp-head { display:flex; align-items:center; gap:8px; margin:0 2px 8px; min-height:26px; }
    .pp-brand { font-size:12px; font-weight:700; letter-spacing:.02em; color:var(--lumiverse-text-muted); }
    .pp-style { font-size:10px; color:var(--lumiverse-text-muted); opacity:.78; }
    .pp-spacer { flex:1; }
    .pp-icon-btn {
      border:0; background:transparent; color:var(--lumiverse-text-muted); cursor:pointer;
      border-radius:8px; width:28px; height:28px; font-size:17px; line-height:1;
    }
    .pp-icon-btn:hover { background:var(--lumiverse-fill); color:var(--lumiverse-text); }
    .pp-choices { display:flex; flex-direction:column; gap:7px; }
    .pp-choice {
      width:100%; text-align:left; cursor:pointer; border:1px solid transparent;
      border-radius:12px; padding:10px 12px;
      background:var(--lumiverse-fill);
      color:var(--lumiverse-text);
      transition:transform .12s ease, border-color .12s ease, background .12s ease;
    }
    .pp-choice:hover { transform:translateY(-1px); border-color:var(--lumiverse-border); background:var(--lumiverse-fill-hover, var(--lumiverse-fill-subtle)); }
    .pp-choice:active { transform:translateY(0); }
    .pp-choice-top { display:flex; align-items:center; gap:8px; margin-bottom:4px; }
    .pp-num {
      width:20px; height:20px; border-radius:999px; display:inline-flex; align-items:center; justify-content:center;
      font-size:10px; font-weight:800; background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text-muted); flex:0 0 auto;
    }
    .pp-choice-title { font-size:12px; font-weight:700; }
    .pp-choice-text { display:block; font-size:12.5px; line-height:1.45; color:var(--lumiverse-text-muted); white-space:pre-wrap; }
    .pp-loading { display:flex; align-items:center; gap:8px; color:var(--lumiverse-text-muted); font-size:12px; padding:4px 2px; }
    .pp-dot { width:6px; height:6px; border-radius:999px; background:currentColor; animation:pp-pulse 1.1s infinite alternate; }
    @keyframes pp-pulse { from{opacity:.25; transform:scale(.8)} to{opacity:1; transform:scale(1.1)} }
    .pp-error { font-size:12px; color:var(--lumiverse-text-muted); padding:4px 2px; }
    .pp-toastish { font-size:10px; color:var(--lumiverse-text-muted); margin-left:4px; opacity:0; transition:opacity .15s; }
    .pp-toastish.show { opacity:1; }

    .pp-settings { padding:14px; display:flex; flex-direction:column; gap:14px; color:var(--lumiverse-text); }
    .pp-settings h3 { margin:0; font-size:16px; }
    .pp-settings p { margin:0; font-size:12px; line-height:1.45; color:var(--lumiverse-text-muted); }
    .pp-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .pp-field { display:flex; flex-direction:column; gap:5px; min-width:0; }
    .pp-label { font-size:11px; font-weight:700; color:var(--lumiverse-text-muted); }
    .pp-hint { font-size:10px; color:var(--lumiverse-text-muted); opacity:.78; line-height:1.35; }
    .pp-settings select, .pp-settings input[type="number"], .pp-settings input[type="text"], .pp-settings textarea {
      width:100%; box-sizing:border-box; border:1px solid var(--lumiverse-border); border-radius:9px;
      background:var(--lumiverse-fill); color:var(--lumiverse-text); padding:8px 9px; font:inherit; font-size:12px;
    }
    .pp-settings textarea { min-height:82px; resize:vertical; line-height:1.4; }
    .pp-check { display:flex; align-items:center; gap:8px; font-size:12px; cursor:pointer; }
    .pp-check input { accent-color:var(--lumiverse-accent); }
    .pp-row { display:flex; gap:8px; align-items:center; }
    .pp-btn {
      border:1px solid var(--lumiverse-border); border-radius:9px; background:var(--lumiverse-fill); color:var(--lumiverse-text);
      padding:8px 10px; font-size:11px; cursor:pointer;
    }
    .pp-btn:hover { background:var(--lumiverse-fill-subtle); }
    .pp-persona-badge { font-size:11px; color:var(--lumiverse-text-muted); padding:7px 9px; background:var(--lumiverse-fill-subtle); border-radius:9px; }
    .pp-connection-status { font-size:10.5px; line-height:1.35; color:var(--lumiverse-text-muted); margin-top:-7px; }
    .pp-connection-status.error { color:var(--lumiverse-danger, #d97777); }
    .pp-divider { height:1px; background:var(--lumiverse-border); opacity:.7; }
    .pp-launcher {
      width:100%; height:100%; display:flex; align-items:center; justify-content:center; gap:7px; box-sizing:border-box;
      border:1px solid var(--lumiverse-border); border-radius:999px; padding:0 11px; cursor:pointer;
      background:color-mix(in srgb, var(--lumiverse-fill) 92%, transparent); color:var(--lumiverse-text);
      box-shadow:0 7px 24px rgba(0,0,0,.24); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);
      font:inherit; font-size:12px; font-weight:750; letter-spacing:.01em;
    }
    .pp-launcher:hover { background:var(--lumiverse-fill-subtle); }
    .pp-launcher svg { width:16px; height:16px; color:var(--lumiverse-accent, currentColor); flex:0 0 auto; }
    .pp-native-select-slot { width:100%; min-width:0; }
    .pp-version { font-size:10px; color:var(--lumiverse-text-muted); opacity:.7; margin-top:-8px; }
    @media (max-width: 620px) { .pp-grid { grid-template-columns:1fr; } .pp-choice-text { font-size:12px; } }
  `)

  function ensureCard(messageId: string, chatId?: string) {
    const existing = cards.get(messageId)
    if (existing?.isConnected) return existing
    const bubble = ctx.dom.findMessageElement(messageId)
    if (!bubble) return null
    if (existing) {
      try { ctx.dom.uninject(existing) } catch {}
      cards.delete(messageId)
    }
    const wrapper = ctx.dom.inject(bubble, `
      <section class="pp-card" data-pp-message="${messageId}">
        <div class="pp-head">
          <span class="pp-brand">Persona Paths</span>
          <span class="pp-style"></span>
          <span class="pp-toastish">Added to composer</span>
          <span class="pp-spacer"></span>
          <button type="button" class="pp-icon-btn" title="Regenerate choices" aria-label="Regenerate choices">↻</button>
        </div>
        <div class="pp-choices"></div>
      </section>
    `, 'beforeend') as HTMLElement
    const regen = wrapper.querySelector('.pp-icon-btn') as HTMLButtonElement | null
    regen?.addEventListener('click', () => {
      const data = dataByMessage.get(messageId)
      const resolvedChatId = data?.chatId || chatId
      if (!resolvedChatId) return
      renderLoading(messageId, resolvedChatId)
      ctx.sendToBackend({ type: 'regenerate', chatId: resolvedChatId, messageId })
    })
    cards.set(messageId, wrapper)
    return wrapper
  }

  function renderLoading(messageId: string, chatId: string) {
    const card = ensureCard(messageId, chatId)
    if (!card) return
    const style = card.querySelector('.pp-style') as HTMLElement | null
    if (style) style.textContent = ''
    const host = card.querySelector('.pp-choices') as HTMLElement | null
    if (!host) return
    host.innerHTML = ''
    const row = ctx.dom.createElement('div', { class: 'pp-loading' }) as HTMLElement
    const dot = ctx.dom.createElement('span', { class: 'pp-dot' }) as HTMLElement
    const text = ctx.dom.createElement('span') as HTMLElement
    text.textContent = 'Reading the scene…'
    row.append(dot, text)
    host.appendChild(row)
  }

  function renderError(messageId: string, chatId: string, error: string) {
    const card = ensureCard(messageId, chatId)
    if (!card) return
    const host = card.querySelector('.pp-choices') as HTMLElement | null
    if (!host) return
    host.innerHTML = ''
    const row = ctx.dom.createElement('div', { class: 'pp-error' }) as HTMLElement
    row.textContent = `Couldn’t generate choices. ${error}`
    const retry = ctx.dom.createElement('button', { type: 'button', class: 'pp-btn' }) as HTMLButtonElement
    retry.textContent = 'Retry'
    retry.style.marginTop = '8px'
    retry.addEventListener('click', () => {
      renderLoading(messageId, chatId)
      ctx.sendToBackend({ type: 'regenerate', chatId, messageId })
    })
    host.append(row, retry)
  }

  function renderChoices(data: CachedPath) {
    dataByMessage.set(data.messageId, data)
    const card = ensureCard(data.messageId, data.chatId)
    if (!card) return
    const style = card.querySelector('.pp-style') as HTMLElement | null
    if (style) style.textContent = titleCaseStyle(data.style)
    const host = card.querySelector('.pp-choices') as HTMLElement | null
    if (!host) return
    host.innerHTML = ''

    data.choices.forEach((choice, index) => {
      const button = ctx.dom.createElement('button', { type: 'button', class: 'pp-choice' }) as HTMLButtonElement
      const top = ctx.dom.createElement('span', { class: 'pp-choice-top' }) as HTMLElement
      const num = ctx.dom.createElement('span', { class: 'pp-num' }) as HTMLElement
      num.textContent = String(index + 1)
      const title = ctx.dom.createElement('span', { class: 'pp-choice-title' }) as HTMLElement
      title.textContent = choice.title || choice.intent || `Option ${index + 1}`
      top.append(num, title)
      const body = ctx.dom.createElement('span', { class: 'pp-choice-text' }) as HTMLElement
      body.textContent = choice.text
      button.append(top, body)
      button.addEventListener('click', async () => {
        const filled = await fillComposer(choice.text)
        const hint = card.querySelector('.pp-toastish') as HTMLElement | null
        if (hint) {
          hint.textContent = filled ? 'Added to composer' : 'Copied to clipboard'
          hint.classList.add('show')
          window.setTimeout(() => hint.classList.remove('show'), 1400)
        }
      })
      host.appendChild(button)
    })
  }

  function scheduleSave(patch: any, delay = 180) {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => ctx.sendToBackend({ type: 'save_config', patch }), delay)
  }

  function delayMs() {
    const seconds = Number(currentState?.config?.generationDelaySeconds ?? 3)
    return Math.max(0, Math.min(15, Number.isFinite(seconds) ? seconds : 3)) * 1000
  }

  function cancelChoiceTimer(messageId: string) {
    const pending = choiceTimers.get(messageId)
    if (pending) clearTimeout(pending.timer)
    choiceTimers.delete(messageId)
    const fallback = renderFallbackTimers.get(messageId)
    if (fallback) clearTimeout(fallback.timer)
    renderFallbackTimers.delete(messageId)
    awaitingRender.delete(messageId)
  }

  function cancelChatTimers(chatId: string) {
    for (const [messageId, entry] of choiceTimers) {
      if (entry.chatId === chatId) cancelChoiceTimer(messageId)
    }
    for (const [messageId, entry] of renderFallbackTimers) {
      if (entry.chatId === chatId) cancelChoiceTimer(messageId)
    }
    for (const [messageId, pendingChatId] of awaitingRender) {
      if (pendingChatId === chatId) cancelChoiceTimer(messageId)
    }
  }

  function scheduleSettledGeneration(chatId: string, messageId: string) {
    cancelChoiceTimer(messageId)
    const timer = setTimeout(() => {
      choiceTimers.delete(messageId)
      if (currentState?.config?.enabled === false) return
      ctx.sendToBackend({ type: 'ensure_choices', chatId, messageId })
    }, delayMs())
    choiceTimers.set(messageId, { timer, chatId })
  }

  function waitForRenderThenGenerate(chatId: string, messageId: string) {
    cancelChoiceTimer(messageId)
    awaitingRender.set(messageId, chatId)

    if (renderedMessages.has(messageId)) {
      scheduleSettledGeneration(chatId, messageId)
      return
    }

    // Safety fallback: if a Lumiverse/UI quirk prevents CHARACTER_MESSAGE_RENDERED
    // from arriving, wait an extra five seconds before beginning the configured
    // settle delay. Normal operation uses the render event and never hits this.
    const fallbackTimer = setTimeout(() => {
      renderFallbackTimers.delete(messageId)
      if (awaitingRender.get(messageId) !== chatId) return
      scheduleSettledGeneration(chatId, messageId)
    }, 5000)
    renderFallbackTimers.set(messageId, { timer: fallbackTimer, chatId })
  }

  const tab = ctx.ui.registerDrawerTab({
    id: 'persona-paths',
    title: 'Persona Paths',
    shortName: 'Paths',
    headerTitle: 'Persona Paths',
    description: 'Configure private persona-aware next-move choices',
    keywords: ['cyoa', 'choices', 'roleplay', 'persona', 'paths'],
    iconSvg: PATHS_ICON,
  })

  document.querySelectorAll('[data-persona-paths-launcher]').forEach((el) => el.remove())
  // Native Lumiverse float widget: draggable, edge-snapping, and managed by the host UI.
  let floatLauncher: any = null
  try {
    floatLauncher = ctx.ui.createFloatWidget({
      width: 86,
      height: 38,
      initialPosition: {
        x: 16,
        y: Math.max(12, window.innerHeight - 142),
      },
      snapToEdge: true,
      tooltip: `Open Persona Paths v${EXT_VERSION}`,
      chromeless: true,
    })
    const launcher = ctx.dom.createElement('button', { type: 'button', class: 'pp-launcher' }) as HTMLButtonElement
    launcher.title = `Open Persona Paths v${EXT_VERSION}`
    launcher.setAttribute('aria-label', 'Open Persona Paths')
    launcher.innerHTML = `${PATHS_ICON}<span>Paths</span>`
    launcher.addEventListener('click', () => tab.activate())
    floatLauncher.root.appendChild(launcher)
  } catch (err) {
    console.warn('[Persona Paths] Native floating launcher unavailable', err)
  }

  // Also expose a native chat-input Extras action as a second access path.
  let openAction: any = null
  let unsubOpenAction = () => {}
  try {
    openAction = ctx.ui.registerInputBarAction({
      id: 'open-persona-paths',
      label: 'Open Persona Paths',
      iconSvg: PATHS_ICON,
      enabled: true,
    })
    unsubOpenAction = openAction.onClick(() => tab.activate())
  } catch {}

  const settings = ctx.dom.createElement('div', { class: 'pp-settings' }) as HTMLElement
  tab.root.appendChild(settings)

  const heading = ctx.dom.createElement('h3') as HTMLElement
  heading.textContent = 'Persona Paths'
  const version = ctx.dom.createElement('div', { class: 'pp-version' }) as HTMLElement
  version.textContent = `v${EXT_VERSION}`
  const intro = ctx.dom.createElement('p') as HTMLElement
  intro.textContent = 'Private, persona-aware next moves. The extension reads the role-play, but its choices and relationship notes are never inserted into story context.'
  settings.append(heading, version, intro)

  const enabled = ctx.dom.createElement('input', { type: 'checkbox' }) as HTMLInputElement
  const enabledLabel = ctx.dom.createElement('label', { class: 'pp-check' }) as HTMLLabelElement
  enabledLabel.append(enabled, document.createTextNode('Generate choices after character replies'))
  enabled.addEventListener('change', () => scheduleSave({ enabled: enabled.checked }, 0))
  settings.appendChild(enabledLabel)

  const connectionSlot = ctx.dom.createElement('div', { class: 'pp-native-select-slot' }) as HTMLElement
  settings.appendChild(createLabeledField(ctx, 'LLM connection', connectionSlot, 'Uses a separate Lumiverse connection profile from your story model if you want.'))
  const connectionPicker = ctx.components.mountSelect(connectionSlot, {
    value: '',
    options: [],
    placeholder: 'Choose a connection…',
    searchPlaceholder: 'Search connections…',
    noResultsMessage: 'No matching connections.',
    emptyMessage: 'No Lumiverse LLM connections are available.',
    portal: true,
    maxHeight: 360,
    minWidth: 300,
    onChange: (connectionId: string) => scheduleSave({ connectionId }, 0),
  })

  const connectionStatus = ctx.dom.createElement('div', { class: 'pp-connection-status' }) as HTMLElement
  connectionStatus.textContent = 'Loading Lumiverse connections…'
  settings.appendChild(connectionStatus)
  const refreshConnections = ctx.dom.createElement('button', { type: 'button', class: 'pp-btn' }) as HTMLButtonElement
  refreshConnections.textContent = 'Refresh connections'
  refreshConnections.addEventListener('click', () => {
    connectionStatus.classList.remove('error')
    connectionStatus.textContent = 'Refreshing Lumiverse connections…'
    ctx.sendToBackend({ type: 'get_state' })
  })
  settings.appendChild(refreshConnections)

  const modelOverride = ctx.dom.createElement('input', { type: 'text', placeholder: 'Leave blank to use connection model' }) as HTMLInputElement
  modelOverride.addEventListener('input', () => scheduleSave({ modelOverride: modelOverride.value }))
  settings.appendChild(createLabeledField(ctx, 'Model override', modelOverride, 'Optional exact model ID. Blank follows the selected connection profile.'))

  const grid = ctx.dom.createElement('div', { class: 'pp-grid' }) as HTMLElement
  const pov = ctx.dom.createElement('select') as HTMLSelectElement
  ;[['auto','Auto'],['first','First person'],['second','Second person'],['third','Third person']].forEach(([v,l]) => {
    const o = document.createElement('option'); o.value=v; o.textContent=l; pov.appendChild(o)
  })
  pov.addEventListener('change', () => scheduleSave({ pov: pov.value }, 0))

  const tense = ctx.dom.createElement('select') as HTMLSelectElement
  ;[['auto','Auto'],['present','Present'],['past','Past']].forEach(([v,l]) => {
    const o = document.createElement('option'); o.value=v; o.textContent=l; tense.appendChild(o)
  })
  tense.addEventListener('change', () => scheduleSave({ tense: tense.value }, 0))

  const detail = ctx.dom.createElement('select') as HTMLSelectElement
  ;[['compact','Compact'],['normal','Normal'],['detailed','Detailed']].forEach(([v,l]) => {
    const o = document.createElement('option'); o.value=v; o.textContent=l; detail.appendChild(o)
  })
  detail.addEventListener('change', () => scheduleSave({ detail: detail.value }, 0))

  const choiceCount = ctx.dom.createElement('input', { type: 'number', min: '3', max: '6', step: '1' }) as HTMLInputElement
  choiceCount.addEventListener('change', () => scheduleSave({ choiceCount: Number(choiceCount.value) }, 0))

  grid.append(
    createLabeledField(ctx, 'POV / person', pov),
    createLabeledField(ctx, 'Tense', tense),
    createLabeledField(ctx, 'Choice detail', detail),
    createLabeledField(ctx, 'Number of choices', choiceCount),
  )
  settings.appendChild(grid)

  const behaviorGrid = ctx.dom.createElement('div', { class: 'pp-grid' }) as HTMLElement
  const generationDelay = ctx.dom.createElement('select') as HTMLSelectElement
  ;[['0','No delay'],['2','2 seconds'],['3','3 seconds (recommended)'],['5','5 seconds'],['10','10 seconds']].forEach(([v,l]) => {
    const o = document.createElement('option'); o.value=v; o.textContent=l; generationDelay.appendChild(o)
  })
  generationDelay.addEventListener('change', () => scheduleSave({ generationDelaySeconds: Number(generationDelay.value) }, 0))

  const adultContent = ctx.dom.createElement('select') as HTMLSelectElement
  ;[['match_scene','Match scene'],['allow_explicit','Allow explicit'],['suggestive','Keep suggestive']].forEach(([v,l]) => {
    const o = document.createElement('option'); o.value=v; o.textContent=l; adultContent.appendChild(o)
  })
  adultContent.addEventListener('change', () => scheduleSave({ adultContent: adultContent.value }, 0))

  behaviorGrid.append(
    createLabeledField(ctx, 'Choice generation delay', generationDelay, 'Waits until the assistant message has rendered, then gives Lumiverse this extra settling time.'),
    createLabeledField(ctx, 'Adult-content handling', adultContent, 'Match scene keeps the current explicitness. Allow explicit permits explicit adult choices when contextually appropriate; it does not force escalation.'),
  )
  settings.appendChild(behaviorGrid)

  const grid2 = ctx.dom.createElement('div', { class: 'pp-grid' }) as HTMLElement
  const contextMessages = ctx.dom.createElement('input', { type: 'number', min: '6', max: '30', step: '1' }) as HTMLInputElement
  contextMessages.addEventListener('change', () => scheduleSave({ contextMessages: Number(contextMessages.value) }, 0))
  const recentUserExamples = ctx.dom.createElement('input', { type: 'number', min: '2', max: '12', step: '1' }) as HTMLInputElement
  recentUserExamples.addEventListener('change', () => scheduleSave({ recentUserExamples: Number(recentUserExamples.value) }, 0))
  grid2.append(
    createLabeledField(ctx, 'Scene messages', contextMessages, 'Recent story context sent only to the CYOA model.'),
    createLabeledField(ctx, 'Your portrayal examples', recentUserExamples, 'Recent USER turns used to learn how you actually play the persona.'),
  )
  settings.appendChild(grid2)

  const relationshipMemoryToggle = ctx.dom.createElement('input', { type: 'checkbox' }) as HTMLInputElement
  const relationshipLabel = ctx.dom.createElement('label', { class: 'pp-check' }) as HTMLLabelElement
  relationshipLabel.append(relationshipMemoryToggle, document.createTextNode('Keep private relationship memory'))
  relationshipMemoryToggle.addEventListener('change', () => scheduleSave({ relationshipMemory: relationshipMemoryToggle.checked }, 0))
  settings.appendChild(relationshipLabel)

  const reasoningToggle = ctx.dom.createElement('input', { type: 'checkbox' }) as HTMLInputElement
  const reasoningLabel = ctx.dom.createElement('label', { class: 'pp-check' }) as HTMLLabelElement
  reasoningLabel.append(reasoningToggle, document.createTextNode('Use connection reasoning / thinking'))
  reasoningToggle.addEventListener('change', () => scheduleSave({ useReasoning: reasoningToggle.checked }, 0))
  settings.appendChild(reasoningLabel)

  const divider = ctx.dom.createElement('div', { class: 'pp-divider' }) as HTMLElement
  settings.appendChild(divider)

  const personaBadge = ctx.dom.createElement('div', { class: 'pp-persona-badge' }) as HTMLElement
  personaBadge.textContent = 'Active persona: loading…'
  settings.appendChild(personaBadge)

  const personaInstructions = ctx.dom.createElement('textarea', { placeholder: 'Optional: how this persona behaves, especially exceptions or relationship patterns…' }) as HTMLTextAreaElement
  personaInstructions.addEventListener('input', () => {
    const personaId = currentState?.activePersona?.id
    if (!personaId) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => ctx.sendToBackend({ type: 'set_persona_override', personaId, text: personaInstructions.value }), 220)
  })
  settings.appendChild(createLabeledField(ctx, 'Active persona guidance', personaInstructions, 'Stored privately by Persona Paths. Useful for exceptions like “soft with Elena, reckless with everyone else.”'))

  const globalInstructions = ctx.dom.createElement('textarea', { placeholder: 'Optional global rules for all personas…' }) as HTMLTextAreaElement
  globalInstructions.addEventListener('input', () => scheduleSave({ globalInstructions: globalInstructions.value }))
  settings.appendChild(createLabeledField(ctx, 'Global guidance', globalInstructions))

  const advancedGrid = ctx.dom.createElement('div', { class: 'pp-grid' }) as HTMLElement
  const temperature = ctx.dom.createElement('input', { type: 'number', min: '0', max: '2', step: '0.05' }) as HTMLInputElement
  temperature.addEventListener('change', () => scheduleSave({ temperature: Number(temperature.value) }, 0))
  const maxTokens = ctx.dom.createElement('input', { type: 'number', min: '500', max: '3000', step: '100' }) as HTMLInputElement
  maxTokens.addEventListener('change', () => scheduleSave({ maxTokens: Number(maxTokens.value) }, 0))
  advancedGrid.append(
    createLabeledField(ctx, 'Temperature', temperature),
    createLabeledField(ctx, 'Max output tokens', maxTokens),
  )
  settings.appendChild(advancedGrid)

  const clearMemory = ctx.dom.createElement('button', { type: 'button', class: 'pp-btn' }) as HTMLButtonElement
  clearMemory.textContent = 'Clear private relationship memory'
  clearMemory.addEventListener('click', () => ctx.sendToBackend({ type: 'clear_relationship_memory' }))
  settings.appendChild(clearMemory)

  function applyState(state: any) {
    currentState = state
    const cfg = state?.config || {}
    enabled.checked = !!cfg.enabled
    pov.value = cfg.pov || 'auto'
    tense.value = cfg.tense || 'auto'
    detail.value = cfg.detail || 'normal'
    generationDelay.value = String(cfg.generationDelaySeconds ?? 3)
    adultContent.value = cfg.adultContent || 'match_scene'
    choiceCount.value = String(cfg.choiceCount ?? 4)
    contextMessages.value = String(cfg.contextMessages ?? 12)
    recentUserExamples.value = String(cfg.recentUserExamples ?? 6)
    relationshipMemoryToggle.checked = cfg.relationshipMemory !== false
    reasoningToggle.checked = !!cfg.useReasoning
    modelOverride.value = cfg.modelOverride || ''
    globalInstructions.value = cfg.globalInstructions || ''
    temperature.value = String(cfg.temperature ?? 0.85)
    maxTokens.value = String(cfg.maxTokens ?? 1400)

    const conns = Array.isArray(state?.connections) ? state.connections : []
    const selectedConnection = cfg.connectionId && conns.some((c: any) => c.id === cfg.connectionId)
      ? cfg.connectionId
      : (conns.find((c: any) => c.is_default) || conns[0])?.id || ''
    connectionPicker.update({
      value: selectedConnection,
      options: conns.map((c: any) => ({
        value: String(c.id),
        label: String(c.name || 'Unnamed connection'),
        sublabel: String(c.model || c.provider || ''),
      })),
    })

    const connectionError = String(state?.connectionError || '')
    if (connectionError) {
      connectionStatus.classList.add('error')
      connectionStatus.textContent = connectionError
    } else {
      connectionStatus.classList.remove('error')
      connectionStatus.textContent = `${conns.length} Lumiverse LLM connection${conns.length === 1 ? '' : 's'} available.`
    }

    const persona = state?.activePersona
    const personaError = String(state?.personaError || '')
    personaBadge.textContent = personaError
      ? `Active persona unavailable: ${personaError}`
      : (persona ? `Active persona: ${persona.name}${persona.title ? ` — ${persona.title}` : ''}` : 'Active persona: none')
    personaInstructions.disabled = !persona
    personaInstructions.value = persona?.id ? (cfg.personaOverrides?.[persona.id] || '') : ''
  }

  const unsubBackend = ctx.onBackendMessage((payload: any) => {
    if (!payload || typeof payload !== 'object') return
    if (payload.type === 'state') applyState(payload)
    else if (payload.type === 'choices_loading') renderLoading(String(payload.messageId), String(payload.chatId))
    else if (payload.type === 'choices_ready' && payload.data) renderChoices(payload.data)
    else if (payload.type === 'choices_error') renderError(String(payload.messageId), String(payload.chatId), String(payload.error || 'Unknown error'))
    else if (payload.type === 'request_error') {
      connectionStatus.classList.add('error')
      connectionStatus.textContent = String(payload.error || 'Persona Paths backend request failed.')
    }
    else if (payload.type === 'memory_cleared') {
      clearMemory.textContent = 'Memory cleared ✓'
      setTimeout(() => { clearMemory.textContent = 'Clear private relationship memory' }, 1200)
    }
  })

  let unsubRendered = () => {}
  let unsubGenerationStarted = () => {}
  let unsubGenerationEnded = () => {}
  let unsubGenerationStopped = () => {}
  let unsubSwipe = () => {}
  let unsubChatSwitch = () => {}
  try {
    unsubRendered = ctx.events.on('CHARACTER_MESSAGE_RENDERED', (payload: any) => {
      const id = String(payload?.messageId || '')
      const chatId = String(payload?.chatId || '')
      if (!id) return
      renderedMessages.add(id)
      if (dataByMessage.has(id)) renderChoices(dataByMessage.get(id) as CachedPath)
      else ctx.sendToBackend({ type: 'load_choices', messageId: id })

      const pendingChatId = awaitingRender.get(id) || chatId
      if (pendingChatId && awaitingRender.has(id)) scheduleSettledGeneration(pendingChatId, id)
    })
  } catch (err) { console.warn('[Persona Paths] CHARACTER_MESSAGE_RENDERED subscription failed', err) }

  // A new story generation supersedes any not-yet-started CYOA work in that chat.
  // This keeps Persona Paths out of the way if the user quickly continues/regenerates.
  try {
    unsubGenerationStarted = ctx.events.on('GENERATION_STARTED', (payload: any) => {
      const chatId = String(payload?.chatId || '')
      const targetMessageId = String(payload?.targetMessageId || '')
      if (chatId) cancelChatTimers(chatId)
      if (targetMessageId) renderedMessages.delete(targetMessageId)
    })
  } catch (err) { console.warn('[Persona Paths] GENERATION_STARTED subscription failed', err) }

  // Conservative trigger: the story generation must finish AND its assistant
  // message must render. Only then do we wait the configured settling delay.
  // Frontend routing preserves the concrete userId for operator-scoped installs.
  try {
    unsubGenerationEnded = ctx.events.on('GENERATION_ENDED', (payload: any) => {
      if (payload?.error) return
      const chatId = String(payload?.chatId || '')
      const messageId = String(payload?.messageId || '')
      if (!chatId || !messageId) return
      waitForRenderThenGenerate(chatId, messageId)
    })
  } catch (err) { console.warn('[Persona Paths] GENERATION_ENDED subscription failed', err) }

  try {
    unsubGenerationStopped = ctx.events.on('GENERATION_STOPPED', (payload: any) => {
      const chatId = String(payload?.chatId || '')
      if (chatId) cancelChatTimers(chatId)
    })
  } catch (err) { console.warn('[Persona Paths] GENERATION_STOPPED subscription failed', err) }

  // Swipes can change content while keeping the same message ID. Forget the old
  // render state, then wait for the changed assistant bubble to render and settle.
  try {
    unsubSwipe = ctx.events.on('MESSAGE_SWIPED', (payload: any) => {
      if (!payload?.chatId || !payload?.message?.id || payload?.message?.role !== 'assistant') return
      if (payload.action === 'navigated' || payload.action === 'updated' || payload.action === 'added') {
        const chatId = String(payload.chatId)
        const messageId = String(payload.message.id)
        cancelChoiceTimer(messageId)
        renderedMessages.delete(messageId)
        waitForRenderThenGenerate(chatId, messageId)
      }
    })
  } catch (err) { console.warn('[Persona Paths] MESSAGE_SWIPED subscription failed', err) }

  try {
    unsubChatSwitch = ctx.events.on('CHAT_SWITCHED', () => {
      for (const messageId of Array.from(choiceTimers.keys())) cancelChoiceTimer(messageId)
      for (const messageId of Array.from(renderFallbackTimers.keys())) cancelChoiceTimer(messageId)
      awaitingRender.clear()
      renderedMessages.clear()
      cards.clear()
      dataByMessage.clear()
      setTimeout(() => {
        try {
          const ids = ctx.messages.listMessageIds()
          if (ids?.length) ctx.sendToBackend({ type: 'load_choices', messageIds: ids.slice(-40) })
        } catch {}
        ctx.sendToBackend({ type: 'get_state' })
      }, 80)
    })
  } catch (err) { console.warn('[Persona Paths] CHAT_SWITCHED subscription failed', err) }

  ctx.sendToBackend({ type: 'get_state' })
  try {
    const existingIds = ctx.messages.listMessageIds()
    if (existingIds?.length) ctx.sendToBackend({ type: 'load_choices', messageIds: existingIds.slice(-40) })
  } catch {}

  return () => {
    if (saveTimer) clearTimeout(saveTimer)
    unsubBackend()
    for (const messageId of Array.from(choiceTimers.keys())) cancelChoiceTimer(messageId)
    for (const messageId of Array.from(renderFallbackTimers.keys())) cancelChoiceTimer(messageId)
    unsubRendered()
    unsubGenerationStarted()
    unsubGenerationEnded()
    unsubGenerationStopped()
    unsubSwipe()
    unsubChatSwitch()
    try { unsubOpenAction() } catch {}
    try { openAction?.destroy?.() } catch {}
    try { connectionPicker?.destroy?.() } catch {}
    try { floatLauncher?.destroy?.() } catch {}
    removeStyle()
    tab.destroy()
    ctx.dom.cleanup()
  }
}

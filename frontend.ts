type Ctx = any

const EXT_VERSION = '0.1.32'
const PATHS_ICON = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 4v5a3 3 0 0 0 3 3h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6 20v-3a5 5 0 0 1 5-5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m15 8 4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="4" r="2" fill="currentColor"/></svg>`

type Choice = { intent: string; title: string; text: string; intensity?: 1 | 2 | 3; advances_scene?: boolean }
type CachedPath = {
  chatId: string
  messageId: string
  style: { pov: string; tense: string }
  sceneState?: { location: string; moment: string }
  choices: Choice[]
  prismColor?: string
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

function appendPathText(current: string, addition: string) {
  const existing = String(current || '').replace(/[ \t]+$/gm, '').trimEnd()
  const next = String(addition || '').trim()
  if (!next) return existing
  if (!existing) return next
  return `${existing}\n\n${next}`
}

function findComposerElement() {
  const selectors = [
    '[data-component="InputArea"] textarea[name="chat-message"]',
    '[data-component="InputArea"] textarea',
    'textarea[name="chat-message"]',
    '[data-component="InputArea"] [contenteditable="true"]',
  ]
  return selectors.map(s => document.querySelector(s)).find(Boolean) as HTMLElement | null
}

function getComposerText() {
  const el = findComposerElement()
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return String(el.value || '')
  if (el && el.getAttribute('contenteditable') === 'true') return String(el.textContent || '')
  return ''
}

function replaceComposer(text: string) {
  const el = findComposerElement()
  const next = String(text || '').trim()
  if (!el || !next) return false
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    setNativeValue(el, next)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.focus()
    try { el.setSelectionRange(next.length, next.length) } catch {}
    return true
  }
  if (el.getAttribute('contenteditable') === 'true') {
    el.textContent = next
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: next }))
    el.focus()
    try {
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
    } catch {}
    return true
  }
  return false
}

async function fillComposer(text: string) {
  const el = findComposerElement()
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const combined = appendPathText(el.value, text)
    setNativeValue(el, combined)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.focus()
    try { el.setSelectionRange(combined.length, combined.length) } catch {}
    return true
  }
  if (el && el.getAttribute('contenteditable') === 'true') {
    const combined = appendPathText(el.textContent || '', text)
    el.textContent = combined
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    el.focus()
    try {
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
    } catch {}
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

function appendRenderedText(parent: HTMLElement, text: string) {
  const source = String(text || '')
  // Render single-asterisk Markdown as italics for Path-card presentation while
  // preserving the literal asterisks in the cached/pasted choice text.
  // Deliberately ignore **double-asterisk** runs so we do not reinterpret bold.
  const pattern = /(^|[^*])\*([^*\n]+?)\*(?!\*)/g
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    const fullStart = match.index
    const boundary = match[1] || ''
    const italicText = match[2] || ''
    const italicStart = fullStart + boundary.length

    if (italicStart > cursor) parent.appendChild(document.createTextNode(source.slice(cursor, italicStart)))
    const em = document.createElement('em')
    em.textContent = italicText
    parent.appendChild(em)
    cursor = pattern.lastIndex
  }
  if (cursor < source.length) parent.appendChild(document.createTextNode(source.slice(cursor)))
  if (!source.length) parent.appendChild(document.createTextNode(''))
}

function renderChoiceText(body: HTMLElement, text: string, prismColor?: string) {
  body.textContent = ''
  const source = String(text || '')
  const color = /^#[0-9A-F]{6}$/i.test(String(prismColor || '')) ? String(prismColor).toUpperCase() : ''
  if (!color) {
    appendRenderedText(body, source)
    return
  }

  // Mirror Prism's quoted-dialogue rules closely. The underlying option remains
  // plain text; only the rendered Path card gets presentation color. Narration
  // segments still render *inner thoughts* as italics.
  const pattern = /“[^”\n]+”|(^|[\s([{>—–-])"[^"\n]+"(?=$|[\s)\]}>.,!?;:—–-])/gm
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    let start = match.index
    let quoted = match[0]
    // Straight-quote pattern may capture one leading boundary character. Keep
    // that boundary uncolored and paint only the quoted dialogue itself.
    if (match[1]) {
      appendRenderedText(body, source.slice(cursor, start + match[1].length))
      start += match[1].length
      quoted = quoted.slice(match[1].length)
    } else if (start > cursor) {
      appendRenderedText(body, source.slice(cursor, start))
    }
    const dialogue = document.createElement('span')
    dialogue.textContent = quoted
    dialogue.style.setProperty('color', color, 'important')
    body.appendChild(dialogue)
    cursor = start + quoted.length
  }
  if (cursor < source.length) appendRenderedText(body, source.slice(cursor))
  if (!body.childNodes.length) appendRenderedText(body, source)
}

export function setup(ctx: Ctx) {
  const cards = new Map<string, () => void>()
  const dataByMessage = new Map<string, CachedPath>()
  const widgetSignatures = new Map<string, string>()
  let activePathMessageId: string | null = null
  let currentState: any = null
  let saveTimer: any = null
  const renderedMessages = new Set<string>()
  const awaitingRender = new Map<string, string>()
  const choiceTimers = new Map<string, { timer: any; chatId: string }>()
  const renderFallbackTimers = new Map<string, { timer: any; chatId: string }>()

  const removeStyle = ctx.dom.addStyle(`
    .pp-injection-root {
      display:block !important;
      width:100% !important;
      max-width:100% !important;
      min-width:0 !important;
      box-sizing:border-box !important;
      flex:0 0 auto !important;
    }
    .pp-card {
      width:100%;
      max-width:100%;
      min-width:0;
      box-sizing:border-box;
      overflow:hidden;
      margin: 12px 0 2px;
      padding: 10px;
      border: 1px solid var(--lumiverse-border);
      border-radius: 14px;
      background: color-mix(in srgb, var(--lumiverse-fill-subtle) 88%, transparent);
      box-shadow: 0 5px 18px rgba(0,0,0,.12);
    }
    .pp-head { display:flex; align-items:center; gap:8px; margin:0 2px 8px; min-height:26px; min-width:0; max-width:100%; box-sizing:border-box; }
    .pp-brand { font-size:12px; font-weight:700; letter-spacing:.02em; color:var(--lumiverse-text-muted); }
    .pp-style { font-size:10px; color:var(--lumiverse-text-muted); opacity:.78; }
    .pp-spacer { flex:1; }
    .pp-icon-btn {
      border:0; background:transparent; color:var(--lumiverse-text-muted); cursor:pointer;
      border-radius:8px; width:28px; height:28px; font-size:17px; line-height:1;
    }
    .pp-icon-btn:hover { background:var(--lumiverse-fill); color:var(--lumiverse-text); }
    .pp-choices { display:flex; flex-direction:column; gap:7px; min-width:0; max-width:100%; box-sizing:border-box; }
    .pp-choice {
      width:100%; max-width:100%; min-width:0; box-sizing:border-box; text-align:left; cursor:pointer; border:1px solid transparent;
      border-radius:12px; padding:10px 12px;
      background:var(--lumiverse-fill);
      color:var(--lumiverse-text);
      transition:transform .12s ease, border-color .12s ease, background .12s ease;
    }
    .pp-choice:hover { transform:translateY(-1px); border-color:var(--lumiverse-border); background:var(--lumiverse-fill-hover, var(--lumiverse-fill-subtle)); }
    .pp-choice:active { transform:translateY(0); }
    .pp-choice-top { display:flex; align-items:center; gap:8px; margin-bottom:4px; min-width:0; max-width:100%; }
    .pp-num {
      width:20px; height:20px; border-radius:999px; display:inline-flex; align-items:center; justify-content:center;
      font-size:10px; font-weight:800; background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text-muted); flex:0 0 auto;
    }
    .pp-choice-title { font-size:12px; font-weight:700; min-width:0; overflow-wrap:anywhere; }
    .pp-advance-badge { margin-left:auto; font-size:9px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; opacity:.72; padding:2px 6px; border:1px solid var(--lumiverse-border); border-radius:999px; white-space:nowrap; }
    .pp-choice-text { display:block; min-width:0; max-width:100%; box-sizing:border-box; font-size:12.5px; line-height:1.45; color:var(--lumiverse-text-muted); white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; }
    .pp-loading { display:flex; align-items:center; gap:8px; color:var(--lumiverse-text-muted); font-size:12px; padding:4px 2px; }
    .pp-dot { width:6px; height:6px; border-radius:999px; background:currentColor; animation:pp-pulse 1.1s infinite alternate; }
    @keyframes pp-pulse { from{opacity:.25; transform:scale(.8)} to{opacity:1; transform:scale(1.1)} }
    .pp-error { font-size:12px; color:var(--lumiverse-text-muted); padding:4px 2px; }
    .pp-toastish { font-size:10px; color:var(--lumiverse-text-muted); margin-left:4px; opacity:0; transition:opacity .15s; }
    .pp-toastish.show { opacity:1; }
    .pp-guidance-panel {
      margin-top:9px; padding:10px; border:1px solid var(--lumiverse-border); border-radius:11px;
      background:color-mix(in srgb, var(--lumiverse-fill) 88%, transparent);
    }
    .pp-guidance-panel[hidden] { display:none !important; }
    .pp-guidance-title { font-size:11.5px; font-weight:750; margin-bottom:6px; }
    .pp-guidance-input {
      width:100%; min-height:68px; resize:vertical; box-sizing:border-box; border:1px solid var(--lumiverse-border);
      border-radius:9px; background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text);
      padding:8px 9px; font:inherit; font-size:12px; line-height:1.4;
    }
    .pp-guidance-input:focus { outline:1px solid color-mix(in srgb, var(--lumiverse-accent, currentColor) 62%, transparent); }
    .pp-guidance-save { display:flex; align-items:center; gap:7px; margin-top:8px; font-size:10.5px; color:var(--lumiverse-text-muted); cursor:pointer; }
    .pp-guidance-save input { accent-color:var(--lumiverse-accent); }
    .pp-guidance-actions { display:flex; justify-content:flex-end; gap:7px; margin-top:9px; }
    .pp-guidance-hint { margin-top:7px; font-size:9.8px; line-height:1.35; color:var(--lumiverse-text-muted); opacity:.78; }

    .pp-guidance-modal { display:flex; flex-direction:column; gap:12px; min-width:0; }
    .pp-guidance-modal-copy { margin:0; font-size:12px; line-height:1.45; color:var(--lumiverse-text-muted); }
    .pp-guidance-modal-input {
      width:100%; min-height:150px; max-height:44vh; resize:vertical; box-sizing:border-box;
      border:1px solid var(--lumiverse-border); border-radius:10px; background:var(--lumiverse-fill);
      color:var(--lumiverse-text); padding:11px 12px; font:inherit; font-size:16px; line-height:1.45;
      overscroll-behavior:contain; -webkit-overflow-scrolling:touch;
    }
    .pp-guidance-modal-input:focus { outline:2px solid color-mix(in srgb, var(--lumiverse-accent, currentColor) 45%, transparent); outline-offset:1px; }
    .pp-guidance-modal-save { display:flex; align-items:flex-start; gap:8px; font-size:12px; line-height:1.35; color:var(--lumiverse-text-muted); cursor:pointer; }
    .pp-guidance-modal-save input { margin-top:2px; accent-color:var(--lumiverse-accent); }
    .pp-guidance-modal-actions { display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
    .pp-guidance-modal-error { min-height:1.2em; font-size:11px; color:var(--lumiverse-danger, #d97777); }
    .pp-writer-modal { display:flex; flex-direction:column; gap:11px; min-width:0; }
    .pp-writer-copy { margin:0; font-size:12px; line-height:1.45; color:var(--lumiverse-text-muted); }
    .pp-writer-direction { width:100%; min-height:92px; max-height:30vh; resize:vertical; box-sizing:border-box; border:1px solid var(--lumiverse-border); border-radius:10px; background:var(--lumiverse-fill); color:var(--lumiverse-text); padding:10px 11px; font:inherit; font-size:16px; line-height:1.45; }
    .pp-writer-result { width:100%; min-height:150px; max-height:36vh; resize:vertical; box-sizing:border-box; border:1px solid var(--lumiverse-border); border-radius:10px; background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text); padding:10px 11px; font:inherit; font-size:14px; line-height:1.45; }
    .pp-writer-status { min-height:1.2em; font-size:11px; color:var(--lumiverse-text-muted); }
    .pp-writer-status.error { color:var(--lumiverse-danger, #d97777); }
    .pp-writer-history { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:10.5px; color:var(--lumiverse-text-muted); }
    .pp-writer-actions { display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
    @media (max-width:620px), (pointer:coarse) {
      .pp-guidance-modal-input { min-height:180px; max-height:38vh; resize:none; font-size:16px; }
      .pp-guidance-modal-actions .pp-btn { min-height:42px; padding:10px 14px; }
    }

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
    .pp-btn.pp-primary {
      font-weight:750; border-color:color-mix(in srgb, var(--lumiverse-accent, currentColor) 48%, var(--lumiverse-border));
      background:color-mix(in srgb, var(--lumiverse-accent, currentColor) 10%, var(--lumiverse-fill));
    }
    .pp-btn.pp-primary:hover { background:color-mix(in srgb, var(--lumiverse-accent, currentColor) 16%, var(--lumiverse-fill)); }
    .pp-btn:disabled { opacity:.55; cursor:default; }
    .pp-manual-status { font-size:10.5px; line-height:1.35; color:var(--lumiverse-text-muted); margin-top:-7px; min-height:1em; }
    .pp-manual-status.error { color:var(--lumiverse-danger, #d97777); }
    .pp-persona-badge { font-size:11px; color:var(--lumiverse-text-muted); padding:7px 9px; background:var(--lumiverse-fill-subtle); border-radius:9px; }
    .pp-connection-status { font-size:10.5px; line-height:1.35; color:var(--lumiverse-text-muted); margin-top:-7px; }
    .pp-connection-status.error { color:var(--lumiverse-danger, #d97777); }
    .pp-prism-status { font-size:10.5px; line-height:1.35; color:var(--lumiverse-text-muted); margin-top:-7px; }
    .pp-divider { height:1px; background:var(--lumiverse-border); opacity:.7; }
    .pp-launcher-group {
      width:100%; height:100%; display:flex; align-items:stretch; box-sizing:border-box; overflow:hidden;
      border:1px solid var(--lumiverse-border); border-radius:999px;
      background:color-mix(in srgb, var(--lumiverse-fill) 92%, transparent); color:var(--lumiverse-text);
      box-shadow:0 7px 24px rgba(0,0,0,.24); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);
    }
    .pp-launcher {
      min-width:0; height:100%; display:flex; align-items:center; justify-content:center; gap:7px; box-sizing:border-box;
      border:0; background:transparent; color:var(--lumiverse-text); padding:0 11px; cursor:pointer;
      font:inherit; font-size:12px; font-weight:750; letter-spacing:.01em;
    }
    .pp-launcher:hover { background:var(--lumiverse-fill-subtle); }
    .pp-launcher.paths { flex:1 1 auto; }
    .pp-launcher.writer { flex:0 0 38px; width:38px; padding:0; border-left:1px solid var(--lumiverse-border); font-size:17px; }
    .pp-launcher svg { width:16px; height:16px; color:var(--lumiverse-accent, currentColor); flex:0 0 auto; }
    .pp-native-select-slot { width:100%; min-width:0; }
    .pp-model-tools { display:flex; align-items:center; gap:8px; margin-top:-7px; flex-wrap:wrap; }
    .pp-model-tools .pp-connection-status { margin-top:0; flex:1 1 220px; }
    .pp-settings [hidden] { display:none !important; }
    .pp-version { font-size:10px; color:var(--lumiverse-text-muted); opacity:.7; margin-top:-8px; }
    @media (max-width: 620px) { .pp-grid { grid-template-columns:1fr; } .pp-choice-text { font-size:12px; } }
  `)

  function widgetJson(value: any) {
    return JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029')
  }

  function retireLegacyCards() {
    // v0.1.19 (and earlier) used direct DOM injection. Lumiverse persists those
    // injections across message virtualization, so proactively retire any mounted
    // legacy wrappers before using the host-managed message-widget API.
    const wrappers = new Set<Element>()
    document.querySelectorAll('.pp-injection-root').forEach((el) => wrappers.add(el))
    document.querySelectorAll('.pp-card[data-pp-message]').forEach((card) => {
      if (card.parentElement) wrappers.add(card.parentElement)
    })
    for (const wrapper of wrappers) {
      try { ctx.dom.uninject(wrapper) } catch {
        try { wrapper.remove() } catch {}
      }
    }
  }

  retireLegacyCards()

  function latestHostMessageId(): string {
    try {
      const direct = ctx.messages?.getLatestMessageId?.()
      if (direct) return String(direct)
    } catch {}
    try {
      const ids = ctx.messages?.listMessageIds?.()
      return ids?.length ? String(ids[ids.length - 1]) : ''
    } catch {}
    return ''
  }

  let guidanceModal: any = null
  let writerModal: any = null
  let writerPending = false
  let writerAnchor: { chatId: string; messageId: string } | null = null
  let writerHistory: string[] = []
  let writerHistoryIndex = -1
  let selectedPathIntents: string[] = []

  function openGuidanceModal(chatId: string, messageId: string) {
    try {
      if (guidanceModal) {
        try { guidanceModal.dismiss() } catch {}
        guidanceModal = null
      }

      const modal = ctx.ui.showModal({
        title: 'Regenerate with guidance',
        width: 560,
        maxHeight: Math.min(680, Math.max(360, window.innerHeight - 24)),
      })
      guidanceModal = modal

      const wrap = ctx.dom.createElement('div', { class: 'pp-guidance-modal' }) as HTMLElement
      const copy = ctx.dom.createElement('p', { class: 'pp-guidance-modal-copy' }) as HTMLElement
      copy.textContent = 'Tell Persona Paths what direction you had in mind. This applies only to this regeneration unless you save it as persona guidance.'

      const input = ctx.dom.createElement('textarea', {
        class: 'pp-guidance-modal-input',
        placeholder: 'Example: Stop arguing and give me options where Rook physically leaves camp.',
      }) as HTMLTextAreaElement
      input.autocapitalize = 'sentences'
      input.autocomplete = 'off'
      input.spellcheck = true

      const save = ctx.dom.createElement('input', { type: 'checkbox' }) as HTMLInputElement
      const saveLabel = ctx.dom.createElement('label', { class: 'pp-guidance-modal-save' }) as HTMLLabelElement
      saveLabel.append(save, document.createTextNode('Save this as active persona guidance'))

      const error = ctx.dom.createElement('div', { class: 'pp-guidance-modal-error', role: 'status' }) as HTMLElement
      const actions = ctx.dom.createElement('div', { class: 'pp-guidance-modal-actions' }) as HTMLElement
      const cancel = ctx.dom.createElement('button', { type: 'button', class: 'pp-btn' }) as HTMLButtonElement
      cancel.textContent = 'Cancel'
      const generate = ctx.dom.createElement('button', { type: 'button', class: 'pp-btn pp-primary' }) as HTMLButtonElement
      generate.textContent = 'Generate new paths'
      actions.append(cancel, generate)
      wrap.append(copy, input, saveLabel, error, actions)
      modal.root.appendChild(wrap)

      let submitted = false
      const cleanupDismiss = modal.onDismiss(() => {
        guidanceModal = null
        if (!submitted) {
          try { input.blur() } catch {}
        }
        try { cleanupDismiss() } catch {}
      })

      cancel.addEventListener('click', () => modal.dismiss())
      generate.addEventListener('click', () => {
        const guidance = String(input.value || '').trim()
        if (!guidance) {
          error.textContent = 'Add a little guidance first.'
          input.focus()
          return
        }
        submitted = true
        generate.disabled = true
        cancel.disabled = true
        try { input.blur() } catch {}
        modal.dismiss()
        guidanceModal = null

        // Let iOS finish dismissing its keyboard/modal viewport before the
        // message widget changes height/state underneath it.
        setTimeout(() => {
          renderLoading(messageId, chatId)
          ctx.sendToBackend({
            type: 'regenerate_with_guidance',
            chatId,
            messageId,
            guidance,
            saveAsPersonaGuidance: save.checked,
          })
        }, 120)
      })
    } catch (err) {
      console.error('[Persona Paths] Could not open guidance modal', err)
    }
  }

  function openWriterModal(chatId: string, messageId: string) {
    try {
      if (writerModal) {
        try { writerModal.dismiss() } catch {}
        writerModal = null
      }
      writerAnchor = { chatId, messageId }
      const currentDraft = getComposerText()
      writerHistory = [currentDraft]
      writerHistoryIndex = 0

      const modal = ctx.ui.showModal({
        title: currentDraft.trim() ? 'User Writer · Rewrite my draft' : 'User Writer · Write for me',
        width: 620,
        maxHeight: Math.min(760, Math.max(420, window.innerHeight - 24)),
      })
      writerModal = modal

      const wrap = ctx.dom.createElement('div', { class: 'pp-writer-modal' }) as HTMLElement
      const copy = ctx.dom.createElement('p', { class: 'pp-writer-copy' }) as HTMLElement
      copy.textContent = currentDraft.trim()
        ? 'User Writer will preserve what you decided and smooth it into one in-character user turn.'
        : 'The composer is empty, so User Writer will write a fresh in-character user turn from the current scene.'
      const direction = ctx.dom.createElement('textarea', {
        class: 'pp-writer-direction',
        placeholder: 'Optional direction: less confrontational; answer her question; keep the action from Path #3; make it more playful…',
      }) as HTMLTextAreaElement
      direction.autocapitalize = 'sentences'
      direction.autocomplete = 'off'
      direction.spellcheck = true

      const result = ctx.dom.createElement('textarea', { class: 'pp-writer-result' }) as HTMLTextAreaElement
      result.value = currentDraft
      result.placeholder = 'Generated draft will appear here.'
      result.spellcheck = true

      const status = ctx.dom.createElement('div', { class: 'pp-writer-status', role: 'status' }) as HTMLElement
      const history = ctx.dom.createElement('div', { class: 'pp-writer-history' }) as HTMLElement
      const prev = ctx.dom.createElement('button', { type: 'button', class: 'pp-btn' }) as HTMLButtonElement
      prev.textContent = '← Older'
      const count = ctx.dom.createElement('span') as HTMLElement
      const next = ctx.dom.createElement('button', { type: 'button', class: 'pp-btn' }) as HTMLButtonElement
      next.textContent = 'Newer →'
      history.append(prev, count, next)

      const actions = ctx.dom.createElement('div', { class: 'pp-writer-actions' }) as HTMLElement
      const close = ctx.dom.createElement('button', { type: 'button', class: 'pp-btn' }) as HTMLButtonElement
      close.textContent = 'Close'
      const restore = ctx.dom.createElement('button', { type: 'button', class: 'pp-btn' }) as HTMLButtonElement
      restore.textContent = 'Use selected draft'
      const generate = ctx.dom.createElement('button', { type: 'button', class: 'pp-btn pp-primary' }) as HTMLButtonElement
      generate.textContent = currentDraft.trim() ? 'Rewrite draft' : 'Write for me'
      actions.append(close, restore, generate)
      wrap.append(copy, direction, result, status, history, actions)
      modal.root.appendChild(wrap)

      const updateHistoryUi = () => {
        if (!writerHistory.length) {
          count.textContent = 'No drafts'
          prev.disabled = true; next.disabled = true; restore.disabled = true
          return
        }
        writerHistoryIndex = Math.max(0, Math.min(writerHistoryIndex, writerHistory.length - 1))
        result.value = writerHistory[writerHistoryIndex] || ''
        count.textContent = `Draft ${writerHistoryIndex + 1} of ${writerHistory.length}${writerHistoryIndex === 0 ? ' · original' : ''}`
        prev.disabled = writerHistoryIndex <= 0
        next.disabled = writerHistoryIndex >= writerHistory.length - 1
        restore.disabled = false
      }
      updateHistoryUi()

      prev.addEventListener('click', () => { if (writerHistoryIndex > 0) { writerHistoryIndex--; updateHistoryUi() } })
      next.addEventListener('click', () => { if (writerHistoryIndex < writerHistory.length - 1) { writerHistoryIndex++; updateHistoryUi() } })
      restore.addEventListener('click', () => {
        const value = String(result.value || '')
        if (replaceComposer(value)) status.textContent = 'Selected draft restored to the composer.'
      })
      close.addEventListener('click', () => modal.dismiss())
      generate.addEventListener('click', () => {
        if (writerPending) return
        const draft = getComposerText()
        writerPending = true
        generate.disabled = true
        restore.disabled = true
        prev.disabled = true
        next.disabled = true
        generate.textContent = draft.trim() ? 'Rewriting…' : 'Writing…'
        status.classList.remove('error')
        status.textContent = draft.trim() ? 'Polishing your draft with User Writer…' : 'Writing an in-character response with User Writer…'
        ctx.sendToBackend({
          type: 'user_writer',
          chatId,
          messageId,
          draft,
          direction: String(direction.value || '').trim(),
          sourceIntents: selectedPathIntents.slice(0, 6),
        })
      })

      const cleanupDismiss = modal.onDismiss(() => {
        writerModal = null
        writerAnchor = null
        writerPending = false
        try { cleanupDismiss() } catch {}
      })

      ;(modal as any).__ppWriter = { result, status, generate, restore, prev, next, updateHistoryUi }
    } catch (err) {
      console.error('[Persona Paths] Could not open User Writer modal', err)
    }
  }

  function finishWriterSuccess(text: string, writerMode: string) {
    const next = String(text || '').trim()
    if (!next) return
    if (!writerHistory.length) writerHistory = [getComposerText()]
    if (writerHistory[writerHistory.length - 1] !== next) writerHistory.push(next)
    writerHistoryIndex = writerHistory.length - 1
    replaceComposer(next)
    writerPending = false
    const ui = writerModal && (writerModal as any).__ppWriter
    if (ui) {
      ui.status.classList.remove('error')
      ui.status.textContent = writerMode === 'write' ? 'Fresh draft written and placed in the composer.' : 'Draft rewritten and placed in the composer.'
      ui.generate.disabled = false
      ui.generate.textContent = 'Generate another'
      ui.updateHistoryUi()
    }
  }

  function finishWriterError(message: string) {
    writerPending = false
    const ui = writerModal && (writerModal as any).__ppWriter
    if (ui) {
      ui.status.classList.add('error')
      ui.status.textContent = message || 'User Writer failed.'
      ui.generate.disabled = false
      ui.generate.textContent = 'Try again'
      ui.updateHistoryUi()
    }
  }

  function triggerUserWriter() {
    if (writerPending) return
    // A Path card is helpful when available, but User Writer must not depend on
    // successful Path generation. If Paths are disabled, skipped, blocked, or
    // failed, resolve the latest assistant reply directly from the active chat.
    if (activePathMessageId) {
      const data = dataByMessage.get(activePathMessageId)
      if (data?.chatId) {
        openWriterModal(data.chatId, activePathMessageId)
        return
      }
    }
    ctx.sendToBackend({ type: 'resolve_writer_latest' })
  }

  function clearNonActiveWidgets(keepMessageId?: string) {
    for (const [id, cleanup] of Array.from(cards.entries())) {
      if (keepMessageId && id === keepMessageId) continue
      try { cleanup() } catch {}
      cards.delete(id)
      widgetSignatures.delete(id)
      dataByMessage.delete(id)
    }
    if (!keepMessageId || activePathMessageId !== keepMessageId) {
      activePathMessageId = keepMessageId || null
    }
  }

  function activateMessage(messageId: string) {
    if (activePathMessageId !== messageId) clearNonActiveWidgets(messageId)
    activePathMessageId = messageId
  }

  function renderMessageWidget(messageId: string, chatId: string, model: any) {
    activateMessage(messageId)

    const prismColor = /^#[0-9A-F]{6}$/i.test(String(model?.prismColor || ''))
      ? String(model.prismColor).toUpperCase()
      : ''
    const payload = {
      mode: model?.mode || 'choices',
      messageId,
      chatId,
      styleText: String(model?.styleText || ''),
      sceneState: model?.sceneState || null,
      choices: Array.isArray(model?.choices) ? model.choices : [],
      error: String(model?.error || ''),
      prismColor,
    }
    const signature = JSON.stringify(payload)
    if (cards.has(messageId) && widgetSignatures.get(messageId) === signature) return true

    const previous = cards.get(messageId)
    if (previous) {
      try { previous() } catch {}
      cards.delete(messageId)
      widgetSignatures.delete(messageId)
    }

    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  html, body { margin:0; padding:0; width:100%; overflow:hidden; background:transparent; }
  body { box-sizing:border-box; color:var(--lumiverse-text); font-family:inherit; }
  * { box-sizing:border-box; }
  .card {
    width:100%; min-width:0; margin:10px 0 2px; padding:10px;
    border:1px solid var(--lumiverse-border); border-radius:14px;
    background:color-mix(in srgb, var(--lumiverse-fill-subtle) 88%, transparent);
    box-shadow:0 5px 18px rgba(0,0,0,.12);
  }
  .head { display:flex; align-items:center; gap:8px; min-width:0; margin:0 2px 8px; min-height:26px; }
  .brand { font-size:12px; font-weight:700; letter-spacing:.02em; color:var(--lumiverse-text-muted); }
  .state {
    display:flex; justify-content:space-between; gap:12px; align-items:center; min-width:0;
    margin:0 2px 10px; padding:7px 9px; border:1px solid var(--lumiverse-border);
    border-radius:10px; background:color-mix(in srgb, var(--lumiverse-fill) 72%, transparent);
  }
  .state[hidden] { display:none !important; }
  .state-item { display:flex; align-items:center; gap:6px; min-width:0; color:var(--lumiverse-text-muted); }
  .state-item:last-child { justify-content:flex-end; text-align:right; }
  .state-glyph { flex:0 0 auto; font-size:10px; opacity:.7; }
  .state-value { min-width:0; font-size:9.8px; font-weight:750; letter-spacing:.055em; text-transform:uppercase; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .style { font-size:10px; color:var(--lumiverse-text-muted); opacity:.78; }
  .toast { font-size:10px; color:var(--lumiverse-text-muted); opacity:0; transition:opacity .15s; }
  .toast.show { opacity:1; }
  .spacer { flex:1; min-width:0; }
  .icon {
    border:0; background:transparent; color:var(--lumiverse-text-muted); cursor:pointer;
    border-radius:8px; width:28px; height:28px; padding:0; font-size:17px; line-height:1;
  }
  .icon:hover { background:var(--lumiverse-fill); color:var(--lumiverse-text); }
  .choices { display:flex; flex-direction:column; gap:7px; min-width:0; }
  .choice {
    display:block; width:100%; min-width:0; max-width:100%; text-align:left; cursor:pointer;
    border:1px solid transparent; border-radius:12px; padding:10px 12px;
    background:var(--lumiverse-fill); color:var(--lumiverse-text);
  }
  .choice:hover { border-color:var(--lumiverse-border-hover, var(--lumiverse-border)); background:var(--lumiverse-fill-subtle); }
  .top { display:flex; align-items:center; gap:8px; min-width:0; margin-bottom:4px; }
  .num {
    width:20px; height:20px; flex:0 0 auto; border-radius:999px; display:inline-flex;
    align-items:center; justify-content:center; font-size:10px; font-weight:800;
    background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text-muted);
  }
  .title { min-width:0; font-size:12px; font-weight:700; overflow-wrap:anywhere; }
  .heat { position:relative; margin-left:auto; display:inline-flex; gap:3px; flex:0 0 auto; align-items:center; cursor:help; }
  .heat-dot { width:6px; height:6px; border-radius:999px; border:1px solid currentColor; opacity:.38; }
  .heat-dot.on { background:currentColor; opacity:.82; }
  .advance {
    margin-left:2px; flex:0 0 auto; font-size:9px; font-weight:700; letter-spacing:.04em;
    text-transform:uppercase; opacity:.72; padding:2px 6px; border:1px solid var(--lumiverse-border);
    border-radius:999px; white-space:nowrap;
  }
  .text {
    display:block; min-width:0; max-width:100%; font-size:12.5px; line-height:1.45;
    color:var(--lumiverse-text-muted); white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word;
    filter:blur(4px); opacity:.42; user-select:none; pointer-events:none;
    transition:filter .13s ease, opacity .13s ease;
  }
  .choice:hover .text, .choice:focus-visible .text, .choice.revealed .text { filter:none; opacity:1; user-select:text; }
  .footer-hint { margin:9px 2px 1px; text-align:center; font-size:9.5px; color:var(--lumiverse-text-muted); opacity:.68; letter-spacing:.02em; }
  .loading { display:flex; align-items:center; gap:8px; color:var(--lumiverse-text-muted); font-size:12px; padding:4px 2px; }
  .dot { width:6px; height:6px; border-radius:999px; background:currentColor; animation:pulse 1.1s infinite alternate; }
  @keyframes pulse { from{opacity:.25; transform:scale(.8)} to{opacity:1; transform:scale(1.1)} }
  .error { font-size:12px; line-height:1.4; color:var(--lumiverse-text-muted); padding:4px 2px; }
  .btn {
    border:1px solid var(--lumiverse-border); border-radius:9px; background:var(--lumiverse-fill);
    color:var(--lumiverse-text); padding:8px 10px; font:inherit; font-size:11px; cursor:pointer;
  }
  .btn:hover { background:var(--lumiverse-fill-subtle); }
  .primary { font-weight:750; }
  .guide { margin-top:9px; padding:10px; border:1px solid var(--lumiverse-border); border-radius:11px; background:var(--lumiverse-fill); }
  .guide[hidden] { display:none !important; }
  .guide-title { font-size:11.5px; font-weight:750; margin-bottom:6px; }
  textarea {
    width:100%; min-height:72px; resize:vertical; border:1px solid var(--lumiverse-border); border-radius:9px;
    background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text); padding:8px 9px; font:inherit; font-size:12px; line-height:1.4;
  }
  .save { display:flex; align-items:center; gap:7px; margin-top:8px; font-size:10.5px; color:var(--lumiverse-text-muted); cursor:pointer; }
  .actions { display:flex; justify-content:flex-end; gap:7px; margin-top:9px; }
  .hint { margin-top:7px; font-size:9.8px; line-height:1.35; color:var(--lumiverse-text-muted); opacity:.78; }
  em { font-style:italic; }
</style>
</head>
<body>
  <section class="card">
    <div class="head">
      <span class="brand">Persona Paths</span>
      <span class="style" id="style"></span>
      <span class="toast" id="toast">Added to composer</span>
      <span class="spacer"></span>
      <button type="button" class="icon" id="polishBtn" title="User Writer: write or rewrite the composer" aria-label="Open User Writer">✦</button>
      <button type="button" class="icon" id="guideBtn" title="Regenerate with guidance" aria-label="Regenerate with guidance">✎</button>
      <button type="button" class="icon" id="regenBtn" title="Regenerate choices" aria-label="Regenerate choices">↻</button>
    </div>
    <div class="state" id="sceneState" hidden>
      <div class="state-item"><span class="state-glyph">⌖</span><span class="state-value" id="stateLocation"></span></div>
      <div class="state-item"><span class="state-glyph">◷</span><span class="state-value" id="stateMoment"></span></div>
    </div>
    <div class="choices" id="choices"></div>
    <div class="footer-hint" id="footerHint" hidden></div>
    <div class="guide" id="guide" hidden>
      <div class="guide-title">Regenerate with guidance</div>
      <textarea id="guidance" placeholder="What direction were you thinking? e.g. Stop arguing and give me options where Rook physically leaves camp."></textarea>
      <label class="save"><input type="checkbox" id="saveGuidance"> Save this as active persona guidance</label>
      <div class="actions">
        <button type="button" class="btn" id="cancelGuide">Cancel</button>
        <button type="button" class="btn primary" id="generateGuide">Generate new paths</button>
      </div>
      <div class="hint">One-shot by default. Saving appends this correction to the active persona’s private Persona Paths guidance.</div>
    </div>
  </section>
<script>
(() => {
  const model = ${widgetJson(payload)};
  const host = document.getElementById('choices');
  const style = document.getElementById('style');
  const toast = document.getElementById('toast');
  const guide = document.getElementById('guide');
  const polishBtn = document.getElementById('polishBtn');
  const guideBtn = document.getElementById('guideBtn');
  const regenBtn = document.getElementById('regenBtn');
  const sceneState = document.getElementById('sceneState');
  const stateLocation = document.getElementById('stateLocation');
  const stateMoment = document.getElementById('stateMoment');
  const footerHint = document.getElementById('footerHint');
  const color = /^#[0-9A-F]{6}$/i.test(model.prismColor || '') ? model.prismColor : '';
  const canHover = !!window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  style.textContent = model.styleText || '';
  const loc = String(model.sceneState?.location || '').trim();
  const moment = String(model.sceneState?.moment || '').trim();
  if (loc || moment) {
    stateLocation.textContent = loc || 'Current scene';
    stateMoment.textContent = moment || 'Current beat';
    sceneState.hidden = false;
  }

  function resize() { try { window.spindleSandbox.requestResize(); } catch {} }
  function post(payload) { window.spindleSandbox.postMessage(payload); }
  function appendItalic(parent, text) {
    const source = String(text || '');
    const pattern = /(^|[^*])\\*([^*\\n]+?)\\*(?!\\*)/g;
    let cursor = 0, match;
    while ((match = pattern.exec(source))) {
      const boundary = match[1] || '';
      const italicText = match[2] || '';
      const italicStart = match.index + boundary.length;
      if (italicStart > cursor) parent.appendChild(document.createTextNode(source.slice(cursor, italicStart)));
      const em = document.createElement('em'); em.textContent = italicText; parent.appendChild(em);
      cursor = pattern.lastIndex;
    }
    if (cursor < source.length) parent.appendChild(document.createTextNode(source.slice(cursor)));
  }
  function renderRich(parent, text) {
    const source = String(text || '');
    if (!color) { appendItalic(parent, source); return; }
    const pattern = /“[^”\\n]+”|(^|[\\s([{>—–-])"[^"\\n]+"(?=$|[\\s)\\]}>.,!?;:—–-])/gm;
    let cursor = 0, match;
    while ((match = pattern.exec(source))) {
      let start = match.index;
      let quoted = match[0];
      if (match[1]) {
        appendItalic(parent, source.slice(cursor, start + match[1].length));
        start += match[1].length;
        quoted = quoted.slice(match[1].length);
      } else if (start > cursor) appendItalic(parent, source.slice(cursor, start));
      const span = document.createElement('span'); span.textContent = quoted; span.style.color = color; parent.appendChild(span);
      cursor = start + quoted.length;
    }
    if (cursor < source.length) appendItalic(parent, source.slice(cursor));
    if (!parent.childNodes.length) appendItalic(parent, source);
  }
  function showToast(text) {
    toast.textContent = text; toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 1400);
  }

  if (model.mode === 'loading') {
    polishBtn.hidden = false; guideBtn.hidden = true; regenBtn.hidden = true;
    const row = document.createElement('div'); row.className = 'loading';
    const dot = document.createElement('span'); dot.className = 'dot';
    const label = document.createElement('span'); label.textContent = 'Reading the scene…';
    row.append(dot, label); host.appendChild(row);
  } else if (model.mode === 'error') {
    polishBtn.hidden = false; guideBtn.hidden = true; regenBtn.hidden = false;
    const msg = document.createElement('div'); msg.className = 'error'; msg.textContent = 'Couldn’t generate choices. ' + (model.error || 'Unknown error');
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn'; retry.style.marginTop = '8px'; retry.textContent = 'Retry';
    retry.addEventListener('click', () => post({ type:'retry' }));
    host.append(msg, retry);
  } else {
    (model.choices || []).forEach((choice, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'choice';
      const top = document.createElement('span'); top.className = 'top';
      const num = document.createElement('span'); num.className = 'num'; num.textContent = String(index + 1);
      const title = document.createElement('span'); title.className = 'title'; title.textContent = choice.title || choice.intent || ('Option ' + (index + 1));
      top.append(num, title);
      const intensity = Math.max(1, Math.min(3, Math.round(Number(choice.intensity) || 0)));
      if (intensity) {
        const heat = document.createElement('span'); heat.className = 'heat';
        const heatLabel = intensity === 1 ? 'Low impact' : intensity === 2 ? 'Decisive' : 'Volatile';
        heat.title = 'Intensity ' + intensity + '/3 — ' + heatLabel;
        heat.setAttribute('aria-label', heat.title);
        for (let dotIndex = 1; dotIndex <= 3; dotIndex++) {
          const dot = document.createElement('span'); dot.className = 'heat-dot' + (dotIndex <= intensity ? ' on' : ''); heat.appendChild(dot);
        }
        top.appendChild(heat);
      }
      if (choice.advances_scene) {
        const badge = document.createElement('span'); badge.className = 'advance'; badge.textContent = 'Advance scene'; top.appendChild(badge);
      }
      const body = document.createElement('span'); body.className = 'text'; renderRich(body, choice.text || '');
      button.append(top, body);
      button.addEventListener('click', () => {
        if (!canHover && !button.classList.contains('revealed')) {
          button.classList.add('revealed');
          showToast('Revealed · tap again to add');
          return;
        }
        post({ type:'choice', index }); showToast('Added · click another to combine');
      });
      host.appendChild(button);
    });
    footerHint.textContent = canHover ? 'Scan the labels · hover to reveal a Path · click to add' : 'Scan the labels · tap to reveal · tap again to add';
    footerHint.hidden = false;
  }

  polishBtn.addEventListener('click', () => { post({ type:'rewrite' }); });
  regenBtn.addEventListener('click', () => post({ type:'regenerate' }));
  guideBtn.addEventListener('click', () => {
    // Typing inside a virtualized sandbox widget causes iOS Safari to fight
    // Lumiverse row resizing + keyboard viewport changes. Touch-first devices
    // hand steering off to a host-managed modal instead.
    if (!canHover) { post({ type:'open_guidance_modal' }); return; }
    guide.hidden = !guide.hidden; resize();
    if (!guide.hidden) setTimeout(() => document.getElementById('guidance').focus(), 0);
  });
  document.getElementById('cancelGuide').addEventListener('click', () => { guide.hidden = true; resize(); });
  document.getElementById('generateGuide').addEventListener('click', () => {
    const guidance = String(document.getElementById('guidance').value || '').trim();
    if (!guidance) { document.getElementById('guidance').focus(); return; }
    post({ type:'guidance', guidance, saveAsPersonaGuidance: !!document.getElementById('saveGuidance').checked });
  });
  resize();
})();
</script>
</body>
</html>`

    try {
      const cleanup = ctx.messages.renderWidget(
        { messageId, widgetId: 'persona-paths-card', html },
        async (event: any) => {
          if (!event || typeof event !== 'object') return
          const type = String(event.type || '')
          if (type === 'choice') {
            const data = dataByMessage.get(messageId)
            const index = Number(event.index)
            const choice = data?.choices?.[index]
            if (choice) {
              await fillComposer(choice.text)
              const title = String(choice.title || `Path #${index + 1}`).trim()
              const intent = String(choice.intent || '').trim()
              const label = intent && intent.toLowerCase() !== title.toLowerCase() ? `${title} — ${intent}` : title
              if (label && !selectedPathIntents.includes(label)) selectedPathIntents.push(label)
            }
            return
          }
          if (type === 'rewrite') {
            openWriterModal(chatId, messageId)
            return
          }
          if (type === 'regenerate' || type === 'retry') {
            renderLoading(messageId, chatId)
            ctx.sendToBackend({ type: 'regenerate', chatId, messageId })
            return
          }
          if (type === 'open_guidance_modal') {
            openGuidanceModal(chatId, messageId)
            return
          }
          if (type === 'guidance') {
            const guidance = String(event.guidance || '').trim()
            if (!guidance) return
            renderLoading(messageId, chatId)
            ctx.sendToBackend({
              type: 'regenerate_with_guidance',
              chatId,
              messageId,
              guidance,
              saveAsPersonaGuidance: !!event.saveAsPersonaGuidance,
            })
          }
        },
      )
      cards.set(messageId, cleanup)
      widgetSignatures.set(messageId, signature)
      return true
    } catch (err) {
      console.error('[Persona Paths] Message widget render failed', err)
      return false
    }
  }

  function removeCard(messageId: string) {
    const cleanup = cards.get(messageId)
    if (cleanup) {
      try { cleanup() } catch {}
    }
    cards.delete(messageId)
    widgetSignatures.delete(messageId)
    dataByMessage.delete(messageId)
    if (activePathMessageId === messageId) activePathMessageId = null
  }

  function renderLoading(messageId: string, chatId: string) {
    renderMessageWidget(messageId, chatId, { mode: 'loading' })
  }

  function renderError(messageId: string, chatId: string, error: string) {
    renderMessageWidget(messageId, chatId, { mode: 'error', error })
  }

  function renderChoices(data: CachedPath) {
    dataByMessage.set(data.messageId, data)
    renderMessageWidget(data.messageId, data.chatId, {
      mode: 'choices',
      styleText: titleCaseStyle(data.style),
      sceneState: data.sceneState,
      choices: data.choices,
      prismColor: currentState?.prismInfo?.color || data.prismColor,
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
      width: 126,
      height: 38,
      initialPosition: {
        x: 16,
        y: Math.max(12, window.innerHeight - 142),
      },
      snapToEdge: true,
      tooltip: `Persona Paths + User Writer v${EXT_VERSION}`,
      chromeless: true,
    })
    const launcherGroup = ctx.dom.createElement('div', { class: 'pp-launcher-group' }) as HTMLElement
    const launcher = ctx.dom.createElement('button', { type: 'button', class: 'pp-launcher paths' }) as HTMLButtonElement
    launcher.title = `Open Persona Paths v${EXT_VERSION}`
    launcher.setAttribute('aria-label', 'Open Persona Paths')
    launcher.innerHTML = `${PATHS_ICON}<span>Paths</span>`
    launcher.addEventListener('click', () => tab.activate())
    const writerLauncher = ctx.dom.createElement('button', { type: 'button', class: 'pp-launcher writer' }) as HTMLButtonElement
    writerLauncher.title = 'User Writer — write or rewrite the current composer'
    writerLauncher.setAttribute('aria-label', 'Open User Writer')
    writerLauncher.textContent = '✦'
    writerLauncher.addEventListener('click', triggerUserWriter)
    launcherGroup.append(launcher, writerLauncher)
    floatLauncher.root.appendChild(launcherGroup)
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

  // Manual generation is intentionally independent of the automatic trigger.
  // It resolves the active chat on the backend, so it still works after a
  // browser refresh/update when no old Persona Paths retry card is mounted.
  let manualAction: any = null
  let unsubManualAction = () => {}
  let polishAction: any = null
  let unsubPolishAction = () => {}

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

  const skipOoc = ctx.dom.createElement('input', { type: 'checkbox' }) as HTMLInputElement
  const skipOocLabel = ctx.dom.createElement('label', { class: 'pp-check' }) as HTMLLabelElement
  skipOocLabel.append(skipOoc, document.createTextNode('Skip OOC exchanges'))
  skipOoc.addEventListener('change', () => scheduleSave({ skipOoc: skipOoc.checked }, 0))
  settings.appendChild(skipOocLabel)
  const skipOocHint = ctx.dom.createElement('div', { class: 'pp-hint' }) as HTMLElement
  skipOocHint.textContent = 'Automatic generation ignores [OOC], [OOC]:, [ooc}:, (OOC):, and OOC: turns. The assistant reply to an OOC user message is skipped too, even if it does not repeat the marker. Manual Generate Paths can explicitly override this guard. OOC exchanges still stay out of portrayal examples and relationship learning.'
  settings.appendChild(skipOocHint)

  const manualRun = ctx.dom.createElement('button', { type: 'button', class: 'pp-btn pp-primary' }) as HTMLButtonElement
  manualRun.textContent = 'Generate Paths for latest reply'
  const manualStatus = ctx.dom.createElement('div', { class: 'pp-manual-status' }) as HTMLElement
  manualStatus.textContent = 'Manual runs ignore the automatic on/off toggle and can force Paths even on an OOC exchange.'
  let manualPending = false

  function triggerManualGeneration() {
    if (manualPending) return
    manualPending = true
    manualRun.disabled = true
    manualRun.textContent = 'Finding latest reply…'
    manualStatus.classList.remove('error')
    manualStatus.textContent = 'Resolving the active chat and latest assistant reply…'
    ctx.sendToBackend({ type: 'manual_generate_latest' })
  }

  manualRun.addEventListener('click', triggerManualGeneration)
  settings.append(manualRun, manualStatus)

  // Also make the same manual run available from Lumiverse's native Extras menu.
  try {
    manualAction = ctx.ui.registerInputBarAction({
      id: 'generate-persona-paths',
      label: 'Generate Paths for Latest Reply',
      iconSvg: PATHS_ICON,
      enabled: true,
    })
    unsubManualAction = manualAction.onClick(triggerManualGeneration)
  } catch {}

  // Draft Polish works on whatever is currently in the composer, including a
  // selected Path plus the user's own edits or several combined Paths.
  try {
    polishAction = ctx.ui.registerInputBarAction({
      id: 'polish-persona-paths-draft',
      label: 'User Writer',
      iconSvg: PATHS_ICON,
      enabled: true,
    })
    unsubPolishAction = polishAction.onClick(triggerUserWriter)
  } catch {}

  const CONNECTION_MODEL = '__connection_model__'
  const MANUAL_MODEL = '__manual_model__'
  let openRouterModels: Array<{ id: string; name: string; contextLength?: number; reasoning?: boolean }> = []
  let openRouterCatalogPending = false
  let openRouterCatalogError = ''
  let openRouterFetchedAt = 0

  function isOpenRouterConnection(conn: any) {
    const provider = String(conn?.provider || '').toLowerCase()
    const apiUrl = String(conn?.api_url || conn?.apiUrl || '').toLowerCase()
    return provider.includes('openrouter') || apiUrl.includes('openrouter.ai')
  }

  function formatContextLength(value: unknown) {
    const n = Number(value)
    if (!Number.isFinite(n) || n <= 0) return ''
    if (n >= 1_000_000) {
      const m = n / 1_000_000
      return `${Number.isInteger(m) ? m.toFixed(0) : m.toFixed(1)}M context`
    }
    if (n >= 1_000) return `${Math.round(n / 1000)}K context`
    return `${Math.round(n)} context`
  }

  function catalogOptions(conn: any, override: string) {
    const useConnection = {
      value: CONNECTION_MODEL,
      label: 'Use connection model',
      sublabel: String(conn?.model || 'Follow the selected connection profile'),
    }
    const modelOptions = openRouterModels.map(model => {
      const bits = [model.id]
      const context = formatContextLength(model.contextLength)
      if (context) bits.push(context)
      if (model.reasoning) bits.push('reasoning')
      return { value: model.id, label: model.name || model.id, sublabel: bits.join(' · ') }
    })
    if (override) {
      const index = modelOptions.findIndex(opt => opt.value === override)
      if (index > 0) {
        const [selected] = modelOptions.splice(index, 1)
        modelOptions.unshift(selected)
      }
    }
    return [
      useConnection,
      ...modelOptions,
      { value: MANUAL_MODEL, label: 'Manual model ID…', sublabel: 'Paste an exact model ID that is not in the catalog' },
    ]
  }

  function requestOpenRouterCatalog(force = false) {
    if (openRouterCatalogPending) return
    if (!currentState?.corsGranted) {
      openRouterCatalogError = 'Grant the CORS Proxy permission to load OpenRouter models. Manual model IDs still work.'
      updateModelPickers()
      return
    }
    if (!force && openRouterModels.length) return
    openRouterCatalogPending = true
    openRouterCatalogError = ''
    updateModelPickers()
    ctx.sendToBackend({ type: 'get_openrouter_models', force })
  }

  const connectionSlot = ctx.dom.createElement('div', { class: 'pp-native-select-slot' }) as HTMLElement
  settings.appendChild(createLabeledField(ctx, 'Persona Paths connection', connectionSlot, 'Connection used to generate the CYOA Path choices. This can stay completely separate from your story model.'))
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

  const modelSlot = ctx.dom.createElement('div', { class: 'pp-native-select-slot' }) as HTMLElement
  const modelField = createLabeledField(ctx, 'Paths model', modelSlot, 'OpenRouter connections get a live searchable model catalog. Choose Use connection model to follow the connection profile.')
  settings.appendChild(modelField)
  const modelPicker = ctx.components.mountSelect(modelSlot, {
    value: CONNECTION_MODEL,
    options: [],
    placeholder: 'Use connection model',
    searchPlaceholder: 'Search OpenRouter models…',
    noResultsMessage: 'No matching models.',
    emptyMessage: 'Model catalog unavailable.',
    portal: true,
    maxHeight: 420,
    minWidth: 340,
    onChange: (value: string) => {
      if (value === CONNECTION_MODEL) scheduleSave({ modelOverride: '' }, 0)
      else if (value === MANUAL_MODEL) {
        modelOverrideWrap.hidden = false
        setTimeout(() => modelOverride.focus(), 0)
      } else scheduleSave({ modelOverride: value }, 0)
    },
  })
  const modelCatalogStatus = ctx.dom.createElement('div', { class: 'pp-connection-status' }) as HTMLElement
  const refreshModels = ctx.dom.createElement('button', { type: 'button', class: 'pp-btn' }) as HTMLButtonElement
  refreshModels.textContent = 'Refresh OpenRouter models'
  refreshModels.addEventListener('click', () => {
    openRouterModels = []
    openRouterCatalogError = ''
    requestOpenRouterCatalog(true)
  })
  const modelTools = ctx.dom.createElement('div', { class: 'pp-model-tools' }) as HTMLElement
  modelTools.append(modelCatalogStatus, refreshModels)
  settings.appendChild(modelTools)

  const modelOverride = ctx.dom.createElement('input', { type: 'text', placeholder: 'e.g. google/gemini-3.1-pro-preview' }) as HTMLInputElement
  modelOverride.addEventListener('input', () => scheduleSave({ modelOverride: modelOverride.value }))
  const modelOverrideWrap = createLabeledField(ctx, 'Manual Paths model ID', modelOverride, 'Fallback for aliases, custom IDs, or models not present in OpenRouter’s public catalog.')
  settings.appendChild(modelOverrideWrap)

  const writerDivider = ctx.dom.createElement('div', { class: 'pp-divider' }) as HTMLElement
  settings.appendChild(writerDivider)
  const writerHeading = ctx.dom.createElement('h3') as HTMLElement
  writerHeading.textContent = 'User Writer'
  const writerIntro = ctx.dom.createElement('p') as HTMLElement
  writerIntro.textContent = 'Write For Me and Rewrite/Polish are independent from Path generation. They stay available when Paths are disabled, skipped, blocked, or fail.'
  settings.append(writerHeading, writerIntro)

  const writerConnectionSlot = ctx.dom.createElement('div', { class: 'pp-native-select-slot' }) as HTMLElement
  settings.appendChild(createLabeledField(ctx, 'User Writer connection', writerConnectionSlot, 'Defaults to Same as Persona Paths, or choose a different connection/provider specifically for prose writing.'))
  const writerConnectionPicker = ctx.components.mountSelect(writerConnectionSlot, {
    value: '__same_as_paths__',
    options: [],
    placeholder: 'Same as Persona Paths',
    searchPlaceholder: 'Search connections…',
    noResultsMessage: 'No matching connections.',
    emptyMessage: 'No Lumiverse LLM connections are available.',
    portal: true,
    maxHeight: 360,
    minWidth: 300,
    onChange: (connectionId: string) => scheduleSave({ writerConnectionId: connectionId === '__same_as_paths__' ? '' : connectionId }, 0),
  })
  const writerConnectionStatus = ctx.dom.createElement('div', { class: 'pp-connection-status' }) as HTMLElement
  writerConnectionStatus.textContent = 'User Writer currently follows the Persona Paths connection.'
  settings.appendChild(writerConnectionStatus)

  const writerModelSlot = ctx.dom.createElement('div', { class: 'pp-native-select-slot' }) as HTMLElement
  settings.appendChild(createLabeledField(ctx, 'User Writer model', writerModelSlot, 'When the resolved writer connection is OpenRouter, search the live model catalog by friendly name or exact model ID.'))
  const writerModelPicker = ctx.components.mountSelect(writerModelSlot, {
    value: CONNECTION_MODEL,
    options: [],
    placeholder: 'Use writer connection model',
    searchPlaceholder: 'Search OpenRouter models…',
    noResultsMessage: 'No matching models.',
    emptyMessage: 'Model catalog unavailable.',
    portal: true,
    maxHeight: 420,
    minWidth: 340,
    onChange: (value: string) => {
      if (value === CONNECTION_MODEL) scheduleSave({ writerModelOverride: '' }, 0)
      else if (value === MANUAL_MODEL) {
        writerModelOverrideWrap.hidden = false
        setTimeout(() => writerModelOverride.focus(), 0)
      } else scheduleSave({ writerModelOverride: value }, 0)
    },
  })
  const writerModelCatalogStatus = ctx.dom.createElement('div', { class: 'pp-connection-status' }) as HTMLElement
  settings.appendChild(writerModelCatalogStatus)

  const writerModelOverride = ctx.dom.createElement('input', { type: 'text', placeholder: 'e.g. anthropic/claude-sonnet-5' }) as HTMLInputElement
  writerModelOverride.addEventListener('input', () => scheduleSave({ writerModelOverride: writerModelOverride.value }))
  const writerModelOverrideWrap = createLabeledField(ctx, 'Manual Writer model ID', writerModelOverride, 'Fallback for aliases, custom IDs, or models not present in OpenRouter’s public catalog.')
  settings.appendChild(writerModelOverrideWrap)

  function updateOneModelPicker(picker: any, manualWrap: HTMLElement, status: HTMLElement, conn: any, override: string, writer = false) {
    const openRouter = isOpenRouterConnection(conn)
    const exactOverride = String(override || '').trim()
    if (!openRouter) {
      picker.update({
        value: exactOverride ? MANUAL_MODEL : CONNECTION_MODEL,
        options: [
          { value: CONNECTION_MODEL, label: writer ? 'Use writer connection model' : 'Use connection model', sublabel: String(conn?.model || 'Follow the selected connection profile') },
          { value: MANUAL_MODEL, label: 'Manual model ID…', sublabel: 'Searchable catalogs are currently available for OpenRouter connections' },
        ],
      })
      manualWrap.hidden = !exactOverride
      status.classList.remove('error')
      status.textContent = conn
        ? `${String(conn.provider || 'This provider')} does not expose a searchable text-model catalog to Persona Paths; manual override remains available.`
        : 'Choose a connection to configure a model.'
      return
    }

    const hasCatalogMatch = !!exactOverride && openRouterModels.some(model => model.id === exactOverride)
    picker.update({
      value: !exactOverride ? CONNECTION_MODEL : (hasCatalogMatch ? exactOverride : MANUAL_MODEL),
      options: catalogOptions(conn, exactOverride),
    })
    manualWrap.hidden = !exactOverride || hasCatalogMatch

    if (openRouterCatalogPending) {
      status.classList.remove('error')
      status.textContent = 'Loading OpenRouter’s searchable model catalog…'
    } else if (openRouterCatalogError) {
      status.classList.add('error')
      status.textContent = openRouterCatalogError
    } else if (openRouterModels.length) {
      status.classList.remove('error')
      const age = openRouterFetchedAt ? Math.max(0, Math.round((Date.now() - openRouterFetchedAt) / 60000)) : 0
      status.textContent = `${openRouterModels.length} OpenRouter text models loaded${age ? ` · refreshed ${age}m ago` : ''}. Search by model name or exact ID.`
    } else {
      status.classList.remove('error')
      status.textContent = 'OpenRouter connection detected. Loading searchable models…'
    }
  }

  function updateModelPickers() {
    const state = currentState || {}
    const cfg = state.config || {}
    const conns = Array.isArray(state.connections) ? state.connections : []
    const selectedConnection = cfg.connectionId && conns.some((c: any) => c.id === cfg.connectionId)
      ? cfg.connectionId
      : (conns.find((c: any) => c.is_default) || conns[0])?.id || ''
    const pathsConn = conns.find((c: any) => String(c.id) === String(selectedConnection))
    const writerConn = cfg.writerConnectionId
      ? (conns.find((c: any) => String(c.id) === String(cfg.writerConnectionId)) || pathsConn)
      : pathsConn

    updateOneModelPicker(modelPicker, modelOverrideWrap, modelCatalogStatus, pathsConn, cfg.modelOverride || '', false)
    updateOneModelPicker(writerModelPicker, writerModelOverrideWrap, writerModelCatalogStatus, writerConn, cfg.writerModelOverride || '', true)

    const needsCatalog = isOpenRouterConnection(pathsConn) || isOpenRouterConnection(writerConn)
    refreshModels.hidden = !needsCatalog
    if (needsCatalog && !openRouterModels.length && !openRouterCatalogPending && !openRouterCatalogError) requestOpenRouterCatalog(false)
  }

  const writerTuningGrid = ctx.dom.createElement('div', { class: 'pp-grid' }) as HTMLElement
  const writerTemperature = ctx.dom.createElement('input', { type: 'number', min: '0', max: '2', step: '0.05' }) as HTMLInputElement
  writerTemperature.addEventListener('change', () => scheduleSave({ writerTemperature: Number(writerTemperature.value) }, 0))
  const writerMaxTokens = ctx.dom.createElement('input', { type: 'number', min: '500', max: '32000', step: '100' }) as HTMLInputElement
  writerMaxTokens.addEventListener('change', () => scheduleSave({ writerMaxTokens: Number(writerMaxTokens.value) }, 0))
  writerTuningGrid.append(
    createLabeledField(ctx, 'Writer temperature', writerTemperature, 'Independent prose-writing temperature.'),
    createLabeledField(ctx, 'Writer max output tokens', writerMaxTokens, 'Independent writer budget. Always-thinking Kimi models still get the automatic 16k floor.'),
  )
  settings.appendChild(writerTuningGrid)

  const writerReasoningToggle = ctx.dom.createElement('input', { type: 'checkbox' }) as HTMLInputElement
  const writerReasoningLabel = ctx.dom.createElement('label', { class: 'pp-check' }) as HTMLLabelElement
  writerReasoningLabel.append(writerReasoningToggle, document.createTextNode('Use User Writer connection reasoning / thinking'))
  writerReasoningToggle.addEventListener('change', () => scheduleSave({ writerUseReasoning: writerReasoningToggle.checked }, 0))
  settings.appendChild(writerReasoningLabel)

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

  const prismIntegration = ctx.dom.createElement('select') as HTMLSelectElement
  ;[['auto','Auto'],['manual','Manual'],['off','Off']].forEach(([v,l]) => {
    const o = document.createElement('option'); o.value=v; o.textContent=l; prismIntegration.appendChild(o)
  })
  prismIntegration.addEventListener('change', () => {
    prismColorInput.disabled = prismIntegration.value !== 'manual' || !currentState?.activePersona?.id
    scheduleSave({ prismIntegration: prismIntegration.value }, 0)
  })

  const prismColorInput = ctx.dom.createElement('input', { type: 'text', placeholder: '#B6E472', maxlength: '7', spellcheck: 'false' }) as HTMLInputElement
  let prismColorTimer: any = null
  prismColorInput.addEventListener('input', () => {
    const personaId = currentState?.activePersona?.id
    if (!personaId || prismIntegration.value !== 'manual') return
    if (prismColorTimer) clearTimeout(prismColorTimer)
    prismColorTimer = setTimeout(() => ctx.sendToBackend({ type: 'set_prism_color_override', personaId, color: prismColorInput.value }), 220)
  })

  behaviorGrid.append(
    createLabeledField(ctx, 'Choice generation delay', generationDelay, 'Waits until the assistant message has rendered, then gives Lumiverse this extra settling time.'),
    createLabeledField(ctx, 'Adult-content handling', adultContent, 'Match scene keeps the current explicitness. Allow explicit permits explicit adult choices when contextually appropriate; it does not force escalation.'),
    createLabeledField(ctx, 'Prism integration', prismIntegration, 'Auto detects Prism’s active persona color. Manual uses the color you set below. Color markup is always stripped before the CYOA model sees the story.'),
    createLabeledField(ctx, 'Manual Prism persona color', prismColorInput, 'Stored per active persona. Use #RRGGBB, for example #B6E472. Manual mode always wins over historical Prism evidence.'),
  )
  settings.appendChild(behaviorGrid)
  const prismStatus = ctx.dom.createElement('div', { class: 'pp-prism-status' }) as HTMLElement
  prismStatus.textContent = 'Checking Prism…'
  settings.appendChild(prismStatus)

  const grid2 = ctx.dom.createElement('div', { class: 'pp-grid' }) as HTMLElement
  const contextMessages = ctx.dom.createElement('input', { type: 'number', min: '6', max: '40', step: '1' }) as HTMLInputElement
  contextMessages.addEventListener('change', () => scheduleSave({ contextMessages: Number(contextMessages.value) }, 0))
  const recentUserExamples = ctx.dom.createElement('input', { type: 'number', min: '2', max: '12', step: '1' }) as HTMLInputElement
  recentUserExamples.addEventListener('change', () => scheduleSave({ recentUserExamples: Number(recentUserExamples.value) }, 0))
  const storyMemoryChunks = ctx.dom.createElement('input', { type: 'number', min: '1', max: '12', step: '1' }) as HTMLInputElement
  storyMemoryChunks.addEventListener('change', () => scheduleSave({ storyMemoryChunks: Number(storyMemoryChunks.value) }, 0))
  grid2.append(
    createLabeledField(ctx, 'Scene messages', contextMessages, 'Recent story context sent verbatim to the CYOA model. Current-scene evidence always outranks older memories.'),
    createLabeledField(ctx, 'Your portrayal examples', recentUserExamples, 'Recent USER turns used to learn how you actually play the persona.'),
    createLabeledField(ctx, 'Cortex story memories', storyMemoryChunks, 'How many top-ranked Memory Cortex memories Persona Paths may add. Entity, relationship, and narrative-arc context are retrieved separately when available. Default: 6.'),
  )
  settings.appendChild(grid2)

  const longTermStoryMemoryToggle = ctx.dom.createElement('input', { type: 'checkbox' }) as HTMLInputElement
  const longTermStoryMemoryLabel = ctx.dom.createElement('label', { class: 'pp-check' }) as HTMLLabelElement
  longTermStoryMemoryLabel.append(longTermStoryMemoryToggle, document.createTextNode('Use Lumiverse Memory Cortex'))
  longTermStoryMemoryToggle.addEventListener('change', () => {
    storyMemoryChunks.disabled = !longTermStoryMemoryToggle.checked
    scheduleSave({ longTermStoryMemory: longTermStoryMemoryToggle.checked }, 0)
  })
  settings.appendChild(longTermStoryMemoryLabel)
  const longTermStoryMemoryHint = ctx.dom.createElement('div', { class: 'pp-hint' }) as HTMLElement
  longTermStoryMemoryHint.textContent = 'Cortex-first, read-only retrieval: relevant memories + entity context + relationships + active narrative arc. Requires Lumiverse’s Memories permission. If Cortex is unavailable, Persona Paths falls back to chat memory, then the recent scene.'
  settings.appendChild(longTermStoryMemoryHint)
  const cortexStatus = ctx.dom.createElement('div', { class: 'pp-hint' }) as HTMLElement
  cortexStatus.textContent = 'Checking Memory Cortex permission…'
  settings.appendChild(cortexStatus)

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
  const reasoningHint = ctx.dom.createElement('div', { class: 'pp-hint' }) as HTMLElement
  reasoningHint.textContent = 'Kimi K3 and K2.7 always think. When this is off, Persona Paths automatically uses low effort on K3 and gives always-thinking Kimi models extra output headroom.'
  settings.appendChild(reasoningHint)

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
  const maxTokens = ctx.dom.createElement('input', { type: 'number', min: '500', max: '32000', step: '100' }) as HTMLInputElement
  maxTokens.addEventListener('change', () => scheduleSave({ maxTokens: Number(maxTokens.value) }, 0))
  advancedGrid.append(
    createLabeledField(ctx, 'Temperature', temperature),
    createLabeledField(ctx, 'Max output tokens', maxTokens, 'Base budget. Always-thinking Kimi models are automatically raised to at least 16k so reasoning cannot consume the entire reply.'),
  )
  settings.appendChild(advancedGrid)

  const clearMemory = ctx.dom.createElement('button', { type: 'button', class: 'pp-btn' }) as HTMLButtonElement
  clearMemory.textContent = 'Clear private relationship memory'
  clearMemory.addEventListener('click', () => ctx.sendToBackend({ type: 'clear_relationship_memory' }))
  settings.appendChild(clearMemory)

  function applyState(state: any) {
    currentState = state
    const cfg = state?.config || {}
    const persona = state?.activePersona
    enabled.checked = !!cfg.enabled
    skipOoc.checked = cfg.skipOoc !== false
    pov.value = cfg.pov || 'auto'
    tense.value = cfg.tense || 'auto'
    detail.value = cfg.detail || 'normal'
    generationDelay.value = String(cfg.generationDelaySeconds ?? 3)
    adultContent.value = cfg.adultContent || 'match_scene'
    prismIntegration.value = cfg.prismIntegration || 'auto'
    prismColorInput.value = persona?.id ? (cfg.prismColorOverrides?.[persona.id] || '') : ''
    prismColorInput.disabled = prismIntegration.value !== 'manual' || !persona?.id
    choiceCount.value = String(cfg.choiceCount ?? 4)
    contextMessages.value = String(cfg.contextMessages ?? 12)
    recentUserExamples.value = String(cfg.recentUserExamples ?? 6)
    storyMemoryChunks.value = String(cfg.storyMemoryChunks ?? 6)
    longTermStoryMemoryToggle.checked = cfg.longTermStoryMemory !== false
    storyMemoryChunks.disabled = !longTermStoryMemoryToggle.checked
    cortexStatus.textContent = state?.memoriesGranted
      ? 'Memory Cortex permission granted. Persona Paths only performs read operations.'
      : 'Memory Cortex permission not granted yet; Persona Paths will use chat-memory/recent-scene fallback until it is granted.'
    relationshipMemoryToggle.checked = cfg.relationshipMemory !== false
    reasoningToggle.checked = !!cfg.useReasoning
    modelOverride.value = cfg.modelOverride || ''
    writerModelOverride.value = cfg.writerModelOverride || ''
    writerTemperature.value = String(cfg.writerTemperature ?? 0.75)
    writerMaxTokens.value = String(cfg.writerMaxTokens ?? 2200)
    writerReasoningToggle.checked = !!cfg.writerUseReasoning
    globalInstructions.value = cfg.globalInstructions || ''
    temperature.value = String(cfg.temperature ?? 0.85)
    maxTokens.value = String(cfg.maxTokens ?? 1400)
    prismStatus.textContent = String(state?.prismInfo?.status || (cfg.prismIntegration === 'off' ? 'Prism integration is off.' : 'Prism color unavailable.'))
    if (state?.prismInfo?.color) {
      const cached = activePathMessageId ? dataByMessage.get(activePathMessageId) : null
      if (cached) renderChoices(cached)
    }

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

    const writerConnectionId = cfg.writerConnectionId && conns.some((c: any) => c.id === cfg.writerConnectionId)
      ? String(cfg.writerConnectionId)
      : '__same_as_paths__'
    const selectedPathsConn = conns.find((c: any) => String(c.id) === String(selectedConnection))
    writerConnectionPicker.update({
      value: writerConnectionId,
      options: [
        {
          value: '__same_as_paths__',
          label: 'Same as Persona Paths',
          sublabel: selectedPathsConn ? String(selectedPathsConn.model || selectedPathsConn.provider || '') : 'Follow the Paths connection',
        },
        ...conns.map((c: any) => ({
          value: String(c.id),
          label: String(c.name || 'Unnamed connection'),
          sublabel: String(c.model || c.provider || ''),
        })),
      ],
    })
    const chosenWriterConn = writerConnectionId === '__same_as_paths__'
      ? selectedPathsConn
      : conns.find((c: any) => String(c.id) === writerConnectionId)
    writerConnectionStatus.textContent = writerConnectionId === '__same_as_paths__'
      ? `Following Persona Paths${chosenWriterConn ? ` · ${String(chosenWriterConn.name || chosenWriterConn.model || '')}` : ''}.`
      : `Independent writer connection${chosenWriterConn ? ` · ${String(chosenWriterConn.name || chosenWriterConn.model || '')}` : ''}.`

    updateModelPickers()

    const connectionError = String(state?.connectionError || '')
    if (connectionError) {
      connectionStatus.classList.add('error')
      connectionStatus.textContent = connectionError
    } else {
      connectionStatus.classList.remove('error')
      connectionStatus.textContent = `${conns.length} Lumiverse LLM connection${conns.length === 1 ? '' : 's'} available.`
    }

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
    else if (payload.type === 'openrouter_models') {
      openRouterCatalogPending = false
      openRouterCatalogError = ''
      openRouterModels = Array.isArray(payload.models) ? payload.models : []
      openRouterFetchedAt = Number(payload.fetchedAt || Date.now())
      updateModelPickers()
    }
    else if (payload.type === 'openrouter_models_error') {
      openRouterCatalogPending = false
      openRouterCatalogError = String(payload.error || 'Could not load OpenRouter models. Manual model IDs still work.')
      updateModelPickers()
    }
    else if (payload.type === 'manual_target') {
      manualRun.textContent = 'Generating latest reply…'
      manualStatus.classList.remove('error')
      manualStatus.textContent = payload.oocOverride
        ? 'Forcing Paths on OOC exchange…'
        : 'Manual Persona Paths generation is running.'
    }
    else if (payload.type === 'choices_loading') {
      selectedPathIntents = []
      renderLoading(String(payload.messageId), String(payload.chatId))
      if (manualPending) manualRun.textContent = 'Generating latest reply…'
    }
    else if (payload.type === 'choices_ready' && payload.data) {
      renderChoices(payload.data)
      if (manualPending) {
        manualPending = false
        manualRun.disabled = false
        manualRun.textContent = 'Generate Paths for latest reply'
        manualStatus.classList.remove('error')
        manualStatus.textContent = 'Fresh choices generated for the latest assistant reply.'
      }
    }
    else if (payload.type === 'choices_skipped') {
      const messageId = String(payload.messageId || '')
      if (messageId) removeCard(messageId)
      if (manualPending) {
        manualPending = false
        manualRun.disabled = false
        manualRun.textContent = 'Generate Paths for latest reply'
        manualStatus.classList.remove('error')
        manualStatus.textContent = payload.reason === 'ooc'
          ? 'Skipped: the latest assistant reply is part of an OOC exchange.'
          : 'Persona Paths skipped this reply.'
      }
    }
    else if (payload.type === 'choices_error') {
      renderError(String(payload.messageId), String(payload.chatId), String(payload.error || 'Unknown error'))
      if (manualPending) {
        manualPending = false
        manualRun.disabled = false
        manualRun.textContent = 'Generate Paths for latest reply'
        manualStatus.classList.add('error')
        manualStatus.textContent = String(payload.error || 'Manual Persona Paths generation failed.')
      }
    }
    else if (payload.type === 'manual_error') {
      manualPending = false
      manualRun.disabled = false
      manualRun.textContent = 'Generate Paths for latest reply'
      manualStatus.classList.add('error')
      manualStatus.textContent = String(payload.error || 'Manual Persona Paths generation failed.')
    }
    else if (payload.type === 'writer_anchor') {
      const chatId = String(payload.chatId || '')
      const messageId = String(payload.messageId || '')
      if (chatId && messageId) openWriterModal(chatId, messageId)
    }
    else if (payload.type === 'draft_rewrite_ready') {
      finishWriterSuccess(String(payload.text || ''), String(payload.writerMode || 'rewrite'))
    }
    else if (payload.type === 'draft_rewrite_error') {
      const message = String(payload.error || 'User Writer failed.')
      console.error('[Persona Paths] User Writer failed:', message)
      finishWriterError(message)
    }
    else if (payload.type === 'request_error') {
      connectionStatus.classList.add('error')
      connectionStatus.textContent = String(payload.error || 'Persona Paths backend request failed.')
      if (manualPending) {
        manualPending = false
        manualRun.disabled = false
        manualRun.textContent = 'Generate Paths for latest reply'
        manualStatus.classList.add('error')
        manualStatus.textContent = String(payload.error || 'Manual Persona Paths generation failed.')
      }
    }
    else if (payload.type === 'persona_guidance_saved') {
      const personaId = String(payload.personaId || '')
      const text = String(payload.text || '')
      if (personaId) {
        if (currentState?.config?.personaOverrides) currentState.config.personaOverrides[personaId] = text
        if (currentState?.activePersona?.id === personaId) personaInstructions.value = text
      }
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
      // Lumiverse virtualizes/remounts messages while scrolling. Do not load,
      // cache, or reconstruct historical Persona Paths widgets on that hot path.
      // Track only the current/latest reply (needed for our post-render delay).
      const isAwaited = awaitingRender.has(id)
      if (isAwaited || id === latestHostMessageId()) {
        renderedMessages.clear()
        renderedMessages.add(id)
      }
      const pendingChatId = awaitingRender.get(id) || chatId
      if (pendingChatId && isAwaited) scheduleSettledGeneration(pendingChatId, id)
    })
  } catch (err) { console.warn('[Persona Paths] CHARACTER_MESSAGE_RENDERED subscription failed', err) }

  // A new story generation supersedes any not-yet-started CYOA work in that chat.
  // This keeps Persona Paths out of the way if the user quickly continues/regenerates.
  try {
    unsubGenerationStarted = ctx.events.on('GENERATION_STARTED', (payload: any) => {
      const chatId = String(payload?.chatId || '')
      const targetMessageId = String(payload?.targetMessageId || '')
      if (chatId) cancelChatTimers(chatId)
      // Once the user starts a new story generation, the previous next-move
      // widget is stale. Removing it here keeps at most one sandbox frame alive.
      clearNonActiveWidgets()
      dataByMessage.clear()
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
        removeCard(messageId)
        renderedMessages.delete(messageId)
        waitForRenderThenGenerate(chatId, messageId)
      }
    })
  } catch (err) { console.warn('[Persona Paths] MESSAGE_SWIPED subscription failed', err) }

  try {
    unsubChatSwitch = ctx.events.on('CHAT_SWITCHED', () => {
      if (guidanceModal) {
        try { guidanceModal.dismiss() } catch {}
        guidanceModal = null
      }
      if (writerModal) { try { writerModal.dismiss() } catch {}; writerModal = null }
      writerPending = false
      writerAnchor = null
      writerHistory = []
      writerHistoryIndex = -1
      selectedPathIntents = []
      for (const messageId of Array.from(choiceTimers.keys())) cancelChoiceTimer(messageId)
      for (const messageId of Array.from(renderFallbackTimers.keys())) cancelChoiceTimer(messageId)
      awaitingRender.clear()
      renderedMessages.clear()
      clearNonActiveWidgets()
      cards.clear()
      widgetSignatures.clear()
      dataByMessage.clear()
      activePathMessageId = null
      setTimeout(() => {
        const latestId = latestHostMessageId()
        if (latestId) ctx.sendToBackend({ type: 'load_choices', messageId: latestId })
        ctx.sendToBackend({ type: 'get_state' })
      }, 80)
    })
  } catch (err) { console.warn('[Persona Paths] CHAT_SWITCHED subscription failed', err) }

  ctx.sendToBackend({ type: 'get_state' })
  // Restore only the latest message's cached Paths. Historical cards remain in
  // backend storage but are intentionally not mounted during virtualized scroll.
  const initialLatestId = latestHostMessageId()
  if (initialLatestId) ctx.sendToBackend({ type: 'load_choices', messageId: initialLatestId })

  return () => {
    if (saveTimer) clearTimeout(saveTimer)
    if (guidanceModal) {
      try { guidanceModal.dismiss() } catch {}
      guidanceModal = null
    }
    if (writerModal) { try { writerModal.dismiss() } catch {}; writerModal = null }
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
    try { unsubManualAction() } catch {}
    try { manualAction?.destroy?.() } catch {}
    try { unsubPolishAction() } catch {}
    try { polishAction?.destroy?.() } catch {}
    try { connectionPicker?.destroy?.() } catch {}
    try { modelPicker?.destroy?.() } catch {}
    try { writerConnectionPicker?.destroy?.() } catch {}
    try { writerModelPicker?.destroy?.() } catch {}
    try { floatLauncher?.destroy?.() } catch {}
    for (const cleanup of cards.values()) { try { cleanup() } catch {} }
    cards.clear()
    widgetSignatures.clear()
    dataByMessage.clear()
    activePathMessageId = null
    removeStyle()
    tab.destroy()
    ctx.dom.cleanup()
  }
}

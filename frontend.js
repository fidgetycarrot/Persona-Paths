const EXT_VERSION = '0.1.2';
const PATHS_ICON = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 4v5a3 3 0 0 0 3 3h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6 20v-3a5 5 0 0 1 5-5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m15 8 4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="4" r="2" fill="currentColor"/></svg>`;
function createLabeledField(ctx, label, control, hint) {
    const wrap = ctx.dom.createElement('label', { class: 'pp-field' });
    const title = ctx.dom.createElement('span', { class: 'pp-label' });
    title.textContent = label;
    wrap.appendChild(title);
    wrap.appendChild(control);
    if (hint) {
        const h = ctx.dom.createElement('span', { class: 'pp-hint' });
        h.textContent = hint;
        wrap.appendChild(h);
    }
    return wrap;
}
function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set)
        descriptor.set.call(el, value);
    else
        el.value = value;
}
async function fillComposer(text) {
    const selectors = [
        '[data-component="InputArea"] textarea[name="chat-message"]',
        '[data-component="InputArea"] textarea',
        'textarea[name="chat-message"]',
        '[data-component="InputArea"] [contenteditable="true"]',
    ];
    const el = selectors.map(s => document.querySelector(s)).find(Boolean);
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        setNativeValue(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.focus();
        return true;
    }
    if (el && el.getAttribute('contenteditable') === 'true') {
        el.textContent = text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        el.focus();
        return true;
    }
    try {
        await navigator.clipboard.writeText(text);
        return false;
    }
    catch {
        return false;
    }
}
function titleCaseStyle(style) {
    const pov = style?.pov === 'second' ? '2nd' : style?.pov === 'third' ? '3rd' : '1st';
    const tense = style?.tense === 'past' ? 'Past' : 'Present';
    return `${pov} · ${tense}`;
}
export function setup(ctx) {
    const cards = new Map();
    const dataByMessage = new Map();
    let currentState = null;
    let saveTimer = null;
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
    .pp-divider { height:1px; background:var(--lumiverse-border); opacity:.7; }
    .pp-launcher {
      position:fixed; right:16px; bottom:92px; z-index:90; display:flex; align-items:center; gap:7px;
      border:1px solid var(--lumiverse-border); border-radius:999px; padding:9px 12px; cursor:pointer;
      background:color-mix(in srgb, var(--lumiverse-fill) 92%, transparent); color:var(--lumiverse-text);
      box-shadow:0 7px 24px rgba(0,0,0,.24); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);
      font:inherit; font-size:12px; font-weight:750; letter-spacing:.01em;
    }
    .pp-launcher:hover { background:var(--lumiverse-fill-subtle); transform:translateY(-1px); }
    .pp-launcher svg { width:16px; height:16px; color:var(--lumiverse-accent, currentColor); }
    .pp-version { font-size:10px; color:var(--lumiverse-text-muted); opacity:.7; margin-top:-8px; }
    @media (max-width: 620px) { .pp-grid { grid-template-columns:1fr; } .pp-choice-text { font-size:12px; } }
  `);
    function ensureCard(messageId, chatId) {
        const existing = cards.get(messageId);
        if (existing?.isConnected)
            return existing;
        const bubble = ctx.dom.findMessageElement(messageId);
        if (!bubble)
            return null;
        if (existing) {
            try {
                ctx.dom.uninject(existing);
            }
            catch { }
            cards.delete(messageId);
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
    `, 'beforeend');
        const regen = wrapper.querySelector('.pp-icon-btn');
        regen?.addEventListener('click', () => {
            const data = dataByMessage.get(messageId);
            const resolvedChatId = data?.chatId || chatId;
            if (!resolvedChatId)
                return;
            renderLoading(messageId, resolvedChatId);
            ctx.sendToBackend({ type: 'regenerate', chatId: resolvedChatId, messageId });
        });
        cards.set(messageId, wrapper);
        return wrapper;
    }
    function renderLoading(messageId, chatId) {
        const card = ensureCard(messageId, chatId);
        if (!card)
            return;
        const style = card.querySelector('.pp-style');
        if (style)
            style.textContent = '';
        const host = card.querySelector('.pp-choices');
        if (!host)
            return;
        host.innerHTML = '';
        const row = ctx.dom.createElement('div', { class: 'pp-loading' });
        const dot = ctx.dom.createElement('span', { class: 'pp-dot' });
        const text = ctx.dom.createElement('span');
        text.textContent = 'Reading the scene…';
        row.append(dot, text);
        host.appendChild(row);
    }
    function renderError(messageId, chatId, error) {
        const card = ensureCard(messageId, chatId);
        if (!card)
            return;
        const host = card.querySelector('.pp-choices');
        if (!host)
            return;
        host.innerHTML = '';
        const row = ctx.dom.createElement('div', { class: 'pp-error' });
        row.textContent = `Couldn’t generate choices. ${error}`;
        const retry = ctx.dom.createElement('button', { type: 'button', class: 'pp-btn' });
        retry.textContent = 'Retry';
        retry.style.marginTop = '8px';
        retry.addEventListener('click', () => {
            renderLoading(messageId, chatId);
            ctx.sendToBackend({ type: 'regenerate', chatId, messageId });
        });
        host.append(row, retry);
    }
    function renderChoices(data) {
        dataByMessage.set(data.messageId, data);
        const card = ensureCard(data.messageId, data.chatId);
        if (!card)
            return;
        const style = card.querySelector('.pp-style');
        if (style)
            style.textContent = titleCaseStyle(data.style);
        const host = card.querySelector('.pp-choices');
        if (!host)
            return;
        host.innerHTML = '';
        data.choices.forEach((choice, index) => {
            const button = ctx.dom.createElement('button', { type: 'button', class: 'pp-choice' });
            const top = ctx.dom.createElement('span', { class: 'pp-choice-top' });
            const num = ctx.dom.createElement('span', { class: 'pp-num' });
            num.textContent = String(index + 1);
            const title = ctx.dom.createElement('span', { class: 'pp-choice-title' });
            title.textContent = choice.title || choice.intent || `Option ${index + 1}`;
            top.append(num, title);
            const body = ctx.dom.createElement('span', { class: 'pp-choice-text' });
            body.textContent = choice.text;
            button.append(top, body);
            button.addEventListener('click', async () => {
                const filled = await fillComposer(choice.text);
                const hint = card.querySelector('.pp-toastish');
                if (hint) {
                    hint.textContent = filled ? 'Added to composer' : 'Copied to clipboard';
                    hint.classList.add('show');
                    window.setTimeout(() => hint.classList.remove('show'), 1400);
                }
            });
            host.appendChild(button);
        });
    }
    function scheduleSave(patch, delay = 180) {
        if (saveTimer)
            clearTimeout(saveTimer);
        saveTimer = setTimeout(() => ctx.sendToBackend({ type: 'save_config', patch }), delay);
    }
    const tab = ctx.ui.registerDrawerTab({
        id: 'persona-paths',
        title: 'Persona Paths',
        shortName: 'Paths',
        headerTitle: 'Persona Paths',
        description: 'Configure private persona-aware next-move choices',
        keywords: ['cyoa', 'choices', 'roleplay', 'persona', 'paths'],
        iconSvg: PATHS_ICON,
    });
    // Explicit launcher: do not rely on users discovering the drawer tab.
    // This mirrors the hardened access pattern that proved reliable in LumiDraw.
    let launcher = document.querySelector('[data-persona-paths-launcher]');
    let ownsLauncher = false;
    if (!launcher) {
        try {
            launcher = ctx.dom.createElement('button', { type: 'button', class: 'pp-launcher' });
        }
        catch {
            launcher = document.createElement('button');
            launcher.type = 'button';
            launcher.className = 'pp-launcher';
        }
        launcher.setAttribute('data-persona-paths-launcher', 'true');
        launcher.title = `Open Persona Paths v${EXT_VERSION}`;
        launcher.setAttribute('aria-label', 'Open Persona Paths');
        launcher.innerHTML = `${PATHS_ICON}<span>Paths</span>`;
        document.body.appendChild(launcher);
        ownsLauncher = true;
    }
    launcher.addEventListener('click', () => tab.activate());
    // Also expose a native chat-input Extras action as a second access path.
    let openAction = null;
    let unsubOpenAction = () => { };
    try {
        openAction = ctx.ui.registerInputBarAction({
            id: 'open-persona-paths',
            label: 'Open Persona Paths',
            iconSvg: PATHS_ICON,
            enabled: true,
        });
        unsubOpenAction = openAction.onClick(() => tab.activate());
    }
    catch { }
    const settings = ctx.dom.createElement('div', { class: 'pp-settings' });
    tab.root.appendChild(settings);
    const heading = ctx.dom.createElement('h3');
    heading.textContent = 'Persona Paths';
    const version = ctx.dom.createElement('div', { class: 'pp-version' });
    version.textContent = `v${EXT_VERSION}`;
    const intro = ctx.dom.createElement('p');
    intro.textContent = 'Private, persona-aware next moves. The extension reads the role-play, but its choices and relationship notes are never inserted into story context.';
    settings.append(heading, version, intro);
    const enabled = ctx.dom.createElement('input', { type: 'checkbox' });
    const enabledLabel = ctx.dom.createElement('label', { class: 'pp-check' });
    enabledLabel.append(enabled, document.createTextNode('Generate choices after character replies'));
    enabled.addEventListener('change', () => scheduleSave({ enabled: enabled.checked }, 0));
    settings.appendChild(enabledLabel);
    const connection = ctx.dom.createElement('select');
    connection.addEventListener('change', () => scheduleSave({ connectionId: connection.value }, 0));
    settings.appendChild(createLabeledField(ctx, 'LLM connection', connection, 'Uses a separate Lumiverse connection profile from your story model if you want.'));
    const modelOverride = ctx.dom.createElement('input', { type: 'text', placeholder: 'Leave blank to use connection model' });
    modelOverride.addEventListener('input', () => scheduleSave({ modelOverride: modelOverride.value }));
    settings.appendChild(createLabeledField(ctx, 'Model override', modelOverride, 'Optional exact model ID. Blank follows the selected connection profile.'));
    const grid = ctx.dom.createElement('div', { class: 'pp-grid' });
    const pov = ctx.dom.createElement('select');
    [['auto', 'Auto'], ['first', 'First person'], ['second', 'Second person'], ['third', 'Third person']].forEach(([v, l]) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = l;
        pov.appendChild(o);
    });
    pov.addEventListener('change', () => scheduleSave({ pov: pov.value }, 0));
    const tense = ctx.dom.createElement('select');
    [['auto', 'Auto'], ['present', 'Present'], ['past', 'Past']].forEach(([v, l]) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = l;
        tense.appendChild(o);
    });
    tense.addEventListener('change', () => scheduleSave({ tense: tense.value }, 0));
    const detail = ctx.dom.createElement('select');
    [['compact', 'Compact'], ['normal', 'Normal'], ['detailed', 'Detailed']].forEach(([v, l]) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = l;
        detail.appendChild(o);
    });
    detail.addEventListener('change', () => scheduleSave({ detail: detail.value }, 0));
    const choiceCount = ctx.dom.createElement('input', { type: 'number', min: '3', max: '6', step: '1' });
    choiceCount.addEventListener('change', () => scheduleSave({ choiceCount: Number(choiceCount.value) }, 0));
    grid.append(createLabeledField(ctx, 'POV / person', pov), createLabeledField(ctx, 'Tense', tense), createLabeledField(ctx, 'Choice detail', detail), createLabeledField(ctx, 'Number of choices', choiceCount));
    settings.appendChild(grid);
    const grid2 = ctx.dom.createElement('div', { class: 'pp-grid' });
    const contextMessages = ctx.dom.createElement('input', { type: 'number', min: '6', max: '30', step: '1' });
    contextMessages.addEventListener('change', () => scheduleSave({ contextMessages: Number(contextMessages.value) }, 0));
    const recentUserExamples = ctx.dom.createElement('input', { type: 'number', min: '2', max: '12', step: '1' });
    recentUserExamples.addEventListener('change', () => scheduleSave({ recentUserExamples: Number(recentUserExamples.value) }, 0));
    grid2.append(createLabeledField(ctx, 'Scene messages', contextMessages, 'Recent story context sent only to the CYOA model.'), createLabeledField(ctx, 'Your portrayal examples', recentUserExamples, 'Recent USER turns used to learn how you actually play the persona.'));
    settings.appendChild(grid2);
    const relationshipMemoryToggle = ctx.dom.createElement('input', { type: 'checkbox' });
    const relationshipLabel = ctx.dom.createElement('label', { class: 'pp-check' });
    relationshipLabel.append(relationshipMemoryToggle, document.createTextNode('Keep private relationship memory'));
    relationshipMemoryToggle.addEventListener('change', () => scheduleSave({ relationshipMemory: relationshipMemoryToggle.checked }, 0));
    settings.appendChild(relationshipLabel);
    const reasoningToggle = ctx.dom.createElement('input', { type: 'checkbox' });
    const reasoningLabel = ctx.dom.createElement('label', { class: 'pp-check' });
    reasoningLabel.append(reasoningToggle, document.createTextNode('Use connection reasoning / thinking'));
    reasoningToggle.addEventListener('change', () => scheduleSave({ useReasoning: reasoningToggle.checked }, 0));
    settings.appendChild(reasoningLabel);
    const divider = ctx.dom.createElement('div', { class: 'pp-divider' });
    settings.appendChild(divider);
    const personaBadge = ctx.dom.createElement('div', { class: 'pp-persona-badge' });
    personaBadge.textContent = 'Active persona: loading…';
    settings.appendChild(personaBadge);
    const personaInstructions = ctx.dom.createElement('textarea', { placeholder: 'Optional: how this persona behaves, especially exceptions or relationship patterns…' });
    personaInstructions.addEventListener('input', () => {
        const personaId = currentState?.activePersona?.id;
        if (!personaId)
            return;
        if (saveTimer)
            clearTimeout(saveTimer);
        saveTimer = setTimeout(() => ctx.sendToBackend({ type: 'set_persona_override', personaId, text: personaInstructions.value }), 220);
    });
    settings.appendChild(createLabeledField(ctx, 'Active persona guidance', personaInstructions, 'Stored privately by Persona Paths. Useful for exceptions like “soft with Elena, reckless with everyone else.”'));
    const globalInstructions = ctx.dom.createElement('textarea', { placeholder: 'Optional global rules for all personas…' });
    globalInstructions.addEventListener('input', () => scheduleSave({ globalInstructions: globalInstructions.value }));
    settings.appendChild(createLabeledField(ctx, 'Global guidance', globalInstructions));
    const advancedGrid = ctx.dom.createElement('div', { class: 'pp-grid' });
    const temperature = ctx.dom.createElement('input', { type: 'number', min: '0', max: '2', step: '0.05' });
    temperature.addEventListener('change', () => scheduleSave({ temperature: Number(temperature.value) }, 0));
    const maxTokens = ctx.dom.createElement('input', { type: 'number', min: '500', max: '3000', step: '100' });
    maxTokens.addEventListener('change', () => scheduleSave({ maxTokens: Number(maxTokens.value) }, 0));
    advancedGrid.append(createLabeledField(ctx, 'Temperature', temperature), createLabeledField(ctx, 'Max output tokens', maxTokens));
    settings.appendChild(advancedGrid);
    const clearMemory = ctx.dom.createElement('button', { type: 'button', class: 'pp-btn' });
    clearMemory.textContent = 'Clear private relationship memory';
    clearMemory.addEventListener('click', () => ctx.sendToBackend({ type: 'clear_relationship_memory' }));
    settings.appendChild(clearMemory);
    function applyState(state) {
        currentState = state;
        const cfg = state?.config || {};
        enabled.checked = !!cfg.enabled;
        pov.value = cfg.pov || 'auto';
        tense.value = cfg.tense || 'auto';
        detail.value = cfg.detail || 'normal';
        choiceCount.value = String(cfg.choiceCount ?? 4);
        contextMessages.value = String(cfg.contextMessages ?? 12);
        recentUserExamples.value = String(cfg.recentUserExamples ?? 6);
        relationshipMemoryToggle.checked = cfg.relationshipMemory !== false;
        reasoningToggle.checked = !!cfg.useReasoning;
        modelOverride.value = cfg.modelOverride || '';
        globalInstructions.value = cfg.globalInstructions || '';
        temperature.value = String(cfg.temperature ?? 0.85);
        maxTokens.value = String(cfg.maxTokens ?? 1400);
        connection.innerHTML = '';
        const conns = Array.isArray(state?.connections) ? state.connections : [];
        conns.forEach((c) => {
            const o = document.createElement('option');
            o.value = c.id;
            o.textContent = `${c.name} — ${c.model}`;
            connection.appendChild(o);
        });
        if (cfg.connectionId && conns.some((c) => c.id === cfg.connectionId))
            connection.value = cfg.connectionId;
        else {
            const def = conns.find((c) => c.is_default) || conns[0];
            if (def)
                connection.value = def.id;
        }
        const persona = state?.activePersona;
        personaBadge.textContent = persona ? `Active persona: ${persona.name}${persona.title ? ` — ${persona.title}` : ''}` : 'Active persona: none';
        personaInstructions.disabled = !persona;
        personaInstructions.value = persona?.id ? (cfg.personaOverrides?.[persona.id] || '') : '';
    }
    const unsubBackend = ctx.onBackendMessage((payload) => {
        if (!payload || typeof payload !== 'object')
            return;
        if (payload.type === 'state')
            applyState(payload);
        else if (payload.type === 'choices_loading')
            renderLoading(String(payload.messageId), String(payload.chatId));
        else if (payload.type === 'choices_ready' && payload.data)
            renderChoices(payload.data);
        else if (payload.type === 'choices_error')
            renderError(String(payload.messageId), String(payload.chatId), String(payload.error || 'Unknown error'));
        else if (payload.type === 'memory_cleared') {
            clearMemory.textContent = 'Memory cleared ✓';
            setTimeout(() => { clearMemory.textContent = 'Clear private relationship memory'; }, 1200);
        }
    });
    let unsubRendered = () => { };
    let unsubChatSwitch = () => { };
    try {
        unsubRendered = ctx.events.on('CHARACTER_MESSAGE_RENDERED', (payload) => {
            const id = String(payload?.messageId || '');
            if (!id)
                return;
            if (dataByMessage.has(id))
                renderChoices(dataByMessage.get(id));
            else
                ctx.sendToBackend({ type: 'load_choices', messageId: id });
        });
    }
    catch (err) {
        console.warn('[Persona Paths] CHARACTER_MESSAGE_RENDERED subscription failed', err);
    }
    try {
        unsubChatSwitch = ctx.events.on('CHAT_SWITCHED', () => {
            cards.clear();
            dataByMessage.clear();
            setTimeout(() => {
                try {
                    const ids = ctx.messages.listMessageIds();
                    if (ids?.length)
                        ctx.sendToBackend({ type: 'load_choices', messageIds: ids.slice(-40) });
                }
                catch { }
                ctx.sendToBackend({ type: 'get_state' });
            }, 80);
        });
    }
    catch (err) {
        console.warn('[Persona Paths] CHAT_SWITCHED subscription failed', err);
    }
    ctx.sendToBackend({ type: 'get_state' });
    try {
        const existingIds = ctx.messages.listMessageIds();
        if (existingIds?.length)
            ctx.sendToBackend({ type: 'load_choices', messageIds: existingIds.slice(-40) });
    }
    catch { }
    return () => {
        if (saveTimer)
            clearTimeout(saveTimer);
        unsubBackend();
        unsubRendered();
        unsubChatSwitch();
        try {
            unsubOpenAction();
        }
        catch { }
        try {
            openAction?.destroy?.();
        }
        catch { }
        if (ownsLauncher)
            launcher?.remove();
        removeStyle();
        tab.destroy();
        ctx.dom.cleanup();
    };
}

// frontend.ts
var EXT_VERSION = "0.1.35";
var PATHS_ICON = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 4v5a3 3 0 0 0 3 3h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6 20v-3a5 5 0 0 1 5-5h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="m15 8 4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6" cy="4" r="2" fill="currentColor"/></svg>`;
var ICON = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
var PEN_ICON = ICON('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>');
var TUNE_ICON = ICON('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>');
var REDO_ICON = ICON('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>');
var STEER_ICON = ICON('<path d="M12 3v18"/><path d="M12 6h7l-2 3 2 3h-7"/>');
var PIN_ICON = ICON('<path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>');
var CLOCK_ICON = ICON('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>');
var LAUNCHER_POSITION_KEY = "persona_paths_launcher_position_v1";
var LAUNCHER_WIDTH = 164;
var LAUNCHER_HEIGHT = 38;
function readLauncherPosition() {
  try {
    const value = JSON.parse(window.localStorage.getItem(LAUNCHER_POSITION_KEY) || "null");
    if ((value?.edge === "left" || value?.edge === "right") && Number.isFinite(value.yRatio)) {
      return { edge: value.edge, yRatio: Math.max(0, Math.min(1, value.yRatio)) };
    }
  } catch {}
  return null;
}
function launcherCoordinates(saved) {
  const maxX = Math.max(0, window.innerWidth - LAUNCHER_WIDTH);
  const maxY = Math.max(0, window.innerHeight - LAUNCHER_HEIGHT);
  return {
    x: saved.edge === "right" ? Math.max(0, maxX - 16) : Math.min(16, maxX),
    y: Math.round(saved.yRatio * maxY)
  };
}
function rememberLauncherPosition(pos) {
  if (!Number.isFinite(pos?.x) || !Number.isFinite(pos?.y))
    return;
  const maxY = Math.max(0, window.innerHeight - LAUNCHER_HEIGHT);
  const saved = {
    edge: pos.x + LAUNCHER_WIDTH / 2 > window.innerWidth / 2 ? "right" : "left",
    yRatio: maxY ? Math.max(0, Math.min(1, pos.y / maxY)) : 0
  };
  try {
    window.localStorage.setItem(LAUNCHER_POSITION_KEY, JSON.stringify(saved));
  } catch {}
}
function createLabeledField(ctx, label, control, hint) {
  const wrap = ctx.dom.createElement("label", { class: "pp-field" });
  const title = ctx.dom.createElement("span", { class: "pp-label" });
  title.textContent = label;
  wrap.appendChild(title);
  wrap.appendChild(control);
  if (hint) {
    const h = ctx.dom.createElement("span", { class: "pp-hint" });
    h.textContent = hint;
    wrap.appendChild(h);
  }
  return wrap;
}
function setNativeValue(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor?.set)
    descriptor.set.call(el, value);
  else
    el.value = value;
}
function appendPathText(current, addition) {
  const existing = String(current || "").replace(/[ \t]+$/gm, "").trimEnd();
  const next = String(addition || "").trim();
  if (!next)
    return existing;
  if (!existing)
    return next;
  return `${existing}

${next}`;
}
function findComposerElement() {
  const selectors = [
    '[data-component="InputArea"] textarea[name="chat-message"]',
    '[data-component="InputArea"] textarea',
    'textarea[name="chat-message"]',
    '[data-component="InputArea"] [contenteditable="true"]'
  ];
  return selectors.map((s) => document.querySelector(s)).find(Boolean);
}
function getComposerText() {
  const el = findComposerElement();
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)
    return String(el.value || "");
  if (el && el.getAttribute("contenteditable") === "true")
    return String(el.textContent || "");
  return "";
}
function replaceComposer(text) {
  const el = findComposerElement();
  const next = String(text || "").trim();
  if (!el || !next)
    return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    setNativeValue(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.focus();
    try {
      el.setSelectionRange(next.length, next.length);
    } catch {}
    return true;
  }
  if (el.getAttribute("contenteditable") === "true") {
    el.textContent = next;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: next }));
    el.focus();
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } catch {}
    return true;
  }
  return false;
}
async function fillComposer(text) {
  const el = findComposerElement();
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const combined = appendPathText(el.value, text);
    setNativeValue(el, combined);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.focus();
    try {
      el.setSelectionRange(combined.length, combined.length);
    } catch {}
    return true;
  }
  if (el && el.getAttribute("contenteditable") === "true") {
    const combined = appendPathText(el.textContent || "", text);
    el.textContent = combined;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    el.focus();
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } catch {}
    return true;
  }
  try {
    await navigator.clipboard.writeText(text);
    return false;
  } catch {
    return false;
  }
}
function titleCaseStyle(style) {
  const pov = style?.pov === "second" ? "2nd" : style?.pov === "third" ? "3rd" : "1st";
  const tense = style?.tense === "past" ? "past" : "present";
  return `${pov} person, ${tense} tense`;
}
function setup(ctx) {
  const cards = new Map;
  const dataByMessage = new Map;
  const widgetSignatures = new Map;
  let activePathMessageId = null;
  let currentState = null;
  let saveTimer = null;
  const renderedMessages = new Set;
  const awaitingRender = new Map;
  const choiceTimers = new Map;
  const renderFallbackTimers = new Map;
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

    .pp-guidance-modal, .pp-writer-modal { display:flex; flex-direction:column; gap:12px; min-width:0; }
    .pp-guidance-modal-copy, .pp-writer-copy { margin:0; font-size:13px; line-height:1.45; color:var(--lumiverse-text-muted); }
    .pp-modal-field { display:flex; flex-direction:column; gap:6px; font-size:12.5px; font-weight:600; color:var(--lumiverse-text-muted); }
    .pp-guidance-modal-input, .pp-writer-direction, .pp-writer-result {
      width:100%; resize:vertical; box-sizing:border-box; border:1px solid var(--lumiverse-border); border-radius:10px;
      background:var(--lumiverse-fill); color:var(--lumiverse-text); padding:10px 12px; font:inherit; font-weight:400; font-size:16px; line-height:1.45;
      overscroll-behavior:contain; -webkit-overflow-scrolling:touch;
    }
    .pp-guidance-modal-input { min-height:150px; max-height:44vh; }
    .pp-writer-direction { min-height:64px; max-height:30vh; }
    .pp-writer-result { min-height:170px; max-height:36vh; font-size:15px; line-height:1.5; }
    .pp-guidance-modal-input:focus, .pp-writer-direction:focus, .pp-writer-result:focus { outline:2px solid var(--pp-accent); outline-offset:1px; }
    .pp-guidance-modal-save { display:flex; align-items:flex-start; gap:8px; font-size:13px; line-height:1.35; color:var(--lumiverse-text-muted); cursor:pointer; }
    .pp-guidance-modal-save input { margin-top:2px; accent-color:var(--pp-accent); }
    .pp-guidance-modal-actions, .pp-writer-actions { display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
    .pp-guidance-modal-error { min-height:1.2em; font-size:12.5px; color:var(--lumiverse-danger, #d97777); }
    .pp-writer-status { min-height:1.2em; font-size:12.5px; color:var(--lumiverse-text-muted); }
    .pp-writer-status.error { color:var(--lumiverse-danger, #d97777); }
    .pp-writer-history { display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--lumiverse-text-muted); }
    .pp-writer-history span { flex:1; }
    .pp-guidance-modal .pp-btn, .pp-writer-modal .pp-btn { min-height:38px; padding:8px 14px; font-size:13px; }
    @media (max-width:620px), (pointer:coarse) {
      .pp-guidance-modal-input { min-height:180px; max-height:38vh; resize:none; }
      .pp-guidance-modal .pp-btn, .pp-writer-modal .pp-btn { min-height:44px; }
    }

    .pp-settings, .pp-guidance-modal, .pp-writer-modal, .pp-launcher-group { --pp-accent:var(--lumiverse-accent, var(--lumiverse-primary, #8f7ae0)); --pp-on-accent:var(--lumiverse-on-primary, #fff); }
    .pp-settings { padding:16px; display:flex; flex-direction:column; gap:14px; color:var(--lumiverse-text); max-width:760px; box-sizing:border-box; }
    .pp-settings * { box-sizing:border-box; }
    .pp-settings [hidden] { display:none !important; }
    .pp-title { display:flex; align-items:baseline; gap:10px; }
    .pp-settings h3 { margin:0; font-size:19px; line-height:1.2; flex:1; }
    .pp-settings h4 { margin:0; font-size:14px; line-height:1.3; }
    .pp-settings p { margin:0; font-size:12.5px; line-height:1.45; color:var(--lumiverse-text-muted); }
    .pp-version { font-size:11.5px; color:var(--lumiverse-text-muted); }
    .pp-now { display:flex; flex-direction:column; gap:12px; padding:14px; border:1px solid var(--lumiverse-border); border-radius:14px; background:var(--lumiverse-fill-subtle, rgba(127,127,127,.08)); }
    .pp-tabs { display:grid; grid-auto-flow:column; grid-auto-columns:1fr; gap:2px; padding:3px; border-radius:10px; border:1px solid var(--lumiverse-border); background:var(--lumiverse-fill-subtle, rgba(127,127,127,.08)); }
    .pp-tabs button { border:0; background:transparent; color:var(--lumiverse-text-muted); padding:6px 4px; min-height:32px; border-radius:7px; min-width:0; font:inherit; font-size:13px; cursor:pointer; }
    .pp-tabs button[aria-selected="true"] { background:var(--lumiverse-fill); color:var(--lumiverse-text); font-weight:600; box-shadow:0 0 0 1px var(--lumiverse-border); }
    .pp-panel { display:flex; flex-direction:column; gap:14px; }
    .pp-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:12px; }
    .pp-field { display:flex; flex-direction:column; gap:5px; min-width:0; }
    .pp-label { font-size:12.5px; font-weight:600; color:var(--lumiverse-text-muted); }
    .pp-hint { font-size:12px; color:var(--lumiverse-text-muted); line-height:1.4; }
    .pp-settings select, .pp-settings input[type="number"], .pp-settings input[type="text"], .pp-settings textarea {
      width:100%; border:1px solid var(--lumiverse-border); border-radius:8px; min-height:36px;
      background:var(--lumiverse-fill); color:var(--lumiverse-text); padding:8px 10px; font:inherit; font-size:13px;
    }
    .pp-settings textarea { min-height:96px; resize:vertical; line-height:1.45; }
    .pp-settings :focus-visible, .pp-launcher:focus-visible { outline:2px solid var(--pp-accent); outline-offset:2px; }
    .pp-check { display:flex; align-items:center; gap:10px; font-size:13px; line-height:1.35; cursor:pointer; }
    .pp-check input { appearance:none; -webkit-appearance:none; flex-shrink:0; width:34px; height:20px; margin:0; border-radius:10px; background:var(--lumiverse-border); position:relative; cursor:pointer; transition:background .15s; }
    .pp-check input::after { content:""; position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#fff; transition:transform .15s; }
    .pp-check input:checked { background:var(--pp-accent); }
    .pp-check input:checked::after { transform:translateX(14px); }
    .pp-check + .pp-hint { margin:-8px 0 0 44px; }
    .pp-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .pp-btn {
      display:inline-flex; align-items:center; justify-content:center; gap:6px; border:1px solid var(--lumiverse-border); border-radius:8px;
      background:var(--lumiverse-fill); color:var(--lumiverse-text); padding:7px 12px; min-height:34px; font:inherit; font-size:13px; line-height:1.2; cursor:pointer;
    }
    .pp-btn:hover:not(:disabled) { border-color:var(--pp-accent); }
    .pp-btn.pp-primary { font-weight:600; border-color:transparent; background:var(--pp-accent); color:var(--pp-on-accent); }
    .pp-btn.pp-quiet { background:transparent; border-color:transparent; color:var(--lumiverse-text-muted); align-self:flex-start; }
    .pp-btn:disabled { opacity:.5; cursor:default; }
    .pp-btn svg { width:16px; height:16px; flex:0 0 auto; }
    .pp-manual-status, .pp-connection-status, .pp-prism-status { font-size:12px; line-height:1.4; color:var(--lumiverse-text-muted); min-height:1em; }
    .pp-connection-status, .pp-prism-status { margin-top:-8px; }
    .pp-manual-status.error, .pp-connection-status.error { color:var(--lumiverse-danger, #d97777); }
    .pp-persona-badge { font-size:12px; color:var(--lumiverse-text-muted); }
    .pp-divider { height:1px; background:var(--lumiverse-border); opacity:.7; margin:2px 0; }
    .pp-native-select-slot { width:100%; min-width:0; }
    .pp-model-tools { display:flex; align-items:center; gap:8px; margin-top:-8px; flex-wrap:wrap; }
    .pp-model-tools .pp-connection-status { margin-top:0; flex:1 1 200px; }
    .pp-launcher-group {
      width:100%; height:100%; display:flex; align-items:stretch; box-sizing:border-box; overflow:hidden;
      border:1px solid var(--lumiverse-border); border-radius:999px;
      background:color-mix(in srgb, var(--lumiverse-fill) 92%, transparent); color:var(--lumiverse-text);
      box-shadow:0 7px 24px rgba(0,0,0,.24); backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);
    }
    .pp-launcher {
      min-width:0; height:100%; display:flex; align-items:center; justify-content:center; gap:7px; box-sizing:border-box;
      border:0; background:transparent; color:var(--lumiverse-text); padding:0 11px; cursor:pointer;
      font:inherit; font-size:13px; font-weight:600;
    }
    .pp-launcher:hover { background:var(--lumiverse-fill-subtle); }
    .pp-launcher:disabled { cursor:default; opacity:.8; }
    .pp-launcher.paths { flex:1 1 auto; }
    .pp-launcher.paths svg { color:var(--pp-accent); }
    .pp-launcher.paths[data-status="working"] { color:var(--pp-accent); }
    .pp-launcher.paths[data-status="success"] { color:var(--lumiverse-success, #59b98b); }
    .pp-launcher.paths[data-status="error"] { color:var(--lumiverse-danger, #d97777); }
    .pp-launcher.writer, .pp-launcher.settings { flex:0 0 36px; width:36px; padding:0; border-left:1px solid var(--lumiverse-border); color:var(--lumiverse-text-muted); }
    .pp-launcher.writer:hover, .pp-launcher.settings:hover { color:var(--lumiverse-text); }
    .pp-launcher svg { width:16px; height:16px; flex:0 0 auto; }
  `);
  function widgetJson(value) {
    return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }
  function retireLegacyCards() {
    const wrappers = new Set;
    document.querySelectorAll(".pp-injection-root").forEach((el) => wrappers.add(el));
    document.querySelectorAll(".pp-card[data-pp-message]").forEach((card) => {
      if (card.parentElement)
        wrappers.add(card.parentElement);
    });
    for (const wrapper of wrappers) {
      try {
        ctx.dom.uninject(wrapper);
      } catch {
        try {
          wrapper.remove();
        } catch {}
      }
    }
  }
  retireLegacyCards();
  function latestHostMessageId() {
    try {
      const direct = ctx.messages?.getLatestMessageId?.();
      if (direct)
        return String(direct);
    } catch {}
    try {
      const ids = ctx.messages?.listMessageIds?.();
      return ids?.length ? String(ids[ids.length - 1]) : "";
    } catch {}
    return "";
  }
  let guidanceModal = null;
  let writerModal = null;
  let writerPending = false;
  let writerAnchor = null;
  let writerHistory = [];
  let writerHistoryIndex = -1;
  let selectedPathIntents = [];
  function openGuidanceModal(chatId, messageId) {
    try {
      if (guidanceModal) {
        try {
          guidanceModal.dismiss();
        } catch {}
        guidanceModal = null;
      }
      const modal = ctx.ui.showModal({
        title: "Steer new paths",
        width: 560,
        maxHeight: Math.min(680, Math.max(360, window.innerHeight - 24))
      });
      guidanceModal = modal;
      const wrap = ctx.dom.createElement("div", { class: "pp-guidance-modal" });
      const copy = ctx.dom.createElement("p", { class: "pp-guidance-modal-copy" });
      copy.textContent = "Say what you had in mind. It is used once, unless you save it to the persona’s notes.";
      const input = ctx.dom.createElement("textarea", {
        class: "pp-guidance-modal-input",
        placeholder: "For example: stop arguing and give me options where Rook leaves camp."
      });
      input.autocapitalize = "sentences";
      input.autocomplete = "off";
      input.spellcheck = true;
      const save = ctx.dom.createElement("input", { type: "checkbox", role: "switch" });
      const saveLabel = ctx.dom.createElement("label", { class: "pp-guidance-modal-save" });
      saveLabel.append(save, document.createTextNode("Also save this to the persona’s notes"));
      const error = ctx.dom.createElement("div", { class: "pp-guidance-modal-error", role: "status" });
      const actions = ctx.dom.createElement("div", { class: "pp-guidance-modal-actions" });
      const cancel = ctx.dom.createElement("button", { type: "button", class: "pp-btn" });
      cancel.textContent = "Cancel";
      const generate = ctx.dom.createElement("button", { type: "button", class: "pp-btn pp-primary" });
      generate.textContent = "Make new paths";
      actions.append(cancel, generate);
      wrap.append(copy, input, saveLabel, error, actions);
      modal.root.appendChild(wrap);
      let submitted = false;
      const cleanupDismiss = modal.onDismiss(() => {
        guidanceModal = null;
        if (!submitted) {
          try {
            input.blur();
          } catch {}
        }
        try {
          cleanupDismiss();
        } catch {}
      });
      cancel.addEventListener("click", () => modal.dismiss());
      generate.addEventListener("click", () => {
        const guidance = String(input.value || "").trim();
        if (!guidance) {
          error.textContent = "Type what you want first.";
          input.focus();
          return;
        }
        submitted = true;
        generate.disabled = true;
        cancel.disabled = true;
        try {
          input.blur();
        } catch {}
        modal.dismiss();
        guidanceModal = null;
        setTimeout(() => {
          renderLoading(messageId, chatId);
          ctx.sendToBackend({
            type: "regenerate_with_guidance",
            chatId,
            messageId,
            guidance,
            saveAsPersonaGuidance: save.checked
          });
        }, 120);
      });
    } catch (err) {
      console.error("[Persona Paths] Could not open guidance modal", err);
    }
  }
  function openWriterModal(chatId, messageId) {
    try {
      if (writerModal) {
        try {
          writerModal.dismiss();
        } catch {}
        writerModal = null;
      }
      writerAnchor = { chatId, messageId };
      const currentDraft = getComposerText();
      writerHistory = [currentDraft];
      writerHistoryIndex = 0;
      const modal = ctx.ui.showModal({
        title: currentDraft.trim() ? "Rewrite my message" : "Write for me",
        width: 620,
        maxHeight: Math.min(760, Math.max(420, window.innerHeight - 24))
      });
      writerModal = modal;
      const wrap = ctx.dom.createElement("div", { class: "pp-writer-modal" });
      const copy = ctx.dom.createElement("p", { class: "pp-writer-copy" });
      copy.textContent = currentDraft.trim() ? "Keeps what you decided and smooths it into one in-character message." : "Your message box is empty, so this writes a new in-character message from the current scene.";
      const direction = ctx.dom.createElement("textarea", {
        class: "pp-writer-direction",
        placeholder: "For example: less confrontational, answer her question, keep the action from path 3."
      });
      direction.autocapitalize = "sentences";
      direction.autocomplete = "off";
      direction.spellcheck = true;
      const result = ctx.dom.createElement("textarea", { class: "pp-writer-result" });
      result.value = currentDraft;
      result.placeholder = "The draft appears here.";
      result.spellcheck = true;
      const status = ctx.dom.createElement("div", { class: "pp-writer-status", role: "status" });
      const history = ctx.dom.createElement("div", { class: "pp-writer-history" });
      const prev = ctx.dom.createElement("button", { type: "button", class: "pp-btn" });
      prev.textContent = "Older";
      const count = ctx.dom.createElement("span");
      const next = ctx.dom.createElement("button", { type: "button", class: "pp-btn" });
      next.textContent = "Newer";
      history.append(count, prev, next);
      const actions = ctx.dom.createElement("div", { class: "pp-writer-actions" });
      const close = ctx.dom.createElement("button", { type: "button", class: "pp-btn" });
      close.textContent = "Close";
      const restore = ctx.dom.createElement("button", { type: "button", class: "pp-btn" });
      restore.textContent = "Use this draft";
      const generate = ctx.dom.createElement("button", { type: "button", class: "pp-btn pp-primary" });
      generate.textContent = currentDraft.trim() ? "Rewrite" : "Write for me";
      actions.append(close, restore, generate);
      const directionField = ctx.dom.createElement("label", { class: "pp-modal-field" });
      directionField.append(document.createTextNode("Anything to change? (optional)"), direction);
      const resultField = ctx.dom.createElement("label", { class: "pp-modal-field" });
      resultField.append(document.createTextNode("Draft"), result);
      wrap.append(copy, directionField, resultField, history, status, actions);
      modal.root.appendChild(wrap);
      const updateHistoryUi = () => {
        if (!writerHistory.length) {
          count.textContent = "No drafts";
          prev.disabled = true;
          next.disabled = true;
          restore.disabled = true;
          return;
        }
        writerHistoryIndex = Math.max(0, Math.min(writerHistoryIndex, writerHistory.length - 1));
        result.value = writerHistory[writerHistoryIndex] || "";
        count.textContent = `Draft ${writerHistoryIndex + 1} of ${writerHistory.length}${writerHistoryIndex === 0 ? " (your original)" : ""}`;
        prev.disabled = writerHistoryIndex <= 0;
        next.disabled = writerHistoryIndex >= writerHistory.length - 1;
        restore.disabled = false;
      };
      updateHistoryUi();
      prev.addEventListener("click", () => {
        if (writerHistoryIndex > 0) {
          writerHistoryIndex--;
          updateHistoryUi();
        }
      });
      next.addEventListener("click", () => {
        if (writerHistoryIndex < writerHistory.length - 1) {
          writerHistoryIndex++;
          updateHistoryUi();
        }
      });
      restore.addEventListener("click", () => {
        const value = String(result.value || "");
        if (replaceComposer(value))
          status.textContent = "This draft is now in your message box.";
      });
      close.addEventListener("click", () => modal.dismiss());
      generate.addEventListener("click", () => {
        if (writerPending)
          return;
        const draft = getComposerText();
        writerPending = true;
        generate.disabled = true;
        restore.disabled = true;
        prev.disabled = true;
        next.disabled = true;
        generate.textContent = draft.trim() ? "Rewriting…" : "Writing…";
        status.classList.remove("error");
        status.textContent = draft.trim() ? "Rewriting your message…" : "Writing a message…";
        ctx.sendToBackend({
          type: "user_writer",
          chatId,
          messageId,
          draft,
          direction: String(direction.value || "").trim(),
          sourceIntents: selectedPathIntents.slice(0, 6)
        });
      });
      const cleanupDismiss = modal.onDismiss(() => {
        writerModal = null;
        writerAnchor = null;
        writerPending = false;
        try {
          cleanupDismiss();
        } catch {}
      });
      modal.__ppWriter = { result, status, generate, restore, prev, next, updateHistoryUi };
    } catch (err) {
      console.error("[Persona Paths] Could not open User Writer modal", err);
    }
  }
  function finishWriterSuccess(text, writerMode) {
    const next = String(text || "").trim();
    if (!next)
      return;
    if (!writerHistory.length)
      writerHistory = [getComposerText()];
    if (writerHistory[writerHistory.length - 1] !== next)
      writerHistory.push(next);
    writerHistoryIndex = writerHistory.length - 1;
    replaceComposer(next);
    writerPending = false;
    const ui = writerModal && writerModal.__ppWriter;
    if (ui) {
      ui.status.classList.remove("error");
      ui.status.textContent = writerMode === "write" ? "New draft written and put in your message box." : "Rewritten and put in your message box.";
      ui.generate.disabled = false;
      ui.generate.textContent = "Try another";
      ui.updateHistoryUi();
    }
  }
  function finishWriterError(message) {
    writerPending = false;
    const ui = writerModal && writerModal.__ppWriter;
    if (ui) {
      ui.status.classList.add("error");
      ui.status.textContent = message || "Write for me failed.";
      ui.generate.disabled = false;
      ui.generate.textContent = "Try again";
      ui.updateHistoryUi();
    }
  }
  function triggerUserWriter() {
    if (writerPending)
      return;
    if (activePathMessageId) {
      const data = dataByMessage.get(activePathMessageId);
      if (data?.chatId) {
        openWriterModal(data.chatId, activePathMessageId);
        return;
      }
    }
    ctx.sendToBackend({ type: "resolve_writer_latest" });
  }
  function clearNonActiveWidgets(keepMessageId) {
    for (const [id, cleanup] of Array.from(cards.entries())) {
      if (keepMessageId && id === keepMessageId)
        continue;
      try {
        cleanup();
      } catch {}
      cards.delete(id);
      widgetSignatures.delete(id);
      dataByMessage.delete(id);
    }
    if (!keepMessageId || activePathMessageId !== keepMessageId) {
      activePathMessageId = keepMessageId || null;
    }
  }
  function activateMessage(messageId) {
    if (activePathMessageId !== messageId)
      clearNonActiveWidgets(messageId);
    activePathMessageId = messageId;
  }
  function renderMessageWidget(messageId, chatId, model) {
    activateMessage(messageId);
    const prismColor = /^#[0-9A-F]{6}$/i.test(String(model?.prismColor || "")) ? String(model.prismColor).toUpperCase() : "";
    const payload = {
      mode: model?.mode || "choices",
      messageId,
      chatId,
      styleText: String(model?.styleText || ""),
      sceneState: model?.sceneState || null,
      choices: Array.isArray(model?.choices) ? model.choices : [],
      error: String(model?.error || ""),
      prismColor
    };
    const signature = JSON.stringify(payload);
    if (cards.has(messageId) && widgetSignatures.get(messageId) === signature)
      return true;
    const previous = cards.get(messageId);
    if (previous) {
      try {
        previous();
      } catch {}
      cards.delete(messageId);
      widgetSignatures.delete(messageId);
    }
    const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  :where(html) { font-family:system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  html, body { margin:0; padding:0; width:100%; overflow:hidden; background:transparent; }
  body { box-sizing:border-box; color:var(--lumiverse-text); font-family:inherit; --accent:var(--lumiverse-accent, var(--lumiverse-primary, #8f7ae0)); --dim:var(--lumiverse-text-muted); --line:var(--lumiverse-border); }
  * { box-sizing:border-box; }
  [hidden] { display:none !important; }
  .card {
    width:100%; min-width:0; margin:10px 0 2px; padding:12px;
    border:1px solid var(--line); border-radius:14px;
    background:color-mix(in srgb, var(--lumiverse-fill-subtle) 88%, transparent);
  }
  .head { display:flex; align-items:center; gap:6px; min-width:0; margin-bottom:10px; }
  .brand { font-size:13px; font-weight:700; white-space:nowrap; }
  .style { font-size:11.5px; color:var(--dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
  .toast { font-size:11.5px; color:var(--accent); opacity:0; transition:opacity .15s; white-space:nowrap; }
  .toast.show { opacity:1; }
  .spacer { flex:1; min-width:0; }
  svg { width:15px; height:15px; flex:0 0 auto; }
  .tool {
    display:inline-flex; align-items:center; gap:5px; border:1px solid transparent; background:transparent; color:var(--dim);
    cursor:pointer; border-radius:8px; min-height:30px; padding:4px 8px; font:inherit; font-size:12px; white-space:nowrap;
  }
  .tool:hover, .tool:focus-visible { background:var(--lumiverse-fill); color:var(--lumiverse-text); border-color:var(--line); outline:none; }
  .state { display:flex; gap:6px 16px; flex-wrap:wrap; min-width:0; margin:0 0 10px; font-size:12px; color:var(--dim); }
  .state-item { display:inline-flex; align-items:center; gap:5px; min-width:0; }
  .state-item svg { width:13px; height:13px; }
  .state-value { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .choices { display:flex; flex-direction:column; gap:8px; min-width:0; }
  .choice {
    display:block; width:100%; min-width:0; max-width:100%; text-align:left; cursor:pointer;
    border:1px solid var(--line); border-radius:12px; padding:11px 12px;
    background:var(--lumiverse-fill); color:var(--lumiverse-text); font:inherit;
  }
  .choice:hover, .choice:focus-visible { border-color:var(--accent); outline:none; }
  .top { display:flex; align-items:center; gap:9px; min-width:0; margin-bottom:5px; }
  .num {
    width:22px; height:22px; flex:0 0 auto; border-radius:50%; display:inline-flex;
    align-items:center; justify-content:center; font-size:11.5px; font-weight:700;
    background:color-mix(in srgb, var(--accent) 24%, transparent); color:var(--lumiverse-text);
  }
  .title { min-width:0; font-size:14px; font-weight:650; overflow-wrap:anywhere; }
  .heat { position:relative; margin-left:auto; display:inline-flex; gap:3px; flex:0 0 auto; align-items:center; cursor:help; color:var(--dim); }
  .heat-dot { width:6px; height:6px; border-radius:999px; border:1px solid currentColor; opacity:.45; }
  .heat-dot.on { background:currentColor; opacity:.9; }
  .advance { flex:0 0 auto; font-size:11px; color:var(--dim); padding:2px 8px; border:1px solid var(--line); border-radius:999px; white-space:nowrap; }
  .text {
    display:block; min-width:0; max-width:100%; padding-left:31px; font-size:13.5px; line-height:1.5;
    color:var(--dim); white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word;
    filter:blur(4px); opacity:.45; user-select:none; pointer-events:none;
    transition:filter .13s ease, opacity .13s ease;
  }
  .choice:hover .text, .choice:focus-visible .text, .choice.revealed .text { filter:none; opacity:1; user-select:text; color:var(--lumiverse-text); }
  .footer-hint { margin:10px 2px 0; font-size:11.5px; color:var(--dim); }
  .loading { display:flex; align-items:center; gap:8px; color:var(--dim); font-size:13px; padding:6px 2px; }
  .dot { width:6px; height:6px; border-radius:999px; background:var(--accent); animation:pulse 1.1s infinite alternate; }
  @keyframes pulse { from{opacity:.25; transform:scale(.8)} to{opacity:1; transform:scale(1.1)} }
  @media (prefers-reduced-motion: reduce) { .dot { animation:none; } .text { transition:none; } }
  .error { font-size:13px; line-height:1.45; color:var(--lumiverse-text); padding:4px 2px; }
  .btn {
    border:1px solid var(--line); border-radius:8px; background:var(--lumiverse-fill);
    color:var(--lumiverse-text); padding:7px 12px; min-height:34px; font:inherit; font-size:13px; cursor:pointer;
  }
  .btn:hover { border-color:var(--accent); }
  .primary { font-weight:600; background:var(--accent); border-color:transparent; color:var(--lumiverse-on-primary, #fff); }
  .guide { margin-top:10px; padding:12px; border:1px solid var(--line); border-radius:12px; background:var(--lumiverse-fill); }
  .guide-title { font-size:13px; font-weight:650; margin-bottom:8px; }
  textarea {
    width:100%; min-height:72px; resize:vertical; border:1px solid var(--line); border-radius:8px;
    background:var(--lumiverse-fill-subtle); color:var(--lumiverse-text); padding:8px 10px; font:inherit; font-size:13px; line-height:1.45;
  }
  textarea:focus { outline:2px solid var(--accent); outline-offset:1px; }
  .save { display:flex; align-items:center; gap:8px; margin-top:8px; font-size:12.5px; color:var(--dim); cursor:pointer; }
  .save input { accent-color:var(--accent); }
  .actions { display:flex; justify-content:flex-end; gap:8px; margin-top:10px; }
  .hint { margin-top:8px; font-size:12px; line-height:1.4; color:var(--dim); }
  em { font-style:italic; }
  @media (max-width:480px) {
    .text { padding-left:0; }
    .top { flex-wrap:wrap; row-gap:6px; }
    .title { flex:1 1 calc(100% - 80px); }
    .advance { margin-left:31px; }
    .style { display:none; }
    .tool span { display:none; }
    .tool { width:34px; min-height:34px; padding:0; justify-content:center; }
    .tool svg { width:17px; height:17px; }
  }
</style>
</head>
<body>
  <section class="card">
    <div class="head">
      <span class="brand">Paths</span>
      <span class="style" id="style"></span>
      <span class="toast" id="toast" role="status">Added to your message</span>
      <span class="spacer"></span>
      <button type="button" class="tool" id="polishBtn" title="Write or rewrite your message" aria-label="Write for me">${PEN_ICON}<span>Write for me</span></button>
      <button type="button" class="tool" id="guideBtn" title="Say what you want, then get new paths" aria-label="Steer new paths">${STEER_ICON}<span>Steer</span></button>
      <button type="button" class="tool" id="regenBtn" title="Get a new set of paths" aria-label="Redo paths">${REDO_ICON}<span>Redo</span></button>
    </div>
    <div class="state" id="sceneState" hidden>
      <div class="state-item">${PIN_ICON}<span class="state-value" id="stateLocation"></span></div>
      <div class="state-item">${CLOCK_ICON}<span class="state-value" id="stateMoment"></span></div>
    </div>
    <div class="choices" id="choices"></div>
    <div class="footer-hint" id="footerHint" hidden></div>
    <div class="guide" id="guide" hidden>
      <div class="guide-title">Steer new paths</div>
      <textarea id="guidance" placeholder="What did you have in mind? For example: stop arguing and give me options where Rook leaves camp."></textarea>
      <label class="save"><input type="checkbox" id="saveGuidance"> Also save this to the persona’s notes</label>
      <div class="actions">
        <button type="button" class="btn" id="cancelGuide">Cancel</button>
        <button type="button" class="btn primary" id="generateGuide">Make new paths</button>
      </div>
      <div class="hint">Used once, unless you save it.</div>
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
    const msg = document.createElement('div'); msg.className = 'error'; msg.textContent = 'Could not make paths. ' + (model.error || 'Unknown error');
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn'; retry.style.marginTop = '8px'; retry.textContent = 'Try again';
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
        const heatLabel = intensity === 1 ? 'a small move' : intensity === 2 ? 'a decisive move' : 'a risky move';
        heat.title = 'Intensity ' + intensity + ' of 3: ' + heatLabel;
        heat.setAttribute('aria-label', heat.title);
        for (let dotIndex = 1; dotIndex <= 3; dotIndex++) {
          const dot = document.createElement('span'); dot.className = 'heat-dot' + (dotIndex <= intensity ? ' on' : ''); heat.appendChild(dot);
        }
        top.appendChild(heat);
      }
      if (choice.advances_scene) {
        const badge = document.createElement('span'); badge.className = 'advance'; badge.textContent = 'Moves the scene on'; top.appendChild(badge);
      }
      const body = document.createElement('span'); body.className = 'text'; renderRich(body, choice.text || '');
      button.append(top, body);
      button.addEventListener('click', () => {
        if (!canHover && !button.classList.contains('revealed')) {
          button.classList.add('revealed');
          showToast('Tap again to add');
          return;
        }
        post({ type:'choice', index }); showToast('Added. Pick another to combine.');
      });
      host.appendChild(button);
    });
    footerHint.textContent = canHover ? 'Hover a path to read it. Click to add it to your message.' : 'Tap a path to read it. Tap again to add it.';
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
</html>`;
    try {
      const cleanup = ctx.messages.renderWidget({ messageId, widgetId: "persona-paths-card", html }, async (event) => {
        if (!event || typeof event !== "object")
          return;
        const type = String(event.type || "");
        if (type === "choice") {
          const data = dataByMessage.get(messageId);
          const index = Number(event.index);
          const choice = data?.choices?.[index];
          if (choice) {
            await fillComposer(choice.text);
            const title = String(choice.title || `Path #${index + 1}`).trim();
            const intent = String(choice.intent || "").trim();
            const label = intent && intent.toLowerCase() !== title.toLowerCase() ? `${title} — ${intent}` : title;
            if (label && !selectedPathIntents.includes(label))
              selectedPathIntents.push(label);
          }
          return;
        }
        if (type === "rewrite") {
          openWriterModal(chatId, messageId);
          return;
        }
        if (type === "regenerate" || type === "retry") {
          renderLoading(messageId, chatId);
          ctx.sendToBackend({ type: "regenerate", chatId, messageId });
          return;
        }
        if (type === "open_guidance_modal") {
          openGuidanceModal(chatId, messageId);
          return;
        }
        if (type === "guidance") {
          const guidance = String(event.guidance || "").trim();
          if (!guidance)
            return;
          renderLoading(messageId, chatId);
          ctx.sendToBackend({
            type: "regenerate_with_guidance",
            chatId,
            messageId,
            guidance,
            saveAsPersonaGuidance: !!event.saveAsPersonaGuidance
          });
        }
      });
      cards.set(messageId, cleanup);
      widgetSignatures.set(messageId, signature);
      return true;
    } catch (err) {
      console.error("[Persona Paths] Message widget render failed", err);
      return false;
    }
  }
  function removeCard(messageId) {
    const cleanup = cards.get(messageId);
    if (cleanup) {
      try {
        cleanup();
      } catch {}
    }
    cards.delete(messageId);
    widgetSignatures.delete(messageId);
    dataByMessage.delete(messageId);
    if (activePathMessageId === messageId)
      activePathMessageId = null;
  }
  function renderLoading(messageId, chatId) {
    renderMessageWidget(messageId, chatId, { mode: "loading" });
  }
  function renderError(messageId, chatId, error) {
    renderMessageWidget(messageId, chatId, { mode: "error", error });
  }
  function renderChoices(data) {
    dataByMessage.set(data.messageId, data);
    renderMessageWidget(data.messageId, data.chatId, {
      mode: "choices",
      styleText: titleCaseStyle(data.style),
      sceneState: data.sceneState,
      choices: data.choices,
      prismColor: currentState?.prismInfo?.color || data.prismColor
    });
  }
  let pendingConfigPatch = {};
  function scheduleSave(patch, delay = 180) {
    Object.assign(pendingConfigPatch, patch);
    if (saveTimer)
      clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const combinedPatch = pendingConfigPatch;
      pendingConfigPatch = {};
      ctx.sendToBackend({ type: "save_config", patch: combinedPatch });
    }, delay);
  }
  function delayMs() {
    const seconds = Number(currentState?.config?.generationDelaySeconds ?? 3);
    return Math.max(0, Math.min(15, Number.isFinite(seconds) ? seconds : 3)) * 1000;
  }
  function cancelChoiceTimer(messageId) {
    const pending = choiceTimers.get(messageId);
    if (pending)
      clearTimeout(pending.timer);
    choiceTimers.delete(messageId);
    const fallback = renderFallbackTimers.get(messageId);
    if (fallback)
      clearTimeout(fallback.timer);
    renderFallbackTimers.delete(messageId);
    awaitingRender.delete(messageId);
  }
  function cancelChatTimers(chatId) {
    for (const [messageId, entry] of choiceTimers) {
      if (entry.chatId === chatId)
        cancelChoiceTimer(messageId);
    }
    for (const [messageId, entry] of renderFallbackTimers) {
      if (entry.chatId === chatId)
        cancelChoiceTimer(messageId);
    }
    for (const [messageId, pendingChatId] of awaitingRender) {
      if (pendingChatId === chatId)
        cancelChoiceTimer(messageId);
    }
  }
  function scheduleSettledGeneration(chatId, messageId) {
    cancelChoiceTimer(messageId);
    const timer = setTimeout(() => {
      choiceTimers.delete(messageId);
      if (currentState?.config?.enabled === false)
        return;
      ctx.sendToBackend({ type: "ensure_choices", chatId, messageId });
    }, delayMs());
    choiceTimers.set(messageId, { timer, chatId });
  }
  function waitForRenderThenGenerate(chatId, messageId) {
    cancelChoiceTimer(messageId);
    awaitingRender.set(messageId, chatId);
    if (renderedMessages.has(messageId)) {
      scheduleSettledGeneration(chatId, messageId);
      return;
    }
    const fallbackTimer = setTimeout(() => {
      renderFallbackTimers.delete(messageId);
      if (awaitingRender.get(messageId) !== chatId)
        return;
      scheduleSettledGeneration(chatId, messageId);
    }, 5000);
    renderFallbackTimers.set(messageId, { timer: fallbackTimer, chatId });
  }
  const tab = ctx.ui.registerDrawerTab({
    id: "persona-paths",
    title: "Persona Paths",
    shortName: "Paths",
    headerTitle: "Persona Paths",
    description: "Configure private persona-aware next-move choices",
    keywords: ["cyoa", "choices", "roleplay", "persona", "paths"],
    iconSvg: PATHS_ICON
  });
  document.querySelectorAll("[data-persona-paths-launcher]").forEach((el) => el.remove());
  let floatLauncher = null;
  let launcherButton = null;
  let launcherStatusTimer = null;
  let resetWatchTimer = null;
  let resetWatchStopTimer = null;
  let unsubLauncherDrag = () => {};
  const defaultLauncherPosition = { x: 16, y: Math.max(12, window.innerHeight - 142) };
  function setLauncherStatus(status, detail = "") {
    if (launcherStatusTimer)
      clearTimeout(launcherStatusTimer);
    launcherStatusTimer = null;
    if (!launcherButton)
      return;
    const label = launcherButton.querySelector("span");
    if (label)
      label.textContent = status === "working" ? "Working…" : status === "success" ? "Ready" : status === "error" ? "Failed" : "Paths";
    launcherButton.dataset.status = status;
    launcherButton.disabled = status === "working";
    launcherButton.title = status === "error" ? `Paths failed: ${detail || "Unknown error"}. Click to try again.` : status === "working" ? "Making paths for the latest reply" : status === "success" ? "New paths are ready under the latest reply" : "Get paths for the latest reply";
    launcherButton.setAttribute("aria-label", launcherButton.title);
    if (status === "success")
      launcherStatusTimer = setTimeout(() => setLauncherStatus("idle"), 3500);
  }
  function stopResetWatch() {
    if (resetWatchTimer)
      clearInterval(resetWatchTimer);
    if (resetWatchStopTimer)
      clearTimeout(resetWatchStopTimer);
    resetWatchTimer = null;
    resetWatchStopTimer = null;
  }
  function watchNativeReset() {
    if (!floatLauncher)
      return;
    stopResetWatch();
    const previous = floatLauncher.getPosition();
    resetWatchTimer = setInterval(() => {
      const pos = floatLauncher?.getPosition?.();
      if (!pos || Math.abs(pos.x - previous.x) < 2 && Math.abs(pos.y - previous.y) < 2)
        return;
      const resetY = Math.min(defaultLauncherPosition.y, Math.max(0, window.innerHeight - LAUNCHER_HEIGHT));
      if (Math.abs(pos.x - defaultLauncherPosition.x) < 4 && Math.abs(pos.y - resetY) < 4) {
        try {
          window.localStorage.removeItem(LAUNCHER_POSITION_KEY);
        } catch {}
      } else
        rememberLauncherPosition(pos);
      stopResetWatch();
    }, 200);
    resetWatchStopTimer = setTimeout(stopResetWatch, 12000);
  }
  function repositionLauncher() {
    const saved = readLauncherPosition();
    if (saved && floatLauncher) {
      const pos = launcherCoordinates(saved);
      floatLauncher.moveTo(pos.x, pos.y);
    }
  }
  try {
    floatLauncher = ctx.ui.createFloatWidget({
      width: LAUNCHER_WIDTH,
      height: LAUNCHER_HEIGHT,
      initialPosition: defaultLauncherPosition,
      snapToEdge: true,
      tooltip: `Persona Paths + User Writer v${EXT_VERSION}`,
      chromeless: true
    });
    repositionLauncher();
    unsubLauncherDrag = floatLauncher.onDragEnd((pos) => rememberLauncherPosition(pos));
    floatLauncher.root.addEventListener("contextmenu", watchNativeReset, true);
    window.addEventListener("resize", repositionLauncher);
    const launcherGroup = ctx.dom.createElement("div", { class: "pp-launcher-group" });
    const launcher = ctx.dom.createElement("button", { type: "button", class: "pp-launcher paths" });
    launcherButton = launcher;
    launcher.innerHTML = `${PATHS_ICON}<span>Paths</span>`;
    launcher.addEventListener("click", triggerManualGeneration);
    setLauncherStatus("idle");
    const writerLauncher = ctx.dom.createElement("button", { type: "button", class: "pp-launcher writer" });
    writerLauncher.title = "Write for me: write or rewrite your message";
    writerLauncher.setAttribute("aria-label", "Write for me");
    writerLauncher.innerHTML = PEN_ICON;
    writerLauncher.addEventListener("click", triggerUserWriter);
    const settingsLauncher = ctx.dom.createElement("button", { type: "button", class: "pp-launcher settings" });
    settingsLauncher.title = "Open Persona Paths settings";
    settingsLauncher.setAttribute("aria-label", "Open Persona Paths settings");
    settingsLauncher.innerHTML = TUNE_ICON;
    settingsLauncher.addEventListener("click", () => tab.activate());
    launcherGroup.append(launcher, writerLauncher, settingsLauncher);
    floatLauncher.root.appendChild(launcherGroup);
  } catch (err) {
    console.warn("[Persona Paths] Native floating launcher unavailable", err);
  }
  let openAction = null;
  let unsubOpenAction = () => {};
  try {
    openAction = ctx.ui.registerInputBarAction({
      id: "open-persona-paths",
      label: "Open Persona Paths",
      iconSvg: PATHS_ICON,
      enabled: true
    });
    unsubOpenAction = openAction.onClick(() => tab.activate());
  } catch {}
  let manualAction = null;
  let unsubManualAction = () => {};
  let polishAction = null;
  let unsubPolishAction = () => {};
  const settings = ctx.dom.createElement("div", { class: "pp-settings" });
  tab.root.appendChild(settings);
  const modelsPanel = ctx.dom.createElement("section", { class: "pp-panel", role: "tabpanel" });
  const writerSection = ctx.dom.createElement("div", { class: "pp-panel" });
  modelsPanel.appendChild(writerSection);
  settings.appendChild(modelsPanel);
  const heading = ctx.dom.createElement("h3");
  heading.textContent = "Persona Paths";
  const version = ctx.dom.createElement("div", { class: "pp-version" });
  version.textContent = `v${EXT_VERSION}`;
  const titleRow = ctx.dom.createElement("div", { class: "pp-title" });
  titleRow.append(heading, version);
  const intro = ctx.dom.createElement("p");
  intro.textContent = "Ideas for what your character does next. They stay private and never enter the story.";
  const enabled = ctx.dom.createElement("input", { type: "checkbox", role: "switch" });
  const enabledLabel = ctx.dom.createElement("label", { class: "pp-check" });
  enabledLabel.append(enabled, document.createTextNode("Make paths after every reply"));
  enabled.addEventListener("change", () => scheduleSave({ enabled: enabled.checked }, 0));
  const skipOoc = ctx.dom.createElement("input", { type: "checkbox", role: "switch" });
  const skipOocLabel = ctx.dom.createElement("label", { class: "pp-check" });
  skipOocLabel.append(skipOoc, document.createTextNode("Skip out-of-character (OOC) messages"));
  skipOoc.addEventListener("change", () => scheduleSave({ skipOoc: skipOoc.checked }, 0));
  const skipOocHint = ctx.dom.createElement("div", { class: "pp-hint" });
  skipOocHint.textContent = "Automatic paths leave OOC messages, and the reply to them, alone. The Get paths button still works on them.";
  const manualRun = ctx.dom.createElement("button", { type: "button", class: "pp-btn pp-primary" });
  manualRun.textContent = "Get paths for the latest reply";
  const manualStatus = ctx.dom.createElement("div", { class: "pp-manual-status" });
  manualStatus.textContent = "Works even when automatic paths are off.";
  let manualPending = false;
  let manualTarget = null;
  function matchesManualTarget(chatId, messageId) {
    return manualPending && !!manualTarget && String(chatId || "") === manualTarget.chatId && String(messageId || "") === manualTarget.messageId;
  }
  function finishManualGeneration(status, message) {
    manualPending = false;
    manualTarget = null;
    manualRun.disabled = false;
    manualRun.textContent = "Get paths for the latest reply";
    manualStatus.classList.toggle("error", status === "error");
    manualStatus.textContent = message;
    setLauncherStatus(status, message);
  }
  function triggerManualGeneration() {
    if (manualPending)
      return;
    manualPending = true;
    manualTarget = null;
    manualRun.disabled = true;
    manualRun.textContent = "Finding the latest reply…";
    manualStatus.classList.remove("error");
    manualStatus.textContent = "Looking for the latest reply…";
    setLauncherStatus("working");
    try {
      ctx.sendToBackend({ type: "manual_generate_latest" });
    } catch (err) {
      finishManualGeneration("error", err?.message || String(err));
    }
  }
  manualRun.addEventListener("click", triggerManualGeneration);
  const writeRun = ctx.dom.createElement("button", { type: "button", class: "pp-btn" });
  writeRun.innerHTML = PEN_ICON;
  writeRun.append(document.createTextNode("Write for me"));
  writeRun.title = "Write or rewrite your next message";
  writeRun.addEventListener("click", triggerUserWriter);
  try {
    manualAction = ctx.ui.registerInputBarAction({
      id: "generate-persona-paths",
      label: "Generate Paths for Latest Reply",
      iconSvg: PATHS_ICON,
      enabled: true
    });
    unsubManualAction = manualAction.onClick(triggerManualGeneration);
  } catch {}
  try {
    polishAction = ctx.ui.registerInputBarAction({
      id: "polish-persona-paths-draft",
      label: "User Writer",
      iconSvg: PATHS_ICON,
      enabled: true
    });
    unsubPolishAction = polishAction.onClick(triggerUserWriter);
  } catch {}
  const CONNECTION_MODEL = "__connection_model__";
  const MANUAL_MODEL = "__manual_model__";
  let openRouterModels = [];
  let openRouterCatalogPending = false;
  let openRouterCatalogError = "";
  let openRouterFetchedAt = 0;
  function isOpenRouterConnection(conn) {
    const provider = String(conn?.provider || "").toLowerCase();
    const apiUrl = String(conn?.api_url || conn?.apiUrl || "").toLowerCase();
    return provider.includes("openrouter") || apiUrl.includes("openrouter.ai");
  }
  function formatContextLength(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0)
      return "";
    if (n >= 1e6) {
      const m = n / 1e6;
      return `${Number.isInteger(m) ? m.toFixed(0) : m.toFixed(1)}M context`;
    }
    if (n >= 1000)
      return `${Math.round(n / 1000)}K context`;
    return `${Math.round(n)} context`;
  }
  function catalogOptions(conn, override) {
    const useConnection = {
      value: CONNECTION_MODEL,
      label: "Use connection model",
      sublabel: String(conn?.model || "Follow the selected connection profile")
    };
    const modelOptions = openRouterModels.map((model) => {
      const bits = [model.name || model.id];
      const context = formatContextLength(model.contextLength);
      if (context)
        bits.push(context);
      if (model.reasoning)
        bits.push("reasoning");
      return { value: model.id, label: model.id, sublabel: bits.join(" · ") };
    });
    if (override) {
      const index = modelOptions.findIndex((opt) => opt.value === override);
      if (index > 0) {
        const [selected] = modelOptions.splice(index, 1);
        modelOptions.unshift(selected);
      }
    }
    return [
      useConnection,
      ...modelOptions,
      { value: MANUAL_MODEL, label: "Manual model ID…", sublabel: "Paste an exact model ID that is not in the catalog" }
    ];
  }
  function requestOpenRouterCatalog(force = false) {
    if (openRouterCatalogPending)
      return;
    if (!currentState?.corsGranted) {
      openRouterCatalogError = "Grant the CORS Proxy permission to load OpenRouter models. Manual model IDs still work.";
      updateModelPickers();
      return;
    }
    if (!force && openRouterModels.length)
      return;
    openRouterCatalogPending = true;
    openRouterCatalogError = "";
    updateModelPickers();
    ctx.sendToBackend({ type: "get_openrouter_models", force });
  }
  const connectionSlot = ctx.dom.createElement("div", { class: "pp-native-select-slot" });
  const connectionField = createLabeledField(ctx, "Connection", connectionSlot, "The AI connection that writes your paths. It can be different from your story model.");
  modelsPanel.insertBefore(connectionField, writerSection);
  const connectionPicker = ctx.components.mountSelect(connectionSlot, {
    value: "",
    options: [],
    placeholder: "Choose a connection…",
    searchPlaceholder: "Search connections…",
    noResultsMessage: "No matching connections.",
    emptyMessage: "No Lumiverse LLM connections are available.",
    portal: true,
    maxHeight: 360,
    minWidth: 300,
    onChange: (connectionId) => scheduleSave({ connectionId }, 0)
  });
  const connectionStatus = ctx.dom.createElement("div", { class: "pp-connection-status" });
  connectionStatus.textContent = "Loading Lumiverse connections…";
  const refreshConnections = ctx.dom.createElement("button", { type: "button", class: "pp-btn" });
  refreshConnections.textContent = "Reload connections";
  refreshConnections.addEventListener("click", () => {
    connectionStatus.classList.remove("error");
    connectionStatus.textContent = "Refreshing Lumiverse connections…";
    ctx.sendToBackend({ type: "get_state" });
  });
  refreshConnections.classList.add("pp-quiet");
  const modelSlot = ctx.dom.createElement("div", { class: "pp-native-select-slot" });
  const modelField = createLabeledField(ctx, "Model", modelSlot, "Search the OpenRouter list, or keep the connection’s own model.");
  modelsPanel.insertBefore(modelField, writerSection);
  const modelPicker = ctx.components.mountSelect(modelSlot, {
    value: CONNECTION_MODEL,
    options: [],
    placeholder: "Use connection model",
    searchPlaceholder: "Search OpenRouter models…",
    noResultsMessage: "No matching models.",
    emptyMessage: "Model catalog unavailable.",
    portal: true,
    maxHeight: 420,
    minWidth: 340,
    onChange: (value) => {
      if (value === CONNECTION_MODEL)
        scheduleSave({ modelOverride: "" }, 0);
      else if (value === MANUAL_MODEL) {
        modelOverrideWrap.hidden = false;
        setTimeout(() => modelOverride.focus(), 0);
      } else
        scheduleSave({ modelOverride: value }, 0);
    }
  });
  const modelCatalogStatus = ctx.dom.createElement("div", { class: "pp-connection-status" });
  const refreshModels = ctx.dom.createElement("button", { type: "button", class: "pp-btn" });
  refreshModels.textContent = "Reload model list";
  refreshModels.addEventListener("click", () => {
    openRouterModels = [];
    openRouterCatalogError = "";
    requestOpenRouterCatalog(true);
  });
  const modelTools = ctx.dom.createElement("div", { class: "pp-model-tools" });
  modelTools.append(modelCatalogStatus, refreshModels);
  const modelOverride = ctx.dom.createElement("input", { type: "text", placeholder: "e.g. google/gemini-3.1-pro-preview" });
  modelOverride.addEventListener("input", () => scheduleSave({ modelOverride: modelOverride.value }));
  const modelOverrideWrap = createLabeledField(ctx, "Model ID", modelOverride, "The exact ID sent to the provider. Leave blank to use the connection’s model.");
  const writerDivider = ctx.dom.createElement("div", { class: "pp-divider" });
  const writerHeading = ctx.dom.createElement("h4");
  writerHeading.textContent = "Write for me (User Writer)";
  const writerIntro = ctx.dom.createElement("p");
  writerIntro.textContent = "Writes or polishes your next message. It works even when paths are off or fail.";
  const writerConnectionSlot = ctx.dom.createElement("div", { class: "pp-native-select-slot" });
  const writerConnectionField = createLabeledField(ctx, "Connection", writerConnectionSlot, "Same as paths, unless you pick another.");
  writerSection.appendChild(writerConnectionField);
  const writerConnectionPicker = ctx.components.mountSelect(writerConnectionSlot, {
    value: "__same_as_paths__",
    options: [],
    placeholder: "Same as Persona Paths",
    searchPlaceholder: "Search connections…",
    noResultsMessage: "No matching connections.",
    emptyMessage: "No Lumiverse LLM connections are available.",
    portal: true,
    maxHeight: 360,
    minWidth: 300,
    onChange: (connectionId) => scheduleSave({ writerConnectionId: connectionId === "__same_as_paths__" ? "" : connectionId }, 0)
  });
  const writerConnectionStatus = ctx.dom.createElement("div", { class: "pp-connection-status" });
  writerConnectionStatus.textContent = "Using the paths connection.";
  const writerModelSlot = ctx.dom.createElement("div", { class: "pp-native-select-slot" });
  const writerModelField = createLabeledField(ctx, "Model", writerModelSlot);
  writerSection.appendChild(writerModelField);
  const writerModelPicker = ctx.components.mountSelect(writerModelSlot, {
    value: CONNECTION_MODEL,
    options: [],
    placeholder: "Use writer connection model",
    searchPlaceholder: "Search OpenRouter models…",
    noResultsMessage: "No matching models.",
    emptyMessage: "Model catalog unavailable.",
    portal: true,
    maxHeight: 420,
    minWidth: 340,
    onChange: (value) => {
      if (value === CONNECTION_MODEL)
        scheduleSave({ writerModelOverride: "" }, 0);
      else if (value === MANUAL_MODEL) {
        writerModelOverrideWrap.hidden = false;
        setTimeout(() => writerModelOverride.focus(), 0);
      } else
        scheduleSave({ writerModelOverride: value }, 0);
    }
  });
  const writerModelCatalogStatus = ctx.dom.createElement("div", { class: "pp-connection-status" });
  const writerModelOverride = ctx.dom.createElement("input", { type: "text", placeholder: "e.g. anthropic/claude-sonnet-5" });
  writerModelOverride.addEventListener("input", () => scheduleSave({ writerModelOverride: writerModelOverride.value }));
  const writerModelOverrideWrap = createLabeledField(ctx, "Model ID", writerModelOverride, "The exact ID sent to the provider. Leave blank to use the connection’s model.");
  function updateOneModelPicker(picker, manualWrap, status, conn, override, writer = false) {
    const openRouter = isOpenRouterConnection(conn);
    const exactOverride = String(override || "").trim();
    if (!openRouter) {
      picker.update({
        value: exactOverride ? MANUAL_MODEL : CONNECTION_MODEL,
        options: [
          { value: CONNECTION_MODEL, label: writer ? "Use writer connection model" : "Use connection model", sublabel: String(conn?.model || "Follow the selected connection profile") },
          { value: MANUAL_MODEL, label: "Manual model ID…", sublabel: "Searchable catalogs are currently available for OpenRouter connections" }
        ]
      });
      manualWrap.hidden = false;
      status.classList.remove("error");
      status.textContent = conn ? `${String(conn.provider || "This provider")} does not expose a searchable text-model catalog to Persona Paths; manual override remains available.` : "Choose a connection to configure a model.";
      return;
    }
    const hasCatalogMatch = !!exactOverride && openRouterModels.some((model) => model.id === exactOverride);
    picker.update({
      value: !exactOverride ? CONNECTION_MODEL : hasCatalogMatch ? exactOverride : MANUAL_MODEL,
      options: catalogOptions(conn, exactOverride)
    });
    manualWrap.hidden = false;
    if (openRouterCatalogPending) {
      status.classList.remove("error");
      status.textContent = "Loading OpenRouter’s searchable model catalog…";
    } else if (openRouterCatalogError) {
      status.classList.add("error");
      status.textContent = openRouterCatalogError;
    } else if (openRouterModels.length) {
      status.classList.remove("error");
      const age = openRouterFetchedAt ? Math.max(0, Math.round((Date.now() - openRouterFetchedAt) / 60000)) : 0;
      status.textContent = `${openRouterModels.length} OpenRouter text models loaded${age ? ` · refreshed ${age}m ago` : ""}. Search by model name or exact ID.`;
    } else {
      status.classList.remove("error");
      status.textContent = "OpenRouter connection detected. Loading searchable models…";
    }
  }
  function updateModelPickers() {
    const state = currentState || {};
    const cfg = state.config || {};
    const conns = Array.isArray(state.connections) ? state.connections : [];
    const selectedConnection = cfg.connectionId && conns.some((c) => c.id === cfg.connectionId) ? cfg.connectionId : (conns.find((c) => c.is_default) || conns[0])?.id || "";
    const pathsConn = conns.find((c) => String(c.id) === String(selectedConnection));
    const writerConn = cfg.writerConnectionId ? conns.find((c) => String(c.id) === String(cfg.writerConnectionId)) || pathsConn : pathsConn;
    updateOneModelPicker(modelPicker, modelOverrideWrap, modelCatalogStatus, pathsConn, cfg.modelOverride || "", false);
    updateOneModelPicker(writerModelPicker, writerModelOverrideWrap, writerModelCatalogStatus, writerConn, cfg.writerModelOverride || "", true);
    const needsCatalog = isOpenRouterConnection(pathsConn) || isOpenRouterConnection(writerConn);
    refreshModels.hidden = !needsCatalog;
    if (needsCatalog && !openRouterModels.length && !openRouterCatalogPending && !openRouterCatalogError)
      requestOpenRouterCatalog(false);
  }
  const writerTuningGrid = ctx.dom.createElement("div", { class: "pp-grid" });
  const writerTemperature = ctx.dom.createElement("input", { type: "number", min: "0", max: "2", step: "0.05" });
  writerTemperature.addEventListener("change", () => scheduleSave({ writerTemperature: Number(writerTemperature.value) }, 0));
  const writerMaxTokens = ctx.dom.createElement("input", { type: "number", min: "500", max: "32000", step: "100" });
  writerMaxTokens.addEventListener("change", () => scheduleSave({ writerMaxTokens: Number(writerMaxTokens.value) }, 0));
  writerTuningGrid.append(createLabeledField(ctx, "Creativity (temperature)", writerTemperature), createLabeledField(ctx, "Length limit (tokens)", writerMaxTokens));
  const writerReasoningToggle = ctx.dom.createElement("input", { type: "checkbox", role: "switch" });
  const writerReasoningLabel = ctx.dom.createElement("label", { class: "pp-check" });
  writerReasoningLabel.append(writerReasoningToggle, document.createTextNode("Let the model think first"));
  writerReasoningToggle.addEventListener("change", () => scheduleSave({ writerUseReasoning: writerReasoningToggle.checked }, 0));
  const grid = ctx.dom.createElement("div", { class: "pp-grid" });
  const pov = ctx.dom.createElement("select");
  [["auto", "Auto"], ["first", "First person"], ["second", "Second person"], ["third", "Third person"]].forEach(([v, l]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = l;
    pov.appendChild(o);
  });
  pov.addEventListener("change", () => scheduleSave({ pov: pov.value }, 0));
  const tense = ctx.dom.createElement("select");
  [["auto", "Auto"], ["present", "Present"], ["past", "Past"]].forEach(([v, l]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = l;
    tense.appendChild(o);
  });
  tense.addEventListener("change", () => scheduleSave({ tense: tense.value }, 0));
  const detail = ctx.dom.createElement("select");
  [["compact", "Short"], ["normal", "Normal"], ["detailed", "Long"]].forEach(([v, l]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = l;
    detail.appendChild(o);
  });
  detail.addEventListener("change", () => scheduleSave({ detail: detail.value }, 0));
  const choiceCount = ctx.dom.createElement("input", { type: "number", min: "3", max: "6", step: "1" });
  choiceCount.addEventListener("change", () => scheduleSave({ choiceCount: Number(choiceCount.value) }, 0));
  grid.append(createLabeledField(ctx, "How many paths", choiceCount), createLabeledField(ctx, "Detail", detail), createLabeledField(ctx, "Point of view", pov), createLabeledField(ctx, "Tense", tense));
  const behaviorGrid = ctx.dom.createElement("div", { class: "pp-grid" });
  const generationDelay = ctx.dom.createElement("select");
  [["0", "No delay"], ["2", "2 seconds"], ["3", "3 seconds (recommended)"], ["5", "5 seconds"], ["10", "10 seconds"]].forEach(([v, l]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = l;
    generationDelay.appendChild(o);
  });
  generationDelay.addEventListener("change", () => scheduleSave({ generationDelaySeconds: Number(generationDelay.value) }, 0));
  const adultContent = ctx.dom.createElement("select");
  [["match_scene", "Match scene"], ["allow_explicit", "Allow explicit"], ["suggestive", "Keep suggestive"]].forEach(([v, l]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = l;
    adultContent.appendChild(o);
  });
  adultContent.addEventListener("change", () => scheduleSave({ adultContent: adultContent.value }, 0));
  const prismIntegration = ctx.dom.createElement("select");
  [["auto", "Match Prism"], ["manual", "My own colour"], ["off", "Off"]].forEach(([v, l]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = l;
    prismIntegration.appendChild(o);
  });
  prismIntegration.addEventListener("change", () => {
    prismColorInput.disabled = prismIntegration.value !== "manual" || !currentState?.activePersona?.id;
    scheduleSave({ prismIntegration: prismIntegration.value }, 0);
  });
  const prismColorInput = ctx.dom.createElement("input", { type: "text", placeholder: "#B6E472", maxlength: "7", spellcheck: "false" });
  let prismColorTimer = null;
  prismColorInput.addEventListener("input", () => {
    const personaId = currentState?.activePersona?.id;
    if (!personaId || prismIntegration.value !== "manual")
      return;
    if (prismColorTimer)
      clearTimeout(prismColorTimer);
    prismColorTimer = setTimeout(() => ctx.sendToBackend({ type: "set_prism_color_override", personaId, color: prismColorInput.value }), 220);
  });
  const delayField = createLabeledField(ctx, "Wait before making paths", generationDelay, "Gives the reply time to finish showing.");
  const adultField = createLabeledField(ctx, "Adult content", adultContent, "Match scene follows the story. Allow explicit permits it when it fits, without pushing for it.");
  behaviorGrid.append(delayField, adultField);
  const prismHeading = ctx.dom.createElement("h4");
  prismHeading.textContent = "Speech colour";
  const prismGrid = ctx.dom.createElement("div", { class: "pp-grid" });
  prismGrid.append(createLabeledField(ctx, "Colour spoken lines", prismIntegration, "Match Prism uses the colour Prism gives your persona."), createLabeledField(ctx, "My own colour", prismColorInput, "A hex code such as #B6E472, saved for each persona."));
  const prismStatus = ctx.dom.createElement("div", { class: "pp-prism-status" });
  prismStatus.textContent = "Checking Prism…";
  const grid2 = ctx.dom.createElement("div", { class: "pp-grid" });
  const contextMessages = ctx.dom.createElement("input", { type: "number", min: "6", max: "40", step: "1" });
  contextMessages.addEventListener("change", () => scheduleSave({ contextMessages: Number(contextMessages.value) }, 0));
  const recentUserExamples = ctx.dom.createElement("input", { type: "number", min: "2", max: "12", step: "1" });
  recentUserExamples.addEventListener("change", () => scheduleSave({ recentUserExamples: Number(recentUserExamples.value) }, 0));
  const storyMemoryChunks = ctx.dom.createElement("input", { type: "number", min: "1", max: "12", step: "1" });
  storyMemoryChunks.addEventListener("change", () => scheduleSave({ storyMemoryChunks: Number(storyMemoryChunks.value) }, 0));
  grid2.append(createLabeledField(ctx, "Recent messages to read", contextMessages, "How much of the current scene the model sees."), createLabeledField(ctx, "Examples of your writing", recentUserExamples, "Your recent messages, used to learn how you play this persona."));
  const cortexCountField = createLabeledField(ctx, "Cortex memories to add", storyMemoryChunks, "How many long-term memories to bring in.");
  const longTermStoryMemoryToggle = ctx.dom.createElement("input", { type: "checkbox", role: "switch" });
  const longTermStoryMemoryLabel = ctx.dom.createElement("label", { class: "pp-check" });
  longTermStoryMemoryLabel.append(longTermStoryMemoryToggle, document.createTextNode("Use Lumiverse Memory Cortex"));
  longTermStoryMemoryToggle.addEventListener("change", () => {
    storyMemoryChunks.disabled = !longTermStoryMemoryToggle.checked;
    scheduleSave({ longTermStoryMemory: longTermStoryMemoryToggle.checked }, 0);
  });
  const longTermStoryMemoryHint = ctx.dom.createElement("div", { class: "pp-hint" });
  longTermStoryMemoryHint.textContent = "Read-only. Needs the Memories permission. Without Cortex, paths use chat memory, then the recent scene.";
  const cortexStatus = ctx.dom.createElement("div", { class: "pp-hint" });
  cortexStatus.textContent = "Checking Memory Cortex permission…";
  const relationshipMemoryToggle = ctx.dom.createElement("input", { type: "checkbox", role: "switch" });
  const relationshipLabel = ctx.dom.createElement("label", { class: "pp-check" });
  relationshipLabel.append(relationshipMemoryToggle, document.createTextNode("Remember how your persona treats each character"));
  relationshipMemoryToggle.addEventListener("change", () => scheduleSave({ relationshipMemory: relationshipMemoryToggle.checked }, 0));
  const relationshipHint = ctx.dom.createElement("div", { class: "pp-hint" });
  relationshipHint.textContent = "Private notes kept by Persona Paths. They never enter the story.";
  const reasoningToggle = ctx.dom.createElement("input", { type: "checkbox", role: "switch" });
  const reasoningLabel = ctx.dom.createElement("label", { class: "pp-check" });
  reasoningLabel.append(reasoningToggle, document.createTextNode("Let the model think first"));
  reasoningToggle.addEventListener("change", () => scheduleSave({ useReasoning: reasoningToggle.checked }, 0));
  const reasoningHint = ctx.dom.createElement("div", { class: "pp-hint" });
  reasoningHint.textContent = "Kimi K3 and K2.7 always think. With this off, K3 thinks as little as it can.";
  const personaBadge = ctx.dom.createElement("div", { class: "pp-persona-badge" });
  personaBadge.textContent = "Loading your persona…";
  const personaSelector = ctx.dom.createElement("select", { "aria-label": "Persona for this chat" });
  personaSelector.addEventListener("change", () => {
    if (writerPending) {
      personaSelector.value = currentState?.selectedPersonaId || "";
      return;
    }
    flushPersonaGuidance();
    personaInstructions.disabled = true;
    ctx.sendToBackend({ type: "set_chat_persona", chatId: currentState?.activeChatId, personaId: personaSelector.value });
  });
  const personaField = createLabeledField(ctx, "Playing as, in this chat", personaSelector);
  let personaSaveTimer = null;
  let pendingPersonaGuidance = null;
  function flushPersonaGuidance() {
    if (personaSaveTimer)
      clearTimeout(personaSaveTimer);
    personaSaveTimer = null;
    if (pendingPersonaGuidance)
      ctx.sendToBackend({ type: "set_persona_override", ...pendingPersonaGuidance });
    pendingPersonaGuidance = null;
  }
  const personaInstructions = ctx.dom.createElement("textarea", { placeholder: "Optional" });
  personaInstructions.addEventListener("input", () => {
    const personaId = currentState?.activePersona?.id;
    if (!personaId)
      return;
    if (personaSaveTimer)
      clearTimeout(personaSaveTimer);
    pendingPersonaGuidance = { personaId, text: personaInstructions.value };
    personaSaveTimer = setTimeout(flushPersonaGuidance, 220);
  });
  const personaGuidanceField = createLabeledField(ctx, "Notes on this persona", personaInstructions, "How they act, and any exceptions. For example: soft with Elena, reckless with everyone else. Kept private.");
  const globalInstructions = ctx.dom.createElement("textarea", { placeholder: "Optional" });
  globalInstructions.addEventListener("input", () => scheduleSave({ globalInstructions: globalInstructions.value }));
  const globalGuidanceField = createLabeledField(ctx, "Rules for every persona", globalInstructions);
  const advancedGrid = ctx.dom.createElement("div", { class: "pp-grid" });
  const temperature = ctx.dom.createElement("input", { type: "number", min: "0", max: "2", step: "0.05" });
  temperature.addEventListener("change", () => scheduleSave({ temperature: Number(temperature.value) }, 0));
  const maxTokens = ctx.dom.createElement("input", { type: "number", min: "500", max: "32000", step: "100" });
  maxTokens.addEventListener("change", () => scheduleSave({ maxTokens: Number(maxTokens.value) }, 0));
  advancedGrid.append(createLabeledField(ctx, "Creativity (temperature)", temperature), createLabeledField(ctx, "Length limit (tokens)", maxTokens, "Kimi models that always think get at least 16,000."));
  const clearMemory = ctx.dom.createElement("button", { type: "button", class: "pp-btn" });
  clearMemory.textContent = "Clear these notes";
  clearMemory.addEventListener("click", () => ctx.sendToBackend({ type: "clear_relationship_memory" }));
  clearMemory.classList.add("pp-quiet");
  const h4 = (text) => {
    const el = ctx.dom.createElement("h4");
    el.textContent = text;
    return el;
  };
  const panel = (...children) => {
    const el = ctx.dom.createElement("section", { class: "pp-panel", role: "tabpanel" });
    el.append(...children);
    return el;
  };
  const nowCard = ctx.dom.createElement("div", { class: "pp-now" });
  const actionRow = ctx.dom.createElement("div", { class: "pp-row" });
  actionRow.append(manualRun, writeRun);
  nowCard.append(personaField, personaBadge, actionRow, manualStatus, enabledLabel);
  connectionField.before(h4("Paths"));
  connectionField.after(connectionStatus, refreshConnections);
  modelField.after(modelTools, modelOverrideWrap, advancedGrid, reasoningLabel, reasoningHint, ctx.dom.createElement("div", { class: "pp-divider" }));
  writerConnectionField.before(writerHeading, writerIntro);
  writerConnectionField.after(writerConnectionStatus);
  writerModelField.after(writerModelCatalogStatus, writerModelOverrideWrap, writerTuningGrid, writerReasoningLabel);
  const views = [
    { id: "persona", label: "Persona", el: panel(personaGuidanceField, globalGuidanceField) },
    { id: "paths", label: "Paths", el: panel(grid, behaviorGrid, skipOocLabel, skipOocHint, writerDivider, prismHeading, prismGrid, prismStatus) },
    { id: "models", label: "Models", el: modelsPanel },
    { id: "memory", label: "Memory", el: panel(grid2, longTermStoryMemoryLabel, longTermStoryMemoryHint, cortexCountField, cortexStatus, relationshipLabel, relationshipHint, clearMemory) }
  ];
  const tabBar = ctx.dom.createElement("div", { class: "pp-tabs", role: "tablist", "aria-label": "Persona Paths settings" });
  function showView(id, focus = false) {
    for (const view of views) {
      const selected = view.id === id;
      const button = tabBar.querySelector(`[data-pp-view="${view.id}"]`);
      view.el.hidden = !selected;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus)
        button.focus();
    }
  }
  views.forEach((view, index) => {
    const button = ctx.dom.createElement("button", { type: "button", role: "tab", "data-pp-view": view.id });
    button.textContent = view.label;
    button.addEventListener("click", () => showView(view.id));
    button.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step)
        return;
      event.preventDefault();
      showView(views[(index + step + views.length) % views.length].id, true);
    });
    tabBar.appendChild(button);
  });
  modelsPanel.before(titleRow, intro, nowCard, tabBar, views[0].el, views[1].el);
  modelsPanel.after(views[3].el);
  showView("persona");
  function applyState(state) {
    currentState = state;
    const cfg = state?.config || {};
    const persona = state?.activePersona;
    enabled.checked = !!cfg.enabled;
    skipOoc.checked = cfg.skipOoc !== false;
    pov.value = cfg.pov || "auto";
    tense.value = cfg.tense || "auto";
    detail.value = cfg.detail || "normal";
    generationDelay.value = String(cfg.generationDelaySeconds ?? 3);
    adultContent.value = cfg.adultContent || "match_scene";
    prismIntegration.value = cfg.prismIntegration || "auto";
    prismColorInput.value = persona?.id ? cfg.prismColorOverrides?.[persona.id] || "" : "";
    prismColorInput.disabled = prismIntegration.value !== "manual" || !persona?.id;
    choiceCount.value = String(cfg.choiceCount ?? 4);
    contextMessages.value = String(cfg.contextMessages ?? 12);
    recentUserExamples.value = String(cfg.recentUserExamples ?? 6);
    storyMemoryChunks.value = String(cfg.storyMemoryChunks ?? 6);
    longTermStoryMemoryToggle.checked = cfg.longTermStoryMemory !== false;
    storyMemoryChunks.disabled = !longTermStoryMemoryToggle.checked;
    cortexStatus.textContent = state?.memoriesGranted ? "Cortex access is on. Persona Paths only reads from it." : "Cortex access is not granted yet, so the fallback is used.";
    relationshipMemoryToggle.checked = cfg.relationshipMemory !== false;
    reasoningToggle.checked = !!cfg.useReasoning;
    if (document.activeElement !== modelOverride)
      modelOverride.value = cfg.modelOverride || "";
    if (document.activeElement !== writerModelOverride)
      writerModelOverride.value = cfg.writerModelOverride || "";
    writerTemperature.value = String(cfg.writerTemperature ?? 0.75);
    writerMaxTokens.value = String(cfg.writerMaxTokens ?? 2200);
    writerReasoningToggle.checked = !!cfg.writerUseReasoning;
    globalInstructions.value = cfg.globalInstructions || "";
    temperature.value = String(cfg.temperature ?? 0.85);
    maxTokens.value = String(cfg.maxTokens ?? 1400);
    prismStatus.textContent = String(state?.prismInfo?.status || (cfg.prismIntegration === "off" ? "Prism integration is off." : "Prism color unavailable."));
    if (state?.prismInfo?.color) {
      const cached = activePathMessageId ? dataByMessage.get(activePathMessageId) : null;
      if (cached)
        renderChoices(cached);
    }
    const conns = Array.isArray(state?.connections) ? state.connections : [];
    const selectedConnection = cfg.connectionId && conns.some((c) => c.id === cfg.connectionId) ? cfg.connectionId : (conns.find((c) => c.is_default) || conns[0])?.id || "";
    connectionPicker.update({
      value: selectedConnection,
      options: conns.map((c) => ({
        value: String(c.id),
        label: String(c.name || "Unnamed connection"),
        sublabel: String(c.model || c.provider || "")
      }))
    });
    const writerConnectionId = cfg.writerConnectionId && conns.some((c) => c.id === cfg.writerConnectionId) ? String(cfg.writerConnectionId) : "__same_as_paths__";
    const selectedPathsConn = conns.find((c) => String(c.id) === String(selectedConnection));
    writerConnectionPicker.update({
      value: writerConnectionId,
      options: [
        {
          value: "__same_as_paths__",
          label: "Same as Persona Paths",
          sublabel: selectedPathsConn ? String(selectedPathsConn.model || selectedPathsConn.provider || "") : "Follow the Paths connection"
        },
        ...conns.map((c) => ({
          value: String(c.id),
          label: String(c.name || "Unnamed connection"),
          sublabel: String(c.model || c.provider || "")
        }))
      ]
    });
    const chosenWriterConn = writerConnectionId === "__same_as_paths__" ? selectedPathsConn : conns.find((c) => String(c.id) === writerConnectionId);
    writerConnectionStatus.textContent = writerConnectionId === "__same_as_paths__" ? `Using the paths connection${chosenWriterConn ? `: ${String(chosenWriterConn.name || chosenWriterConn.model || "")}` : ""}.` : `Using its own connection${chosenWriterConn ? `: ${String(chosenWriterConn.name || chosenWriterConn.model || "")}` : ""}.`;
    updateModelPickers();
    const connectionError = String(state?.connectionError || "");
    if (connectionError) {
      connectionStatus.classList.add("error");
      connectionStatus.textContent = connectionError;
    } else {
      connectionStatus.classList.remove("error");
      connectionStatus.textContent = `${conns.length} connection${conns.length === 1 ? "" : "s"} found in Lumiverse.`;
    }
    const personaError = String(state?.personaError || state?.personaListError || "");
    personaBadge.textContent = `Writing as ${persona?.name || "no one yet"}.${personaError ? ` ${personaError}` : ""}`;
    personaSelector.replaceChildren();
    personaSelector.add(new Option("Whoever is active in Lumiverse", ""));
    for (const item of state?.personas || [])
      personaSelector.add(new Option(item.name || "Unnamed persona", item.id));
    if (state?.selectedPersonaId && !Array.from(personaSelector.options).some((option) => option.value === state.selectedPersonaId)) {
      personaSelector.add(new Option("Selected persona (unavailable)", state.selectedPersonaId));
    }
    personaSelector.value = state?.selectedPersonaId || "";
    personaSelector.disabled = !state?.activeChatId;
    personaInstructions.disabled = !persona?.id;
    if (document.activeElement !== personaInstructions || pendingPersonaGuidance?.personaId !== persona?.id) {
      personaInstructions.value = persona?.id ? cfg.personaOverrides?.[persona.id] || "" : "";
    }
  }
  const unsubBackend = ctx.onBackendMessage((payload) => {
    if (!payload || typeof payload !== "object")
      return;
    if (payload.type === "state")
      applyState(payload);
    else if (payload.type === "openrouter_models") {
      openRouterCatalogPending = false;
      openRouterCatalogError = "";
      openRouterModels = Array.isArray(payload.models) ? payload.models : [];
      openRouterFetchedAt = Number(payload.fetchedAt || Date.now());
      updateModelPickers();
    } else if (payload.type === "openrouter_models_error") {
      openRouterCatalogPending = false;
      openRouterCatalogError = String(payload.error || "Could not load OpenRouter models. Manual model IDs still work.");
      updateModelPickers();
    } else if (payload.type === "manual_target") {
      if (manualPending) {
        manualTarget = { chatId: String(payload.chatId || ""), messageId: String(payload.messageId || "") };
        manualRun.textContent = "Making paths…";
        manualStatus.classList.remove("error");
        manualStatus.textContent = payload.oocOverride ? "Making paths for an OOC message…" : "Making paths…";
      }
    } else if (payload.type === "choices_loading") {
      selectedPathIntents = [];
      renderLoading(String(payload.messageId), String(payload.chatId));
      if (matchesManualTarget(payload.chatId, payload.messageId))
        manualRun.textContent = "Making paths…";
    } else if (payload.type === "choices_ready" && payload.data) {
      renderChoices(payload.data);
      if (matchesManualTarget(payload.data.chatId, payload.data.messageId))
        finishManualGeneration("success", "New paths are ready under the latest reply.");
    } else if (payload.type === "choices_skipped") {
      const messageId = String(payload.messageId || "");
      if (messageId)
        removeCard(messageId);
      if (matchesManualTarget(payload.chatId, payload.messageId)) {
        finishManualGeneration("error", payload.reason === "ooc" ? "Skipped: the latest reply is part of an OOC exchange." : "Persona Paths skipped this reply.");
      }
    } else if (payload.type === "choices_error") {
      renderError(String(payload.messageId), String(payload.chatId), String(payload.error || "Unknown error"));
      if (matchesManualTarget(payload.chatId, payload.messageId))
        finishManualGeneration("error", String(payload.error || "Manual Persona Paths generation failed."));
    } else if (payload.type === "manual_error") {
      if (manualPending)
        finishManualGeneration("error", String(payload.error || "Manual Persona Paths generation failed."));
    } else if (payload.type === "writer_anchor") {
      const chatId = String(payload.chatId || "");
      const messageId = String(payload.messageId || "");
      if (chatId && messageId)
        openWriterModal(chatId, messageId);
    } else if (payload.type === "draft_rewrite_ready") {
      finishWriterSuccess(String(payload.text || ""), String(payload.writerMode || "rewrite"));
    } else if (payload.type === "draft_rewrite_error") {
      const message = String(payload.error || "User Writer failed.");
      console.error("[Persona Paths] User Writer failed:", message);
      finishWriterError(message);
    } else if (payload.type === "request_error") {
      connectionStatus.classList.add("error");
      connectionStatus.textContent = String(payload.error || "Persona Paths backend request failed.");
    } else if (payload.type === "persona_selection_changed") {
      selectedPathIntents = [];
      writerHistory = [];
      writerHistoryIndex = -1;
      if (writerModal) {
        try {
          writerModal.dismiss();
        } catch {}
        writerModal = null;
      }
      clearNonActiveWidgets();
      for (const id of Array.from(cards.keys()))
        removeCard(id);
      cards.clear();
      widgetSignatures.clear();
      dataByMessage.clear();
      activePathMessageId = null;
    } else if (payload.type === "persona_guidance_saved") {
      const personaId = String(payload.personaId || "");
      const text = String(payload.text || "");
      if (personaId) {
        if (currentState?.config?.personaOverrides)
          currentState.config.personaOverrides[personaId] = text;
        if (currentState?.activePersona?.id === personaId)
          personaInstructions.value = text;
      }
    } else if (payload.type === "memory_cleared") {
      clearMemory.textContent = "Cleared";
      setTimeout(() => {
        clearMemory.textContent = "Clear these notes";
      }, 1200);
    }
  });
  let unsubRendered = () => {};
  let unsubGenerationStarted = () => {};
  let unsubGenerationEnded = () => {};
  let unsubGenerationStopped = () => {};
  let unsubSwipe = () => {};
  let unsubChatSwitch = () => {};
  try {
    unsubRendered = ctx.events.on("CHARACTER_MESSAGE_RENDERED", (payload) => {
      const id = String(payload?.messageId || "");
      const chatId = String(payload?.chatId || "");
      if (!id)
        return;
      const isAwaited = awaitingRender.has(id);
      if (isAwaited || id === latestHostMessageId()) {
        renderedMessages.clear();
        renderedMessages.add(id);
      }
      const pendingChatId = awaitingRender.get(id) || chatId;
      if (pendingChatId && isAwaited)
        scheduleSettledGeneration(pendingChatId, id);
    });
  } catch (err) {
    console.warn("[Persona Paths] CHARACTER_MESSAGE_RENDERED subscription failed", err);
  }
  try {
    unsubGenerationStarted = ctx.events.on("GENERATION_STARTED", (payload) => {
      const chatId = String(payload?.chatId || "");
      const targetMessageId = String(payload?.targetMessageId || "");
      if (chatId)
        cancelChatTimers(chatId);
      clearNonActiveWidgets();
      dataByMessage.clear();
      if (targetMessageId)
        renderedMessages.delete(targetMessageId);
    });
  } catch (err) {
    console.warn("[Persona Paths] GENERATION_STARTED subscription failed", err);
  }
  try {
    unsubGenerationEnded = ctx.events.on("GENERATION_ENDED", (payload) => {
      if (payload?.error)
        return;
      const chatId = String(payload?.chatId || "");
      const messageId = String(payload?.messageId || "");
      if (!chatId || !messageId)
        return;
      waitForRenderThenGenerate(chatId, messageId);
    });
  } catch (err) {
    console.warn("[Persona Paths] GENERATION_ENDED subscription failed", err);
  }
  try {
    unsubGenerationStopped = ctx.events.on("GENERATION_STOPPED", (payload) => {
      const chatId = String(payload?.chatId || "");
      if (chatId)
        cancelChatTimers(chatId);
    });
  } catch (err) {
    console.warn("[Persona Paths] GENERATION_STOPPED subscription failed", err);
  }
  try {
    unsubSwipe = ctx.events.on("MESSAGE_SWIPED", (payload) => {
      if (!payload?.chatId || !payload?.message?.id || payload?.message?.role !== "assistant")
        return;
      if (payload.action === "navigated" || payload.action === "updated" || payload.action === "added") {
        const chatId = String(payload.chatId);
        const messageId = String(payload.message.id);
        cancelChoiceTimer(messageId);
        removeCard(messageId);
        renderedMessages.delete(messageId);
        waitForRenderThenGenerate(chatId, messageId);
      }
    });
  } catch (err) {
    console.warn("[Persona Paths] MESSAGE_SWIPED subscription failed", err);
  }
  try {
    unsubChatSwitch = ctx.events.on("CHAT_SWITCHED", () => {
      flushPersonaGuidance();
      personaSelector.disabled = true;
      personaInstructions.disabled = true;
      if (guidanceModal) {
        try {
          guidanceModal.dismiss();
        } catch {}
        guidanceModal = null;
      }
      if (writerModal) {
        try {
          writerModal.dismiss();
        } catch {}
        writerModal = null;
      }
      writerPending = false;
      writerAnchor = null;
      writerHistory = [];
      writerHistoryIndex = -1;
      selectedPathIntents = [];
      for (const messageId of Array.from(choiceTimers.keys()))
        cancelChoiceTimer(messageId);
      for (const messageId of Array.from(renderFallbackTimers.keys()))
        cancelChoiceTimer(messageId);
      awaitingRender.clear();
      renderedMessages.clear();
      clearNonActiveWidgets();
      cards.clear();
      widgetSignatures.clear();
      dataByMessage.clear();
      activePathMessageId = null;
      setTimeout(() => {
        const latestId = latestHostMessageId();
        if (latestId)
          ctx.sendToBackend({ type: "load_choices", messageId: latestId });
        ctx.sendToBackend({ type: "get_state" });
      }, 80);
    });
  } catch (err) {
    console.warn("[Persona Paths] CHAT_SWITCHED subscription failed", err);
  }
  ctx.sendToBackend({ type: "get_state" });
  const initialLatestId = latestHostMessageId();
  if (initialLatestId)
    ctx.sendToBackend({ type: "load_choices", messageId: initialLatestId });
  return () => {
    flushPersonaGuidance();
    if (saveTimer)
      clearTimeout(saveTimer);
    if (launcherStatusTimer)
      clearTimeout(launcherStatusTimer);
    stopResetWatch();
    window.removeEventListener("resize", repositionLauncher);
    try {
      floatLauncher?.root?.removeEventListener("contextmenu", watchNativeReset, true);
    } catch {}
    try {
      unsubLauncherDrag();
    } catch {}
    if (guidanceModal) {
      try {
        guidanceModal.dismiss();
      } catch {}
      guidanceModal = null;
    }
    if (writerModal) {
      try {
        writerModal.dismiss();
      } catch {}
      writerModal = null;
    }
    unsubBackend();
    for (const messageId of Array.from(choiceTimers.keys()))
      cancelChoiceTimer(messageId);
    for (const messageId of Array.from(renderFallbackTimers.keys()))
      cancelChoiceTimer(messageId);
    unsubRendered();
    unsubGenerationStarted();
    unsubGenerationEnded();
    unsubGenerationStopped();
    unsubSwipe();
    unsubChatSwitch();
    try {
      unsubOpenAction();
    } catch {}
    try {
      openAction?.destroy?.();
    } catch {}
    try {
      unsubManualAction();
    } catch {}
    try {
      manualAction?.destroy?.();
    } catch {}
    try {
      unsubPolishAction();
    } catch {}
    try {
      polishAction?.destroy?.();
    } catch {}
    try {
      connectionPicker?.destroy?.();
    } catch {}
    try {
      modelPicker?.destroy?.();
    } catch {}
    try {
      writerConnectionPicker?.destroy?.();
    } catch {}
    try {
      writerModelPicker?.destroy?.();
    } catch {}
    try {
      floatLauncher?.destroy?.();
    } catch {}
    for (const cleanup of cards.values()) {
      try {
        cleanup();
      } catch {}
    }
    cards.clear();
    widgetSignatures.clear();
    dataByMessage.clear();
    activePathMessageId = null;
    removeStyle();
    tab.destroy();
    ctx.dom.cleanup();
  };
}
export {
  setup
};

// The countdown button, notices and toasts, drawn over the video.
// Lives in a closed shadow root so Crunchyroll's CSS can't touch it (and our
// own button never looks like a native skip button to page.js).
(function (root) {
  const ICONS = {
    skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5.2v13.6a.8.8 0 0 0 1.24.66L17 12.66a.8.8 0 0 0 0-1.32L7.24 4.54A.8.8 0 0 0 6 5.2Z" fill="currentColor"/><rect x="17.5" y="4.5" width="2.5" height="15" rx="1.25" fill="currentColor"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.2v11.6a.8.8 0 0 0 1.25.66L12 13v4.8a.8.8 0 0 0 1.25.66l8.2-5.8a.8.8 0 0 0 0-1.32l-8.2-5.8A.8.8 0 0 0 12 6.2V11L4.25 5.54A.8.8 0 0 0 3 6.2Z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  };

  const FONT_FAMILY = "CRAS Figtree";

  // Shadow roots can't declare @font-face, so register the bundled font on the
  // page once, under a name nothing else uses.
  function registerFont() {
    if (document.getElementById("cras-font")) return;
    try {
      const url = chrome.runtime.getURL("fonts/figtree-latin.woff2");
      const style = document.createElement("style");
      style.id = "cras-font";
      style.textContent = `@font-face{font-family:"${FONT_FAMILY}";src:url("${url}") format("woff2");font-weight:400 600;font-display:swap}`;
      (document.head || document.documentElement).appendChild(style);
    } catch {
      /* fall back to the page font */
    }
  }

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .layer {
      position: fixed; left: 0; top: 0; width: 0; height: 0;
      pointer-events: none;
      font-family: "${FONT_FAMILY}", "Lato", "Segoe UI", system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
      --accent: #f47521;
      --accent-ink: #1a0b02;
      --text: #eeeff3;
      --text-2: #b4b5be;
      --surface: rgba(17, 18, 21, 0.86);
      --hair: rgba(238, 239, 243, 0.16);
      --ease: cubic-bezier(0.22, 1, 0.36, 1);
      --size: 16px;
      font-size: var(--size);
    }
    .dock { position: fixed; display: flex; align-items: center; gap: 0.5em; pointer-events: none; }
    button { font: inherit; color: inherit; margin: 0; }

    /* ---- countdown button ------------------------------------------------
       Two copies of the label: light on the dark base, dark on the orange
       fill. The fill reveals with clip-path, so the text stays readable on
       both sides of the moving edge. */
    .skip {
      position: relative; display: inline-grid;
      padding: 0; border: 0; border-radius: 0.375em;
      background: var(--surface);
      box-shadow: inset 0 0 0 1px var(--hair), 0 0.5em 1.5em rgba(0, 0, 0, 0.35);
      cursor: pointer; pointer-events: auto;
      overflow: hidden;
      transition: transform 140ms var(--ease), box-shadow 140ms var(--ease);
      --p: 0;
    }
    .skip:hover { box-shadow: inset 0 0 0 1px rgba(238, 239, 243, 0.5), 0 0.5em 1.5em rgba(0, 0, 0, 0.35); }
    .skip:active { transform: scale(0.97); }
    .face {
      grid-area: 1 / 1;
      display: inline-flex; align-items: center; gap: 0.4em;
      padding: 0.55em 0.9em 0.55em 0.75em;
      font-weight: 600; line-height: 1; white-space: nowrap;
      color: var(--text);
    }
    .face.fill {
      background: var(--accent); color: var(--accent-ink);
      clip-path: inset(0 calc((1 - var(--p)) * 100%) 0 0);
    }
    .paused .face.fill { background: #b9662f; }
    .face svg { width: 0.95em; height: 0.95em; flex: none; }

    .cancel {
      display: inline-grid; place-items: center;
      width: 2.1em; height: 2.1em; padding: 0;
      border: 0; border-radius: 50%;
      color: var(--text-2); background: var(--surface);
      box-shadow: inset 0 0 0 1px var(--hair), 0 0.5em 1.5em rgba(0, 0, 0, 0.35);
      cursor: pointer; pointer-events: auto;
      transition: color 140ms var(--ease), box-shadow 140ms var(--ease), transform 140ms var(--ease);
    }
    .cancel:hover { color: var(--text); box-shadow: inset 0 0 0 1px rgba(238, 239, 243, 0.5), 0 0.5em 1.5em rgba(0, 0, 0, 0.35); }
    .cancel:active { transform: scale(0.94); }
    .cancel svg { width: 0.8em; height: 0.8em; }
    .skip:focus-visible, .cancel:focus-visible, .action:focus-visible {
      outline: 2px solid var(--accent); outline-offset: 3px;
    }

    /* ---- notice (binge limit, sleep timer) ------------------------------- */
    .notice {
      pointer-events: auto;
      width: 19em;
      padding: 1em;
      color: var(--text);
      background: rgba(24, 25, 29, 0.96);
      border-radius: 0.75em;
      box-shadow: inset 0 0 0 1px var(--hair), 0 0.75em 2em rgba(0, 0, 0, 0.45);
    }
    .notice h2 { margin: 0; font-size: 1em; line-height: 1.25; font-weight: 600; }
    .notice p { margin: 0.25em 0 0; font-size: 0.8125em; line-height: 1.45; color: var(--text-2); }
    .actions { display: flex; gap: 0.5em; margin-top: 1em; }
    .action {
      height: 2.25em; padding: 0 1em;
      font-size: 0.8125em; font-weight: 600;
      color: var(--text); background: rgba(238, 239, 243, 0.08);
      border: 0; border-radius: 0.5em; cursor: pointer;
      transition: background-color 140ms var(--ease), transform 140ms var(--ease);
    }
    .action:hover { background: rgba(238, 239, 243, 0.14); }
    .action:active { transform: scale(0.97); }
    .action.primary { background: var(--accent); color: var(--accent-ink); }
    .action.primary:hover { background: #ff8533; }

    /* ---- toast ------------------------------------------------------------- */
    .toast {
      display: inline-flex; align-items: center; gap: 0.5em;
      padding: 0.5em 0.85em;
      font-size: 0.8125em; font-weight: 600;
      color: var(--text); background: var(--surface);
      border-radius: 0.5em;
      box-shadow: inset 0 0 0 1px var(--hair);
    }
    .toast::before { content: ""; width: 0.5em; height: 0.5em; border-radius: 50%; background: var(--text-2); }
    .toast.on::before { background: var(--accent); }

    /* ---- seek bar markers ---------------------------------------------------
       Drawn over the player's own progress bar; never takes clicks. */
    .marks { position: fixed; pointer-events: none; transition: opacity 200ms var(--ease); }
    .marks i {
      position: absolute; top: 0; bottom: 0; min-width: 3px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
    }

    .enter { animation: enter 240ms var(--ease) both; }
    @keyframes enter { from { opacity: 0; transform: translateY(8px); } }
    .leave { animation: leave 160ms var(--ease) both; }
    @keyframes leave { to { opacity: 0; transform: translateY(4px); } }
    @media (prefers-reduced-motion: reduce) {
      .enter, .leave { animation-duration: 1ms; }
      .skip, .cancel, .action { transition: none; }
    }
    [hidden] { display: none !important; }
  `;

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function createOverlay(handlers) {
    registerFont();
    const host = document.createElement("cras-overlay");
    host.style.cssText = "all: initial; position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 2147483647;";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CSS;
    const layer = el("div", "layer");
    shadow.append(style, layer);

    // Bottom-right: the countdown button (or a notice).
    const br = el("div", "dock");
    const skip = el("button", "skip");
    skip.type = "button";
    const base = el("span", "face");
    const fill = el("span", "face fill");
    fill.setAttribute("aria-hidden", "true");
    skip.append(base, fill);
    const cancel = el("button", "cancel", ICONS.close);
    cancel.type = "button";
    cancel.setAttribute("aria-label", "Cancel auto-skip");
    cancel.title = "Cancel (Esc)";
    const countdown = el("div", "dock-row");
    countdown.style.cssText = "display:flex;align-items:center;gap:0.4em";
    countdown.append(skip, cancel);
    countdown.hidden = true;
    const notice = el("div", "notice");
    notice.setAttribute("role", "dialog");
    notice.hidden = true;
    br.append(countdown, notice);

    // Top-right: transient toasts.
    const tr = el("div", "dock");
    const toast = el("div", "toast");
    toast.setAttribute("role", "status");
    toast.hidden = true;
    tr.append(toast);
    const marks = el("div", "marks");
    marks.hidden = true;
    layer.append(marks, br, tr);

    // Keep clicks on the overlay from reaching the player (which would pause).
    for (const evt of ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "dblclick"]) {
      shadow.addEventListener(evt, (e) => e.stopPropagation());
    }
    skip.addEventListener("click", () => handlers.onSkipNow && handlers.onSkipNow());
    cancel.addEventListener("click", () => handlers.onCancel && handlers.onCancel());

    let video = null;
    let raf = 0;
    let toastTimer = 0;
    let face = { text: "", kind: "skip", paused: false };
    // Seek bar markers: [{ start, end }] in seconds, drawn over `seekEl`.
    let markList = [];
    let markSig = "";
    let markDur = 0;
    let seekEl = null;
    let seekOpacity = 0;

    function markersActive() {
      return !!(seekEl && seekEl.isConnected && markList.length && markDur > 0 && seekOpacity > 0);
    }

    function drawMarks() {
      marks.replaceChildren();
      for (const m of markList) {
        const i = document.createElement("i");
        const a = Math.max(0, Math.min(1, m.start / markDur));
        const b = Math.max(0, Math.min(1, m.end / markDur));
        i.style.left = `${a * 100}%`;
        i.style.width = `${Math.max(0, b - a) * 100}%`;
        marks.append(i);
      }
    }

    function placeMarks() {
      if (!markersActive()) {
        marks.hidden = true;
        return;
      }
      const r = seekEl.getBoundingClientRect();
      const h = Math.max(3, Math.min(5, Math.round(r.height)));
      marks.hidden = false;
      marks.style.left = `${r.left}px`;
      marks.style.width = `${r.width}px`;
      marks.style.top = `${r.top + r.height / 2 - h / 2}px`;
      marks.style.height = `${h}px`;
      marks.style.opacity = String(seekOpacity);
    }

    function drawFace() {
      const icon = face.paused ? ICONS.pause : face.kind === "next" ? ICONS.next : ICONS.skip;
      for (const f of [base, fill]) {
        f.innerHTML = icon;
        const label = document.createElement("span");
        label.textContent = face.text;
        f.append(label);
      }
    }

    function mount() {
      // In fullscreen only descendants of the fullscreen element are visible.
      const fs = document.fullscreenElement || document.webkitFullscreenElement;
      const parent = fs && fs.tagName !== "VIDEO" ? fs : document.body || document.documentElement;
      if (host.parentNode !== parent) parent.appendChild(host);
    }

    function anyVisible() {
      return !countdown.hidden || !notice.hidden || !toast.hidden || markersActive();
    }

    function place() {
      raf = 0;
      placeMarks();
      if (!anyVisible()) return;
      mount();
      let rect;
      if (video && video.isConnected) rect = video.getBoundingClientRect();
      if (!rect || rect.width < 50 || rect.height < 50) {
        rect = { left: 0, top: 0, right: innerWidth, bottom: innerHeight, width: innerWidth, height: innerHeight };
      }
      // Scale with the player like Netflix does: bigger in fullscreen.
      const size = Math.round(Math.min(20, Math.max(14, rect.width / 68)));
      layer.style.setProperty("--size", `${size}px`);
      br.style.right = `${Math.max(8, innerWidth - rect.right + rect.width * 0.035)}px`;
      br.style.bottom = `${Math.max(8, innerHeight - rect.bottom + rect.height * 0.14)}px`;
      tr.style.right = `${Math.max(8, innerWidth - rect.right + rect.width * 0.03)}px`;
      tr.style.top = `${Math.max(8, rect.top + rect.height * 0.05)}px`;
      raf = requestAnimationFrame(place);
    }

    function hideToast() {
      clearTimeout(toastTimer);
      if (toast.hidden) return;
      toast.classList.add("leave");
      toastTimer = setTimeout(() => (toast.hidden = true), 160);
    }

    function schedule() {
      if (!raf) raf = requestAnimationFrame(place);
    }

    function animateIn(node) {
      node.classList.remove("leave", "enter");
      void node.offsetWidth;
      node.classList.add("enter");
    }

    document.addEventListener("fullscreenchange", () => {
      mount();
      schedule();
    });

    return {
      setVideo(v) {
        video = v;
      },
      showCountdown({ text, kind }) {
        face = { text, kind, paused: false };
        drawFace();
        skip.title = `${text} now (Enter)`;
        skip.classList.remove("paused");
        skip.style.setProperty("--p", "0");
        notice.hidden = true;
        countdown.hidden = false;
        animateIn(countdown);
        mount();
        schedule();
      },
      setProgress(p, paused) {
        skip.style.setProperty("--p", String(Math.max(0, Math.min(1, p))));
        if (!!paused !== face.paused) {
          face.paused = !!paused;
          skip.classList.toggle("paused", face.paused);
          drawFace();
        }
      },
      hideCountdown() {
        countdown.hidden = true;
      },
      isCountdownVisible() {
        return !countdown.hidden;
      },
      // actions: [{ text, primary, onClick }]
      showNotice({ title, body, actions = [] }) {
        countdown.hidden = true;
        notice.replaceChildren();
        const h = el("h2");
        h.textContent = title;
        notice.append(h);
        if (body) {
          const p = el("p");
          p.textContent = body;
          notice.append(p);
        }
        if (actions.length) {
          const row = el("div", "actions");
          for (const a of actions) {
            const b = el("button", `action${a.primary ? " primary" : ""}`);
            b.type = "button";
            b.textContent = a.text;
            b.addEventListener("click", () => {
              notice.hidden = true;
              a.onClick && a.onClick();
            });
            row.append(b);
          }
          notice.append(row);
        }
        notice.hidden = false;
        animateIn(notice);
        mount();
        schedule();
      },
      hideNotice() {
        notice.hidden = true;
      },
      isNoticeVisible() {
        return !notice.hidden;
      },
      // [{ start, end }] in seconds; `duration` of the episode.
      setMarkers(list, duration) {
        const sig = `${duration}|${list.map((m) => `${m.start.toFixed(1)}-${m.end.toFixed(1)}`).join(",")}`;
        markList = list;
        markDur = duration;
        if (sig !== markSig) {
          markSig = sig;
          drawMarks();
        }
        schedule();
      },
      // The player's seek bar and how visible its controls are (0..1).
      setSeekBar(elem, opacity) {
        seekEl = elem;
        seekOpacity = elem ? opacity : 0;
        schedule();
      },
      // ms <= 0 keeps the toast up until hideToast().
      toast(text, ms = 1800, on = null) {
        toast.textContent = text;
        toast.classList.toggle("on", on === true);
        toast.hidden = false;
        animateIn(toast);
        mount();
        schedule();
        clearTimeout(toastTimer);
        if (ms > 0) toastTimer = setTimeout(hideToast, ms);
      },
      hideToast,
      host
    };
  }

  root.CRAS_overlay = { createOverlay };
})(typeof globalThis !== "undefined" ? globalThis : self);

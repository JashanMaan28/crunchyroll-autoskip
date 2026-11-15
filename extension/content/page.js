// Everything that reads Crunchyroll's DOM lives here, so when Crunchyroll
// changes its markup this is the one file to update.
(function (root) {
  const EPISODE_RE = /\/watch\/([A-Z0-9]{6,20})(?:[/?#]|$)/i;
  const SERIES_RE = /\/series\/([A-Z0-9]{6,20})(?:\/([^/?#]+))?/i;

  const NEXT_WORDS = /\b(?:next|up next)\b|suivant|siguiente|n[äa]chste|pr[óo]ximo|prossimo|следующ/i;
  const PREV_WORDS = /\bprev(?:ious)?\b|pr[ée]c[ée]dent|anterior|vorherige|precedente|предыдущ/i;
  const NEXT_PHRASE = /next episode|up next|épisode suivant|siguiente episodio|n[äa]chste (?:folge|episode)|pr[óo]ximo epis[óo]dio|prossimo episodio/i;
  const PREV_PHRASE = /previous episode|épisode précédent|episodio anterior|vorherige (?:folge|episode)|epis[óo]dio anterior|episodio precedente/i;
  const SKIP_WORDS = /(?:^|[^\p{L}\p{N}])(?:skip|überspringen|omitir|saltar|passer|ignorer|pular|salta)(?=$|[^\p{L}\p{N}])/iu;

  const SEGMENT_WORDS = {
    recap: /recap|zusammenfassung|résumé|resumen|recapitula/i,
    intro: /intro|opening|vorspann|générique de début|abertura/i,
    credits: /credits|outro|ending|abspann|générique|créditos|crediti/i,
    preview: /preview|vorschau|avance|aperçu|prévia|anteprima/i
  };

  function episodeIdFromUrl(url) {
    const m = String(url || "").match(EPISODE_RE);
    return m ? m[1].toUpperCase() : null;
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element) || !el.isConnected) return false;
    if (el.matches(":disabled") || el.closest('[aria-hidden="true"], [inert]')) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.pointerEvents !== "none";
  }

  // The player sometimes renders inside open shadow roots. Collect them, but
  // only re-crawl occasionally because walking every element is not free.
  let shadowRoots = [];
  let shadowScanAt = 0;
  function allRoots() {
    const now = Date.now();
    if (now - shadowScanAt > 5000) {
      shadowScanAt = now;
      const found = [];
      const walk = (r) => {
        for (const el of r.querySelectorAll("*")) {
          if (el.shadowRoot) {
            found.push(el.shadowRoot);
            walk(el.shadowRoot);
          }
        }
      };
      try {
        walk(document);
      } catch {
        /* ignore */
      }
      shadowRoots = found;
    }
    return [document, ...shadowRoots.filter((r) => r.host && r.host.isConnected)];
  }

  function queryAll(selector) {
    const out = [];
    for (const r of allRoots()) {
      try {
        out.push(...r.querySelectorAll(selector));
      } catch {
        /* invalid in this root */
      }
    }
    return out;
  }

  // The episode is the biggest <video> on the page (ads and previews are smaller).
  function getMainVideo() {
    const videos = queryAll("video");
    let best = null;
    let bestArea = -1;
    for (const v of videos) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) {
        best = v;
        bestArea = area;
      }
    }
    return best;
  }

  function describe(el) {
    const attrs = ["aria-label", "title", "data-testid", "data-t", "class"]
      .map((a) => (el.getAttribute && el.getAttribute(a)) || "")
      .join(" ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ");
    return `${el.textContent || ""} ${attrs}`.replace(/\s+/g, " ").trim();
  }

  function classifySkip(text) {
    for (const type of ["recap", "intro", "credits", "preview"]) {
      if (SEGMENT_WORDS[type].test(text)) return type;
    }
    return null;
  }

  // Crunchyroll's own "Skip Intro"/"Skip Credits" buttons. Used as a fallback
  // when an episode has no skip-events data, and hidden while our button shows.
  // Returns [{ el, type }].
  function findNativeSkipButtons(ownHost) {
    const sel = [
      "button",
      "[role='button']",
      "[data-testid*='skip' i]",
      "[class*='skip' i]",
      "[aria-label*='skip' i]"
    ].join(",");
    const found = [];
    const seen = new Set();
    for (const el of queryAll(sel)) {
      if (ownHost && (el === ownHost || ownHost.contains(el))) continue;
      // Collapse a wrapper and the button inside it into one entry.
      const target = el.closest("button, [role='button']") || el;
      if (seen.has(target)) continue;
      seen.add(target);
      if (!isVisible(target)) continue;
      const text = describe(target);
      if (!SKIP_WORDS.test(text)) continue;
      const type = classifySkip(text);
      if (type) found.push({ el: target, type });
    }
    return found;
  }

  // ---- Next episode -------------------------------------------------------

  const NEXT_BUTTON_SELECTORS = [
    '[data-testid="next-episode-button"]',
    '[data-testid="vilos-next_button"]',
    '[data-testid="vilos-nextepisode_button"]',
    'button[aria-label*="next episode" i]',
    '[role="button"][aria-label*="next episode" i]',
    'button[title*="next episode" i]'
  ];

  // Walk up from a /watch/ link to the largest ancestor that contains only
  // links to that same episode: that ancestor is the episode "card".
  function cardFor(link, id) {
    let card = link;
    let el = link.parentElement;
    for (let depth = 0; el && depth < 6; depth++, el = el.parentElement) {
      const ids = new Set(
        [...el.querySelectorAll('a[href*="/watch/"]')].map((a) => episodeIdFromUrl(a.getAttribute("href")))
      );
      if (ids.size > 1 || !ids.has(id)) break;
      card = el;
    }
    return card;
  }

  function scoreNextLink(link, id) {
    const card = cardFor(link, id);
    let score = 0;
    // Label right above the card, e.g. <h3>Next Episode</h3><a .../>. Short
    // labels only, so a whole episode list's heading doesn't count.
    const prev = card.previousElementSibling;
    const label = prev && (prev.textContent || "").length < 60 ? describe(prev) : "";
    // Card text includes the episode title, so require a full phrase there
    // ("The Next Day" must not look like a next-episode card).
    const cardText = describe(card);
    for (let el = link; el && el !== card.parentElement; el = el.parentElement) {
      const attrs = ["data-t", "class", "data-testid", "aria-label"].map((a) => el.getAttribute(a) || "").join(" ");
      if (/next|up-?next/i.test(attrs) && !/prev/i.test(attrs)) score += 3;
    }
    if (NEXT_PHRASE.test(cardText) || NEXT_WORDS.test(label)) score += 2;
    if (PREV_WORDS.test(label) || PREV_PHRASE.test(cardText)) score -= 4;
    if (link.closest("header, nav, footer, [role='navigation']")) score -= 5;
    return score;
  }

  // Returns { el, href?, via } or null. `currentId` is the episode now playing.
  function findNextEpisode(currentId) {
    for (const sel of NEXT_BUTTON_SELECTORS) {
      const el = queryAll(sel).find(isVisible);
      if (el) return { el, via: "player-button" };
    }
    let best = null;
    let bestScore = 0;
    for (const a of document.querySelectorAll('a[href*="/watch/"]')) {
      const id = episodeIdFromUrl(a.getAttribute("href"));
      if (!id || id === currentId) continue;
      const score = scoreNextLink(a, id);
      if (score > bestScore) {
        best = a;
        bestScore = score;
      }
    }
    if (best && bestScore >= 2) return { el: best, href: best.href, via: "page-link" };
    return null;
  }

  // ---- Series (for per-show exceptions) ------------------------------------

  function prettifySlug(slug) {
    return decodeURIComponent(slug || "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  }

  function getSeries() {
    const preferred = [
      "a.show-title-link",
      '[data-t="show-title-link"]',
      '[data-t*="show-title" i] a[href*="/series/"]',
      '[class*="show-title" i] a[href*="/series/"]',
      'a[class*="show-title" i]'
    ];
    let link = null;
    for (const sel of preferred) {
      link = document.querySelector(sel);
      if (link && SERIES_RE.test(link.getAttribute("href") || "")) break;
      link = null;
    }
    if (!link) {
      link = [...document.querySelectorAll('a[href*="/series/"]')].find(
        (a) => !a.closest("header, nav, footer, [role='navigation']") && SERIES_RE.test(a.getAttribute("href"))
      );
    }
    if (!link) return null;
    const m = link.getAttribute("href").match(SERIES_RE);
    const title = (link.textContent || "").replace(/\s+/g, " ").trim() || prettifySlug(m[2]) || m[1];
    return { id: m[1].toUpperCase(), title };
  }

  // The watch page's <h1> holds the episode title, e.g. "E12 - The Hero's Party".
  function getEpisodeTitle() {
    const h = document.querySelector("h1");
    const text = h ? (h.textContent || "").replace(/\s+/g, " ").trim() : "";
    return text && text.length <= 120 ? text : "";
  }

  // "E1 - Cruelty" -> 1. Falls back to "Episode 1" in the tab title.
  function getEpisodeNumber() {
    const m =
      getEpisodeTitle().match(/^(?:S\d+\s*)?E(\d+)\b/i) || String(document.title || "").match(/\bEpisode\s+(\d+)\b/i);
    return m ? Number(m[1]) : null;
  }

  // Best effort: "Season 2" / "S2 E3" near the title or in the tab title.
  // null when the page doesn't say, which is fine (episode 1 still counts).
  function getSeason() {
    const texts = [getEpisodeTitle(), document.title];
    for (const el of [...document.querySelectorAll('[data-t*="season" i], [class*="season-title" i]')].slice(0, 10)) {
      texts.push(el.textContent);
    }
    for (const text of texts) {
      const m = String(text || "").match(/\bseason\s*(\d+)\b|\bS(\d+)\s*E\d+/i);
      if (m) return `S${m[1] || m[2]}`;
    }
    return null;
  }

  // ---- Seek bar ---------------------------------------------------------------

  const SEEK_SELECTORS = [
    '[data-testid*="scrub" i]',
    '[data-testid*="seek" i]',
    '[data-testid*="progress" i]',
    '[role="slider"]',
    'input[type="range"]',
    '[class*="scrub" i]',
    '[class*="seek" i]',
    '[class*="progress" i]'
  ].join(",");

  // The player's progress bar: a wide, short slider along the bottom of the
  // video. Returns the element or null.
  function findSeekBar(video) {
    if (!video) return null;
    const vr = video.getBoundingClientRect();
    if (vr.width < 200) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const el of queryAll(SEEK_SELECTORS)) {
      const r = el.getBoundingClientRect();
      if (r.width < vr.width * 0.4 || r.height < 2 || r.height > 48) continue;
      if (r.left < vr.left - 4 || r.right > vr.right + 4) continue;
      if (r.top < vr.top + vr.height * 0.55 || r.bottom > vr.bottom + 80) continue;
      const label = ["aria-label", "data-testid", "class"].map((a) => el.getAttribute(a) || "").join(" ");
      if (/volume|buffer/i.test(label)) continue;
      let score = (r.width / vr.width) * 10;
      if (el.getAttribute("role") === "slider" || el.matches('input[type="range"]')) score += 3;
      const max = Number(el.getAttribute("aria-valuemax") || el.getAttribute("max"));
      if (video.duration > 0 && Math.abs(max - video.duration) < 3) score += 6;
      if (/scrub|seek/i.test(label)) score += 2;
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  }

  // How visible an element really is, counting faded-out ancestors (the
  // player hides its controls by fading them).
  function effectiveOpacity(el) {
    let o = 1;
    for (let e = el, depth = 0; e && e.nodeType === 1 && depth < 25; depth++) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden") return 0;
      o *= Number(cs.opacity) || 0;
      if (o < 0.05) return 0;
      e = e.parentElement || (e.getRootNode && e.getRootNode().host) || null;
    }
    return o;
  }

  root.CRAS_page = {
    episodeIdFromUrl,
    getEpisodeTitle,
    getEpisodeNumber,
    getSeason,
    findSeekBar,
    effectiveOpacity,
    isVisible,
    getMainVideo,
    findNativeSkipButtons,
    findNextEpisode,
    getSeries,
    _test: { classifySkip, scoreNextLink, describe }
  };
})(typeof globalThis !== "undefined" ? globalThis : self);

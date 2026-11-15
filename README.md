<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <img src="assets/logo-light.svg" height="64" alt="Autoskip">
</picture>

# Autoskip for Crunchyroll

A Chrome/Edge extension that adds Netflix-style auto-skip to crunchyroll.com. When an intro, recap, the credits or a preview starts, a **Skip** button appears and fills up over 3 seconds. When it's full, the extension skips. Click the button to skip right away, or press ✕ / Esc to watch that part.

Created in [T3 Code](https://t3.codes).

## Install

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick the `extension/` folder.
4. Pin the orange icon so you can reach the settings.

After you change any file, press the reload ↻ button on the extension card and refresh the Crunchyroll tab.

## What it does

| Part | Behavior |
| --- | --- |
| Intro / recap | Countdown, then jumps to the end of the segment |
| End credits (smart) | If footage follows the credits (a post-credits scene, at least 10s), it skips the credits and lets that play, then goes to the next episode at the end. Otherwise it goes straight to the next episode. |
| Next-episode preview | Goes to the next episode (or just skips the preview if "Smart next episode" is off) |
| Pausing | Freezes the countdown. It picks up again when you press play. |
| Seeking back | Re-arms the skip, so rewatching the OP brings the button back |

**Extras:**
- **Per-show exceptions:** open an episode, click the icon, and switch a part from **Skip** to **Watch** on the episode timeline. It sticks for every episode of that show.
- **Binge limit:** after N auto-played episodes in a row, it pauses and asks "Still watching?". Picking an episode yourself resets the count.
- **Sleep timer:** pause after 15m / 30m / 1h, or at the end of the current episode.
- **Time saved:** today's and all-time totals in the popup.
- **Keys:** `Esc` cancels the countdown, `Enter` skips now, `Alt+Shift+S` turns auto-skip on/off. You can rebind the toggle at `chrome://extensions/shortcuts`.

## How it works

- **Timestamps:** Crunchyroll publishes per-episode skip timestamps at `https://static.crunchyroll.com/skip-events/production/<episodeId>.json`. The background worker fetches and caches them, and the extension only ever reads that public file.
- **No timestamps:** when an episode has no data, it falls back to Crunchyroll's own "Skip Intro"/"Skip Credits" button. It hides that button, shows the countdown, then clicks it.
- **Next episode:** it uses the player's next button or the "Next Episode" link on the watch page. If it finds neither, it jumps to the end and Crunchyroll's own autoplay takes over.

```
extension/
  manifest.json
  background.js          skip-events fetch + cache, stats, hotkey
  shared/defaults.js     settings schema + helpers
  content/planner.js     pure decision logic (unit-tested)
  content/page.js        everything that reads Crunchyroll's DOM
  content/overlay.js     the countdown button / notices (shadow DOM)
  content/content.js     controller
  popup/                 settings popup
test/planner.test.js
```

If Crunchyroll changes its page layout, `content/page.js` is the file to update. Open DevTools on a watch page and filter the console for `CR Autoskip`, with the **Verbose** log level enabled, to see what it detected.

The popup and overlay use the bundled [Figtree](https://github.com/erikdkennedy/figtree) font (SIL Open Font License, see `extension/fonts/OFL-Figtree.txt`).

## Tests

```
npm test
```

## Limitations

- Works in the desktop browser only. The Crunchyroll phone, TV and console apps can't run extensions.
- Some episodes, especially brand-new simulcasts, don't have timestamps yet. In that case the extension can only react to Crunchyroll's own skip button.
- In fullscreen, `Esc` cancels the skip and also exits fullscreen. Chrome doesn't let pages block that.

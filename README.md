<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <img src="assets/logo-light.svg" height="64" alt="Autoskip">
</picture>

# Autoskip for Crunchyroll

[![CI](https://github.com/JashanMaan28/crunchyroll-autoskip/actions/workflows/ci.yml/badge.svg)](https://github.com/JashanMaan28/crunchyroll-autoskip/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/JashanMaan28/crunchyroll-autoskip)](https://github.com/JashanMaan28/crunchyroll-autoskip/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A Chrome, Edge and Firefox extension that adds Netflix-style auto-skip to crunchyroll.com. When an intro, recap, the credits or a preview starts, a **Skip** button appears and fills up over 3 seconds. When it's full, the extension skips. Click the button to skip right away, or press ✕ / Esc to watch that part.

Created in [T3 Code](https://t3.codes).

## Install

Download the zip for your browser from the [latest release](https://github.com/JashanMaan28/crunchyroll-autoskip/releases/latest).

**Chrome / Edge**

1. Unzip `crunchyroll-autoskip-chrome-<version>.zip`.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped folder.
4. Pin the orange icon so you can reach the settings.

**Firefox** (128 or newer)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `crunchyroll-autoskip-firefox-<version>.zip`.

Firefox removes temporary add-ons when it restarts. To keep it installed, either submit the zip to [addons.mozilla.org](https://addons.mozilla.org/developers/) as an unlisted add-on (Mozilla signs it, free), or use Firefox Developer Edition with `xpinstall.signatures.required` set to `false` in `about:config` and install the zip from `about:addons`.

## What it does

| Part | Behavior |
| --- | --- |
| Intro / recap | Countdown, then jumps to the end of the segment |
| End credits (smart) | If footage follows the credits (a post-credits scene, at least 10s), it skips the credits and lets that play, then goes to the next episode at the end. Otherwise it goes straight to the next episode. |
| Next-episode preview | Goes to the next episode (or just skips the preview if "Smart next episode" is off) |
| Pausing | Freezes the countdown. It picks up again when you press play. |
| Seeking back | Re-arms the skip, so rewatching the OP brings the button back |

**Extras:**
- **Your own skips:** skip anything Crunchyroll doesn't mark, like a post-credits scene, a recap inside the episode, or an eyecatch.
  - **Post-credits scenes:** open the popup during an episode and switch **After credits** to **Skip**. From then on, the credits go straight to the next episode for that show.
  - **While watching:** press `Alt+Shift+M` where the part starts and again where it ends.
  - **From the popup:** click **Mark a part to skip** and type the times (**Now** and **End** fill them in).
  - Marks apply to every episode of the show, positioned relative to the nearest known point (end of the credits, start of the preview, end of the episode), so they land in the same place on other episodes. Pick **This episode** for a one-off.
- **New openings play once:** the opening plays the first time you watch a show and on every episode 1 (plus a new season, when the page shows the season number), then gets skipped. You can turn this off.
- **Seek bar markers:** the parts that will be skipped are shaded on the player's progress bar.
- **Weekly recap:** time saved this week, a bar per day, and your top shows.
- **Per-show exceptions:** open an episode, click the icon, and switch a part from **Skip** to **Watch** on the episode timeline. It sticks for every episode of that show.
- **Binge limit:** after N auto-played episodes in a row, it pauses and asks "Still watching?". Picking an episode yourself resets the count.
- **Sleep timer:** pause after 15m / 30m / 1h, or at the end of the current episode.
- **Keys:** `Esc` cancels the countdown, `Enter` skips now, `Alt+Shift+S` turns auto-skip on/off, `Alt+Shift+M` marks a part to skip. You can rebind them at `chrome://extensions/shortcuts` (Firefox: `about:addons` → ⚙ → Manage Extension Shortcuts).

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
scripts/build.js         Chrome + Firefox packages
store/                   Chrome Web Store images
test/planner.test.js
```

If Crunchyroll changes its page layout, `content/page.js` is the file to update. That includes how the seek bar is found for the markers. Open DevTools on a watch page and filter the console for `CR Autoskip`, with the **Verbose** log level enabled, to see what it detected.

The popup and overlay use the bundled [Figtree](https://github.com/erikdkennedy/figtree) font (SIL Open Font License, see `extension/fonts/OFL-Figtree.txt`).

## Tests and builds

```
npm test        # unit tests
npm run build   # dist/chrome + dist/firefox, each with a zip
```

## Development

Working from a clone: load the `extension/` folder unpacked in Chrome, or run `npm run build` and load `dist/firefox/manifest.json` in Firefox. After you change a file, press the reload ↻ button on the extension card and refresh the Crunchyroll tab. See [CONTRIBUTING.md](CONTRIBUTING.md) for the layout of the code and how releases work, and [CHANGELOG.md](CHANGELOG.md) for what changed in each version.

## Limitations

- Works in the desktop browser only. The Crunchyroll phone, TV and console apps can't run extensions.
- Some episodes, especially brand-new simulcasts, don't have timestamps yet. In that case the extension can only react to Crunchyroll's own skip button.
- In fullscreen, `Esc` cancels the skip and also exits fullscreen. Chrome doesn't let pages block that.

## Privacy

No account, no tracking, no ads. Settings and stats stay in your browser, and the only request the extension makes is for the episode's skip timestamps. See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE). Crunchyroll is a trademark of its owner. This project isn't affiliated with or endorsed by Crunchyroll.

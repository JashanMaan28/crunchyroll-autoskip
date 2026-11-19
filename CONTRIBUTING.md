# Contributing

Thanks for helping out. Bug reports from the real Crunchyroll site are the most
useful thing you can send, since the extension depends on its page layout.

## Setup

You need Node.js 22.2 or newer. There are no dependencies to install.

```
npm test        # unit tests (node --test)
npm run build   # dist/chrome and dist/firefox, each with a zip
```

Load `extension/` unpacked in Chrome, or `dist/firefox/manifest.json` as a
temporary add-on in Firefox (see the README).

## Where things live

| Path | What it does |
| --- | --- |
| `extension/content/planner.js` | Pure decision logic. No DOM, fully unit-tested. |
| `extension/content/page.js` | Everything that reads Crunchyroll's DOM. Update this when the site changes. |
| `extension/content/overlay.js` | The countdown button, notices, toasts and seek bar markers (closed shadow DOM). |
| `extension/content/content.js` | The controller that ties it together. |
| `extension/background.js` | Skip-timestamp fetch and cache, stats, hotkeys. |
| `extension/popup/` | The settings popup. |
| `scripts/build.js` | Builds the Chrome and Firefox packages. |

## Debugging on the real site

Open DevTools on a watch page, enable the **Verbose** log level, and filter the
console for `CR Autoskip`. It logs the episode, the segments it found, the seek
bar it picked and every countdown.

## Pull requests

- Keep changes focused, and add or update tests in `test/` for logic changes.
- Run `npm test` and `npm run build` before opening the PR.
- Add a line under **Unreleased** in `CHANGELOG.md`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `chore:` and so on).

## Releasing

1. Move the **Unreleased** notes in `CHANGELOG.md` under a new version heading.
2. Bump `version` in both `extension/manifest.json` and `package.json`. A test
   checks that they match.
3. Commit, then tag and push: `git tag v1.2.0 && git push origin v1.2.0`.

The release workflow builds both packages and publishes a GitHub release with
the zips and the changelog notes.

4. Upload the Chrome zip from the release to the
   [Chrome Web Store dashboard](https://chrome.google.com/webstore/devconsole)
   (**Package → Upload new package**) and submit it for review. If the change
   adds a permission, a host or any new data handling, update
   [PRIVACY.md](PRIVACY.md) first, and the dashboard's privacy answers to match.

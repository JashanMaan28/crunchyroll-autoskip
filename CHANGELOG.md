# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.0] - 2026-11-14

### Added

- Custom skips. Mark any part of an episode to skip with `Alt+Shift+M` (once at
  the start, once at the end) or from the popup with **Mark a part to skip**.
  Marks apply to every episode of the show, placed relative to the nearest
  known point (end of the credits, start of the preview, end of the episode),
  or to a single episode.
- One-click **After credits → Skip** in the popup. The credits then go straight
  to the next episode instead of playing the post-credits scene.
- New openings play once: the opening plays the first time you watch a show
  and on every episode 1 (and on a new season when the page shows it), then is
  skipped. Can be turned off.
- Skip zones are shaded on the player's seek bar. Can be turned off.
- Weekly recap in the popup: time saved this week, a bar per day, and the top
  shows.
- Firefox support (128+). `npm run build` produces Chrome and Firefox packages
  in `dist/`.
- The per-show rules list now covers custom skips as well as exceptions.

### Changed

- The countdown button is slimmer, closer to Netflix's.
- A skip that ends right where a custom mark starts continues through it in
  one countdown.
- Stats now record which show and episode each skip came from.

## [1.0.0] - 2026-11-14

### Added

- Netflix-style countdown button that skips the intro, recap, credits and
  preview, using Crunchyroll's own skip timestamps, with a fallback to the
  player's skip buttons.
- Smart credits: plays a post-credits scene when there is one, otherwise goes
  straight to the next episode.
- Per-show exceptions, binge limit, sleep timer, time-saved stats and keyboard
  shortcuts.
- Settings popup with an episode timeline.

[Unreleased]: https://github.com/JashanMaan28/crunchyroll-autoskip/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/JashanMaan28/crunchyroll-autoskip/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/JashanMaan28/crunchyroll-autoskip/releases/tag/v1.0.0

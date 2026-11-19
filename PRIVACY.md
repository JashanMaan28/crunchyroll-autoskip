# Privacy policy

**Autoskip for Crunchyroll** (the "extension") · Effective 19 November 2026

The short version: the extension doesn't collect your data. Everything it
remembers stays in your browser, and it never sends anything to the developer
or to anyone else.

## What the extension stores, and where

All of it is kept by your browser using the `chrome.storage` API (or
`browser.storage` in Firefox). None of it is sent to the developer.

| What | Why | Where |
| --- | --- | --- |
| Your settings (what to skip, countdown, binge limit, and so on) | So your choices stick | `storage.sync` |
| Per-show rules and your own skip marks, with the show's Crunchyroll ID and title | So a rule you set on one episode applies to the rest of the show | `storage.sync` |
| Time-saved stats: seconds skipped per day, and which shows and episodes (Crunchyroll IDs and titles) they came from, for the last 62 days | The weekly recap in the popup | `storage.local` |
| Which shows' openings you've already heard (show ID, season, date), up to 300 shows | "Play new openings once" | `storage.local` |
| Sleep timer and binge counter state | Those features | `storage.local` |

`storage.local` never leaves your device. `storage.sync` is synced between your
own browsers by your browser vendor (for example Google, when Chrome sync is on)
under that vendor's privacy policy. The developer has no access to it.

## What the extension reads on crunchyroll.com

While you watch, the extension reads the page you're on, only on
`www.crunchyroll.com`. It reads the episode ID from the address, the show and
episode titles, the video's current time and duration, and Crunchyroll's own
"Skip" and "Next episode" buttons. It uses these only to decide when to skip.
It does not read your account, profile, watch history, payment details, cookies
or any other site.

## Network requests

The extension makes one kind of request. For the episode you're watching, it
downloads Crunchyroll's public skip timestamps from
`https://static.crunchyroll.com/skip-events/production/<episode ID>.json`,
which is the same file Crunchyroll's own player uses. The request goes only to
Crunchyroll, carries no cookies or personal information beyond the episode ID
in the address, and the response is cached in memory for a short time.

There are no analytics, no ads, no tracking, no remote code and no
developer-run servers.

## Sharing and selling

The developer doesn't receive your data, so it isn't sold, shared, transferred
or used for anything else, including advertising, credit decisions or
profiling.

The use of information received from Chrome APIs adheres to the
[Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/),
including the Limited Use requirements.

## Deleting your data

- **Reset** next to the stats in the popup clears the time-saved stats.
- **Remove** next to a show under **Per-show rules** deletes that rule or mark.
- Removing the extension deletes everything it stored.

## Children

The extension isn't directed at children and collects no personal information
from anyone.

## Changes

If this policy changes, the new version will be posted at this address with a
new effective date and noted in the [changelog](CHANGELOG.md).

## Contact

Questions or concerns:
[open an issue](https://github.com/JashanMaan28/crunchyroll-autoskip/issues).

This project isn't affiliated with, endorsed by or sponsored by Crunchyroll.
Crunchyroll is a trademark of its owner.

# Bunny Skip

**[bunny-skip.konnektaro.com](https://bunny-skip.konnektaro.com/)**

A Chrome extension (Manifest V3) that automatically clicks "Skip Intro," "Skip Recap," and "Next Episode" buttons on streaming sites (Netflix, Prime Video, Disney+, Hulu, Max, Apple TV+, Paramount+), plus YouTube's own "Skip" button on ads. Rules that describe which button to click are stored as **data** — never as hardcoded per-site JS — so a broken rule can be fixed by picking the button again, no DevTools required.

It has no backend and makes no network calls beyond loading the pages you already visit — see [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md) for the full data-handling breakdown. It's currently installed as an unpacked extension via Chrome Developer Mode.

## What it does — and doesn't do

- Only interacts with buttons/UI elements the site already renders and shows you.
- On YouTube it clicks the same "Skip" button you would click yourself once it appears, and for unskippable ads it fast-forwards and mutes the ad `<video>` element locally. It does **not** block ad network requests, hide ad elements, or touch DRM-protected content.
- Never bypasses paywalls or subscription checks, and never downloads/exports video.
- Rules are plain data (selectors/strings) — nothing is ever `eval`'d.
- No analytics, telemetry, or network calls.
- YouTube support ships **off by default** and needs a one-time permission grant — see [YouTube](#youtube).

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select this folder (`bunny-skip-extension`).
5. Confirm it installs with no errors and the toolbar icon appears.

On first install, a small set of rules is seeded automatically (Netflix Skip Intro / Skip Recap / Next Episode, an Apple TV+ Skip rule, and two **disabled** YouTube ad rules) — see [Seed rules](#seed-rules) below.

## How it works

- `content/engine.js` runs on every page load on the sites listed in `manifest.json`'s `host_permissions` (and on `youtube.com` once you grant that optional permission — see [YouTube](#youtube)). It loads the enabled rules for the current hostname, watches the page with a debounced `MutationObserver` (these are SPAs — buttons appear and disappear without a full navigation), and clicks any element that matches a rule. Each matched DOM node is only ever clicked once (tracked in a `WeakSet`), so re-renders of the same button don't cause double-clicks. A rule with `action: "seek-end"` instead treats its match as an ad container and jumps that container's `<video>` to the end (muting it while it runs, restoring audio once the ad clears).
- Rules live in `chrome.storage.local`, managed through `storage/rules-store.js`. Adding, editing, toggling, or deleting a rule from the popup takes effect immediately — the content script listens for `chrome.storage.onChanged` and refreshes live, no page reload needed.
- The popup (toolbar icon) lists rules for the site you're currently on, plus a collapsible section for every other site, and lets you add/edit/delete/enable/disable rules manually.
- The **element picker** (`content/picker.js`) is injected on demand when you click "Pick element on page" in the popup. Hover highlights elements on the live page; clicking one captures it (the click never reaches the site's real handler) and proposes 2–4 ranked candidate rules — most durable first — for you to review, label, and save.

## Rule data model

```json
{
  "id": "uuid-v4",
  "site": "netflix.com",
  "label": "Skip Intro",
  "matchType": "aria-label",
  "matchValue": "Skip Intro",
  "dataAttrName": "data-uia",
  "action": "click",
  "enabled": true,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "source": "seed"
}
```

- `site` — hostname substring; a rule applies when `location.hostname.includes(rule.site)`.
- `matchType` — one of:
  - `aria-label` — matches `[aria-label="<matchValue>"]` exactly, falling back to a "contains" scan.
  - `text` — matches trimmed `textContent` (equal or contains) within `button, [role="button"], a, div[tabindex]`.
  - `css-selector` — a raw CSS selector, used as a manual-entry escape hatch. Least durable — site redeploys can change generated class names.
  - `data-attribute` — matches `[<dataAttrName>="<matchValue>"]`, e.g. Netflix's `data-uia="next-episode-seamless-button"`. Most durable, since these are usually stable test hooks rather than styling classes.
- `action` — one of:
  - `click` (default) — dispatch a click on the matched element.
  - `seek-end` — treat the matched element as an ad container: find its `<video>` (or the page's first `<video>`), mute it, and set `currentTime` to `duration` so an unskippable ad plays out instantly. Audio is un-muted once the container disappears. Backs the YouTube "speed through unskippable ads" seed rule.
- `source` — `seed` (shipped defaults), `manual` (typed into the popup form), or `picker` (captured via the element picker).

## Seed rules

`seed-rules.json` ships these out of the box:

- Netflix — Skip Intro (`data-attribute`, `data-uia="player-skip-intro"`), Skip Recap, Next Episode (`data-attribute`, `data-uia="next-episode-seamless-button"`). Enabled. Netflix's `data-uia` hooks are the most stable of the supported sites.
- Apple TV+ — Skip (`data-attribute`, `data-testid="skip-overlay-button-skip-button"`). Enabled.
- YouTube — "Skip Ad (YouTube)" (`css-selector`, `action: click`) and "Speed through unskippable ads (YouTube)" (`css-selector`, `action: seek-end`). **Disabled by default**; enabling either one prompts for the optional `youtube.com` permission. See [YouTube](#youtube).

**Prime Video, Disney+, Hulu, Max, and Paramount+ ship with no seed rules.** Their selectors are less stable than Netflix's, so rather than guessing brittle values that would break silently, capture them yourself with the picker: open a title on that site, click the toolbar icon → "Pick element on page," then click the site's actual Skip Intro / Next Episode button. Review the proposed candidates, adjust the label if you want, and save.

### Backfilling seeds on update

Seeds are written on first install. When a later version *adds* seeds, each new entry in `seed-rules.json` carries a `_since` number and `background.js` tracks a `seedSchemaVersion` in `chrome.storage.local`. On update it adds only the newer seeds, and only when an equivalent rule (same `site` + `matchType` + `matchValue` + `action`) isn't already present — so a seed you deleted is never resurrected, and the YouTube rules reach existing installs the same way a fresh install gets them (disabled).

## YouTube

YouTube is **not** a built-in host permission. `manifest.json` lists it under `optional_host_permissions`, and `content/engine.js` only runs on `youtube.com` after you grant it:

1. Open the popup and enable either YouTube rule (they start disabled, listed under **Other Sites**). Chrome shows a permission prompt for `youtube.com`.
2. Grant it. `background.js` registers the YouTube content script via `chrome.scripting.registerContentScripts`. Reload any already-open YouTube tab once.
3. Disabling every YouTube rule hands the permission back automatically, and the content script is unregistered.

"Skip Ad (YouTube)" clicks YouTube's own Skip button once it appears. "Speed through unskippable ads (YouTube)" matches the player while it has the `ad-showing` class and fast-forwards + mutes the ad video. Neither blocks a network request or hides page content.

## Adding support for a new site

Adding a new streaming site requires two things:

1. Add its origin to `host_permissions` **and** the `content_scripts.matches` array in `manifest.json` (e.g. `"*://*.hulu.com/*"`), then reload the unpacked extension.
2. Capture its buttons with the picker (or add rules manually via the popup form) — there's no need to touch any JS.

## Future Work

- **Network-level ad-blocking** — out of scope. Bunny Skip only clicks a site's own visible "Skip" button and, on YouTube, fast-forwards the ad `<video>` locally. It never blocks ad requests or filters page content.
- **`chrome.storage.sync`** — cross-device rule syncing. The extension uses `chrome.storage.local` only; `sync` is a documented future option.
- **Fetching/merging a shared community rules file** from a public GitHub repo. If built later, this must be opt-in and remain the only network call the extension makes.
- **Firefox/Safari ports.**

## Permissions

`storage`, `activeTab`, `scripting`, plus host permissions scoped to the specific streaming sites listed in `manifest.json`. `youtube.com` is an **optional** host permission — not granted until you enable a YouTube rule, and released when you disable the last one. Nothing broader is requested.

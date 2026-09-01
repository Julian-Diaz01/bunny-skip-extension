# Privacy Policy for Bunny Skip

**Last updated:** 2026-09-01

Bunny Skip is a browser extension that automatically clicks "Skip Intro," "Skip Recap," and "Next Episode" buttons on supported streaming sites (Netflix, Prime Video, Disney+, Hulu, Max, Apple TV+, Paramount+), and — only if you opt in — clicks YouTube's own "Skip" button on ads and fast-forwards unskippable ad videos.

## Data collection

Bunny Skip does not collect, transmit, sell, or share any user data. Specifically:

- **No analytics or telemetry.** The extension does not use any tracking, analytics, or crash-reporting service.
- **No network requests.** Bunny Skip never sends data to any server. The only `fetch` call in the code loads `seed-rules.json`, a file bundled inside the extension package itself (via `chrome.runtime.getURL`) — this never leaves the browser.
- **No remote code execution.** All code that runs is packaged inside the extension at install time. Nothing is downloaded or `eval`'d at runtime.

## Data stored locally

The extension stores this, entirely on your device, using the `chrome.storage.local` API:

- **Skip rules** — the list of buttons you've configured Bunny Skip to click (e.g., "Skip Intro" on Netflix), including any rules you create yourself with the element picker.
- **A few small preferences** — e.g. whether the popup's advanced section is open, and an internal version number used to add newly-shipped default rules on update.

This data:
- Never leaves your device.
- Is never read by the developer.
- Is deleted automatically if you uninstall the extension.

## Permissions

| Permission | Why Bunny Skip needs it |
|---|---|
| `storage` | Save your skip rules locally in `chrome.storage.local`. |
| `activeTab` | Let the popup's element picker inspect the page you're currently viewing, only when you invoke it. |
| `scripting` | Inject the element-picker script on demand when you click "Pick element on page," and register the content script for YouTube if you grant the optional permission below. |
| Host permissions for `netflix.com`, `primevideo.com`, `disneyplus.com`, `hulu.com`, `max.com`, `tv.apple.com`, `paramountplus.com` | Run the content script that watches for and clicks Skip Intro / Skip Recap / Next Episode buttons on those sites. |
| **Optional** host permission for `youtube.com` | Not requested at install. Granted only when you enable a YouTube rule, and released automatically when you disable the last one. While granted, the content script runs on YouTube to click the "Skip" button and fast-forward/mute unskippable ad videos. |

Bunny Skip cannot see or run on any site not listed above.

## Ads

Bunny Skip does not block, filter, or observe advertising network requests, and does not hide or remove ad elements from the page. On YouTube (opt-in only) it clicks the same visible "Skip" button you could click yourself, and for unskippable ads it sets the ad video's playback position to the end and mutes it — all locally in your browser, with nothing sent anywhere.

## Third parties

Bunny Skip does not integrate with, or share data with, any third-party service, advertiser, or analytics provider.

## Changes to this policy

If Bunny Skip's data practices ever change, this policy will be updated and the extension's Chrome Web Store listing will reflect the update date above.

## Contact

Questions about this policy can be sent to info@konnektaro.com.

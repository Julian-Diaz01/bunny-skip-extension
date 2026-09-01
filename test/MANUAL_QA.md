# Manual QA — YouTube skip-ads (v1.1.0)

Automated engine coverage: open `test/youtube-ad-fixture.html` from a local web
server (not `file://` — scripts are blocked there) and click **Run full suite**.
Expect `9 passed, 0 failed`. It exercises the real `engine.js` against a mock
player: the faded skip button (`opacity: 0.5`) is left alone until it flips to
`opacity: 1`, then clicked; unskippable-ad fast-forward + mute; audio restore;
and the "`.ad-showing` lingers with no ad marker" race (engine must not touch
the content video).

```bash
python -m http.server 8777
# then open http://localhost:8777/test/youtube-ad-fixture.html
```

## Load unpacked

1. `chrome://extensions` → Developer mode → **Load unpacked** → select repo root.
2. Extension loads with no errors. Toolbar icon appears.

## Fresh-install seeding

3. Open the popup. Under **Other Sites** there is a `youtube.com` group with
   **Skip Ad (YouTube)** and **Speed through unskippable ads (YouTube)**, both
   toggled **off**.
4. Netflix / Apple TV+ seeds still present and enabled.
5. DevTools → Application → Storage → `chrome.storage.local`: `seedSchemaVersion` is `2`.

## Existing-install migration

6. Load the *previous* build (1.0.2), let it seed, then load this build over it
   (bump nothing — Chrome treats a reload of a higher version as an update; or
   test with a packed .zip bump).
7. The two YouTube rules appear, **off**. No Netflix/Apple seeds duplicated.
8. Delete one YouTube rule, reload the extension again — it does **not** come back
   (`seedSchemaVersion` already `2`).

## Permission grant flow

9. Enable **Skip Ad (YouTube)** in the popup. Chrome shows a permission prompt for
   `youtube.com`. Accept.
10. `chrome://extensions` → Details → Site access now lists youtube.com.
11. Service worker console (`chrome://extensions` → Inspect views): logs
    `Registered YouTube content script`.
12. Deny instead (repeat from a clean state): the toggle snaps back off and an
    alert explains why. No youtube.com site access added.

## On real YouTube

13. Open a YouTube video known to run ads (or any; reload a few times).
    **Reload the tab once** after granting permission so the content script injects.
14. Skippable ad: the **Skip** / **Skip Ad** button is clicked automatically within
    ~1s of appearing; playback returns to content.
15. Unskippable ad ("Video will play after ad"): the ad jumps to its end almost
    immediately and is muted while it briefly plays; content audio is normal
    afterward (not left muted).
16. Back-to-back ads: each is skipped/fast-forwarded in turn.
17. No double-skips, no clicking through content, no console errors from
    `[bunny-skip]`.

## Permission release

18. Disable **both** YouTube rules. Service worker console logs
    `Unregistered YouTube content script`. `chrome://extensions` → Details no longer
    lists youtube.com site access.
19. Reload a YouTube tab — extension no longer acts on it.

## Regression — other sites

20. Netflix: Skip Intro / Next Episode still auto-click.
21. Element picker still works on a supported site (pick a button, rule saves).
22. Popup: add/edit/delete/rename/toggle a non-YouTube rule — unchanged.

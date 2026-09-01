// background.js — MV3 service worker: seeds default rules on first
// install, backfills newly-shipped seeds on update, and (de)registers the
// YouTube content script as the optional host permission is granted or
// revoked. No telemetry, no persistent state beyond what rules-store.js
// manages plus a single "seedSchemaVersion" integer.

importScripts('storage/rules-store.js');

// Bump when seed-rules.json gains entries that already-installed users
// should receive on update. Each such new seed carries "_since": <this>.
const SEED_SCHEMA_VERSION = 2;
const SEED_SCHEMA_VERSION_KEY = 'seedSchemaVersion';
const YOUTUBE_ORIGIN = '*://*.youtube.com/*';
const YT_SCRIPT_ID = 'bunny-skip-youtube';

async function loadSeedRules() {
  const seedUrl = chrome.runtime.getURL('seed-rules.json');
  const response = await fetch(seedUrl);
  return response.json();
}

// Drop the "_since" migration marker; stamp a fresh id + createdAt.
function materializeSeed(rule) {
  const { _since, ...rest } = rule;
  return {
    id: RulesStore.generateRuleId(),
    createdAt: new Date().toISOString(),
    ...rest,
  };
}

async function seedFreshInstall() {
  const existingRules = await RulesStore.getRules();
  if (existingRules.length > 0) {
    // Rules already present (imported, or a prior version) — treat like
    // an existing install so we never duplicate.
    await migrateSeeds();
    return;
  }

  const seedRules = await loadSeedRules();
  await RulesStore.saveRules(seedRules.map(materializeSeed));
  await chrome.storage.local.set({ [SEED_SCHEMA_VERSION_KEY]: SEED_SCHEMA_VERSION });
  console.debug('[bunny-skip] Seeded default rules:', seedRules.length);
}

// Existing installs: add only seeds whose "_since" is newer than the
// version this profile last saw, and only when an equivalent rule isn't
// already there. Never resurrects an older seed the user deleted.
async function migrateSeeds() {
  const stored = await chrome.storage.local.get(SEED_SCHEMA_VERSION_KEY);
  const seenVersion = Number(stored[SEED_SCHEMA_VERSION_KEY]) || 1;
  if (seenVersion >= SEED_SCHEMA_VERSION) {
    return;
  }

  try {
    const seedRules = await loadSeedRules();
    const existing = await RulesStore.getRules();
    const hasEquivalent = (seed) =>
      existing.some(
        (r) =>
          r.site === seed.site &&
          r.matchType === seed.matchType &&
          r.matchValue === seed.matchValue &&
          (r.action || 'click') === (seed.action || 'click')
      );

    const toAdd = seedRules
      .filter((seed) => (Number(seed._since) || 1) > seenVersion)
      .filter((seed) => !hasEquivalent(seed))
      .map(materializeSeed);

    if (toAdd.length > 0) {
      await RulesStore.saveRules(existing.concat(toAdd));
      console.debug('[bunny-skip] Added', toAdd.length, 'new seed rule(s) on update');
    }
    await chrome.storage.local.set({ [SEED_SCHEMA_VERSION_KEY]: SEED_SCHEMA_VERSION });
  } catch (err) {
    console.error('[bunny-skip] Seed migration failed:', err);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  const task = details.reason === 'install' ? seedFreshInstall() : migrateSeeds();
  task
    .catch((err) => console.error('[bunny-skip] Install/update task failed:', err))
    .finally(() => syncYouTubeRegistration());
});

chrome.runtime.onStartup.addListener(() => {
  syncYouTubeRegistration();
});

// ---------------------------------------------------------------------
// YouTube content-script registration. engine.js is NOT in the static
// content_scripts list for youtube.com — it only runs there once the
// user grants the optional host permission (from the popup, when they
// enable a youtube.com rule). Keep registration in lock-step with the
// permission so revoking it fully stops the extension on YouTube.
// ---------------------------------------------------------------------

// Serialises the sync so overlapping triggers (onInstalled + onStartup +
// permissions.onAdded firing near-simultaneously) can't race into a
// duplicate-id registration error.
let ytSyncChain = Promise.resolve();

function syncYouTubeRegistration() {
  ytSyncChain = ytSyncChain.then(doSyncYouTubeRegistration, doSyncYouTubeRegistration);
  return ytSyncChain;
}

async function doSyncYouTubeRegistration() {
  let granted = false;
  try {
    granted = await chrome.permissions.contains({ origins: [YOUTUBE_ORIGIN] });
  } catch (err) {
    granted = false;
  }
  if (granted) {
    await registerYouTube();
  } else {
    await unregisterYouTube();
  }
}

async function registerYouTube() {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [YT_SCRIPT_ID] });
    if (existing && existing.length > 0) {
      return;
    }
    await chrome.scripting.registerContentScripts([
      {
        id: YT_SCRIPT_ID,
        matches: [YOUTUBE_ORIGIN],
        js: ['storage/rules-store.js', 'content/engine.js'],
        runAt: 'document_idle',
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
    console.debug('[bunny-skip] Registered YouTube content script');
  } catch (err) {
    console.error('[bunny-skip] Failed to register YouTube content script:', err);
  }
}

async function unregisterYouTube() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [YT_SCRIPT_ID] });
    console.debug('[bunny-skip] Unregistered YouTube content script');
  } catch (err) {
    // Wasn't registered — nothing to do.
  }
}

function isYouTubePermChange(perms) {
  return Array.isArray(perms && perms.origins) && perms.origins.some((o) => o.includes('youtube.com'));
}

chrome.permissions.onAdded.addListener((perms) => {
  if (isYouTubePermChange(perms)) {
    syncYouTubeRegistration();
  }
});

chrome.permissions.onRemoved.addListener((perms) => {
  if (isYouTubePermChange(perms)) {
    syncYouTubeRegistration();
  }
});

// Also reconcile on every worker spin-up — covers the disable→re-enable
// cycle in chrome://extensions, which fires none of the events above.
syncYouTubeRegistration();

// The popup closes the instant the user clicks the page to pick an element,
// so it can't wait for confirmation — this auto-saves the best candidate
// immediately. Runner-up candidates are kept in `pickerPending` for the
// popup's "not the right one?" fallback.
chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== 'object') {
    return;
  }
  if (message.type === 'picker-result') {
    handlePickerResult(message).catch((err) => {
      console.error('[bunny-skip] Failed to auto-save picked rule:', err);
    });
  } else if (message.type === 'picker-cancelled') {
    chrome.action.setBadgeText({ text: '' });
  }
});

async function handlePickerResult(message) {
  const candidates = Array.isArray(message.candidates) ? message.candidates : [];
  const site = message.site || '';

  if (candidates.length === 0) {
    await chrome.storage.local.set({
      pickerPending: { candidates: [], site, ts: Date.now() },
    });
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#d92d20' });
    notifyPopup();
    return;
  }

  // Popup already closed, so read this preference from storage. When on,
  // skip auto-save and let the popup present all candidates instead.
  const { manualSelectEnabled } = await chrome.storage.local.get('manualSelectEnabled');
  if (manualSelectEnabled) {
    await chrome.storage.local.set({
      pickerPending: { needsSelection: true, candidates, site, ts: Date.now() },
    });
    chrome.action.setBadgeText({ text: '?' });
    chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
    notifyPopup();
    return;
  }

  const best = candidates[0];
  const patch = {
    site: site || best.site || '',
    label: best.label || 'Picked element',
    matchType: best.matchType,
    matchValue: best.matchValue,
    dataAttrName: best.matchType === 'data-attribute' ? best.dataAttrName || '' : '',
    source: 'picker',
  };

  const newRule = await RulesStore.addRule(patch);

  await chrome.storage.local.set({
    pickerPending: {
      savedRuleId: newRule.id,
      savedLabel: patch.label,
      savedMatchType: patch.matchType,
      savedMatchValue: patch.matchValue,
      candidates,
      site,
      ts: Date.now(),
    },
  });

  chrome.action.setBadgeText({ text: '✓' });
  chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
  notifyPopup();
}

function notifyPopup() {
  // sendMessage rejects (doesn't throw) with no receiver — catch avoids an
  // unhandled rejection when the popup (the common case) isn't listening.
  chrome.runtime.sendMessage({ type: 'picker-auto-saved' }).catch(() => {});
}

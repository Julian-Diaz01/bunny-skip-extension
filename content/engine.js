// content/engine.js — rule-driven auto-clicker for "Skip Intro" / "Skip
// Recap" / "Next Episode" buttons. Loaded after storage/rules-store.js
// (plain script, no ES modules), so `RulesStore` is already global.
// Rules are pure data and are never eval'd.

const DEBUG = false;

// Module-level state.
let activeRules = [];
const clickedNodes = new WeakSet();
let rescanTimer = null;
const RESCAN_DEBOUNCE_MS = 200;

function log(...args) {
  if (DEBUG) {
    console.debug('[bunny-skip]', ...args);
  }
}

// ---------------------------------------------------------------------
// Matching logic: each function takes (rule, doc) and returns an array
// (never throws) of candidate elements for that rule.
// ---------------------------------------------------------------------

function matchAriaLabel(rule, doc) {
  const value = rule.matchValue;
  if (!value) {
    return [];
  }

  const exact = doc.querySelectorAll(`[aria-label="${CSS.escape(value)}"]`);
  if (exact.length > 0) {
    return Array.from(exact);
  }

  // Fall back to a "contains" scan over every element with an aria-label.
  const candidates = [];
  const withAriaLabel = doc.querySelectorAll('[aria-label]');
  for (const el of withAriaLabel) {
    const label = el.getAttribute('aria-label');
    if (label && label.includes(value)) {
      candidates.push(el);
    }
  }
  return candidates;
}

function matchText(rule, doc) {
  const value = rule.matchValue;
  if (!value) {
    return [];
  }

  const candidates = [];
  const scope = doc.querySelectorAll('button, [role="button"], a, div[tabindex]');
  for (const el of scope) {
    const text = (el.textContent || '').trim();
    if (text === value || text.includes(value)) {
      candidates.push(el);
    }
  }
  return candidates;
}

function matchCssSelector(rule, doc) {
  const value = rule.matchValue;
  if (!value) {
    return [];
  }

  try {
    return Array.from(doc.querySelectorAll(value));
  } catch (err) {
    log('invalid css-selector rule, skipping', rule.id, value, err);
    return [];
  }
}

function matchDataAttribute(rule, doc) {
  const { dataAttrName, matchValue } = rule;
  if (!dataAttrName || !matchValue) {
    return [];
  }

  const selector = `[${dataAttrName}="${CSS.escape(matchValue)}"]`;
  try {
    return Array.from(doc.querySelectorAll(selector));
  } catch (err) {
    log('invalid data-attribute rule, skipping', rule.id, selector, err);
    return [];
  }
}

const MATCHERS = {
  'aria-label': matchAriaLabel,
  text: matchText,
  'css-selector': matchCssSelector,
  'data-attribute': matchDataAttribute,
};

function findCandidates(rule, doc) {
  const matcher = MATCHERS[rule.matchType];
  if (!matcher) {
    log('unknown matchType, skipping rule', rule.id, rule.matchType);
    return [];
  }
  try {
    return matcher(rule, doc);
  } catch (err) {
    log('matcher threw, skipping rule', rule.id, err);
    return [];
  }
}

// ---------------------------------------------------------------------
// Visibility + click handling.
// ---------------------------------------------------------------------

function isVisible(el) {
  if (typeof el.checkVisibility === 'function') {
    try {
      return el.checkVisibility();
    } catch (err) {
      // Fall through to the offsetWidth/offsetHeight check below.
    }
  }
  return el.offsetWidth > 0 && el.offsetHeight > 0;
}

// A button the site has rendered but not yet activated. YouTube's
// `.ytp-skip-ad-button` sits at `opacity: 0.5` during the pre-skip
// countdown, then flips to 1 when it becomes clickable; clicking it early
// is a no-op. Return false here so the node is NOT consumed and a later
// scan retries once it's live.
function isClickReady(el) {
  if (el.disabled === true) {
    return false;
  }
  if (typeof el.getAttribute === 'function' && el.getAttribute('aria-disabled') === 'true') {
    return false;
  }
  try {
    const opacity = parseFloat(getComputedStyle(el).opacity);
    if (Number.isFinite(opacity) && opacity < 0.9) {
      return false;
    }
  } catch (err) {
    // getComputedStyle can throw for a detached node — treat as ready.
  }
  return true;
}

function tryClick(rule, el) {
  if (clickedNodes.has(el)) {
    return false;
  }
  if (!isVisible(el)) {
    return false;
  }
  if (!isClickReady(el)) {
    log('element not ready (disabled/faded), will retry', rule.id);
    return false; // not added to clickedNodes — retried on a later scan
  }

  clickedNodes.add(el);
  try {
    el.click();
    log('clicked element for rule', rule.id, rule.label || rule.matchValue, el);
    return true;
  } catch (err) {
    log('click() threw for rule', rule.id, err);
    return false;
  }
}

// ---------------------------------------------------------------------
// "seek-end" action. Some ads (YouTube's unskippable pre/mid-roll) have
// no Skip button to click — instead the matched element is the *ad
// container*, and clearing the ad means jumping its underlying <video>
// to the end. We also mute that video while it plays and hand audio
// back once the container disappears. Still fully rule-driven: the rule
// picks the DOM signal, only the action differs.
// ---------------------------------------------------------------------

const mutedByUs = new Set(); // <video> elements this script muted

// Ad-only markers YouTube adds while (and only while) an ad is on screen.
// Requiring one of these — in addition to the rule's own match — guards
// against seeking the *content* video during the brief window where the
// player still carries `.ad-showing` after the media has swapped back.
const AD_MARKER_SELECTOR =
  '.ad-showing .ytp-ad-player-overlay, .ad-showing .ytp-ad-player-overlay-layout, ' +
  '.ad-showing .ytp-ad-module :first-child, .ytp-ad-text, .ytp-ad-preview-container, ' +
  '.ytp-ad-skip-button-container, .ytp-ad-duration-remaining';

function adIsOnScreen() {
  return (
    !!document.querySelector('.ad-showing, .ad-interrupting') &&
    !!document.querySelector(AD_MARKER_SELECTOR)
  );
}

// Only ever returns a <video> that lives inside the matched ad container
// — never a page-wide fallback that could resolve to the content video.
function resolveAdVideo(el) {
  if (el instanceof HTMLVideoElement) {
    return el;
  }
  if (el && typeof el.querySelector === 'function') {
    return el.querySelector('video');
  }
  return null;
}

function maybeSeekAdVideo(container) {
  if (!adIsOnScreen()) {
    return false;
  }
  const video = resolveAdVideo(container);
  if (!video) {
    return false;
  }
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) {
    return false;
  }
  if (!video.muted) {
    video.muted = true;
    mutedByUs.add(video);
  }
  const target = Math.max(0, duration - 0.1);
  if (video.currentTime >= target) {
    return false; // already at the end — nothing left to skip
  }
  try {
    video.currentTime = target;
    log('fast-forwarded ad video to end', target);
    return true;
  } catch (err) {
    log('seek threw', err);
    return false;
  }
}

function restoreMutedVideos() {
  for (const video of mutedByUs) {
    if (document.contains(video)) {
      video.muted = false;
    }
  }
  mutedByUs.clear();
}

// ---------------------------------------------------------------------
// Scanning.
// ---------------------------------------------------------------------

function scan() {
  if (activeRules.length === 0) {
    // No rules at all (disabled/deleted/permission revoked) — never leave
    // a video we muted stuck muted.
    if (mutedByUs.size > 0) {
      restoreMutedVideos();
    }
    return;
  }

  let seekAdMatched = false;

  for (const rule of activeRules) {
    if (!rule.enabled) {
      continue;
    }

    const candidates = findCandidates(rule, document);
    if (candidates.length > 0) {
      log('rule matched', rule.id, rule.label || rule.matchValue, 'candidates:', candidates.length);
    }

    if (rule.action === 'seek-end') {
      if (candidates.length > 0) {
        seekAdMatched = true;
        for (const el of candidates) {
          maybeSeekAdVideo(el);
        }
      }
      continue;
    }

    // Default action: click.
    for (const el of candidates) {
      tryClick(rule, el);
    }
  }

  // Nothing matched a seek-end rule this pass — the ad is over (or the
  // rule was turned off). Hand audio back regardless of whether a
  // seek-end rule is still active.
  if (!seekAdMatched && mutedByUs.size > 0) {
    restoreMutedVideos();
  }
}

function scheduleRescan() {
  if (rescanTimer !== null) {
    return;
  }
  rescanTimer = setTimeout(() => {
    rescanTimer = null;
    scan();
  }, RESCAN_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------
// Rule loading + live updates.
// ---------------------------------------------------------------------

async function loadActiveRules() {
  try {
    const rules = await RulesStore.getRulesForSite(location.hostname);
    activeRules = rules.filter((rule) => rule.enabled === true);
    log('loaded active rules', activeRules.length, activeRules);
  } catch (err) {
    log('failed to load rules', err);
    activeRules = [];
  }
}

function watchStorageChanges() {
  if (!chrome.storage || !chrome.storage.onChanged) {
    return;
  }
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }
    if (!changes[RulesStore.RULES_STORAGE_KEY]) {
      return;
    }
    log('rules changed in storage, reloading active rule set');
    // Intentionally do NOT clear clickedNodes here — a node that has
    // already been clicked stays "done" even if its rule was edited.
    loadActiveRules().then(() => {
      scheduleRescan();
    });
  });
}

function watchDom() {
  const observer = new MutationObserver(() => {
    scheduleRescan();
  });
  // `attributeFilter` catches the moment a countdown button flips from
  // disabled/faded to live (YouTube toggles inline `style`/`class`),
  // which a childList-only observer would miss. The 200 ms debounce
  // keeps this cheap despite YouTube's constant DOM churn.
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'disabled', 'aria-disabled', 'hidden'],
  });
}

// ---------------------------------------------------------------------
// Bootstrap.
// ---------------------------------------------------------------------

async function init() {
  log('initializing on', location.hostname);
  await loadActiveRules();
  watchStorageChanges();
  watchDom();
  scan();
}

init();

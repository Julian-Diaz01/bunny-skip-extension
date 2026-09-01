(function () {
  'use strict';

  const ADVANCED_OPEN_STORAGE_KEY = 'advancedSectionOpen';
  const MANUAL_SELECT_STORAGE_KEY = 'manualSelectEnabled';
  const EDIT_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>';
  const INFO_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 16v-5" /><path d="M12 8h.01" /></svg>';
  const MATCH_TYPE_INFO = {
    'data-attribute': 'Matches a stable test/tracking attribute on the button. Most reliable — rarely breaks when the site redesigns.',
    'aria-label': "Matches the button's accessibility label. Reliable unless the site changes that label's wording.",
    text: "Matches the button's visible text. Breaks if the site changes the wording or language.",
    'css-selector': "Matches the button's position in the page structure. Least reliable — breaks easily when the site redeploys.",
  };

  // youtube.com isn't a built-in host permission — it's optional and
  // requested only when the user first enables a YouTube rule.
  const YOUTUBE_ORIGIN_PATTERN = '*://*.youtube.com/*';

  function siteNeedsOptionalPermission(site) {
    return typeof site === 'string' && site.includes('youtube.com');
  }

  // Prompts for the optional youtube.com host permission if it isn't
  // already held. Must be called from a user gesture (a click/change
  // handler). Returns true if the permission is granted afterwards.
  async function ensureSitePermission(site) {
    if (!siteNeedsOptionalPermission(site)) {
      return true;
    }
    if (!chrome.permissions || !chrome.permissions.request) {
      return true; // e.g. the offline popup mock — nothing to gate on
    }
    try {
      const held = await chrome.permissions.contains({ origins: [YOUTUBE_ORIGIN_PATTERN] });
      if (held) {
        return true;
      }
      return await chrome.permissions.request({ origins: [YOUTUBE_ORIGIN_PATTERN] });
    } catch (err) {
      return false;
    }
  }

  // Surfaces a message on the Add Rule panel's status line (visible from
  // any panel once switched to) instead of a popup-dismissing alert().
  function announce(message) {
    switchPanel('panel-add-rule');
    clearPickerStatusTimer();
    showPickerStatus(message);
    pickerStatusTimer = setTimeout(hidePickerStatus, 6000);
  }

  // Once no youtube.com rule is enabled any more, hand the host
  // permission back so the extension can't run on YouTube.
  async function maybeReleaseYouTubePermission() {
    if (!chrome.permissions || !chrome.permissions.remove) {
      return;
    }
    try {
      const rules = await RulesStore.getRules();
      const stillUsed = rules.some((r) => siteNeedsOptionalPermission(r.site) && r.enabled);
      if (!stillUsed) {
        await chrome.permissions.remove({ origins: [YOUTUBE_ORIGIN_PATTERN] });
      }
    } catch (err) {
      // Best effort — leaving the permission in place is harmless.
    }
  }

  let currentHostname = '';
  let editingRuleId = null; // null => form is in "add" mode; otherwise editing this rule id
  let pickerStatusTimer = null;
  let advancedToggleIsProgrammatic = false;

  // --- DOM references (populated on DOMContentLoaded) ---
  let currentSiteHeading;
  let currentSiteRulesEl;
  let otherSitesRulesEl;
  let formHeading;
  let ruleForm;
  let fieldId;
  let fieldSite;
  let fieldLabel;
  let fieldMatchType;
  let fieldMatchValue;
  let fieldDataAttrName;
  let fieldDataAttrNameLabel;
  let formSubmitBtn;
  let formCancelBtn;
  let pickElementBtn;
  let pickerStatusEl;
  let pickerCandidatesEl;
  let advancedSection;
  let fieldSiteError;
  let fieldLabelError;
  let fieldMatchValueError;
  let navButtons;
  let panels;
  let pickerHelpBtn;
  let pickerHelpTip;
  let advancedHelpBtn;
  let advancedHelpTip;
  let manualSelectToggle;
  let addRuleShortcutBtn;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    currentSiteHeading = document.getElementById('current-site-heading');
    currentSiteRulesEl = document.getElementById('current-site-rules');
    otherSitesRulesEl = document.getElementById('other-sites-rules');
    formHeading = document.getElementById('form-heading');
    ruleForm = document.getElementById('rule-form');
    fieldId = document.getElementById('rule-id');
    fieldSite = document.getElementById('field-site');
    fieldLabel = document.getElementById('field-label');
    fieldMatchType = document.getElementById('field-matchType');
    fieldMatchValue = document.getElementById('field-matchValue');
    fieldDataAttrName = document.getElementById('field-dataAttrName');
    fieldDataAttrNameLabel = document.getElementById('field-dataAttrName-label');
    formSubmitBtn = document.getElementById('form-submit-btn');
    formCancelBtn = document.getElementById('form-cancel-btn');
    pickElementBtn = document.getElementById('pick-element-btn');
    pickerStatusEl = document.getElementById('picker-status');
    pickerCandidatesEl = document.getElementById('picker-candidates');
    advancedSection = document.getElementById('advanced-section');
    fieldSiteError = document.getElementById('field-site-error');
    fieldLabelError = document.getElementById('field-label-error');
    fieldMatchValueError = document.getElementById('field-matchValue-error');
    navButtons = document.querySelectorAll('.nav-item');
    panels = document.querySelectorAll('.panel');
    pickerHelpBtn = document.getElementById('picker-help-btn');
    pickerHelpTip = document.getElementById('picker-help-tip');
    advancedHelpBtn = document.getElementById('advanced-help-btn');
    advancedHelpTip = document.getElementById('advanced-help-tip');
    manualSelectToggle = document.getElementById('manual-select-toggle');
    addRuleShortcutBtn = document.getElementById('add-rule-shortcut-btn');

    ruleForm.addEventListener('submit', onFormSubmit);
    formCancelBtn.addEventListener('click', resetFormToAddMode);
    fieldMatchType.addEventListener('change', updateDataAttrVisibility);
    pickElementBtn.addEventListener('click', onPickElementClick);
    addRuleShortcutBtn.addEventListener('click', () => {
      resetFormToAddMode();
      switchPanel('panel-add-rule');
      pickElementBtn.click();
    });
    advancedSection.addEventListener('toggle', onAdvancedToggle);
    chrome.runtime.onMessage.addListener(onRuntimeMessage);

    navButtons.forEach((btn) => {
      btn.addEventListener('click', () => switchPanel(btn.getAttribute('aria-controls')));
    });
    initTooltip(pickerHelpBtn, pickerHelpTip);
    initTooltip(advancedHelpBtn, advancedHelpTip);
    manualSelectToggle.addEventListener('change', () => {
      chrome.storage.local.set({ [MANUAL_SELECT_STORAGE_KEY]: manualSelectToggle.checked });
    });
    renderHelpMatchTypes();

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      currentHostname = tab && tab.url ? new URL(tab.url).hostname : '';
    } catch (err) {
      currentHostname = '';
    }

    if (currentHostname) {
      currentSiteHeading.textContent = `Rules for this site (${currentHostname})`;
      fieldSite.value = currentHostname;
    }

    updateDataAttrVisibility();

    const stored = await chrome.storage.local.get([ADVANCED_OPEN_STORAGE_KEY, MANUAL_SELECT_STORAGE_KEY]);
    if (stored[ADVANCED_OPEN_STORAGE_KEY]) {
      setAdvancedOpen(true);
    }
    manualSelectToggle.checked = !!stored[MANUAL_SELECT_STORAGE_KEY];

    await renderAll();
    await checkPendingPickerResult();
  }

  // --- Sidebar navigation (titles column -> content column) ---

  function switchPanel(panelId) {
    navButtons.forEach((btn) => {
      const isActive = btn.getAttribute('aria-controls') === panelId;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    panels.forEach((panel) => {
      const isActive = panel.id === panelId;
      panel.hidden = !isActive;
      panel.classList.toggle('active', isActive);
    });
  }

  // --- Info tooltips ---

  // Toggles an info tooltip. preventDefault() also stops a click from
  // toggling the parent <details> when the button lives in a <summary>.
  function initTooltip(btn, tip) {
    if (!btn || !tip) return;
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const willOpen = tip.hidden;
      closeAllTooltips();
      if (willOpen) {
        tip.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  }

  function closeAllTooltips() {
    document.querySelectorAll('.tooltip').forEach((tip) => {
      tip.hidden = true;
    });
    document.querySelectorAll('.info-btn').forEach((btn) => {
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.info-tooltip-wrap')) {
      closeAllTooltips();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAllTooltips();
    }
  });

  // Programmatic opens/closes shouldn't overwrite the user's remembered
  // preference — this flags the resulting 'toggle' event so onAdvancedToggle
  // skips it. Only a real user click on <summary> should persist the state.
  function setAdvancedOpen(open) {
    advancedToggleIsProgrammatic = true;
    advancedSection.open = open;
  }

  function onAdvancedToggle() {
    if (advancedToggleIsProgrammatic) {
      advancedToggleIsProgrammatic = false;
      return;
    }
    chrome.storage.local.set({ [ADVANCED_OPEN_STORAGE_KEY]: advancedSection.open });
  }

  // background.js already auto-saved the best match to `pickerPending`
  // (the popup closes before the pick finishes) — pick it up here on every
  // open, or via the live 'picker-auto-saved' nudge if still open.
  async function checkPendingPickerResult() {
    const { pickerPending } = await chrome.storage.local.get('pickerPending');
    if (!pickerPending) {
      return;
    }
    await chrome.storage.local.remove('pickerPending');
    chrome.action.setBadgeText({ text: '' });

    if (pickerPending.needsSelection) {
      switchPanel('panel-add-rule');
      renderPickerSelection(pickerPending);
    } else if (pickerPending.savedRuleId) {
      await renderAll();
      switchPanel('panel-add-rule');
      renderPickerConfirmation(pickerPending);
      highlightRule(pickerPending.savedRuleId);
      await reconcilePickerYouTubeRule(pickerPending);
    } else {
      showNoCandidatesMessage();
    }
  }

  // The picker auto-saves the best match before the popup reopens, so it
  // can't prompt for the optional youtube.com permission (no user
  // gesture). If a YouTube rule was saved without that permission, flip
  // it off here so its state is honest — enabling it later prompts.
  async function reconcilePickerYouTubeRule(pending) {
    if (!pending.savedRuleId || !siteNeedsOptionalPermission(pending.site)) {
      return;
    }
    if (!chrome.permissions || !chrome.permissions.contains) {
      return;
    }
    try {
      const held = await chrome.permissions.contains({ origins: [YOUTUBE_ORIGIN_PATTERN] });
      if (held) {
        return;
      }
      await RulesStore.updateRule(pending.savedRuleId, { enabled: false });
      await renderAll();
      switchPanel('panel-add-rule');
      highlightRule(pending.savedRuleId);
      clearPickerStatusTimer();
      showPickerStatus('Saved as off — turn it on in the list to let Bunny Skip run on YouTube.');
    } catch (err) {
      // Leave the rule as saved.
    }
  }

  function updateDataAttrVisibility() {
    const isDataAttr = fieldMatchType.value === 'data-attribute';
    fieldDataAttrNameLabel.hidden = !isDataAttr;
  }

  // Renders from the same MATCH_TYPE_INFO map the alt-match tooltips use,
  // so the two stay in sync.
  function renderHelpMatchTypes() {
    const container = document.getElementById('help-match-types');
    if (!container) return;
    container.innerHTML = '';
    Object.entries(MATCH_TYPE_INFO).forEach(([type, explanation]) => {
      const row = document.createElement('div');
      row.className = 'help-match-row';

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = type;
      row.appendChild(badge);

      const text = document.createElement('span');
      text.className = 'help-match-text';
      text.textContent = explanation;
      row.appendChild(text);

      container.appendChild(row);
    });
  }

  // --- Rendering ---

  async function renderAll() {
    const rules = await RulesStore.getRules();

    const thisSiteRules = [];
    const otherSiteRulesBySite = new Map();

    for (const rule of rules) {
      if (currentHostname && currentHostname.includes(rule.site)) {
        thisSiteRules.push(rule);
      } else {
        if (!otherSiteRulesBySite.has(rule.site)) {
          otherSiteRulesBySite.set(rule.site, []);
        }
        otherSiteRulesBySite.get(rule.site).push(rule);
      }
    }

    renderRuleList(currentSiteRulesEl, thisSiteRules, 'No rules for this site yet.');
    renderOtherSites(otherSiteRulesBySite);
  }

  function renderOtherSites(rulesBySite) {
    // renderAll() rebuilds these <details> from scratch each time — remember
    // which were open so a toggle flip elsewhere doesn't shut them all.
    const openSites = new Set();
    otherSitesRulesEl.querySelectorAll('details.site-group[open]').forEach((el) => {
      if (el.dataset.site) openSites.add(el.dataset.site);
    });

    otherSitesRulesEl.innerHTML = '';

    if (rulesBySite.size === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No other rules.';
      otherSitesRulesEl.appendChild(empty);
      return;
    }

    const sortedSites = Array.from(rulesBySite.keys()).sort();
    for (const site of sortedSites) {
      const group = document.createElement('details');
      group.className = 'site-group';
      group.dataset.site = site;
      group.open = openSites.has(site);

      const summary = document.createElement('summary');
      summary.className = 'site-group-name';

      const arrow = document.createElement('span');
      arrow.className = 'disclosure-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      summary.appendChild(arrow);

      const siteName = document.createElement('span');
      siteName.textContent = site;
      summary.appendChild(siteName);

      group.appendChild(summary);

      const list = document.createElement('div');
      list.className = 'rule-list';
      group.appendChild(list);

      renderRuleList(list, rulesBySite.get(site), 'No rules.');
      otherSitesRulesEl.appendChild(group);
    }
  }

  function renderRuleList(container, rules, emptyText) {
    container.innerHTML = '';

    if (!rules || rules.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = emptyText;
      container.appendChild(empty);
      return;
    }

    for (const rule of rules) {
      container.appendChild(buildRuleRow(rule));
    }
  }

  function buildRuleRow(rule) {
    const row = document.createElement('div');
    row.className = 'rule-row' + (rule.enabled ? '' : ' disabled');
    row.dataset.ruleId = rule.id;

    const toggle = document.createElement('label');
    toggle.className = 'switch';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!rule.enabled;
    checkbox.title = rule.enabled ? 'Enabled' : 'Disabled';
    checkbox.setAttribute('aria-label', rule.enabled ? 'Enabled' : 'Disabled');
    checkbox.addEventListener('change', async () => {
      const enabling = checkbox.checked;
      if (enabling && siteNeedsOptionalPermission(rule.site)) {
        const granted = await ensureSitePermission(rule.site);
        if (!granted) {
          checkbox.checked = false;
          announce('YouTube access is needed to run this rule — it was left off. Toggle it on again to grant access.');
          return;
        }
      }
      await RulesStore.toggleRule(rule.id);
      if (!enabling) {
        await maybeReleaseYouTubePermission();
      }
      await renderAll();
    });
    toggle.appendChild(checkbox);

    const track = document.createElement('span');
    track.className = 'switch-track';
    track.setAttribute('aria-hidden', 'true');
    const thumb = document.createElement('span');
    thumb.className = 'switch-thumb';
    track.appendChild(thumb);
    toggle.appendChild(track);

    row.appendChild(toggle);

    const info = document.createElement('div');
    info.className = 'rule-info';

    const labelLine = document.createElement('div');
    labelLine.className = 'rule-label';

    const labelText = document.createElement('span');
    labelText.className = 'rule-label-text';
    labelText.textContent = rule.label || '';
    labelLine.appendChild(labelText);

    const editLabelBtn = document.createElement('button');
    editLabelBtn.type = 'button';
    editLabelBtn.className = 'icon-btn';
    editLabelBtn.title = 'Rename';
    editLabelBtn.setAttribute('aria-label', `Rename "${rule.label}"`);
    editLabelBtn.innerHTML = EDIT_ICON_SVG;
    editLabelBtn.addEventListener('click', () => {
      startLabelEdit(labelLine, labelText, async (newLabel) => {
        await RulesStore.updateRule(rule.id, { label: newLabel });
        rule.label = newLabel;
        editLabelBtn.setAttribute('aria-label', `Rename "${newLabel}"`);
      });
    });
    labelLine.appendChild(editLabelBtn);

    info.appendChild(labelLine);

    row.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'rule-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit details';
    editBtn.addEventListener('click', () => enterEditMode(rule));
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      const confirmed = window.confirm(`Delete rule "${rule.label}"?`);
      if (!confirmed) return;
      await RulesStore.deleteRule(rule.id);
      if (editingRuleId === rule.id) {
        resetFormToAddMode();
      }
      await renderAll();
    });
    actions.appendChild(deleteBtn);

    row.appendChild(actions);

    return row;
  }

  function highlightRule(ruleId) {
    if (!ruleId) return;
    const row = document.querySelector(`[data-rule-id="${ruleId}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    row.classList.add('just-added');
    setTimeout(() => row.classList.remove('just-added'), 2000);
  }

  // --- Element picker ---

  async function onPickElementClick() {
    hidePickerCandidates();
    clearPickerStatusTimer();
    showPickerStatus('Picking active — click the target element on the page (Esc to cancel).');
    pickElementBtn.disabled = true;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        throw new Error('No active tab');
      }
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/picker.js'],
      });
    } catch (err) {
      showPickerStatus('Could not start the picker on this page.');
      pickElementBtn.disabled = false;
    }
  }

  function onRuntimeMessage(message) {
    if (!message || typeof message !== 'object') {
      return;
    }

    if (message.type === 'picker-auto-saved') {
      // Rare: popup stayed open through the pick. background.js has already
      // saved, so just read the same pending record a fresh open would.
      pickElementBtn.disabled = false;
      hidePickerStatus();
      checkPendingPickerResult();
    } else if (message.type === 'picker-cancelled') {
      pickElementBtn.disabled = false;
      showPickerStatus('Picking cancelled.');
      clearPickerStatusTimer();
      pickerStatusTimer = setTimeout(hidePickerStatus, 2000);
    }
  }

  function showPickerStatus(text) {
    pickerStatusEl.textContent = text;
    pickerStatusEl.hidden = false;
  }

  function hidePickerStatus() {
    clearPickerStatusTimer();
    pickerStatusEl.hidden = true;
    pickerStatusEl.textContent = '';
  }

  function clearPickerStatusTimer() {
    if (pickerStatusTimer) {
      clearTimeout(pickerStatusTimer);
      pickerStatusTimer = null;
    }
  }

  function hidePickerCandidates() {
    pickerCandidatesEl.hidden = true;
    pickerCandidatesEl.innerHTML = '';
  }

  function showNoCandidatesMessage() {
    switchPanel('panel-add-rule');
    showPickerStatus("Couldn't find a clickable element there — try again, or enter it manually below.");
    setAdvancedOpen(true);
  }

  // background.js already auto-saved the best match — this confirms it and
  // offers other candidates as a "not the right one?" fallback.
  function renderPickerConfirmation(pending) {
    pickerCandidatesEl.innerHTML = '';
    pickerCandidatesEl.hidden = false;

    const fragile = pending.savedMatchType === 'css-selector';
    const caveat = fragile
      ? " — this page didn't expose a more reliable identifier, so this may break if the site redesigns."
      : '';
    clearPickerStatusTimer();
    showPickerStatus(`"${pending.savedLabel}" added using ${pending.savedMatchType} ✓${caveat}`);
    pickerStatusTimer = setTimeout(hidePickerStatus, 5000);

    const alternatives = (pending.candidates || []).filter(
      (candidate) =>
        !(candidate.matchType === pending.savedMatchType && candidate.matchValue === pending.savedMatchValue)
    );

    if (alternatives.length === 0) {
      pickerCandidatesEl.hidden = true;
      return;
    }

    const details = document.createElement('details');
    details.className = 'alt-match-section';

    const summary = document.createElement('summary');
    summary.textContent = 'Not the right button? Choose a different match';
    details.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'alt-match-list';
    alternatives.forEach((candidate) => {
      list.appendChild(buildAlternativeRow(candidate, pending));
    });
    details.appendChild(list);

    pickerCandidatesEl.appendChild(details);
  }

  // Shared by the post-save "not the right one?" list (updates the saved
  // rule) and the manual-selection list (creates one fresh) — they differ
  // only in button label and click behavior.
  function buildCandidateRow(candidate, { buttonLabel, onUse, recommended }) {
    const row = document.createElement('div');
    row.className = 'alt-match-row';

    const info = document.createElement('div');
    info.className = 'alt-match-info';

    const line = document.createElement('div');
    line.className = 'alt-match-line';

    if (recommended) {
      const recBadge = document.createElement('span');
      recBadge.className = 'badge badge-recommended';
      recBadge.textContent = 'Recommended';
      line.appendChild(recBadge);
    }

    const typeBadge = document.createElement('span');
    typeBadge.className = 'badge';
    typeBadge.textContent = candidate.matchType;
    line.appendChild(typeBadge);

    const explanation = MATCH_TYPE_INFO[candidate.matchType] || '';
    const infoBtn = document.createElement('button');
    infoBtn.type = 'button';
    infoBtn.className = 'icon-btn';
    infoBtn.title = explanation;
    infoBtn.setAttribute('aria-label', `About ${candidate.matchType} matching: ${explanation}`);
    infoBtn.innerHTML = INFO_ICON_SVG;
    line.appendChild(infoBtn);

    info.appendChild(line);

    const valueLine = document.createElement('div');
    valueLine.className = 'picker-candidate-value';
    valueLine.textContent =
      candidate.matchType === 'data-attribute'
        ? `${candidate.dataAttrName || ''}="${candidate.matchValue}"`
        : candidate.matchValue;
    info.appendChild(valueLine);

    row.appendChild(info);

    const useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.className = 'link-btn';
    useBtn.textContent = buttonLabel;
    useBtn.addEventListener('click', () => {
      useBtn.disabled = true;
      onUse().catch(() => {
        useBtn.disabled = false;
      });
    });
    row.appendChild(useBtn);

    return row;
  }

  function buildAlternativeRow(candidate, pending) {
    return buildCandidateRow(candidate, {
      buttonLabel: 'Use this instead',
      onUse: () => useAlternativeMatch(candidate, pending),
    });
  }

  async function useAlternativeMatch(candidate, pending) {
    const patch = {
      matchType: candidate.matchType,
      matchValue: candidate.matchValue,
      dataAttrName: candidate.matchType === 'data-attribute' ? candidate.dataAttrName || '' : '',
    };
    await RulesStore.updateRule(pending.savedRuleId, patch);

    hidePickerCandidates();
    clearPickerStatusTimer();
    showPickerStatus(`Updated "${pending.savedLabel}" to match using ${candidate.matchType} ✓`);
    pickerStatusTimer = setTimeout(hidePickerStatus, 2500);

    await renderAll();
    highlightRule(pending.savedRuleId);
  }

  // "Choose match manually" flow: nothing saved yet — every candidate is
  // offered up front (first flagged as the one auto-save would've used).
  function renderPickerSelection(pending) {
    const candidates = pending.candidates || [];

    clearPickerStatusTimer();
    pickerStatusEl.textContent = `Choose which match to use (${candidates.length} found):`;
    pickerStatusEl.hidden = false;

    pickerCandidatesEl.innerHTML = '';
    pickerCandidatesEl.hidden = false;

    const list = document.createElement('div');
    list.className = 'alt-match-list';
    candidates.forEach((candidate, index) => {
      list.appendChild(buildSelectableCandidateRow(candidate, pending, index === 0));
    });
    pickerCandidatesEl.appendChild(list);
  }

  function buildSelectableCandidateRow(candidate, pending, recommended) {
    return buildCandidateRow(candidate, {
      buttonLabel: 'Use this',
      recommended,
      onUse: () => useSelectedCandidate(candidate, pending),
    });
  }

  async function useSelectedCandidate(candidate, pending) {
    const patch = {
      site: pending.site || candidate.site || '',
      label: candidate.label || 'Picked element',
      matchType: candidate.matchType,
      matchValue: candidate.matchValue,
      dataAttrName: candidate.matchType === 'data-attribute' ? candidate.dataAttrName || '' : '',
      source: 'picker',
    };
    const newRule = await RulesStore.addRule(patch);

    hidePickerCandidates();
    clearPickerStatusTimer();
    showPickerStatus(`"${patch.label}" added using ${patch.matchType} ✓`);
    pickerStatusTimer = setTimeout(hidePickerStatus, 3000);
    chrome.action.setBadgeText({ text: '' });

    await renderAll();
    switchPanel(currentHostname && currentHostname.includes(patch.site) ? 'panel-current-site' : 'panel-other-sites');
    highlightRule(newRule.id);
  }

  // Swaps labelText for an inline input; onCommit fires with the new value
  // on a real change.
  function startLabelEdit(labelLine, labelText, onCommit) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-label-input';
    input.value = labelText.textContent;
    labelLine.replaceChild(input, labelText);
    input.focus();
    input.select();

    function commit() {
      const newValue = input.value.trim() || labelText.textContent;
      const changed = newValue !== labelText.textContent;
      labelText.textContent = newValue;
      if (input.parentNode === labelLine) {
        labelLine.replaceChild(labelText, input);
      }
      if (changed && onCommit) {
        onCommit(newValue);
      }
    }

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      } else if (event.key === 'Escape') {
        input.value = labelText.textContent;
        input.blur();
      }
    });
  }

  // --- Form handling ---

  function enterEditMode(rule) {
    switchPanel('panel-add-rule');
    editingRuleId = rule.id;
    fieldId.value = rule.id;
    fieldSite.value = rule.site || '';
    fieldLabel.value = rule.label || '';
    fieldMatchType.value = rule.matchType || 'aria-label';
    fieldMatchValue.value = rule.matchValue || '';
    fieldDataAttrName.value = rule.dataAttrName || '';

    updateDataAttrVisibility();
    clearAllFieldErrors();

    formHeading.textContent = 'Edit rule';
    formSubmitBtn.textContent = 'Save changes';
    formCancelBtn.hidden = false;
    setAdvancedOpen(true);

    advancedSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    fieldLabel.focus();
  }

  function resetFormToAddMode() {
    editingRuleId = null;
    ruleForm.reset();
    fieldId.value = '';
    fieldSite.value = currentHostname || '';
    updateDataAttrVisibility();
    clearAllFieldErrors();

    formHeading.textContent = 'Add a skip rule';
    formSubmitBtn.textContent = 'Add rule';
    formCancelBtn.hidden = true;
    setAdvancedOpen(false);
  }

  function clearAllFieldErrors() {
    setFieldError(fieldSite, fieldSiteError, '');
    setFieldError(fieldLabel, fieldLabelError, '');
    setFieldError(fieldMatchValue, fieldMatchValueError, '');
  }

  function setFieldError(inputEl, errorEl, message) {
    if (message) {
      inputEl.classList.add('field-invalid');
      errorEl.textContent = message;
      errorEl.hidden = false;
    } else {
      inputEl.classList.remove('field-invalid');
      errorEl.textContent = '';
      errorEl.hidden = true;
    }
  }

  async function onFormSubmit(event) {
    event.preventDefault();

    const patch = {
      site: fieldSite.value.trim(),
      label: fieldLabel.value.trim(),
      matchType: fieldMatchType.value,
      matchValue: fieldMatchValue.value.trim(),
      dataAttrName: fieldMatchType.value === 'data-attribute' ? fieldDataAttrName.value.trim() : '',
    };

    setFieldError(fieldSite, fieldSiteError, patch.site ? '' : 'Enter the site this rule applies to.');
    setFieldError(fieldLabel, fieldLabelError, patch.label ? '' : 'Give this rule a label.');
    setFieldError(fieldMatchValue, fieldMatchValueError, patch.matchValue ? '' : 'Enter a match value.');

    const firstInvalid = [
      [patch.site, fieldSite],
      [patch.label, fieldLabel],
      [patch.matchValue, fieldMatchValue],
    ].find(([value]) => !value);

    if (firstInvalid) {
      setAdvancedOpen(true);
      firstInvalid[1].focus();
      return;
    }

    let deniedYouTube = false;
    const savedRule = editingRuleId
      ? await RulesStore.updateRule(editingRuleId, patch)
      : await RulesStore.addRule(patch);

    if (siteNeedsOptionalPermission(savedRule.site) && savedRule.enabled) {
      const granted = await ensureSitePermission(savedRule.site);
      if (!granted) {
        await RulesStore.updateRule(savedRule.id, { enabled: false });
        deniedYouTube = true;
      }
    }

    resetFormToAddMode();
    await renderAll();
    if (deniedYouTube) {
      announce('Rule saved but left off — YouTube access was declined. Toggle it on to grant access.');
    } else {
      switchPanel(currentHostname && currentHostname.includes(patch.site) ? 'panel-current-site' : 'panel-other-sites');
    }
  }
})();

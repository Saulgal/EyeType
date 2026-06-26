// js/app.js — Main orchestrator: state machine, event wiring, UI updates

window.App = (function () {
  'use strict';

  // ─── State ─────────────────────────────────────────────────────────────────
  let appText  = '';   // current composed message
  let isSpeaking = false;

  // ─── DOM refs ─────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);

  let videoEl, gazeDot, textOutput, speakBtn, clearBtn;
  let suggestionsRow, phrasesPanel, keyboardContainer;
  let statusBadge, settingsModal, langSelector;

  // ─── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    // Grab DOM refs
    videoEl          = $('webcam');
    gazeDot          = $('gaze-dot');
    textOutput       = $('text-output');
    speakBtn         = $('btn-speak');
    clearBtn         = $('btn-clear');
    suggestionsRow   = $('suggestions-row');
    phrasesPanel     = $('phrases-panel');
    keyboardContainer= $('keyboard-container');
    statusBadge      = $('eye-status');

    // Apply initial language to UI
    applyLanguageToUI();

    // Render keyboard
    Keyboard.render(keyboardContainer);

    // Wire keyboard
    Keyboard.setOnKeySelect(handleKey);

    // Render quick phrases
    renderPhrases();

    // Wire speak / clear buttons
    speakBtn.addEventListener('click', speakText);
    clearBtn.addEventListener('click', clearText);

    // Settings modal wiring
    wireSettings();

    // Language change listener
    document.addEventListener('languagechange', () => {
      applyLanguageToUI();
      Keyboard.refreshLabels();
      renderPhrases();
      updateSuggestions();
    });

    // Keyboard fallback: Space = confirm, Escape = clear
    document.addEventListener('keydown', e => {
      if (settingsModal && settingsModal.classList.contains('open')) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        EyeTracker.triggerConfirm();
        Keyboard.onConfirm();
      }
      if (e.key === 'Escape') clearText();
    });

    // Show loading screen
    showScreen('loading');

    // Check for saved calibration
    try {
      await startEyeTracker();

      if (Calibration.hasSaved()) {
        Calibration.loadSaved();
        showScreen('app');
      } else {
        showScreen('calibration');
        Calibration.start(() => {
          // CRITICAL: calibration overwrites onGaze/onConfirm — restore them now
          wireAppHandlers();
          showScreen('app');
        });
      }
    } catch (err) {
      console.error('EyeTracker init failed:', err);
      showError(err);
    }
  }

  // ─── App-level EyeTracker handlers ────────────────────────────────────────
  // Extracted so they can be RE-APPLIED after calibration (which overwrites them)
  function wireAppHandlers() {
    EyeTracker.setOnGaze((x, y) => {
      // Move gaze cursor dot on screen
      gazeDot.style.left = x + 'px';
      gazeDot.style.top  = y + 'px';
      // Pass to keyboard for proximity highlight + dwell
      Keyboard.onGaze(x, y);
    });

    EyeTracker.setOnConfirm(() => {
      Keyboard.onConfirm();
    });
  }

  // ─── Eye tracker startup ──────────────────────────────────────────────────
  async function startEyeTracker() {
    // Wire app-level event handlers
    wireAppHandlers();

    EyeTracker.setOnStatus(status => {
      updateStatus(status);
    });

    // Start camera + FaceMesh
    await EyeTracker.init(videoEl);
  }

  // ─── Screen management ────────────────────────────────────────────────────
  function showScreen(name) {
    ['loading-screen', 'calibration-screen', 'app-screen'].forEach(id => {
      const el = $(id);
      if (el) el.classList.remove('visible');
    });
    const target = $(name === 'app' ? 'app-screen' : name === 'calibration' ? 'calibration-screen' : 'loading-screen');
    if (target) {
      setTimeout(() => target.classList.add('visible'), 50);
    }
  }

  function showError(err) {
    const el = $('loading-screen');
    if (!el) return;
    const hint = el.querySelector('.loading-hint');
    if (hint) {
      const msg = err && err.name === 'NotAllowedError'
        ? I18n.t('permissionDenied')
        : err && err.name === 'NotFoundError'
        ? I18n.t('noCamera')
        : (err && err.message) || 'Unknown error';
      hint.textContent = msg;
      hint.style.color = '#ff6b6b';
    }
  }

  // ─── Key handler ─────────────────────────────────────────────────────────
  function handleKey(key) {
    if (key === 'BACKSPACE') {
      appText = appText.slice(0, -1);
    } else if (key === 'CLEAR_WORD') {
      // Remove last word
      appText = appText.replace(/\S+\s*$/, '');
    } else {
      appText += key;
    }
    renderText();
    updateSuggestions();
  }

  function handleSuggestion(word) {
    appText = Words.applyWord(appText, word);
    renderText();
    updateSuggestions();
  }

  function handlePhrase(text) {
    appText += (appText.length > 0 && !appText.endsWith(' ') ? ' ' : '') + text + ' ';
    renderText();
    updateSuggestions();
  }

  // ─── Text output ─────────────────────────────────────────────────────────
  function renderText() {
    if (!textOutput) return;
    textOutput.textContent = appText || '';
    textOutput.scrollTop = textOutput.scrollHeight;
    const placeholder = $('text-placeholder');
    if (placeholder) placeholder.style.display = appText ? 'none' : 'block';
  }

  function clearText() {
    appText = '';
    renderText();
    updateSuggestions();
    TTS.stop();
  }

  function speakText() {
    if (!appText.trim()) return;
    if (isSpeaking) { TTS.stop(); isSpeaking = false; speakBtn.classList.remove('speaking'); return; }
    isSpeaking = true;
    speakBtn.classList.add('speaking');
    TTS.speak(appText, null, () => {
      isSpeaking = false;
      speakBtn.classList.remove('speaking');
    });
  }

  // ─── Word suggestions ─────────────────────────────────────────────────────
  function updateSuggestions() {
    if (!suggestionsRow) return;
    const prefix = Words.getCurrentPrefix(appText);
    const words  = Words.getSuggestions(prefix);
    suggestionsRow.innerHTML = '';

    words.forEach(word => {
      const btn = document.createElement('button');
      btn.className = 'suggestion-btn';
      btn.textContent = word;
      btn.addEventListener('click', () => handleSuggestion(word));
      // Gaze dwell on suggestions (reuse keyboard gaze via mouse proximity)
      suggestionsRow.appendChild(btn);
    });

    $('suggestions-label').style.opacity = words.length ? '1' : '0.3';
  }

  // ─── Quick phrases panel ─────────────────────────────────────────────────
  function renderPhrases() {
    if (!phrasesPanel) return;
    const phrases = I18n.getCurrentLanguage().quickPhrases || [];
    phrasesPanel.innerHTML = '';
    phrases.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'phrase-btn';
      btn.innerHTML = `<span class="phrase-emoji">${p.emoji}</span><span class="phrase-text">${p.text}</span>`;
      btn.title = p.text;
      btn.addEventListener('click', () => handlePhrase(p.text));
      phrasesPanel.appendChild(btn);
    });
  }

  // ─── Status indicator ────────────────────────────────────────────────────
  function updateStatus(status) {
    if (!statusBadge) return;
    statusBadge.className = 'eye-status ' + status;
    const labels = { tracking: I18n.t('statusTracking'), lost: I18n.t('statusLost'), init: I18n.t('statusInit') };
    statusBadge.textContent = labels[status] || status;
  }

  // ─── Settings modal ──────────────────────────────────────────────────────
  function wireSettings() {
    settingsModal = $('settings-modal');
    const openBtn  = $('btn-settings');
    const closeBtn = $('settings-close');

    if (openBtn)  openBtn.addEventListener('click',  () => openSettings());
    if (closeBtn) closeBtn.addEventListener('click', () => closeSettings());

    // Sliders
    const volSlider   = $('vol-slider');
    const rateSlider  = $('rate-slider');
    const dwellSlider = $('dwell-slider');

    if (volSlider) {
      volSlider.value = TTS.getSettings().volume;
      volSlider.addEventListener('input', e => TTS.setVolume(parseFloat(e.target.value)));
    }
    if (rateSlider) {
      rateSlider.value = TTS.getSettings().rate;
      rateSlider.addEventListener('input', e => TTS.setRate(parseFloat(e.target.value)));
    }
    if (dwellSlider) {
      dwellSlider.value = Keyboard.getDwellMs();
      dwellSlider.addEventListener('input', e => Keyboard.setDwellMs(parseInt(e.target.value, 10)));
    }

    // Input mode
    const modeSelect = $('mode-select');
    if (modeSelect) {
      modeSelect.value = Keyboard.getInputMode();
      modeSelect.addEventListener('change', e => Keyboard.setInputMode(e.target.value));
    }

    // Language buttons
    langSelector = $('lang-selector');
    renderLangButtons();

    // Recalibrate
    const recalBtn = $('btn-recalibrate');
    if (recalBtn) {
      recalBtn.addEventListener('click', () => {
        closeSettings();
        Calibration.clearSaved();
        showScreen('calibration');
        Calibration.start(() => showScreen('app'));
      });
    }

    // Skip calibration (use saved)
    const skipCalibBtn = $('btn-skip-calib');
    if (skipCalibBtn) {
      skipCalibBtn.addEventListener('click', () => {
        if (Calibration.hasSaved()) {
          Calibration.loadSaved();
        }
        showScreen('app');
      });
    }
  }

  function renderLangButtons() {
    if (!langSelector) return;
    langSelector.innerHTML = '';
    I18n.getLanguageList().forEach(lang => {
      const btn = document.createElement('button');
      btn.className = 'lang-btn' + (lang.code === I18n.currentCode ? ' active' : '');
      btn.textContent = lang.flag + ' ' + lang.name;
      btn.addEventListener('click', () => {
        I18n.setLanguage(lang.code);
        renderLangButtons(); // refresh active state
      });
      langSelector.appendChild(btn);
    });
  }

  function openSettings() {
    if (settingsModal) settingsModal.classList.add('open');
  }
  function closeSettings() {
    if (settingsModal) settingsModal.classList.remove('open');
  }

  // ─── Language UI update ──────────────────────────────────────────────────
  function applyLanguageToUI() {
    const t = I18n.t.bind(I18n);
    const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
    const setP = (id, txt) => { const el = $(id); if (el) el.placeholder = txt; };

    set('app-title',        t('appTitle'));
    set('btn-speak',        t('speak'));
    set('btn-clear',        t('clear'));
    set('suggestions-label',t('suggestions'));
    set('phrases-heading',  t('quickPhrases'));
    set('setting-lang',     t('language'));
    set('setting-vol',      t('volume'));
    set('setting-rate',     t('speed'));
    set('setting-dwell',    t('dwellTime'));
    set('setting-mode',     t('inputMode'));
    set('btn-recalibrate',  t('recalibrate'));
    set('settings-close',   t('close'));
    set('loading-title',    t('loading'));
    set('loading-hint',     t('loadingHint'));
    set('calib-title',      t('calibrationTitle'));
    set('calib-instruction',t('calibrationInstructions'));

    const placeholder = $('text-placeholder');
    if (placeholder) placeholder.textContent = t('textPlaceholder');

    // Mode select options
    const modeSelect = $('mode-select');
    if (modeSelect) {
      modeSelect.options[0].text = t('modeDwell');
      modeSelect.options[1].text = t('modeBlink');
      modeSelect.options[2].text = t('modeBoth');
    }

    updateStatus(EyeTracker.getStatus());
  }

  return { init };
})();

// Boot when DOM is ready
document.addEventListener('DOMContentLoaded', App.init);

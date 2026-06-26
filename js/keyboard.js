// js/keyboard.js — On-screen QWERTY keyboard with gaze proximity highlighting and dwell timer

window.Keyboard = (function () {
  'use strict';

  // ─── Layout ────────────────────────────────────────────────────────────────
  const ROWS = [
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['z','x','c','v','b','n','m','BACK'],
    ['SPACE', 'CLEAR'],
  ];

  // ─── Config ────────────────────────────────────────────────────────────────
  let DWELL_MS       = parseInt(localStorage.getItem('eyetype_dwell') || '1500', 10);
  let INPUT_MODE     = localStorage.getItem('eyetype_mode') || 'both'; // 'dwell'|'blink'|'both'

  // ─── State ─────────────────────────────────────────────────────────────────
  let gazeX = 0, gazeY = 0;
  let hoveredKey   = null;
  let dwellStart   = null;
  let dwellTimer   = null;
  let onKeySelect  = null;     // callback(key: string)
  let keyElements  = {};       // key → DOM element
  let rafId        = null;

  // ─── Rendering ────────────────────────────────────────────────────────────
  function getLabel(key) {
    const t = window.I18n.t;
    if (key === 'BACK')  return t('backspace');
    if (key === 'SPACE') return t('space');
    if (key === 'CLEAR') return t('clear_word');
    return key.toUpperCase();
  }

  function render(containerEl) {
    containerEl.innerHTML = '';
    keyElements = {};

    ROWS.forEach((row, rowIdx) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'kb-row';
      if (rowIdx === 1) rowEl.style.paddingLeft = '2%';
      if (rowIdx === 2) rowEl.style.paddingLeft = '4%';

      row.forEach(key => {
        const btn = document.createElement('div');
        btn.className = 'kb-key';
        btn.dataset.key = key;

        if (key === 'SPACE') btn.classList.add('key-space');
        if (key === 'BACK')  btn.classList.add('key-back');
        if (key === 'CLEAR') btn.classList.add('key-clear');

        // Label
        const label = document.createElement('span');
        label.className = 'kb-label';
        label.textContent = getLabel(key);
        btn.appendChild(label);

        // Dwell progress ring (SVG)
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('dwell-ring');
        svg.setAttribute('viewBox', '0 0 36 36');
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', '18');
        circle.setAttribute('cy', '18');
        circle.setAttribute('r',  '15');
        circle.setAttribute('stroke-dasharray', '94 94');
        circle.setAttribute('stroke-dashoffset', '94');
        svg.appendChild(circle);
        btn.appendChild(svg);

        // Mouse click (fallback / accessibility)
        btn.addEventListener('click', () => selectKey(key));

        keyElements[key] = btn;
        rowEl.appendChild(btn);
      });

      containerEl.appendChild(rowEl);
    });
  }

  function reRenderLabels() {
    for (const key of Object.keys(keyElements)) {
      const label = keyElements[key].querySelector('.kb-label');
      if (label) label.textContent = getLabel(key);
    }
  }

  // ─── Gaze processing loop ──────────────────────────────────────────────────
  function updateGaze(x, y) {
    gazeX = x;
    gazeY = y;
    if (!rafId) rafId = requestAnimationFrame(processGaze);
  }

  function processGaze() {
    rafId = null;
    if (INPUT_MODE === 'blink') return; // dwell disabled

    const nearest = findNearestKey(gazeX, gazeY);

    if (nearest !== hoveredKey) {
      clearDwell();
      if (hoveredKey && keyElements[hoveredKey]) {
        keyElements[hoveredKey].classList.remove('hovered');
      }
      hoveredKey = nearest;
      if (nearest && keyElements[nearest]) {
        keyElements[nearest].classList.add('hovered');
        startDwell(nearest);
      }
    } else if (nearest) {
      updateDwellProgress(nearest);
    }
  }

  function findNearestKey(x, y) {
    let minDist = Infinity;
    let nearestKey = null;
    const THRESHOLD_PX = 80; // max distance to consider "looking at" a key

    for (const [key, el] of Object.entries(keyElements)) {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width  / 2;
      const cy = rect.top  + rect.height / 2;
      const d  = Math.hypot(x - cx, y - cy);
      if (d < minDist && d < THRESHOLD_PX) {
        minDist = d;
        nearestKey = key;
      }
    }
    return nearestKey;
  }

  // ─── Dwell timer ──────────────────────────────────────────────────────────
  function startDwell(key) {
    dwellStart = Date.now();
    dwellTimer = setInterval(() => updateDwellProgress(key), 50);
  }

  function updateDwellProgress(key) {
    if (!dwellStart || INPUT_MODE === 'blink') return;
    const elapsed = Date.now() - dwellStart;
    const pct     = Math.min(elapsed / DWELL_MS, 1);
    const el      = keyElements[key];
    if (!el) return;

    const circle = el.querySelector('.dwell-ring circle');
    if (circle) {
      const circumference = 94;
      const offset = circumference * (1 - pct);
      circle.setAttribute('stroke-dashoffset', offset.toString());
    }

    if (pct >= 1 && INPUT_MODE !== 'blink') {
      clearDwell();
      selectKey(key);
    }
  }

  function clearDwell() {
    if (dwellTimer) { clearInterval(dwellTimer); dwellTimer = null; }
    dwellStart = null;

    // Reset all rings
    for (const el of Object.values(keyElements)) {
      const circle = el.querySelector('.dwell-ring circle');
      if (circle) circle.setAttribute('stroke-dashoffset', '94');
    }
  }

  // ─── Key selection ────────────────────────────────────────────────────────
  function selectKey(key) {
    if (!keyElements[key]) return;

    // Visual flash
    const el = keyElements[key];
    el.classList.add('selected');
    setTimeout(() => el.classList.remove('selected'), 300);

    // Dispatch
    if (onKeySelect) {
      let value;
      if (key === 'BACK')  value = 'BACKSPACE';
      else if (key === 'SPACE') value = ' ';
      else if (key === 'CLEAR') value = 'CLEAR_WORD';
      else value = key;
      onKeySelect(value);
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────
  function onGaze(x, y)          { updateGaze(x, y); }
  function onConfirm()           { if (hoveredKey) selectKey(hoveredKey); }
  function setOnKeySelect(cb)    { onKeySelect = cb; }
  function setDwellMs(ms)        { DWELL_MS = ms; localStorage.setItem('eyetype_dwell', ms); }
  function setInputMode(mode)    { INPUT_MODE = mode; localStorage.setItem('eyetype_mode', mode); clearDwell(); }
  function getDwellMs()          { return DWELL_MS; }
  function getInputMode()        { return INPUT_MODE; }

  // Called after language change to refresh button labels
  function refreshLabels()       { reRenderLabels(); }

  return { render, onGaze, onConfirm, setOnKeySelect, setDwellMs, setInputMode, getDwellMs, getInputMode, refreshLabels };
})();

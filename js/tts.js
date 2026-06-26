// js/tts.js — Text-to-Speech using the Web Speech API (free, no server needed)

window.TTS = (function () {
  'use strict';

  const synth = window.speechSynthesis;
  let voices = [];
  let settings = {
    volume: parseFloat(localStorage.getItem('eyetype_tts_volume') || '1'),
    rate:   parseFloat(localStorage.getItem('eyetype_tts_rate')   || '0.9'),
    pitch:  parseFloat(localStorage.getItem('eyetype_tts_pitch')  || '1'),
  };

  // Load available voices (async in many browsers)
  function loadVoices() {
    voices = synth.getVoices();
  }
  loadVoices();
  if (synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = loadVoices;
  }

  /**
   * Find the best voice for a given BCP-47 language code.
   * Falls back gracefully: exact match → language prefix → first available.
   */
  function findVoice(langCode) {
    if (!voices.length) voices = synth.getVoices();
    const prefix = langCode.split('-')[0].toLowerCase();

    // 1. Exact match
    let voice = voices.find(v => v.lang.toLowerCase() === langCode.toLowerCase());
    // 2. Language prefix match
    if (!voice) voice = voices.find(v => v.lang.toLowerCase().startsWith(prefix));
    // 3. Any voice
    return voice || voices[0] || null;
  }

  /**
   * Speak text in a given language (or current app language).
   * @param {string} text        - text to speak
   * @param {string} [langCode]  - BCP-47 code, defaults to current I18n language
   * @param {Function} [onEnd]   - callback when speech ends
   */
  function speak(text, langCode, onEnd) {
    if (!text || !synth) return;
    synth.cancel(); // stop any ongoing speech

    const lang = langCode || (window.I18n ? window.I18n.getCurrentLanguage().voiceLang : 'en-US');
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang   = lang;
    utterance.volume = settings.volume;
    utterance.rate   = settings.rate;
    utterance.pitch  = settings.pitch;

    const voice = findVoice(lang);
    if (voice) utterance.voice = voice;

    if (typeof onEnd === 'function') utterance.onend = onEnd;

    synth.speak(utterance);
  }

  /** Stop any currently playing speech */
  function stop() {
    if (synth) synth.cancel();
  }

  /** Update volume (0–1) and persist */
  function setVolume(v) {
    settings.volume = Math.max(0, Math.min(1, v));
    localStorage.setItem('eyetype_tts_volume', settings.volume);
  }

  /** Update speech rate (0.1–3) and persist */
  function setRate(r) {
    settings.rate = Math.max(0.1, Math.min(3, r));
    localStorage.setItem('eyetype_tts_rate', settings.rate);
  }

  function getSettings() { return { ...settings }; }

  function isSupported() {
    return 'speechSynthesis' in window;
  }

  return { speak, stop, setVolume, setRate, getSettings, isSupported, findVoice };
})();

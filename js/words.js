// js/words.js — Word prediction (prefix matching from embedded language dictionary)

window.Words = (function () {
  'use strict';

  const MAX_SUGGESTIONS = 6;

  /**
   * Get word suggestions for a given prefix in the current language.
   * @param {string} prefix  - characters typed so far (last word fragment)
   * @returns {string[]}     - up to MAX_SUGGESTIONS words starting with prefix
   */
  function getSuggestions(prefix) {
    if (!prefix || prefix.trim() === '') return [];
    const p = prefix.toLowerCase().trim();
    const words = window.I18n.getCurrentLanguage().words || [];
    const matches = words.filter(w => w.startsWith(p) && w !== p);
    return matches.slice(0, MAX_SUGGESTIONS);
  }

  /**
   * Extract the current word fragment from a text string
   * (everything after the last space).
   * @param {string} text
   * @returns {string}
   */
  function getCurrentPrefix(text) {
    if (!text) return '';
    const parts = text.split(/\s+/);
    return parts[parts.length - 1] || '';
  }

  /**
   * Replace the current word fragment with the selected suggestion.
   * @param {string} text       - full text so far
   * @param {string} suggestion - word selected
   * @returns {string}          - updated text with trailing space
   */
  function applyWord(text, suggestion) {
    const parts = text.split(/\s+/);
    parts[parts.length - 1] = suggestion;
    return parts.join(' ') + ' ';
  }

  return { getSuggestions, getCurrentPrefix, applyWord };
})();

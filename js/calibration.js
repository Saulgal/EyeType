// js/calibration.js — 9-point gaze calibration with affine transform + localStorage

window.Calibration = (function () {
  'use strict';

  const STORAGE_KEY   = 'eyetype_calibration';
  const NUM_DOTS      = 9;
  const DOTS_PER_ROW  = 3;
  const MARGIN_PCT    = 0.10;  // 10% margin from edge

  // 3×3 grid of normalized screen positions
  const GRID_POSITIONS = (() => {
    const pts = [];
    for (let row = 0; row < DOTS_PER_ROW; row++) {
      for (let col = 0; col < DOTS_PER_ROW; col++) {
        pts.push({
          nx: MARGIN_PCT + col * ((1 - 2 * MARGIN_PCT) / (DOTS_PER_ROW - 1)),
          ny: MARGIN_PCT + row * ((1 - 2 * MARGIN_PCT) / (DOTS_PER_ROW - 1)),
        });
      }
    }
    return pts;
  })();

  // ─── Calibration state ─────────────────────────────────────────────────────
  let currentDotIndex = 0;
  let rawData         = [];   // { irisX, irisY, screenX, screenY }
  let currentIrisX    = 0.5;
  let currentIrisY    = 0.5;
  let onDone          = null;
  let confirmTimeout  = null;

  let pulseInterval   = null;

  // UI elements
  let overlay, dotEl, progressText, instructionText;

  // ─── Least-squares affine transform ───────────────────────────────────────
  // Fits: screen_x = ax*iris_x + ay*iris_y + az
  //       screen_y = bx*iris_x + by*iris_y + bz
  function fitAffine(points) {
    // Build design matrix X (N×3) and targets Yx, Yy (N)
    const N = points.length;
    // X = [iris_x, iris_y, 1]
    // Use normal equations: β = (X^T X)^{-1} X^T y

    function solve(targets) {
      // Accumulate X^T X (3×3) and X^T y (3)
      let A = [[0,0,0],[0,0,0],[0,0,0]];
      let b = [0,0,0];
      for (const pt of points) {
        const row = [pt.irisX, pt.irisY, 1];
        const y   = targets === 'x' ? pt.screenX : pt.screenY;
        for (let i = 0; i < 3; i++) {
          b[i] += row[i] * y;
          for (let j = 0; j < 3; j++) {
            A[i][j] += row[i] * row[j];
          }
        }
      }
      // Gaussian elimination (3×3 system)
      return gaussianElim(A, b);
    }

    const [ax, ay, az] = solve('x');
    const [bx, by, bz] = solve('y');
    return { ax, ay, az, bx, by, bz };
  }

  function gaussianElim(A, b) {
    const n = 3;
    const M = A.map((row, i) => [...row, b[i]]);  // augmented matrix

    for (let col = 0; col < n; col++) {
      // Partial pivot
      let maxRow = col;
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
      }
      [M[col], M[maxRow]] = [M[maxRow], M[col]];

      if (Math.abs(M[col][col]) < 1e-10) continue; // singular

      for (let row = col + 1; row < n; row++) {
        const factor = M[row][col] / M[col][col];
        for (let k = col; k <= n; k++) {
          M[row][k] -= factor * M[col][k];
        }
      }
    }

    // Back substitution
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      x[i] = M[i][n] / M[i][i];
      for (let k = i - 1; k >= 0; k--) {
        M[k][n] -= M[k][i] * x[i];
      }
    }
    return x;
  }

  // ─── UI helpers ────────────────────────────────────────────────────────────
  function createOverlay() {
    overlay = document.getElementById('calibration-screen');
    dotEl   = document.getElementById('calib-dot');
    progressText    = document.getElementById('calib-progress');
    instructionText = document.getElementById('calib-instruction');
    // progressRing not used in current design (no SVG ring in calib screen)
  }

  function showDot(index) {
    const pos = GRID_POSITIONS[index];
    const x = pos.nx * window.innerWidth;
    const y = pos.ny * window.innerHeight;

    dotEl.style.left = x + 'px';
    dotEl.style.top  = y + 'px';
    dotEl.classList.remove('pulse', 'ready', 'confirmed');
    void dotEl.offsetWidth; // reflow
    dotEl.classList.add('pulse');

    const t = window.I18n.t;
    progressText.textContent = `${t('calibrationDot')} ${index + 1} ${t('of')} ${NUM_DOTS}`;
    instructionText.textContent = t('blinkToConfirm');

    // Start collecting iris data for this dot
    confirmTimeout = null;
  }

  function flashConfirmed(index, callback) {
    dotEl.classList.add('confirmed');
    setTimeout(() => {
      dotEl.classList.remove('confirmed', 'pulse');
      callback();
    }, 400);
  }

  // ─── Calibration flow ─────────────────────────────────────────────────────
  /**
   * Start calibration.
   * @param {Function} onComplete - called with calibration coefficients { ax,ay,az,bx,by,bz }
   */
  function start(onComplete) {
    createOverlay();
    currentDotIndex = 0;
    rawData = [];
    onDone = onComplete;

    overlay.style.display = 'flex';
    overlay.classList.add('visible');

    // Hook into EyeTracker gaze updates to record current iris position
    window.EyeTracker.setOnGaze((x, y) => {
      // We receive screen coords from the fallback mapper before calibration
      // We need the RAW iris position from the tracker — let's get it via a private hook
    });

    // Override: listen to raw iris via a custom event from eyetracker
    document.addEventListener('eyetracker-raw-iris', onRawIris);

    // Hook confirm
    window.EyeTracker.setOnConfirm(recordPoint);

    showDot(0);
  }

  function onRawIris(e) {
    currentIrisX = e.detail.x;
    currentIrisY = e.detail.y;
  }

  function recordPoint() {
    // Don't accept during flash animation
    const screenPos = GRID_POSITIONS[currentDotIndex];
    rawData.push({
      irisX:   currentIrisX,
      irisY:   currentIrisY,
      screenX: screenPos.nx * window.innerWidth,
      screenY: screenPos.ny * window.innerHeight,
    });

    flashConfirmed(currentDotIndex, () => {
      currentDotIndex++;
      if (currentDotIndex >= NUM_DOTS) {
        finishCalibration();
      } else {
        showDot(currentDotIndex);
      }
    });
  }

  function finishCalibration() {
    document.removeEventListener('eyetracker-raw-iris', onRawIris);

    const coeffs = fitAffine(rawData);
    // Persist to localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(coeffs));

    // Apply calibration matrix to tracker
    window.EyeTracker.setCalibration(coeffs);

    // Clear calibration-specific handlers to prevent stale blinks firing recordPoint
    // app.js wireAppHandlers() will restore the correct ones inside onDone()
    window.EyeTracker.setOnConfirm(null);
    window.EyeTracker.setOnGaze(null);

    instructionText.textContent = window.I18n.t('calibrationComplete');
    dotEl.style.display = 'none';

    setTimeout(() => {
      overlay.classList.remove('visible');
      setTimeout(() => {
        overlay.style.display = 'none';
        if (onDone) onDone(coeffs);
      }, 500);
    }, 800);
  }


  // ─── Public API ────────────────────────────────────────────────────────────
  /** Load saved calibration from localStorage and apply to EyeTracker */
  function loadSaved() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return false;
    try {
      const coeffs = JSON.parse(saved);
      window.EyeTracker.setCalibration(coeffs);
      return true;
    } catch {
      return false;
    }
  }

  function hasSaved() {
    return !!localStorage.getItem(STORAGE_KEY);
  }

  function clearSaved() {
    localStorage.removeItem(STORAGE_KEY);
  }

  return { start, loadSaved, hasSaved, clearSaved, GRID_POSITIONS };
})();

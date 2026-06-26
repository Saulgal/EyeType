// js/eyetracker.js — MediaPipe FaceMesh eye tracker
// Handles: face detection, iris gaze estimation, blink detection (EAR), event dispatch

window.EyeTracker = (function () {
  'use strict';

  // ─── MediaPipe landmark indices ────────────────────────────────────────────
  // Eye landmarks for EAR (Eye Aspect Ratio) calculation
  const EYE_LEFT  = { p1:362, p2:385, p3:387, p4:263, p5:373, p6:380 };
  const EYE_RIGHT = { p1:33,  p2:160, p3:158, p4:133, p5:153, p6:144 };

  // Iris center landmarks (requires refineLandmarks:true)
  const IRIS_LEFT_CENTER  = 468;
  const IRIS_RIGHT_CENTER = 473;

  // ─── Configurable thresholds ───────────────────────────────────────────────
  const EAR_THRESHOLD       = 0.20;  // below this = eye closed
  const BLINK_MIN_MS        = 60;    // min blink duration (ms)
  const BLINK_MAX_MS        = 400;   // max blink (longer = long-close)
  const LONG_CLOSE_MS       = 1000;  // hold closed this long = confirm
  const TRIPLE_BLINK_WINDOW = 1800;  // ms window for 3 blinks
  const SMOOTH_FACTOR       = 0.40;  // higher = more responsive, less filtered

  // ─── State ─────────────────────────────────────────────────────────────────
  let faceMesh   = null;
  let camera     = null;
  let videoEl    = null;
  let calibData  = null;   // { coeffX, coeffY } from Calibration
  let smoothX    = null;
  let smoothY    = null;

  // Blink state
  let eyeClosed      = false;
  let eyeClosedSince = null;
  let blinkTimestamps = [];   // timestamps of completed blinks
  let longCloseTimer  = null;

  // Callbacks
  let onGaze       = null;   // (x, y) → void
  let onConfirm    = null;   // () → void (triple blink or long close)
  let onStatusChange = null; // (status: 'tracking'|'lost'|'init') → void

  let status = 'init';

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function lm(landmarks, idx) {
    const pt = landmarks[idx];
    return { x: pt.x, y: pt.y, z: pt.z || 0 };
  }

  function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Eye Aspect Ratio:  (||P2-P6|| + ||P3-P5||) / (2 * ||P1-P4||)
   * Normalized coords, so no need for pixel conversion.
   */
  function computeEAR(landmarks, eye) {
    const p1 = lm(landmarks, eye.p1);
    const p2 = lm(landmarks, eye.p2);
    const p3 = lm(landmarks, eye.p3);
    const p4 = lm(landmarks, eye.p4);
    const p5 = lm(landmarks, eye.p5);
    const p6 = lm(landmarks, eye.p6);
    const A = dist(p2, p6);
    const B = dist(p3, p5);
    const C = dist(p1, p4);
    return (A + B) / (2.0 * C);
  }

  /**
   * Map a raw iris normalized position [0,1] to screen pixels
   * using the calibration affine coefficients.
   * calibData = { ax, ay, az, bx, by, bz } such that:
   *   screen_x = ax * iris_x + ay * iris_y + az
   *   screen_y = bx * iris_x + by * iris_y + bz
   */
  function mapToScreen(irisX, irisY) {
    let x, y;
    if (!calibData) {
      // Fallback: direct linear mapping (iris at center → screen center)
      x = (1 - irisX) * window.innerWidth;   // mirror horizontally
      y = irisY * window.innerHeight;
    } else {
      const { ax, ay, az, bx, by, bz } = calibData;
      x = ax * irisX + ay * irisY + az;
      y = bx * irisX + by * irisY + bz;
    }
    // Clamp to screen bounds — protects against bad calibration data
    x = Math.max(0, Math.min(window.innerWidth,  x));
    y = Math.max(0, Math.min(window.innerHeight, y));
    return { x, y };
  }

  // ─── Blink event logic ─────────────────────────────────────────────────────
  function handleEyeState(isCurrentlyClosed) {
    const now = Date.now();

    if (isCurrentlyClosed && !eyeClosed) {
      // Eye just closed
      eyeClosed = true;
      eyeClosedSince = now;

      // Start long-close timer
      longCloseTimer = setTimeout(() => {
        // Eyes held closed for LONG_CLOSE_MS → confirm selection
        if (eyeClosed && onConfirm) {
          onConfirm();
          blinkTimestamps = []; // reset
        }
      }, LONG_CLOSE_MS);

    } else if (!isCurrentlyClosed && eyeClosed) {
      // Eye just opened
      eyeClosed = false;
      const duration = now - eyeClosedSince;
      clearTimeout(longCloseTimer);
      longCloseTimer = null;

      if (duration >= BLINK_MIN_MS && duration <= BLINK_MAX_MS) {
        // Valid blink
        blinkTimestamps.push(now);
        // Remove blinks outside the triple-blink window
        blinkTimestamps = blinkTimestamps.filter(t => now - t <= TRIPLE_BLINK_WINDOW);

        if (blinkTimestamps.length >= 3) {
          blinkTimestamps = [];
          if (onConfirm) onConfirm();
        }
      }
    }
  }

  // ─── MediaPipe results handler ─────────────────────────────────────────────
  function onResults(results) {
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      if (status !== 'lost') {
        status = 'lost';
        if (onStatusChange) onStatusChange('lost');
      }
      return;
    }

    if (status !== 'tracking') {
      status = 'tracking';
      if (onStatusChange) onStatusChange('tracking');
    }

    const landmarks = results.multiFaceLandmarks[0];

    // ── Blink detection ────────────────────────────────────────────────────
    const earL = computeEAR(landmarks, EYE_LEFT);
    const earR = computeEAR(landmarks, EYE_RIGHT);
    const avgEAR = (earL + earR) / 2;
    handleEyeState(avgEAR < EAR_THRESHOLD);

    // ── Gaze estimation ────────────────────────────────────────────────────
    // Iris landmarks require refineLandmarks:true. Some CDN versions return
    // pixel coordinates (e.g. x=320 for 640px wide), others return normalized
    // [0,1]. We auto-detect and normalise.
    if (landmarks.length <= IRIS_LEFT_CENTER) return; // iris not available

    const irisL = lm(landmarks, IRIS_LEFT_CENTER);
    const irisR = lm(landmarks, IRIS_RIGHT_CENTER);
    let rawIrisX = (irisL.x + irisR.x) / 2;
    let rawIrisY = (irisL.y + irisR.y) / 2;

    // If x or y > 1.5 the coords are in pixel space — normalise by video size
    if (rawIrisX > 1.5 || rawIrisY > 1.5) {
      const vw = videoEl.videoWidth  || 640;
      const vh = videoEl.videoHeight || 480;
      rawIrisX /= vw;
      rawIrisY /= vh;
    }

    // Clamp to valid range just in case
    rawIrisX = Math.max(0, Math.min(1, rawIrisX));
    rawIrisY = Math.max(0, Math.min(1, rawIrisY));

    // Dispatch raw iris position for calibration module
    document.dispatchEvent(new CustomEvent('eyetracker-raw-iris', {
      detail: { x: rawIrisX, y: rawIrisY }
    }));

    const mapped = mapToScreen(rawIrisX, rawIrisY);

    // Exponential moving average smoothing — handles jitter without a dead zone
    // (dead zones cause the cursor to freeze when movement is small)
    if (smoothX === null) {
      smoothX = mapped.x;
      smoothY = mapped.y;
    } else {
      smoothX += SMOOTH_FACTOR * (mapped.x - smoothX);
      smoothY += SMOOTH_FACTOR * (mapped.y - smoothY);
    }

    // Always dispatch — the smoothing itself suppresses jitter
    if (onGaze) onGaze(smoothX, smoothY);
  }

  // ─── Public API ────────────────────────────────────────────────────────────
  async function init(videoElement) {
    videoEl = videoElement;
    status = 'init';
    if (onStatusChange) onStatusChange('init');

    faceMesh = new FaceMesh({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });

    faceMesh.setOptions({
      maxNumFaces:          1,
      refineLandmarks:      true,   // enables iris tracking
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    faceMesh.onResults(onResults);

    camera = new Camera(videoEl, {
      onFrame: async () => {
        await faceMesh.send({ image: videoEl });
      },
      width:  640,
      height: 480,
    });

    await camera.start();
  }

  /** Provide calibration data computed by calibration.js */
  function setCalibration(data) {
    calibData = data;
    smoothX = null;
    smoothY = null;
  }

  function setOnGaze(cb)         { onGaze = cb; }
  function setOnConfirm(cb)      { onConfirm = cb; }
  function setOnStatus(cb)       { onStatusChange = cb; }

  function getStatus()           { return status; }

  /** Force a confirm (for keyboard fallback) */
  function triggerConfirm()      { if (onConfirm) onConfirm(); }

  /** Pause/resume camera processing */
  function pause()  { if (camera) camera.stop(); }
  function resume() { if (camera) camera.start(); }

  return {
    init,
    setCalibration,
    setOnGaze,
    setOnConfirm,
    setOnStatus,
    getStatus,
    triggerConfirm,
    pause,
    resume,
    get EAR_THRESHOLD() { return EAR_THRESHOLD; },
  };
})();

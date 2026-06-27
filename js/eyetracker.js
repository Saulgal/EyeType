// js/eyetracker.js — MediaPipe FaceMesh head + gaze tracker
// Uses NOSE TIP as primary tracking point (standard for webcam-based AAC).
// Iris landmarks at 640p webcam don't have enough resolution for eye-only tracking.
// Blink detection via EAR (Eye Aspect Ratio) is separate and still iris-based.

window.EyeTracker = (function () {
  'use strict';

  // ─── MediaPipe landmark indices ────────────────────────────────────────────
  // Eye landmarks for EAR (Eye Aspect Ratio) blink detection
  const EYE_LEFT  = { p1:362, p2:385, p3:387, p4:263, p5:373, p6:380 };
  const EYE_RIGHT = { p1:33,  p2:160, p3:158, p4:133, p5:153, p6:144 };

  // Nose tip — the primary tracking point for head-guided interaction.
  // It's the most protruding facial feature, giving the largest and most
  // proportional movement in response to head rotation.
  const NOSE_TIP = 1;

  // ─── Configurable thresholds ───────────────────────────────────────────────
  const EAR_THRESHOLD       = 0.20;  // below this = eye closed
  const BLINK_MIN_MS        = 60;    // min blink duration (ms)
  const BLINK_MAX_MS        = 400;   // max blink (longer = long-close)
  const LONG_CLOSE_MS       = 1000;  // hold closed this long = confirm
  const TRIPLE_BLINK_WINDOW = 1800;  // ms window for 3 blinks
  const SMOOTH_FACTOR       = 0.35;  // higher = more responsive

  // ─── State ─────────────────────────────────────────────────────────────────
  let faceMesh   = null;
  let camera     = null;
  let videoEl    = null;
  let calibData  = null;   // { ax, ay, az, bx, by, bz } from Calibration
  let smoothX    = null;
  let smoothY    = null;

  // Blink state
  let eyeClosed      = false;
  let eyeClosedSince = null;
  let blinkTimestamps = [];
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

  /** Eye Aspect Ratio for blink detection */
  function computeEAR(landmarks, eye) {
    const p1 = lm(landmarks, eye.p1);
    const p2 = lm(landmarks, eye.p2);
    const p3 = lm(landmarks, eye.p3);
    const p4 = lm(landmarks, eye.p4);
    const p5 = lm(landmarks, eye.p5);
    const p6 = lm(landmarks, eye.p6);
    return (dist(p2, p6) + dist(p3, p5)) / (2.0 * dist(p1, p4));
  }

  /**
   * Map nose-tip normalized position [0,1] → screen pixels.
   *
   * With calibration: affine transform from 9-point calibration.
   * Without calibration: direct linear mapping (mirrored for webcam).
   *
   * The nose tip at 640p webcam typically moves across ~0.25–0.75 range
   * with normal head movements, giving calibration coefficients in the
   * reasonable 2000–5000 range (vs 30,000+ for iris-only tracking).
   */
  function mapToScreen(noseX, noseY) {
    let x, y;
    if (!calibData) {
      // Fallback: direct linear mapping (mirrored horizontally for webcam)
      x = (1 - noseX) * window.innerWidth;
      y = noseY * window.innerHeight;
    } else {
      const { ax, ay, az, bx, by, bz } = calibData;
      x = ax * noseX + ay * noseY + az;
      y = bx * noseX + by * noseY + bz;
    }
    // Clamp to screen bounds
    x = Math.max(0, Math.min(window.innerWidth,  x));
    y = Math.max(0, Math.min(window.innerHeight, y));
    return { x, y };
  }

  // ─── Blink event logic ─────────────────────────────────────────────────────
  function handleEyeState(isCurrentlyClosed) {
    const now = Date.now();

    if (isCurrentlyClosed && !eyeClosed) {
      eyeClosed = true;
      eyeClosedSince = now;
      longCloseTimer = setTimeout(() => {
        if (eyeClosed && onConfirm) {
          onConfirm();
          blinkTimestamps = [];
        }
      }, LONG_CLOSE_MS);

    } else if (!isCurrentlyClosed && eyeClosed) {
      eyeClosed = false;
      const duration = now - eyeClosedSince;
      clearTimeout(longCloseTimer);
      longCloseTimer = null;

      if (duration >= BLINK_MIN_MS && duration <= BLINK_MAX_MS) {
        blinkTimestamps.push(now);
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

    // ── Blink detection (uses eye landmarks, not nose) ─────────────────────
    const earL = computeEAR(landmarks, EYE_LEFT);
    const earR = computeEAR(landmarks, EYE_RIGHT);
    const avgEAR = (earL + earR) / 2;
    handleEyeState(avgEAR < EAR_THRESHOLD);

    // ── Head-gaze estimation (uses nose tip) ───────────────────────────────
    // Skip gaze updates when eyes are closed to prevent cursor jumping
    if (eyeClosed) return;

    const nose = lm(landmarks, NOSE_TIP);
    let rawX = nose.x;
    let rawY = nose.y;

    // Auto-detect pixel vs normalized coordinates from MediaPipe
    if (rawX > 1.5 || rawY > 1.5) {
      rawX /= (videoEl.videoWidth  || 640);
      rawY /= (videoEl.videoHeight || 480);
    }

    rawX = Math.max(0, Math.min(1, rawX));
    rawY = Math.max(0, Math.min(1, rawY));

    // Dispatch for calibration module (same event name for compatibility)
    document.dispatchEvent(new CustomEvent('eyetracker-raw-iris', {
      detail: { x: rawX, y: rawY }
    }));

    const mapped = mapToScreen(rawX, rawY);

    // Exponential moving average smoothing
    if (smoothX === null) {
      smoothX = mapped.x;
      smoothY = mapped.y;
    } else {
      smoothX += SMOOTH_FACTOR * (mapped.x - smoothX);
      smoothY += SMOOTH_FACTOR * (mapped.y - smoothY);
    }

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
      refineLandmarks:      true,
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

  function setCalibration(data) {
    calibData = data;
    smoothX = null;
    smoothY = null;
  }

  function setOnGaze(cb)         { onGaze = cb; }
  function setOnConfirm(cb)      { onConfirm = cb; }
  function setOnStatus(cb)       { onStatusChange = cb; }
  function getStatus()           { return status; }
  function triggerConfirm()      { if (onConfirm) onConfirm(); }
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

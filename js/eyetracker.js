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

  // Eye corner landmarks for head-invariant gaze
  // Left eye (from face's perspective): inner=362, outer=263
  // Right eye (from face's perspective): inner=33, outer=133
  const LEFT_EYE_INNER   = 362;
  const LEFT_EYE_OUTER   = 263;
  const RIGHT_EYE_INNER  = 133;
  const RIGHT_EYE_OUTER  = 33;

  // Vertical eye corners for Y-axis gaze
  const LEFT_EYE_TOP     = 386;
  const LEFT_EYE_BOTTOM  = 374;
  const RIGHT_EYE_TOP    = 159;
  const RIGHT_EYE_BOTTOM = 145;

  // ─── Configurable thresholds ───────────────────────────────────────────────
  const EAR_THRESHOLD       = 0.20;  // below this = eye closed
  const BLINK_MIN_MS        = 60;    // min blink duration (ms)
  const BLINK_MAX_MS        = 400;   // max blink (longer = long-close)
  const LONG_CLOSE_MS       = 1000;  // hold closed this long = confirm
  const TRIPLE_BLINK_WINDOW = 1800;  // ms window for 3 blinks
  const SMOOTH_FACTOR       = 0.30;  // higher = more responsive, lower = more stable

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
   * Compute head-invariant iris position as a ratio within the eye socket.
   * Returns { rx, ry } in [0,1] where:
   *   rx=0 means looking fully toward the outer corner, rx=1 = inner corner
   *   ry=0 means looking up, ry=1 = looking down
   * This is INDEPENDENT of head position/rotation.
   */
  function irisRatio(landmarks, irisIdx, innerIdx, outerIdx, topIdx, bottomIdx) {
    const iris  = lm(landmarks, irisIdx);
    const inner = lm(landmarks, innerIdx);
    const outer = lm(landmarks, outerIdx);
    const top   = lm(landmarks, topIdx);
    const bot   = lm(landmarks, bottomIdx);

    // Horizontal: where is the iris between outer and inner corners?
    const eyeWidth = dist(outer, inner);
    if (eyeWidth < 0.001) return { rx: 0.5, ry: 0.5 };

    // Project iris onto the outer→inner axis
    const dx = inner.x - outer.x;
    const dy = inner.y - outer.y;
    const t = ((iris.x - outer.x) * dx + (iris.y - outer.y) * dy) / (dx * dx + dy * dy);
    const rx = Math.max(0, Math.min(1, t));

    // Vertical: where is the iris between top and bottom eyelid?
    const eyeHeight = dist(top, bot);
    if (eyeHeight < 0.001) return { rx, ry: 0.5 };

    const dxv = bot.x - top.x;
    const dyv = bot.y - top.y;
    const tv = ((iris.x - top.x) * dxv + (iris.y - top.y) * dyv) / (dxv * dxv + dyv * dyv);
    const ry = Math.max(0, Math.min(1, tv));

    return { rx, ry };
  }

  /**
   * Map iris ratios [0,1] to screen pixels using calibration affine coefficients.
   * calibData = { ax, ay, az, bx, by, bz } such that:
   *   screen_x = ax * ratio_x + ay * ratio_y + az
   *   screen_y = bx * ratio_x + by * ratio_y + bz
   */
  function mapToScreen(ratioX, ratioY) {
    let x, y;
    if (!calibData) {
      // Fallback: direct linear mapping
      // Mirrored: looking left (ratio≈1) → right side of screen, etc.
      x = ratioX * window.innerWidth;
      y = ratioY * window.innerHeight;
    } else {
      const { ax, ay, az, bx, by, bz } = calibData;
      x = ax * ratioX + ay * ratioY + az;
      y = bx * ratioX + by * ratioY + bz;
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

      // Count as a valid blink if duration is in the expected range
      if (duration >= BLINK_MIN_MS && duration <= BLINK_MAX_MS) {
        blinkTimestamps.push(now);
        // Keep only recent blinks
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
    // SKIP gaze updates during blinks — iris landmarks are unreliable when
    // eyelids are closed, causing the cursor to jump erratically.
    if (eyeClosed) return;

    // Check iris landmarks are available (refineLandmarks:true)
    if (landmarks.length <= IRIS_LEFT_CENTER) return;

    // Compute head-invariant iris ratios for both eyes
    const leftRatio = irisRatio(
      landmarks, IRIS_LEFT_CENTER,
      LEFT_EYE_INNER, LEFT_EYE_OUTER,
      LEFT_EYE_TOP, LEFT_EYE_BOTTOM
    );
    const rightRatio = irisRatio(
      landmarks, IRIS_RIGHT_CENTER,
      RIGHT_EYE_INNER, RIGHT_EYE_OUTER,
      RIGHT_EYE_TOP, RIGHT_EYE_BOTTOM
    );

    // Average both eyes for stability
    const rawRatioX = (leftRatio.rx + rightRatio.rx) / 2;
    const rawRatioY = (leftRatio.ry + rightRatio.ry) / 2;

    // Dispatch raw iris ratios for calibration module
    document.dispatchEvent(new CustomEvent('eyetracker-raw-iris', {
      detail: { x: rawRatioX, y: rawRatioY }
    }));

    const mapped = mapToScreen(rawRatioX, rawRatioY);

    // Exponential moving average smoothing
    if (smoothX === null) {
      smoothX = mapped.x;
      smoothY = mapped.y;
    } else {
      smoothX += SMOOTH_FACTOR * (mapped.x - smoothX);
      smoothY += SMOOTH_FACTOR * (mapped.y - smoothY);
    }

    // Always dispatch — smoothing handles jitter
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

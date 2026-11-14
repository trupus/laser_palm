import type {
  CustomShootGestureSpec,
  FingerRuleState,
  GestureName,
  GestureStateSnapshot,
  GestureThresholds,
  HandLandmark,
} from './types';

export const DEFAULT_GESTURE_THRESHOLDS: GestureThresholds = {
  pointMinMagnitude: 0.048,
  pinchThreshold: 0.06,
  fingerExtendMargin: 0.022,
  recordedPoseTolerance: 0.76,
};

/**
 * Default shooting gesture per user specification: Close Palm (all four fingers curled).
 */
export const DEFAULT_SHOOT_GESTURE: CustomShootGestureSpec = {
  mode: 'rules',
  name: 'Closed Palm',
  description: 'Close all fingers into your palm to fire one laser pulse',
  thumb: 'any',
  index: 'curled',
  middle: 'curled',
  ring: 'curled',
  pinky: 'curled',
  pinchThumbIndex: false,
};

export const PRESET_SHOOT_GESTURES: CustomShootGestureSpec[] = [
  DEFAULT_SHOOT_GESTURE,
  {
    mode: 'rules',
    name: 'Peace Sign',
    description: 'Extend index & middle fingers, curl ring & pinky',
    thumb: 'any',
    index: 'extended',
    middle: 'extended',
    ring: 'curled',
    pinky: 'curled',
  },
  {
    mode: 'rules',
    name: 'Rock Horns',
    description: 'Extend index & pinky fingers, curl middle & ring',
    thumb: 'any',
    index: 'extended',
    middle: 'curled',
    ring: 'curled',
    pinky: 'extended',
  },
  {
    mode: 'rules',
    name: 'Thumb-Index Pinch',
    description: 'Pinch thumb and index fingertips together',
    thumb: 'any',
    index: 'any',
    middle: 'any',
    ring: 'any',
    pinky: 'any',
    pinchThumbIndex: true,
  },
  {
    mode: 'rules',
    name: 'Open Splayed Palm',
    description: 'Spread all five fingers wide open',
    thumb: 'extended',
    index: 'extended',
    middle: 'extended',
    ring: 'extended',
    pinky: 'extended',
  },
];

export interface GestureEdgeTracker {
  wasShootPoseHeld: boolean;
}

export function createGestureEdgeTracker(): GestureEdgeTracker {
  return {
    wasShootPoseHeld: false,
  };
}

function dist2D(a: HandLandmark, b: HandLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function normalizeWebcamHands(
  rawHands: Array<{
    landmarks: HandLandmark[];
    categoryName?: string;
  }>,
  options?: {
    swapHands?: boolean;
    mirrorX?: boolean;
  },
): {
  leftLandmarks: HandLandmark[] | null;
  rightLandmarks: HandLandmark[] | null;
} {
  const swapHands = Boolean(options?.swapHands);
  const shouldMirrorX = options?.mirrorX !== false;

  let leftLandmarks: HandLandmark[] | null = null;
  let rightLandmarks: HandLandmark[] | null = null;

  for (const item of rawHands) {
    if (!item.landmarks || item.landmarks.length < 21) continue;
    const screenLandmarks: HandLandmark[] = item.landmarks.map((p) => ({
      x: shouldMirrorX ? 1 - p.x : p.x,
      y: p.y,
      z: p.z,
    }));

    let isRightHand: boolean;
    if (item.categoryName === 'Right') {
      isRightHand = true;
    } else if (item.categoryName === 'Left') {
      isRightHand = false;
    } else {
      const wristX = screenLandmarks[0]?.x ?? 0.5;
      isRightHand = wristX >= 0.5;
    }

    if (swapHands) {
      isRightHand = !isRightHand;
    }

    if (isRightHand) {
      rightLandmarks = screenLandmarks;
    } else {
      leftLandmarks = screenLandmarks;
    }
  }

  return { leftLandmarks, rightLandmarks };
}

export function getHandScale(landmarks: HandLandmark[]): number {
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  if (!wrist || !middleMcp) return 0.2;
  return Math.max(0.07, dist2D(wrist, middleMcp));
}

/**
 * Orientation-invariant finger extension check:
 * Works whether the hand is upright, tilted sideways, or pointing downward!
 * Compares tip-to-wrist distance against PIP-to-wrist distance (and MCP-to-wrist).
 */
export function isFingerExtended(
  landmarks: HandLandmark[],
  tipIdx: number,
  pipIdx: number,
  margin: number,
): boolean {
  const wrist = landmarks[0];
  const tip = landmarks[tipIdx];
  const pip = landmarks[pipIdx];
  if (!wrist || !tip || !pip) return false;
  const radialRatio = dist2D(tip, wrist) / Math.max(0.02, dist2D(pip, wrist));
  const uprightExtended = tip.y < pip.y - margin && radialRatio > 1.02;
  return radialRatio > 1.16 || uprightExtended;
}

export function isThumbExtended(landmarks: HandLandmark[]): boolean {
  const thumbTip = landmarks[4];
  const thumbIp = landmarks[3];
  const indexMcp = landmarks[5];
  const pinkyMcp = landmarks[17];
  if (!thumbTip || !thumbIp || !indexMcp || !pinkyMcp) return false;
  const palmWidth = Math.max(0.04, dist2D(indexMcp, pinkyMcp));
  return dist2D(thumbTip, indexMcp) > palmWidth * 0.68 && dist2D(thumbTip, pinkyMcp) > dist2D(thumbIp, pinkyMcp);
}

/**
 * Computes rotation-invariant finger curl ratios [thumb, index, middle, ring, pinky].
 * Higher ratio (~1.6-2.1) = extended; lower ratio (~0.7-1.15) = curled into palm.
 */
export function computeFingerCurlRatios(
  landmarks: HandLandmark[],
): [number, number, number, number, number] {
  const scale = getHandScale(landmarks);
  const wrist = landmarks[0];
  const indexMcp = landmarks[5];
  const thumbDist = dist2D(landmarks[4], indexMcp) / scale;
  const idxDist = dist2D(landmarks[8], wrist) / scale;
  const midDist = dist2D(landmarks[12], wrist) / scale;
  const rngDist = dist2D(landmarks[16], wrist) / scale;
  const pnkDist = dist2D(landmarks[20], wrist) / scale;
  return [
    Number(thumbDist.toFixed(3)),
    Number(idxDist.toFixed(3)),
    Number(midDist.toFixed(3)),
    Number(rngDist.toFixed(3)),
    Number(pnkDist.toFixed(3)),
  ];
}

/**
 * Captures a live 21-landmark hand pose from webcam into a reusable CustomShootGestureSpec.
 */
export function captureGestureTemplateFromLandmarks(
  landmarks: HandLandmark[],
  name = 'Recorded Hand Pose',
): CustomShootGestureSpec {
  const scale = getHandScale(landmarks);
  const wrist = landmarks[0];
  const curlRatios = computeFingerCurlRatios(landmarks);
  const relativeLandmarks = landmarks.slice(0, 21).map((lm) => ({
    x: Number(((lm.x - wrist.x) / scale).toFixed(3)),
    y: Number(((lm.y - wrist.y) / scale).toFixed(3)),
  }));

  return {
    mode: 'recorded',
    name,
    description: 'Custom live-recorded webcam shooting gesture',
    curlRatios,
    relativeLandmarks,
    matchTolerance: 0.76,
  };
}

function checkFingerRule(actualExtended: boolean, rule?: FingerRuleState): boolean {
  if (!rule || rule === 'any') return true;
  return rule === 'extended' ? actualExtended : !actualExtended;
}

/**
 * Evaluates whether the shooting hand matches the active CustomShootGestureSpec
 * (either finger rules from Default/AI or a recorded webcam template).
 */
export function evaluateCustomShootGesture(
  landmarks: HandLandmark[],
  spec: CustomShootGestureSpec = DEFAULT_SHOOT_GESTURE,
  thresholds: GestureThresholds = DEFAULT_GESTURE_THRESHOLDS,
): { matched: boolean; score: number } {
  if (!landmarks || landmarks.length < 21) {
    return { matched: false, score: 0 };
  }

  const scale = getHandScale(landmarks);

  if (spec.mode === 'recorded' && spec.curlRatios && spec.curlRatios.length === 5) {
    const liveRatios = computeFingerCurlRatios(landmarks);
    let ratioDiffSum = 0;
    for (let i = 0; i < 5; i++) {
      ratioDiffSum += Math.abs(liveRatios[i] - spec.curlRatios[i]);
    }
    // Average curl ratio difference across 5 digits (typical spread 0..1.0)
    const curlScore = clamp(1 - ratioDiffSum / 1.85, 0, 1);

    let shapeScore = curlScore;
    if (spec.relativeLandmarks && spec.relativeLandmarks.length === 21) {
      const wrist = landmarks[0];
      let ptDiff = 0;
      const keyIndices = [4, 8, 12, 16, 20];
      for (const idx of keyIndices) {
        const rx = (landmarks[idx].x - wrist.x) / scale;
        const ry = (landmarks[idx].y - wrist.y) / scale;
        ptDiff += Math.hypot(rx - spec.relativeLandmarks[idx].x, ry - spec.relativeLandmarks[idx].y);
      }
      shapeScore = clamp(1 - ptDiff / (keyIndices.length * 1.15), 0, 1);
    }

    const combined = curlScore * 0.72 + shapeScore * 0.28;
    const tol = spec.matchTolerance ?? thresholds.recordedPoseTolerance;
    return {
      matched: combined >= tol,
      score: Number(combined.toFixed(3)),
    };
  }

  // mode === 'rules'
  const thumbExt = isThumbExtended(landmarks);
  const indexExt = isFingerExtended(landmarks, 8, 6, thresholds.fingerExtendMargin);
  const middleExt = isFingerExtended(landmarks, 12, 10, thresholds.fingerExtendMargin);
  const ringExt = isFingerExtended(landmarks, 16, 14, thresholds.fingerExtendMargin);
  const pinkyExt = isFingerExtended(landmarks, 20, 18, thresholds.fingerExtendMargin);

  const pinchDist = dist2D(landmarks[4], landmarks[8]) / scale;
  const isPinching = pinchDist < (thresholds.pinchThreshold / 0.2) * 1.15;

  if (spec.pinchThumbIndex) {
    return {
      matched: isPinching,
      score: isPinching ? 1 : clamp(1 - pinchDist * 0.5, 0, 0.7),
    };
  }

  const checks = [
    checkFingerRule(thumbExt, spec.thumb),
    checkFingerRule(indexExt, spec.index),
    checkFingerRule(middleExt, spec.middle),
    checkFingerRule(ringExt, spec.ring),
    checkFingerRule(pinkyExt, spec.pinky),
  ];

  const passedCount = checks.filter(Boolean).length;
  const score = passedCount / checks.length;
  return {
    matched: passedCount === checks.length,
    score,
  };
}

/**
 * Extracts 360-degree top-down movement direction from Left Hand pointing gesture.
 * - Requires Left Hand index finger extended while ring & pinky are curled (pointing gesture).
 * - Computes pointing direction vector from index knuckle (lm[5]) -> index tip (lm[8]).
 * - If Left Hand is NOT visible or NOT pointing, returns { pointing: false, moveX: 0, moveZ: 0 }
 *   so the player stops immediately and spins in place!
 */
export function extractLeftHandPointDirection(
  landmarks: HandLandmark[] | null,
  thresholds: GestureThresholds = DEFAULT_GESTURE_THRESHOLDS,
): { pointing: boolean; moveX: number; moveZ: number } {
  if (!landmarks || landmarks.length < 21) {
    return { pointing: false, moveX: 0, moveZ: 0 };
  }

  const indexExt = isFingerExtended(landmarks, 8, 6, thresholds.fingerExtendMargin);
  const ringExt = isFingerExtended(landmarks, 16, 14, thresholds.fingerExtendMargin);
  const pinkyExt = isFingerExtended(landmarks, 20, 18, thresholds.fingerExtendMargin);

  // Pointing gesture: index extended, ring & pinky curled (middle curled or relaxed)
  if (!indexExt || ringExt || pinkyExt) {
    return { pointing: false, moveX: 0, moveZ: 0 };
  }

  const mcp = landmarks[5];
  const tip = landmarks[8];
  const dx = tip.x - mcp.x;
  const dy = tip.y - mcp.y; // Screen Y: negative is UP, positive is DOWN
  const mag = Math.hypot(dx, dy);

  if (mag < thresholds.pointMinMagnitude) {
    return { pointing: false, moveX: 0, moveZ: 0 };
  }

  // Normalize to unit top-down direction:
  // +moveX = East/Right, -moveX = West/Left
  // -moveZ = North/Up on screen, +moveZ = South/Down on screen
  return {
    pointing: true,
    moveX: Number((dx / mag).toFixed(3)),
    moveZ: Number((dy / mag).toFixed(3)),
  };
}

/**
 * Pure deterministic classifier for:
 * - Left Hand: Point direction to move; if not visible or not pointing -> stationary spin in place (moveX=0, moveZ=0).
 * - Right Hand: Custom or Default (Closed Palm) shooting gesture -> edge-triggered single pulse (`justFired`).
 */
export function classifyHandGestures(
  input: {
    leftLandmarks: HandLandmark[] | null;
    rightLandmarks: HandLandmark[] | null;
  },
  tracker: GestureEdgeTracker,
  thresholds: GestureThresholds = DEFAULT_GESTURE_THRESHOLDS,
  shootGestureSpec: CustomShootGestureSpec = DEFAULT_SHOOT_GESTURE,
): GestureStateSnapshot {
  // 1. Left Hand -> Movement Direction (Pointing)
  const leftDetected = Boolean(input.leftLandmarks && input.leftLandmarks.length >= 21);
  const leftPoint = extractLeftHandPointDirection(input.leftLandmarks, thresholds);
  const leftGesture: GestureName = !leftDetected
    ? 'NONE'
    : leftPoint.pointing
      ? 'POINT_MOVE'
      : 'OPEN_IDLE';

  // 2. Right Hand -> Shooting Gesture (Single-Pulse Rising Edge)
  const rightDetected = Boolean(input.rightLandmarks && input.rightLandmarks.length >= 21);
  let rightGesture: GestureName = 'NONE';
  let isShootPoseHeld = false;
  let justFired = false;
  let shootMatchScore = 0;

  if (rightDetected && input.rightLandmarks) {
    const evalRes = evaluateCustomShootGesture(input.rightLandmarks, shootGestureSpec, thresholds);
    shootMatchScore = evalRes.score;
    if (evalRes.matched) {
      rightGesture = 'SHOOT_POSE';
      isShootPoseHeld = true;
      if (!tracker.wasShootPoseHeld) {
        justFired = true;
      }
      tracker.wasShootPoseHeld = true;
    } else {
      rightGesture = 'OPEN_IDLE';
      tracker.wasShootPoseHeld = false;
    }
  } else {
    tracker.wasShootPoseHeld = false;
  }

  return {
    leftDetected,
    rightDetected,
    leftGesture,
    rightGesture,
    moveX: leftPoint.pointing ? leftPoint.moveX : 0,
    moveZ: leftPoint.pointing ? leftPoint.moveZ : 0,
    isShootPoseHeld,
    justFired,
    shootMatchScore,
  };
}

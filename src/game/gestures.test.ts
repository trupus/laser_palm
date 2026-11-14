import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureGestureTemplateFromLandmarks,
  classifyHandGestures,
  createGestureEdgeTracker,
  DEFAULT_GESTURE_THRESHOLDS,
  DEFAULT_SHOOT_GESTURE,
  PRESET_SHOOT_GESTURES,
} from './gestures';
import type { HandLandmark } from './types';

/**
 * Helper to synthesize realistic 21-landmark hands in normalized screen space.
 */
function makeSyntheticHand(opts: {
  wristX?: number;
  wristY?: number;
  thumbExt?: boolean;
  indexExt?: boolean;
  middleExt?: boolean;
  ringExt?: boolean;
  pinkyExt?: boolean;
  indexDir?: { dx: number; dy: number };
}): HandLandmark[] {
  const wx = opts.wristX ?? 0.5;
  const wy = opts.wristY ?? 0.65;
  const lm: HandLandmark[] = Array.from({ length: 21 }, () => ({ x: wx, y: wy, z: 0 }));

  lm[0] = { x: wx, y: wy, z: 0 }; // wrist
  // MCP knuckles
  lm[5] = { x: wx - 0.04, y: wy - 0.12, z: 0 };
  lm[9] = { x: wx, y: wy - 0.13, z: 0 };
  lm[13] = { x: wx + 0.04, y: wy - 0.12, z: 0 };
  lm[17] = { x: wx + 0.08, y: wy - 0.1, z: 0 };

  // Thumb (1..4)
  lm[2] = { x: wx - 0.06, y: wy - 0.06, z: 0 };
  lm[3] = { x: wx - 0.08, y: wy - 0.09, z: 0 };
  lm[4] = opts.thumbExt
    ? { x: wx - 0.15, y: wy - 0.14, z: 0 }
    : { x: wx - 0.03, y: wy - 0.1, z: 0 };

  const setFinger = (
    mcpIdx: number,
    pipIdx: number,
    dipIdx: number,
    tipIdx: number,
    extended: boolean,
    dir?: { dx: number; dy: number },
  ) => {
    const mcp = lm[mcpIdx];
    if (extended) {
      const dx = dir ? dir.dx : 0;
      const dy = dir ? dir.dy : -1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      lm[pipIdx] = { x: mcp.x + ux * 0.05, y: mcp.y + uy * 0.05, z: 0 };
      lm[dipIdx] = { x: mcp.x + ux * 0.09, y: mcp.y + uy * 0.09, z: 0 };
      lm[tipIdx] = { x: mcp.x + ux * 0.14, y: mcp.y + uy * 0.14, z: 0 };
    } else {
      // Curled into palm near wrist/MCP
      lm[pipIdx] = { x: mcp.x, y: mcp.y - 0.03, z: 0 };
      lm[dipIdx] = { x: mcp.x, y: mcp.y + 0.01, z: 0 };
      lm[tipIdx] = { x: mcp.x, y: mcp.y + 0.03, z: 0 };
    }
  };

  setFinger(5, 6, 7, 8, Boolean(opts.indexExt), opts.indexDir);
  setFinger(9, 10, 11, 12, Boolean(opts.middleExt));
  setFinger(13, 14, 15, 16, Boolean(opts.ringExt));
  setFinger(17, 18, 19, 20, Boolean(opts.pinkyExt));

  return lm;
}

test('left hand pointing steers in pointed direction; missing or non-pointing hand stops movement (spins in place)', () => {
  const tracker = createGestureEdgeTracker();

  // 1. Pointing East (+X)
  const leftPointRight = makeSyntheticHand({
    wristX: 0.28,
    indexExt: true,
    middleExt: false,
    ringExt: false,
    pinkyExt: false,
    indexDir: { dx: 1, dy: 0 },
  });
  const snapRight = classifyHandGestures(
    { leftLandmarks: leftPointRight, rightLandmarks: null },
    tracker,
  );
  assert.equal(snapRight.leftGesture, 'POINT_MOVE');
  assert.ok(snapRight.moveX > 0.95);
  assert.ok(Math.abs(snapRight.moveZ) < 0.05);

  // 2. Open palm (not pointing) -> stationary spin in place (moveX=0, moveZ=0)
  const leftOpenPalm = makeSyntheticHand({
    wristX: 0.28,
    thumbExt: true,
    indexExt: true,
    middleExt: true,
    ringExt: true,
    pinkyExt: true,
  });
  const snapIdle = classifyHandGestures(
    { leftLandmarks: leftOpenPalm, rightLandmarks: null },
    tracker,
  );
  assert.notEqual(snapIdle.leftGesture, 'POINT_MOVE');
  assert.equal(snapIdle.moveX, 0);
  assert.equal(snapIdle.moveZ, 0);

  // 3. Left hand out of frame -> stationary spin in place (moveX=0, moveZ=0)
  const snapMissing = classifyHandGestures(
    { leftLandmarks: null, rightLandmarks: null },
    tracker,
  );
  assert.equal(snapMissing.leftGesture, 'NONE');
  assert.equal(snapMissing.moveX, 0);
  assert.equal(snapMissing.moveZ, 0);
});

test('right hand closed palm fires single rising-edge pulse and requires release before firing again', () => {
  const tracker = createGestureEdgeTracker();
  const closedPalm = makeSyntheticHand({
    wristX: 0.72,
    thumbExt: false,
    indexExt: false,
    middleExt: false,
    ringExt: false,
    pinkyExt: false,
  });
  const openHand = makeSyntheticHand({
    wristX: 0.72,
    thumbExt: true,
    indexExt: true,
    middleExt: true,
    ringExt: true,
    pinkyExt: true,
  });

  // Frame 1: Closed palm -> justFired = true!
  const f1 = classifyHandGestures(
    { leftLandmarks: null, rightLandmarks: closedPalm },
    tracker,
    DEFAULT_GESTURE_THRESHOLDS,
    DEFAULT_SHOOT_GESTURE,
  );
  assert.equal(f1.justFired, true);
  assert.equal(f1.isShootPoseHeld, true);

  // Frame 2: Still holding closed palm -> justFired = false (single pulse, then stop!)
  const f2 = classifyHandGestures(
    { leftLandmarks: null, rightLandmarks: closedPalm },
    tracker,
    DEFAULT_GESTURE_THRESHOLDS,
    DEFAULT_SHOOT_GESTURE,
  );
  assert.equal(f2.justFired, false);
  assert.equal(f2.isShootPoseHeld, true);

  // Frame 3: Release hand -> resets edge tracker
  const f3 = classifyHandGestures(
    { leftLandmarks: null, rightLandmarks: openHand },
    tracker,
    DEFAULT_GESTURE_THRESHOLDS,
    DEFAULT_SHOOT_GESTURE,
  );
  assert.equal(f3.justFired, false);
  assert.equal(f3.isShootPoseHeld, false);

  // Frame 4: Make closed palm again -> justFired = true!
  const f4 = classifyHandGestures(
    { leftLandmarks: null, rightLandmarks: closedPalm },
    tracker,
    DEFAULT_GESTURE_THRESHOLDS,
    DEFAULT_SHOOT_GESTURE,
  );
  assert.equal(f4.justFired, true);
});

test('custom shooting gestures: AI rule pose and live recorded webcam pose work accurately', () => {
  const tracker = createGestureEdgeTracker();
  const peaceSpec = PRESET_SHOOT_GESTURES.find((g) => g.name === 'Peace Sign')!;

  const peaceHand = makeSyntheticHand({
    wristX: 0.7,
    indexExt: true,
    middleExt: true,
    ringExt: false,
    pinkyExt: false,
  });
  const fistHand = makeSyntheticHand({
    wristX: 0.7,
    indexExt: false,
    middleExt: false,
    ringExt: false,
    pinkyExt: false,
  });

  const nonMatch = classifyHandGestures(
    { leftLandmarks: null, rightLandmarks: fistHand },
    tracker,
    DEFAULT_GESTURE_THRESHOLDS,
    peaceSpec,
  );
  assert.equal(nonMatch.justFired, false);

  const match = classifyHandGestures(
    { leftLandmarks: null, rightLandmarks: peaceHand },
    tracker,
    DEFAULT_GESTURE_THRESHOLDS,
    peaceSpec,
  );
  assert.equal(match.justFired, true);

  // Live recorded webcam template test (Rock Horns pose)
  const hornsHand = makeSyntheticHand({
    wristX: 0.7,
    indexExt: true,
    middleExt: false,
    ringExt: false,
    pinkyExt: true,
  });
  const recordedSpec = captureGestureTemplateFromLandmarks(hornsHand, 'My Horns');
  const recTracker = createGestureEdgeTracker();

  const rejectOpen = classifyHandGestures(
    { leftLandmarks: null, rightLandmarks: fistHand },
    recTracker,
    DEFAULT_GESTURE_THRESHOLDS,
    recordedSpec,
  );
  assert.equal(rejectOpen.justFired, false);

  const acceptHorns = classifyHandGestures(
    { leftLandmarks: null, rightLandmarks: hornsHand },
    recTracker,
    DEFAULT_GESTURE_THRESHOLDS,
    recordedSpec,
  );
  assert.equal(acceptHorns.justFired, true);
  assert.ok(acceptHorns.shootMatchScore >= 0.95);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceTutorialWithGesture,
  advanceTutorialWithVoice,
  createInitialTutorialState,
  skipTutorialStep,
  TUTORIAL_STEPS,
} from './tutorial';

test('tutorial progresses through left point move, stationary spin, dual pulse steps, and voice', () => {
  let state = createInitialTutorialState();
  assert.equal(TUTORIAL_STEPS.length, 5);
  assert.equal(state.stepIndex, 0);

  // Step 1: Left point move
  for (let i = 0; i < 8; i++) {
    state = advanceTutorialWithGesture(
      state,
      {
        leftDetected: true,
        rightDetected: false,
        leftGesture: 'POINT_MOVE',
        rightGesture: 'NONE',
        moveX: 1,
        moveZ: 0,
        isShootPoseHeld: false,
        justFired: false,
        shootMatchScore: 0,
      },
      0.15,
    );
  }
  assert.equal(state.stepIndex, 1);

  // Step 2: Stationary spin when left hand pointing is hidden
  for (let i = 0; i < 8; i++) {
    state = advanceTutorialWithGesture(
      state,
      {
        leftDetected: false,
        rightDetected: false,
        leftGesture: 'NONE',
        rightGesture: 'NONE',
        moveX: 0,
        moveZ: 0,
        isShootPoseHeld: false,
        justFired: false,
        shootMatchScore: 0,
      },
      0.15,
    );
  }
  assert.equal(state.stepIndex, 2);

  // Step 3: First pulse
  state = advanceTutorialWithGesture(
    state,
    {
      leftDetected: false,
      rightDetected: true,
      leftGesture: 'NONE',
      rightGesture: 'SHOOT_POSE',
      moveX: 0,
      moveZ: 0,
      isShootPoseHeld: true,
      justFired: true,
      shootMatchScore: 1,
    },
    0.033,
    true,
  );
  assert.equal(state.stepIndex, 3);

  // Step 4: Second pulse after 3s cooldown
  state = advanceTutorialWithGesture(
    state,
    {
      leftDetected: false,
      rightDetected: true,
      leftGesture: 'NONE',
      rightGesture: 'SHOOT_POSE',
      moveX: 0,
      moveZ: 0,
      isShootPoseHeld: true,
      justFired: true,
      shootMatchScore: 1,
    },
    0.033,
    true,
  );
  assert.equal(state.stepIndex, 4);

  // Step 5: Voice command completes training
  state = advanceTutorialWithVoice(state, 'pulse');
  assert.equal(state.completed, true);

  // Also test skipTutorialStep from start
  let skipped = createInitialTutorialState();
  for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
    skipped = skipTutorialStep(skipped);
  }
  assert.equal(skipped.completed, true);
});

import type { GestureStateSnapshot, VoiceActionType } from './types';

export type TutorialStepId =
  | 'left_point_move'
  | 'left_stop_spin'
  | 'right_pulse_fire'
  | 'right_rearm_fire'
  | 'voice_command';

export interface TutorialStepSpec {
  id: TutorialStepId;
  category: 'hand_left' | 'hand_right' | 'voice';
  badge: string;
  title: string;
  prompt: string;
  hint: string;
}

export const TUTORIAL_STEPS: TutorialStepSpec[] = [
  {
    id: 'left_point_move',
    category: 'hand_left',
    badge: 'Left Hand · Step 1/5',
    title: 'Point Direction to Move',
    prompt: 'Extend your LEFT index finger and point up, down, left, or right to steer your spinning circle.',
    hint: 'Requires POINT_MOVE vector',
  },
  {
    id: 'left_stop_spin',
    category: 'hand_left',
    badge: 'Left Hand · Step 2/5',
    title: 'Spin in Place (Hide or Open Left Hand)',
    prompt: 'Open or lower your LEFT hand so the pointing gesture is not visible. Your circle stops moving and spins in place.',
    hint: 'Hold stationary spin ~0.8s',
  },
  {
    id: 'right_pulse_fire',
    category: 'hand_right',
    badge: 'Right Hand · Step 3/5',
    title: 'Fire Single Laser Pulse (Closed Palm)',
    prompt: 'Make a Closed Palm (or your custom gesture) with your RIGHT hand to fire one laser pulse and trigger the 3s dark hand overlay.',
    hint: 'Edge-triggered single pulse',
  },
  {
    id: 'right_rearm_fire',
    category: 'hand_right',
    badge: 'Right Hand · Step 4/5',
    title: 'Release & Fire Again After 3s Cooldown',
    prompt: 'Wait for the dark 3-second cooldown overlay on your RIGHT hand to clear, open your hand, then make the gesture again.',
    hint: 'Release + re-trigger after 3s',
  },
  {
    id: 'voice_command',
    category: 'voice',
    badge: 'Voice AI · Step 5/5',
    title: 'Say "Pulse", "Reverse", or "Switch"',
    prompt: 'With Voice AI enabled, say "Pulse" to fire, "Reverse" to flip spin direction, or "Switch" to cycle gun presets.',
    hint: 'Listening for voice command',
  },
];

export interface TutorialState {
  stepIndex: number;
  stepProgress: number;
  completed: boolean;
  justAdvancedStepId: TutorialStepId | null;
}

export function createInitialTutorialState(): TutorialState {
  return {
    stepIndex: 0,
    stepProgress: 0,
    completed: false,
    justAdvancedStepId: null,
  };
}

function completeCurrentStep(state: TutorialState): TutorialState {
  const current = TUTORIAL_STEPS[state.stepIndex];
  const nextIdx = state.stepIndex + 1;
  if (nextIdx >= TUTORIAL_STEPS.length) {
    return {
      stepIndex: TUTORIAL_STEPS.length - 1,
      stepProgress: 1,
      completed: true,
      justAdvancedStepId: current?.id ?? null,
    };
  }
  return {
    stepIndex: nextIdx,
    stepProgress: 0,
    completed: false,
    justAdvancedStepId: current?.id ?? null,
  };
}

export function skipTutorialStep(state: TutorialState): TutorialState {
  if (state.completed) return { ...state, justAdvancedStepId: null };
  return completeCurrentStep(state);
}

export function advanceTutorialWithGesture(
  state: TutorialState,
  snap: GestureStateSnapshot,
  dtSec = 0.033,
  pulseAccepted = false,
): TutorialState {
  if (state.completed) {
    return state.justAdvancedStepId ? { ...state, justAdvancedStepId: null } : state;
  }

  const step = TUTORIAL_STEPS[state.stepIndex];
  if (!step || step.category === 'voice') {
    return state.justAdvancedStepId ? { ...state, justAdvancedStepId: null } : state;
  }

  switch (step.id) {
    case 'left_point_move': {
      if (snap.leftGesture === 'POINT_MOVE') {
        const motion = Math.hypot(snap.moveX, snap.moveZ);
        if (motion > 0.2) {
          const nextProgress = Math.min(1, state.stepProgress + Math.max(0.08, dtSec * 1.8));
          if (nextProgress >= 1) {
            return completeCurrentStep(state);
          }
          return { ...state, stepProgress: nextProgress, justAdvancedStepId: null };
        }
      }
      return state.justAdvancedStepId ? { ...state, justAdvancedStepId: null } : state;
    }

    case 'left_stop_spin': {
      if (snap.leftGesture !== 'POINT_MOVE' && snap.moveX === 0 && snap.moveZ === 0) {
        const nextProgress = Math.min(1, state.stepProgress + Math.max(0.08, dtSec * 1.4));
        if (nextProgress >= 1) {
          return completeCurrentStep(state);
        }
        return { ...state, stepProgress: nextProgress, justAdvancedStepId: null };
      }
      return state.justAdvancedStepId ? { ...state, justAdvancedStepId: null } : state;
    }

    case 'right_pulse_fire': {
      if (pulseAccepted || snap.justFired) {
        return completeCurrentStep(state);
      }
      return state.justAdvancedStepId ? { ...state, justAdvancedStepId: null } : state;
    }

    case 'right_rearm_fire': {
      if (pulseAccepted) {
        return completeCurrentStep(state);
      }
      return state.justAdvancedStepId ? { ...state, justAdvancedStepId: null } : state;
    }

    default:
      return state;
  }
}

export function advanceTutorialWithVoice(
  state: TutorialState,
  action: VoiceActionType,
): TutorialState {
  if (state.completed) {
    return state.justAdvancedStepId ? { ...state, justAdvancedStepId: null } : state;
  }

  const step = TUTORIAL_STEPS[state.stepIndex];
  if (!step || step.category !== 'voice') {
    return state.justAdvancedStepId ? { ...state, justAdvancedStepId: null } : state;
  }

  if (action === 'pulse' || action === 'reverse_spin' || action === 'cycle_gun') {
    return completeCurrentStep(state);
  }

  return state.justAdvancedStepId ? { ...state, justAdvancedStepId: null } : state;
}

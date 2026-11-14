import React from 'react';
import { Camera, CheckCircle2, Mic, Play, RotateCcw, SkipForward, X } from 'lucide-react';
import { TUTORIAL_STEPS, type TutorialState } from '../game/tutorial';

interface TutorialBannerProps {
  tutorial: TutorialState;
  cameraActive: boolean;
  voiceStatus: 'off' | 'connecting' | 'listening' | 'error';
  voiceError: string;
  onToggleCamera: () => void;
  onToggleVoice: () => void;
  onSkipStep: () => void;
  onRestartTutorial: () => void;
  onStartLiveMatch: () => void;
  onExitTutorial: () => void;
}

export const TutorialBanner: React.FC<TutorialBannerProps> = ({
  tutorial,
  cameraActive,
  voiceStatus,
  voiceError,
  onToggleCamera,
  onToggleVoice,
  onSkipStep,
  onRestartTutorial,
  onStartLiveMatch,
  onExitTutorial,
}) => {
  const step = TUTORIAL_STEPS[tutorial.stepIndex] ?? TUTORIAL_STEPS[0];
  const needsCamera = !tutorial.completed && step.category !== 'voice' && !cameraActive;
  const needsVoice = !tutorial.completed && step.category === 'voice' && voiceStatus !== 'listening';
  const showSweepBar =
    !tutorial.completed && (step.id === 'left_point_move' || step.id === 'left_stop_spin');

  return (
    <div
      data-testid="tutorial-banner"
      className="fixed top-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-[540px] p-4 rounded-lg border border-slate-700/80 pointer-events-auto"
      style={{ backgroundColor: 'rgba(9, 13, 22, 0.92)' }}
    >
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-1.5">
          {TUTORIAL_STEPS.map((s, idx) => {
            const isDone = tutorial.completed || idx < tutorial.stepIndex;
            const isCurrent = !tutorial.completed && idx === tutorial.stepIndex;
            return (
              <span
                key={s.id}
                className={`h-2 rounded-sm transition-all ${
                  isDone
                    ? 'w-5 bg-emerald-400'
                    : isCurrent
                      ? 'w-7 bg-amber-400'
                      : 'w-4 bg-slate-800 border border-slate-700'
                }`}
              />
            );
          })}
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono-num text-slate-400">
          <span>
            {tutorial.completed
              ? `${TUTORIAL_STEPS.length} / ${TUTORIAL_STEPS.length} VERIFIED`
              : `STEP ${tutorial.stepIndex + 1} / ${TUTORIAL_STEPS.length}`}
          </span>
          <button
            type="button"
            onClick={onExitTutorial}
            aria-label="Exit Tutorial"
            className="px-2 py-0.5 flex items-center gap-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
          >
            <X className="w-3 h-3" />
            <span>Exit</span>
          </button>
        </div>
      </div>

      {tutorial.completed ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-display text-lg font-bold text-white leading-tight">
                TRAINING COMPLETE — SPIN &amp; PULSE CALIBRATED
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Left-hand pointing movement, stationary spin, and right-hand 3s cooldown laser pulses are ready for live arena combat.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 pt-1">
            <button
              type="button"
              data-start="true"
              onClick={onStartLiveMatch}
              className="flex-1 py-2 px-4 flex items-center justify-center gap-2 text-xs font-display font-bold tracking-wide bg-amber-400 hover:bg-amber-300 text-slate-950 rounded transition-colors cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>ENTER ARENA (2:00 MATCH)</span>
            </button>
            <button
              type="button"
              onClick={onRestartTutorial}
              className="py-2 px-3 flex items-center gap-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Replay</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`text-[11px] uppercase tracking-wider font-semibold ${
                step.category === 'hand_right'
                  ? 'text-amber-300'
                  : step.category === 'hand_left'
                    ? 'text-sky-300'
                    : 'text-emerald-300'
              }`}
            >
              {step.badge}
            </span>
            <span className="text-[11px] font-mono-num text-slate-400">{step.hint}</span>
          </div>

          <div className="font-display text-lg font-bold text-white leading-snug">{step.title}</div>
          <p className="text-xs text-slate-300 leading-relaxed">{step.prompt}</p>

          {showSweepBar && (
            <div className="w-full h-1.5 bg-slate-800 rounded-sm overflow-hidden mt-0.5">
              <div
                className="h-full bg-amber-400 transition-all duration-100"
                style={{ width: `${Math.round(tutorial.stepProgress * 100)}%` }}
              />
            </div>
          )}

          {voiceError && step.category === 'voice' && (
            <p className="text-xs text-rose-400">{voiceError}</p>
          )}

          <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-800/90 mt-0.5">
            <div className="flex items-center gap-2">
              {needsCamera && (
                <button
                  type="button"
                  onClick={onToggleCamera}
                  className="px-2.5 py-1 flex items-center gap-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded transition-colors cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Enable Hand Cam</span>
                </button>
              )}
              {needsVoice && (
                <button
                  type="button"
                  onClick={onToggleVoice}
                  className="px-2.5 py-1 flex items-center gap-1.5 text-xs font-semibold bg-sky-400 hover:bg-sky-300 text-slate-950 rounded transition-colors cursor-pointer"
                >
                  <Mic className="w-3.5 h-3.5" />
                  <span>
                    {voiceStatus === 'connecting' ? 'Connecting Mic...' : 'Enable Voice Commands'}
                  </span>
                </button>
              )}
              {!needsCamera && !needsVoice && (
                <span className="text-[11px] text-emerald-300 font-medium">
                  Sensor active — perform action now
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={onSkipStep}
              className="px-2.5 py-1 flex items-center gap-1 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded transition-colors cursor-pointer"
            >
              <span>Skip Step</span>
              <SkipForward className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

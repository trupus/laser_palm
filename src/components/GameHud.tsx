import React from 'react';
import { ArrowLeftRight, Camera, Mic, Pause, RotateCw, Volume2, VolumeX } from 'lucide-react';
import { formatMatchClock } from '../game/rules';
import type { TutorialState } from '../game/tutorial';
import type { GamePhase, KillFeedItem, PlayerHudState } from '../game/types';
import { TutorialBanner } from './TutorialBanner';

interface GameHudProps {
  phase: GamePhase;
  hud: PlayerHudState;
  tutorial: TutorialState;
  roomCode: string;
  playerCount: number;
  webrtcPeers: number;
  killFeed: KillFeedItem[];
  muted: boolean;
  cameraActive: boolean;
  swapHands: boolean;
  voiceStatus: 'off' | 'connecting' | 'listening' | 'error';
  voiceError: string;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleSwapHands: () => void;
  onToggleVoice: () => void;
  onReverseSpin: () => void;
  onPause: () => void;
  onSkipTutorialStep: () => void;
  onRestartTutorial: () => void;
  onStartLiveMatch: () => void;
  onExitTutorial: () => void;
  handOverlayRef: React.RefObject<HTMLCanvasElement | null>;
}

export const GameHud: React.FC<GameHudProps> = ({
  phase,
  hud,
  tutorial,
  roomCode,
  playerCount,
  webrtcPeers,
  killFeed,
  muted,
  cameraActive,
  swapHands,
  voiceStatus,
  voiceError,
  onToggleMute,
  onToggleCamera,
  onToggleSwapHands,
  onToggleVoice,
  onReverseSpin,
  onPause,
  onSkipTutorialStep,
  onRestartTutorial,
  onStartLiveMatch,
  onExitTutorial,
  handOverlayRef,
}) => {
  const hpRatio = Math.max(0, Math.min(100, (hud.hp / hud.maxHp) * 100));
  const isCoolingDown = hud.cooldownRatio > 0.005;
  const readyPct = Math.round((1 - hud.cooldownRatio) * 100);
  const hasCurvature = hud.gun.shootingPoints.some((p) => Math.abs(p.curvature) > 0.05);

  return (
    <div className="fixed inset-0 z-10 pointer-events-none select-none">
      {/* Peripheral Damage Flash Vignette */}
      {hud.damageFlashActive && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            boxShadow: 'inset 0 0 110px 36px rgba(244, 63, 94, 0.55)',
          }}
        />
      )}

      {/* Top-Center: Step-by-Step Tutorial Trainer OR Match Timer & K/D Cluster */}
      {phase === 'tutorial' ? (
        <TutorialBanner
          tutorial={tutorial}
          cameraActive={cameraActive}
          voiceStatus={voiceStatus}
          voiceError={voiceError}
          onToggleCamera={onToggleCamera}
          onToggleVoice={onToggleVoice}
          onSkipStep={onSkipTutorialStep}
          onRestartTutorial={onRestartTutorial}
          onStartLiveMatch={onStartLiveMatch}
          onExitTutorial={onExitTutorial}
        />
      ) : (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
          <div
            className="px-5 py-2 rounded border border-slate-700/70 flex items-center gap-5"
            style={{ backgroundColor: 'rgba(9, 13, 22, 0.86)' }}
          >
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Time</div>
              <div
                data-testid="match-timer"
                className={`font-mono-num text-2xl font-bold leading-none hud-text-shadow ${
                  hud.timeRemainingSec <= 30 ? 'text-amber-400' : 'text-white'
                }`}
              >
                {formatMatchClock(hud.timeRemainingSec)}
              </div>
            </div>

            <div className="h-7 w-px bg-slate-700/80" />

            <div className="text-center">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Kills</div>
              <div
                data-testid="hud-kills"
                className="font-mono-num text-2xl font-bold leading-none text-sky-400"
              >
                {hud.kills}
              </div>
            </div>

            <div className="text-center">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Deaths</div>
              <div
                data-testid="hud-deaths"
                className="font-mono-num text-2xl font-bold leading-none text-slate-200"
              >
                {hud.deaths}
              </div>
            </div>

            <div className="h-7 w-px bg-slate-700/80 hidden sm:block" />

            <div className="hidden sm:block text-left text-xs text-slate-300 font-mono-num">
              <div>{roomCode ? `Room ${roomCode}` : 'Solo + Bots'}</div>
              <div className="text-[11px] text-slate-400">
                {Math.max(1, playerCount)}/4 Pilots{webrtcPeers > 0 ? ` · P2P (${webrtcPeers})` : ''}
              </div>
            </div>
          </div>

          {killFeed.length > 0 && (
            <div className="flex flex-col items-center gap-1">
              {killFeed.slice(0, 3).map((item) => (
                <div
                  key={item.id}
                  className="px-3 py-1 text-xs rounded border border-slate-700/60 text-slate-200"
                  style={{ backgroundColor: 'rgba(9, 13, 22, 0.8)' }}
                >
                  <span className="font-semibold text-sky-300">{item.killerName}</span>
                  <span className="text-slate-400 mx-1.5">eliminated</span>
                  <span className="font-semibold text-rose-300">{item.victimName}</span>
                  <span className="text-slate-500 ml-1.5">({item.weaponName})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Top-Right Compact Utility Controls + Hand Cam Feed (with 3s Darker Hand Overlay) */}
      <div className="fixed top-4 right-4 flex flex-col items-end gap-2">
        <div className="flex items-center gap-1.5 pointer-events-auto">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Flip Spin Direction"
            onClick={(e) => {
              e.currentTarget.blur();
              onReverseSpin();
            }}
            className="w-9 h-9 flex items-center justify-center rounded border border-slate-700/80 text-slate-200 hover:text-white hover:border-slate-500 transition-colors cursor-pointer"
            style={{ backgroundColor: 'rgba(9, 13, 22, 0.86)' }}
          >
            <RotateCw
              className={`w-4 h-4 transition-transform ${
                hud.spinDirection === -1 ? '-scale-x-100 text-amber-300' : 'text-sky-300'
              }`}
            />
          </button>

          <button
            type="button"
            tabIndex={-1}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            className="w-9 h-9 flex items-center justify-center rounded border border-slate-700/80 text-slate-200 hover:text-white hover:border-slate-500 transition-colors cursor-pointer"
            style={{ backgroundColor: 'rgba(9, 13, 22, 0.86)' }}
          >
            {muted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            tabIndex={-1}
            aria-label="Toggle Hand Camera"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleCamera();
            }}
            className={`w-9 h-9 flex items-center justify-center rounded border transition-colors cursor-pointer ${
              cameraActive
                ? 'border-emerald-400 text-emerald-300'
                : 'border-slate-700/80 text-slate-200 hover:border-slate-500'
            }`}
            style={{ backgroundColor: 'rgba(9, 13, 22, 0.86)' }}
          >
            <Camera className="w-4 h-4" />
          </button>

          <button
            type="button"
            tabIndex={-1}
            aria-label="Toggle Voice Commands"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleVoice();
            }}
            className={`w-9 h-9 flex items-center justify-center rounded border transition-colors cursor-pointer ${
              voiceStatus === 'listening'
                ? 'border-sky-400 text-sky-300'
                : 'border-slate-700/80 text-slate-200 hover:border-slate-500'
            }`}
            style={{ backgroundColor: 'rgba(9, 13, 22, 0.86)' }}
          >
            <Mic className="w-4 h-4" />
          </button>

          <button
            type="button"
            tabIndex={-1}
            aria-label="Pause Game"
            onClick={(e) => {
              e.currentTarget.blur();
              onPause();
            }}
            className="w-9 h-9 flex items-center justify-center rounded border border-slate-700/80 text-slate-200 hover:text-white hover:border-slate-500 transition-colors cursor-pointer"
            style={{ backgroundColor: 'rgba(9, 13, 22, 0.86)' }}
          >
            <Pause className="w-4 h-4" />
          </button>
        </div>

        {/* Webcam Hand Preview OR Compact Hand Cooldown Silhouette */}
        {cameraActive ? (
          <div
            className="p-1.5 rounded border border-slate-700/80 flex flex-col gap-1 pointer-events-auto"
            style={{ backgroundColor: 'rgba(9, 13, 22, 0.88)' }}
          >
            <canvas
              ref={handOverlayRef}
              width={224}
              height={140}
              className="rounded block bg-slate-950"
            />
            <div className="flex items-center justify-between gap-2 px-0.5 text-[10px] font-mono-num">
              <span className={isCoolingDown ? 'text-rose-300 font-semibold' : 'text-emerald-300'}>
                {isCoolingDown
                  ? `Hand Locked · ${hud.cooldownRemainingSec.toFixed(1)}s`
                  : `R: ${hud.shootGestureName} Ready`}
              </span>
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onToggleSwapHands();
                }}
                className={`py-0.5 px-1.5 flex items-center gap-1 rounded border cursor-pointer ${
                  swapHands
                    ? 'border-amber-400/70 text-amber-300 bg-amber-500/10'
                    : 'border-slate-800 text-slate-400 hover:text-slate-200 bg-slate-900'
                }`}
              >
                <ArrowLeftRight className="w-2.5 h-2.5" />
                <span>Swap</span>
              </button>
            </div>
          </div>
        ) : (
          /* Diegetic Hand Silhouette Indicator with Darker 3s Cooldown Shroud when webcam is off */
          <div
            data-testid="hand-cooldown-indicator"
            className="px-3 py-2 rounded border border-slate-700/80 flex items-center gap-2.5"
            style={{ backgroundColor: 'rgba(9, 13, 22, 0.86)' }}
          >
            <div className="relative w-8 h-8 rounded flex items-center justify-center overflow-hidden bg-slate-900 border border-slate-700">
              <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
                <path
                  d="M8 13V5.5a1 1 0 0 1 2 0V11m0-6.5a1 1 0 0 1 2 0V11m0-5.5a1 1 0 0 1 2 0V11m0-4a1 1 0 0 1 2 0v8a5 5 0 0 1-5 5h-1a5 5 0 0 1-4.6-3l-1.3-3.2a1 1 0 0 1 1.7-.9L8 13Z"
                  fill="none"
                  stroke={isCoolingDown ? '#94a3b8' : '#34d399'}
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {isCoolingDown && (
                <div
                  className="absolute inset-0 flex items-center justify-center font-mono-num text-[9px] font-bold text-rose-200"
                  style={{
                    backgroundColor: `rgba(2, 4, 10, ${(0.62 + 0.25 * hud.cooldownRatio).toFixed(2)})`,
                  }}
                >
                  {hud.cooldownRemainingSec.toFixed(1)}s
                </div>
              )}
            </div>
            <div className="text-left text-[11px]">
              <div className="font-semibold text-slate-200">{hud.shootGestureName}</div>
              <div className={isCoolingDown ? 'text-rose-300 font-mono-num' : 'text-emerald-300'}>
                {isCoolingDown ? 'Dark Cooldown Active' : 'Pulse Ready'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom-Left: Hull Integrity & Spin/Movement Status */}
      <div
        className="fixed bottom-4 left-4 p-3.5 rounded border border-slate-700/70 min-w-[235px]"
        style={{ backgroundColor: 'rgba(9, 13, 22, 0.86)' }}
      >
        <div className="flex items-baseline justify-between gap-4 mb-1.5">
          <span className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
            Circle Integrity
          </span>
          <span
            data-testid="hud-hp"
            className={`font-mono-num text-3xl font-bold leading-none ${
              hud.hp <= 30 ? 'text-rose-400' : 'text-white'
            }`}
          >
            {hud.hp}
          </span>
        </div>
        <div className="w-full h-2 bg-slate-800 rounded-sm overflow-hidden mb-2.5">
          <div
            className={`h-full transition-all duration-150 ${
              hud.hp <= 30 ? 'bg-rose-500' : 'bg-emerald-400'
            }`}
            style={{ width: `${hpRatio}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-300 mb-1">
          <span>Locomotion</span>
          <span className={hud.isMoving ? 'text-sky-300 font-medium' : 'text-slate-400'}>
            {hud.isMoving ? 'Pointing Move' : 'Spinning in Place'}
          </span>
        </div>

        <div className="pt-2 mt-1.5 border-t border-slate-800 text-[11px] font-mono-num text-slate-400 flex flex-col gap-0.5">
          <div>
            L: <span className="text-sky-300">{hud.activeLeftGesture}</span> · R:{' '}
            <span className="text-amber-300">{hud.activeRightGesture}</span>
          </div>
          {hud.lastVoiceCommand && (
            <div className="text-emerald-300">{hud.lastVoiceCommand}</div>
          )}
        </div>
      </div>

      {/* Bottom-Right: Active Laser Rig, Inverse Range & 3.0s Single-Pulse Cooldown */}
      <div
        className="fixed bottom-4 right-4 p-3.5 rounded border border-slate-700/70 min-w-[245px] text-right"
        style={{ backgroundColor: 'rgba(9, 13, 22, 0.86)' }}
      >
        <div
          data-testid="hud-gun-name"
          className="text-xs uppercase tracking-wider font-bold text-white"
        >
          {hud.gun.name}
        </div>
        <div className="text-[11px] font-mono-num text-slate-300 mt-0.5">
          <span className="text-sky-300">{hud.gun.shootingPoints.length} Pt</span>
          <span className="text-slate-500"> · </span>
          <span data-testid="hud-gun-range" className="text-amber-300">
            {hud.gun.range.toFixed(1)}m Range
          </span>
          <span className="text-slate-500"> · </span>
          <span>{hasCurvature ? 'Curved' : 'Straight'}</span>
        </div>

        {/* 3.0-Second Single-Pulse Capacitor Meter */}
        <div className="mt-2.5 flex items-baseline justify-end gap-2">
          <span className="text-[11px] uppercase tracking-wider text-slate-400">Pulse</span>
          <span
            data-testid="hud-cooldown"
            className={`font-mono-num text-2xl font-bold leading-none ${
              isCoolingDown ? 'text-rose-400' : 'text-emerald-400'
            }`}
          >
            {isCoolingDown ? `${hud.cooldownRemainingSec.toFixed(1)}s` : 'READY'}
          </span>
        </div>

        <div className="w-full h-2 bg-slate-800 rounded-sm overflow-hidden mt-1.5">
          <div
            className={`h-full transition-all duration-75 ${
              isCoolingDown ? 'bg-rose-500' : 'bg-emerald-400'
            }`}
            style={{ width: `${readyPct}%` }}
          />
        </div>

        <div className="pt-2 mt-2 border-t border-slate-800 text-[11px] text-slate-400">
          Presets [1-4] · Flip Spin [Q] · Pulse [Space / Click]
        </div>
      </div>
    </div>
  );
};

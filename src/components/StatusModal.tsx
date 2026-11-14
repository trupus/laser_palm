import React from 'react';
import { Home, Play, RotateCcw } from 'lucide-react';
import { sortLeaderboard } from '../game/rules';
import type { GamePhase, MatchTelemetry, RoomPlayerState } from '../game/types';

interface StatusModalProps {
  phase: GamePhase;
  players: RoomPlayerState[];
  telemetry: MatchTelemetry | null;
  report: { title: string; summary: string; gestureTip: string } | null;
  reportLoading: boolean;
  onResume: () => void;
  onRestart: () => void;
  onReturnTitle: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({
  phase,
  players,
  telemetry,
  report,
  reportLoading,
  onResume,
  onRestart,
  onReturnTitle,
}) => {
  if (phase !== 'paused' && phase !== 'gameover') return null;

  const sorted = sortLeaderboard(players);
  const accuracy =
    telemetry && telemetry.shotsFired > 0
      ? Math.round((telemetry.shotsHit / telemetry.shotsFired) * 100)
      : 0;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center p-6"
      style={{ backgroundColor: 'rgba(6, 8, 13, 0.82)' }}
    >
      <div
        className="w-full max-w-[540px] p-6 rounded-lg border border-slate-700 flex flex-col gap-5"
        style={{ backgroundColor: '#0e1420' }}
      >
        {phase === 'paused' ? (
          <>
            <div>
              <h2 className="font-display text-2xl font-bold text-white">MATCH PAUSED</h2>
              <p className="text-xs text-slate-400 mt-1">
                Top-down spin simulation and pulse timers are paused.
              </p>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={onResume}
                className="w-full py-2.5 px-4 flex items-center justify-center gap-2 text-sm font-semibold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded transition-colors cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Resume Match</span>
              </button>
              <button
                type="button"
                onClick={onRestart}
                className="w-full py-2.5 px-4 flex items-center justify-center gap-2 text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 rounded transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Restart 2:00 Round</span>
              </button>
              <button
                type="button"
                onClick={onReturnTitle}
                className="w-full py-2.5 px-4 flex items-center justify-center gap-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded transition-colors cursor-pointer"
              >
                <Home className="w-4 h-4" />
                <span>Leave to Forge &amp; Lobby</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <h2 className="font-display text-3xl font-bold text-white">MATCH COMPLETE</h2>
              <p className="text-xs text-slate-400 mt-1">
                2-minute spin-laser round finalized · Rig: {telemetry?.gunName || 'Mono Pulse Lance'}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded bg-slate-900 border border-slate-800">
                <div className="text-[11px] text-slate-400">Kills / Deaths</div>
                <div className="font-mono-num text-xl font-bold text-sky-400 mt-0.5">
                  {telemetry?.kills ?? 0} / {telemetry?.deaths ?? 0}
                </div>
              </div>
              <div className="p-3 rounded bg-slate-900 border border-slate-800">
                <div className="text-[11px] text-slate-400">Pulse Hit Rate</div>
                <div className="font-mono-num text-xl font-bold text-amber-300 mt-0.5">
                  {accuracy}%
                </div>
              </div>
              <div className="p-3 rounded bg-slate-900 border border-slate-800">
                <div className="text-[11px] text-slate-400">Emitters Used</div>
                <div className="font-mono-num text-xl font-bold text-emerald-300 mt-0.5">
                  {telemetry?.shootingPointsCount ?? 1}
                </div>
              </div>
            </div>

            {sorted.length > 0 && (
              <div className="border border-slate-800 rounded overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-900 text-slate-400">
                    <tr>
                      <th className="py-2 px-3 font-medium">Pilot</th>
                      <th className="py-2 px-3 font-medium text-right">Kills</th>
                      <th className="py-2 px-3 font-medium text-right">Deaths</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 text-slate-200">
                    {sorted.map((p, idx) => (
                      <tr key={p.id}>
                        <td className="py-2 px-3 font-medium">
                          {idx + 1}. {p.name}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num text-sky-300">
                          {p.kills}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num text-slate-400">
                          {p.deaths}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="p-3.5 rounded bg-slate-900 border border-slate-800 text-xs">
              <div className="font-semibold text-sky-300 mb-1">
                {reportLoading ? 'Analyzing match telemetry...' : report?.title || 'Tactical Debrief'}
              </div>
              <p className="text-slate-300 leading-relaxed">
                {reportLoading
                  ? 'Compiling laser pulse timing, emitter range efficiency, and gesture accuracy.'
                  : report?.summary}
              </p>
              {report?.gestureTip && !reportLoading && (
                <p className="text-amber-300 mt-2">Tip: {report.gestureTip}</p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                data-start="true"
                onClick={onRestart}
                className="flex-1 py-2.5 px-4 flex items-center justify-center gap-2 text-sm font-semibold bg-amber-400 hover:bg-amber-300 text-slate-950 rounded transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Play Again</span>
              </button>
              <button
                type="button"
                onClick={onReturnTitle}
                className="py-2.5 px-4 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 rounded transition-colors cursor-pointer"
              >
                Lobby
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

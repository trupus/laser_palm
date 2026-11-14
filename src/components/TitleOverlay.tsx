import React, { useState } from 'react';
import {
  ArrowLeftRight,
  Camera,
  Crosshair,
  GraduationCap,
  Hand,
  Layers,
  Mic,
  Play,
  Shuffle,
  Sparkles,
  Video,
} from 'lucide-react';
import { PRESET_SHOOT_GESTURES } from '../game/gestures';
import { PRESET_LASER_GUNS } from '../game/rules';
import type {
  ArenaConfig,
  CustomShootGestureSpec,
  LaserGunConfig,
} from '../game/types';

interface TitleOverlayProps {
  playerName: string;
  onPlayerNameChange: (name: string) => void;
  arena: ArenaConfig;
  gun: LaserGunConfig;
  shootGesture: CustomShootGestureSpec;
  cameraActive: boolean;
  swapHands: boolean;
  voiceStatus: 'off' | 'connecting' | 'listening' | 'error';
  voiceError: string;
  botsEnabled: boolean;
  onSelectPresetGun: (gun: LaserGunConfig) => void;
  onForgeAiGun: (prompt: string) => Promise<void>;
  onSelectShootGesture: (spec: CustomShootGestureSpec) => void;
  onDescribeAiGesture: (prompt: string) => Promise<void>;
  onRecordLiveGesture: () => CustomShootGestureSpec | null;
  onToggleBots: () => void;
  onToggleCamera: () => void;
  onToggleSwapHands: () => void;
  onToggleVoice: () => void;
  onGenerateArena: (
    theme: string,
    options?: { generateTextures?: boolean; randomShape?: boolean },
  ) => Promise<string | undefined>;
  onStartTutorial: () => void;
  onStartMatch: () => void;
  handOverlayRef: React.RefObject<HTMLCanvasElement | null>;
}

const GunBlueprintSvg: React.FC<{ gun: LaserGunConfig }> = ({ gun }) => {
  const cx = 44;
  const cy = 44;
  const bodyR = 11;
  const maxVisualRange = 28;
  const scaledRange = Math.max(8, (gun.range / 26) * maxVisualRange);

  return (
    <svg
      viewBox="0 0 88 88"
      className="w-20 h-20 shrink-0 rounded bg-slate-950 border border-slate-800"
      aria-label="Laser gun blueprint preview"
    >
      <circle
        cx={cx}
        cy={cy}
        r={bodyR + scaledRange}
        fill="none"
        stroke={gun.color}
        strokeWidth="0.8"
        strokeDasharray="2.5 2.5"
        opacity="0.35"
      />
      {gun.shootingPoints.map((pt, idx) => {
        const startRad = (pt.angleDeg * Math.PI) / 180;
        const steps = 10;
        let px = cx + Math.cos(startRad) * bodyR;
        let py = cy + Math.sin(startRad) * bodyR;
        let d = `M ${px.toFixed(1)} ${py.toFixed(1)}`;
        const seg = scaledRange / steps;
        for (let i = 1; i <= steps; i++) {
          const theta = startRad + pt.curvature * ((i - 0.5) / steps) * 1.5;
          px += Math.cos(theta) * seg;
          py += Math.sin(theta) * seg;
          d += ` L ${px.toFixed(1)} ${py.toFixed(1)}`;
        }
        return (
          <g key={idx}>
            <path d={d} fill="none" stroke={gun.color} strokeWidth="1.8" strokeLinecap="round" />
            <circle
              cx={cx + Math.cos(startRad) * (bodyR + 1.5)}
              cy={cy + Math.sin(startRad) * (bodyR + 1.5)}
              r="2"
              fill="#ffffff"
            />
          </g>
        );
      })}
      <circle
        cx={cx}
        cy={cy}
        r={bodyR}
        fill="#0f172a"
        stroke={gun.color}
        strokeWidth="2"
      />
      <circle cx={cx} cy={cy} r="3.5" fill={gun.color} />
    </svg>
  );
};

const ArenaBlueprintSvg: React.FC<{ arena: ArenaConfig }> = ({ arena }) => {
  const half = arena.halfSize || 22;
  const scale = 38 / half;
  const cx = 44;
  const cy = 44;
  const poly = arena.borderPolygon;
  const polyPoints =
    poly && poly.length >= 3
      ? poly
          .map((pt) => `${(cx + pt.x * scale).toFixed(1)},${(cy + pt.z * scale).toFixed(1)}`)
          .join(' ')
      : `${cx - 38},${cy - 38} ${cx + 38},${cy - 38} ${cx + 38},${cy + 38} ${cx - 38},${cy + 38}`;

  return (
    <svg
      viewBox="0 0 88 88"
      className="w-20 h-20 shrink-0 rounded bg-slate-950 border border-slate-800"
      aria-label={`Arena border blueprint: ${arena.borderShapeName || arena.name}`}
    >
      <polygon
        points={polyPoints}
        fill={arena.palette.floorPrimary || '#161f2e'}
        stroke={arena.palette.accentGlow || '#38bdf8'}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {arena.obstacles.map((obs) => (
        <rect
          key={obs.id}
          x={cx + (obs.x - obs.width * 0.5) * scale}
          y={cy + (obs.z - obs.depth * 0.5) * scale}
          width={Math.max(1.8, obs.width * scale)}
          height={Math.max(1.8, obs.depth * scale)}
          fill={obs.kind === 'monolith' ? arena.palette.accentGlow : arena.palette.wallPrimary}
          opacity={obs.kind === 'monolith' ? 0.85 : 0.9}
          rx="0.8"
        />
      ))}
      {arena.spawnPoints.map((sp) => (
        <circle
          key={sp.index}
          cx={cx + sp.x * scale}
          cy={cy + sp.z * scale}
          r="2.1"
          fill={sp.color}
        />
      ))}
    </svg>
  );
};

const SHAPE_PRESET_PROMPTS = [
  { label: 'Star Bastion', prompt: 'Five-pointed star fortress with central prism monolith' },
  { label: 'Hourglass Rift', prompt: 'Hourglass lava canyon with narrow central choke' },
  { label: 'Triangle Spire', prompt: 'Equilateral triangle obsidian temple with three corner pads' },
  { label: 'Crescent Crater', prompt: 'Crescent moon asteroid crater with curved flank cover' },
];

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  playerName,
  onPlayerNameChange,
  arena,
  gun,
  shootGesture,
  cameraActive,
  swapHands,
  voiceStatus,
  voiceError,
  botsEnabled,
  onSelectPresetGun,
  onForgeAiGun,
  onSelectShootGesture,
  onDescribeAiGesture,
  onRecordLiveGesture,
  onToggleBots,
  onToggleCamera,
  onToggleSwapHands,
  onToggleVoice,
  onGenerateArena,
  onStartTutorial,
  onStartMatch,
  handOverlayRef,
}) => {
  const [activeTab, setActiveTab] = useState<'gun' | 'arena' | 'gestures'>('gun');

  const [gunPrompt, setGunPrompt] = useState(
    '3 evenly spaced lasers curving clockwise like a vortex',
  );
  const [isForgingGun, setIsForgingGun] = useState(false);
  const [gunStatus, setGunStatus] = useState('');

  const [arenaTheme, setArenaTheme] = useState(
    'Five-pointed star obsidian foundry with sniper lanes',
  );
  const [genArenaTextures, setGenArenaTextures] = useState(true);
  const [isGeneratingArena, setIsGeneratingArena] = useState(false);
  const [arenaNote, setArenaNote] = useState('');

  const [gesturePrompt, setGesturePrompt] = useState('Two-finger peace sign');
  const [isCompilingGesture, setIsCompilingGesture] = useState(false);
  const [gestureFeedback, setGestureFeedback] = useState('');

  const handleForgeGun = async () => {
    if (!gunPrompt.trim()) {
      setGunStatus('Describe your shooting points and laser curvature first.');
      return;
    }
    setIsForgingGun(true);
    setGunStatus('');
    try {
      await onForgeAiGun(gunPrompt.trim());
      setGunStatus('AI laser configuration equipped.');
    } catch (err) {
      setGunStatus(err instanceof Error ? err.message : 'Failed to forge AI gun');
    } finally {
      setIsForgingGun(false);
    }
  };

  const handleGenerateLevel = async (overridePrompt?: string, randomShape = false) => {
    const promptToUse = (overridePrompt ?? arenaTheme).trim();
    if (!randomShape && !promptToUse) {
      setArenaNote('Describe a level layout or custom map border shape first.');
      return;
    }
    setIsGeneratingArena(true);
    setArenaNote('');
    try {
      const warning = await onGenerateArena(promptToUse, {
        generateTextures: genArenaTextures,
        randomShape,
      });
      setArenaNote(
        warning ||
          (genArenaTextures
            ? 'AI polygon level & Nano Banana textures generated.'
            : 'AI custom-border level generated via LLM.'),
      );
    } catch (err) {
      setArenaNote(err instanceof Error ? err.message : 'Arena generation failed');
    } finally {
      setIsGeneratingArena(false);
    }
  };

  const handleAiGesture = async () => {
    if (!gesturePrompt.trim()) {
      setGestureFeedback('Describe the shooting hand pose first.');
      return;
    }
    setIsCompilingGesture(true);
    setGestureFeedback('');
    try {
      await onDescribeAiGesture(gesturePrompt.trim());
      setGestureFeedback('AI shooting gesture active.');
    } catch (err) {
      setGestureFeedback(err instanceof Error ? err.message : 'Gesture compilation failed');
    } finally {
      setIsCompilingGesture(false);
    }
  };

  const handleRecordPoseClick = () => {
    if (!cameraActive) {
      setGestureFeedback('Enable Hand Cam first, hold your right hand pose in view, then click Record.');
      return;
    }
    const recorded = onRecordLiveGesture();
    if (!recorded) {
      setGestureFeedback('Right hand not detected in frame — hold your right hand steady in view.');
    } else {
      setGestureFeedback('Recorded live right-hand shooting pose from webcam.');
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between p-5 md:p-8 pointer-events-none select-none">
      {/* Measured left-side scrim ensuring >=4.5:1 text contrast while keeping spinning showcase clear */}
      <div
        className="fixed inset-y-0 left-0 w-full md:w-[680px] pointer-events-none"
        style={{
          background:
            'linear-gradient(90deg, rgba(8, 11, 18, 0.94) 0%, rgba(8, 11, 18, 0.84) 72%, rgba(8, 11, 18, 0) 100%)',
        }}
      />

      <div className="relative z-10 flex flex-col lg:flex-row items-start justify-between gap-6 w-full max-w-[1380px] mx-auto my-auto">
        {/* Left Control Column */}
        <div className="w-full max-w-[540px] pointer-events-auto flex flex-col gap-3.5">
          {/* Bespoke Inline SVG Title Emblem */}
          <div className="flex items-center gap-3.5">
            <svg viewBox="0 0 48 48" className="w-11 h-11 shrink-0" aria-hidden="true">
              <circle
                cx="24"
                cy="24"
                r="20"
                fill="#0f172a"
                stroke="#38bdf8"
                strokeWidth="2.2"
                strokeDasharray="6 3"
              />
              <circle cx="24" cy="24" r="10" fill="#111827" stroke="#f8fafc" strokeWidth="2" />
              <path
                d="M24 14 Q 30 6 39 10 M32.6 29 Q 38 38 30 43 M15.4 29 Q 8 33 8 22"
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <circle cx="24" cy="24" r="3.2" fill="#38bdf8" />
            </svg>
            <div>
              <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-white leading-none">
                LASER PALM
              </h1>
              <p className="text-xs text-slate-300 mt-1">
                Single-Player Spinning Laser Arena · Webcam Face Avatar · AI Gun &amp; Level Forge
              </p>
            </div>
          </div>

          {/* Single-Player Pilot & Arena Mode Bar */}
          <div
            className="p-3.5 rounded-lg border border-slate-700/70 flex flex-col gap-2.5"
            style={{ backgroundColor: 'rgba(13, 18, 28, 0.92)' }}
          >
            <div className="flex flex-col sm:flex-row sm:items-end gap-2.5">
              <label className="text-xs font-medium text-slate-300 flex-1">
                Pilot Callsign
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => onPlayerNameChange(e.target.value)}
                  maxLength={18}
                  className="mt-1 w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded text-white focus:outline-none focus:border-sky-400"
                  placeholder="Pilot 1"
                />
              </label>

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-300">Arena Mode</span>
                <div className="grid grid-cols-2 gap-1 p-0.5 bg-slate-950 rounded border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      if (!botsEnabled) onToggleBots();
                    }}
                    className={`px-3 py-1 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                      botsEnabled
                        ? 'bg-sky-500 text-slate-950'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    vs 3 AI Bots
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (botsEnabled) onToggleBots();
                    }}
                    className={`px-3 py-1 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                      !botsEnabled
                        ? 'bg-amber-400 text-slate-950'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    Solo Practice
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs text-slate-400">
              <div className="flex items-center gap-1.5 min-w-0 truncate">
                <span className="text-slate-200 font-medium whitespace-nowrap">Single Player</span>
                <span aria-hidden="true">·</span>
                <span className="truncate">
                  {botsEnabled
                    ? 'Rivals: Viper Lance · Helix Orbiter · Nova Charger'
                    : 'Target Practice (AI Bot Rivals Off)'}
                </span>
              </div>
              <span className="font-mono-num text-slate-300 whitespace-nowrap shrink-0">
                2:00 Sprint
              </span>
            </div>
          </div>

          {/* Segmented Studio Switcher: AI Gun Forge | AI Arena & Textures | Hand Gestures */}
          <div
            className="p-3.5 rounded-lg border border-slate-700/70 flex flex-col gap-3"
            style={{ backgroundColor: 'rgba(13, 18, 28, 0.92)' }}
          >
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-950 rounded-md border border-slate-800">
              <button
                type="button"
                onClick={() => setActiveTab('gun')}
                className={`py-1.5 px-2 flex items-center justify-center gap-1.5 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === 'gun'
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>AI Gun Forge</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('arena')}
                className={`py-1.5 px-2 flex items-center justify-center gap-1.5 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === 'arena'
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>AI Level Gen</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('gestures')}
                className={`py-1.5 px-2 flex items-center justify-center gap-1.5 text-xs font-semibold rounded transition-colors cursor-pointer whitespace-nowrap ${
                  activeTab === 'gestures'
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Hand className="w-3.5 h-3.5" />
                <span>Hand Gestures</span>
              </button>
            </div>

            {/* TAB 1: AI Laser Gun Forge */}
            {activeTab === 'gun' && (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-3">
                  <GunBlueprintSvg gun={gun} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-white truncate">{gun.name}</div>
                    <div className="text-xs text-slate-400 line-clamp-1">{gun.description}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-mono-num text-slate-200">
                      <span className="text-sky-300">
                        {gun.shootingPoints.length} Point{gun.shootingPoints.length > 1 ? 's' : ''}
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="text-amber-300">Range {gun.range.toFixed(1)}m</span>
                      <span className="text-slate-500">·</span>
                      <span>3.0s Cooldown</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      More shooting points = shorter laser distance
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    aria-label="Describe laser gun shooting points and curvature"
                    value={gunPrompt}
                    onChange={(e) => setGunPrompt(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded text-white focus:outline-none focus:border-sky-400"
                    placeholder="Describe points, angles, and laser curvature..."
                  />
                  <button
                    type="button"
                    onClick={handleForgeGun}
                    disabled={isForgingGun}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-sky-400 hover:bg-sky-300 disabled:opacity-50 text-slate-950 rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{isForgingGun ? 'Forging...' : 'Forge with AI'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  {PRESET_LASER_GUNS.map((preset) => {
                    const active = preset.id === gun.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          onSelectPresetGun(preset);
                          setGunStatus(`Equipped ${preset.name} (${preset.range.toFixed(1)}m range).`);
                        }}
                        className={`py-1.5 px-2 text-[11px] font-medium rounded border transition-colors cursor-pointer whitespace-nowrap truncate ${
                          active
                            ? 'bg-slate-800 border-sky-400 text-white'
                            : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {preset.shootingPoints.length}pt · {preset.range.toFixed(0)}m
                      </button>
                    );
                  })}
                </div>

                {gunStatus && <p className="text-xs text-sky-300">{gunStatus}</p>}
              </div>
            )}

            {/* TAB 2: AI Polygon Level Generator & Nano Banana Arena Textures */}
            {activeTab === 'arena' && (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center gap-3">
                  <ArenaBlueprintSvg arena={arena} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-white truncate">{arena.name}</div>
                    <div className="text-xs text-slate-400 line-clamp-1">{arena.tagline}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-mono-num text-slate-200">
                      <span data-testid="arena-border-shape" className="text-sky-300">
                        {arena.borderShapeName || 'Polygon Border'} (
                        {arena.borderPolygon?.length ?? 4}v)
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="text-amber-300">{arena.obstacles.length} Obstacles</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                      Mutator: {arena.mutator.name}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    aria-label="Describe custom arena shape, level layout, and theme"
                    value={arenaTheme}
                    onChange={(e) => setArenaTheme(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded text-white focus:outline-none focus:border-sky-400"
                    placeholder="Any border shape & level (e.g. star fortress, crescent maze)..."
                  />
                  <button
                    type="button"
                    onClick={() => void handleGenerateLevel(undefined, false)}
                    disabled={isGeneratingArena}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-sky-400 hover:bg-sky-300 disabled:opacity-50 text-slate-950 rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{isGeneratingArena ? 'Building...' : 'Generate Level'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleGenerateLevel('', true)}
                    disabled={isGeneratingArena}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold bg-amber-400/20 hover:bg-amber-400/30 disabled:opacity-50 border border-amber-400/70 text-amber-200 rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                    <span>Random AI Map</span>
                  </button>
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  {SHAPE_PRESET_PROMPTS.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      disabled={isGeneratingArena}
                      onClick={() => {
                        setArenaTheme(item.prompt);
                        void handleGenerateLevel(item.prompt, false);
                      }}
                      className="py-1 px-2 text-[11px] font-medium rounded border bg-slate-900/80 border-slate-800 text-slate-300 hover:text-white hover:border-sky-400/60 transition-colors cursor-pointer whitespace-nowrap truncate disabled:opacity-50"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs text-slate-300">
                      {arena.floorTextureUrl ? (
                        <img
                          src={arena.floorTextureUrl}
                          alt="Generated floor tile texture"
                          referrerPolicy="no-referrer"
                          className="w-7 h-7 rounded border border-slate-700 object-cover bg-slate-900"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded border border-slate-700 bg-slate-800 flex items-center justify-center text-[9px] text-slate-400">
                          Tile
                        </div>
                      )}
                      <span className="text-[11px] text-slate-400">
                        {arena.floorTextureUrl ? 'AI Floor' : 'Default Floor'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-slate-300">
                      {arena.obstacleTextureUrl ? (
                        <img
                          src={arena.obstacleTextureUrl}
                          alt="Generated obstacle wall texture"
                          referrerPolicy="no-referrer"
                          className="w-7 h-7 rounded border border-slate-700 object-cover bg-slate-900"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded border border-slate-700 bg-slate-800 flex items-center justify-center text-[9px] text-slate-400">
                          Wall
                        </div>
                      )}
                      <span className="text-[11px] text-slate-400">
                        {arena.obstacleTextureUrl ? 'AI Cover' : 'Default Cover'}
                      </span>
                    </div>
                  </div>

                  <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-slate-300 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={genArenaTextures}
                      onChange={(e) => setGenArenaTextures(e.target.checked)}
                      className="accent-sky-400"
                    />
                    <span>Nano Banana Textures</span>
                  </label>
                </div>

                {arenaNote && <p className="text-xs text-sky-300">{arenaNote}</p>}
              </div>
            )}

            {/* TAB 3: Hand Tracking & Custom Shooting Gesture */}
            {activeTab === 'gestures' && (
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onToggleCamera}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border transition-colors cursor-pointer whitespace-nowrap ${
                      cameraActive
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                        : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-white'
                    }`}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>{cameraActive ? 'Hand Cam On' : 'Enable Hand Cam'}</span>
                  </button>

                  {cameraActive && (
                    <button
                      type="button"
                      onClick={onToggleSwapHands}
                      className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded border transition-colors cursor-pointer whitespace-nowrap ${
                        swapHands
                          ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                          : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-300'
                      }`}
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                      <span>{swapHands ? 'Swapped' : 'Swap L/R'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleRecordPoseClick}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/70 text-amber-200 rounded transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Video className="w-3.5 h-3.5" />
                    <span>Record Live Pose</span>
                  </button>

                  <button
                    type="button"
                    onClick={onToggleVoice}
                    className={`ml-auto flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border transition-colors cursor-pointer whitespace-nowrap ${
                      voiceStatus === 'listening'
                        ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                        : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200'
                    }`}
                  >
                    <Mic className="w-3.5 h-3.5" />
                    <span>{voiceStatus === 'listening' ? 'Voice On' : 'Voice AI'}</span>
                  </button>
                </div>

                <div className="text-xs text-slate-300">
                  Active Shoot Pose:{' '}
                  <span className="font-semibold text-amber-300">{shootGesture.name}</span> —{' '}
                  <span className="text-slate-400">{shootGesture.description}</span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    aria-label="Describe custom shooting hand gesture for AI"
                    value={gesturePrompt}
                    onChange={(e) => setGesturePrompt(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded text-white focus:outline-none focus:border-sky-400"
                    placeholder="Or describe gesture (e.g. peace sign, rock horns)..."
                  />
                  <button
                    type="button"
                    onClick={handleAiGesture}
                    disabled={isCompilingGesture}
                    className="px-3 py-1.5 text-xs font-semibold bg-sky-400 hover:bg-sky-300 disabled:opacity-50 text-slate-950 rounded transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {isCompilingGesture ? 'Setting...' : 'AI Set Pose'}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {PRESET_SHOOT_GESTURES.map((g) => (
                    <button
                      key={g.name}
                      type="button"
                      onClick={() => {
                        onSelectShootGesture(g);
                        setGestureFeedback(`Shooting gesture set to ${g.name}.`);
                      }}
                      className={`px-2.5 py-1 text-[11px] rounded border transition-colors cursor-pointer whitespace-nowrap ${
                        shootGesture.name === g.name
                          ? 'bg-slate-800 border-amber-400 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {g.name}
                    </button>
                  ))}
                </div>

                {gestureFeedback && <p className="text-xs text-sky-300">{gestureFeedback}</p>}
                {voiceError && <p className="text-xs text-rose-400">{voiceError}</p>}
              </div>
            )}
          </div>

          {/* Primary Start CTA + Interactive Tutorial */}
          <div className="flex items-stretch gap-2.5">
            <button
              type="button"
              data-start="true"
              onClick={onStartMatch}
              className="flex-1 py-3 px-5 flex items-center justify-center gap-2 text-base font-display font-bold tracking-wide bg-amber-400 hover:bg-amber-300 text-slate-950 rounded-lg shadow-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>ENTER ARENA (2:00 MATCH)</span>
            </button>

            <button
              type="button"
              onClick={onToggleCamera}
              aria-label={cameraActive ? 'Disable Hand Camera' : 'Enable Hand Camera'}
              className={`py-3 px-3.5 flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                cameraActive
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                  : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200'
              }`}
            >
              <Camera className="w-4 h-4" />
              <span>{cameraActive ? 'Cam On' : 'Hand Cam'}</span>
            </button>

            <button
              type="button"
              onClick={onStartTutorial}
              className="py-3 px-4 flex items-center justify-center gap-1.5 text-sm font-display font-bold tracking-wide bg-slate-800 hover:bg-slate-700 text-sky-300 border border-sky-500/60 rounded-lg shadow-lg transition-colors cursor-pointer whitespace-nowrap"
            >
              <GraduationCap className="w-4 h-4" />
              <span>Tutorial</span>
            </button>
          </div>
        </div>

        {/* Right Column: Live Webcam Preview + Concise Hand Rules */}
        <div className="hidden lg:flex flex-col items-end gap-4 pointer-events-auto max-w-[350px]">
          {cameraActive && (
            <div
              className="p-2 rounded-lg border border-slate-700/80"
              style={{ backgroundColor: 'rgba(13, 18, 28, 0.92)' }}
            >
              <canvas
                ref={handOverlayRef}
                width={320}
                height={200}
                className="rounded block bg-slate-950"
              />
              <p className="text-[11px] text-slate-400 mt-1.5 text-center">
                Left Point = Move · Right {shootGesture.name} = Single Pulse (3s Dark Overlay)
              </p>
            </div>
          )}

          <div
            className="p-4 rounded-lg border border-slate-700/70 w-full"
            style={{ backgroundColor: 'rgba(13, 18, 28, 0.88)' }}
          >
            <h2 className="font-display text-sm font-bold text-white tracking-wide mb-2.5">
              LASER PALM ARENA RULES
            </h2>
            <div className="space-y-2 text-xs text-slate-300">
              <div className="flex justify-between gap-3">
                <span className="text-sky-300 font-medium whitespace-nowrap">L · Point Finger</span>
                <span className="text-right">Steer in pointed direction</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-400 font-medium whitespace-nowrap">L · Not Visible</span>
                <span className="text-right">Stop moving &amp; spin in place</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-amber-300 font-medium whitespace-nowrap">
                  R · {shootGesture.name}
                </span>
                <span className="text-right">Sustained sweep pulse (0.34s)</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-rose-300 font-medium whitespace-nowrap">3.0s Cooldown</span>
                <span className="text-right">Dark overlay marks hand lock</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-emerald-300 font-medium whitespace-nowrap">Hand Cam Face</span>
                <span className="text-right">Webcam face cut into circle</span>
              </div>
              <div className="pt-1.5 mt-1.5 border-t border-slate-800 flex justify-between gap-3 text-[11px] text-slate-400">
                <span>Inverse Range Law</span>
                <span>More points = shorter lasers</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Safe-Margin Flat Control Hint */}
      <div className="relative z-10 text-center text-xs text-slate-400">
        Left Hand Point Move · Stationary Spin When Hidden · Right Hand {shootGesture.name} Single Pulse (3s Cooldown) · WASD + Space/Click Supported
      </div>
    </div>
  );
};

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from './audio/sfx';
import { GameHud } from './components/GameHud';
import { StatusModal } from './components/StatusModal';
import { TitleOverlay } from './components/TitleOverlay';
import { TopDownArenaEngine } from './game/arenaRenderer';
import { DEFAULT_SHOOT_GESTURE } from './game/gestures';
import {
  createDefaultArenaConfig,
  createDefaultLaserGun,
  MATCH_DURATION_SEC,
} from './game/rules';
import {
  advanceTutorialWithGesture,
  advanceTutorialWithVoice,
  createInitialTutorialState,
  skipTutorialStep,
  type TutorialState,
} from './game/tutorial';
import type {
  ArenaConfig,
  CustomShootGestureSpec,
  GamePhase,
  KillFeedItem,
  LaserGunConfig,
  MatchTelemetry,
  PlayerHudState,
  RoomPlayerState,
} from './game/types';
import { LiveVoiceClient } from './net/liveVoiceClient';
import { MultiplayerClient } from './net/multiplayerClient';
import { OnDeviceHandTracker } from './vision/handTracker';

const DEFAULT_GUN = createDefaultLaserGun();

const INITIAL_HUD: PlayerHudState = {
  hp: 100,
  maxHp: 100,
  gun: DEFAULT_GUN,
  cooldownRemainingSec: 0,
  cooldownRatio: 0,
  isMoving: false,
  spinDirection: 1,
  kills: 0,
  deaths: 0,
  timeRemainingSec: MATCH_DURATION_SEC,
  activeRightGesture: 'NONE',
  activeLeftGesture: 'NONE',
  shootGestureName: DEFAULT_SHOOT_GESTURE.name,
  lastVoiceCommand: '',
  hitmarkerActive: false,
  damageFlashActive: false,
  spawnIndex: 0,
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handOverlayRef = useRef<HTMLCanvasElement | null>(null);

  const engineRef = useRef<TopDownArenaEngine | null>(null);
  const handTrackerRef = useRef<OnDeviceHandTracker | null>(null);
  const mpClientRef = useRef<MultiplayerClient | null>(null);
  const voiceClientRef = useRef<LiveVoiceClient | null>(null);
  const soloTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [phase, setPhase] = useState<GamePhase>('title');
  const phaseRef = useRef<GamePhase>('title');
  const resumePhaseRef = useRef<'playing' | 'tutorial'>('playing');
  const [tutorial, setTutorial] = useState<TutorialState>(() => createInitialTutorialState());

  const [arena, setArena] = useState<ArenaConfig>(() => createDefaultArenaConfig());
  const arenaRef = useRef<ArenaConfig>(arena);

  const [gun, setGun] = useState<LaserGunConfig>(DEFAULT_GUN);
  const gunRef = useRef<LaserGunConfig>(DEFAULT_GUN);

  const [shootGesture, setShootGesture] = useState<CustomShootGestureSpec>(DEFAULT_SHOOT_GESTURE);

  const [hud, setHud] = useState<PlayerHudState>(INITIAL_HUD);
  const [playerName, setPlayerName] = useState('Pilot 1');
  const [roomCodeInput, setRoomCodeInput] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('room') || '').toUpperCase();
  });
  const [activeRoomCode, setActiveRoomCode] = useState('');
  const [hostId, setHostId] = useState('');
  const [selfId, setSelfId] = useState('local');
  const [players, setPlayers] = useState<RoomPlayerState[]>([]);
  const [webrtcPeers, setWebrtcPeers] = useState(0);
  const [killFeed, setKillFeed] = useState<KillFeedItem[]>([]);
  const [botsEnabled, setBotsEnabled] = useState(true);

  const [muted, setMuted] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [swapHands, setSwapHands] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<'off' | 'connecting' | 'listening' | 'error'>('off');
  const [voiceError, setVoiceError] = useState('');

  const [endTelemetry, setEndTelemetry] = useState<MatchTelemetry | null>(null);
  const [report, setReport] = useState<{
    title: string;
    summary: string;
    gestureTip: string;
  } | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const activeRoomRef = useRef('');
  activeRoomRef.current = activeRoomCode;
  const playerNameRef = useRef(playerName);
  playerNameRef.current = playerName;

  const triggerTtsAnnouncement = useCallback(async (phrase: string) => {
    if (sfx.isMuted()) return;
    try {
      const res = await fetch('/api/gemini/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrase }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { audioBase64?: string | null; fallbackText?: string };
      if (data.audioBase64) {
        await sfx.playWavBase64(data.audioBase64);
      } else if (data.fallbackText && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const utter = new SpeechSynthesisUtterance(data.fallbackText);
        utter.rate = 1.12;
        utter.pitch = 0.94;
        utter.volume = 0.72;
        window.speechSynthesis.speak(utter);
      }
    } catch {
      // Non-blocking callout
    }
  }, []);

  const pushKillFeed = useCallback((killerName: string, victimName: string, weaponName: string) => {
    setKillFeed((prev) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        killerName,
        victimName,
        weaponName,
        timestamp: Date.now(),
      },
      ...prev.slice(0, 3),
    ]);
  }, []);

  const finalizeMatch = useCallback(
    async (finalPlayers?: RoomPlayerState[]) => {
      if (soloTimerRef.current) {
        clearInterval(soloTimerRef.current);
        soloTimerRef.current = null;
      }

      phaseRef.current = 'gameover';
      setPhase('gameover');
      document.body.dataset.state = 'gameover';
      engineRef.current?.setPhase('gameover');
      void triggerTtsAnnouncement('Match complete! Standings locked.');

      const engineStats = engineRef.current?.getTelemetrySnapshot() ?? {
        kills: hud.kills,
        deaths: hud.deaths,
        shotsFired: 0,
        shotsHit: 0,
        gestureCounts: {},
        voiceCommandsCount: 0,
        botStandings: [],
      };

      const roster: RoomPlayerState[] =
        finalPlayers && finalPlayers.length > 0
          ? finalPlayers
          : [
              {
                id: selfId,
                name: playerNameRef.current,
                spawnIndex: 0,
                color: '#38bdf8',
                x: 0,
                y: 0,
                z: 0,
                yaw: 0,
                pitch: 0,
                hp: 100,
                kills: engineStats.kills,
                deaths: engineStats.deaths,
                weaponId: gunRef.current.id,
                weaponName: gunRef.current.name,
                alive: true,
              },
              ...engineStats.botStandings,
            ];

      setPlayers(roster);

      const standings = roster.map((p) => ({
        name: p.name,
        kills: p.id === selfId ? engineStats.kills : p.kills,
        deaths: p.id === selfId ? engineStats.deaths : p.deaths,
        isSelf: p.id === selfId,
        isBot: p.isBot,
      }));

      const telemetry: MatchTelemetry = {
        roomCode: activeRoomRef.current || 'SOLO',
        arenaName: arenaRef.current.name,
        gunName: gunRef.current.name,
        shootingPointsCount: gunRef.current.shootingPoints.length,
        durationSec: MATCH_DURATION_SEC,
        kills: engineStats.kills,
        deaths: engineStats.deaths,
        shotsFired: engineStats.shotsFired,
        shotsHit: engineStats.shotsHit,
        gestureCounts: engineStats.gestureCounts,
        voiceCommandsCount: engineStats.voiceCommandsCount,
        players: standings,
      };
      setEndTelemetry(telemetry);
      setReportLoading(true);
      setReport(null);

      try {
        const res = await fetch('/api/gemini/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telemetry }),
        });
        if (res.ok) {
          const data = await res.json();
          setReport(data);
        }
      } catch {
        // Fallback summary handled inside StatusModal
      } finally {
        setReportLoading(false);
      }
    },
    [hud.deaths, hud.kills, selfId, triggerTtsAnnouncement],
  );

  const enterPlayingPhase = useCallback(
    (isMultiplayerMatch: boolean) => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      if (soloTimerRef.current) {
        clearInterval(soloTimerRef.current);
        soloTimerRef.current = null;
      }

      setKillFeed([]);
      setReport(null);
      setEndTelemetry(null);
      phaseRef.current = 'playing';
      resumePhaseRef.current = 'playing';
      setPhase('playing');
      document.body.dataset.state = 'playing';

      engineRef.current?.resetMatchStats();
      engineRef.current?.setPhase('playing');
      sfx.playCountdownBeep(true);
      void triggerTtsAnnouncement('Spin emitters live! Two minutes on the clock.');

      if (!isMultiplayerMatch) {
        let sec = MATCH_DURATION_SEC;
        engineRef.current?.setTimeRemaining(sec);
        soloTimerRef.current = setInterval(() => {
          if (phaseRef.current !== 'playing') return;
          sec = Math.max(0, sec - 1);
          engineRef.current?.setTimeRemaining(sec);
          if (sec === 30) {
            sfx.playCountdownBeep(false);
            void triggerTtsAnnouncement('Thirty seconds remaining!');
          }
          if (sec <= 0) {
            void finalizeMatch();
          }
        }, 1000);
      }
    },
    [finalizeMatch, triggerTtsAnnouncement],
  );

  const enterTutorialPhase = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    if (soloTimerRef.current) {
      clearInterval(soloTimerRef.current);
      soloTimerRef.current = null;
    }

    setKillFeed([]);
    setReport(null);
    setEndTelemetry(null);
    setTutorial(createInitialTutorialState());
    phaseRef.current = 'tutorial';
    resumePhaseRef.current = 'tutorial';
    setPhase('tutorial');
    document.body.dataset.state = 'tutorial';

    engineRef.current?.resetMatchStats();
    engineRef.current?.setPhase('tutorial');
    sfx.playCountdownBeep(false);
    void triggerTtsAnnouncement('Tutorial active. Point left hand to move, close right palm to pulse.');
  }, [triggerTtsAnnouncement]);

  // Mount TopDownArenaEngine once
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const tracker = new OnDeviceHandTracker();
    handTrackerRef.current = tracker;

    const engine = new TopDownArenaEngine(mount, arenaRef.current, {
      onHudUpdate: (nextHud) => setHud(nextHud),
      onCooldownChange: (remainingSec, ratio) => {
        tracker.setShootCooldown(remainingSec, ratio);
      },
      onPulseAccepted: () => {
        if (phaseRef.current === 'tutorial') {
          setTutorial((prev) => {
            const next = advanceTutorialWithGesture(
              prev,
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
            if (next.justAdvancedStepId && next.justAdvancedStepId !== prev.justAdvancedStepId) {
              sfx.playCountdownBeep(next.completed);
            }
            return next;
          });
        }
      },
      onBotKill: (victimName, weaponName) => {
        pushKillFeed(playerNameRef.current, victimName, weaponName);
        void triggerTtsAnnouncement('Elimination!');
      },
      onBotKilledSelf: (botName, weaponName) => {
        pushKillFeed(botName, playerNameRef.current, weaponName);
      },
      onRemoteHit: (targetId, damage, weaponName) => {
        mpClientRef.current?.sendHitPlayer(targetId, damage, weaponName);
      },
      onBroadcastState: (state) => {
        if (activeRoomRef.current) {
          mpClientRef.current?.sendPlayerState(state);
        }
      },
      onBroadcastShot: (pulses) => {
        if (activeRoomRef.current) {
          mpClientRef.current?.sendShot(pulses);
        }
      },
      onGunChanged: (nextGun) => {
        setGun(nextGun);
        gunRef.current = nextGun;
      },
      onPauseToggle: () => {
        if (phaseRef.current === 'playing' || phaseRef.current === 'tutorial') {
          resumePhaseRef.current = phaseRef.current;
          phaseRef.current = 'paused';
          setPhase('paused');
          document.body.dataset.state = 'paused';
          engineRef.current?.setPhase('paused');
        } else if (phaseRef.current === 'paused') {
          const target = resumePhaseRef.current;
          phaseRef.current = target;
          setPhase(target);
          document.body.dataset.state = target;
          engineRef.current?.setPhase(target);
        }
      },
    });
    engine.setFaceCutoutProvider(() => tracker.getFaceCutoutCanvas());
    engineRef.current = engine;

    const mp = new MultiplayerClient({
      onRoomJoined: (data) => {
        setActiveRoomCode(data.code);
        setRoomCodeInput(data.code);
        setHostId(data.hostId);
        setSelfId(data.selfId);
        setPlayers(data.players);
        setArena(data.arena);
        arenaRef.current = data.arena;
        engine.setArena(data.arena);
        const me = data.players.find((p) => p.id === data.selfId);
        engine.setSelfIdentity(data.selfId, me?.spawnIndex ?? 0);
        engine.syncRemotePlayers(data.players);
        if (data.matchState === 'playing') {
          engine.setTimeRemaining(data.timeRemainingSec);
          enterPlayingPhase(true);
        }
      },
      onPlayersUpdated: (nextPlayers, nextHostId) => {
        setPlayers(nextPlayers);
        if (nextHostId) setHostId(nextHostId);
        engine.syncRemotePlayers(nextPlayers);
      },
      onArenaUpdated: (nextArena) => {
        setArena(nextArena);
        arenaRef.current = nextArena;
        engine.setArena(nextArena);
      },
      onMatchStarted: (data) => {
        setArena(data.arena);
        arenaRef.current = data.arena;
        setPlayers(data.players);
        engine.setArena(data.arena);
        engine.syncRemotePlayers(data.players);
        engine.setTimeRemaining(data.timeRemainingSec);
        enterPlayingPhase(true);
      },
      onTimerTick: (sec) => {
        engine.setTimeRemaining(sec);
        if (sec === 30) {
          sfx.playCountdownBeep(false);
          void triggerTtsAnnouncement('Thirty seconds remaining!');
        }
      },
      onMatchEnded: (finalPlayers) => {
        setPlayers(finalPlayers);
        void finalizeMatch(finalPlayers);
      },
      onRemoteState: (delta) => {
        engine.applyRemoteStateDelta(delta);
      },
      onRemoteShot: (shot) => {
        engine.spawnRemotePulses(shot.pulses);
      },
      onPlayerDamaged: (data) => {
        if (data.targetId === mp.getSelfId()) {
          engine.applyRemoteDamageToSelf(data.hp);
        }
      },
      onPlayerEliminated: (data) => {
        setPlayers(data.players);
        engine.syncRemotePlayers(data.players);
        engine.handleEliminationEvent(data);
        pushKillFeed(data.killerName, data.victimName, data.weaponName);
        if (data.killerId === mp.getSelfId()) {
          void triggerTtsAnnouncement('Elimination confirmed!');
        }
      },
      onError: (message) => {
        setVoiceError(message);
      },
      onPeerCountChange: (count) => {
        setWebrtcPeers(count);
      },
    });
    mpClientRef.current = mp;

    const voice = new LiveVoiceClient({
      onStatusChange: (status, msg) => {
        setVoiceStatus(status);
        if (msg) setVoiceError(msg);
        else if (status === 'listening') setVoiceError('');
      },
      onVoiceAction: (action) => {
        engine.triggerVoiceAction(action);
        if (phaseRef.current === 'tutorial') {
          setTutorial((prev) => {
            const next = advanceTutorialWithVoice(prev, action);
            if (next.justAdvancedStepId && next.justAdvancedStepId !== prev.justAdvancedStepId) {
              sfx.playCountdownBeep(next.completed);
              if (next.completed) {
                void triggerTtsAnnouncement('Training complete! Ready for live combat.');
              }
            }
            return next;
          });
        }
      },
    });
    voiceClientRef.current = voice;

    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      enterPlayingPhase(false);
    } else if (params.get('tutorial') === '1') {
      enterTutorialPhase();
    } else if (params.get('room')) {
      const code = params.get('room')!.toUpperCase();
      void mp.createOrJoinRoom({
        mode: 'join',
        roomCode: code,
        playerName: 'Pilot',
        gun: gunRef.current,
      });
    }

    return () => {
      if (soloTimerRef.current) clearInterval(soloTimerRef.current);
      tracker.stop();
      voice.stop();
      mp.disconnect();
      engine.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handTrackerRef.current?.attachOverlayCanvas(handOverlayRef.current);
  }, [phase, cameraActive]);

  useEffect(() => {
    const onTitleKey = (e: KeyboardEvent) => {
      if (phaseRef.current !== 'title') return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        if (activeRoomRef.current) {
          mpClientRef.current?.startMatch();
        } else {
          enterPlayingPhase(false);
        }
      }
    };
    window.addEventListener('keydown', onTitleKey);
    return () => window.removeEventListener('keydown', onTitleKey);
  }, [enterPlayingPhase]);

  const handleToggleCamera = async () => {
    const tracker = handTrackerRef.current;
    const video = videoRef.current;
    if (!tracker || !video) return;

    if (cameraActive) {
      tracker.stop();
      setCameraActive(false);
    } else {
      try {
        setCameraActive(true);
        await tracker.start(video, handOverlayRef.current, (snap) => {
          engineRef.current?.pushGestureSnapshot(snap);
          if (phaseRef.current === 'tutorial') {
            setTutorial((prev) => {
              const step = prev.stepIndex;
              // Only advance left-hand steps here; pulse steps advance via onPulseAccepted so 3s cooldown is honored!
              if (step <= 1) {
                const next = advanceTutorialWithGesture(prev, snap, 0.04, false);
                if (next.justAdvancedStepId && next.justAdvancedStepId !== prev.justAdvancedStepId) {
                  sfx.playCountdownBeep(next.completed);
                }
                return next;
              }
              return prev;
            });
          }
        });
      } catch (err) {
        setCameraActive(false);
        setVoiceError(err instanceof Error ? err.message : 'Camera permission unavailable');
      }
    }
  };

  const handleToggleSwapHands = () => {
    const next = !swapHands;
    setSwapHands(next);
    handTrackerRef.current?.setSwapHands(next);
  };

  const handleToggleVoice = () => {
    const voice = voiceClientRef.current;
    if (!voice) return;
    if (voice.isActive()) {
      voice.stop();
    } else {
      setVoiceError('');
      void voice.start();
    }
  };

  const handleToggleMute = () => {
    const next = !muted;
    sfx.setMuted(next);
    setMuted(next);
  };

  const handleSelectGun = (nextGun: LaserGunConfig) => {
    setGun(nextGun);
    gunRef.current = nextGun;
    engineRef.current?.setLaserGun(nextGun);
  };

  const handleForgeAiGun = async (prompt: string) => {
    const res = await fetch('/api/gemini/weapon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to forge AI gun');
    const forged = data.gun as LaserGunConfig;
    handleSelectGun(forged);
  };

  const handleApplyShootGesture = (spec: CustomShootGestureSpec) => {
    setShootGesture(spec);
    handTrackerRef.current?.setShootGestureSpec(spec);
    engineRef.current?.setShootGestureName(spec.name);
  };

  const handleDescribeAiGesture = async (prompt: string) => {
    const res = await fetch('/api/gemini/gesture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to compile AI gesture');
    const compiled = data.gesture as CustomShootGestureSpec;
    handleApplyShootGesture(compiled);
  };

  const handleRecordLiveGesture = (): CustomShootGestureSpec | null => {
    const recorded = handTrackerRef.current?.recordCurrentRightHandPose('Recorded Pose') ?? null;
    if (recorded) {
      setShootGesture(recorded);
      engineRef.current?.setShootGestureName(recorded.name);
    }
    return recorded;
  };

  const handleCreateRoom = async () => {
    await mpClientRef.current?.createOrJoinRoom({
      mode: 'create',
      playerName: playerName.trim() || 'Pilot 1',
      arena: arenaRef.current,
      gun: gunRef.current,
    });
  };

  const handleJoinRoom = async () => {
    if (!roomCodeInput.trim()) return;
    await mpClientRef.current?.createOrJoinRoom({
      mode: 'join',
      roomCode: roomCodeInput.trim(),
      playerName: playerName.trim() || 'Pilot',
      gun: gunRef.current,
    });
  };

  const handleGenerateArena = async (
    theme: string,
    options?: { generateTextures?: boolean; randomShape?: boolean },
  ): Promise<string | undefined> => {
    const generateTextures = options?.generateTextures ?? true;
    const res = await fetch('/api/gemini/arena', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme,
        generateTextures,
        randomShape: Boolean(options?.randomShape),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate arena');
    const rawArena = data.arena as ArenaConfig;
    const nextArena: ArenaConfig = {
      ...rawArena,
      floorTextureUrl:
        rawArena.floorTextureUrl ?? (!generateTextures ? arenaRef.current.floorTextureUrl : undefined),
      obstacleTextureUrl:
        rawArena.obstacleTextureUrl ??
        (!generateTextures ? arenaRef.current.obstacleTextureUrl : undefined),
    };
    setArena(nextArena);
    arenaRef.current = nextArena;
    engineRef.current?.setArena(nextArena);
    if (activeRoomCode && hostId === selfId) {
      mpClientRef.current?.sendArenaUpdate(nextArena);
    }
    return data.textureWarning as string | undefined;
  };

  const handleStartOrRestart = () => {
    if (activeRoomCode) {
      mpClientRef.current?.startMatch();
    } else {
      enterPlayingPhase(false);
    }
  };

  const handleResume = () => {
    const target = resumePhaseRef.current;
    phaseRef.current = target;
    setPhase(target);
    document.body.dataset.state = target;
    engineRef.current?.setPhase(target);
  };

  const handleSkipTutorialStep = () => {
    setTutorial((prev) => {
      const next = skipTutorialStep(prev);
      sfx.playCountdownBeep(next.completed);
      if (next.completed && !prev.completed) {
        void triggerTtsAnnouncement('Training complete! Ready for live combat.');
      }
      return next;
    });
  };

  const handleReturnTitle = () => {
    if (soloTimerRef.current) {
      clearInterval(soloTimerRef.current);
      soloTimerRef.current = null;
    }
    phaseRef.current = 'title';
    setPhase('title');
    document.body.dataset.state = 'title';
    engineRef.current?.setPhase('title');
  };

  const handleToggleBots = () => {
    const next = !botsEnabled;
    setBotsEnabled(next);
    engineRef.current?.setBotsEnabled(next);
  };

  return (
    <main className="relative w-full h-full overflow-hidden bg-[#090d16]">
      {/* Isolated Top-Down 2D Canvas Mount Container */}
      <div
        ref={mountRef}
        data-testid="arena-canvas-mount"
        className="absolute inset-0 w-full h-full"
      />

      {/* Hidden video element feeding MediaPipe HandLandmarker */}
      <video ref={videoRef} playsInline muted className="hidden" />

      {phase === 'title' && (
        <TitleOverlay
          playerName={playerName}
          onPlayerNameChange={setPlayerName}
          roomCodeInput={roomCodeInput}
          onRoomCodeInputChange={setRoomCodeInput}
          activeRoomCode={activeRoomCode}
          players={players}
          isHost={!activeRoomCode || hostId === selfId}
          arena={arena}
          gun={gun}
          shootGesture={shootGesture}
          cameraActive={cameraActive}
          swapHands={swapHands}
          voiceStatus={voiceStatus}
          voiceError={voiceError}
          botsEnabled={botsEnabled}
          onSelectPresetGun={handleSelectGun}
          onForgeAiGun={handleForgeAiGun}
          onSelectShootGesture={handleApplyShootGesture}
          onDescribeAiGesture={handleDescribeAiGesture}
          onRecordLiveGesture={handleRecordLiveGesture}
          onToggleBots={handleToggleBots}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onToggleCamera={handleToggleCamera}
          onToggleSwapHands={handleToggleSwapHands}
          onToggleVoice={handleToggleVoice}
          onGenerateArena={handleGenerateArena}
          onStartTutorial={enterTutorialPhase}
          onStartMatch={handleStartOrRestart}
          handOverlayRef={handOverlayRef}
        />
      )}

      {phase !== 'title' && (
        <GameHud
          phase={phase}
          hud={hud}
          tutorial={tutorial}
          roomCode={activeRoomCode}
          playerCount={players.length}
          webrtcPeers={webrtcPeers}
          killFeed={killFeed}
          muted={muted}
          cameraActive={cameraActive}
          swapHands={swapHands}
          voiceStatus={voiceStatus}
          voiceError={voiceError}
          onToggleMute={handleToggleMute}
          onToggleCamera={handleToggleCamera}
          onToggleSwapHands={handleToggleSwapHands}
          onToggleVoice={handleToggleVoice}
          onReverseSpin={() => engineRef.current?.reverseSpin()}
          onPause={() => {
            if (phaseRef.current === 'playing' || phaseRef.current === 'tutorial') {
              resumePhaseRef.current = phaseRef.current;
            }
            phaseRef.current = 'paused';
            setPhase('paused');
            document.body.dataset.state = 'paused';
            engineRef.current?.setPhase('paused');
          }}
          onSkipTutorialStep={handleSkipTutorialStep}
          onRestartTutorial={enterTutorialPhase}
          onStartLiveMatch={handleStartOrRestart}
          onExitTutorial={handleReturnTitle}
          handOverlayRef={handOverlayRef}
        />
      )}

      <StatusModal
        phase={phase}
        players={players}
        telemetry={endTelemetry}
        report={report}
        reportLoading={reportLoading}
        onResume={handleResume}
        onRestart={handleStartOrRestart}
        onReturnTitle={handleReturnTitle}
      />
    </main>
  );
}

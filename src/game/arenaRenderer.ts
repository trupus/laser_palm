import defaultFloorImgUrl from '../assets/images/default_arena_floor_1794673977604.jpg';
import defaultWallImgUrl from '../assets/images/default_arena_wall_1794673979337.jpg';
import { sfx } from '../audio/sfx';
import { DEFAULT_SHOOT_GESTURE } from './gestures';
import {
  applyDamageAndRespawn,
  createDefaultLaserGun,
  cyclePresetGun,
  evaluatePulseFireGate,
  LASER_COOLDOWN_SEC,
  MATCH_DURATION_SEC,
  MOVE_SPEED,
  PLAYER_RADIUS,
  PRESET_LASER_GUNS,
  resolveTopDownCollision,
  traceCurvedLaserBeam,
  type LaserTargetCircle,
} from './rules';
import type {
  ArenaConfig,
  GamePhase,
  GestureName,
  GestureStateSnapshot,
  LaserGunConfig,
  LaserPulsePath,
  PlayerHudState,
  RoomPlayerState,
  Vec2,
  VoiceActionType,
} from './types';
import type { RemoteStatePayload } from '../net/multiplayerClient';

interface ActivePulseVisual {
  points: Vec2[];
  color: string;
  impactPoint?: Vec2;
  age: number;
  duration: number;
}

interface PooledParticle {
  active: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  age: number;
  life: number;
  color: string;
  size: number;
}

type BotArchetype = 'sniper_kiter' | 'spiral_orbiter' | 'nova_charger';

interface BotActor {
  id: string;
  name: string;
  archetype: BotArchetype;
  spawnIndex: number;
  color: string;
  x: number;
  z: number;
  vx: number;
  vz: number;
  spinAngle: number;
  spinDirection: 1 | -1;
  hp: number;
  maxHp: number;
  kills: number;
  deaths: number;
  gun: LaserGunConfig;
  cooldownRemaining: number;
  telegraphRemaining: number;
  strafeSign: 1 | -1;
  strafeTimer: number;
  hitFlashTimer: number;
}

export interface TopDownEngineCallbacks {
  onHudUpdate: (hud: PlayerHudState) => void;
  onCooldownChange: (remainingSec: number, ratio: number) => void;
  onPulseAccepted?: () => void;
  onBotKill: (victimName: string, weaponName: string) => void;
  onBotKilledSelf?: (botName: string, weaponName: string) => void;
  onRemoteHit: (targetId: string, damage: number, weaponName: string) => void;
  onBroadcastState: (state: Omit<RemoteStatePayload, 'id'>) => void;
  onBroadcastShot: (pulses: LaserPulsePath[]) => void;
  onGunChanged?: (gun: LaserGunConfig) => void;
  onPauseToggle: () => void;
}

const PARTICLE_POOL_SIZE = 160;

export class TopDownArenaEngine {
  private mountEl: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private resizeObserver: ResizeObserver;

  private arena: ArenaConfig;
  private callbacks: TopDownEngineCallbacks;
  private phase: GamePhase = 'title';

  // Loaded HTMLImageElement textures (Nano Banana or pre-generated defaults)
  private floorImg: HTMLImageElement | null = null;
  private obstacleImg: HTMLImageElement | null = null;
  private currentFloorUrl = '';
  private currentObstacleUrl = '';

  // Local player circle state
  private selfId = 'local';
  private spawnIndex = 0;
  private pos: Vec2 = { x: -18, z: -18 };
  private vel: Vec2 = { x: 0, z: 0 };
  private spinAngle = 0;
  private spinDirection: 1 | -1 = 1;
  private hp = 100;
  private maxHp = 100;
  private kills = 0;
  private deaths = 0;
  private gun: LaserGunConfig = createDefaultLaserGun();
  private cooldownRemainingSec = 0;
  private shootGestureName = DEFAULT_SHOOT_GESTURE.name;

  // Match clock & telemetry
  private timeRemainingSec = MATCH_DURATION_SEC;
  private shotsFired = 0;
  private shotsHit = 0;
  private gestureCounts: Record<string, number> = {};
  private voiceCommandsCount = 0;
  private lastVoiceCommand = '';

  // Transient feedback timers
  private hitstopTimer = 0;
  private cameraTrauma = 0;
  private hitmarkerTimer = 0;
  private damageFlashTimer = 0;
  private selfHitFlashTimer = 0;

  // Input state (hand gestures + keyboard/mouse fallback)
  private keysPressed = new Set<string>();
  private queuedPulseFire = false;
  private activeLeftGesture: GestureName = 'NONE';
  private activeRightGesture: GestureName = 'NONE';
  private handMoveVec: Vec2 = { x: 0, z: 0 };

  // Opponents: Multiplayer remote players + 3 distinct AI bots
  private remotePlayers = new Map<string, RoomPlayerState>();
  private botsEnabled = true;
  private bots: BotActor[] = [];

  // Visual pools
  private activePulses: ActivePulseVisual[] = [];
  private particles: PooledParticle[] = [];

  // Camera smoothing
  private camCenter: Vec2 = { x: 0, z: 0 };
  private rafId = 0;
  private lastFrameMs = 0;
  private lastHudPushMs = 0;
  private lastNetSyncMs = 0;

  constructor(
    mountEl: HTMLElement,
    initialArena: ArenaConfig,
    callbacks: TopDownEngineCallbacks,
  ) {
    this.mountEl = mountEl;
    this.arena = initialArena;
    this.callbacks = callbacks;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'block w-full h-full';
    this.canvas.setAttribute('aria-label', 'Top-down spinning laser arena');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable');
    }
    this.ctx = ctx;
    this.mountEl.innerHTML = '';
    this.mountEl.appendChild(this.canvas);

    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      this.particles.push({
        active: false,
        x: 0,
        z: 0,
        vx: 0,
        vz: 0,
        age: 0,
        life: 0.4,
        color: '#38bdf8',
        size: 3,
      });
    }

    this.loadArenaTextures(initialArena);
    this.respawnSelfAtCorner(0);
    this.rebuildBots();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.mountEl);
    this.handleResize();

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleFocusLoss);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.canvas.addEventListener('mousedown', this.handleCanvasMouseDown);

    this.lastFrameMs = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  private loadTextureImage(url: string, onReady: (img: HTMLImageElement) => void) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => onReady(img);
    img.src = url;
  }

  private loadArenaTextures(arena: ArenaConfig) {
    const nextFloor = arena.floorTextureUrl || defaultFloorImgUrl;
    if (nextFloor !== this.currentFloorUrl) {
      this.currentFloorUrl = nextFloor;
      this.loadTextureImage(nextFloor, (img) => {
        if (this.currentFloorUrl === nextFloor) {
          this.floorImg = img;
        }
      });
    }

    const nextObs = arena.obstacleTextureUrl || defaultWallImgUrl;
    if (nextObs !== this.currentObstacleUrl) {
      this.currentObstacleUrl = nextObs;
      this.loadTextureImage(nextObs, (img) => {
        if (this.currentObstacleUrl === nextObs) {
          this.obstacleImg = img;
        }
      });
    }
  }

  private handleResize() {
    const rect = this.mountEl.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.floor(rect.width * dpr));
    const h = Math.max(240, Math.floor(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (this.phase === 'playing' || this.phase === 'tutorial' || this.phase === 'paused') {
        e.preventDefault();
        this.callbacks.onPauseToggle();
      }
      return;
    }

    if (this.phase !== 'playing' && this.phase !== 'tutorial') return;

    if (!this.keysPressed.has(e.code)) {
      if (e.code === 'Space') {
        e.preventDefault();
        this.queuedPulseFire = true;
      } else if (e.code === 'KeyQ') {
        this.reverseSpin();
      } else if (e.code === 'Digit1') {
        this.setLaserGun(PRESET_LASER_GUNS[0]);
      } else if (e.code === 'Digit2') {
        this.setLaserGun(PRESET_LASER_GUNS[1]);
      } else if (e.code === 'Digit3') {
        this.setLaserGun(PRESET_LASER_GUNS[2]);
      } else if (e.code === 'Digit4') {
        this.setLaserGun(PRESET_LASER_GUNS[3]);
      }
    }

    this.keysPressed.add(e.code);
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keysPressed.delete(e.code);
  };

  private handleCanvasMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    if (this.phase !== 'playing' && this.phase !== 'tutorial') return;
    this.queuedPulseFire = true;
  };

  private handleFocusLoss = () => {
    this.keysPressed.clear();
  };

  private handleVisibilityChange = () => {
    if (document.hidden) {
      this.keysPressed.clear();
    }
  };

  public setPhase(next: GamePhase) {
    this.phase = next;
    this.keysPressed.clear();
    this.queuedPulseFire = false;
    if (next === 'playing' || next === 'tutorial') {
      this.lastHudPushMs = 0;
      this.emitHudSnapshot(true);
    }
  }

  public setArena(next: ArenaConfig) {
    this.arena = next;
    this.loadArenaTextures(next);
    this.pos = resolveTopDownCollision(
      this.pos,
      PLAYER_RADIUS,
      next.halfSize,
      next.obstacles,
    );
    this.rebuildBots();
  }

  public setLaserGun(nextGun: LaserGunConfig) {
    this.gun = nextGun;
    this.callbacks.onGunChanged?.(nextGun);
    this.emitHudSnapshot(true);
  }

  public getLaserGun(): LaserGunConfig {
    return this.gun;
  }

  public setShootGestureName(name: string) {
    this.shootGestureName = name;
    this.emitHudSnapshot(true);
  }

  public reverseSpin() {
    this.spinDirection = this.spinDirection === 1 ? -1 : 1;
    sfx.playSpinReverse();
    this.emitHudSnapshot(true);
  }

  public setSelfIdentity(selfId: string, spawnIndex: number) {
    this.selfId = selfId;
    this.spawnIndex = spawnIndex;
    this.respawnSelfAtCorner(spawnIndex);
    this.rebuildBots();
  }

  private respawnSelfAtCorner(spawnIdx: number) {
    const sp = this.arena.spawnPoints[spawnIdx % this.arena.spawnPoints.length] ?? {
      x: -18,
      z: -18,
      yaw: 0,
    };
    this.pos = resolveTopDownCollision(
      { x: sp.x, z: sp.z },
      PLAYER_RADIUS,
      this.arena.halfSize,
      this.arena.obstacles,
    );
    this.vel = { x: 0, z: 0 };
    this.spinAngle = sp.yaw;
    this.hp = this.maxHp;
  }

  public setBotsEnabled(enabled: boolean) {
    this.botsEnabled = enabled;
    this.rebuildBots();
  }

  private rebuildBots() {
    if (!this.botsEnabled || this.remotePlayers.size >= 3) {
      this.bots = [];
      return;
    }

    const occupiedSpawns = new Set<number>([this.spawnIndex]);
    for (const rp of this.remotePlayers.values()) {
      occupiedSpawns.add(rp.spawnIndex);
    }

    // 3 genuinely distinct enemy archetypes, silhouettes, loadouts & movement policies!
    const specs: Array<{
      name: string;
      archetype: BotArchetype;
      gun: LaserGunConfig;
      spinDir: 1 | -1;
    }> = [
      {
        name: 'Viper Lance (Bot)',
        archetype: 'sniper_kiter',
        gun: PRESET_LASER_GUNS[0], // 1 straight long laser (26m)
        spinDir: 1,
      },
      {
        name: 'Helix Orbiter (Bot)',
        archetype: 'spiral_orbiter',
        gun: PRESET_LASER_GUNS[2], // 3 curved spiral lasers (13.1m)
        spinDir: -1,
      },
      {
        name: 'Nova Charger (Bot)',
        archetype: 'nova_charger',
        gun: PRESET_LASER_GUNS[3], // 6 short radial lasers (8.6m)
        spinDir: 1,
      },
    ];

    const nextBots: BotActor[] = [];
    let specIdx = 0;
    for (let spIdx = 0; spIdx < 4 && specIdx < specs.length; spIdx++) {
      if (occupiedSpawns.has(spIdx)) continue;
      const sp = this.arena.spawnPoints[spIdx];
      const spec = specs[specIdx++];
      nextBots.push({
        id: `bot-${spIdx}`,
        name: spec.name,
        archetype: spec.archetype,
        spawnIndex: spIdx,
        color: sp.color,
        x: sp.x,
        z: sp.z,
        vx: 0,
        vz: 0,
        spinAngle: sp.yaw,
        spinDirection: spec.spinDir,
        hp: 100,
        maxHp: 100,
        kills: 0,
        deaths: 0,
        gun: { ...spec.gun, color: sp.color },
        cooldownRemaining: 1.2 + specIdx * 0.55,
        telegraphRemaining: 0,
        strafeSign: specIdx % 2 === 0 ? 1 : -1,
        strafeTimer: 2.2,
        hitFlashTimer: 0,
      });
    }
    this.bots = nextBots;
  }

  public syncRemotePlayers(players: RoomPlayerState[]) {
    const next = new Map<string, RoomPlayerState>();
    for (const p of players) {
      if (p.id === this.selfId) {
        this.spawnIndex = p.spawnIndex;
        continue;
      }
      next.set(p.id, { ...p });
    }
    this.remotePlayers = next;
    this.rebuildBots();
  }

  public applyRemoteStateDelta(delta: RemoteStatePayload) {
    if (delta.id === this.selfId) return;
    const existing = this.remotePlayers.get(delta.id);
    if (existing) {
      existing.x = delta.x;
      existing.z = delta.z;
      existing.yaw = delta.yaw;
      if (delta.gun) existing.gun = delta.gun;
      if (delta.weaponName) existing.weaponName = delta.weaponName;
    }
  }

  public spawnRemotePulses(pulses: LaserPulsePath[]) {
    for (const p of pulses) {
      if (!p.points || p.points.length < 2) continue;
      this.activePulses.push({
        points: p.points,
        color: p.color || '#f59e0b',
        impactPoint: p.impactPoint,
        age: 0,
        duration: 0.28,
      });
      if (p.impactPoint) {
        this.spawnImpactParticles(p.impactPoint.x, p.impactPoint.z, p.color || '#f59e0b', 8);
      }
    }
    sfx.playLaserPulse(pulses.length, false);
  }

  public applyRemoteDamageToSelf(nextHp: number) {
    if (nextHp < this.hp) {
      this.damageFlashTimer = 0.22;
      this.selfHitFlashTimer = 0.08;
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.35);
      sfx.playHurt();
    }
    this.hp = Math.max(0, nextHp);
    this.emitHudSnapshot(true);
  }

  public handleEliminationEvent(data: {
    killerId: string;
    victimId: string;
    respawnedVictim: RoomPlayerState;
  }) {
    if (data.killerId === this.selfId) {
      this.kills += 1;
      this.hitmarkerTimer = 0.24;
      this.hitstopTimer = 0.05;
      sfx.playHitmarker(true);
    }
    if (data.victimId === this.selfId) {
      this.deaths += 1;
      this.respawnSelfAtCorner(this.spawnIndex);
      this.damageFlashTimer = 0.32;
      sfx.playHurt();
    }
    this.emitHudSnapshot(true);
  }

  public setTimeRemaining(sec: number) {
    this.timeRemainingSec = Math.max(0, sec);
    this.emitHudSnapshot(true);
  }

  public resetMatchStats() {
    this.kills = 0;
    this.deaths = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.gestureCounts = {};
    this.voiceCommandsCount = 0;
    this.cooldownRemainingSec = 0;
    this.callbacks.onCooldownChange(0, 0);
    this.activePulses = [];
    this.respawnSelfAtCorner(this.spawnIndex);
    this.rebuildBots();
    this.emitHudSnapshot(true);
  }

  public getTelemetrySnapshot() {
    return {
      kills: this.kills,
      deaths: this.deaths,
      shotsFired: this.shotsFired,
      shotsHit: this.shotsHit,
      gestureCounts: { ...this.gestureCounts },
      voiceCommandsCount: this.voiceCommandsCount,
      botStandings: this.bots.map((b) => ({
        id: b.id,
        name: b.name,
        spawnIndex: b.spawnIndex,
        color: b.color,
        x: b.x,
        y: 0,
        z: b.z,
        yaw: b.spinAngle,
        pitch: 0,
        hp: b.hp,
        kills: b.kills,
        deaths: b.deaths,
        weaponId: b.gun.id,
        weaponName: b.gun.name,
        alive: true,
        isBot: true,
      })),
    };
  }

  public pushGestureSnapshot(snap: GestureStateSnapshot) {
    this.activeLeftGesture = snap.leftGesture;
    this.activeRightGesture = snap.rightGesture;

    // Strictly honor: if Left Hand movement pointing gesture is NOT visible, move vector is (0, 0) -> spin in place!
    if (snap.leftGesture === 'POINT_MOVE') {
      this.handMoveVec = { x: snap.moveX, z: snap.moveZ };
      this.gestureCounts.POINT_MOVE = (this.gestureCounts.POINT_MOVE || 0) + 1;
    } else {
      this.handMoveVec = { x: 0, z: 0 };
    }

    if (snap.justFired && (this.phase === 'playing' || this.phase === 'tutorial')) {
      this.gestureCounts.SHOOT_PULSE = (this.gestureCounts.SHOOT_PULSE || 0) + 1;
      this.queuedPulseFire = true;
    }
  }

  public triggerVoiceAction(action: VoiceActionType) {
    this.voiceCommandsCount += 1;
    if (action === 'pulse') {
      this.lastVoiceCommand = 'Voice: Pulse!';
      this.queuedPulseFire = true;
    } else if (action === 'reverse_spin') {
      this.lastVoiceCommand = 'Voice: Spin Reversed';
      this.reverseSpin();
    } else if (action === 'cycle_gun') {
      const next = cyclePresetGun(this.gun.id);
      this.lastVoiceCommand = `Voice: ${next.name}`;
      this.setLaserGun(next);
    }
    this.emitHudSnapshot(true);
  }

  private spawnImpactParticles(x: number, z: number, color: string, count: number) {
    let spawned = 0;
    for (const pt of this.particles) {
      if (pt.active) continue;
      const ang = Math.random() * Math.PI * 2;
      const spd = 2.4 + Math.random() * 6.8;
      pt.active = true;
      pt.x = x;
      pt.z = z;
      pt.vx = Math.cos(ang) * spd;
      pt.vz = Math.sin(ang) * spd;
      pt.age = 0;
      pt.life = 0.22 + Math.random() * 0.22;
      pt.color = color;
      pt.size = 2 + Math.random() * 2.5;
      spawned++;
      if (spawned >= count) break;
    }
  }

  private firePlayerSinglePulse() {
    const gate = evaluatePulseFireGate({
      justFired: true,
      cooldownRemainingSec: this.cooldownRemainingSec,
    });

    if (!gate.allowed) {
      if (gate.blockedByCooldown) {
        sfx.playCooldownBlocked();
      }
      return;
    }

    this.cooldownRemainingSec = gate.nextCooldownSec;
    this.callbacks.onCooldownChange(this.cooldownRemainingSec, 1);
    this.callbacks.onPulseAccepted?.();

    const targets: LaserTargetCircle[] = [];
    for (const b of this.bots) {
      targets.push({ id: b.id, x: b.x, z: b.z, radius: PLAYER_RADIUS });
    }
    for (const rp of this.remotePlayers.values()) {
      if (rp.alive) {
        targets.push({ id: rp.id, x: rp.x, z: rp.z, radius: PLAYER_RADIUS });
      }
    }

    const pulsesOut: LaserPulsePath[] = [];
    const hitCountPerTarget = new Map<string, number>();

    for (const pt of this.gun.shootingPoints) {
      const res = traceCurvedLaserBeam({
        origin: this.pos,
        emitterRadius: PLAYER_RADIUS,
        baseSpinRad: this.spinAngle,
        point: pt,
        maxRange: this.gun.range,
        halfSize: this.arena.halfSize,
        obstacles: this.arena.obstacles,
        targets,
      });

      pulsesOut.push({
        points: res.points,
        color: this.gun.color,
        impactPoint: res.impactPoint,
      });

      this.activePulses.push({
        points: res.points,
        color: this.gun.color,
        impactPoint: res.impactPoint,
        age: 0,
        duration: 0.3,
      });

      if (res.impactPoint) {
        this.spawnImpactParticles(res.impactPoint.x, res.impactPoint.z, this.gun.color, 9);
      }

      for (const tid of res.hitTargetIds) {
        hitCountPerTarget.set(tid, (hitCountPerTarget.get(tid) || 0) + 1);
      }
    }

    this.shotsFired += 1;
    const isCurved = this.gun.shootingPoints.some((p) => Math.abs(p.curvature) > 0.08);
    sfx.playLaserPulse(this.gun.shootingPoints.length, isCurved);
    this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.16);

    if (hitCountPerTarget.size > 0) {
      this.shotsHit += 1;
      this.hitmarkerTimer = 0.2;
      let anyKilled = false;

      for (const [tid, beamHits] of hitCountPerTarget.entries()) {
        // Diminishing multi-beam overlap bonus so 6-beam point-blank bursts feel rewarding without insta-deleting
        const rawDmg =
          this.gun.damagePerBeam *
          (1 + (beamHits - 1) * 0.45) *
          this.arena.mutator.damageMultiplier;
        const dmg = Math.round(rawDmg);

        const bot = this.bots.find((b) => b.id === tid);
        if (bot) {
          bot.hp = Math.max(0, bot.hp - dmg);
          bot.hitFlashTimer = 0.08;
          this.spawnImpactParticles(bot.x, bot.z, '#ffffff', 14);
          if (bot.hp <= 0) {
            anyKilled = true;
            this.kills += 1;
            bot.deaths += 1;
            bot.hp = bot.maxHp;
            const sp = this.arena.spawnPoints[bot.spawnIndex % this.arena.spawnPoints.length];
            bot.x = sp.x;
            bot.z = sp.z;
            bot.cooldownRemaining = 1.8;
            bot.telegraphRemaining = 0;
            this.spawnImpactParticles(sp.x, sp.z, bot.color, 20);
            this.callbacks.onBotKill(bot.name, this.gun.name);
          }
        } else if (this.remotePlayers.has(tid)) {
          this.callbacks.onRemoteHit(tid, dmg, this.gun.name);
        }
      }

      this.hitstopTimer = anyKilled ? 0.055 : 0.03;
      if (anyKilled) {
        this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.3);
      }
      sfx.playHitmarker(anyKilled);
    }

    this.callbacks.onBroadcastShot(pulsesOut);
    this.emitHudSnapshot(true);
  }

  private updateBots(simDt: number) {
    if (this.phase !== 'playing' && this.phase !== 'tutorial') return;
    const isTutorial = this.phase === 'tutorial';

    // Limit concurrent bot telegraphs/attacks via crowd token pool (max 2 attacking at once)
    let activeTelegraphs = this.bots.filter((b) => b.telegraphRemaining > 0).length;

    for (const bot of this.bots) {
      bot.spinAngle =
        (bot.spinAngle +
          bot.gun.spinSpeed *
            bot.spinDirection *
            this.arena.mutator.spinMultiplier *
            simDt) %
        (Math.PI * 2);

      if (bot.hitFlashTimer > 0) {
        bot.hitFlashTimer = Math.max(0, bot.hitFlashTimer - simDt);
      }
      if (bot.cooldownRemaining > 0) {
        bot.cooldownRemaining = Math.max(0, bot.cooldownRemaining - simDt);
      }

      bot.strafeTimer -= simDt;
      if (bot.strafeTimer <= 0) {
        bot.strafeSign = bot.strafeSign === 1 ? -1 : 1;
        bot.strafeTimer = 1.8 + Math.random() * 1.8;
      }

      // Vector toward local player
      const dx = this.pos.x - bot.x;
      const dz = this.pos.z - bot.z;
      const dist = Math.max(0.01, Math.hypot(dx, dz));
      const nx = dx / dist;
      const nz = dz / dist;
      const tx = -nz * bot.strafeSign;
      const tz = nx * bot.strafeSign;

      // 3 distinct movement policies per archetype (gentle standoff in tutorial mode)
      let moveDirX = 0;
      let moveDirZ = 0;
      let speedScale = isTutorial ? 0.42 : 0.76;

      if (isTutorial) {
        const radial = dist < 11 ? -0.75 : dist > 16 ? 0.55 : 0;
        moveDirX = nx * radial + tx * 0.85;
        moveDirZ = nz * radial + tz * 0.85;
      } else if (bot.archetype === 'sniper_kiter') {
        // Maintains 13m..18m standoff distance while strafing laterally
        const radial = dist < 12.5 ? -0.85 : dist > 18.5 ? 0.75 : 0;
        moveDirX = nx * radial + tx * 0.85;
        moveDirZ = nz * radial + tz * 0.85;
        speedScale = 0.72;
      } else if (bot.archetype === 'spiral_orbiter') {
        // Orbits tightly at 8m..11m midrange to curve spiral beams around cover
        const radial = dist < 7.5 ? -0.6 : dist > 11.2 ? 0.75 : 0.1;
        moveDirX = nx * radial + tx * 1.0;
        moveDirZ = nz * radial + tz * 1.0;
        speedScale = 0.82;
      } else {
        // Nova Charger: rushes into <7.5m range, pauses movement briefly while charging pulse
        const radial = dist > 6.4 ? 0.95 : -0.25;
        moveDirX = nx * radial + tx * 0.42;
        moveDirZ = nz * radial + tz * 0.42;
        speedScale = bot.telegraphRemaining > 0 ? 0.35 : 0.88;
      }

      const mLen = Math.hypot(moveDirX, moveDirZ);
      if (mLen > 0.01) {
        const spd = MOVE_SPEED * speedScale * this.arena.mutator.speedMultiplier;
        const nextPos = resolveTopDownCollision(
          {
            x: bot.x + (moveDirX / mLen) * spd * simDt,
            z: bot.z + (moveDirZ / mLen) * spd * simDt,
          },
          PLAYER_RADIUS,
          this.arena.halfSize,
          this.arena.obstacles,
        );
        bot.x = nextPos.x;
        bot.z = nextPos.z;
      }

      // Passive target dummies during Tutorial; telegraphed single-pulse fire during Playing
      if (isTutorial) continue;

      if (bot.telegraphRemaining > 0) {
        bot.telegraphRemaining -= simDt;
        if (bot.telegraphRemaining <= 0) {
          this.fireBotPulse(bot);
        }
      } else if (
        bot.cooldownRemaining <= 0 &&
        dist <= bot.gun.range * 1.04 &&
        activeTelegraphs < 2
      ) {
        const angleToPlayer = Math.atan2(dz, dx);
        const aligned = bot.gun.shootingPoints.some((pt) => {
          const worldAng =
            bot.spinAngle +
            (pt.angleDeg * Math.PI) / 180 +
            bot.gun.spinSpeed * bot.spinDirection * 0.36;
          const diff = Math.atan2(Math.sin(angleToPlayer - worldAng), Math.cos(angleToPlayer - worldAng));
          return Math.abs(diff) < 0.48;
        });

        if (aligned) {
          bot.telegraphRemaining = 0.36;
          activeTelegraphs++;
          sfx.playEnemyTelegraph();
        }
      }
    }
  }

  private fireBotPulse(bot: BotActor) {
    bot.cooldownRemaining = LASER_COOLDOWN_SEC; // Same 3.0s cooldown rule!
    const targets: LaserTargetCircle[] = [
      { id: this.selfId, x: this.pos.x, z: this.pos.z, radius: PLAYER_RADIUS },
    ];

    let hitPlayer = false;
    for (const pt of bot.gun.shootingPoints) {
      const res = traceCurvedLaserBeam({
        origin: { x: bot.x, z: bot.z },
        emitterRadius: PLAYER_RADIUS,
        baseSpinRad: bot.spinAngle,
        point: pt,
        maxRange: bot.gun.range,
        halfSize: this.arena.halfSize,
        obstacles: this.arena.obstacles,
        targets,
      });

      this.activePulses.push({
        points: res.points,
        color: bot.color,
        impactPoint: res.impactPoint,
        age: 0,
        duration: 0.28,
      });

      if (res.impactPoint) {
        this.spawnImpactParticles(res.impactPoint.x, res.impactPoint.z, bot.color, 7);
      }
      if (res.hitTargetIds.includes(this.selfId)) {
        hitPlayer = true;
      }
    }

    sfx.playLaserPulse(bot.gun.shootingPoints.length, false);

    if (hitPlayer && this.phase === 'playing') {
      const botDmg = Math.round(bot.gun.damagePerBeam * 0.58 * this.arena.mutator.damageMultiplier);
      const res = applyDamageAndRespawn(
        {
          id: this.selfId,
          name: 'You',
          spawnIndex: this.spawnIndex,
          color: '#38bdf8',
          x: this.pos.x,
          y: 0,
          z: this.pos.z,
          yaw: this.spinAngle,
          pitch: 0,
          hp: this.hp,
          kills: this.kills,
          deaths: this.deaths,
          weaponId: this.gun.id,
          alive: true,
        },
        botDmg,
        this.arena.spawnPoints,
      );

      this.damageFlashTimer = 0.24;
      this.selfHitFlashTimer = 0.09;
      this.cameraTrauma = Math.min(1, this.cameraTrauma + 0.34);
      sfx.playHurt();

      if (res.killed) {
        bot.kills += 1;
        this.deaths += 1;
        this.respawnSelfAtCorner(this.spawnIndex);
        this.callbacks.onBotKilledSelf?.(bot.name, bot.gun.name);
      } else {
        this.hp = res.respawnedPlayer.hp;
      }
      this.emitHudSnapshot(true);
    }
  }

  private computeDesiredMovement(): Vec2 {
    let kx = 0;
    let kz = 0;
    if (this.keysPressed.has('KeyA') || this.keysPressed.has('ArrowLeft')) kx -= 1;
    if (this.keysPressed.has('KeyD') || this.keysPressed.has('ArrowRight')) kx += 1;
    if (this.keysPressed.has('KeyW') || this.keysPressed.has('ArrowUp')) kz -= 1;
    if (this.keysPressed.has('KeyS') || this.keysPressed.has('ArrowDown')) kz += 1;

    if (kx !== 0 || kz !== 0) {
      const len = Math.hypot(kx, kz);
      return { x: kx / len, z: kz / len };
    }

    // Webcam Left-Hand Point direction (strictly 0,0 when not visible -> spins in place!)
    return this.handMoveVec;
  }

  private stepSimulation(rawDt: number) {
    const dt = Math.min(rawDt, 0.05);

    // Tick real-time visual timers even during hitstop
    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
    }
    this.cameraTrauma = Math.max(0, this.cameraTrauma - dt * 1.9);
    if (this.hitmarkerTimer > 0) this.hitmarkerTimer = Math.max(0, this.hitmarkerTimer - dt);
    if (this.damageFlashTimer > 0) this.damageFlashTimer = Math.max(0, this.damageFlashTimer - dt);
    if (this.selfHitFlashTimer > 0) this.selfHitFlashTimer = Math.max(0, this.selfHitFlashTimer - dt);

    // Update fading laser beams & pooled particles
    for (let i = this.activePulses.length - 1; i >= 0; i--) {
      this.activePulses[i].age += dt;
      if (this.activePulses[i].age >= this.activePulses[i].duration) {
        this.activePulses.splice(i, 1);
      }
    }
    for (const pt of this.particles) {
      if (!pt.active) continue;
      pt.age += dt;
      if (pt.age >= pt.life) {
        pt.active = false;
        continue;
      }
      pt.x += pt.vx * dt;
      pt.z += pt.vz * dt;
      pt.vx *= 0.92;
      pt.vz *= 0.92;
    }

    if (this.phase === 'paused' || this.phase === 'gameover') {
      return;
    }

    // Showcase spin on Title Screen (centered at 0,0 or gentle camera pan)
    if (this.phase === 'title') {
      this.spinAngle =
        (this.spinAngle + this.gun.spinSpeed * this.spinDirection * dt) % (Math.PI * 2);
      this.camCenter = { x: 0, z: 0 };
      return;
    }

    const simDt = this.hitstopTimer > 0 ? 0 : dt;
    if (simDt <= 0) return;

    // 1. Player circle is ALWAYS spinning!
    this.spinAngle =
      (this.spinAngle +
        this.gun.spinSpeed *
          this.spinDirection *
          this.arena.mutator.spinMultiplier *
          simDt) %
      (Math.PI * 2);

    // 2. Tick 3.0s laser pulse cooldown & sync to webcam hand overlay
    if (this.cooldownRemainingSec > 0) {
      this.cooldownRemainingSec = Math.max(0, this.cooldownRemainingSec - simDt);
      this.callbacks.onCooldownChange(
        this.cooldownRemainingSec,
        this.cooldownRemainingSec / LASER_COOLDOWN_SEC,
      );
    }

    // 3. Movement: only moves when Left Hand Point gesture (or WASD fallback) is active; otherwise stationary spin!
    const moveDir = this.computeDesiredMovement();
    const moveMag = Math.hypot(moveDir.x, moveDir.z);
    if (moveMag > 0.02) {
      const speed = MOVE_SPEED * this.arena.mutator.speedMultiplier;
      this.vel = {
        x: (moveDir.x / moveMag) * speed,
        z: (moveDir.z / moveMag) * speed,
      };
      this.pos = resolveTopDownCollision(
        {
          x: this.pos.x + this.vel.x * simDt,
          z: this.pos.z + this.vel.z * simDt,
        },
        PLAYER_RADIUS,
        this.arena.halfSize,
        this.arena.obstacles,
      );
    } else {
      // Stationary spin in place!
      this.vel = { x: 0, z: 0 };
    }

    // 4. Consume queued single-pulse fire trigger
    if (this.queuedPulseFire) {
      this.queuedPulseFire = false;
      this.firePlayerSinglePulse();
    }

    // 5. Step AI Bots
    this.updateBots(simDt);

    // 6. Camera framing: keep full arena centered on desktop; follow player smoothly on narrow viewports
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const isDesktopFit = this.canvas.width >= 960 * dpr;
    const followFactor = isDesktopFit ? 0 : 0.35;
    const targetCamX = this.pos.x * followFactor;
    const targetCamZ = this.pos.z * followFactor;
    const damp = 1 - Math.exp(-7.5 * simDt);
    this.camCenter.x += (targetCamX - this.camCenter.x) * damp;
    this.camCenter.z += (targetCamZ - this.camCenter.z) * damp;

    // 7. Broadcast multiplayer state (~20Hz) & throttled React HUD updates (~15Hz)
    const now = performance.now();
    if (now - this.lastNetSyncMs >= 50) {
      this.lastNetSyncMs = now;
      this.callbacks.onBroadcastState({
        x: Number(this.pos.x.toFixed(2)),
        y: 0,
        z: Number(this.pos.z.toFixed(2)),
        yaw: Number(this.spinAngle.toFixed(3)),
        pitch: 0,
        weaponId: this.gun.id,
        weaponName: this.gun.name,
        gun: this.gun,
      });
    }

    if (now - this.lastHudPushMs >= 65) {
      this.emitHudSnapshot(false);
    }
  }

  private emitHudSnapshot(force: boolean) {
    const now = performance.now();
    if (!force && now - this.lastHudPushMs < 60) return;
    this.lastHudPushMs = now;

    this.callbacks.onHudUpdate({
      hp: this.hp,
      maxHp: this.maxHp,
      gun: this.gun,
      cooldownRemainingSec: Number(this.cooldownRemainingSec.toFixed(2)),
      cooldownRatio: Number((this.cooldownRemainingSec / LASER_COOLDOWN_SEC).toFixed(3)),
      isMoving: Math.hypot(this.vel.x, this.vel.z) > 0.1,
      spinDirection: this.spinDirection,
      kills: this.kills,
      deaths: this.deaths,
      timeRemainingSec: this.timeRemainingSec,
      activeRightGesture: this.activeRightGesture,
      activeLeftGesture: this.activeLeftGesture,
      shootGestureName: this.shootGestureName,
      lastVoiceCommand: this.lastVoiceCommand,
      hitmarkerActive: this.hitmarkerTimer > 0,
      damageFlashActive: this.damageFlashTimer > 0,
      spawnIndex: this.spawnIndex,
    });
  }

  private renderScene() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const half = this.arena.halfSize;

    // Clear outer void
    ctx.fillStyle = this.arena.palette.skyColor || '#090d16';
    ctx.fillRect(0, 0, w, h);

    // Fit full 44m x 44m arena cleanly inside top/bottom HUD bounds on desktop, or zoom cleanly on mobile
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const topSafePx =
      this.phase === 'title' ? 24 * dpr : this.phase === 'tutorial' ? 168 * dpr : 78 * dpr;
    const bottomSafePx = 22 * dpr;
    const availH = Math.max(220, h - topSafePx - bottomSafePx);
    const isDesktopFit = w >= 960 * dpr;
    const pxPerMeter = isDesktopFit
      ? Math.max(10, Math.min(availH, w - 420 * dpr) / (half * 2.04))
      : Math.max(11 * dpr, Math.min(w, availH) / (half * 1.72));

    const shakeMag = this.cameraTrauma * this.cameraTrauma * 9;
    const shakeX = shakeMag > 0.01 ? (Math.random() * 2 - 1) * shakeMag : 0;
    const shakeY = shakeMag > 0.01 ? (Math.random() * 2 - 1) * shakeMag : 0;

    const originScreenX = w * 0.5 + shakeX;
    const originScreenY = topSafePx + availH * 0.5 + shakeY;

    ctx.save();
    ctx.translate(originScreenX, originScreenY);
    ctx.scale(pxPerMeter, pxPerMeter);
    ctx.translate(-this.camCenter.x, -this.camCenter.z);

    // 1. Arena Floor (Nano Banana seamless tile texture or fallback)
    ctx.save();
    ctx.beginPath();
    ctx.rect(-half, -half, half * 2, half * 2);
    ctx.clip();

    if (this.floorImg && this.floorImg.complete && this.floorImg.naturalWidth > 0) {
      const pattern = ctx.createPattern(this.floorImg, 'repeat');
      if (pattern) {
        // Scale 512px/1024px image down into 8m x 8m world tiles
        const tileMeters = 8;
        const m = new DOMMatrix();
        m.scaleSelf(tileMeters / this.floorImg.naturalWidth, tileMeters / this.floorImg.naturalHeight);
        pattern.setTransform(m);
        ctx.fillStyle = pattern;
        ctx.fillRect(-half, -half, half * 2, half * 2);
      }
      // Subtle palette tint so obstacles & lasers pop with high contrast
      ctx.fillStyle = 'rgba(8, 12, 20, 0.28)';
      ctx.fillRect(-half, -half, half * 2, half * 2);
    } else {
      ctx.fillStyle = this.arena.palette.floorPrimary;
      ctx.fillRect(-half, -half, half * 2, half * 2);
    }

    // Subtle tactical 4m coordinate grid lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.09)';
    ctx.lineWidth = 0.05;
    for (let g = -half + 4; g < half; g += 4) {
      ctx.beginPath();
      ctx.moveTo(g, -half);
      ctx.lineTo(g, half);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-half, g);
      ctx.lineTo(half, g);
      ctx.stroke();
    }

    // 2. Corner Spawn Pads
    for (const sp of this.arena.spawnPoints) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(sp.x, sp.z, 2.0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.fill();
      ctx.strokeStyle = sp.color;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 0.1;
      ctx.setLineDash([0.35, 0.25]);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Top-Down Obstacles (textured with Nano Banana obstacle texture + crisp bevels)
    let obsPattern: CanvasPattern | null = null;
    if (this.obstacleImg && this.obstacleImg.complete && this.obstacleImg.naturalWidth > 0) {
      obsPattern = ctx.createPattern(this.obstacleImg, 'repeat');
      if (obsPattern) {
        const m = new DOMMatrix();
        m.scaleSelf(
          4.5 / this.obstacleImg.naturalWidth,
          4.5 / this.obstacleImg.naturalHeight,
        );
        obsPattern.setTransform(m);
      }
    }

    for (const obs of this.arena.obstacles) {
      const ox = obs.x - obs.width * 0.5;
      const oz = obs.z - obs.depth * 0.5;

      // Drop shadow on floor
      ctx.fillStyle = 'rgba(2, 6, 14, 0.58)';
      ctx.fillRect(ox + 0.22, oz + 0.28, obs.width, obs.depth);

      // Textured top face
      ctx.fillStyle = obsPattern || this.arena.palette.wallPrimary;
      ctx.fillRect(ox, oz, obs.width, obs.depth);

      // Crisp outer stroke + monolith core glow
      ctx.strokeStyle =
        obs.kind === 'monolith'
          ? this.arena.palette.accentGlow
          : 'rgba(226, 232, 240, 0.26)';
      ctx.lineWidth = obs.kind === 'monolith' ? 0.14 : 0.08;
      ctx.strokeRect(ox, oz, obs.width, obs.depth);

      // Inner bevel highlight
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 0.05;
      ctx.strokeRect(ox + 0.16, oz + 0.16, Math.max(0.1, obs.width - 0.32), Math.max(0.1, obs.depth - 0.32));
    }

    ctx.restore(); // End arena floor clip

    // Arena Outer Perimeter Frame
    ctx.strokeStyle = this.arena.palette.accentGlow || '#38bdf8';
    ctx.lineWidth = 0.22;
    ctx.strokeRect(-half, -half, half * 2, half * 2);

    // 4. Title Showcase OR Active Gameplay Entities
    if (this.phase === 'title') {
      // Stage hero spinning circle in the right-center showcase space so player sees live gun changes!
      const showcaseOrigin = { x: 4.5, z: 0 };
      this.drawAimGuideCurves(ctx, showcaseOrigin, this.spinAngle, this.gun, 0.35);
      this.drawSpinningCircleActor(ctx, {
        x: showcaseOrigin.x,
        z: showcaseOrigin.z,
        spinAngle: this.spinAngle,
        color: this.gun.color,
        gun: this.gun,
        hpRatio: 1,
        cooldownRatio: 0,
        telegraphRatio: 0,
        hitFlash: false,
        label: this.gun.name,
        isSelf: true,
      });
    } else {
      // Draw subtle curved/straight laser range guide lines from each of the player's shooting points
      const readyAlpha = this.cooldownRemainingSec > 0 ? 0.11 : 0.28;
      this.drawAimGuideCurves(ctx, this.pos, this.spinAngle, this.gun, readyAlpha);

      // Draw AI Bots
      for (const bot of this.bots) {
        this.drawSpinningCircleActor(ctx, {
          x: bot.x,
          z: bot.z,
          spinAngle: bot.spinAngle,
          color: bot.color,
          gun: bot.gun,
          hpRatio: bot.hp / bot.maxHp,
          cooldownRatio: bot.cooldownRemaining / LASER_COOLDOWN_SEC,
          telegraphRatio: bot.telegraphRemaining > 0 ? bot.telegraphRemaining / 0.36 : 0,
          hitFlash: bot.hitFlashTimer > 0,
          label: bot.name.replace(' (Bot)', ''),
          isSelf: false,
          archetype: bot.archetype,
        });
      }

      // Draw Remote Multiplayer Peers
      for (const rp of this.remotePlayers.values()) {
        if (!rp.alive) continue;
        const rGun = rp.gun || createDefaultLaserGun();
        this.drawSpinningCircleActor(ctx, {
          x: rp.x,
          z: rp.z,
          spinAngle: rp.yaw,
          color: rp.color,
          gun: rGun,
          hpRatio: rp.hp / 100,
          cooldownRatio: 0,
          telegraphRatio: 0,
          hitFlash: false,
          label: rp.name,
          isSelf: false,
        });
      }

      // Draw Local Player Spinning Circle
      const selfColor =
        this.arena.spawnPoints[this.spawnIndex % this.arena.spawnPoints.length]?.color || '#38bdf8';
      this.drawSpinningCircleActor(ctx, {
        x: this.pos.x,
        z: this.pos.z,
        spinAngle: this.spinAngle,
        color: selfColor,
        gun: this.gun,
        hpRatio: this.hp / this.maxHp,
        cooldownRatio: this.cooldownRemainingSec / LASER_COOLDOWN_SEC,
        telegraphRatio: 0,
        hitFlash: this.selfHitFlashTimer > 0,
        label: 'YOU',
        isSelf: true,
      });
    }

    // 5. Active Curved & Straight Laser Pulses
    for (const pulse of this.activePulses) {
      if (pulse.points.length < 2) continue;
      const t = 1 - pulse.age / pulse.duration;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // Outer glow
      ctx.beginPath();
      ctx.moveTo(pulse.points[0].x, pulse.points[0].z);
      for (let i = 1; i < pulse.points.length; i++) {
        ctx.lineTo(pulse.points[i].x, pulse.points[i].z);
      }
      ctx.strokeStyle = pulse.color;
      ctx.globalAlpha = Math.max(0, t * 0.48);
      ctx.lineWidth = 0.58 * t + 0.14;
      ctx.stroke();

      // Inner white-hot core
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = Math.max(0, t * 0.95);
      ctx.lineWidth = 0.18 * t + 0.04;
      ctx.stroke();

      if (pulse.impactPoint) {
        ctx.beginPath();
        ctx.arc(pulse.impactPoint.x, pulse.impactPoint.z, 0.42 * t + 0.08, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
      ctx.restore();
    }

    // 6. Pooled Impact Sparks
    for (const pt of this.particles) {
      if (!pt.active) continue;
      const alpha = 1 - pt.age / pt.life;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.z, pt.size * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }

  private drawAimGuideCurves(
    ctx: CanvasRenderingContext2D,
    origin: Vec2,
    spinAngle: number,
    gun: LaserGunConfig,
    alpha: number,
  ) {
    ctx.save();
    ctx.strokeStyle = gun.color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 0.06;
    ctx.setLineDash([0.32, 0.28]);

    for (const pt of gun.shootingPoints) {
      const preview = traceCurvedLaserBeam({
        origin,
        emitterRadius: PLAYER_RADIUS,
        baseSpinRad: spinAngle,
        point: pt,
        maxRange: gun.range,
        halfSize: this.arena.halfSize,
        obstacles: this.arena.obstacles,
        targets: [],
      });
      if (preview.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(preview.points[0].x, preview.points[0].z);
      for (let i = 1; i < preview.points.length; i++) {
        ctx.lineTo(preview.points[i].x, preview.points[i].z);
      }
      ctx.stroke();
    }

    // Subtle maximum laser distance ring so inverse-range scaling is immediately legible
    ctx.globalAlpha = alpha * 0.45;
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    ctx.arc(origin.x, origin.z, PLAYER_RADIUS + gun.range, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  private drawSpinningCircleActor(
    ctx: CanvasRenderingContext2D,
    opts: {
      x: number;
      z: number;
      spinAngle: number;
      color: string;
      gun: LaserGunConfig;
      hpRatio: number;
      cooldownRatio: number;
      telegraphRatio: number;
      hitFlash: boolean;
      label: string;
      isSelf: boolean;
      archetype?: BotArchetype;
    },
  ) {
    const r = PLAYER_RADIUS;
    ctx.save();
    ctx.translate(opts.x, opts.z);

    // Bot windup telegraph ring before firing (>10% HP damage telegraph)
    if (opts.telegraphRatio > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, r + 0.55 * (1 - opts.telegraphRatio) + 0.2, 0, Math.PI * 2);
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 0.14;
      ctx.stroke();
      ctx.restore();
    }

    // Drop shadow
    ctx.beginPath();
    ctx.arc(0.1, 0.14, r * 1.04, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.52)';
    ctx.fill();

    // Unmistakable outer player locator ring so "YOU" never blends with bot colors
    if (opts.isSelf && this.phase !== 'title') {
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, r + 0.42, 0, Math.PI * 2);
      ctx.strokeStyle = '#38bdf8';
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 0.07;
      ctx.setLineDash([0.28, 0.2]);
      ctx.stroke();
      ctx.restore();
    }

    // Main circular player body ("the player is just a circle")
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = opts.hitFlash ? '#ffffff' : opts.isSelf ? '#0b192c' : '#0f172a';
    ctx.fill();
    ctx.lineWidth = opts.isSelf ? 0.18 : 0.13;
    ctx.strokeStyle = opts.hitFlash ? '#ffffff' : opts.isSelf ? opts.gun.color : opts.color;
    ctx.stroke();

    // Inner core silhouette differentiation for player vs bots
    ctx.beginPath();
    if (opts.isSelf) {
      ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2);
    } else if (opts.archetype === 'sniper_kiter') {
      ctx.moveTo(0, -r * 0.42);
      ctx.lineTo(r * 0.38, r * 0.32);
      ctx.lineTo(-r * 0.38, r * 0.32);
      ctx.closePath();
    } else if (opts.archetype === 'nova_charger') {
      ctx.rect(-r * 0.32, -r * 0.32, r * 0.64, r * 0.64);
    } else {
      ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2);
    }
    ctx.fillStyle = opts.cooldownRatio > 0
      ? 'rgba(100, 116, 139, 0.48)'
      : opts.isSelf
        ? '#ffffff'
        : opts.color;
    ctx.fill();

    // 3.0s Cooldown Recharging Arc right on the circle chassis
    if (opts.cooldownRatio > 0.01) {
      ctx.beginPath();
      ctx.arc(
        0,
        0,
        r * 0.64,
        -Math.PI * 0.5,
        -Math.PI * 0.5 + Math.PI * 2 * (1 - opts.cooldownRatio),
      );
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 0.11;
      ctx.stroke();
    }

    // Rotating Shooting Points mounted on the circle's circumference!
    for (const pt of opts.gun.shootingPoints) {
      const worldAng = opts.spinAngle + (pt.angleDeg * Math.PI) / 180;
      const nx = Math.cos(worldAng) * r;
      const nz = Math.sin(worldAng) * r;
      const tipX = Math.cos(worldAng) * (r + 0.28);
      const tipZ = Math.sin(worldAng) * (r + 0.28);

      ctx.strokeStyle = opts.cooldownRatio > 0 ? '#64748b' : opts.gun.color;
      ctx.lineWidth = 0.16;
      ctx.beginPath();
      ctx.moveTo(nx * 0.82, nz * 0.82);
      ctx.lineTo(tipX, tipZ);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(tipX, tipZ, 0.14, 0, Math.PI * 2);
      ctx.fillStyle = opts.cooldownRatio > 0 ? '#94a3b8' : '#ffffff';
      ctx.fill();
    }

    // Crisp overhead HP bar & scaled name tag (using >=11px font before CTM downscale so Canvas never clamps <1px)
    if (this.phase !== 'title') {
      const barW = 1.65;
      const barH = 0.17;
      ctx.fillStyle = 'rgba(9, 13, 22, 0.88)';
      ctx.fillRect(-barW * 0.5, -r - 0.64, barW, barH);
      ctx.fillStyle = opts.hpRatio <= 0.3 ? '#f43f5e' : opts.isSelf ? '#38bdf8' : opts.color;
      ctx.fillRect(-barW * 0.5, -r - 0.64, barW * Math.max(0, Math.min(1, opts.hpRatio)), barH);

      ctx.save();
      ctx.translate(0, -r - 0.82);
      ctx.scale(0.042, 0.042);
      ctx.font = '700 13px "JetBrains Mono", monospace';
      ctx.fillStyle = opts.isSelf ? '#7dd3fc' : '#e2e8f0';
      ctx.textAlign = 'center';
      ctx.fillText(opts.label, 0, 0);
      ctx.restore();
    }

    ctx.restore();
  }

  private loop = (nowMs: number) => {
    const rawDt = Math.max(0.001, (nowMs - this.lastFrameMs) / 1000);
    this.lastFrameMs = nowMs;

    this.stepSimulation(rawDt);
    this.renderScene();

    this.rafId = requestAnimationFrame(this.loop);
  };

  public dispose() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleFocusLoss);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.canvas.removeEventListener('mousedown', this.handleCanvasMouseDown);
  }
}

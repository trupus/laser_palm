import type {
  ArenaConfig,
  LaserGunConfig,
  LaserShootingPoint,
  ObstacleSpec,
  RoomPlayerState,
  SpawnPoint,
  Vec2,
} from './types';

export const MATCH_DURATION_SEC = 120;
export const MAX_PLAYERS_PER_ROOM = 4;
export const PLAYER_RADIUS = 0.82;
export const MOVE_SPEED = 8.4;
export const DEFAULT_SPIN_SPEED = 0.95; // rad/s — deliberate, smooth continuous spin
export const LASER_COOLDOWN_SEC = 3.0; // Mandatory 3-second cooldown between single laser pulses
export const MAX_SHOOTING_POINTS = 12;
export const BASE_SINGLE_LASER_RANGE = 26.0;
export const MIN_LASER_RANGE = 5.2;

export const SPAWN_COLORS = ['#38bdf8', '#f59e0b', '#34d399', '#f43f5e'];

/**
 * Inverse distance law:
 * The more shooting points your spinning circle has, the shorter distance each laser shoots.
 * - 1 point  -> 26.0m
 * - 2 points -> 16.9m
 * - 3 points -> 13.1m
 * - 4 points -> 11.0m
 * - 6 points ->  8.6m
 * - 8 points ->  7.2m
 * - 12 points -> 5.6m
 */
export function computeLaserRange(pointCount: number): number {
  const clampedCount = Math.max(1, Math.min(MAX_SHOOTING_POINTS, Math.round(pointCount)));
  const raw = BASE_SINGLE_LASER_RANGE / Math.pow(clampedCount, 0.62);
  return Number(Math.max(MIN_LASER_RANGE, Math.min(BASE_SINGLE_LASER_RANGE, raw)).toFixed(2));
}

/**
 * Balances per-beam pulse damage across single-beam snipers and multi-point close rings.
 */
export function computeLaserDamage(pointCount: number): number {
  const clampedCount = Math.max(1, Math.min(MAX_SHOOTING_POINTS, Math.round(pointCount)));
  if (clampedCount === 1) return 46;
  if (clampedCount === 2) return 35;
  if (clampedCount === 3) return 30;
  if (clampedCount <= 5) return 26;
  if (clampedCount <= 8) return 22;
  return 18;
}

export function normalizeAngleDeg(deg: number): number {
  const mod = ((Number(deg) || 0) % 360 + 360) % 360;
  return Number(mod.toFixed(1));
}

export function sanitizeLaserGunConfig(input: Partial<LaserGunConfig>): LaserGunConfig {
  const rawPoints = Array.isArray(input.shootingPoints) && input.shootingPoints.length > 0
    ? input.shootingPoints.slice(0, MAX_SHOOTING_POINTS)
    : [{ angleDeg: 0, curvature: 0 }];

  const shootingPoints: LaserShootingPoint[] = rawPoints.map((pt, idx) => ({
    angleDeg: normalizeAngleDeg(
      typeof pt?.angleDeg === 'number' && Number.isFinite(pt.angleDeg)
        ? pt.angleDeg
        : (idx * 360) / rawPoints.length,
    ),
    curvature: Number(
      Math.max(-2.4, Math.min(2.4, Number(pt?.curvature) || 0)).toFixed(2),
    ),
  }));

  const count = shootingPoints.length;
  const color =
    typeof input.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.color)
      ? input.color
      : '#38bdf8';

  const spinSpeed = Number(
    Math.max(0.45, Math.min(1.8, Number(input.spinSpeed) || DEFAULT_SPIN_SPEED)).toFixed(2),
  );

  return {
    id: String(input.id || `gun-${count}-${Math.abs(Math.round(shootingPoints[0].curvature * 10))}`),
    name: String(input.name || (count === 1 ? 'Mono Pulse Lance' : `${count}-Point Emitter`)).slice(0, 40),
    description: String(
      input.description ||
        `${count} emitter${count > 1 ? 's' : ''} · ${
          shootingPoints.some((p) => Math.abs(p.curvature) > 0.05) ? 'Curved arc' : 'Straight beam'
        }`,
    ).slice(0, 96),
    color,
    spinSpeed,
    shootingPoints,
    range: computeLaserRange(count),
    damagePerBeam: computeLaserDamage(count),
    cooldownSec: LASER_COOLDOWN_SEC,
  };
}

export function createDefaultLaserGun(): LaserGunConfig {
  return sanitizeLaserGunConfig({
    id: 'mono-straight',
    name: 'Mono Pulse Lance',
    description: 'Single straight high-range laser emitter',
    color: '#38bdf8',
    spinSpeed: DEFAULT_SPIN_SPEED,
    shootingPoints: [{ angleDeg: 0, curvature: 0 }],
  });
}

export const PRESET_LASER_GUNS: LaserGunConfig[] = [
  createDefaultLaserGun(),
  sanitizeLaserGunConfig({
    id: 'twin-whip',
    name: 'Twin Crescent',
    description: 'Opposing dual beams with sweeping clockwise curvature',
    color: '#f59e0b',
    spinSpeed: 1.05,
    shootingPoints: [
      { angleDeg: 0, curvature: 0.75 },
      { angleDeg: 180, curvature: 0.75 },
    ],
  }),
  sanitizeLaserGunConfig({
    id: 'tri-vortex',
    name: 'Tri-Vortex Spiral',
    description: 'Three evenly spaced spiral lasers for mid-range hooking',
    color: '#34d399',
    spinSpeed: 0.9,
    shootingPoints: [
      { angleDeg: 0, curvature: 1.05 },
      { angleDeg: 120, curvature: 1.05 },
      { angleDeg: 240, curvature: 1.05 },
    ],
  }),
  sanitizeLaserGunConfig({
    id: 'hexa-nova',
    name: 'Hexa Starburst',
    description: 'Six close-range radial emitters for 360-degree point defense',
    color: '#f43f5e',
    spinSpeed: 0.78,
    shootingPoints: [
      { angleDeg: 0, curvature: 0 },
      { angleDeg: 60, curvature: 0 },
      { angleDeg: 120, curvature: 0 },
      { angleDeg: 180, curvature: 0 },
      { angleDeg: 240, curvature: 0 },
      { angleDeg: 300, curvature: 0 },
    ],
  }),
];

export function cyclePresetGun(currentId: string): LaserGunConfig {
  const idx = PRESET_LASER_GUNS.findIndex((g) => g.id === currentId);
  return PRESET_LASER_GUNS[(idx + 1) % PRESET_LASER_GUNS.length];
}

export function createDefaultSpawnPoints(halfSize = 22): SpawnPoint[] {
  const offset = halfSize - 4;
  return [
    {
      index: 0,
      x: -offset,
      y: 0,
      z: -offset,
      yaw: 0,
      color: SPAWN_COLORS[0],
      label: 'NW Pad',
    },
    {
      index: 1,
      x: offset,
      y: 0,
      z: offset,
      yaw: Math.PI,
      color: SPAWN_COLORS[1],
      label: 'SE Pad',
    },
    {
      index: 2,
      x: offset,
      y: 0,
      z: -offset,
      yaw: Math.PI * 0.5,
      color: SPAWN_COLORS[2],
      label: 'NE Pad',
    },
    {
      index: 3,
      x: -offset,
      y: 0,
      z: offset,
      yaw: Math.PI * 1.5,
      color: SPAWN_COLORS[3],
      label: 'SW Pad',
    },
  ];
}

export function createDefaultArenaConfig(): ArenaConfig {
  const halfSize = 22;
  return {
    name: 'Foundry Sector 04',
    tagline: 'Symmetrical top-down laser crucible with sightline pillars',
    halfSize,
    palette: {
      skyColor: '#0b1018',
      fogColor: '#111827',
      floorPrimary: '#161f2e',
      floorAccent: '#233047',
      wallPrimary: '#2c3a52',
      accentGlow: '#38bdf8',
    },
    mutator: {
      name: 'Standard Calibration',
      description: 'Balanced spin cadence and standard pulse output',
      spinMultiplier: 1,
      speedMultiplier: 1,
      damageMultiplier: 1,
    },
    spawnPoints: createDefaultSpawnPoints(halfSize),
    obstacles: [
      { id: 'center-monolith', x: 0, z: 0, width: 3.6, depth: 3.6, height: 4.0, kind: 'monolith' },
      { id: 'north-wall', x: 0, z: -10.5, width: 6.4, depth: 1.6, height: 2.6, kind: 'barrier' },
      { id: 'south-wall', x: 0, z: 10.5, width: 6.4, depth: 1.6, height: 2.6, kind: 'barrier' },
      { id: 'east-wall', x: 10.5, z: 0, width: 1.6, depth: 6.4, height: 2.6, kind: 'barrier' },
      { id: 'west-wall', x: -10.5, z: 0, width: 1.6, depth: 6.4, height: 2.6, kind: 'barrier' },
      { id: 'nw-pillar', x: -8.2, z: -8.2, width: 2.4, depth: 2.4, height: 3.2, kind: 'pillar' },
      { id: 'ne-pillar', x: 8.2, z: -8.2, width: 2.4, depth: 2.4, height: 3.2, kind: 'pillar' },
      { id: 'sw-pillar', x: -8.2, z: 8.2, width: 2.4, depth: 2.4, height: 3.2, kind: 'pillar' },
      { id: 'se-pillar', x: 8.2, z: 8.2, width: 2.4, depth: 2.4, height: 3.2, kind: 'pillar' },
    ],
  };
}

export function sanitizeArenaObstacles(
  obstacles: ObstacleSpec[],
  spawnPoints: SpawnPoint[],
  halfSize: number,
): ObstacleSpec[] {
  const limit = halfSize - 2.6;
  return obstacles
    .filter((obs) => {
      if (Math.abs(obs.x) > limit || Math.abs(obs.z) > limit) return false;
      for (const sp of spawnPoints) {
        const minClearX = obs.width * 0.5 + 3.4;
        const minClearZ = obs.depth * 0.5 + 3.4;
        if (Math.abs(obs.x - sp.x) < minClearX && Math.abs(obs.z - sp.z) < minClearZ) {
          return false;
        }
      }
      return true;
    })
    .slice(0, 16)
    .map((obs, idx) => ({
      ...obs,
      id: obs.id || `obs-${idx}`,
      width: Math.max(1.4, Math.min(8, obs.width)),
      depth: Math.max(1.4, Math.min(8, obs.depth)),
      height: Math.max(1.2, Math.min(5, obs.height || 2.5)),
    }));
}

export function resolveTopDownCollision(
  pos: Vec2,
  radius: number,
  halfSize: number,
  obstacles: ObstacleSpec[],
): Vec2 {
  let x = Math.max(-halfSize + radius, Math.min(halfSize - radius, pos.x));
  let z = Math.max(-halfSize + radius, Math.min(halfSize - radius, pos.z));

  for (const obs of obstacles) {
    const halfW = obs.width * 0.5;
    const halfD = obs.depth * 0.5;
    const closestX = Math.max(obs.x - halfW, Math.min(x, obs.x + halfW));
    const closestZ = Math.max(obs.z - halfD, Math.min(z, obs.z + halfD));

    const dx = x - closestX;
    const dz = z - closestZ;
    const distSq = dx * dx + dz * dz;

    if (distSq < radius * radius) {
      if (distSq > 1e-6) {
        const dist = Math.sqrt(distSq);
        const push = radius - dist;
        x += (dx / dist) * push;
        z += (dz / dist) * push;
      } else {
        const penX = halfW + radius - Math.abs(x - obs.x);
        const penZ = halfD + radius - Math.abs(z - obs.z);
        if (penX < penZ) {
          x += x >= obs.x ? penX : -penX;
        } else {
          z += z >= obs.z ? penZ : -penZ;
        }
      }
    }
  }

  x = Math.max(-halfSize + radius, Math.min(halfSize - radius, x));
  z = Math.max(-halfSize + radius, Math.min(halfSize - radius, z));
  return { x, z };
}

export function pointInsideObstacle(
  x: number,
  z: number,
  obstacles: ObstacleSpec[],
  padding = 0,
): boolean {
  for (const obs of obstacles) {
    const halfW = obs.width * 0.5 + padding;
    const halfD = obs.depth * 0.5 + padding;
    if (x >= obs.x - halfW && x <= obs.x + halfW && z >= obs.z - halfD && z <= obs.z + halfD) {
      return true;
    }
  }
  return false;
}

export function intersectSegmentWithObstacles(
  px: number,
  pz: number,
  nx: number,
  nz: number,
  obstacles: ObstacleSpec[],
): Vec2 | null {
  const dx = nx - px;
  const dz = nz - pz;
  let bestT: number | null = null;

  for (const obs of obstacles) {
    const minX = obs.x - obs.width * 0.5;
    const maxX = obs.x + obs.width * 0.5;
    const minZ = obs.z - obs.depth * 0.5;
    const maxZ = obs.z + obs.depth * 0.5;

    let tMin = 0;
    let tMax = 1;

    if (Math.abs(dx) < 1e-8) {
      if (px < minX || px > maxX) continue;
    } else {
      const tx1 = (minX - px) / dx;
      const tx2 = (maxX - px) / dx;
      tMin = Math.max(tMin, Math.min(tx1, tx2));
      tMax = Math.min(tMax, Math.max(tx1, tx2));
    }

    if (Math.abs(dz) < 1e-8) {
      if (pz < minZ || pz > maxZ) continue;
    } else {
      const tz1 = (minZ - pz) / dz;
      const tz2 = (maxZ - pz) / dz;
      tMin = Math.max(tMin, Math.min(tz1, tz2));
      tMax = Math.min(tMax, Math.max(tz1, tz2));
    }

    if (tMin <= tMax && tMax >= 0 && tMin <= 1) {
      const hitT = Math.max(0, tMin);
      if (bestT === null || hitT < bestT) {
        bestT = hitT;
      }
    }
  }

  if (bestT === null) return null;
  return {
    x: px + dx * bestT,
    z: pz + dz * bestT,
  };
}

export interface LaserTargetCircle {
  id: string;
  x: number;
  z: number;
  radius: number;
}

export interface TracedLaserResult {
  points: Vec2[];
  hitTargetIds: string[];
  impactPoint?: Vec2;
}

/**
 * Traces a straight (curvature = 0) or curved (curvature != 0) laser beam in top-down 2D space
 * starting at the perimeter of the player's circle and marching up to `maxRange`.
 * Stops at outer arena boundaries or solid obstacles, and detects intersections with enemy circles.
 */
export function traceCurvedLaserBeam(params: {
  origin: Vec2;
  emitterRadius: number;
  baseSpinRad: number;
  point: LaserShootingPoint;
  maxRange: number;
  halfSize: number;
  obstacles: ObstacleSpec[];
  targets: LaserTargetCircle[];
}): TracedLaserResult {
  const {
    origin,
    emitterRadius,
    baseSpinRad,
    point,
    maxRange,
    halfSize,
    obstacles,
    targets,
  } = params;

  const startAngle = baseSpinRad + (point.angleDeg * Math.PI) / 180;
  let px = origin.x + Math.cos(startAngle) * emitterRadius;
  let pz = origin.z + Math.sin(startAngle) * emitterRadius;

  const points: Vec2[] = [{ x: px, z: pz }];
  const hitSet = new Set<string>();
  let impactPoint: Vec2 | undefined;

  const stepSize = 0.32;
  const totalSteps = Math.max(2, Math.ceil(maxRange / stepSize));
  const actualStep = maxRange / totalSteps;

  for (let i = 1; i <= totalSteps; i++) {
    const progress = (i - 0.5) / totalSteps; // 0..1 along beam length
    // Curvature bends the instantaneous heading smoothly as the laser travels outward
    const theta = startAngle + point.curvature * progress * 1.75;
    const nx = px + Math.cos(theta) * actualStep;
    const nz = pz + Math.sin(theta) * actualStep;

    // Check outer wall collision
    if (Math.abs(nx) >= halfSize || Math.abs(nz) >= halfSize) {
      const clampedX = Math.max(-halfSize, Math.min(halfSize, nx));
      const clampedZ = Math.max(-halfSize, Math.min(halfSize, nz));
      points.push({ x: clampedX, z: clampedZ });
      impactPoint = { x: clampedX, z: clampedZ };
      break;
    }

    // Check obstacle surface collision
    const obsHit = intersectSegmentWithObstacles(px, pz, nx, nz, obstacles);
    if (obsHit) {
      points.push(obsHit);
      impactPoint = obsHit;
      break;
    }

    // Check circle target hits along segment (px,pz) -> (nx,nz)
    for (const target of targets) {
      if (hitSet.has(target.id)) continue;
      const segDx = nx - px;
      const segDz = nz - pz;
      const segLenSq = segDx * segDx + segDz * segDz;
      const t =
        segLenSq > 1e-8
          ? Math.max(0, Math.min(1, ((target.x - px) * segDx + (target.z - pz) * segDz) / segLenSq))
          : 0;
      const closestX = px + segDx * t;
      const closestZ = pz + segDz * t;
      const dist = Math.hypot(target.x - closestX, target.z - closestZ);
      if (dist <= target.radius + 0.14) {
        hitSet.add(target.id);
        impactPoint = { x: closestX, z: closestZ };
      }
    }

    px = nx;
    pz = nz;
    // Subsample polyline vertices slightly to keep rendering crisp and lightweight
    if (i % 2 === 0 || i === totalSteps) {
      points.push({ x: px, z: pz });
    }
  }

  return {
    points,
    hitTargetIds: Array.from(hitSet),
    impactPoint,
  };
}

/**
 * Enforces single-pulse edge firing with a strict 3.0-second cooldown.
 * Holding the gesture does NOT re-fire; `justFired` must be true AND `cooldownRemaining <= 0`.
 */
export function evaluatePulseFireGate(params: {
  justFired: boolean;
  cooldownRemainingSec: number;
}): {
  allowed: boolean;
  nextCooldownSec: number;
  blockedByCooldown: boolean;
} {
  if (!params.justFired) {
    return {
      allowed: false,
      nextCooldownSec: Math.max(0, params.cooldownRemainingSec),
      blockedByCooldown: false,
    };
  }
  if (params.cooldownRemainingSec > 0.001) {
    return {
      allowed: false,
      nextCooldownSec: params.cooldownRemainingSec,
      blockedByCooldown: true,
    };
  }
  return {
    allowed: true,
    nextCooldownSec: LASER_COOLDOWN_SEC,
    blockedByCooldown: false,
  };
}

export function applyDamageAndRespawn(
  victim: RoomPlayerState,
  damage: number,
  spawnPoints: SpawnPoint[],
): { killed: boolean; respawnedPlayer: RoomPlayerState } {
  const nextHp = Math.max(0, victim.hp - Math.round(damage));
  if (nextHp > 0) {
    return {
      killed: false,
      respawnedPlayer: {
        ...victim,
        hp: nextHp,
      },
    };
  }

  const originalSpawn = spawnPoints[victim.spawnIndex % spawnPoints.length] ?? spawnPoints[0];
  return {
    killed: true,
    respawnedPlayer: {
      ...victim,
      hp: 100,
      deaths: victim.deaths + 1,
      x: originalSpawn.x,
      y: 0,
      z: originalSpawn.z,
      yaw: originalSpawn.yaw,
      pitch: 0,
      alive: true,
    },
  };
}

export function sortLeaderboard(players: RoomPlayerState[]): RoomPlayerState[] {
  return [...players].sort((a, b) => {
    if (b.kills !== a.kills) return b.kills - a.kills;
    return a.deaths - b.deaths;
  });
}

export function formatMatchClock(seconds: number): string {
  const clamped = Math.max(0, Math.ceil(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

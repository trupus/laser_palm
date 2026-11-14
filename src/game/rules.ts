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
export const PLAYER_RADIUS = 0.82;
export const MOVE_SPEED = 8.4;
export const DEFAULT_SPIN_SPEED = 0.95; // rad/s — deliberate, smooth continuous spin
export const LASER_COOLDOWN_SEC = 3.0; // Mandatory 3-second cooldown between single laser pulses
export const LASER_ACTIVE_DURATION_SEC = 0.34; // Keep laser active ~340ms so spinning/moving sweeps a wider attack area
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

export type ProceduralBorderStyle =
  | 'octagon'
  | 'hexagon'
  | 'star'
  | 'hourglass'
  | 'crater'
  | 'diamond';

export function createProceduralArenaPolygon(
  style: ProceduralBorderStyle = 'octagon',
  halfSize = 22,
  seed = 1,
): Vec2[] {
  const pts: Vec2[] = [];
  if (style === 'octagon') {
    const n = 8;
    const r = halfSize * 0.98;
    for (let i = 0; i < n; i++) {
      const a = (i * Math.PI * 2) / n + Math.PI / 8;
      pts.push({
        x: Number((Math.cos(a) * r).toFixed(2)),
        z: Number((Math.sin(a) * r).toFixed(2)),
      });
    }
    return pts;
  }
  if (style === 'hexagon') {
    const n = 6;
    const r = halfSize * 0.98;
    for (let i = 0; i < n; i++) {
      const a = (i * Math.PI * 2) / n;
      pts.push({
        x: Number((Math.cos(a) * r).toFixed(2)),
        z: Number((Math.sin(a) * r).toFixed(2)),
      });
    }
    return pts;
  }
  if (style === 'diamond') {
    return [
      { x: 0, z: -halfSize * 0.98 },
      { x: halfSize * 0.96, z: 0 },
      { x: 0, z: halfSize * 0.98 },
      { x: -halfSize * 0.96, z: 0 },
    ];
  }
  if (style === 'star') {
    const spikes = 5;
    const outerR = halfSize * 0.98;
    const innerR = halfSize * 0.62;
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const a = (i * Math.PI) / spikes - Math.PI * 0.5;
      pts.push({
        x: Number((Math.cos(a) * r).toFixed(2)),
        z: Number((Math.sin(a) * r).toFixed(2)),
      });
    }
    return pts;
  }
  if (style === 'hourglass') {
    const w = halfSize * 0.92;
    const h = halfSize * 0.94;
    const waist = halfSize * 0.46;
    return [
      { x: -w, z: -h },
      { x: w, z: -h },
      { x: w, z: -h * 0.45 },
      { x: waist, z: 0 },
      { x: w, z: h * 0.45 },
      { x: w, z: h },
      { x: -w, z: h },
      { x: -w, z: h * 0.45 },
      { x: -waist, z: 0 },
      { x: -w, z: -h * 0.45 },
    ];
  }

  // Organic irregular crater ('crater')
  const count = 14;
  for (let i = 0; i < count; i++) {
    const a = (i * Math.PI * 2) / count;
    const wave =
      0.83 +
      0.11 * Math.sin(a * 3 + seed * 1.7) +
      0.07 * Math.cos(a * 5 - seed * 2.3);
    const r = halfSize * wave;
    pts.push({
      x: Number((Math.cos(a) * r).toFixed(2)),
      z: Number((Math.sin(a) * r).toFixed(2)),
    });
  }
  return pts;
}

export function computePolygonSignedArea(poly: Vec2[]): number {
  if (poly.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return sum * 0.5;
}

export function pointInPolygon(pt: Vec2, poly: Vec2[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const zi = poly[i].z;
    const xj = poly[j].x;
    const zj = poly[j].z;
    const intersect =
      zi > pt.z !== zj > pt.z &&
      pt.x < ((xj - xi) * (pt.z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function closestPointOnSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { x: number; z: number; distSq: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t =
    lenSq > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq)) : 0;
  const cx = ax + dx * t;
  const cz = az + dz * t;
  const ex = px - cx;
  const ez = pz - cz;
  return { x: cx, z: cz, distSq: ex * ex + ez * ez };
}

export function distanceToPolygonBorder(
  pt: Vec2,
  poly: Vec2[],
): { dist: number; closest: Vec2; edgeNormalInward: Vec2 } {
  let bestDistSq = Infinity;
  let bestClosest: Vec2 = { x: 0, z: 0 };
  let bestEdgeA: Vec2 = poly[0] ?? { x: 0, z: 0 };
  let bestEdgeB: Vec2 = poly[1] ?? { x: 1, z: 0 };

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const res = closestPointOnSegment(pt.x, pt.z, a.x, a.z, b.x, b.z);
    if (res.distSq < bestDistSq) {
      bestDistSq = res.distSq;
      bestClosest = { x: res.x, z: res.z };
      bestEdgeA = a;
      bestEdgeB = b;
    }
  }

  const edx = bestEdgeB.x - bestEdgeA.x;
  const edz = bestEdgeB.z - bestEdgeA.z;
  const elen = Math.max(1e-6, Math.hypot(edx, edz));
  const n1 = { x: -edz / elen, z: edx / elen };
  const n2 = { x: edz / elen, z: -edx / elen };
  const midX = (bestEdgeA.x + bestEdgeB.x) * 0.5;
  const midZ = (bestEdgeA.z + bestEdgeB.z) * 0.5;
  const test1 = { x: midX + n1.x * 0.35, z: midZ + n1.z * 0.35 };
  const inward = pointInPolygon(test1, poly) ? n1 : n2;

  return {
    dist: Math.sqrt(bestDistSq),
    closest: bestClosest,
    edgeNormalInward: inward,
  };
}

function segmentsProperlyIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const d1x = a2.x - a1.x;
  const d1z = a2.z - a1.z;
  const d2x = b2.x - b1.x;
  const d2z = b2.z - b1.z;
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < 1e-8) return false;
  const t = ((b1.x - a1.x) * d2z - (b1.z - a1.z) * d2x) / denom;
  const u = ((b1.x - a1.x) * d1z - (b1.z - a1.z) * d1x) / denom;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
}

function hasSelfIntersection(poly: Vec2[]): boolean {
  const n = poly.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = poly[i];
    const a2 = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b1 = poly[j];
      const b2 = poly[(j + 1) % n];
      if (segmentsProperlyIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

export function sanitizeBorderPolygon(
  rawVertices: Vec2[] | undefined,
  halfSize = 22,
  fallbackSeed = 1,
): Vec2[] {
  if (!Array.isArray(rawVertices) || rawVertices.length < 3) {
    return createProceduralArenaPolygon('crater', halfSize, fallbackSeed);
  }

  const cleaned: Vec2[] = [];
  for (const v of rawVertices.slice(0, 32)) {
    const x = Number(v?.x);
    const z = Number(v?.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    const clamped = {
      x: Number(Math.max(-halfSize, Math.min(halfSize, x)).toFixed(2)),
      z: Number(Math.max(-halfSize, Math.min(halfSize, z)).toFixed(2)),
    };
    const prev = cleaned[cleaned.length - 1];
    if (!prev || Math.hypot(clamped.x - prev.x, clamped.z - prev.z) >= 0.45) {
      cleaned.push(clamped);
    }
  }

  if (
    cleaned.length > 3 &&
    Math.hypot(
      cleaned[0].x - cleaned[cleaned.length - 1].x,
      cleaned[0].z - cleaned[cleaned.length - 1].z,
    ) < 0.45
  ) {
    cleaned.pop();
  }

  if (
    cleaned.length >= 3 &&
    !hasSelfIntersection(cleaned) &&
    Math.abs(computePolygonSignedArea(cleaned)) >= 280
  ) {
    return cleaned;
  }

  // Attempt radial angular sort around centroid if vertices were unordered
  if (cleaned.length >= 3) {
    const cx = cleaned.reduce((s, p) => s + p.x, 0) / cleaned.length;
    const cz = cleaned.reduce((s, p) => s + p.z, 0) / cleaned.length;
    const sorted = [...cleaned].sort(
      (a, b) => Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx),
    );
    if (!hasSelfIntersection(sorted) && Math.abs(computePolygonSignedArea(sorted)) >= 280) {
      return sorted;
    }
  }

  return createProceduralArenaPolygon('crater', halfSize, fallbackSeed);
}

export function computeSafePolygonSpawns(
  borderPolygon: Vec2[],
  halfSize = 22,
  suggestedSpawns?: Array<{ x: number; z: number }>,
): SpawnPoint[] {
  const labels = ['Alpha Pad', 'Beta Pad', 'Gamma Pad', 'Delta Pad'];

  for (const clearance of [2.6, 1.9, 1.3]) {
    const candidates: Vec2[] = [];
    if (Array.isArray(suggestedSpawns)) {
      for (const s of suggestedSpawns) {
        if (!Number.isFinite(s?.x) || !Number.isFinite(s?.z)) continue;
        const pt = { x: Number(s.x), z: Number(s.z) };
        if (
          pointInPolygon(pt, borderPolygon) &&
          distanceToPolygonBorder(pt, borderPolygon).dist >= clearance
        ) {
          candidates.push(pt);
        }
      }
    }

    const step = 2.2;
    for (let x = -halfSize + 2; x <= halfSize - 2; x += step) {
      for (let z = -halfSize + 2; z <= halfSize - 2; z += step) {
        const pt = { x: Number(x.toFixed(2)), z: Number(z.toFixed(2)) };
        if (
          pointInPolygon(pt, borderPolygon) &&
          distanceToPolygonBorder(pt, borderPolygon).dist >= clearance
        ) {
          candidates.push(pt);
        }
      }
    }

    if (candidates.length >= 4) {
      const chosen: Vec2[] = [];
      // Start with first valid suggested spawn, or the candidate farthest from center
      let first = candidates[0];
      if (!suggestedSpawns || suggestedSpawns.length === 0) {
        let bestCenterDist = -1;
        for (const c of candidates) {
          const d = Math.hypot(c.x, c.z);
          if (d > bestCenterDist) {
            bestCenterDist = d;
            first = c;
          }
        }
      }
      chosen.push(first);

      while (chosen.length < 4) {
        let bestPt = candidates[0];
        let bestMinDist = -1;
        for (const c of candidates) {
          let minD = Infinity;
          for (const picked of chosen) {
            const d = Math.hypot(c.x - picked.x, c.z - picked.z);
            if (d < minD) minD = d;
          }
          if (minD > bestMinDist) {
            bestMinDist = minD;
            bestPt = c;
          }
        }
        chosen.push(bestPt);
      }

      return chosen.map((pt, idx) => ({
        index: idx,
        x: pt.x,
        y: 0,
        z: pt.z,
        yaw: Number(Math.atan2(-pt.z, -pt.x).toFixed(3)),
        color: SPAWN_COLORS[idx % SPAWN_COLORS.length],
        label: labels[idx],
      }));
    }
  }

  return createDefaultSpawnPoints(halfSize);
}

export function createDefaultSpawnPoints(halfSize = 22): SpawnPoint[] {
  const offset = halfSize - 6.5;
  return [
    {
      index: 0,
      x: -offset,
      y: 0,
      z: -offset * 0.55,
      yaw: 0,
      color: SPAWN_COLORS[0],
      label: 'NW Pad',
    },
    {
      index: 1,
      x: offset,
      y: 0,
      z: offset * 0.55,
      yaw: Math.PI,
      color: SPAWN_COLORS[1],
      label: 'SE Pad',
    },
    {
      index: 2,
      x: offset * 0.55,
      y: 0,
      z: -offset,
      yaw: Math.PI * 0.5,
      color: SPAWN_COLORS[2],
      label: 'NE Pad',
    },
    {
      index: 3,
      x: -offset * 0.55,
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
  const borderPolygon = createProceduralArenaPolygon('octagon', halfSize, 1);
  const spawnPoints = computeSafePolygonSpawns(borderPolygon, halfSize);
  return {
    name: 'Octa-Bastion 04',
    tagline: 'Chamfered octagonal laser crucible with sightline pillars',
    halfSize,
    borderShapeName: 'Octagonal Bastion',
    borderPolygon,
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
    spawnPoints,
    obstacles: [
      { id: 'center-monolith', x: 0, z: 0, width: 3.4, depth: 3.4, height: 4.0, kind: 'monolith' },
      { id: 'north-wall', x: 0, z: -9.5, width: 5.8, depth: 1.5, height: 2.6, kind: 'barrier' },
      { id: 'south-wall', x: 0, z: 9.5, width: 5.8, depth: 1.5, height: 2.6, kind: 'barrier' },
      { id: 'east-wall', x: 9.5, z: 0, width: 1.5, depth: 5.8, height: 2.6, kind: 'barrier' },
      { id: 'west-wall', x: -9.5, z: 0, width: 1.5, depth: 5.8, height: 2.6, kind: 'barrier' },
      { id: 'nw-pillar', x: -6.8, z: -6.8, width: 2.2, depth: 2.2, height: 3.2, kind: 'pillar' },
      { id: 'ne-pillar', x: 6.8, z: -6.8, width: 2.2, depth: 2.2, height: 3.2, kind: 'pillar' },
      { id: 'sw-pillar', x: -6.8, z: 6.8, width: 2.2, depth: 2.2, height: 3.2, kind: 'pillar' },
      { id: 'se-pillar', x: 6.8, z: 6.8, width: 2.2, depth: 2.2, height: 3.2, kind: 'pillar' },
    ],
  };
}

export function sanitizeArenaObstacles(
  obstacles: ObstacleSpec[],
  spawnPoints: SpawnPoint[],
  halfSize: number,
  borderPolygon?: Vec2[],
): ObstacleSpec[] {
  const limit = halfSize - 2.2;
  const hasPoly = Boolean(borderPolygon && borderPolygon.length >= 3);

  return obstacles
    .map((obs, idx) => ({
      ...obs,
      id: obs.id || `obs-${idx}`,
      width: Math.max(1.2, Math.min(8.5, Number(obs.width) || 2.4)),
      depth: Math.max(1.2, Math.min(8.5, Number(obs.depth) || 2.4)),
      height: Math.max(1.2, Math.min(5, Number(obs.height) || 2.5)),
    }))
    .filter((obs) => {
      if (Math.abs(obs.x) > limit || Math.abs(obs.z) > limit) return false;

      if (hasPoly && borderPolygon) {
        const hw = obs.width * 0.5 + 0.8;
        const hd = obs.depth * 0.5 + 0.8;
        const testPts: Vec2[] = [
          { x: obs.x, z: obs.z },
          { x: obs.x - hw, z: obs.z - hd },
          { x: obs.x + hw, z: obs.z - hd },
          { x: obs.x - hw, z: obs.z + hd },
          { x: obs.x + hw, z: obs.z + hd },
        ];
        if (!testPts.every((p) => pointInPolygon(p, borderPolygon))) {
          return false;
        }
      }

      for (const sp of spawnPoints) {
        const minClearX = obs.width * 0.5 + 2.9;
        const minClearZ = obs.depth * 0.5 + 2.9;
        if (Math.abs(obs.x - sp.x) < minClearX && Math.abs(obs.z - sp.z) < minClearZ) {
          return false;
        }
      }
      return true;
    })
    .slice(0, 20);
}

function constrainCircleInsidePolygon(x: number, z: number, radius: number, poly: Vec2[]): Vec2 {
  let cx = x;
  let cz = z;

  if (!pointInPolygon({ x: cx, z: cz }, poly)) {
    const info = distanceToPolygonBorder({ x: cx, z: cz }, poly);
    cx = info.closest.x + info.edgeNormalInward.x * (radius + 0.06);
    cz = info.closest.z + info.edgeNormalInward.z * (radius + 0.06);
  }

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const seg = closestPointOnSegment(cx, cz, a.x, a.z, b.x, b.z);
    if (seg.distSq < radius * radius) {
      const dist = Math.sqrt(seg.distSq);
      if (dist > 1e-6) {
        const push = radius - dist;
        const candX = cx + ((cx - seg.x) / dist) * push;
        const candZ = cz + ((cz - seg.z) / dist) * push;
        if (pointInPolygon({ x: candX, z: candZ }, poly)) {
          cx = candX;
          cz = candZ;
        } else {
          const edx = b.x - a.x;
          const edz = b.z - a.z;
          const elen = Math.max(1e-6, Math.hypot(edx, edz));
          const n1 = { x: -edz / elen, z: edx / elen };
          const n2 = { x: edz / elen, z: -edx / elen };
          const test = { x: seg.x + n1.x * 0.3, z: seg.z + n1.z * 0.3 };
          const inward = pointInPolygon(test, poly) ? n1 : n2;
          cx = seg.x + inward.x * radius;
          cz = seg.z + inward.z * radius;
        }
      }
    }
  }

  return { x: cx, z: cz };
}

export function resolveTopDownCollision(
  pos: Vec2,
  radius: number,
  halfSize: number,
  obstacles: ObstacleSpec[],
  borderPolygon?: Vec2[],
): Vec2 {
  const hasPoly = Boolean(borderPolygon && borderPolygon.length >= 3);
  let x = pos.x;
  let z = pos.z;

  if (hasPoly && borderPolygon) {
    const inside = constrainCircleInsidePolygon(x, z, radius, borderPolygon);
    x = inside.x;
    z = inside.z;
  } else {
    x = Math.max(-halfSize + radius, Math.min(halfSize - radius, x));
    z = Math.max(-halfSize + radius, Math.min(halfSize - radius, z));
  }

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

  if (hasPoly && borderPolygon) {
    return constrainCircleInsidePolygon(x, z, radius, borderPolygon);
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

export function intersectSegmentWithPolygonBorder(
  px: number,
  pz: number,
  nx: number,
  nz: number,
  poly: Vec2[],
): Vec2 | null {
  const dx = nx - px;
  const dz = nz - pz;
  let bestT: number | null = null;

  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const denom = dx * ez - dz * ex;
    if (Math.abs(denom) < 1e-9) continue;

    const t = ((a.x - px) * ez - (a.z - pz) * ex) / denom;
    const u = ((a.x - px) * dz - (a.z - pz) * dx) / denom;
    if (t >= -1e-4 && t <= 1 && u >= -1e-4 && u <= 1.0001) {
      const hitT = Math.max(0, t);
      if (bestT === null || hitT < bestT) {
        bestT = hitT;
      }
    }
  }

  if (bestT !== null) {
    return {
      x: px + dx * bestT,
      z: pz + dz * bestT,
    };
  }
  return null;
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
 * Stops at custom polygon borders (or outer square fallback) and solid obstacles, and detects enemy circle hits.
 */
export function traceCurvedLaserBeam(params: {
  origin: Vec2;
  emitterRadius: number;
  baseSpinRad: number;
  point: LaserShootingPoint;
  maxRange: number;
  halfSize: number;
  borderPolygon?: Vec2[];
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
    borderPolygon,
    obstacles,
    targets,
  } = params;

  const hasPoly = Boolean(borderPolygon && borderPolygon.length >= 3);
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

    // Check custom polygon border or outer square boundary
    if (hasPoly && borderPolygon) {
      const polyHit = intersectSegmentWithPolygonBorder(px, pz, nx, nz, borderPolygon);
      if (polyHit) {
        points.push(polyHit);
        impactPoint = polyHit;
        break;
      }
      if (!pointInPolygon({ x: nx, z: nz }, borderPolygon)) {
        const edge = distanceToPolygonBorder({ x: nx, z: nz }, borderPolygon).closest;
        points.push(edge);
        impactPoint = edge;
        break;
      }
    } else if (Math.abs(nx) >= halfSize || Math.abs(nz) >= halfSize) {
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

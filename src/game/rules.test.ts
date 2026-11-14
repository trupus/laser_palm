import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDamageAndRespawn,
  computeLaserRange,
  computeSafePolygonSpawns,
  createDefaultArenaConfig,
  createProceduralArenaPolygon,
  evaluatePulseFireGate,
  LASER_ACTIVE_DURATION_SEC,
  LASER_COOLDOWN_SEC,
  pointInPolygon,
  resolveTopDownCollision,
  sanitizeBorderPolygon,
  sanitizeLaserGunConfig,
  traceCurvedLaserBeam,
} from './rules';

test('inverse laser distance law: more shooting points strictly reduce laser range', () => {
  const r1 = computeLaserRange(1);
  const r2 = computeLaserRange(2);
  const r3 = computeLaserRange(3);
  const r6 = computeLaserRange(6);
  const r12 = computeLaserRange(12);

  assert.equal(r1, 26);
  assert.ok(r1 > r2, '1 point shoots farther than 2 points');
  assert.ok(r2 > r3, '2 points shoot farther than 3 points');
  assert.ok(r3 > r6, '3 points shoot farther than 6 points');
  assert.ok(r6 > r12, '6 points shoot farther than 12 points');
});

test('sanitizeLaserGunConfig enforces 3s cooldown, sustained active duration, and inverse range', () => {
  const gun = sanitizeLaserGunConfig({
    name: 'Quad Spiral',
    color: '#22d3ee',
    shootingPoints: [
      { angleDeg: 0, curvature: 0.9 },
      { angleDeg: 90, curvature: 0.9 },
      { angleDeg: 180, curvature: 0.9 },
      { angleDeg: 270, curvature: 0.9 },
    ],
  });

  assert.equal(gun.shootingPoints.length, 4);
  assert.equal(gun.cooldownSec, LASER_COOLDOWN_SEC);
  assert.equal(gun.cooldownSec, 3.0);
  assert.ok(
    LASER_ACTIVE_DURATION_SEC >= 0.25 && LASER_ACTIVE_DURATION_SEC <= 0.6,
    'laser stays active for a sustained sweep window (~340ms)',
  );
  assert.equal(gun.range, computeLaserRange(4));
  assert.equal(gun.spinSpeed, 0.95);

  const fastInput = sanitizeLaserGunConfig({ spinSpeed: 4.0 });
  assert.equal(fastInput.spinSpeed, 1.8);
});

test('traceCurvedLaserBeam shoots straight when curvature is 0 and bends when curved', () => {
  const straight = traceCurvedLaserBeam({
    origin: { x: 0, z: 0 },
    emitterRadius: 0.8,
    baseSpinRad: 0,
    point: { angleDeg: 0, curvature: 0 },
    maxRange: 10,
    halfSize: 22,
    obstacles: [],
    targets: [],
  });

  const endStraight = straight.points[straight.points.length - 1];
  assert.ok(endStraight.x > 10.5, 'straight laser extends along +X');
  assert.ok(Math.abs(endStraight.z) < 1e-6, 'straight laser has zero Z deflection');

  const curved = traceCurvedLaserBeam({
    origin: { x: 0, z: 0 },
    emitterRadius: 0.8,
    baseSpinRad: 0,
    point: { angleDeg: 0, curvature: 1.2 },
    maxRange: 10,
    halfSize: 22,
    obstacles: [],
    targets: [],
  });

  const endCurved = curved.points[curved.points.length - 1];
  assert.ok(endCurved.z > 2.5, 'positive curvature bends laser clockwise into +Z');
});

test('traceCurvedLaserBeam stops at obstacles and detects enemy circle hits', () => {
  const blocked = traceCurvedLaserBeam({
    origin: { x: -10, z: 0 },
    emitterRadius: 0.8,
    baseSpinRad: 0,
    point: { angleDeg: 0, curvature: 0 },
    maxRange: 20,
    halfSize: 22,
    obstacles: [{ id: 'wall', x: -3, z: 0, width: 2, depth: 4, height: 3, kind: 'barrier' }],
    targets: [{ id: 'enemy-behind-wall', x: 4, z: 0, radius: 0.82 }],
  });

  assert.equal(blocked.hitTargetIds.length, 0, 'obstacle blocks laser from hitting target behind it');
  assert.ok(blocked.impactPoint && blocked.impactPoint.x <= -3.9, 'impact stops on front face of obstacle');

  const hit = traceCurvedLaserBeam({
    origin: { x: -10, z: 0 },
    emitterRadius: 0.8,
    baseSpinRad: 0,
    point: { angleDeg: 0, curvature: 0 },
    maxRange: 20,
    halfSize: 22,
    obstacles: [],
    targets: [{ id: 'enemy-open', x: -2, z: 0.3, radius: 0.82 }],
  });

  assert.deepEqual(hit.hitTargetIds, ['enemy-open']);
});

test('evaluatePulseFireGate enforces single-pulse edge trigger and 3.0s cooldown lock', () => {
  const first = evaluatePulseFireGate({ justFired: true, cooldownRemainingSec: 0 });
  assert.equal(first.allowed, true);
  assert.equal(first.nextCooldownSec, 3.0);

  const heldAfterCooldown = evaluatePulseFireGate({ justFired: false, cooldownRemainingSec: 0 });
  assert.equal(heldAfterCooldown.allowed, false);

  const duringCooldown = evaluatePulseFireGate({ justFired: true, cooldownRemainingSec: 1.8 });
  assert.equal(duringCooldown.allowed, false);
  assert.equal(duringCooldown.blockedByCooldown, true);
  assert.equal(duringCooldown.nextCooldownSec, 1.8);
});

test('resolveTopDownCollision and applyDamageAndRespawn maintain valid arena bounds', () => {
  const arena = createDefaultArenaConfig();
  const pushed = resolveTopDownCollision({ x: 50, z: -50 }, 0.82, arena.halfSize, arena.obstacles);
  assert.equal(pushed.x, arena.halfSize - 0.82);
  assert.equal(pushed.z, -arena.halfSize + 0.82);

  const victim = {
    id: 'p1',
    name: 'Pilot',
    spawnIndex: 1,
    color: '#f59e0b',
    x: 2,
    y: 0,
    z: 2,
    yaw: 0,
    pitch: 0,
    hp: 30,
    kills: 0,
    deaths: 0,
    weaponId: 'mono',
    alive: true,
  };
  const ko = applyDamageAndRespawn(victim, 45, arena.spawnPoints);
  assert.equal(ko.killed, true);
  assert.equal(ko.respawnedPlayer.hp, 100);
  assert.equal(ko.respawnedPlayer.x, arena.spawnPoints[1].x);
});

test('non-square polygon borders: sanitizeBorderPolygon, safe spawns, collision, and beam clipping', () => {
  const defaultArena = createDefaultArenaConfig();
  assert.ok(
    defaultArena.borderPolygon && defaultArena.borderPolygon.length >= 6,
    'default arena uses a non-square polygon border',
  );
  for (const sp of defaultArena.spawnPoints) {
    assert.equal(
      pointInPolygon({ x: sp.x, z: sp.z }, defaultArena.borderPolygon!),
      true,
      'default spawn point lies strictly inside octagonal border',
    );
  }

  // Custom triangle border described by AI
  const rawTriangle = [
    { x: 0, z: -20 },
    { x: 19, z: 16 },
    { x: -19, z: 16 },
  ];
  const triPoly = sanitizeBorderPolygon(rawTriangle, 22, 7);
  assert.equal(triPoly.length, 3, 'valid triangle border is preserved');

  const triSpawns = computeSafePolygonSpawns(triPoly, 22);
  assert.equal(triSpawns.length, 4);
  for (const sp of triSpawns) {
    assert.equal(
      pointInPolygon({ x: sp.x, z: sp.z }, triPoly),
      true,
      'computed spawn is inside custom triangle border',
    );
  }

  // Degenerate / self-intersecting bowtie falls back to organic crater polygon
  const bowtie = [
    { x: -18, z: -18 },
    { x: 18, z: 18 },
    { x: 18, z: -18 },
    { x: -18, z: 18 },
  ];
  const repaired = sanitizeBorderPolygon(bowtie, 22, 3);
  assert.ok(repaired.length >= 4 && pointInPolygon({ x: 0, z: 0 }, repaired));

  // Concave star polygon keeps collided player circle strictly inside
  const starPoly = createProceduralArenaPolygon('star', 22, 1);
  const constrained = resolveTopDownCollision({ x: 20, z: -20 }, 0.82, 22, [], starPoly);
  assert.equal(
    pointInPolygon(constrained, starPoly),
    true,
    'player circle pushed outside star border is constrained back inside polygon',
  );

  // Laser stops on angled diamond wall before reaching target outside border
  const diamondPoly = createProceduralArenaPolygon('diamond', 22, 1);
  const clippedLaser = traceCurvedLaserBeam({
    origin: { x: 0, z: 0 },
    emitterRadius: 0.82,
    baseSpinRad: Math.PI / 4, // 45 degrees toward angled NE diamond edge (x + z <= ~21.3)
    point: { angleDeg: 0, curvature: 0 },
    maxRange: 26,
    halfSize: 22,
    borderPolygon: diamondPoly,
    obstacles: [],
    targets: [{ id: 'outside-diamond', x: 15, z: 15, radius: 0.82 }],
  });
  assert.equal(
    clippedLaser.hitTargetIds.length,
    0,
    'laser stops on angled polygon border before hitting target outside',
  );
  assert.ok(clippedLaser.impactPoint, 'laser records impact point on angled polygon border');
});


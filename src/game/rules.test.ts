import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDamageAndRespawn,
  computeLaserRange,
  createDefaultArenaConfig,
  evaluatePulseFireGate,
  LASER_COOLDOWN_SEC,
  resolveTopDownCollision,
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

test('sanitizeLaserGunConfig enforces 3s cooldown and inverse range', () => {
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
  // Initial trigger fires pulse and starts 3.0s cooldown
  const first = evaluatePulseFireGate({ justFired: true, cooldownRemainingSec: 0 });
  assert.equal(first.allowed, true);
  assert.equal(first.nextCooldownSec, 3.0);

  // Holding the gesture (justFired = false) never re-fires even when cooldown reaches 0
  const heldAfterCooldown = evaluatePulseFireGate({ justFired: false, cooldownRemainingSec: 0 });
  assert.equal(heldAfterCooldown.allowed, false);

  // Re-making gesture while cooldown > 0 is blocked without resetting timer
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

export type GamePhase = 'title' | 'tutorial' | 'playing' | 'paused' | 'gameover';

export type WeaponId = string;

export type GestureName = 'NONE' | 'POINT_MOVE' | 'SHOOT_POSE' | 'OPEN_IDLE';

export type VoiceActionType = 'pulse' | 'reverse_spin' | 'cycle_gun';

export interface LaserShootingPoint {
  angleDeg: number; // 0..360 degrees around the spinning player circle
  curvature: number; // 0 = straight line (default), -2.5..+2.5 = curved beam arc
}

export interface LaserGunConfig {
  id: string;
  name: string;
  description: string;
  color: string;
  spinSpeed: number; // rad/s — player is always spinning
  shootingPoints: LaserShootingPoint[]; // 1..12 shooting points
  range: number; // Inverse of shootingPoints.length: more points = shorter laser distance
  damagePerBeam: number;
  cooldownSec: number; // Fixed 3.0s pulse cooldown
}

export type FingerRuleState = 'extended' | 'curled' | 'any';

export interface CustomShootGestureSpec {
  mode: 'rules' | 'recorded';
  name: string;
  description: string;
  // Used when mode === 'rules' (Default Closed Palm or AI-described hand pose)
  thumb?: FingerRuleState;
  index?: FingerRuleState;
  middle?: FingerRuleState;
  ring?: FingerRuleState;
  pinky?: FingerRuleState;
  pinchThumbIndex?: boolean;
  // Used when mode === 'recorded' (Recorded live webcam pose)
  curlRatios?: [number, number, number, number, number];
  relativeLandmarks?: Array<{ x: number; y: number }>;
  matchTolerance?: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SpawnPoint {
  index: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  color: string;
  label: string;
}

export interface ObstacleSpec {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  kind: 'pillar' | 'barrier' | 'crate' | 'monolith';
}

export interface ArenaPalette {
  skyColor: string;
  fogColor: string;
  floorPrimary: string;
  floorAccent: string;
  wallPrimary: string;
  accentGlow: string;
}

export interface ArenaMutator {
  name: string;
  description: string;
  spinMultiplier: number;
  speedMultiplier: number;
  damageMultiplier: number;
}

export interface ArenaConfig {
  name: string;
  tagline: string;
  halfSize: number;
  borderShapeName?: string;
  borderPolygon?: Vec2[];
  palette: ArenaPalette;
  mutator: ArenaMutator;
  obstacles: ObstacleSpec[];
  spawnPoints: SpawnPoint[];
  floorTextureUrl?: string;
  obstacleTextureUrl?: string;
}

export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export interface GestureThresholds {
  pointMinMagnitude: number;
  pinchThreshold: number;
  fingerExtendMargin: number;
  recordedPoseTolerance: number;
}

export interface GestureStateSnapshot {
  leftDetected: boolean;
  rightDetected: boolean;
  leftGesture: GestureName;
  rightGesture: GestureName;
  moveX: number; // -1..1 world X direction from left-hand pointing (0 if not visible)
  moveZ: number; // -1..1 world Z direction from left-hand pointing (0 if not visible)
  isShootPoseHeld: boolean;
  justFired: boolean; // Rising edge of right-hand shooting gesture
  shootMatchScore: number; // 0..1 similarity confidence
}

export interface LaserPulsePath {
  points: Vec2[];
  color: string;
  impactPoint?: Vec2;
}

export interface PlayerHudState {
  hp: number;
  maxHp: number;
  gun: LaserGunConfig;
  cooldownRemainingSec: number;
  cooldownRatio: number; // 0..1 (1 = full 3.0s cooldown active, 0 = ready)
  isMoving: boolean;
  spinDirection: 1 | -1;
  kills: number;
  deaths: number;
  timeRemainingSec: number;
  activeRightGesture: GestureName;
  activeLeftGesture: GestureName;
  shootGestureName: string;
  lastVoiceCommand: string;
  hitmarkerActive: boolean;
  damageFlashActive: boolean;
  spawnIndex: number;
}

export interface RoomPlayerState {
  id: string;
  name: string;
  spawnIndex: number;
  color: string;
  x: number;
  y: number;
  z: number;
  yaw: number; // Current spinAngle in radians
  pitch: number;
  hp: number;
  kills: number;
  deaths: number;
  weaponId: string;
  weaponName?: string;
  gun?: LaserGunConfig;
  alive: boolean;
  isBot?: boolean;
}

export interface KillFeedItem {
  id: string;
  killerName: string;
  victimName: string;
  weaponName: string;
  timestamp: number;
}

export interface MatchTelemetry {
  botsEnabled: boolean;
  arenaName: string;
  gunName: string;
  shootingPointsCount: number;
  durationSec: number;
  kills: number;
  deaths: number;
  shotsFired: number;
  shotsHit: number;
  gestureCounts: Record<string, number>;
  voiceCommandsCount: number;
  players: Array<{
    name: string;
    kills: number;
    deaths: number;
    isSelf: boolean;
    isBot?: boolean;
  }>;
}

import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import {
  GoogleGenAI,
  Modality,
  ThinkingLevel,
  Type,
  type LiveServerMessage,
} from '@google/genai';
import {
  applyDamageAndRespawn,
  computeSafePolygonSpawns,
  createDefaultArenaConfig,
  createDefaultLaserGun,
  MATCH_DURATION_SEC,
  MAX_PLAYERS_PER_ROOM,
  sanitizeArenaObstacles,
  sanitizeBorderPolygon,
  sanitizeLaserGunConfig,
} from './src/game/rules.ts';
import { DEFAULT_SHOOT_GESTURE } from './src/game/gestures.ts';
import type {
  ArenaConfig,
  CustomShootGestureSpec,
  FingerRuleState,
  LaserGunConfig,
  MatchTelemetry,
  ObstacleSpec,
  RoomPlayerState,
  Vec2,
} from './src/game/types.ts';

const isProduction = process.env.NODE_ENV === 'production';
const PORT = isProduction ? Number(process.env.PORT || 3000) : 3000;

function getAiClient(apiVersion: 'v1beta' | 'v1alpha' = 'v1beta'): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// --- In-memory TTS audio cache (max 40 phrases) ---
const ttsCache = new Map<string, string>();

// --- In-memory Nano Banana Texture Store (max 24 textures) ---
interface StoredTexture {
  buffer: Buffer;
  mimeType: string;
}
const textureStore = new Map<string, StoredTexture>();

function saveGeneratedTexture(base64Data: string, mimeType = 'image/png'): string {
  const id = `tex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (textureStore.size >= 24) {
    const oldestKey = textureStore.keys().next().value;
    if (oldestKey) textureStore.delete(oldestKey);
  }
  textureStore.set(id, {
    buffer: Buffer.from(base64Data, 'base64'),
    mimeType,
  });
  return `/api/textures/${id}`;
}

async function generateNanoBananaTexture(
  ai: GoogleGenAI,
  prompt: string,
): Promise<string | null> {
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite-image',
    contents: {
      parts: [{ text: prompt }],
    },
    config: {
      imageConfig: {
        aspectRatio: '1:1',
      },
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      const mime = part.inlineData.mimeType ?? 'image/png';
      return saveGeneratedTexture(part.inlineData.data, mime);
    }
  }
  return null;
}

// --- In-memory Multiplayer Rooms (up to 4 players, 2-minute match) ---
interface ClientMeta {
  ws: WebSocket;
  id: string;
  roomCode: string;
}

interface GameRoom {
  code: string;
  hostId: string;
  arena: ArenaConfig;
  matchState: 'lobby' | 'playing' | 'ended';
  timeRemainingSec: number;
  players: Map<string, RoomPlayerState>;
  sockets: Map<string, WebSocket>;
  timerHandle: ReturnType<typeof setInterval> | null;
}

const rooms = new Map<string, GameRoom>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charCodeAt(Math.floor(Math.random() * chars.length))
      ? chars[Math.floor(Math.random() * chars.length)]
      : 'A';
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function broadcastToRoom(room: GameRoom, payload: unknown, excludeId?: string) {
  const raw = JSON.stringify(payload);
  for (const [pid, sock] of room.sockets.entries()) {
    if (excludeId && pid === excludeId) continue;
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(raw);
    }
  }
}

function serializeRoom(room: GameRoom) {
  return {
    code: room.code,
    hostId: room.hostId,
    matchState: room.matchState,
    timeRemainingSec: room.timeRemainingSec,
    arena: room.arena,
    players: Array.from(room.players.values()),
  };
}

function startRoomTimer(room: GameRoom) {
  if (room.timerHandle) {
    clearInterval(room.timerHandle);
  }
  room.matchState = 'playing';
  room.timeRemainingSec = MATCH_DURATION_SEC;

  for (const [pid, p] of room.players.entries()) {
    const sp = room.arena.spawnPoints[p.spawnIndex % room.arena.spawnPoints.length];
    room.players.set(pid, {
      ...p,
      x: sp.x,
      y: 0,
      z: sp.z,
      yaw: sp.yaw,
      pitch: 0,
      hp: 100,
      kills: 0,
      deaths: 0,
      alive: true,
    });
  }

  broadcastToRoom(room, {
    type: 'match_started',
    room: serializeRoom(room),
  });

  room.timerHandle = setInterval(() => {
    if (room.matchState !== 'playing') {
      if (room.timerHandle) clearInterval(room.timerHandle);
      room.timerHandle = null;
      return;
    }
    room.timeRemainingSec = Math.max(0, room.timeRemainingSec - 1);
    broadcastToRoom(room, {
      type: 'timer_tick',
      timeRemainingSec: room.timeRemainingSec,
    });
    if (room.timeRemainingSec <= 0) {
      room.matchState = 'ended';
      if (room.timerHandle) clearInterval(room.timerHandle);
      room.timerHandle = null;
      broadcastToRoom(room, {
        type: 'match_ended',
        room: serializeRoom(room),
      });
    }
  }, 1000);
}

function removePlayerFromRoom(meta: ClientMeta) {
  const room = rooms.get(meta.roomCode);
  if (!room) return;
  room.players.delete(meta.id);
  room.sockets.delete(meta.id);
  if (room.players.size === 0) {
    if (room.timerHandle) clearInterval(room.timerHandle);
    rooms.delete(room.code);
    return;
  }
  if (room.hostId === meta.id) {
    const nextHost = room.players.keys().next().value;
    if (nextHost) room.hostId = nextHost;
  }
  broadcastToRoom(room, {
    type: 'player_left',
    playerId: meta.id,
    hostId: room.hostId,
    players: Array.from(room.players.values()),
  });
}

async function bootstrap() {
  const app = express();
  app.use(express.json({ limit: '6mb' }));

  // Serve self-hosted MediaPipe WASM & hand_landmarker.task model
  app.use('/mediapipe', express.static(path.resolve(process.cwd(), 'public/mediapipe')));

  // Serve Nano Banana generated arena textures over HTTP (keeps WebSocket payloads lightweight)
  app.get('/api/textures/:id', (req, res) => {
    const item = textureStore.get(req.params.id);
    if (!item) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', item.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(item.buffer);
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  // 1. AI Laser Gun Forge (gemini-4-hydrogen)
  // User describes shooting points, angular positions around the circle, and laser curvature.
  app.post('/api/gemini/weapon', async (req, res) => {
    try {
      const descriptionPrompt = String(
        req.body?.prompt || 'Three evenly spaced spiral lasers curving clockwise',
      ).slice(0, 260);
      const ai = getAiClient();

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Design a custom laser emitter configuration for a top-down spinning circle shooter game based on this player request:
"${descriptionPrompt}"

Rules of the game:
- The player is a continuously spinning circle.
- A gun has between 1 and 12 shootingPoints positioned at angles (angleDeg: 0 to 360) around the circle's perimeter.
  - 0 degrees is front, 90 is right, 180 is back, 270 is left.
  - E.g. "3 front beams in a narrow fan" -> angleDeg: 345, 0, 15. "4 cross beams" -> 0, 90, 180, 270. "6 spiral ring" -> 0, 60, 120, 180, 240, 300.
- Each shootingPoint shoots a laser with curvature (-2.4 to +2.4):
  - curvature = 0 is a straight line (use 0 unless curved/spiral/hooked/whip/arc is implied or requested).
  - Positive curvature (+0.4 to +2.0) bends clockwise; negative curvature (-0.4 to -2.0) bends counter-clockwise.
  - Alternating +/- curvatures create pincer/claw patterns!
- Note: The game engine automatically scales laser range inversely with shootingPoints count (1 point = 26m sniper, more points = shorter range).
- Choose a vivid hex laser color (#RRGGBB) and a calm, deliberate spinSpeed (0.55 to 1.35 rad/s, around 0.95 rad/s by default).`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING },
              color: { type: Type.STRING },
              spinSpeed: { type: Type.NUMBER },
              shootingPoints: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    angleDeg: { type: Type.NUMBER },
                    curvature: { type: Type.NUMBER },
                  },
                  required: ['angleDeg', 'curvature'],
                },
              },
            },
            required: ['name', 'description', 'color', 'spinSpeed', 'shootingPoints'],
          },
        },
      });

      const raw = JSON.parse(response.text || '{}');
      const gun: LaserGunConfig = sanitizeLaserGunConfig({
        id: `ai-gun-${Date.now().toString(36)}`,
        name: raw.name,
        description: raw.description,
        color: raw.color,
        spinSpeed: raw.spinSpeed,
        shootingPoints: raw.shootingPoints,
      });

      res.json({ gun });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to generate AI laser gun';
      res.status(500).json({ error: msg });
    }
  });

  // 2. AI Custom Shooting Hand Gesture Compiler (gemini-4-hydrogen)
  app.post('/api/gemini/gesture', async (req, res) => {
    try {
      const gesturePrompt = String(req.body?.prompt || 'Closed palm fist').slice(0, 200);
      const ai = getAiClient();

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Translate this player description of a single-hand webcam gesture into finger extension/curl rules for a real-time 21-landmark hand tracker:
"${gesturePrompt}"

Each finger (thumb, index, middle, ring, pinky) must be one of:
- "extended" (finger held straight out / open)
- "curled" (finger folded into the palm)
- "any" (doesn't matter for this pose)
Set pinchThumbIndex to true ONLY if the user describes pinching/touching thumb and index fingertips together (like an OK sign or pinch).
Examples:
- "closed palm" / "fist" -> thumb: "any", index: "curled", middle: "curled", ring: "curled", pinky: "curled", pinchThumbIndex: false
- "peace sign" / "victory" -> thumb: "any", index: "extended", middle: "extended", ring: "curled", pinky: "curled", pinchThumbIndex: false
- "rock horns" / "spiderman" -> thumb: "any", index: "extended", middle: "curled", ring: "curled", pinky: "extended", pinchThumbIndex: false
- "open hand" / "five fingers" -> thumb: "extended", index: "extended", middle: "extended", ring: "extended", pinky: "extended", pinchThumbIndex: false
- "thumbs up" -> thumb: "extended", index: "curled", middle: "curled", ring: "curled", pinky: "curled", pinchThumbIndex: false`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING },
              thumb: { type: Type.STRING },
              index: { type: Type.STRING },
              middle: { type: Type.STRING },
              ring: { type: Type.STRING },
              pinky: { type: Type.STRING },
              pinchThumbIndex: { type: Type.BOOLEAN },
            },
            required: [
              'name',
              'description',
              'thumb',
              'index',
              'middle',
              'ring',
              'pinky',
              'pinchThumbIndex',
            ],
          },
        },
      });

      const raw = JSON.parse(response.text || '{}');
      const toRule = (v: unknown, fb: FingerRuleState): FingerRuleState =>
        v === 'extended' || v === 'curled' || v === 'any' ? v : fb;

      const gesture: CustomShootGestureSpec = {
        mode: 'rules',
        name: String(raw.name || DEFAULT_SHOOT_GESTURE.name).slice(0, 32),
        description: String(raw.description || gesturePrompt).slice(0, 90),
        thumb: toRule(raw.thumb, 'any'),
        index: toRule(raw.index, 'curled'),
        middle: toRule(raw.middle, 'curled'),
        ring: toRule(raw.ring, 'curled'),
        pinky: toRule(raw.pinky, 'curled'),
        pinchThumbIndex: Boolean(raw.pinchThumbIndex),
      };

      res.json({ gesture });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to compile AI hand gesture';
      res.status(500).json({ error: msg });
    }
  });

  // 3. AI Top-Down Level & Non-Square Polygon Border Generator (gemini-4-hydrogen) + Nano Banana Arena Textures (gemini-3.1-flash-lite-image)
  app.post('/api/gemini/arena', async (req, res) => {
    try {
      const randomShapeArchetypes = [
        'Five-Pointed Star Bastion with central prism monolith',
        'Asymmetric Volcanic Crater with obsidian pillars',
        'Narrow-Waist Hourglass Rift with twin choke barriers',
        'Crescent Moon Canyon with curved flank cover',
        'Hexagonal Reactor Core with radial shield walls',
        'Jagged Crystal Diamond with sniper lanes',
        'Irregular Asteroid Cavern with scattered megaliths',
        'Trefoil Bio-Foundry with three asymmetrical lobes',
      ];
      const randomShape = Boolean(req.body?.randomShape);
      const pickedArchetype =
        randomShapeArchetypes[Math.floor(Math.random() * randomShapeArchetypes.length)];
      const rawTheme = String(req.body?.theme || '').trim();
      const theme = (
        randomShape
          ? rawTheme
            ? `${rawTheme} — Random Border Silhouette: ${pickedArchetype}`
            : pickedArchetype
          : rawTheme || 'Star-Shaped Obsidian Laser Crucible'
      ).slice(0, 180);

      const shouldGenTextures = req.body?.generateTextures !== false;
      const ai = getAiClient();
      const halfSize = 22;

      const layoutPromise = ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Design a complete top-down 2D multiplayer laser arena level—including a custom NON-SQUARE outer map border polygon and tactical interior obstacles—for up to 4 spinning circle players inside a 44m x 44m coordinate space (X and Z from -21 to +21).

Level Request / Theme: "${theme}"

CRITICAL GEOMETRY RULES:
1. Custom Map Border Polygon (borderPolygon):
   - Output between 6 and 18 ordered 2D vertices { x, z } in counter-clockwise order around the origin (0, 0), within [-21, +21].
   - NEVER output an axis-aligned 4-corner square! If the prompt describes a specific shape (e.g., triangle, star, hexagon, crescent, diamond, hourglass, cross, L-shape, heart, irregular crater), match that exact shape cleanly. Otherwise invent a bold, playable non-square polygon silhouette that fits the theme.
   - Ensure the polygon has a generous playable interior (spanning roughly 32m to 42m across, area >= 700 m^2) with no self-intersecting edges.
2. Suggested Spawns (suggestedSpawns):
   - Provide 4 well-separated { x, z } spawn coordinates strictly inside borderPolygon (at least 3m inward from any border edge).
3. Obstacles (obstacles):
   - Provide 7 to 13 top-down obstacles (pillars, corridor barriers, crates, and a centerpiece monolith) placed strictly inside borderPolygon and clear of the 4 spawns, creating fun sightlines for both long straight lasers and curved hook lasers.
4. Palette:
   - Use cohesive dark playable floor/wall hex colors (#RRGGBB) with one crisp accentGlow hex color (#RRGGBB).`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              tagline: { type: Type.STRING },
              borderShapeName: { type: Type.STRING },
              borderPolygon: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    x: { type: Type.NUMBER },
                    z: { type: Type.NUMBER },
                  },
                  required: ['x', 'z'],
                },
              },
              suggestedSpawns: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    x: { type: Type.NUMBER },
                    z: { type: Type.NUMBER },
                  },
                  required: ['x', 'z'],
                },
              },
              palette: {
                type: Type.OBJECT,
                properties: {
                  skyColor: { type: Type.STRING },
                  fogColor: { type: Type.STRING },
                  floorPrimary: { type: Type.STRING },
                  floorAccent: { type: Type.STRING },
                  wallPrimary: { type: Type.STRING },
                  accentGlow: { type: Type.STRING },
                },
                required: [
                  'skyColor',
                  'fogColor',
                  'floorPrimary',
                  'floorAccent',
                  'wallPrimary',
                  'accentGlow',
                ],
              },
              mutator: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  description: { type: Type.STRING },
                  spinMultiplier: { type: Type.NUMBER },
                  speedMultiplier: { type: Type.NUMBER },
                  damageMultiplier: { type: Type.NUMBER },
                },
                required: [
                  'name',
                  'description',
                  'spinMultiplier',
                  'speedMultiplier',
                  'damageMultiplier',
                ],
              },
              obstacles: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    x: { type: Type.NUMBER },
                    z: { type: Type.NUMBER },
                    width: { type: Type.NUMBER },
                    depth: { type: Type.NUMBER },
                    height: { type: Type.NUMBER },
                    kind: { type: Type.STRING },
                  },
                  required: ['id', 'x', 'z', 'width', 'depth', 'height', 'kind'],
                },
              },
            },
            required: [
              'name',
              'tagline',
              'borderShapeName',
              'borderPolygon',
              'suggestedSpawns',
              'palette',
              'mutator',
              'obstacles',
            ],
          },
        },
      });

      const floorTexPromise = shouldGenTextures
        ? generateNanoBananaTexture(
            ai,
            `Seamless orthographic top-down 2D game floor tile texture for theme "${theme}". Dark subdued playable background surface with high-craft material detail, flat overhead lighting, no perspective distortion, no characters, no text, no logos.`,
          )
        : Promise.resolve(null);

      const wallTexPromise = shouldGenTextures
        ? generateNanoBananaTexture(
            ai,
            `Seamless orthographic top-down 2D game architectural wall and obstacle block texture for theme "${theme}". Solid structural barrier material with crisp bevels and surface texture, flat overhead lighting, no perspective distortion, no text, no logos.`,
          )
        : Promise.resolve(null);

      const [layoutRes, floorRes, wallRes] = await Promise.allSettled([
        layoutPromise,
        floorTexPromise,
        wallTexPromise,
      ]);

      if (layoutRes.status === 'rejected') {
        throw layoutRes.reason;
      }

      const raw = JSON.parse(layoutRes.value.text || '{}');
      const fallback = createDefaultArenaConfig();

      const rawPoly: Vec2[] | undefined = Array.isArray(raw.borderPolygon)
        ? raw.borderPolygon.map((pt: Record<string, unknown>) => ({
            x: Number(pt.x),
            z: Number(pt.z),
          }))
        : undefined;

      const borderPolygon = sanitizeBorderPolygon(rawPoly, halfSize, Math.random() * 100);
      const spawnPoints = computeSafePolygonSpawns(
        borderPolygon,
        halfSize,
        Array.isArray(raw.suggestedSpawns) ? raw.suggestedSpawns : undefined,
      );

      const rawObs: ObstacleSpec[] = Array.isArray(raw.obstacles)
        ? raw.obstacles.map((o: Record<string, unknown>, idx: number) => ({
            id: String(o.id || `ai-obs-${idx}`),
            x: Number(o.x) || 0,
            z: Number(o.z) || 0,
            width: Number(o.width) || 2.5,
            depth: Number(o.depth) || 2.5,
            height: Number(o.height) || 2.5,
            kind:
              o.kind === 'monolith' || o.kind === 'pillar' || o.kind === 'crate'
                ? o.kind
                : 'barrier',
          }))
        : fallback.obstacles;

      const sanitized = sanitizeArenaObstacles(rawObs, spawnPoints, halfSize, borderPolygon);
      const fallbackInsidePoly = sanitizeArenaObstacles(
        fallback.obstacles,
        spawnPoints,
        halfSize,
        borderPolygon,
      );

      const hexOr = (val: unknown, fb: string) =>
        typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val) ? val : fb;

      const floorTextureUrl =
        floorRes.status === 'fulfilled' && floorRes.value ? floorRes.value : undefined;
      const obstacleTextureUrl =
        wallRes.status === 'fulfilled' && wallRes.value ? wallRes.value : undefined;

      let textureWarning: string | undefined;
      if (shouldGenTextures && (!floorTextureUrl || !obstacleTextureUrl)) {
        const reason =
          floorRes.status === 'rejected'
            ? floorRes.reason
            : wallRes.status === 'rejected'
              ? wallRes.reason
              : null;
        textureWarning =
          reason instanceof Error
            ? `AI polygon level generated; Nano Banana texture note: ${reason.message}`
            : 'AI polygon level generated; using default texture for missing slot.';
      }

      const arena: ArenaConfig = {
        name: String(raw.name || fallback.name).slice(0, 48),
        tagline: String(raw.tagline || fallback.tagline).slice(0, 110),
        halfSize,
        borderShapeName: String(raw.borderShapeName || 'Custom Polygon Border').slice(0, 40),
        borderPolygon,
        spawnPoints,
        palette: {
          skyColor: hexOr(raw.palette?.skyColor, fallback.palette.skyColor),
          fogColor: hexOr(raw.palette?.fogColor, fallback.palette.fogColor),
          floorPrimary: hexOr(raw.palette?.floorPrimary, fallback.palette.floorPrimary),
          floorAccent: hexOr(raw.palette?.floorAccent, fallback.palette.floorAccent),
          wallPrimary: hexOr(raw.palette?.wallPrimary, fallback.palette.wallPrimary),
          accentGlow: hexOr(raw.palette?.accentGlow, fallback.palette.accentGlow),
        },
        mutator: {
          name: String(raw.mutator?.name || fallback.mutator.name).slice(0, 48),
          description: String(raw.mutator?.description || fallback.mutator.description).slice(
            0,
            100,
          ),
          spinMultiplier: Math.max(
            0.65,
            Math.min(1.2, Number(raw.mutator?.spinMultiplier) || 1),
          ),
          speedMultiplier: Math.max(
            0.85,
            Math.min(1.35, Number(raw.mutator?.speedMultiplier) || 1),
          ),
          damageMultiplier: Math.max(
            0.8,
            Math.min(1.5, Number(raw.mutator?.damageMultiplier) || 1),
          ),
        },
        obstacles: sanitized.length >= 2 ? sanitized : fallbackInsidePoly,
        floorTextureUrl,
        obstacleTextureUrl,
      };

      res.json({ arena, textureWarning });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to generate arena';
      res.status(500).json({ error: msg });
    }
  });

  // 4. Gemini Tactical Announcer TTS (gemini-3.8-flash-tts)
  app.post('/api/gemini/tts', async (req, res) => {
    try {
      const phrase = String(req.body?.phrase || '').trim().slice(0, 140);
      if (!phrase) {
        res.status(400).json({ error: 'Phrase is required.' });
        return;
      }
      const cacheKey = phrase.toLowerCase();
      const cached = ttsCache.get(cacheKey);
      if (cached) {
        res.json({ audioBase64: cached, mimeType: 'audio/wav', cached: true });
        return;
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.status(500).json({ error: 'GEMINI_API_KEY is not configured in the environment.' });
        return;
      }
      const ttsAi = new GoogleGenAI({
        apiKey,
        httpOptions: {
          apiVersion: 'v1alpha',
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });
      const response = await ttsAi.models.generateContent({
        model: 'gemini-3.8-flash-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: phrase,
                speechMetadata: {
                  style: 'Energetic futuristic esports arena announcer, crisp and punchy',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Fenrir' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        res.json({ audioBase64: null, mimeType: 'audio/wav', fallbackText: phrase });
        return;
      }

      if (ttsCache.size >= 40) {
        const firstKey = ttsCache.keys().next().value;
        if (firstKey) ttsCache.delete(firstKey);
      }
      ttsCache.set(cacheKey, base64Audio);
      res.json({ audioBase64: base64Audio, mimeType: 'audio/wav', cached: false });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'TTS generation failed';
      res
        .status(200)
        .json({ audioBase64: null, fallbackText: String(req.body?.phrase || ''), error: msg });
    }
  });

  // 5. Gemini Post-Match Scouting Report (gemini-4-hydrogen)
  app.post('/api/gemini/report', async (req, res) => {
    try {
      const telemetry = req.body?.telemetry as MatchTelemetry | undefined;
      if (!telemetry) {
        res.status(400).json({ error: 'Match telemetry is required.' });
        return;
      }

      const ai = getAiClient();
      const accuracy =
        telemetry.shotsFired > 0
          ? Math.round((telemetry.shotsHit / telemetry.shotsFired) * 100)
          : 0;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Analyze this 2-minute top-down spinning laser arena match and produce a punchy tactical scouting report.
Arena: ${telemetry.arenaName}
Laser Rig: ${telemetry.gunName} (${telemetry.shootingPointsCount} shooting points)
Player stats: ${telemetry.kills} kills, ${telemetry.deaths} deaths, ${telemetry.shotsFired} laser pulses fired, ${telemetry.shotsHit} pulses hit (${accuracy}% pulse hit rate).
Gesture trigger counts: ${JSON.stringify(telemetry.gestureCounts)}.
Standings: ${JSON.stringify(telemetry.players)}.`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              summary: { type: Type.STRING },
              gestureTip: { type: Type.STRING },
            },
            required: ['title', 'summary', 'gestureTip'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      res.json({
        title: String(parsed.title || 'Tactical Laser Debrief'),
        summary: String(
          parsed.summary ||
            `Finished with ${telemetry.kills} eliminations and ${accuracy}% pulse hit rate using ${telemetry.gunName}.`,
        ),
        gestureTip: String(
          parsed.gestureTip ||
            'Time your right-hand pulse just before your spinning emitter aligns with an opponent, and hide your left hand to stabilize in place.',
        ),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to generate match report';
      res.status(500).json({ error: msg });
    }
  });

  // --- HTTP + WebSocket Servers ---
  const server = http.createServer(app);
  const mpWss = new WebSocketServer({ noServer: true });
  const liveWss = new WebSocketServer({ noServer: true });

  // Multiplayer WebRTC signaling + authoritative 4-player room sync
  mpWss.on('connection', (ws) => {
    const clientId = `p-${Math.random().toString(36).slice(2, 8)}`;
    const meta: ClientMeta = { ws, id: clientId, roomCode: '' };

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const type = String(msg.type || '');

      if (type === 'join_room' || type === 'create_room') {
        if (meta.roomCode) removePlayerFromRoom(meta);

        const requestedCode = String(msg.roomCode || '')
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .slice(0, 6);
        const code =
          type === 'create_room' && !requestedCode
            ? generateRoomCode()
            : requestedCode || generateRoomCode();

        let room = rooms.get(code);
        if (!room) {
          room = {
            code,
            hostId: clientId,
            arena: (msg.arena as ArenaConfig) || createDefaultArenaConfig(),
            matchState: 'lobby',
            timeRemainingSec: MATCH_DURATION_SEC,
            players: new Map(),
            sockets: new Map(),
            timerHandle: null,
          };
          rooms.set(code, room);
        }

        if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
          ws.send(JSON.stringify({ type: 'room_error', error: 'Room is full (max 4 players).' }));
          return;
        }

        const usedSpawns = new Set(Array.from(room.players.values()).map((p) => p.spawnIndex));
        let spawnIndex = 0;
        while (usedSpawns.has(spawnIndex) && spawnIndex < MAX_PLAYERS_PER_ROOM) {
          spawnIndex++;
        }

        const sp = room.arena.spawnPoints[spawnIndex % room.arena.spawnPoints.length];
        const playerName = String(msg.playerName || `Pilot ${spawnIndex + 1}`).slice(0, 18);
        const initialGun = msg.gun
          ? sanitizeLaserGunConfig(msg.gun as Partial<LaserGunConfig>)
          : createDefaultLaserGun();

        const player: RoomPlayerState = {
          id: clientId,
          name: playerName,
          spawnIndex,
          color: sp.color,
          x: sp.x,
          y: 0,
          z: sp.z,
          yaw: sp.yaw,
          pitch: 0,
          hp: 100,
          kills: 0,
          deaths: 0,
          weaponId: initialGun.id,
          weaponName: initialGun.name,
          gun: initialGun,
          alive: true,
        };

        meta.roomCode = code;
        room.players.set(clientId, player);
        room.sockets.set(clientId, ws);

        ws.send(
          JSON.stringify({
            type: 'room_joined',
            selfId: clientId,
            room: serializeRoom(room),
          }),
        );

        broadcastToRoom(
          room,
          {
            type: 'player_joined',
            player,
            players: Array.from(room.players.values()),
          },
          clientId,
        );
        return;
      }

      const room = rooms.get(meta.roomCode);
      if (!room) return;

      if (type === 'set_arena' && room.hostId === clientId && msg.arena) {
        room.arena = msg.arena as ArenaConfig;
        broadcastToRoom(room, { type: 'arena_updated', arena: room.arena });
        return;
      }

      if (type === 'start_match') {
        startRoomTimer(room);
        return;
      }

      if (type === 'player_state') {
        const p = room.players.get(clientId);
        if (!p) return;
        p.x = Number(msg.x) || 0;
        p.y = 0;
        p.z = Number(msg.z) || 0;
        p.yaw = Number(msg.yaw) || 0;
        if (typeof msg.weaponId === 'string') {
          p.weaponId = msg.weaponId.slice(0, 40);
        }
        if (typeof msg.weaponName === 'string') {
          p.weaponName = msg.weaponName.slice(0, 40);
        }
        if (msg.gun && typeof msg.gun === 'object') {
          p.gun = sanitizeLaserGunConfig(msg.gun as Partial<LaserGunConfig>);
        }

        broadcastToRoom(
          room,
          {
            type: 'remote_state',
            id: clientId,
            x: p.x,
            y: 0,
            z: p.z,
            yaw: p.yaw,
            pitch: 0,
            weaponId: p.weaponId,
            weaponName: p.weaponName,
            gun: p.gun,
          },
          clientId,
        );
        return;
      }

      if (type === 'fire_shot') {
        broadcastToRoom(
          room,
          {
            type: 'remote_shot',
            id: clientId,
            pulses: Array.isArray(msg.pulses) ? msg.pulses : [],
          },
          clientId,
        );
        return;
      }

      if (type === 'hit_player') {
        const targetId = String(msg.targetId || '');
        const damage = Math.max(1, Math.min(100, Number(msg.damage) || 30));
        const weaponName = String(msg.weaponName || 'Laser Pulse').slice(0, 40);
        const victim = room.players.get(targetId);
        const killer = room.players.get(clientId);
        if (!victim || !killer || targetId === clientId) return;

        const result = applyDamageAndRespawn(victim, damage, room.arena.spawnPoints);
        room.players.set(targetId, result.respawnedPlayer);

        if (result.killed) {
          killer.kills += 1;
          room.players.set(clientId, killer);
          broadcastToRoom(room, {
            type: 'player_eliminated',
            killerId: clientId,
            killerName: killer.name,
            victimId: targetId,
            victimName: victim.name,
            weaponName,
            respawnedVictim: result.respawnedPlayer,
            players: Array.from(room.players.values()),
          });
        } else {
          broadcastToRoom(room, {
            type: 'player_damaged',
            targetId,
            hp: result.respawnedPlayer.hp,
            attackerId: clientId,
          });
        }
        return;
      }

      if (type === 'rtc_signal') {
        const targetId = String(msg.targetId || '');
        const targetSock = room.sockets.get(targetId);
        if (targetSock && targetSock.readyState === WebSocket.OPEN) {
          targetSock.send(
            JSON.stringify({
              type: 'rtc_signal',
              fromId: clientId,
              signal: msg.signal,
            }),
          );
        }
      }
    });

    ws.on('close', () => {
      removePlayerFromRoom(meta);
    });
  });

  // Gemini Live API Voice Command Bridge (/ws/live using gemini-3.8-live)
  liveWss.on('connection', async (clientWs) => {
    let session: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    let sessionReady = false;
    let clientClosed = false;
    let lastActionAt = 0;

    const emitVoiceAction = (action: string) => {
      const now = Date.now();
      if (now - lastActionAt < 550) return;
      lastActionAt = now;
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            type: 'voice_action',
            action,
          }),
        );
      }
    };

    clientWs.on('message', (raw) => {
      if (!session || !sessionReady) return;
      try {
        const msg = JSON.parse(raw.toString()) as {
          audio?: string;
          video?: string;
          text?: string;
        };
        if (msg.audio) {
          session.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.video) {
          session.sendRealtimeInput({
            video: { data: msg.video, mimeType: 'image/jpeg' },
          });
        } else if (msg.text) {
          session.sendRealtimeInput({
            text: msg.text,
          });
        }
      } catch {
        // Ignore malformed frames
      }
    });

    clientWs.on('close', () => {
      clientClosed = true;
      sessionReady = false;
      try {
        session?.close();
      } catch {
        // Ignore close errors
      }
      session = null;
    });

    const connectWithApiVersion = async (apiVersion: 'v1alpha' | 'v1beta') => {
      const ai = getAiClient(apiVersion);
      return ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Fenrir' },
            },
          },
          tools: [
            {
              functionDeclarations: [
                {
                  name: 'trigger_laser_action',
                  description:
                    'Triggers an immediate top-down spinning laser action when the player speaks a voice command such as pulse, fire, shoot, reverse, flip spin, or switch.',
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      action: {
                        type: Type.STRING,
                        description: 'Must be one of: pulse, reverse_spin, cycle_gun',
                      },
                    },
                    required: ['action'],
                  },
                },
              ],
            },
          ],
          systemInstruction: `You are LASER PALM's tactical voice co-pilot in a top-down spinning laser arena.
Recognize voice commands immediately:
- If the player says "pulse", "fire", or "shoot", call trigger_laser_action({ action: "pulse" }).
- If the player says "reverse" or "flip", call trigger_laser_action({ action: "reverse_spin" }).
- If the player says "switch" or "next gun", call trigger_laser_action({ action: "cycle_gun" }).
Respond with a crisp 1-2 word confirmation.`,
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            if (clientWs.readyState !== WebSocket.OPEN) return;

            for (const part of message.serverContent?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({ type: 'audio', data: part.inlineData.data }));
              }
            }

            if (message.serverContent?.interrupted) {
              clientWs.send(JSON.stringify({ type: 'interrupted' }));
            }

            const inputText = message.serverContent?.inputTranscription?.text;
            if (inputText) {
              clientWs.send(
                JSON.stringify({
                  type: 'input_transcript',
                  text: inputText,
                }),
              );
              const lower = inputText.toLowerCase();
              if (/\b(pulse|fire|shoot)\b/.test(lower)) {
                emitVoiceAction('pulse');
              } else if (/\b(reverse|flip)\b/.test(lower)) {
                emitVoiceAction('reverse_spin');
              } else if (/\b(switch|preset|next)\b/.test(lower)) {
                emitVoiceAction('cycle_gun');
              }
            }

            if (message.serverContent?.outputTranscription?.text) {
              clientWs.send(
                JSON.stringify({
                  type: 'output_transcript',
                  text: message.serverContent.outputTranscription.text,
                }),
              );
            }

            for (const call of message.toolCall?.functionCalls ?? []) {
              if (call.name === 'trigger_laser_action') {
                const args = (call.args || {}) as Record<string, unknown>;
                const action = String(args.action || '');
                emitVoiceAction(action);

                session?.sendToolResponse({
                  functionResponses: [
                    {
                      id: call.id,
                      name: call.name,
                      response: { executed: true, action },
                    },
                  ],
                });
              }
            }
          },
          onerror: (err: unknown) => {
            if (!sessionReady || clientWs.readyState !== WebSocket.OPEN) return;
            const errObj = err as { message?: string; error?: { message?: string } };
            const detail = errObj?.message || errObj?.error?.message || 'Live session error';
            clientWs.send(JSON.stringify({ type: 'live_error', error: detail }));
          },
          onclose: () => {
            if (!sessionReady || clientWs.readyState !== WebSocket.OPEN) return;
            sessionReady = false;
            clientWs.send(JSON.stringify({ type: 'live_closed' }));
          },
        },
      });
    };

    try {
      try {
        session = await connectWithApiVersion('v1alpha');
      } catch {
        session = await connectWithApiVersion('v1beta');
      }

      if (clientClosed || clientWs.readyState !== WebSocket.OPEN) {
        session.close();
        return;
      }

      sessionReady = true;
      clientWs.send(JSON.stringify({ type: 'live_ready' }));
    } catch (error) {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            type: 'live_error',
            error: error instanceof Error ? error.message : 'Unable to start Gemini Live',
          }),
        );
        clientWs.close();
      }
    }
  });

  // Frontend serving (Vite dev middleware or static dist/)
  if (!isProduction) {
    const vite = await import('vite');
    const viteServer = await vite.createServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(viteServer.middlewares);

    server.on('upgrade', (req, socket, head) => {
      const pathname = (req.url || '').split('?')[0];
      if (pathname === '/ws/multiplayer') {
        mpWss.handleUpgrade(req, socket, head, (ws) => mpWss.emit('connection', ws, req));
      } else if (pathname === '/ws/live') {
        liveWss.handleUpgrade(req, socket, head, (ws) => liveWss.emit('connection', ws, req));
      }
    });
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });

    server.on('upgrade', (req, socket, head) => {
      const pathname = (req.url || '').split('?')[0];
      if (pathname === '/ws/multiplayer') {
        mpWss.handleUpgrade(req, socket, head, (ws) => mpWss.emit('connection', ws, req));
      } else if (pathname === '/ws/live') {
        liveWss.handleUpgrade(req, socket, head, (ws) => liveWss.emit('connection', ws, req));
      } else {
        socket.destroy();
      }
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Laser Palm Top-Down Arena server listening on http://0.0.0.0:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

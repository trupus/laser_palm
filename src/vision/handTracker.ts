import { FaceDetector, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import {
  captureGestureTemplateFromLandmarks,
  classifyHandGestures,
  createGestureEdgeTracker,
  DEFAULT_GESTURE_THRESHOLDS,
  DEFAULT_SHOOT_GESTURE,
  normalizeWebcamHands,
} from '../game/gestures';
import type {
  CustomShootGestureSpec,
  GestureStateSnapshot,
  GestureThresholds,
  HandLandmark,
} from '../game/types';

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export class OnDeviceHandTracker {
  private landmarker: HandLandmarker | null = null;
  private faceDetector: FaceDetector | null = null;
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private faceCutoutCanvas: HTMLCanvasElement | null = null;
  private hasFaceFrame = false;
  private frameCounter = 0;
  private smoothFaceBox = { cx: 0.5, cy: 0.38, size: 0.36, locked: false };
  private rafId = 0;
  private lastVideoTime = -1;
  private tracker = createGestureEdgeTracker();
  private thresholds: GestureThresholds = { ...DEFAULT_GESTURE_THRESHOLDS };
  private shootGestureSpec: CustomShootGestureSpec = { ...DEFAULT_SHOOT_GESTURE };
  private lastRightLandmarks: HandLandmark[] | null = null;
  private shootCooldownRemainingSec = 0;
  private shootCooldownRatio = 0;
  private onSnapshot: ((snap: GestureStateSnapshot) => void) | null = null;
  private active = false;
  private swapHands = false;

  public setThresholds(next: Partial<GestureThresholds>) {
    this.thresholds = { ...this.thresholds, ...next };
  }

  public setShootGestureSpec(spec: CustomShootGestureSpec) {
    this.shootGestureSpec = { ...spec };
    this.tracker.wasShootPoseHeld = false;
  }

  public getShootGestureSpec(): CustomShootGestureSpec {
    return this.shootGestureSpec;
  }

  /**
   * Updates the 3-second shooting cooldown state so the webcam hand overlay
   * draws a darker shroud directly over the player's shooting hand while cooling down.
   */
  public setShootCooldown(remainingSec: number, ratio: number) {
    this.shootCooldownRemainingSec = Math.max(0, remainingSec);
    this.shootCooldownRatio = Math.max(0, Math.min(1, ratio));
  }

  /**
   * Records the player's currently visible right-hand pose from webcam into a custom shooting gesture.
   */
  public recordCurrentRightHandPose(name = 'Recorded Hand Pose'): CustomShootGestureSpec | null {
    if (!this.lastRightLandmarks || this.lastRightLandmarks.length < 21) {
      return null;
    }
    const spec = captureGestureTemplateFromLandmarks(this.lastRightLandmarks, name);
    this.setShootGestureSpec(spec);
    return spec;
  }

  public hasRightHandVisible(): boolean {
    return Boolean(this.lastRightLandmarks && this.lastRightLandmarks.length >= 21);
  }

  public setSwapHands(swap: boolean) {
    this.swapHands = swap;
  }

  public getSwapHands(): boolean {
    return this.swapHands;
  }

  public isRunning(): boolean {
    return this.active;
  }

  public getFaceCutoutCanvas(): HTMLCanvasElement | null {
    return this.active && this.hasFaceFrame ? this.faceCutoutCanvas : null;
  }

  public async start(
    videoEl: HTMLVideoElement,
    overlayCanvas: HTMLCanvasElement | null,
    onSnapshot: (snap: GestureStateSnapshot) => void,
  ): Promise<void> {
    this.videoEl = videoEl;
    this.canvasEl = overlayCanvas;
    this.onSnapshot = onSnapshot;

    if (!this.faceCutoutCanvas && typeof document !== 'undefined') {
      this.faceCutoutCanvas = document.createElement('canvas');
      this.faceCutoutCanvas.width = 128;
      this.faceCutoutCanvas.height = 128;
    }

    const vision =
      !this.landmarker || !this.faceDetector
        ? await FilesetResolver.forVisionTasks('/mediapipe/wasm')
        : null;

    if (!this.landmarker && vision) {
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/mediapipe/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    }

    if (!this.faceDetector && vision) {
      try {
        this.faceDetector = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/mediapipe/blaze_face_short_range.tflite',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          minDetectionConfidence: 0.45,
        });
      } catch {
        try {
          this.faceDetector = await FaceDetector.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: '/mediapipe/blaze_face_short_range.tflite',
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            minDetectionConfidence: 0.45,
          });
        } catch {
          // Graceful fallback to centered portrait crop if BlazeFace unavailable
          this.faceDetector = null;
        }
      }
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });

    videoEl.srcObject = this.stream;
    await videoEl.play();
    this.active = true;
    this.hasFaceFrame = false;
    this.frameCounter = 0;
    this.smoothFaceBox = { cx: 0.5, cy: 0.38, size: 0.36, locked: false };
    this.lastVideoTime = -1;
    this.loop();
  }

  public attachOverlayCanvas(canvas: HTMLCanvasElement | null) {
    this.canvasEl = canvas;
  }

  public captureSnapshotBase64(): string | null {
    if (!this.videoEl || this.videoEl.videoWidth === 0) return null;
    const offscreen = document.createElement('canvas');
    offscreen.width = 480;
    offscreen.height = 360;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return null;
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(this.videoEl, -480, 0, 480, 360);
    ctx.restore();
    return offscreen.toDataURL('image/jpeg', 0.78);
  }

  public stop() {
    this.active = false;
    this.hasFaceFrame = false;
    this.lastRightLandmarks = null;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
  }

  private updateFaceCutout(video: HTMLVideoElement, nowMs: number) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || !this.faceCutoutCanvas) return;

    if (this.faceDetector && this.frameCounter % 2 === 0) {
      try {
        const faceRes = this.faceDetector.detectForVideo(video, nowMs);
        const detections = faceRes.detections ?? [];
        let bestBb: { originX: number; originY: number; width: number; height: number } | null = null;
        let bestArea = 0;
        for (const det of detections) {
          const bb = det.boundingBox;
          if (!bb) continue;
          const area = bb.width * bb.height;
          if (area > bestArea) {
            bestArea = area;
            bestBb = bb;
          }
        }
        if (bestBb && bestBb.width > 12 && bestBb.height > 12) {
          const rawCx = (bestBb.originX + bestBb.width * 0.5) / vw;
          const rawCy = (bestBb.originY + bestBb.height * 0.44) / vh;
          const rawSize = Math.max(
            0.2,
            Math.min(0.85, (Math.max(bestBb.width, bestBb.height) * 1.32) / Math.min(vw, vh)),
          );
          const alpha = this.smoothFaceBox.locked ? 0.26 : 1.0;
          this.smoothFaceBox = {
            cx: this.smoothFaceBox.cx + (rawCx - this.smoothFaceBox.cx) * alpha,
            cy: this.smoothFaceBox.cy + (rawCy - this.smoothFaceBox.cy) * alpha,
            size: this.smoothFaceBox.size + (rawSize - this.smoothFaceBox.size) * alpha,
            locked: true,
          };
        }
      } catch {
        // Ignore transient detector timestamp collision
      }
    }

    const side = Math.max(48, Math.min(vw, vh) * this.smoothFaceBox.size);
    const sx = Math.max(0, Math.min(vw - side, this.smoothFaceBox.cx * vw - side * 0.5));
    const sy = Math.max(0, Math.min(vh - side, this.smoothFaceBox.cy * vh - side * 0.5));

    const fctx = this.faceCutoutCanvas.getContext('2d');
    if (!fctx) return;
    const outSize = this.faceCutoutCanvas.width;
    fctx.clearRect(0, 0, outSize, outSize);
    fctx.save();
    // Mirror horizontally so moving/tilting head matches mirror view
    fctx.scale(-1, 1);
    fctx.drawImage(video, sx, sy, side, side, -outSize, 0, outSize, outSize);
    fctx.restore();
    this.hasFaceFrame = true;
  }

  private loop = () => {
    if (!this.active || !this.videoEl || !this.landmarker) return;

    const video = this.videoEl;
    if (video.readyState >= 2 && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      this.frameCounter += 1;
      const nowMs = performance.now();

      const result = this.landmarker.detectForVideo(video, nowMs);
      this.updateFaceCutout(video, nowMs + 0.05);

      const rawHands: Array<{ landmarks: HandLandmark[]; categoryName?: string }> = [];
      const handednessList = result.handedness ?? result.handednesses ?? [];
      for (let i = 0; i < result.landmarks.length; i++) {
        const lms = result.landmarks[i] as HandLandmark[];
        const categoryName = handednessList[i]?.[0]?.categoryName;
        rawHands.push({ landmarks: lms, categoryName });
      }

      const { leftLandmarks, rightLandmarks } = normalizeWebcamHands(rawHands, {
        swapHands: this.swapHands,
        mirrorX: true,
      });

      this.lastRightLandmarks = rightLandmarks;

      const snapshot = classifyHandGestures(
        {
          leftLandmarks,
          rightLandmarks,
        },
        this.tracker,
        this.thresholds,
        this.shootGestureSpec,
      );

      this.drawPreview(video, leftLandmarks, rightLandmarks, snapshot);
      this.onSnapshot?.(snapshot);
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ) {
    const r = Math.min(radius, width * 0.5, height * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  private drawPreview(
    video: HTMLVideoElement,
    left: HandLandmark[] | null,
    right: HandLandmark[] | null,
    snap: GestureStateSnapshot,
  ) {
    const canvas = this.canvasEl;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Draw mirrored webcam feed so user's physical right is on the right side of canvas
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -w, 0, w, h);
    ctx.restore();

    // Base subtle dark tint for skeleton legibility
    ctx.fillStyle = 'rgba(9, 11, 16, 0.24)';
    ctx.fillRect(0, 0, w, h);

    // Subtle circular Face Cutout guide in mirrored coordinates
    const faceMirroredX = (1 - this.smoothFaceBox.cx) * w;
    const faceY = this.smoothFaceBox.cy * h;
    const faceRadius = Math.max(18, Math.min(w, h) * this.smoothFaceBox.size * 0.42);
    ctx.save();
    ctx.beginPath();
    ctx.arc(faceMirroredX, faceY, faceRadius, 0, Math.PI * 2);
    ctx.strokeStyle = this.smoothFaceBox.locked
      ? 'rgba(56, 189, 248, 0.72)'
      : 'rgba(148, 163, 184, 0.45)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.restore();

    const drawSkeleton = (
      lm: HandLandmark[],
      color: string,
      jointAlpha = 1,
    ) => {
      ctx.save();
      ctx.globalAlpha = jointAlpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      for (const [a, b] of HAND_CONNECTIONS) {
        const p1 = lm[a];
        const p2 = lm[b];
        if (!p1 || !p2) continue;
        ctx.beginPath();
        ctx.moveTo(p1.x * w, p1.y * h);
        ctx.lineTo(p2.x * w, p2.y * h);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffffff';
      for (const p of lm) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    // --- LEFT HAND: Point Direction Movement ---
    if (left) {
      const isPointing = snap.leftGesture === 'POINT_MOVE';
      drawSkeleton(left, isPointing ? '#38bdf8' : '#94a3b8');

      // Draw clear directional arrow from index tip when pointing
      if (isPointing && left[8]) {
        const sx = left[8].x * w;
        const sy = left[8].y * h;
        const ex = sx + snap.moveX * 30;
        const ey = sy + snap.moveZ * 30;
        ctx.save();
        ctx.strokeStyle = '#38bdf8';
        ctx.fillStyle = '#38bdf8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        const ang = Math.atan2(ey - sy, ex - sx);
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - Math.cos(ang - 0.5) * 8, ey - Math.sin(ang - 0.5) * 8);
        ctx.lineTo(ex - Math.cos(ang + 0.5) * 8, ey - Math.sin(ang + 0.5) * 8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      const wrist = left[0];
      if (wrist) {
        ctx.fillStyle = isPointing ? '#38bdf8' : '#cbd5e1';
        ctx.font = '600 10px "JetBrains Mono", monospace';
        const label = isPointing ? 'L: MOVE' : 'L: SPIN ONLY';
        ctx.fillText(
          label,
          Math.max(6, Math.min(w - 92, wrist.x * w - 26)),
          Math.min(h - 6, wrist.y * h + 15),
        );
      }
    } else {
      ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillText('L: NO MOVE (SPIN)', 8, h - 8);
    }

    // --- RIGHT HAND: Shooting Gesture + Darker 3-Second Cooldown Overlay ---
    const isCoolingDown = this.shootCooldownRatio > 0.005;

    if (right) {
      const baseColor = isCoolingDown
        ? '#64748b'
        : snap.isShootPoseHeld
          ? '#f59e0b'
          : '#34d399';
      drawSkeleton(right, baseColor, isCoolingDown ? 0.48 : 1);

      if (isCoolingDown) {
        // Compute bounding box around the player's shooting hand landmarks + generous padding
        let minX = 1;
        let maxX = 0;
        let minY = 1;
        let maxY = 0;
        for (const p of right) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        const padX = 22;
        const padY = 22;
        const bx = Math.max(2, minX * w - padX);
        const by = Math.max(2, minY * h - padY);
        const bw = Math.min(w - bx - 2, (maxX - minX) * w + padX * 2);
        const bh = Math.min(h - by - 2, (maxY - minY) * h + padY * 2);

        // Darker overlay directly on top of the player's shooting hand!
        ctx.save();
        this.drawRoundedRect(ctx, bx, by, bw, bh, 16);
        ctx.fillStyle = `rgba(3, 5, 12, ${(0.56 + 0.28 * this.shootCooldownRatio).toFixed(2)})`;
        ctx.fill();
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.72)';
        ctx.lineWidth = 1.6;
        ctx.stroke();

        // Radial countdown ring + remaining seconds centered over the palm
        const cx = ((right[0].x + right[9].x) * 0.5) * w;
        const cy = ((right[0].y + right[9].y) * 0.5) * h;
        const ringR = 18;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(2, 6, 14, 0.85)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(
          cx,
          cy,
          ringR,
          -Math.PI * 0.5,
          -Math.PI * 0.5 + Math.PI * 2 * this.shootCooldownRatio,
        );
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = '#f8fafc';
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${this.shootCooldownRemainingSec.toFixed(1)}s`, cx, cy);
        ctx.restore();
      } else {
        const wrist = right[0];
        if (wrist) {
          ctx.fillStyle = snap.isShootPoseHeld ? '#fbbf24' : '#34d399';
          ctx.font = '600 10px "JetBrains Mono", monospace';
          const rLabel = snap.isShootPoseHeld ? 'R: PULSE FIRED' : 'R: READY';
          ctx.fillText(
            rLabel,
            Math.max(6, Math.min(w - 96, wrist.x * w - 26)),
            Math.min(h - 6, wrist.y * h + 15),
          );
        }
      }
    } else if (isCoolingDown) {
      // Right hand temporarily out of frame during 3s cooldown: darken right half of preview
      ctx.save();
      ctx.fillStyle = 'rgba(3, 5, 12, 0.76)';
      ctx.fillRect(w * 0.5, 0, w * 0.5, h);
      ctx.fillStyle = '#fda4af';
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`COOLDOWN ${this.shootCooldownRemainingSec.toFixed(1)}s`, w * 0.75, h * 0.5);
      ctx.restore();
    }
  }
}

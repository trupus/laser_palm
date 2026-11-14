import type { ArenaConfig, LaserGunConfig, LaserPulsePath, RoomPlayerState } from '../game/types';

export interface RemoteStatePayload {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  weaponId: string;
  weaponName?: string;
  gun?: LaserGunConfig;
}

export interface MultiplayerCallbacks {
  onRoomJoined: (data: {
    selfId: string;
    code: string;
    hostId: string;
    matchState: 'lobby' | 'playing' | 'ended';
    timeRemainingSec: number;
    arena: ArenaConfig;
    players: RoomPlayerState[];
  }) => void;
  onPlayersUpdated: (players: RoomPlayerState[], hostId?: string) => void;
  onArenaUpdated: (arena: ArenaConfig) => void;
  onMatchStarted: (data: {
    arena: ArenaConfig;
    players: RoomPlayerState[];
    timeRemainingSec: number;
  }) => void;
  onTimerTick: (timeRemainingSec: number) => void;
  onMatchEnded: (players: RoomPlayerState[]) => void;
  onRemoteState: (state: RemoteStatePayload) => void;
  onRemoteShot: (shot: {
    id: string;
    pulses: LaserPulsePath[];
  }) => void;
  onPlayerDamaged: (data: { targetId: string; hp: number; attackerId: string }) => void;
  onPlayerEliminated: (data: {
    killerId: string;
    killerName: string;
    victimId: string;
    victimName: string;
    weaponName: string;
    respawnedVictim: RoomPlayerState;
    players: RoomPlayerState[];
  }) => void;
  onError: (message: string) => void;
  onPeerCountChange?: (webrtcPeers: number) => void;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private selfId = '';
  private roomCode = '';
  private peers = new Map<string, RTCPeerConnection>();
  private channels = new Map<string, RTCDataChannel>();
  private callbacks: MultiplayerCallbacks;

  constructor(callbacks: MultiplayerCallbacks) {
    this.callbacks = callbacks;
  }

  public getSelfId(): string {
    return this.selfId;
  }

  public getRoomCode(): string {
    return this.roomCode;
  }

  private ensureSocket(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.ws);
    }
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const sock = new WebSocket(`${proto}//${location.host}/ws/multiplayer`);
      this.ws = sock;

      sock.onopen = () => resolve(sock);
      sock.onerror = () => reject(new Error('Multiplayer WebSocket connection failed.'));
      sock.onmessage = (event) => this.handleServerMessage(event.data);
      sock.onclose = () => {
        this.closeAllPeers();
      };
    });
  }

  public async createOrJoinRoom(params: {
    mode: 'create' | 'join';
    roomCode?: string;
    playerName: string;
    arena?: ArenaConfig;
    gun?: LaserGunConfig;
  }) {
    const sock = await this.ensureSocket();
    sock.send(
      JSON.stringify({
        type: params.mode === 'create' ? 'create_room' : 'join_room',
        roomCode: params.roomCode || '',
        playerName: params.playerName,
        arena: params.arena,
        gun: params.gun,
      }),
    );
  }

  public sendArenaUpdate(arena: ArenaConfig) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'set_arena', arena }));
    }
  }

  public startMatch() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'start_match' }));
    }
  }

  public sendPlayerState(state: Omit<RemoteStatePayload, 'id'>) {
    const packet = JSON.stringify({
      type: 'player_state',
      id: this.selfId,
      ...state,
    });

    let sentOverRtc = 0;
    for (const ch of this.channels.values()) {
      if (ch.readyState === 'open') {
        ch.send(packet);
        sentOverRtc++;
      }
    }

    if (sentOverRtc < this.peers.size || this.peers.size === 0) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(packet);
      }
    }
  }

  public sendShot(pulses: LaserPulsePath[]) {
    const packet = JSON.stringify({
      type: 'fire_shot',
      id: this.selfId,
      pulses,
    });
    for (const ch of this.channels.values()) {
      if (ch.readyState === 'open') {
        ch.send(packet);
      }
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(packet);
    }
  }

  public sendHitPlayer(targetId: string, damage: number, weaponName: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'hit_player',
          targetId,
          damage,
          weaponName,
        }),
      );
    }
  }

  public disconnect() {
    this.closeAllPeers();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.selfId = '';
    this.roomCode = '';
  }

  private handleServerMessage(raw: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const type = String(msg.type || '');
    if (type === 'room_error') {
      this.callbacks.onError(String(msg.error || 'Room error'));
      return;
    }

    if (type === 'room_joined') {
      const room = msg.room as {
        code: string;
        hostId: string;
        matchState: 'lobby' | 'playing' | 'ended';
        timeRemainingSec: number;
        arena: ArenaConfig;
        players: RoomPlayerState[];
      };
      this.selfId = String(msg.selfId);
      this.roomCode = room.code;
      this.callbacks.onRoomJoined({
        selfId: this.selfId,
        code: room.code,
        hostId: room.hostId,
        matchState: room.matchState,
        timeRemainingSec: room.timeRemainingSec,
        arena: room.arena,
        players: room.players,
      });

      for (const p of room.players) {
        if (p.id !== this.selfId) {
          void this.initiatePeer(p.id, true);
        }
      }
      return;
    }

    if (type === 'player_joined') {
      const player = msg.player as RoomPlayerState;
      const players = msg.players as RoomPlayerState[];
      this.callbacks.onPlayersUpdated(players);
      if (player.id !== this.selfId) {
        void this.initiatePeer(player.id, false);
      }
      return;
    }

    if (type === 'player_left') {
      const leftId = String(msg.playerId);
      this.closePeer(leftId);
      this.callbacks.onPlayersUpdated(msg.players as RoomPlayerState[], String(msg.hostId || ''));
      return;
    }

    if (type === 'arena_updated') {
      this.callbacks.onArenaUpdated(msg.arena as ArenaConfig);
      return;
    }

    if (type === 'match_started') {
      const room = msg.room as {
        arena: ArenaConfig;
        players: RoomPlayerState[];
        timeRemainingSec: number;
      };
      this.callbacks.onMatchStarted(room);
      return;
    }

    if (type === 'timer_tick') {
      this.callbacks.onTimerTick(Number(msg.timeRemainingSec) || 0);
      return;
    }

    if (type === 'match_ended') {
      const room = msg.room as { players: RoomPlayerState[] };
      this.callbacks.onMatchEnded(room.players);
      return;
    }

    if (type === 'remote_state') {
      this.callbacks.onRemoteState(msg as unknown as RemoteStatePayload);
      return;
    }

    if (type === 'remote_shot') {
      this.callbacks.onRemoteShot(
        msg as unknown as {
          id: string;
          pulses: LaserPulsePath[];
        },
      );
      return;
    }

    if (type === 'player_damaged') {
      this.callbacks.onPlayerDamaged(
        msg as unknown as { targetId: string; hp: number; attackerId: string },
      );
      return;
    }

    if (type === 'player_eliminated') {
      this.callbacks.onPlayerEliminated(
        msg as unknown as {
          killerId: string;
          killerName: string;
          victimId: string;
          victimName: string;
          weaponName: string;
          respawnedVictim: RoomPlayerState;
          players: RoomPlayerState[];
        },
      );
      return;
    }

    if (type === 'rtc_signal') {
      void this.handleRtcSignal(String(msg.fromId), msg.signal as Record<string, unknown>);
    }
  }

  private async initiatePeer(remoteId: string, isInitiator: boolean) {
    if (this.peers.has(remoteId) || typeof RTCPeerConnection === 'undefined') return;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    this.peers.set(remoteId, pc);

    const setupChannel = (ch: RTCDataChannel) => {
      this.channels.set(remoteId, ch);
      ch.onopen = () => this.updatePeerCount();
      ch.onclose = () => this.updatePeerCount();
      ch.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as Record<string, unknown>;
          if (data.type === 'player_state') {
            this.callbacks.onRemoteState(data as unknown as RemoteStatePayload);
          } else if (data.type === 'fire_shot') {
            this.callbacks.onRemoteShot(
              data as unknown as {
                id: string;
                pulses: LaserPulsePath[];
              },
            );
          }
        } catch {
          // Ignore invalid RTC packet
        }
      };
    };

    if (isInitiator) {
      const ch = pc.createDataChannel('laser-sync', { ordered: false, maxRetransmits: 0 });
      setupChannel(ch);
    } else {
      pc.ondatachannel = (ev) => setupChannel(ev.channel);
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: 'rtc_signal',
            targetId: remoteId,
            signal: { candidate: ev.candidate },
          }),
        );
      }
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: 'rtc_signal',
            targetId: remoteId,
            signal: { sdp: pc.localDescription },
          }),
        );
      }
    }
  }

  private async handleRtcSignal(fromId: string, signal: Record<string, unknown>) {
    if (!this.peers.has(fromId)) {
      await this.initiatePeer(fromId, false);
    }
    const pc = this.peers.get(fromId);
    if (!pc) return;

    if (signal.sdp) {
      const desc = signal.sdp as RTCSessionDescriptionInit;
      await pc.setRemoteDescription(new RTCSessionDescription(desc));
      if (desc.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              type: 'rtc_signal',
              targetId: fromId,
              signal: { sdp: pc.localDescription },
            }),
          );
        }
      }
    } else if (signal.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit));
      } catch {
        // Ignore stale ICE candidates
      }
    }
  }

  private updatePeerCount() {
    let open = 0;
    for (const ch of this.channels.values()) {
      if (ch.readyState === 'open') open++;
    }
    this.callbacks.onPeerCountChange?.(open);
  }

  private closePeer(id: string) {
    this.channels.get(id)?.close();
    this.channels.delete(id);
    this.peers.get(id)?.close();
    this.peers.delete(id);
    this.updatePeerCount();
  }

  private closeAllPeers() {
    for (const id of Array.from(this.peers.keys())) {
      this.closePeer(id);
    }
  }
}

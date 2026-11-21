import { io, Socket } from 'socket.io-client';
import {
  ROUTES,
  SOCKET_EVENTS,
  GENESIS_PREV_HASH,
  RegisterNodeReqSchema,
  RegisterNodeResSchema,
  HeartbeatAckSchema,
} from '@chronyx/contracts';
import type {
  Exchange,
  HeartbeatBody,
  HeartbeatAck,
  EngineConfig,
  NodeInfo,
  FaultType,
  UUID,
} from '@chronyx/contracts';
import { createSignedHeartbeat } from '@chronyx/crypto';
import {
  NodeIdentity,
  NodeKeyMaterial,
  loadOrCreateIdentity,
  saveIdentity,
} from './identity.js';
import { BrowserClockShim, ActiveFault } from './clockShim.js';
import { WakeLockManager } from './wakeLock.js';

export type AgentStatus =
  | 'idle'
  | 'registering'
  | 'connecting'
  | 'joined'
  | 'error';

export interface NodeAgentConfig {
  baseUrl?: string;
  wsUrl?: string;
  nodeName?: string;
  storageKey?: string;
  /**
   * Time ping cadence in milliseconds.
   * Default: 250ms (corresponds to 4 pings per second).
   * Can be configured to 200ms if 5 pings per second is desired.
   */
  pingIntervalMs?: number;
  heartbeatIntervalMs?: number;
  ackTimeoutMs?: number;
}

export interface NodeAgentState {
  status: AgentStatus;
  identity: NodeIdentity | null;
  nodeInfo: NodeInfo | null;
  seq: number;
  prevHash: string;
  lastPingRttMs: number | null;
  recentExchanges: Exchange[];
  lastHeartbeatAck: HeartbeatAck | null;
  activeFaults: ActiveFault[];
  wakeLockActive: boolean;
  errorMessage: string | null;
}

export interface ValidatedJoinAck {
  next_seq: number;
  prev_hash: string;
  hub_time_ms: number;
  config: EngineConfig;
}

/**
 * Strict validator for Gateway node:join acknowledgement.
 * Enforces confirmed P1 contract without guessing or inventing fields.
 */
export function validateJoinAck(data: unknown): ValidatedJoinAck | null {
  if (!data || typeof data !== 'object') return null;
  const ack = data as Record<string, unknown>;

  // next_seq: non-negative integer
  if (
    typeof ack.next_seq !== 'number' ||
    !Number.isInteger(ack.next_seq) ||
    ack.next_seq < 0
  ) {
    return null;
  }

  // prev_hash: 64 hex characters
  if (
    typeof ack.prev_hash !== 'string' ||
    ack.prev_hash.length !== 64 ||
    !/^[0-9a-fA-F]{64}$/.test(ack.prev_hash)
  ) {
    return null;
  }

  // hub_time_ms: positive finite timestamp
  if (
    typeof ack.hub_time_ms !== 'number' ||
    !Number.isFinite(ack.hub_time_ms) ||
    ack.hub_time_ms <= 0
  ) {
    return null;
  }

  // config: valid engine configuration object
  if (!ack.config || typeof ack.config !== 'object') {
    return null;
  }

  return {
    next_seq: ack.next_seq,
    prev_hash: ack.prev_hash.toLowerCase(),
    hub_time_ms: ack.hub_time_ms,
    config: ack.config as EngineConfig,
  };
}

export class NodeAgent {
  private config: Required<NodeAgentConfig>;
  private identity: NodeIdentity | null = null;
  private keyMaterial: NodeKeyMaterial | null = null;
  private nodeInfo: NodeInfo | null = null;
  private socket: Socket | null = null;
  private clockShim: BrowserClockShim;
  private wakeLock: WakeLockManager;

  private status: AgentStatus = 'idle';
  private seq = 0;
  private prevHash = GENESIS_PREV_HASH;
  private recentExchanges: Exchange[] = [];
  private lastPingRttMs: number | null = null;
  private lastHeartbeatAck: HeartbeatAck | null = null;
  private errorMessage: string | null = null;

  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private isHeartbeatInFlight = false;

  private joinAttemptId = 0;
  private heartbeatAttemptId = 0;
  private pingAttemptId = 0;

  private listeners: Set<(state: NodeAgentState) => void> = new Set();

  constructor(config?: NodeAgentConfig) {
    this.config = {
      baseUrl: config?.baseUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'),
      wsUrl: config?.wsUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'),
      nodeName: config?.nodeName || 'Judge-Node',
      storageKey: config?.storageKey || 'chronyx_browser_node_identity',
      pingIntervalMs: config?.pingIntervalMs || 250,
      heartbeatIntervalMs: config?.heartbeatIntervalMs || 1000,
      ackTimeoutMs: config?.ackTimeoutMs || 4000,
    };

    this.clockShim = new BrowserClockShim();
    this.wakeLock = new WakeLockManager();
  }

  public subscribe(listener: (state: NodeAgentState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  public getState(): NodeAgentState {
    return {
      status: this.status,
      identity: this.identity ? { ...this.identity } : null,
      nodeInfo: this.nodeInfo ? { ...this.nodeInfo } : null,
      seq: this.seq,
      prevHash: this.prevHash,
      lastPingRttMs: this.lastPingRttMs,
      recentExchanges: [...this.recentExchanges],
      lastHeartbeatAck: this.lastHeartbeatAck,
      activeFaults: this.clockShim.getActiveFaults(),
      wakeLockActive: this.wakeLock.isActive(),
      errorMessage: this.errorMessage,
    };
  }

  public getClockShim(): BrowserClockShim {
    return this.clockShim;
  }

  public getWakeLockManager(): WakeLockManager {
    return this.wakeLock;
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  private setStatus(status: AgentStatus, error: string | null = null): void {
    this.status = status;
    this.errorMessage = error;
    this.notify();
  }

  /**
   * Initializes identity and key material ahead of registration if not already created.
   * Generates fresh Ed25519 session keys and stores private key strictly in memory.
   */
  public async initIdentity(nodeName?: string): Promise<NodeIdentity> {
    if (nodeName) {
      this.config.nodeName = nodeName;
    }
    if (!this.identity || !this.keyMaterial) {
      const { identity, keyMaterial } = await loadOrCreateIdentity(
        this.config.nodeName,
        this.config.storageKey,
      );
      this.identity = identity;
      this.keyMaterial = keyMaterial;
      this.notify();
    }
    return this.identity;
  }

  /**
   * Initializes identity and registers with the Gateway REST API.
   * Private key material is held exclusively in memory.
   */
  public async register(nodeName?: string): Promise<NodeInfo> {
    if (nodeName) {
      this.config.nodeName = nodeName;
    }
    this.setStatus('registering');

    if (!this.identity || !this.keyMaterial) {
      await this.initIdentity();
    }

    const reqPayload = RegisterNodeReqSchema.parse({
      name: this.identity!.nodeName,
      kind: 'browser',
      public_key: this.identity!.publicKeyBase64,
    });

    const res = await fetch(`${this.config.baseUrl}${ROUTES.NODES_REGISTER}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqPayload),
    });

    if (!res.ok) {
      const errText = await res.text();
      const msg = `Registration failed: HTTP ${res.status} - ${errText}`;
      this.setStatus('error', msg);
      throw new Error(msg);
    }

    const data = await res.json();
    const parsed = RegisterNodeResSchema.parse(data);

    this.nodeInfo = parsed.node;
    if (this.identity) {
      this.identity.nodeId = parsed.node.id;
      // Persist only non-secret metadata
      saveIdentity(this.identity, this.config.storageKey);
    }

    this.notify();
    return parsed.node;
  }

  /**
   * Connects to Gateway over Socket.IO and initiates validated handshake.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;

    if (!this.identity || !this.identity.nodeId || !this.keyMaterial) {
      await this.register();
    }

    this.isRunning = true;
    this.setStatus('connecting');

    // Request Screen Wake Lock (non-fatal if unsupported)
    await this.wakeLock.acquire();

    this.socket = io(this.config.wsUrl, {
      auth: { node_id: this.identity!.nodeId },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      void this.performJoin();
    });

    this.socket.on('disconnect', () => {
      this.pauseLoops();
      this.setStatus('connecting', 'Disconnected from Gateway, reconnecting...');
    });

    this.socket.on('connect_error', (err) => {
      this.setStatus('error', `Connection error: ${err.message}`);
    });

    // Handle fault injection
    this.socket.on(
      SOCKET_EVENTS.FAULT_APPLY,
      (data: { fault_id: string; type: FaultType; params?: Record<string, unknown>; started_at_ms?: number }) => {
        if (data?.fault_id && data?.type) {
          const applied = this.clockShim.applyFault(data);
          if (applied) {
            this.socket?.emit(SOCKET_EVENTS.FAULT_ACK, { fault_id: data.fault_id });
            this.notify();
          }
        }
      },
    );

    this.socket.on(SOCKET_EVENTS.FAULT_CLEAR, (data: { fault_id: string }) => {
      if (data?.fault_id) {
        this.clockShim.clearFault(data.fault_id);
        this.notify();
      }
    });
  }

  /**
   * Emits node:join handshake, strictly validates Gateway acknowledgement,
   * and starts loops ONLY upon confirmed validation.
   */
  public async performJoin(): Promise<boolean> {
    if (!this.socket || !this.socket.connected) {
      this.setStatus('error', 'Cannot perform join: socket not connected');
      return false;
    }

    const joinAttempt = ++this.joinAttemptId;
    this.setStatus('connecting', 'Performing join handshake...');

    try {
      const ack = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Join handshake timed out after 5000ms'));
        }, 5000);

        this.socket!.emit(SOCKET_EVENTS.NODE_JOIN, {}, (response: unknown) => {
          clearTimeout(timer);
          resolve(response);
        });
      });

      // Stale attempt guard
      if (joinAttempt !== this.joinAttemptId) {
        return false;
      }

      const validated = validateJoinAck(ack);
      if (!validated) {
        this.setStatus('error', 'Malformed join acknowledgement from Gateway');
        this.pauseLoops();
        return false;
      }

      this.seq = validated.next_seq;
      this.prevHash = validated.prev_hash;
      this.setStatus('joined');
      this.startLoops();
      return true;
    } catch (err: unknown) {
      if (joinAttempt !== this.joinAttemptId) {
        return false;
      }
      const message = err instanceof Error ? err.message : 'Join handshake failed';
      this.setStatus('error', message);
      this.pauseLoops();
      return false;
    }
  }

  private startLoops(): void {
    this.pauseLoops();

    // Time ping loop
    this.pingTimer = setInterval(() => {
      this.sendTimePing();
    }, this.config.pingIntervalMs);

    // Initial time ping immediately
    this.sendTimePing();

    // Heartbeat loop (1 Hz)
    this.heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat();
    }, this.config.heartbeatIntervalMs);
  }

  private pauseLoops(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Executes a single two-way time ping exchange with bounded timeout.
   * Stale responses arriving after timeout or stop are discarded.
   */
  public sendTimePing(): void {
    if (!this.socket || !this.socket.connected) return;

    const pingId = ++this.pingAttemptId;
    const t1 = this.clockShim.pingSendTimestamp();
    const socketRef = this.socket;

    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
    }, 4000);

    this.socket.emit(SOCKET_EVENTS.TIME_PING, {}, (ack: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      // Verify socket has not changed, attempt is latest
      if (this.socket !== socketRef || pingId !== this.pingAttemptId) {
        return;
      }

      if (
        !ack ||
        typeof ack !== 'object' ||
        typeof (ack as { t2?: unknown }).t2 !== 'number' ||
        typeof (ack as { t3?: unknown }).t3 !== 'number'
      ) {
        return;
      }

      const parsedAck = ack as { t2: number; t3: number };
      const t4 = this.clockShim.pingReceiveTimestamp();
      const exchange: Exchange = {
        t1,
        t2: parsedAck.t2,
        t3: parsedAck.t3,
        t4,
      };

      const rtt = Math.max(0, (t4 - t1) - (parsedAck.t3 - parsedAck.t2));
      this.lastPingRttMs = rtt;

      // Retain only latest eight valid exchanges
      this.recentExchanges = [...this.recentExchanges, exchange].slice(-8);
      this.notify();
    });
  }

  /**
   * Constructs, hashes, signs and submits a heartbeat with bounded acknowledgement timeout.
   * Advances seq and prev_hash ONLY on accepted acknowledgement.
   * Preserves local chain state on rejection or timeout without automatic resynchronization.
   */
  public async sendHeartbeat(): Promise<HeartbeatAck | null> {
    if (
      !this.socket ||
      !this.socket.connected ||
      !this.identity ||
      !this.identity.nodeId ||
      !this.keyMaterial
    ) {
      return null;
    }
    if (this.isHeartbeatInFlight) {
      return null;
    }

    this.isHeartbeatInFlight = true;
    const attemptId = ++this.heartbeatAttemptId;

    try {
      const body: HeartbeatBody = {
        node_id: this.identity.nodeId as UUID,
        seq: this.seq,
        t_local_ms: this.clockShim.nodeNow(),
        prev_hash: this.prevHash,
        exchange: this.recentExchanges.slice(-4),
        osc_residual_ms: this.clockShim.getOscResidualMs(),
        health: null, // browser nodes have no GNSS or camera receiver
      };

      const signed = await createSignedHeartbeat(body, this.keyMaterial.privateKeyHex);

      const ack = await new Promise<HeartbeatAck>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve({
              ok: false,
              code: 'BAD_REQUEST', // Bounded timeout treated as unsuccessful
            });
          }
        }, this.config.ackTimeoutMs);

        this.socket!.emit(SOCKET_EVENTS.HEARTBEAT, signed, (response: unknown) => {
          if (settled) return; // Stale or post-timeout response discarded
          settled = true;
          clearTimeout(timer);
          try {
            const parsed = HeartbeatAckSchema.parse(response);
            resolve(parsed);
          } catch {
            resolve({
              ok: false,
              code: 'BAD_REQUEST',
            });
          }
        });
      });

      // Guard: if another heartbeat started, do not mutate state
      if (attemptId !== this.heartbeatAttemptId) {
        return null;
      }

      this.lastHeartbeatAck = ack;

      if (ack.ok) {
        // Advance hash chain ONLY upon confirmed accepted acknowledgement
        this.prevHash = signed.hash;
        this.seq += 1;
      } else {
        // Rejected or failed: preserve local seq and prevHash unchanged
      }

      this.notify();
      return ack;
    } finally {
      this.isHeartbeatInFlight = false;
    }
  }

  /**
   * Graceful stop and full resource cleanup.
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    this.joinAttemptId++;
    this.heartbeatAttemptId++;
    this.pingAttemptId++;
    this.pauseLoops();

    if (this.socket) {
      if (typeof this.socket.removeAllListeners === 'function') {
        this.socket.removeAllListeners();
      }
      if (typeof this.socket.disconnect === 'function') {
        this.socket.disconnect();
      }
      this.socket = null;
    }

    await this.wakeLock.release();
    this.keyMaterial = null;
    this.identity = null;
    this.nodeInfo = null;
    this.setStatus('idle');
  }
}

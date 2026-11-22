import crypto from 'crypto';
import type { NodeInfo, NodeKind, UUID } from '@chronyx/contracts';
import { GENESIS_PREV_HASH } from '@chronyx/contracts';
import { RingBuffer } from './ringBuffer.js';
import { getRepositories, isDbConfigured } from './db/index.js';
import { logger } from '../logger.js';

export interface NodeSample {
  node_id: UUID;
  seq: number;
  t_local_ms: number;
  server_rx_ms: number;
  peer_offset_ms: number | null;
  osc_residual_ms: number | null;
  health: { cn0_dbhz: number | null; agc_db: number | null } | null;
  hash: string;
}

export interface NodeIntegrityState {
  bad_signature: boolean;
  chain_break: boolean;
  heartbeat_gap: boolean;
}

export interface NodeState {
  info: NodeInfo;
  expectedSeq: number;
  lastVerifiedHash: string;
  lastSeenAtMs: number | null;
  connectedSockets: Set<string>;
  integrityFlags: {
    bad_signature: number | null;
    chain_break: number | null;
    heartbeat_gap: number | null;
  };
  latestSample: NodeSample | null;
  history: RingBuffer<NodeSample>;
}

export class NodeRegistry {
  private readonly nodesById = new Map<UUID, NodeState>();
  private readonly nodesByPublicKey = new Map<string, UUID>();
  private readonly hydrationLocks = new Map<string, Promise<NodeInfo | null>>();

  constructor() {}

  /**
   * Hydrates a node record from the database and restores chain continuity
   * from the latest persisted heartbeat.
   */
  private async hydrateNodeFromDb(dbNode: {
    id: UUID;
    name: string;
    kind: string;
    public_key: string;
    created_at: string | Date;
    last_seen_at: string | Date | null;
  }): Promise<NodeInfo> {
    const db = getRepositories();
    if (!db) {
      throw new Error('Database repositories unavailable during node hydration');
    }

    // Retrieve latest heartbeat to restore chain continuity
    const latestHbs = await db.heartbeats.listLatestByNode(dbNode.id, 1);
    let expectedSeq = 0;
    let lastVerifiedHash = GENESIS_PREV_HASH;
    let lastSeenAtMs: number | null = dbNode.last_seen_at
      ? new Date(dbNode.last_seen_at).getTime()
      : null;

    const latest = latestHbs && latestHbs.length > 0 ? latestHbs[0] : undefined;

    if (latest) {
      expectedSeq = latest.seq + 1;
      lastVerifiedHash = latest.hash;
      lastSeenAtMs = latest.t_rx_ms;
    }

    const info: NodeInfo = {
      id: dbNode.id,
      name: dbNode.name,
      kind: dbNode.kind as NodeKind,
      public_key: dbNode.public_key,
      created_at:
        typeof dbNode.created_at === 'string'
          ? dbNode.created_at
          : new Date(dbNode.created_at).toISOString(),
      last_seen_at: lastSeenAtMs ? new Date(lastSeenAtMs).toISOString() : null,
      online: false,
    };

    this.initNodeState(info, expectedSeq, lastVerifiedHash, lastSeenAtMs);
    return info;
  }

  private async fetchAndHydrateNode(id: UUID): Promise<NodeInfo | null> {
    const db = getRepositories();
    if (!db) return null;

    const dbNode = await db.nodes.findById(id);
    if (!dbNode) return null;

    return this.hydrateNodeFromDb(dbNode);
  }

  /**
   * Registers a node.
   * Idempotent by public_key: if a node with the same public_key exists,
   * returns the existing record without overwriting sequence or history.
   */
  async registerNode(params: {
    name: string;
    kind: NodeKind;
    public_key: string;
    id?: UUID;
  }): Promise<NodeInfo> {
    // 1. Check in-memory by public_key
    const existingId = this.nodesByPublicKey.get(params.public_key);
    if (existingId) {
      const state = this.nodesById.get(existingId);
      if (state) {
        return state.info;
      }
    }

    // 2. Check database if configured
    let dbNodeId = params.id;
    if (isDbConfigured()) {
      const db = getRepositories();
      if (db) {
        let dbNode;
        try {
          dbNode = await db.nodes.findByPublicKey(params.public_key);
        } catch (err) {
          logger.error({ err }, 'Failed to query database for existing node by public_key');
          throw err;
        }

        if (dbNode) {
          dbNodeId = dbNode.id;
          const existingState = this.nodesById.get(dbNode.id);
          if (existingState) {
            return existingState.info;
          }
          // Hydrate in-memory with latest heartbeat
          try {
            return await this.hydrateNodeFromDb(dbNode);
          } catch (err) {
            logger.error({ err, id: dbNode.id }, 'Failed to hydrate node heartbeat state from database on register');
            throw err;
          }
        }
      }
    }

    // 3. Create new node
    const id = dbNodeId || crypto.randomUUID();
    const nowIso = new Date().toISOString();
    const info: NodeInfo = {
      id,
      name: params.name,
      kind: params.kind,
      public_key: params.public_key,
      created_at: nowIso,
      last_seen_at: null,
      online: false,
    };

    // Attempt DB persistence if configured
    if (isDbConfigured()) {
      const db = getRepositories();
      if (db) {
        try {
          await db.nodes.create({
            id,
            name: info.name,
            kind: info.kind,
            public_key: info.public_key,
          });
        } catch (err) {
          logger.error({ err }, 'Failed to persist registered node to database');
          throw err;
        }
      }
    }

    this.initNodeState(info, 0, GENESIS_PREV_HASH, null);
    return info;
  }

  private initNodeState(
    info: NodeInfo,
    expectedSeq = 0,
    lastVerifiedHash = GENESIS_PREV_HASH,
    lastSeenAtMs: number | null = null,
  ): NodeState {
    const state: NodeState = {
      info,
      expectedSeq,
      lastVerifiedHash,
      lastSeenAtMs,
      connectedSockets: new Set<string>(),
      integrityFlags: {
        bad_signature: null,
        chain_break: null,
        heartbeat_gap: null,
      },
      latestSample: null,
      history: new RingBuffer<NodeSample>(3600),
    };

    this.nodesById.set(info.id, state);
    this.nodesByPublicKey.set(info.public_key, info.id);
    return state;
  }

  /**
   * Directly registers an authoritative node in memory (e.g. virtual nodes from simulator).
   * Preserves exact node identity, kind, and public-key mappings.
   */
  registerNodeDirect(info: NodeInfo): NodeInfo {
    this.initNodeState(info);
    return info;
  }

  /**
   * Retrieves a node by ID.
   * Checks in-memory first; if missing and DB configured, queries DB.
   */
  async getNode(id: UUID): Promise<NodeInfo | null> {
    const state = this.nodesById.get(id);
    if (state) {
      return state.info;
    }

    if (isDbConfigured()) {
      const active = this.hydrationLocks.get(id);
      if (active) {
        return active;
      }

      const promise = this.fetchAndHydrateNode(id).finally(() => {
        this.hydrationLocks.delete(id);
      });
      this.hydrationLocks.set(id, promise);
      return promise;
    }

    return null;
  }

  getNodeSync(id: UUID): NodeInfo | null {
    const state = this.nodesById.get(id);
    return state ? state.info : null;
  }

  getNodeByPublicKey(publicKey: string): NodeInfo | null {
    const id = this.nodesByPublicKey.get(publicKey);
    if (!id) return null;
    return this.getNodeSync(id);
  }

  getAllNodes(): NodeInfo[] {
    return Array.from(this.nodesById.values()).map((s) => ({ ...s.info }));
  }

  markNodeConnected(nodeId: UUID, socketId: string): void {
    const state = this.nodesById.get(nodeId);
    if (!state) return;

    state.connectedSockets.add(socketId);
    state.info.online = true;
    state.info.last_seen_at = new Date().toISOString();
  }

  markNodeDisconnected(socketId: string): void {
    for (const state of this.nodesById.values()) {
      if (state.connectedSockets.has(socketId)) {
        state.connectedSockets.delete(socketId);
        if (state.connectedSockets.size === 0) {
          state.info.online = false;
        }
      }
    }
  }

  getExpectedSeq(nodeId: UUID): number {
    const state = this.nodesById.get(nodeId);
    return state ? state.expectedSeq : 0;
  }

  getLastVerifiedHash(nodeId: UUID): string {
    const state = this.nodesById.get(nodeId);
    return state ? state.lastVerifiedHash : GENESIS_PREV_HASH;
  }

  advanceChain(nodeId: UUID, seq: number, hash: string, sample: NodeSample): void {
    const state = this.nodesById.get(nodeId);
    if (!state) return;

    state.expectedSeq = seq + 1;
    state.lastVerifiedHash = hash;
    state.latestSample = sample;
    state.lastSeenAtMs = sample.server_rx_ms;
    state.info.last_seen_at = new Date(sample.server_rx_ms).toISOString();
    state.info.online = true;
    state.history.push(sample);
  }

  setIntegrityFlag(
    nodeId: UUID,
    flag: 'bad_signature' | 'chain_break' | 'heartbeat_gap',
    timestampMs: number,
  ): void {
    const state = this.nodesById.get(nodeId);
    if (!state) return;

    state.integrityFlags[flag] = timestampMs;
  }

  getIntegrityState(nodeId: UUID, nowMs: number): NodeIntegrityState {
    const state = this.nodesById.get(nodeId);
    if (!state) {
      return { bad_signature: false, chain_break: false, heartbeat_gap: false };
    }

    const windowMs = 10000; // 10 seconds per E1c / Part F
    const isFlagActive = (ts: number | null): boolean => {
      if (ts === null) return false;
      return nowMs - ts <= windowMs && nowMs >= ts;
    };

    return {
      bad_signature: isFlagActive(state.integrityFlags.bad_signature),
      chain_break: isFlagActive(state.integrityFlags.chain_break),
      heartbeat_gap: isFlagActive(state.integrityFlags.heartbeat_gap),
    };
  }

  getLatestSample(nodeId: UUID): NodeSample | null {
    const state = this.nodesById.get(nodeId);
    return state ? state.latestSample : null;
  }

  getHistory(nodeId: UUID, windowSeconds = 300): NodeSample[] {
    const state = this.nodesById.get(nodeId);
    if (!state) return [];
    return state.history.getRecent(windowSeconds);
  }

  reset(): void {
    this.nodesById.clear();
    this.nodesByPublicKey.clear();
  }
}

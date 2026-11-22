import { create } from 'zustand';
import {
  NodeAgent,
  AgentStatus,
  NodeAgentState,
  NodeIdentity,
  ActiveFault,
} from '@chronyx/agent';
import type { Exchange, HeartbeatAck, NodeInfo } from '@chronyx/contracts';
import { getApiBaseUrl } from '../api/client.js';
import { getWsUrl } from '../api/socket.js';

export interface JoinStoreState {
  agent: NodeAgent | null;
  status: AgentStatus;
  identity: NodeIdentity | null;
  nodeInfo: NodeInfo | null;
  nodeName: string;
  seq: number;
  prevHash: string;
  lastPingRttMs: number | null;
  recentExchanges: Exchange[];
  lastHeartbeatAck: HeartbeatAck | null;
  activeFaults: ActiveFault[];
  wakeLockActive: boolean;
  errorMessage: string | null;
  clockCalibrated: boolean;
  estimatedOffsetMs: number | null;
  minRttMs: number | null;
  pendingObservationsCount: number;

  // Actions
  setNodeName: (name: string) => void;
  initIdentity: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  clearError: () => void;
  syncFromAgent: (agentState: NodeAgentState) => void;
}

let agentInstance: NodeAgent | null = null;
let unsubscribe: (() => void) | null = null;

export const useJoinStore = create<JoinStoreState>((set, get) => ({
  agent: null,
  status: 'idle',
  identity: null,
  nodeInfo: null,
  nodeName: 'Judge-Node',
  seq: 0,
  prevHash: '0000000000000000000000000000000000000000000000000000000000000000',
  lastPingRttMs: null,
  recentExchanges: [],
  lastHeartbeatAck: null,
  activeFaults: [],
  wakeLockActive: false,
  errorMessage: null,
  clockCalibrated: false,
  estimatedOffsetMs: null,
  minRttMs: null,
  pendingObservationsCount: 0,

  setNodeName: (name: string) => {
    set({ nodeName: name });
    if (agentInstance && name.trim()) {
      agentInstance.setNodeName(name);
    }
  },

  syncFromAgent: (agentState: NodeAgentState) => {
    set({
      status: agentState.status,
      identity: agentState.identity,
      nodeInfo: agentState.nodeInfo,
      seq: agentState.seq,
      prevHash: agentState.prevHash,
      lastPingRttMs: agentState.lastPingRttMs,
      recentExchanges: agentState.recentExchanges,
      lastHeartbeatAck: agentState.lastHeartbeatAck,
      activeFaults: agentState.activeFaults,
      wakeLockActive: agentState.wakeLockActive,
      errorMessage: agentState.errorMessage,
      clockCalibrated: agentState.clockCalibrated,
      estimatedOffsetMs: agentState.estimatedOffsetMs,
      minRttMs: agentState.minRttMs,
      pendingObservationsCount: agentState.pendingObservationsCount,
    });
  },

  initIdentity: async () => {
    const { nodeName, syncFromAgent } = get();

    if (!agentInstance) {
      const baseUrl = getApiBaseUrl();
      const wsUrl = getWsUrl();

      agentInstance = new NodeAgent({
        baseUrl,
        wsUrl,
        nodeName,
      });

      unsubscribe = agentInstance.subscribe((state) => {
        syncFromAgent(state);
      });
      set({ agent: agentInstance });
    }

    try {
      const ident = await agentInstance.initIdentity();
      set({ identity: ident, agent: agentInstance });
    } catch {
      // Non-fatal if pre-initialization fails; connect will retry
    }
  },

  connect: async () => {
    const { nodeName, syncFromAgent } = get();
    const effectiveName = nodeName.trim() || 'Judge-Node';

    if (!agentInstance) {
      const baseUrl = getApiBaseUrl();
      const wsUrl = getWsUrl();

      agentInstance = new NodeAgent({
        baseUrl,
        wsUrl,
        nodeName: effectiveName,
      });

      unsubscribe = agentInstance.subscribe((state) => {
        syncFromAgent(state);
      });
      set({ agent: agentInstance });
    } else {
      agentInstance.setNodeName(effectiveName);
    }

    try {
      await agentInstance.start();
    } catch (err: unknown) {
      if (agentInstance) {
        await agentInstance.stop();
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        agentInstance = null;
      }
      const message = err instanceof Error ? err.message : 'Failed to start NodeAgent';
      set({
        agent: null,
        status: 'error',
        errorMessage: message,
      });
    }
  },

  disconnect: async () => {
    if (agentInstance) {
      await agentInstance.stop();
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      agentInstance = null;
      set({ agent: null, status: 'idle' });
    }
  },

  clearError: () => {
    set({ errorMessage: null, status: 'idle' });
  },
}));

export function resetJoinStore(): void {
  if (agentInstance) {
    void agentInstance.stop({ force: true, discardReason: 'store reset' });
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    agentInstance = null;
  }
  useJoinStore.setState({
    agent: null,
    status: 'idle',
    identity: null,
    nodeInfo: null,
    nodeName: 'Judge-Node',
    seq: 0,
    prevHash: '0000000000000000000000000000000000000000000000000000000000000000',
    lastPingRttMs: null,
    recentExchanges: [],
    lastHeartbeatAck: null,
    activeFaults: [],
    wakeLockActive: false,
    errorMessage: null,
    clockCalibrated: false,
    estimatedOffsetMs: null,
    minRttMs: null,
    pendingObservationsCount: 0,
  });
}

// MOCK-DATA (remove before main)
// Person 2 owns the real engine implementation (P2-T2)
import type {
  IEngine,
  EngineConfig,
  EngineTickInput,
  EngineTickOutput,
  Assessment,
  NodeTickInput,
} from '@chronyx/contracts';
import { DEFAULT_ENGINE_CONFIG } from '@chronyx/contracts';

export class StubEngine implements IEngine {
  private config: EngineConfig = { ...DEFAULT_ENGINE_CONFIG };

  public tick(input: EngineTickInput): EngineTickOutput {
    const assessments: Assessment[] = input.nodes.map((n: NodeTickInput) => ({
      node_id: n.node_id,
      t_ms: input.now_ms,
      state: 'trusted' as const,
      error_est_ms: n.peer_offset_ms ?? 0,
      sigma_ms: this.config.min_sigma_ms,
      z: 0.1,
      cusum: 0.05,
      confidence: 1.0,
      streams: [{ stream: 'peer', residual_ms: n.peer_offset_ms ?? 0, z: 0.1, flagged: false }],
      reasons: [],
      suspected_cause: 'none' as const,
      quarantined_since_ms: null,
    }));

    const onlineCount = input.nodes.filter((n: NodeTickInput) => n.online).length;

    return {
      now_ms: input.now_ms,
      assessments,
      transitions: [],
      network: {
        score: 100,
        n: input.nodes.length,
        trusted: onlineCount,
        suspect: 0,
        quarantined: 0,
        recovering: 0,
        fault_tolerance_f: Math.max(0, Math.floor((input.nodes.length - 1) / 3)),
        anchor_ok: input.anchor.ok,
      },
      consensus_ms: 0,
    };
  }

  public reset(): void {
    // Stub reset
  }

  public setConfig(c: Partial<EngineConfig>): void {
    this.config = { ...this.config, ...c };
  }

  public getConfig(): EngineConfig {
    return { ...this.config };
  }
}

export const createEngine = (): IEngine => new StubEngine();

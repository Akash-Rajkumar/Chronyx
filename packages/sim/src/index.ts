// Person 2 owns the real simulator implementation (P2-T1)
import type { ISim, NodeInfo, SimNodeOutput, Fault, UUID } from '@chronyx/contracts';
import { GENESIS_PREV_HASH } from '@chronyx/contracts';

export class StubSim implements ISim {
  private virtualNodes: NodeInfo[] = [];
  private activeFaults: Map<UUID, Fault> = new Map();

  public addVirtualNode(name: string): NodeInfo {
    const node: NodeInfo = {
      id: `00000000-0000-0000-0000-00000000000${this.virtualNodes.length + 1}` as UUID,
      name,
      kind: 'virtual',
      public_key: 'MCowBQYDK2VwAyEAA000000000000000000000000000000000000000000=',
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      online: true,
    };
    this.virtualNodes.push(node);
    return node;
  }

  public step(now_ms: number): SimNodeOutput[] {
    return this.virtualNodes.map((node, idx) => ({
      node,
      heartbeat: {
        node_id: node.id,
        seq: 0,
        t_local_ms: now_ms,
        prev_hash: GENESIS_PREV_HASH,
        exchange: [{ t1: now_ms, t2: now_ms + 1, t3: now_ms + 2, t4: now_ms + 3 }],
        osc_residual_ms: 0.01,
        health: { cn0_dbhz: 45.0, agc_db: 20.0 },
        hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        sig: 'dGVzdF9zaWduYXR1cmU=',
      },
      gnss_resid_ms: 0.02 + idx * 0.01,
      camera_resid_ms: 0.05,
    }));
  }

  public applyFault(f: Fault): void {
    this.activeFaults.set(f.id, f);
  }

  public stopFault(id: UUID): void {
    this.activeFaults.delete(id);
  }

  public faultOffsetMs(_node_id: UUID, _now_ms: number): number {
    return 0;
  }
}

export const createSim = (): ISim => new StubSim();


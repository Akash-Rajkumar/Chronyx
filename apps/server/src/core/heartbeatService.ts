import type { Heartbeat, HeartbeatAck, HeartbeatBody } from '@chronyx/contracts';
import { computeHeartbeatHash, verifyHash } from '@chronyx/crypto';
import { NodeRegistry, NodeSample } from './nodeRegistry.js';
import { getRepositories, isDbConfigured } from './db/index.js';
import type { Json } from './db/schema.js';
import { logger } from '../logger.js';

export class HeartbeatService {
  constructor(private readonly registry: NodeRegistry) {}

  /**
   * Authoritative heartbeat verification and ingestion pipeline (Part E1c).
   * Follows strict verification order:
   * 1. Node known
   * 2. Recompute hash, must equal hash
   * 3. Ed25519 signature valid
   * 4. seq == expected_seq
   * 5. prev_hash == last_hash
   */
  async verifyAndIngest(heartbeat: Heartbeat, serverRxMs = Date.now()): Promise<HeartbeatAck> {
    if (!heartbeat || typeof heartbeat !== 'object') {
      return { ok: false, code: 'BAD_REQUEST' };
    }

    const { hash, sig, ...body } = heartbeat;

    // 1. Node known
    const node = await this.registry.getNode(body.node_id);
    if (!node) {
      return { ok: false, code: 'UNKNOWN_NODE' };
    }

    // 2 & 3. Recompute hash from canonical HeartbeatBody
    const computedHash = computeHeartbeatHash(body as HeartbeatBody);
    if (computedHash !== hash) {
      this.registry.setIntegrityFlag(node.id, 'bad_signature', serverRxMs);
      return { ok: false, code: 'BAD_SIGNATURE' };
    }

    // 4. Ed25519 signature verification
    const isSigValid = await verifyHash(hash, sig, node.public_key);
    if (!isSigValid) {
      this.registry.setIntegrityFlag(node.id, 'bad_signature', serverRxMs);
      return { ok: false, code: 'BAD_SIGNATURE' };
    }

    // 5. Sequence continuity (seq == expected_seq)
    const expectedSeq = this.registry.getExpectedSeq(node.id);
    const expectedPrevHash = this.registry.getLastVerifiedHash(node.id);

    if (body.seq !== expectedSeq) {
      this.registry.setIntegrityFlag(node.id, 'chain_break', serverRxMs);
      return {
        ok: false,
        code: 'CHAIN_BREAK',
        expected_seq: expectedSeq,
        expected_prev_hash: expectedPrevHash,
      };
    }

    // 6. Previous hash continuity (prev_hash == expected_prev_hash)
    if (body.prev_hash !== expectedPrevHash) {
      this.registry.setIntegrityFlag(node.id, 'chain_break', serverRxMs);
      return {
        ok: false,
        code: 'CHAIN_BREAK',
        expected_seq: expectedSeq,
        expected_prev_hash: expectedPrevHash,
      };
    }

    // --- Verification PASSED ---

    // Compute peer_offset_ms from two-way exchanges (Part E1c)
    // rtt = (t4 - t1) - (t3 - t2)
    // offset_node_minus_hub = ((t1 - t2) + (t4 - t3)) / 2
    // Discard exchanges with rtt > 200 ms; pick minimum rtt
    let peerOffsetMs: number | null = null;
    let minRtt = Infinity;

    if (Array.isArray(body.exchange)) {
      for (const ex of body.exchange) {
        if (
          typeof ex.t1 === 'number' &&
          typeof ex.t2 === 'number' &&
          typeof ex.t3 === 'number' &&
          typeof ex.t4 === 'number'
        ) {
          const rtt = (ex.t4 - ex.t1) - (ex.t3 - ex.t2);
          if (rtt >= 0 && rtt <= 200) {
            if (rtt < minRtt) {
              minRtt = rtt;
              peerOffsetMs = ((ex.t1 - ex.t2) + (ex.t4 - ex.t3)) / 2;
            }
          }
        }
      }
    }

    const sample: NodeSample = {
      node_id: node.id,
      seq: body.seq,
      t_local_ms: body.t_local_ms,
      server_rx_ms: serverRxMs,
      peer_offset_ms: peerOffsetMs,
      osc_residual_ms: body.osc_residual_ms,
      health: body.health,
      hash,
    };

    // Advance verified chain in node registry
    this.registry.advanceChain(node.id, body.seq, hash, sample);

    // Asynchronous database persistence (when configured)
    if (isDbConfigured()) {
      this.persistHeartbeatAsync(heartbeat, serverRxMs).catch((err) => {
        logger.warn({ err, nodeId: node.id, seq: body.seq }, 'Async database persistence failed');
      });
    }

    return {
      ok: true,
      server_rx_ms: serverRxMs,
    };
  }

  private async persistHeartbeatAsync(heartbeat: Heartbeat, serverRxMs: number): Promise<void> {
    const db = getRepositories();
    if (!db) return;

    const bodyJson: Json = {
      exchange: heartbeat.exchange as unknown as Json,
      osc_residual_ms: heartbeat.osc_residual_ms,
      health: heartbeat.health as unknown as Json,
    };

    await db.heartbeats.create({
      node_id: heartbeat.node_id,
      seq: heartbeat.seq,
      t_local_ms: heartbeat.t_local_ms,
      t_rx_ms: serverRxMs,
      prev_hash: heartbeat.prev_hash,
      hash: heartbeat.hash,
      sig: heartbeat.sig,
      body: bodyJson,
      flags: [],
    });

    await db.nodes.updateLastSeen(heartbeat.node_id, new Date(serverRxMs).toISOString());
  }
}

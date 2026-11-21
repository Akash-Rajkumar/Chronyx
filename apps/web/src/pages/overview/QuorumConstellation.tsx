import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Assessment, NetworkHealth, NodeInfo, TrustState } from '@chronyx/contracts';

export interface QuorumConstellationProps {
  nodes: NodeInfo[];
  assessments: Record<string, Assessment>;
  network: NetworkHealth | null;
  isLiveStream: boolean;
}

const STATE_STROKE: Record<TrustState, { color: string; symbol: string; dash?: string }> = {
  trusted: { color: '#3DDC97', symbol: '●' },
  suspect: { color: '#F5A524', symbol: '▲', dash: '5 3' },
  quarantined: { color: '#FF5C5C', symbol: '■', dash: '3 4' },
  recovering: { color: '#6EA8FF', symbol: '◐', dash: '6 3' },
};

const CX = 310;
const CY = 158;
const RX = 192;
const RY = 102;

/**
 * Live Star-Topology Timing Quorum Constellation.
 * Visualizes real nodes sorted deterministically by name around the verification hub.
 */
export const QuorumConstellation: React.FC<QuorumConstellationProps> = ({
  nodes,
  assessments,
  network,
  isLiveStream,
}) => {
  const navigate = useNavigate();

  const sortedNodes = useMemo(
    () => [...nodes].sort((a, b) => a.name.localeCompare(b.name)),
    [nodes],
  );

  const count = sortedNodes.length;
  const anchorOk = network?.anchor_ok ?? false;

  return (
    <div className="mc-well rounded-[10px] p-3">
      <svg
        viewBox="0 0 620 316"
        className="w-full h-72 select-none"
        role="img"
        aria-label="Star-topology timing quorum constellation"
      >
        {/* Polar Observatory Range Rings */}
        <ellipse
          cx={CX}
          cy={CY}
          rx={RX * 0.56}
          ry={RY * 0.56}
          fill="none"
          stroke="rgba(203, 213, 225, 0.08)"
          strokeWidth="1"
        />
        <ellipse
          cx={CX}
          cy={CY}
          rx={RX}
          ry={RY}
          fill="none"
          stroke="rgba(203, 213, 225, 0.12)"
          strokeWidth="1"
          strokeDasharray="3 5"
        />
        <line
          x1={CX - RX - 24}
          y1={CY}
          x2={CX + RX + 24}
          y2={CY}
          stroke="rgba(203, 213, 225, 0.06)"
          strokeWidth="1"
        />
        <line
          x1={CX}
          y1={CY - RY - 24}
          x2={CX}
          y2={CY + RY + 24}
          stroke="rgba(203, 213, 225, 0.06)"
          strokeWidth="1"
        />

        {/* Vector Links (Hub -> Each Observatory Node) */}
        {sortedNodes.map((node, idx) => {
          const theta = -Math.PI / 2 + (idx * 2 * Math.PI) / Math.max(1, count);
          const nx = CX + RX * Math.cos(theta);
          const ny = CY + RY * Math.sin(theta);
          const assessment = assessments[node.id];
          const style = assessment
            ? STATE_STROKE[assessment.state]
            : { color: '#64748B', symbol: '○', dash: '2 4' };

          return (
            <line
              key={`link-${node.id}`}
              x1={CX}
              y1={CY}
              x2={nx}
              y2={ny}
              stroke={style.color}
              strokeWidth={assessment?.state === 'quarantined' ? 1.8 : 1.35}
              strokeDasharray={style.dash}
              opacity={node.online ? 0.72 : 0.32}
            />
          );
        })}

        {/* Central Verification Hub */}
        <g transform={`translate(${CX}, ${CY})`}>
          <circle
            r="28"
            fill="rgba(8, 15, 32, 0.92)"
            stroke="rgba(61, 214, 245, 0.55)"
            strokeWidth="1.5"
          />
          <circle
            r="22"
            fill="none"
            stroke="rgba(61, 214, 245, 0.2)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
          <circle
            cx="0"
            cy="-12"
            r="2.8"
            fill={anchorOk ? '#3DDC97' : '#F5A524'}
            className={isLiveStream && anchorOk ? 'mc-live-dot' : undefined}
          />
          <text
            y="2"
            textAnchor="middle"
            fill="#E8EEFF"
            fontSize="10"
            fontWeight="600"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            HUB
          </text>
          <text
            y="14"
            textAnchor="middle"
            fill="#9FB0D6"
            fontSize="8.5"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {network ? `f=${network.fault_tolerance_f}` : 'f=--'}
          </text>
        </g>

        {/* Orbiting Observatory Nodes */}
        {sortedNodes.map((node, idx) => {
          const theta = -Math.PI / 2 + (idx * 2 * Math.PI) / Math.max(1, count);
          const nx = CX + RX * Math.cos(theta);
          const ny = CY + RY * Math.sin(theta);
          const assessment = assessments[node.id];
          const style = assessment
            ? STATE_STROKE[assessment.state]
            : { color: '#64748B', symbol: '○' };

          const offsetLabel = assessment
            ? `${assessment.error_est_ms >= 0 ? '+' : ''}${assessment.error_est_ms.toFixed(1)} ms`
            : '--';

          const labelAbove = Math.sin(theta) < -0.25;
          const nameY = labelAbove ? -22 : 26;
          const offsetY = labelAbove ? -33 : 37;

          return (
            <g
              key={node.id}
              transform={`translate(${nx.toFixed(1)}, ${ny.toFixed(1)})`}
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${node.name} (${assessment?.state ?? 'unassessed'})`}
              onClick={() => navigate(`/nodes/${node.id}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/nodes/${node.id}`);
                }
              }}
              className="cursor-pointer focus:outline-none"
            >
              <circle
                r="14"
                fill="rgba(7, 13, 28, 0.94)"
                stroke={style.color}
                strokeWidth="1.6"
                strokeDasharray={node.online ? undefined : '3 2'}
              />
              <text
                y="3.5"
                textAnchor="middle"
                fill={style.color}
                fontSize="10"
                fontWeight="700"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {style.symbol}
              </text>

              <text
                y={nameY}
                textAnchor="middle"
                fill="#E8EEFF"
                fontSize="10.5"
                fontWeight="600"
              >
                {node.name}
              </text>
              <text
                y={offsetY}
                textAnchor="middle"
                fill={assessment?.state === 'quarantined' ? '#FDA4AF' : '#9FB0D6'}
                fontSize="9.5"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {offsetLabel}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

// TEST-FIXTURE
import { describe, it, expect } from 'vitest';
import {
  NodeInfoSchema,
  HeartbeatSchema,
  HeartbeatAckSchema,
  AssessmentSchema,
  TransitionSchema,
  NetworkHealthSchema,
  AnchorInfoSchema,
  FaultSchema,
  IncidentSummarySchema,
  IncidentSchema,
  ObservationSchema,
  PassportSchema,
  BaselineStateSchema,
  SnapshotSchema,
  HistoryPointSchema,
  LiveMetricsSchema,
  BenchmarkRunSchema,
  ScienceReplayResSchema,
  JoinInfoSchema,
  mockNodeInfo,
  mockHeartbeat,
  mockHeartbeatAck,
  mockAssessment,
  mockTransition,
  mockNetworkHealth,
  mockAnchorInfo,
  mockFault,
  mockIncidentSummary,
  mockIncident,
  mockObservation,
  mockPassport,
  mockBaselineState,
  mockSnapshot,
  mockHistoryPoint,
  mockLiveMetrics,
  mockBenchmarkRun,
  mockScienceReplayRes,
  mockJoinInfo,
} from '../index.js';

describe('packages/contracts fixture validation', () => {
  it('validates mockNodeInfo against NodeInfoSchema', () => {
    expect(() => NodeInfoSchema.parse(mockNodeInfo)).not.toThrow();
  });

  it('validates mockHeartbeat against HeartbeatSchema', () => {
    expect(() => HeartbeatSchema.parse(mockHeartbeat)).not.toThrow();
  });

  it('validates mockHeartbeatAck against HeartbeatAckSchema', () => {
    expect(() => HeartbeatAckSchema.parse(mockHeartbeatAck)).not.toThrow();
  });

  it('validates mockAssessment against AssessmentSchema', () => {
    expect(() => AssessmentSchema.parse(mockAssessment)).not.toThrow();
  });

  it('validates mockTransition against TransitionSchema', () => {
    expect(() => TransitionSchema.parse(mockTransition)).not.toThrow();
  });

  it('validates mockNetworkHealth against NetworkHealthSchema', () => {
    expect(() => NetworkHealthSchema.parse(mockNetworkHealth)).not.toThrow();
  });

  it('validates mockAnchorInfo against AnchorInfoSchema', () => {
    expect(() => AnchorInfoSchema.parse(mockAnchorInfo)).not.toThrow();
  });

  it('validates mockFault against FaultSchema', () => {
    expect(() => FaultSchema.parse(mockFault)).not.toThrow();
  });

  it('validates mockIncident against IncidentSchema', () => {
    expect(() => IncidentSummarySchema.parse(mockIncidentSummary)).not.toThrow();
    expect(() => IncidentSchema.parse(mockIncident)).not.toThrow();
  });

  it('validates mockObservation against ObservationSchema', () => {
    expect(() => ObservationSchema.parse(mockObservation)).not.toThrow();
  });

  it('validates mockPassport against PassportSchema', () => {
    expect(() => PassportSchema.parse(mockPassport)).not.toThrow();
  });

  it('validates mockBaselineState against BaselineStateSchema', () => {
    expect(() => BaselineStateSchema.parse(mockBaselineState)).not.toThrow();
  });

  it('validates mockSnapshot against SnapshotSchema', () => {
    expect(() => SnapshotSchema.parse(mockSnapshot)).not.toThrow();
  });

  it('validates mockHistoryPoint against HistoryPointSchema', () => {
    expect(() => HistoryPointSchema.parse(mockHistoryPoint)).not.toThrow();
  });

  it('validates mockLiveMetrics against LiveMetricsSchema', () => {
    expect(() => LiveMetricsSchema.parse(mockLiveMetrics)).not.toThrow();
  });

  it('validates mockBenchmarkRun against BenchmarkRunSchema', () => {
    expect(() => BenchmarkRunSchema.parse(mockBenchmarkRun)).not.toThrow();
  });

  it('validates mockScienceReplayRes against ScienceReplayResSchema', () => {
    expect(() => ScienceReplayResSchema.parse(mockScienceReplayRes)).not.toThrow();
  });

  it('validates mockJoinInfo against JoinInfoSchema', () => {
    expect(() => JoinInfoSchema.parse(mockJoinInfo)).not.toThrow();
  });
});


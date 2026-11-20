import type { EngineConfig } from './types.js';

export const GENESIS_PREV_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  tolerance_ms: 10,
  z_suspect: 3.5,
  z_quarantine: 5,
  suspect_min_ticks: 2,
  quarantine_min_ticks: 3,
  cusum_k_sigma: 0.5,
  cusum_h_sigma: 11.4,
  recover_band_sigma: 2,
  recover_ticks: 30,
  trusted_after_ticks: 60,
  min_sigma_ms: 0.25,
  mad_window_s: 300,
  osc_window_s: 60,
  heartbeat_timeout_s: 5,
  gate: {
    trusted: 1,
    suspect: 0.5,
    recovering: 0.7,
    quarantined: 0,
  },
  seed: 42,
};

export const DEMO_PRESETS = {
  jump_offset_ms: 10,
  slow_drag_rate_ms_per_min: 0.5,
  gnss_spoof: {
    rate_ms_per_min: 0.5,
    accel_ms_per_min2: 0.1,
  },
  judge_attack: {
    type: 'clock_ramp' as const,
    rate_ms_per_min: 6,
  },
  pmu_style: {
    type: 'clock_ramp' as const,
    rate_ms_per_min: 0.2,
    accel_ms_per_min2: 0.05,
  },
};

export const SCIENCE_DEFAULTS = {
  body: {
    a: 250,
    b: 150,
  },
  shadow_speed_kms: 20,
  sigma_t_ms: 0.2,
  stations_y: [-110, -60, -15, 35, 85, 125],
};


import { describe, it, expect } from 'vitest';
import { COLORS, TRUST_STATES, SPACING, RADIUS, TRANSITIONS } from '../ui/tokens.js';

describe('Design Tokens (Part G1)', () => {
  it('has exact background and card colors', () => {
    expect(COLORS.background).toBe('#0B1220');
    expect(COLORS.card).toBe('#121A2E');
    expect(COLORS.border).toBe('#1F2B4A');
    expect(COLORS.text).toBe('#E8EEFF');
    expect(COLORS.muted).toBe('#9FB0D6');
    expect(COLORS.accent).toBe('#3DD6F5');
  });

  it('has exact trust states with required symbols and colors', () => {
    expect(TRUST_STATES.trusted).toEqual(
      expect.objectContaining({
        label: 'Trusted',
        symbol: '●',
        color: '#3DDC97',
      }),
    );

    expect(TRUST_STATES.suspect).toEqual(
      expect.objectContaining({
        label: 'Suspect',
        symbol: '▲',
        color: '#F5A524',
      }),
    );

    expect(TRUST_STATES.quarantined).toEqual(
      expect.objectContaining({
        label: 'Quarantined',
        symbol: '■',
        color: '#FF5C5C',
      }),
    );

    expect(TRUST_STATES.recovering).toEqual(
      expect.objectContaining({
        label: 'Recovering',
        symbol: '◐',
        color: '#6EA8FF',
      }),
    );
  });

  it('has 12px radius and exact spacing tokens', () => {
    expect(RADIUS).toBe('12px');
    expect(SPACING.xs).toBe('4px');
    expect(SPACING.sm).toBe('8px');
    expect(SPACING.md).toBe('16px');
    expect(SPACING.lg).toBe('24px');
  });

  it('has transitions in 150-250ms range', () => {
    expect(TRANSITIONS.fast).toContain('150ms');
    expect(TRANSITIONS.slow).toContain('250ms');
  });
});

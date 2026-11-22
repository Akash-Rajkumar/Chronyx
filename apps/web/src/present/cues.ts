export interface DemoCue {
  id: number;
  windowLabel: string;
  title: string;
  route: string;
  routeLabel: string;
  script: string;
  actionHint?: string;
}

/**
 * 90-second live demo cue sequence (Part H1).
 * Contains only allowed pitch framing; live metrics are always read off the screen.
 */
export const DEMO_CUES: ReadonlyArray<DemoCue> = [
  {
    id: 1,
    windowLabel: '0:00 – 0:10',
    title: 'Hook (Overview)',
    route: '/',
    routeLabel: 'Overview',
    script:
      'Observatory nodes, all in agreement, all green. But who checks that a clock is telling the truth?',
  },
  {
    id: 2,
    windowLabel: '0:10 – 0:20',
    title: 'The Problem',
    route: '/',
    routeLabel: 'Overview',
    script:
      'At 20 km/s, 1 millisecond of timing error moves a measurement by 20 metres. Sync tools follow whatever time they are given.',
  },
  {
    id: 3,
    windowLabel: '0:20 – 0:35',
    title: 'Same Attack, Two Systems',
    route: '/compare',
    routeLabel: 'Before vs After',
    script: 'Same data. Left is a naive follower. Right is Chronyx.',
    actionHint: 'Press 2 (Slow drag)',
  },
  {
    id: 4,
    windowLabel: '0:35 – 0:55',
    title: 'Live Detection & Quarantine',
    route: '/compare',
    routeLabel: 'Before vs After',
    script:
      'Left error climbs with No alarm raised. Right turns amber, then red, holds data, and drops confidence. Read the live Time to detect number off the screen.',
  },
  {
    id: 5,
    windowLabel: '0:55 – 1:10',
    title: 'Why It Matters (Science Impact)',
    route: '/science',
    routeLabel: 'Science Impact',
    script:
      'Read the live Fault trusted vs Fault quarantined size-error numbers off the screen. Same asteroid, same stations, one bad clock.',
  },
  {
    id: 6,
    windowLabel: '1:10 – 1:25',
    title: 'Judge Joins Live',
    route: '/',
    routeLabel: 'Overview',
    script:
      'A judge scans the QR code and joins as a real node. Trigger Judge attack: their phone shows Demo attack in progress, and Chronyx quarantines it.',
    actionHint: 'Press Q (QR modal)',
  },
  {
    id: 7,
    windowLabel: '1:25 – 1:35',
    title: 'Proof & Close (Scoreboard)',
    route: '/scoreboard',
    routeLabel: 'Scoreboard',
    script:
      'Show measured session numbers and the How this is measured note. Close: "Don\'t trust a timestamp. Verify it."',
  },
];

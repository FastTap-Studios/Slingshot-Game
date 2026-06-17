import { Level } from './types';

const LEVEL_DATA: Partial<Level>[] = [
  { id: 1, targetScore: 5000, colors: ['red', 'blue', 'green'], difficulty: 1, rowSpawnInterval: 10000, initialRows: 3, allowBomb: false, allowFire: false, isTutorial: true, tutorialSteps: ['Pull back on the slingshot to aim.', 'Release to shoot your bubble.', 'Match 3 or more bubbles of the same color to pop them.', 'Reach the target score to complete your training!'] },
  { id: 2, targetScore: 15000, colors: ['red', 'blue', 'green', 'yellow'], difficulty: 2, rowSpawnInterval: 10000, initialRows: 3, allowBomb: false, allowFire: false },
  { id: 3, targetScore: 25000, colors: ['red', 'blue', 'green', 'yellow'], difficulty: 3, rowSpawnInterval: 10000, initialRows: 4, timeLimit: 40, allowBomb: false, allowFire: false },
  { id: 4, targetScore: 30000, colors: ['red', 'blue', 'green', 'yellow', 'purple'], difficulty: 4, rowSpawnInterval: 10000, initialRows: 4, targetCombo: 2, allowBomb: false, allowFire: false },
  { id: 5, targetScore: 35000, colors: ['red', 'blue', 'green', 'yellow', 'purple'], difficulty: 5, rowSpawnInterval: 10000, initialRows: 4, targetCombo: 5, allowBomb: true, allowFire: false },
  { id: 6, targetScore: 40000, colors: ['red', 'blue', 'green', 'yellow', 'purple'], difficulty: 6, rowSpawnInterval: 7000, initialRows: 5, timeLimit: 60, allowBomb: true, allowFire: false },
  { id: 7, targetScore: 50000, colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'], difficulty: 6, rowSpawnInterval: 9000, initialRows: 6, targetCombo: 5, allowBomb: true, allowFire: false },
  { id: 8, targetScore: 50000, colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'], difficulty: 7, rowSpawnInterval: 7500, initialRows: 6, timeLimit: 60, allowBomb: true, allowFire: false },
  { id: 9, targetScore: 70000, colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'], difficulty: 8, rowSpawnInterval: 8000, initialRows: 6, targetCombo: 10, allowBomb: true, allowFire: false },
  { id: 10, targetScore: 60000, colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'], difficulty: 8, rowSpawnInterval: 6000, initialRows: 6, timeLimit: 150, allowBomb: true, allowFire: false },
  { id: 11, targetScore: 80000, colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'], difficulty: 9, rowSpawnInterval: 8000, initialRows: 6, targetCombo: 15, allowBomb: true, allowFire: true },
  { id: 12, targetScore: 100000, colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'], difficulty: 10, rowSpawnInterval: 8000, initialRows: 6, targetCombo: 20, allowBomb: true, allowFire: true },
  { id: 13, targetScore: 80000, colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'], difficulty: 10, rowSpawnInterval: 9000, initialRows: 6, timeLimit: 200, allowBomb: true, allowFire: true },
  { id: 14, targetScore: 180000, colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'], difficulty: 11, rowSpawnInterval: 7000, initialRows: 6, targetCombo: 25, allowBomb: true, allowFire: true },
  { id: 15, targetScore: 90000, colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'], difficulty: 12, rowSpawnInterval: 7000, initialRows: 6, timeLimit: 200, allowBomb: true, allowFire: true },
  { id: 16, targetScore: 200000, colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'], difficulty: 13, rowSpawnInterval: 9000, initialRows: 7, targetCombo: 25, allowBomb: true, allowFire: true },
  { id: 17, targetScore: 250000, colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'], difficulty: 14, rowSpawnInterval: 9000, initialRows: 7, targetCombo: 25, allowBomb: true, allowFire: true },
  { id: 18, targetScore: 300000, colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'], difficulty: 15, rowSpawnInterval: 8000, initialRows: 7, targetCombo: 30, allowBomb: true, allowFire: true },
  { id: 19, targetScore: 400000, colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'], difficulty: 16, rowSpawnInterval: 9000, initialRows: 7, targetCombo: 35, allowBomb: true, allowFire: true },
  { id: 20, targetScore: 500000, colors: ['red', 'blue', 'green', 'yellow', 'purple', 'orange'], difficulty: 17, rowSpawnInterval: 9000, initialRows: 7, targetCombo: 50, allowBomb: true, allowFire: true },
];

const NAMES: Record<number, string> = {
  1: 'Stellar Start', 2: 'Nebula Knot', 3: 'Comet Crush', 4: 'Quasar Quest', 5: 'Black Hole Blitz',
  6: 'Timed Trial: Alpha', 7: 'Supernova Surge', 8: 'Asteroid Alley', 9: 'Void Voyager', 10: 'Timed Trial: Beta',
  11: 'Pulsar Pulse', 12: 'Galactic Guardian', 13: 'Timed Trial: Gamma', 14: 'Infinity Edge', 15: 'Gemini Core',
  16: 'Wormhole Warp', 17: 'Dark Matter Drift', 18: 'Event Horizon', 19: 'Singularity', 20: 'Cosmic Master',
};

const DESCRIPTIONS: Record<number, string> = {
  1: 'Welcome Pilot! Clear the basic bubbles to begin your journey.',
  2: 'The nebula is thick here. New colors detected!',
  3: 'A dense cluster of cosmic bubbles. Use your skills!',
  4: 'Full spectrum of bubbles detected! Stay sharp.',
  5: 'Intense gravity! Bubbles are falling faster.',
  6: 'Quickly! Reach the target before time runs out.',
  7: 'The star is exploding! High pressure environment.',
  8: 'Navigate through the asteroid field. Bubbles are everywhere!',
  9: 'Deep space. Only the best can survive here.',
  10: 'Clear the sector before the clock hits zero!',
  11: "The pulsar's rhythm is affecting the bubbles!",
  12: 'The ultimate challenge. Can you become the Guardian?',
  13: '120 seconds. The core is unstable!',
  14: 'At the edge of the universe. Reality is thinning.',
  15: 'The heart of the Gemini system. Pure cosmic energy.',
  16: 'Space-time is warping. Bubbles are appearing everywhere!',
  17: 'Invisible forces are pulling the bubbles down.',
  18: 'Nothing escapes the event horizon. Not even bubbles.',
  19: 'The point of no return. Infinite density.',
  20: 'The final frontier. Become the Cosmic Master.',
};

export const LEVELS: Level[] = LEVEL_DATA.map((data) => ({
  ...data,
  name: NAMES[data.id!] ?? `Level ${data.id}`,
  description: DESCRIPTIONS[data.id!] ?? '',
  unlocked: data.id === 1,
  completed: false,
  stars: 0,
})) as Level[];

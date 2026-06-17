/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export interface Point {
  x: number;
  y: number;
}

export interface Vector {
  vx: number;
  vy: number;
}

export type BubbleColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange' | 'rainbow' | 'bomb' | 'fire';
export type BubbleType = 'normal' | 'bomb' | 'rainbow' | 'fire';

export interface Bubble {
  id: string;
  row: number;
  col: number;
  x: number;
  y: number;
  color: BubbleColor;
  type?: BubbleType; // used by GameBoard (PvP)
  active: boolean; // if false, popped
  isFloating?: boolean; // For animation
  isFalling?: boolean; // falling animation after pop
  isBurning?: boolean; // fire ball: will pop after delay
  vx?: number;
  vy?: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

export interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  color: string;
}

/** Serializable snapshot for syncing opponent board in Online PvP */
export interface BoardSnapshot {
  width: number;
  height: number;
  bubbles: Array<{ id: string; x: number; y: number; color: BubbleColor; type?: BubbleType; active: boolean }>;
  ballPos: Point;
  angle: number;
  score: number;
  /** Color of the ball in the slingshot (for opponent view) */
  ballColor?: BubbleColor;
  isFlying?: boolean;
  ballVel?: Point;
  flyingBallColor?: BubbleColor;
  flyingBallIsFire?: boolean;
}

export interface StrategicHint {
  message: string;
  rationale?: string;
  targetRow?: number;
  targetCol?: number;
  recommendedColor?: BubbleColor;
}

export interface DebugInfo {
  latency: number;
  screenshotBase64?: string;
  promptContext: string;
  rawResponse: string;
  parsedResponse?: any;
  error?: string;
  timestamp: string;
}

export interface AiResponse {
  hint: StrategicHint;
  debug: DebugInfo;
}

export interface Level {
  id: number;
  name: string;
  targetScore: number;
  colors: BubbleColor[];
  difficulty: number;
  description: string;
  unlocked: boolean;
  completed: boolean;
  stars: number;
  timeLimit?: number;
  rowSpawnInterval: number;
  initialRows: number;
  targetCombo?: number;
  allowBomb?: boolean;
  allowFire?: boolean;
  isTutorial?: boolean;
  tutorialSteps?: string[];
}

// MediaPipe Type Definitions (Augmenting window)
declare global {
  interface Window {
    Hands: any;
    Camera: any;
    drawConnectors: any;
    drawLandmarks: any;
    HAND_CONNECTIONS: any;
  }
}
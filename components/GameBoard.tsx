import React, { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Point, Bubble, Particle, BubbleColor, Shockwave, Level, BoardSnapshot } from '../types';
import { Loader2, Trophy, AlertTriangle, Zap, Target, Star, ChevronRight, Info, MousePointer2 } from 'lucide-react';

const GRAVITY = 0.0;
const FRICTION = 0.998;

const GRID_COLS = 14; // +1 column each side vs 12 (room for one more ball left & right)
const GRID_ROWS = 8;

const MAX_DRAG_DIST = 180;
const MIN_FORCE_MULT = 0.15;
const MAX_FORCE_MULT = 0.45;

const DEFAULT_ANGLE = Math.PI / 2;
const MIN_ANGLE = (10 * Math.PI) / 180;
const MAX_ANGLE = (170 * Math.PI) / 180;
const TOUCH_ANGLE_SENSITIVITY = 0.008;

const NEW_ROW_INTERVAL_MS = 15 * 1000; // Local PvP/online: 15 s per new row
const DESKTOP_WALL_REF_WIDTH = 528;
const WALL_MARKER_WIDTH_REF = 6;
/** Single Player-layout (GeminiSlingshot): scale från bredd 528, samma som Single Player-banan */
const SINGLE_REF_WIDTH = 528;
const SINGLE_REF_BUBBLE_RADIUS = 22;
const SINGLE_REF_SLINGSHOT_OFFSET = 180;
const SINGLE_GRID_COLS = 12;

const COLOR_CONFIG: Record<BubbleColor, { hex: string; points: number; label: string }> = {
  red: { hex: '#ef5350', points: 100, label: 'Red' },
  blue: { hex: '#42a5f5', points: 150, label: 'Blue' },
  green: { hex: '#66bb6a', points: 200, label: 'Green' },
  yellow: { hex: '#ffee58', points: 250, label: 'Yellow' },
  purple: { hex: '#ab47bc', points: 300, label: 'Purple' },
  orange: { hex: '#ffa726', points: 500, label: 'Orange' },
  rainbow: { hex: '#ffffff', points: 1000, label: 'Rainbow' },
  bomb: { hex: '#37474f', points: 800, label: 'Bomb' },
  fire: { hex: '#ff5722', points: 1200, label: 'Fire' },
};

const COLOR_KEYS: BubbleColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];
const SPECIAL_KEYS: BubbleColor[] = ['bomb', 'fire'];
const COLOR_QUEUE_SIZE = 3;
const FIRE_COOLDOWN = 25;   // min bollar mellan varje flammboll
const FIRE_CHANCE = 0.005;  // 0.5% chans när cooldown är uppfylld
const BOMB_CHANCE = 0.015;  // 1.5% chans för bomb

type QueueBall = { id: number; color: BubbleColor; isFire?: boolean };

const adjustColor = (color: string, amount: number) => {
  const hex = color.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(hex.substring(0, 2), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(hex.substring(2, 4), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(hex.substring(4, 6), 16) + amount));
  const componentToHex = (c: number) => {
    const hex = c.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return '#' + componentToHex(r) + componentToHex(g) + componentToHex(b);
};

const audioCtx = typeof window !== 'undefined' ? new (window.AudioContext || (window as any).webkitAudioContext)() : null;

const playTone = (freq: number, type: OscillatorType, duration: number, volume: number) => {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
};

const sounds = {
  shoot: () => {
    playTone(150, 'sine', 0.1, 0.3);
    playTone(300, 'sine', 0.05, 0.1);
  },
  match: () => {
    playTone(600, 'triangle', 0.15, 0.2);
    setTimeout(() => playTone(800, 'triangle', 0.1, 0.15), 50);
  },
  bomb: () => {
    playTone(100, 'sawtooth', 0.4, 0.4);
    playTone(50, 'sine', 0.5, 0.5);
  },
  rainbow: () => {
    playTone(400, 'sine', 0.1, 0.2);
    setTimeout(() => playTone(600, 'sine', 0.1, 0.2), 50);
    setTimeout(() => playTone(800, 'sine', 0.1, 0.2), 100);
  },
  gameOver: () => {
    playTone(200, 'sawtooth', 0.3, 0.3);
    setTimeout(() => playTone(150, 'sawtooth', 0.3, 0.3), 150);
    setTimeout(() => playTone(100, 'sawtooth', 0.5, 0.3), 300);
  },
};

interface GameBoardProps {
  playerId: number;
  playerName: string;
  controls: { left: string; right: string; fire: string };
  onCombo: (count: number) => void;
  onGameOver?: () => void;
  incomingAttack?: { id: number; colors: BubbleColor[] };
  isMultiplayer?: boolean;
  hideOwnGameOver?: boolean;
  isFrozen?: boolean;
  /** Nivå från Galaxy Map – visar intro och använder targetScore för level clear */
  level?: Level;
  onLevelWin?: (stars: number) => void;
  /** Single-player-layout: score vänster, kontroller mitten, bollkö höger (som Single Player-banan) */
  useSinglePlayerLayout?: boolean;
  /** Online PvP: motståndarens bräde (ritas istället för egen state) */
  remoteState?: BoardSnapshot | null;
  /** Invertera touch-styrning (används för lokal PvP spelare 2) */
  invertTouch?: boolean;
}

export interface GameBoardHandle {
  resetGame: () => void;
  /** Online PvP: returnerar BoardSnapshot för sync till motståndare (null om ej redo). */
  getSnapshot: () => BoardSnapshot | null;
}

const GameBoard = forwardRef<GameBoardHandle, GameBoardProps>(({ playerId, playerName, controls, onCombo, onGameOver, incomingAttack, isMultiplayer, hideOwnGameOver, isFrozen, level, onLevelWin, useSinglePlayerLayout, remoteState, invertTouch }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const [showIntro, setShowIntro] = useState(!!level);
  const [tutorialStep, setTutorialStep] = useState(0);
  const tutorialStepRef = useRef(0);

  const ballPos = useRef<Point>({ x: 0, y: 0 });
  const ballVel = useRef<Point>({ x: 0, y: 0 });
  const anchorPos = useRef<Point>({ x: 0, y: 0 });
  const isFlying = useRef<boolean>(false);
  const flightStartTime = useRef<number>(0);
  const bubbles = useRef<Bubble[]>([]);
  const particles = useRef<Particle[]>([]);
  const shockwaves = useRef<Shockwave[]>([]);
  const scoreRef = useRef<number>(0);
  const keysPressed = useRef<Set<string>>(new Set());
  const flyingBallColorRef = useRef<BubbleColor | null>(null);
  const flyingBallIsFireRef = useRef(false);
  const currentBallIsFireRef = useRef(false);
  const gridOffsetRef = useRef(0);
  const angleRef = useRef(DEFAULT_ANGLE);
  const powerRef = useRef(60);
  const touchStartX = useRef<number>(0);
  const touchStartAngle = useRef<number>(0);
  const activeTouchIdRef = useRef<number | null>(null);
  const touchTargetRef = useRef<HTMLDivElement>(null);

  const layoutRef = useRef({
    bubbleRadius: 22,
    rowHeight: 22 * Math.sqrt(3),
    slingshotOffset: 180,
    gridCols: GRID_COLS,
    maxDragDist: 180,
    constantPower: 120,
    width: 0,
    height: 0,
  });

  const [loading, setLoading] = useState(true);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [combo, setCombo] = useState<{ count: number; x: number; y: number } | null>(null);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isLevelWin, setIsLevelWin] = useState(false);
  const [levelStars, setLevelStars] = useState(0);
  const levelWinFiredRef = useRef(false);
  const levelStartTimeRef = useRef(0);
  const maxComboReachedRef = useRef(0);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [selectedColor, setSelectedColor] = useState<BubbleColor>('red');
  const [colorQueue, setColorQueue] = useState<QueueBall[]>([]);

  const isGameOverRef = useRef(false);
  useEffect(() => {
    isGameOverRef.current = isGameOver;
  }, [isGameOver]);

  const selectedColorRef = useRef<BubbleColor>('red');
  const nextQueueIdRef = useRef(0);
  const ballsSinceLastFireRef = useRef(FIRE_COOLDOWN); // tillåt fire direkt i början om slumpen träffar
  const dropFloatingBubblesRef = useRef<() => number>(() => 0);
  const nextBubbleIdRef = useRef(0);
  const gameOverReasonRef = useRef<'danger' | 'time' | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(`gemini_slingshot_highscore_${playerId}`);
    if (saved) setHighScore(parseInt(saved, 10));
  }, [playerId]);

  useEffect(() => {
    selectedColorRef.current = selectedColor;
  }, [selectedColor]);

  useEffect(() => {
    if (colorQueue.length > 0) {
      setSelectedColor(colorQueue[0].color);
      selectedColorRef.current = colorQueue[0].color;
      currentBallIsFireRef.current = colorQueue[0].isFire ?? false;
    }
  }, [colorQueue]);

  const getBubblePos = useCallback((row: number, col: number, width: number) => {
    const { bubbleRadius, rowHeight, gridCols } = layoutRef.current;
    const xOffset = (width - gridCols * bubbleRadius * 2) / 2 + bubbleRadius;
    const isStaggered = (row + gridOffsetRef.current) % 2 !== 0;
    const x = xOffset + col * (bubbleRadius * 2) + (isStaggered ? bubbleRadius : 0);
    const y = bubbleRadius + row * rowHeight;
    return { x, y };
  }, []);

  const pickQueueBall = useCallback((available: BubbleColor[]): QueueBall => {
    if (available.length === 0) return { id: nextQueueIdRef.current++, color: COLOR_KEYS[0] };
    const allowBomb = level?.allowBomb !== false;
    const allowFire = level?.allowFire !== false;
    if (allowBomb && Math.random() < BOMB_CHANCE) {
      ballsSinceLastFireRef.current += 1;
      return { id: nextQueueIdRef.current++, color: 'bomb' };
    }
    if (allowFire && ballsSinceLastFireRef.current >= FIRE_COOLDOWN && Math.random() < FIRE_CHANCE) {
      ballsSinceLastFireRef.current = 0;
      return { id: nextQueueIdRef.current++, color: COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)], isFire: true };
    }
    ballsSinceLastFireRef.current += 1;
    return { id: nextQueueIdRef.current++, color: available[Math.floor(Math.random() * available.length)] };
  }, [level]);

  const updateAvailableColors = useCallback(() => {
    const activeColors = new Set<BubbleColor>();
    bubbles.current.forEach((b) => {
      if (b.active) activeColors.add(b.color);
    });
    const available = Array.from(activeColors);
    if (available.length === 0) {
      setColorQueue([]);
      return;
    }
    setColorQueue((prev) => {
      if (prev.length > 0) return prev;
      const newQueue: QueueBall[] = [];
      for (let i = 0; i < COLOR_QUEUE_SIZE; i++) {
        newQueue.push(pickQueueBall(available));
      }
      return newQueue;
    });
  }, [pickQueueBall]);

  const initGrid = useCallback(
    (width: number) => {
      gridOffsetRef.current = 0;
      const gridCols = layoutRef.current.gridCols;
      // Single-player-layout (Galaxy Map): 6 rader, övriga (Local PvP / Online): 4 rader
      const initialRows = level?.initialRows ?? (gridCols === SINGLE_GRID_COLS ? 6 : 4);
      const newBubbles: Bubble[] = [];
      const allowBomb = level?.allowBomb !== false;
      const allowFire = level?.allowFire !== false;
      const specialKeys: BubbleColor[] = [];
      if (allowBomb) specialKeys.push('bomb');
      if (allowFire) specialKeys.push('fire');
      for (let r = 0; r < initialRows; r++) {
        for (let c = 0; c < ((r + gridOffsetRef.current) % 2 !== 0 ? gridCols - 1 : gridCols); c++) {
          if (Math.random() > 0.1) {
            const { x, y } = getBubblePos(r, c, width);
            const isSpecial = specialKeys.length > 0 && Math.random() < 0.02;
            let color: BubbleColor;
            let type: Bubble['type'] = 'normal';
            if (isSpecial && specialKeys.length > 0) {
              const special = specialKeys[Math.floor(Math.random() * specialKeys.length)];
              if (special === 'bomb') {
                color = 'bomb';
                type = 'bomb';
              } else {
                color = COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
                type = 'fire';
              }
            } else {
              color = COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
            }
            newBubbles.push({
              id: `b-${nextBubbleIdRef.current++}`,
              row: r,
              col: c,
              x,
              y,
              color,
              type,
              active: true,
            });
          }
        }
      }
      bubbles.current = newBubbles;
      updateAvailableColors();
    },
    [getBubblePos, updateAvailableColors, level]
  );

  const addNewRow = useCallback(() => {
    if (!canvasRef.current) return;
    const width = canvasRef.current.width;
    const gridCols = layoutRef.current.gridCols;
    gridOffsetRef.current = (gridOffsetRef.current + 1) % 2;
    bubbles.current.forEach((b) => {
      if (b.active) b.row += 1;
    });
    const allowBomb = level?.allowBomb !== false;
    const allowFire = level?.allowFire !== false;
    const specialKeys: BubbleColor[] = [];
    if (allowBomb) specialKeys.push('bomb');
    if (allowFire) specialKeys.push('fire');
    const r = 0;
    const isStaggered = (r + gridOffsetRef.current) % 2 !== 0;
    const colsInRow = isStaggered ? gridCols - 1 : gridCols;
    for (let c = 0; c < colsInRow; c++) {
      const { x, y } = getBubblePos(r, c, width);
      const isSpecial = specialKeys.length > 0 && Math.random() < 0.02;
      let color: BubbleColor;
      let type: Bubble['type'] = 'normal';
      if (isSpecial && specialKeys.length > 0) {
        const special = specialKeys[Math.floor(Math.random() * specialKeys.length)];
        if (special === 'bomb') {
          color = 'bomb';
          type = 'bomb';
        } else {
          color = COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
          type = 'fire';
        }
      } else {
        color = COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
      }
      bubbles.current.push({
        id: `${r}-${c}-${Date.now()}`,
        row: r,
        col: c,
        x,
        y: -layoutRef.current.rowHeight,
        color,
        type,
        active: true,
      });
    }
    const gameOverDanger = bubbles.current.some((b) => b.active && !b.isFloating && !b.isFalling && b.y + layoutRef.current.bubbleRadius >= anchorPos.current.y - layoutRef.current.rowHeight);
    if (gameOverDanger) {
      gameOverReasonRef.current = 'danger';
      setIsGameOver(true);
      sounds.gameOver();
      if (onGameOver && !level) onGameOver();
      if (scoreRef.current > highScore) {
        setHighScore(scoreRef.current);
        localStorage.setItem(`gemini_slingshot_highscore_${playerId}`, scoreRef.current.toString());
      }
    }
    updateAvailableColors();
  }, [getBubblePos, updateAvailableColors, playerId, highScore, onGameOver, level]);

  useEffect(() => {
    if (loading || isGameOver || isFrozen || showIntro || isLevelWin) return;
    const rowIntervalMs = level ? level.rowSpawnInterval : NEW_ROW_INTERVAL_MS;
    const interval = setInterval(() => {
      addNewRow();
    }, rowIntervalMs);
    return () => clearInterval(interval);
  }, [addNewRow, loading, isGameOver, isFrozen, showIntro, isLevelWin, level]);

  const timeLimitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!showIntro && level) levelStartTimeRef.current = performance.now();
    if (level?.timeLimit == null) setTimeRemaining(null);
  }, [showIntro, level]);
  useEffect(() => {
    if (!showIntro && level?.timeLimit != null && !isGameOver && !isLevelWin) {
      levelStartTimeRef.current = performance.now();
      setTimeRemaining(level.timeLimit);
      timeLimitTimerRef.current = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev == null || prev <= 1) {
            if (timeLimitTimerRef.current) {
              clearInterval(timeLimitTimerRef.current);
              timeLimitTimerRef.current = null;
            }
            gameOverReasonRef.current = 'time';
            setIsGameOver(true);
            sounds.gameOver();
            if (onGameOver && !level) onGameOver();
            if (scoreRef.current > highScore) {
              setHighScore(scoreRef.current);
              localStorage.setItem(`gemini_slingshot_highscore_${playerId}`, scoreRef.current.toString());
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => {
        if (timeLimitTimerRef.current) {
          clearInterval(timeLimitTimerRef.current);
          timeLimitTimerRef.current = null;
        }
      };
    }
  }, [showIntro, level?.timeLimit, isGameOver, isLevelWin, onGameOver, playerId, highScore]);

  const createExplosion = useCallback((x: number, y: number, color: string, intensity = 1) => {
    const count = 15 * intensity;
    for (let i = 0; i < count; i++) {
      particles.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 12 * intensity,
        vy: (Math.random() - 0.5) * 12 * intensity,
        life: 1.0,
        color,
      });
    }
  }, []);

  const createShockwave = useCallback((x: number, y: number, color: string) => {
    shockwaves.current.push({ x, y, radius: 0, maxRadius: 120, life: 1.0, color });
  }, []);

  const isNeighbor = useCallback((a: Bubble, b: Bubble) => {
    const dr = b.row - a.row;
    const dc = b.col - a.col;
    if (Math.abs(dr) > 1) return false;
    if (dr === 0) return Math.abs(dc) === 1;
    const aIsStaggered = (a.row + gridOffsetRef.current) % 2 !== 0;
    if (aIsStaggered) return dc === 0 || dc === 1;
    return dc === -1 || dc === 0;
  }, []);

  const popBubble = useCallback(
    (bubble: Bubble, processed = new Set<string>()) => {
      if (!bubble.active || processed.has(bubble.id)) return 0;
      processed.add(bubble.id);
      bubble.active = false;
      bubble.isFalling = true;
      bubble.vx = (Math.random() - 0.5) * 6;
      bubble.vy = -Math.random() * 8 - 4;
      createExplosion(bubble.x, bubble.y, COLOR_CONFIG[bubble.color].hex, bubble.type === 'bomb' || bubble.type === 'fire' ? 3 : 1);
      scoreRef.current += COLOR_CONFIG[bubble.color].points;
      let count = 1;
      if (bubble.type === 'bomb') {
        sounds.bomb();
        createShockwave(bubble.x, bubble.y, '#ff9800');
        const neighbors = bubbles.current.filter((b) => b.active && isNeighbor(bubble, b));
        neighbors.forEach((n) => {
          count += popBubble(n, processed);
        });
      } else if (bubble.type === 'fire') {
        sounds.bomb();
        createShockwave(bubble.x, bubble.y, '#ff5722');
        const neighbors1 = bubbles.current.filter((b) => b.active && isNeighbor(bubble, b));
        neighbors1.forEach((n) => {
          count += popBubble(n, processed);
        });
        const neighbors2: Bubble[] = [];
        bubbles.current.forEach((b) => {
          if (!b.active || b.isBurning || processed.has(b.id)) return;
          const isDist2 = neighbors1.some((n1) => isNeighbor(n1, b));
          if (isDist2 && b.id !== bubble.id) neighbors2.push(b);
        });
        neighbors2.forEach((n) => {
          n.isBurning = true;
          const bubbleId = n.id;
          setTimeout(() => {
            const current = bubbles.current.find((b) => b.id === bubbleId);
            if (current && current.active) popBubble(current);
            setScore(scoreRef.current);
            dropFloatingBubblesRef.current?.();
          }, 2000);
        });
      }
      return count;
    },
    [createExplosion, isNeighbor]
  );

  const dropFloatingBubbles = useCallback(() => {
    const activeBubbles = bubbles.current.filter((b) => b.active);
    if (activeBubbles.length === 0) return 0;
    const connectedToTop = new Set<string>();
    const queue = activeBubbles.filter((b) => b.row === 0);
    queue.forEach((b) => connectedToTop.add(b.id));
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      const neighbors = bubbles.current.filter((b) => b.active && !connectedToTop.has(b.id) && isNeighbor(current, b));
      for (const n of neighbors) {
        connectedToTop.add(n.id);
        queue.push(n);
      }
    }
    const floating = activeBubbles.filter((b) => !connectedToTop.has(b.id));
    let droppedCount = 0;
    if (floating.length > 0) {
      floating.forEach((b) => {
        droppedCount += popBubble(b);
      });
    }
    return droppedCount;
  }, [popBubble, isNeighbor]);

  useEffect(() => {
    dropFloatingBubblesRef.current = dropFloatingBubbles;
  }, [dropFloatingBubbles]);

  const checkMatches = useCallback(
    (startBubble: Bubble) => {
      const neighbors = bubbles.current.filter((b) => b.active && isNeighbor(startBubble, b));
      const bombSource = startBubble.type === 'bomb' ? startBubble : neighbors.find((n) => n.type === 'bomb');
      let totalPopped = 0;
      if (bombSource) {
        totalPopped += popBubble(bombSource);
        if (startBubble.active) totalPopped += popBubble(startBubble);
        totalPopped += dropFloatingBubbles();
        setScore(scoreRef.current);
        if (totalPopped >= 3) {
          if (totalPopped > maxComboReachedRef.current) maxComboReachedRef.current = totalPopped;
          onCombo(totalPopped);
          if (totalPopped >= 5) {
            setCombo({ count: totalPopped, x: startBubble.x, y: startBubble.y });
            setTimeout(() => setCombo(null), 1500);
          }
        }
        return true;
      }
      const toCheck = [startBubble];
      const visited = new Set<string>();
      const matches: Bubble[] = [];
      const targetColor = startBubble.color;
      while (toCheck.length > 0) {
        const current = toCheck.pop()!;
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        const isMatch = current.color === 'rainbow' || targetColor === 'rainbow' || current.color === targetColor;
        if (isMatch) {
          matches.push(current);
          const neighbors = bubbles.current.filter((b) => b.active && !visited.has(b.id) && isNeighbor(current, b));
          toCheck.push(...neighbors);
        }
      }
      if (matches.length >= 3) {
        if (level?.isTutorial && tutorialStepRef.current === 2) setTutorialStep(3);
        const isRainbowMatch = matches.some((m) => m.type === 'rainbow');
        if (isRainbowMatch) sounds.rainbow();
        else sounds.match();
        matches.forEach((b) => {
          totalPopped += popBubble(b);
        });
        totalPopped += dropFloatingBubbles();
        if (totalPopped >= 3) {
          if (totalPopped > maxComboReachedRef.current) maxComboReachedRef.current = totalPopped;
          onCombo(totalPopped);
          if (totalPopped >= 5) {
            setCombo({ count: totalPopped, x: startBubble.x, y: startBubble.y });
            setTimeout(() => setCombo(null), 1500);
          }
        }
        const multiplier = matches.length > 3 ? 1.5 : 1.0;
        scoreRef.current += Math.floor(matches.length * 50 * (multiplier - 1));
        setScore(scoreRef.current);
        if (level && scoreRef.current >= level.targetScore && !levelWinFiredRef.current) {
          levelWinFiredRef.current = true;
          setIsLevelWin(true);
          playTone(800, 'sine', 0.2, 0.3);
          setTimeout(() => playTone(1000, 'sine', 0.2, 0.3), 100);
          setTimeout(() => playTone(1200, 'sine', 0.4, 0.3), 200);
          let stars = 1;
          if (level.timeLimit != null) {
            const elapsedSeconds = (performance.now() - levelStartTimeRef.current) / 1000;
            const timeRemaining = level.timeLimit - elapsedSeconds;
            const pctLeft = timeRemaining / level.timeLimit;
            if (pctLeft >= 0.30) stars = 3;
            else if (pctLeft >= 0.20) stars = 2;
            else if (pctLeft >= 0.10) stars = 1;
            else stars = 1;
          } else if (level.targetCombo != null) {
            const maxCombo = maxComboReachedRef.current;
            if (maxCombo >= level.targetCombo) stars = 3;
            else if (maxCombo >= Math.max(1, level.targetCombo - 1)) stars = 2;
            else stars = 1;
          } else {
            const maxCombo = maxComboReachedRef.current;
            if (maxCombo >= 6) stars = 3;
            else if (maxCombo >= 4) stars = 2;
            else stars = 1;
          }
          setLevelStars(stars);
        }
        return true;
      }
      return false;
    },
    [popBubble, isNeighbor, dropFloatingBubbles, onCombo, level]
  );

  const drawBubble = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, colorKey: BubbleColor, bubbleType?: Bubble['type'], isBurning?: boolean) => {
    const useFlame = bubbleType === 'fire' || colorKey === 'fire' || isBurning;
    const config = COLOR_CONFIG[colorKey];
    let baseColor = config?.hex ?? '#ff5722';
    if (colorKey === 'rainbow') {
      const time = performance.now() * 0.002;
      const r = Math.floor(Math.sin(time) * 127 + 128);
      const g = Math.floor(Math.sin(time + 2) * 127 + 128);
      const b = Math.floor(Math.sin(time + 4) * 127 + 128);
      baseColor = `rgb(${r},${g},${b})`;
    }
    const grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
    if (colorKey === 'rainbow') {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.5, baseColor);
      grad.addColorStop(1, '#000000');
    } else if (useFlame && (bubbleType === 'fire' || isBurning) && colorKey !== 'fire') {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.2, baseColor);
      grad.addColorStop(1, adjustColor(baseColor, -60));
    } else if (colorKey === 'fire') {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.3, '#ffeb3b');
      grad.addColorStop(0.6, '#ff9800');
      grad.addColorStop(1, '#bf360c');
    } else {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.2, baseColor);
      grad.addColorStop(1, adjustColor(baseColor, -60));
    }

    if (useFlame) {
      const time = performance.now() * 0.008;
      ctx.save();
      // 1. Glöd först (bakom bollen) så det syns runt kanten
      const glowRadius = radius * (1.5 + Math.sin(time) * 0.2);
      const glowGrad = ctx.createRadialGradient(x, y, radius * 0.5, x, y, glowRadius);
      glowGrad.addColorStop(0, 'rgba(255, 100, 0, 0.6)');
      glowGrad.addColorStop(0.5, 'rgba(255, 50, 0, 0.3)');
      glowGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
      ctx.fill();
      // 2. Flickrande flammor (bakom bollen)
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + time * 0.5;
        const flicker = Math.sin(time * 2 + i) * 5;
        const flameX = x + Math.cos(angle) * (radius * 0.8);
        const flameY = y + Math.sin(angle) * (radius * 0.8) - radius * 0.3;
        const flameSize = radius * (0.35 + Math.sin(time + i * 0.7) * 0.15);
        const flameGrad = ctx.createRadialGradient(flameX, flameY, 0, flameX, flameY, flameSize);
        flameGrad.addColorStop(0, '#fffde7');
        flameGrad.addColorStop(0.4, '#ff9800');
        flameGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = flameGrad;
        ctx.beginPath();
        ctx.arc(flameX, flameY + flicker, flameSize, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 3. Själva bollen ovanpå (så flammorna sticker ut runt)
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    if (useFlame) {
      ctx.fillStyle = 'white';
      ctx.font = `bold ${radius}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔥', x, y);
    } else if (colorKey === 'bomb') {
      ctx.fillStyle = 'white';
      ctx.font = `bold ${radius}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💣', x, y);
    } else if (colorKey === 'rainbow') {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.strokeStyle = adjustColor(baseColor, -80);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(x - radius * 0.3, y - radius * 0.35, radius * 0.25, radius * 0.15, Math.PI / 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fill();
  };

  const handleFire = useCallback(() => {
    if (isFlying.current || isGameOver || isFrozen) return;
    if (level?.isTutorial && tutorialStepRef.current === 1) setTutorialStep(2);
    sounds.shoot();
    const { constantPower, maxDragDist } = layoutRef.current;
    const dx = -Math.cos(angleRef.current) * constantPower;
    const dy = -Math.sin(angleRef.current) * constantPower;
    const stretchDist = constantPower;
    isFlying.current = true;
    flightStartTime.current = performance.now();
    const powerRatio = Math.min(stretchDist / maxDragDist, 1.0);
    const velocityMultiplier = MIN_FORCE_MULT + (MAX_FORCE_MULT - MIN_FORCE_MULT) * (powerRatio * powerRatio);
    ballVel.current = { x: dx * velocityMultiplier, y: dy * velocityMultiplier };
    flyingBallColorRef.current = selectedColorRef.current;
    flyingBallIsFireRef.current = currentBallIsFireRef.current;
  }, [isGameOver, isFrozen, level?.isTutorial]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed.current.add(e.key);
      if (level?.isTutorial && tutorialStepRef.current === 0 && (e.key === controls.left || e.key === controls.right)) {
        setTutorialStep(1);
      }
      if (e.key === controls.fire) {
        e.preventDefault();
        handleFire();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.key);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleFire, controls.fire, controls.left, controls.right, level?.isTutorial]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (activeTouchIdRef.current !== null) return;
    const list =
      e.targetTouches && e.targetTouches.length > 0
        ? e.targetTouches
        : e.changedTouches && e.changedTouches.length > 0
          ? e.changedTouches
          : e.touches;
    if (!list || list.length === 0) return;
    const touch = list[0];
    activeTouchIdRef.current = touch.identifier;
    if (level?.isTutorial && tutorialStepRef.current === 0) setTutorialStep(1);
    touchStartX.current = touch.clientX;
    touchStartAngle.current = angleRef.current;
    e.preventDefault();
  }, [level?.isTutorial]);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (activeTouchIdRef.current === null || isFlying.current) return;
    const touch = Array.from(e.touches).find((t) => t.identifier === activeTouchIdRef.current);
    if (!touch) return;
    e.preventDefault();
    let dx = touch.clientX - touchStartX.current;
    if (invertTouch) dx = -dx;
    angleRef.current = Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, touchStartAngle.current + dx * TOUCH_ANGLE_SENSITIVITY));
  }, [invertTouch]);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const endedTouch = Array.from(e.changedTouches).find((t) => t.identifier === activeTouchIdRef.current);
    if (endedTouch) {
      activeTouchIdRef.current = null;
      handleFire();
    }
  }, [handleFire]);
  const handleTouchCancel = useCallback(() => {
    activeTouchIdRef.current = null;
  }, []);

  const handleFireRef = useRef(handleFire);
  handleFireRef.current = handleFire;

  useEffect(() => {
    if (!isMultiplayer) return;
    const el = touchTargetRef.current;
    if (!el) return;
    const onStart = (e: TouchEvent) => {
      if (activeTouchIdRef.current !== null) return;
      const list =
        e.targetTouches && e.targetTouches.length > 0
          ? e.targetTouches
          : e.changedTouches && e.changedTouches.length > 0
            ? e.changedTouches
            : e.touches;
      if (!list || list.length === 0) return;
      e.preventDefault();
      const touch = list[0];
      activeTouchIdRef.current = touch.identifier;
      if (level?.isTutorial && tutorialStepRef.current === 0) setTutorialStep(1);
      touchStartX.current = touch.clientX;
      touchStartAngle.current = angleRef.current;
    };
    const onMove = (e: TouchEvent) => {
      if (activeTouchIdRef.current === null || isFlying.current) return;
      const touch = Array.from(e.touches).find((t) => t.identifier === activeTouchIdRef.current);
      if (!touch) return;
      e.preventDefault();
      let dx = touch.clientX - touchStartX.current;
      if (invertTouch) dx = -dx;
      angleRef.current = Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, touchStartAngle.current + dx * TOUCH_ANGLE_SENSITIVITY));
    };
    const onEnd = (e: TouchEvent) => {
      const endedTouch = Array.from(e.changedTouches).find((t) => t.identifier === activeTouchIdRef.current);
      if (endedTouch) {
        activeTouchIdRef.current = null;
        handleFireRef.current();
      }
    };
    const onCancel = () => {
      activeTouchIdRef.current = null;
    };
    const opts: AddEventListenerOptions = { passive: false };
    el.addEventListener('touchstart', onStart, opts);
    el.addEventListener('touchmove', onMove, opts);
    el.addEventListener('touchend', onEnd, opts);
    el.addEventListener('touchcancel', onCancel, opts);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
  }, [isMultiplayer, playerId, level?.isTutorial]);

  const incomingBubblesRef = useRef<BubbleColor[]>([]);
  const lastAttackIdRef = useRef<number>(-1);

  const INCOMING_ATTACK_DELAY_MS = 1000;
  useEffect(() => {
    if (!incomingAttack || incomingAttack.id === lastAttackIdRef.current) return;
    lastAttackIdRef.current = incomingAttack.id;
    const colors = [...incomingAttack.colors];
    const t = setTimeout(() => {
      incomingBubblesRef.current.push(...colors);
    }, INCOMING_ATTACK_DELAY_MS);
    return () => clearTimeout(t);
  }, [incomingAttack]);

  const processIncomingBubbles = useCallback((width: number, height: number) => {
    if (incomingBubblesRef.current.length === 0) return;
    const { bubbleRadius } = layoutRef.current;
    const color = incomingBubblesRef.current.shift()!;
    const x = Math.random() * (width - bubbleRadius * 2) + bubbleRadius;
    const y = height + bubbleRadius;

    const isFire = color === 'fire';
    const actualColor = isFire ? COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)] : color;
    bubbles.current.push({
      id: `incoming-${Date.now()}`,
      row: -1,
      col: -1,
      x,
      y,
      color: actualColor,
      type: color === 'bomb' ? 'bomb' : isFire ? 'fire' : color === 'rainbow' ? 'rainbow' : 'normal',
      active: true,
      vx: (Math.random() - 0.5) * 6,
      vy: -18,
      isFloating: true,
    });
  }, []);

  const applyContainerSize = useCallback(() => {
    if (!canvasRef.current || !gameContainerRef.current) return;
    const canvas = canvasRef.current;
    const container = gameContainerRef.current;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w <= 0 || h <= 0) return;
    canvas.width = w;
    canvas.height = h;

    let bubbleRadius: number;
    let rowHeight: number;
    let slingshotOffset: number;
    let gridCols: number;

    if (useSinglePlayerLayout) {
      const scale = w / SINGLE_REF_WIDTH;
      bubbleRadius = SINGLE_REF_BUBBLE_RADIUS * scale;
      rowHeight = bubbleRadius * Math.sqrt(3);
      slingshotOffset = SINGLE_REF_SLINGSHOT_OFFSET * scale;
      gridCols = SINGLE_GRID_COLS;
    } else {
      const divisor = isMultiplayer ? 32 : 22;
      bubbleRadius = Math.min(w / (GRID_COLS + 1) / 2, h / divisor);
      rowHeight = bubbleRadius * Math.sqrt(3);
      slingshotOffset = Math.min(h * (isMultiplayer ? 0.15 : 0.25), isMultiplayer ? 100 : 180);
      gridCols = GRID_COLS;
    }

    layoutRef.current = {
      bubbleRadius,
      rowHeight,
      slingshotOffset,
      gridCols,
      maxDragDist: bubbleRadius * 8,
      constantPower: bubbleRadius * 5.5,
      width: w,
      height: h,
    };

    powerRef.current = layoutRef.current.constantPower;
    anchorPos.current = { x: w / 2, y: h - layoutRef.current.slingshotOffset };
    ballPos.current = { ...anchorPos.current };
    initGrid(w);
    setLoading(false);
  }, [useSinglePlayerLayout, isMultiplayer, initGrid]);

  useEffect(() => {
    applyContainerSize();
  }, [applyContainerSize, playerId]);

  useEffect(() => {
    const container = gameContainerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      applyContainerSize();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [applyContainerSize]);

  useEffect(() => {
    if (!canvasRef.current || !gameContainerRef.current) return;
    const canvas = canvasRef.current;
    const container = gameContainerRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    let animationFrameId: number;
    let lastTime = performance.now();
    const render = (currentTime: number) => {
      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;
      const isRemoteView = Boolean(remoteState);
      if (!isRemoteView && !isFlying.current) {
        const rotationSpeed = 0.003;
        if (keysPressed.current.has(controls.left)) angleRef.current -= rotationSpeed * deltaTime;
        if (keysPressed.current.has(controls.right)) angleRef.current += rotationSpeed * deltaTime;
        angleRef.current = Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, angleRef.current));
      }
      if (canvas.width !== container.clientWidth || canvas.height !== container.clientHeight) {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        const cw = canvas.width;
        const ch = canvas.height;

        let bubbleRadius: number;
        let rowHeight: number;
        let slingshotOffset: number;
        let gridCols: number;
        if (useSinglePlayerLayout) {
          const scale = cw / SINGLE_REF_WIDTH;
          bubbleRadius = SINGLE_REF_BUBBLE_RADIUS * scale;
          rowHeight = bubbleRadius * Math.sqrt(3);
          slingshotOffset = SINGLE_REF_SLINGSHOT_OFFSET * scale;
          gridCols = SINGLE_GRID_COLS;
        } else {
          const divisor = isMultiplayer ? 32 : 22;
          bubbleRadius = Math.min(cw / (GRID_COLS + 1) / 2, ch / divisor);
          rowHeight = bubbleRadius * Math.sqrt(3);
          slingshotOffset = Math.min(ch * (isMultiplayer ? 0.15 : 0.25), isMultiplayer ? 100 : 180);
          gridCols = GRID_COLS;
        }
        layoutRef.current = {
          bubbleRadius,
          rowHeight,
          slingshotOffset,
          gridCols,
          maxDragDist: bubbleRadius * 8,
          constantPower: bubbleRadius * 5.5,
          width: cw,
          height: ch,
        };

        powerRef.current = layoutRef.current.constantPower;
        anchorPos.current = { x: cw / 2, y: ch - layoutRef.current.slingshotOffset };
        if (!isFlying.current) ballPos.current = { ...anchorPos.current };
        if (!remoteState && bubbles.current.length === 0 && cw > 0 && ch > 0) {
          initGrid(cw);
        }
      }
      const { bubbleRadius, rowHeight, gridCols } = layoutRef.current;
      // Game over: trigger as soon as any bubble touches the danger zone (every frame, same as single player)
      if (!isRemoteView && !isGameOverRef.current && anchorPos.current) {
        const slingshotLineY = anchorPos.current.y;
        const triggerY = slingshotLineY - rowHeight;
        const touchedDanger = bubbles.current.some(
          (b) => b.active && !b.isFloating && !b.isFalling && b.y + bubbleRadius >= triggerY
        );
        if (touchedDanger) {
          gameOverReasonRef.current = 'danger';
          isGameOverRef.current = true;
          sounds.gameOver();
          setIsGameOver(true);
          if (onGameOver && !level) onGameOver();
          if (scoreRef.current > highScore) {
            setHighScore(scoreRef.current);
            localStorage.setItem(`gemini_slingshot_highscore_${playerId}`, scoreRef.current.toString());
          }
        }
      }
      ctx.save();
      if (isGameOver) {
        ctx.translate((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      bgGrad.addColorStop(0, '#1a1a1a');
      bgGrad.addColorStop(1, '#0d0d0d');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Väggar/laserlinje följer alltid gridens faktiska bredd (där bollarna spawnar),
      // både på desktop och mobil. På desktop ritas dessutom visuella väggmarkörer.
      const isDesktopView = canvas.width >= DESKTOP_WALL_REF_WIDTH;
      const gridWidth = gridCols * bubbleRadius * 2;
      const xOffset = (canvas.width - gridWidth) / 2 + bubbleRadius;
      const gridLeft = xOffset - bubbleRadius;
      const gridRight = xOffset + gridWidth - bubbleRadius;

      if (isDesktopView) {
        const wallW = WALL_MARKER_WIDTH_REF * (canvas.width / DESKTOP_WALL_REF_WIDTH);
        const wallInner = 'rgba(66, 165, 245, 0.5)';
        const wallOuter = 'rgba(66, 165, 245, 0.85)';
        ctx.fillStyle = wallInner;
        ctx.fillRect(gridLeft, 0, wallW, canvas.height);
        ctx.fillRect(gridRight - wallW, 0, wallW, canvas.height);
        ctx.fillStyle = wallOuter;
        ctx.fillRect(gridLeft, 0, 2, canvas.height);
        ctx.fillRect(gridRight - 2, 0, 2, canvas.height);
      }
      const leftWall = gridLeft + bubbleRadius;
      const rightWall = gridRight - bubbleRadius;
      const dangerY = anchorPos.current.y - rowHeight;
      ctx.save();
      if (useSinglePlayerLayout) {
        // Samma som Single Player: linje + text, ingen gradient
        ctx.strokeStyle = 'rgba(255, 80, 80, 0.9)';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(gridLeft, dangerY);
        ctx.lineTo(gridRight, dangerY);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 70, 70, 0.95)';
        ctx.font = 'bold 11px Inter';
        ctx.textAlign = 'right';
        ctx.fillText('DANGER ZONE', canvas.width - 10, dangerY - 5);
      } else {
        const dangerGrad = ctx.createLinearGradient(0, dangerY, 0, canvas.height);
        dangerGrad.addColorStop(0, 'rgba(239, 83, 80, 0)');
        dangerGrad.addColorStop(1, 'rgba(239, 83, 80, 0.1)');
        ctx.fillStyle = dangerGrad;
        ctx.fillRect(0, dangerY, canvas.width, canvas.height - dangerY);
        ctx.beginPath();
        ctx.setLineDash([10, 10]);
        ctx.moveTo(0, dangerY);
        ctx.lineTo(canvas.width, dangerY);
        ctx.strokeStyle = 'rgba(239, 83, 80, 0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'rgba(239, 83, 80, 0.3)';
        ctx.font = 'bold 10px Inter';
        ctx.textAlign = 'right';
        ctx.fillText('DANGER ZONE', canvas.width - 10, dangerY - 5);
      }
      ctx.restore();
      if (!isDesktopView) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(2, 0);
        ctx.lineTo(2, canvas.height);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(canvas.width - 2, 0);
        ctx.lineTo(canvas.width - 2, canvas.height);
        ctx.stroke();
      }
      if (remoteState && remoteState.width > 0 && remoteState.height > 0) {
        const sx = canvas.width / remoteState.width;
        const sy = canvas.height / remoteState.height;
        remoteState.bubbles.forEach((b) => {
          drawBubble(ctx, b.x * sx, b.y * sy, bubbleRadius - 1, b.color, b.type);
        });
        const launcherX = anchorPos.current.x;
        const launcherY = anchorPos.current.y;
        const slingScale = 0.82;
        const w = 15 * slingScale;
        const h = 40 * slingScale;
        const baseW = 25 * slingScale;
        const band = 40 * slingScale;
        const bandY = 10 * slingScale;
        ctx.save();
        const baseGradient = ctx.createLinearGradient(launcherX - w, launcherY + h, launcherX + w, canvas.height);
        baseGradient.addColorStop(0, '#1e1e1e');
        baseGradient.addColorStop(0.5, '#333333');
        baseGradient.addColorStop(1, '#121212');
        ctx.fillStyle = baseGradient;
        ctx.beginPath();
        ctx.moveTo(launcherX - w, launcherY + h);
        ctx.lineTo(launcherX + w, launcherY + h);
        ctx.lineTo(launcherX + baseW, canvas.height);
        ctx.lineTo(launcherX - baseW, canvas.height);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#444746';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(launcherX, launcherY + h, 8 * slingScale, 0, Math.PI * 2);
        ctx.fillStyle = '#42a5f5';
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#42a5f5';
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 8 * slingScale;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#616161';
        ctx.beginPath();
        ctx.moveTo(launcherX, launcherY + h);
        ctx.quadraticCurveTo(launcherX - band, launcherY + h, launcherX - band, launcherY - bandY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(launcherX, launcherY + h);
        ctx.quadraticCurveTo(launcherX + band, launcherY + h, launcherX + band, launcherY - bandY);
        ctx.stroke();
        ctx.fillStyle = '#42a5f5';
        ctx.beginPath();
        ctx.arc(launcherX - band, launcherY - bandY, 4 * slingScale, 0, Math.PI * 2);
        ctx.arc(launcherX + band, launcherY - bandY, 4 * slingScale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        const restBallOffset = 30 * slingScale;
        const ballX = remoteState.ballPos.x * sx;
        const ballY = remoteState.ballPos.y * sy - restBallOffset;
        const ballColor = remoteState.ballColor ?? 'red';
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(launcherX - band, launcherY - bandY);
        ctx.lineTo(ballX, ballY);
        ctx.moveTo(launcherX + band, launcherY - bandY);
        ctx.lineTo(ballX, ballY);
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#42a5f5';
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#42a5f5';
        ctx.globalAlpha = 0.6 + Math.sin(performance.now() * 0.001) * 0.2;
        ctx.stroke();
        ctx.restore();
        drawBubble(ctx, ballX, ballY, bubbleRadius * slingScale, ballColor);
        ctx.restore();
        animationFrameId = requestAnimationFrame(render);
        return;
      }
      if (!isFlying.current) {
        const targetX = anchorPos.current.x + Math.cos(angleRef.current) * powerRef.current;
        const targetY = anchorPos.current.y + Math.sin(angleRef.current) * powerRef.current;
        ballPos.current.x += (targetX - ballPos.current.x) * 0.2;
        ballPos.current.y += (targetY - ballPos.current.y) * 0.2;
      }
      if (isFlying.current) {
        if (performance.now() - flightStartTime.current > 5000) {
          isFlying.current = false;
          ballPos.current = { ...anchorPos.current };
          ballVel.current = { x: 0, y: 0 };
        } else {
          const currentSpeed = Math.sqrt(ballVel.current.x ** 2 + ballVel.current.y ** 2);
          const steps = Math.ceil(currentSpeed / (bubbleRadius * 0.8));
          let collisionOccurred = false;
          for (let i = 0; i < steps; i++) {
            ballPos.current.x += ballVel.current.x / steps;
            ballPos.current.y += ballVel.current.y / steps;
            if (ballPos.current.x < leftWall || ballPos.current.x > rightWall) {
              ballVel.current.x *= -1;
              ballPos.current.x = Math.max(leftWall, Math.min(rightWall, ballPos.current.x));
            }
            if (ballPos.current.y < bubbleRadius) {
              collisionOccurred = true;
              break;
            }
            for (const b of bubbles.current) {
              if (!b.active || b.isFloating) continue;
              const dist = Math.sqrt(Math.pow(ballPos.current.x - b.x, 2) + Math.pow(ballPos.current.y - b.y, 2));
              if (dist < bubbleRadius * 1.8) {
                collisionOccurred = true;
                break;
              }
            }
            if (collisionOccurred) break;
          }
          ballVel.current.y += GRAVITY;
          ballVel.current.x *= FRICTION;
          ballVel.current.y *= FRICTION;
          if (collisionOccurred) {
            isFlying.current = false;
            let bestDist = Infinity;
            let bestRow = 0;
            let bestCol = 0;
            let bestX = 0;
            let bestY = 0;
            const maxLogicalRows = Math.ceil(canvas.height / layoutRef.current.rowHeight) + 5;
            for (let r = 0; r < maxLogicalRows; r++) {
              const colsInRow = (r + gridOffsetRef.current) % 2 !== 0 ? gridCols - 1 : gridCols;
              for (let c = 0; c < colsInRow; c++) {
                const { x, y } = getBubblePos(r, c, canvas.width);
                const occupied = bubbles.current.some((b) => b.active && b.row === r && b.col === c);
                if (occupied) continue;
                const dist = Math.sqrt(Math.pow(ballPos.current.x - x, 2) + Math.pow(ballPos.current.y - y, 2));
                if (dist < bestDist) {
                  bestDist = dist;
                  bestRow = r;
                  bestCol = c;
                  bestX = x;
                  bestY = y;
                }
              }
            }
            const flyingColor = flyingBallColorRef.current || selectedColorRef.current;
            const isFireShot = flyingBallIsFireRef.current;
            const landedColor = flyingColor;
            const newBubble: Bubble = {
              id: `${bestRow}-${bestCol}-${Date.now()}`,
              row: bestRow,
              col: bestCol,
              x: bestX,
              y: bestY,
              color: landedColor,
              type: flyingColor === 'bomb' ? 'bomb' : isFireShot ? 'fire' : 'normal',
              active: true,
            };
            bubbles.current.push(newBubble);
            checkMatches(newBubble);
            setColorQueue((prev) => {
              const next = prev.slice(1) as QueueBall[];
              const activeColors = new Set<BubbleColor>();
              bubbles.current.forEach((b) => { if (b.active) activeColors.add(b.color); });
              const available = Array.from(activeColors);
              if (available.length > 0) next.push(pickQueueBall(available));
              return next;
            });
            updateAvailableColors();
            ballPos.current = { ...anchorPos.current };
            ballVel.current = { x: 0, y: 0 };
          }
          if (ballPos.current.y > canvas.height) {
            isFlying.current = false;
            ballPos.current = { ...anchorPos.current };
            ballVel.current = { x: 0, y: 0 };
          }
        }
      }
      bubbles.current.forEach((b) => {
        if (b.isFalling) {
          b.vx = b.vx || 0;
          b.vy = (b.vy || 0) + 0.6;
          b.x += b.vx;
          b.y += b.vy;
          if (b.x < leftWall) {
            b.x = leftWall;
            b.vx = Math.abs(b.vx);
          } else if (b.x > rightWall) {
            b.x = rightWall;
            b.vx = -Math.abs(b.vx);
          }
          ctx.save();
          const fade = Math.max(0, 1 - (b.y - canvas.height * 0.5) / (canvas.height * 0.5));
          ctx.globalAlpha = fade;
          drawBubble(ctx, b.x, b.y, bubbleRadius - 1, b.color, b.type, b.isBurning);
          ctx.restore();
          return;
        }
        if (b.isFloating) {
          b.x += b.vx || 0;
          b.y += b.vy || 0;

          if (b.x < leftWall || b.x > rightWall) {
            b.vx = (b.vx || 0) * -1;
            b.x = Math.max(leftWall, Math.min(rightWall, b.x));
          }

          let collisionOccurred = false;
          if (b.y < bubbleRadius) {
            collisionOccurred = true;
          } else {
            for (const other of bubbles.current) {
              if (other.active && !other.isFloating && !other.isFalling) {
                const dist = Math.sqrt(Math.pow(b.x - other.x, 2) + Math.pow(b.y - other.y, 2));
                if (dist < bubbleRadius * 1.8) {
                  collisionOccurred = true;
                  break;
                }
              }
            }
          }

          if (collisionOccurred) {
            b.isFloating = false;
            let bestDist = Infinity;
            let bestRow = 0;
            let bestCol = 0;
            let bestX = 0;
            let bestY = 0;
            const maxLogicalRowsFloat = Math.ceil(canvas.height / layoutRef.current.rowHeight) + 5;
            for (let r = 0; r < maxLogicalRowsFloat; r++) {
              const colsInRow = (r + gridOffsetRef.current) % 2 !== 0 ? gridCols - 1 : gridCols;
              for (let c = 0; c < colsInRow; c++) {
                const { x, y } = getBubblePos(r, c, canvas.width);
                const occupied = bubbles.current.some((ob) => ob.active && ob.row === r && ob.col === c);
                if (occupied) continue;
                const dist = Math.sqrt(Math.pow(b.x - x, 2) + Math.pow(b.y - y, 2));
                if (dist < bestDist) {
                  bestDist = dist;
                  bestRow = r;
                  bestCol = c;
                  bestX = x;
                  bestY = y;
                }
              }
            }
            b.row = bestRow;
            b.col = bestCol;
            b.x = bestX;
            b.y = bestY;
            b.vx = 0;
            b.vy = 0;
          }
          drawBubble(ctx, b.x, b.y, bubbleRadius - 1, b.color, b.type, b.isBurning);
          return;
        }
        if (!b.active) return;
        const target = getBubblePos(b.row, b.col, canvas.width);
        b.x += (target.x - b.x) * 0.1;
        b.y += (target.y - b.y) * 0.1;
        drawBubble(ctx, b.x, b.y, bubbleRadius - 1, b.color, b.type, b.isBurning);
      });
      bubbles.current = bubbles.current.filter((b) => b.active || (b.isFalling && b.y < canvas.height + 50));
      const launcherX = anchorPos.current.x;
      const launcherY = anchorPos.current.y;
      const glowColor = '#42a5f5';
      const time = performance.now();
      const slingScale = 0.82;
      const w = 15 * slingScale;
      const h = 40 * slingScale;
      const baseW = 25 * slingScale;
      const band = 40 * slingScale;
      const bandY = 10 * slingScale;
      ctx.save();
      const baseGradient = ctx.createLinearGradient(launcherX - w, launcherY + h, launcherX + w, canvas.height);
      baseGradient.addColorStop(0, '#1e1e1e');
      baseGradient.addColorStop(0.5, '#333333');
      baseGradient.addColorStop(1, '#121212');
      ctx.fillStyle = baseGradient;
      ctx.beginPath();
      ctx.moveTo(launcherX - w, launcherY + h);
      ctx.lineTo(launcherX + w, launcherY + h);
      ctx.lineTo(launcherX + baseW, canvas.height);
      ctx.lineTo(launcherX - baseW, canvas.height);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#444746';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(launcherX, launcherY + h, 8 * slingScale, 0, Math.PI * 2);
      ctx.fillStyle = glowColor;
      ctx.shadowBlur = 15;
      ctx.shadowColor = glowColor;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 8 * slingScale;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#616161';
      ctx.beginPath();
      ctx.moveTo(launcherX, launcherY + h);
      ctx.quadraticCurveTo(launcherX - band, launcherY + h, launcherX - band, launcherY - bandY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(launcherX, launcherY + h);
      ctx.quadraticCurveTo(launcherX + band, launcherY + h, launcherX + band, launcherY - bandY);
      ctx.stroke();
      ctx.fillStyle = glowColor;
      ctx.beginPath();
      ctx.arc(launcherX - band, launcherY - bandY, 4 * slingScale, 0, Math.PI * 2);
      ctx.arc(launcherX + band, launcherY - bandY, 4 * slingScale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      const currentSelected = selectedColorRef.current;
      if (!isFlying.current) {
        ctx.save();
        const highlightColor = COLOR_CONFIG[currentSelected].hex;
        ctx.shadowBlur = 15;
        ctx.shadowColor = highlightColor;
        const fireAngle = angleRef.current + Math.PI;
        let curX = launcherX;
        let curY = launcherY;
        let dirX = Math.cos(fireAngle);
        let dirY = Math.sin(fireAngle);
        const maxDistance = 1200;
        let distanceTravelled = 0;
        const stepSize = 5;
        ctx.beginPath();
        ctx.moveTo(curX, curY);
        const totalDash = 30;
        const dashOffset = (time * 0.05) % totalDash;
        ctx.setLineDash([12, 18]);
        ctx.lineDashOffset = -dashOffset;
        ctx.strokeStyle = `${highlightColor}88`;
        ctx.lineWidth = 3;
        let hitPoint = { x: curX, y: curY };
        let hitSomething = false;
        while (distanceTravelled < maxDistance && !hitSomething) {
          curX += dirX * stepSize;
          curY += dirY * stepSize;
          distanceTravelled += stepSize;
          if (curX < leftWall) {
            curX = leftWall;
            dirX *= -1;
            ctx.lineTo(curX, curY);
          } else if (curX > rightWall) {
            curX = rightWall;
            dirX *= -1;
            ctx.lineTo(curX, curY);
          }
          const collision = bubbles.current.find(
            (b) =>
              b.active &&
              !b.isFloating &&
              Math.sqrt(Math.pow(curX - b.x, 2) + Math.pow(curY - b.y, 2)) < bubbleRadius * 2
          );
          if (collision || curY < bubbleRadius) {
            hitPoint = { x: curX, y: curY };
            hitSomething = true;
          }
        }
        if (!hitSomething) hitPoint = { x: curX, y: curY };
        ctx.lineTo(hitPoint.x, hitPoint.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(hitPoint.x, hitPoint.y, 6 * slingScale, 0, Math.PI * 2);
        ctx.fillStyle = highlightColor;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(hitPoint.x, hitPoint.y, 12 * slingScale + Math.sin(time * 0.01) * 4, 0, Math.PI * 2);
        ctx.strokeStyle = highlightColor;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
      const restBallOffset = 30 * slingScale;
      const ballDrawY = isFlying.current ? ballPos.current.y : ballPos.current.y - restBallOffset;
      const bandAttach = band;
      const bandAttachY = bandY;
      if (!isFlying.current) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(launcherX - bandAttach, launcherY - bandAttachY);
        ctx.lineTo(ballPos.current.x, ballDrawY);
        ctx.lineWidth = 4;
        ctx.strokeStyle = glowColor;
        ctx.shadowBlur = 15;
        ctx.shadowColor = glowColor;
        ctx.globalAlpha = 0.6 + Math.sin(time * 0.01) * 0.2;
        ctx.stroke();
        ctx.restore();
      }
      const launcherBallR = useSinglePlayerLayout ? bubbleRadius : bubbleRadius * slingScale;
      if (isFlying.current) {
        const distFromAnchor = Math.sqrt(Math.pow(ballPos.current.x - launcherX, 2) + Math.pow(ballPos.current.y - launcherY, 2));
        if (distFromAnchor > bubbleRadius * 2) {
          ctx.save();
          ctx.globalAlpha = 0.8;
          drawBubble(ctx, launcherX, launcherY - restBallOffset, launcherBallR, selectedColorRef.current, currentBallIsFireRef.current ? 'fire' : undefined);
          ctx.restore();
        }
      }
      ctx.save();
      const currentFlyingColor = flyingBallColorRef.current;
      const ballColor = isFlying.current && currentFlyingColor ? currentFlyingColor : selectedColorRef.current;
      const drawR = isFlying.current ? bubbleRadius : launcherBallR;
      drawBubble(ctx, ballPos.current.x, ballDrawY, drawR, ballColor, isFlying.current ? (flyingBallIsFireRef.current ? 'fire' : undefined) : (currentBallIsFireRef.current ? 'fire' : undefined));
      ctx.restore();
      if (!isFlying.current) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(ballPos.current.x, ballDrawY);
        ctx.lineTo(launcherX + bandAttach, launcherY - bandAttachY);
        ctx.lineWidth = 4;
        ctx.strokeStyle = glowColor;
        ctx.shadowBlur = 15;
        ctx.shadowColor = glowColor;
        ctx.globalAlpha = 0.6 + Math.sin(time * 0.01) * 0.2;
        ctx.stroke();
        ctx.restore();
      }
      for (let i = particles.current.length - 1; i >= 0; i--) {
        const p = particles.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.05;
        if (p.life <= 0) particles.current.splice(i, 1);
        else {
          ctx.globalAlpha = p.life;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
          ctx.globalAlpha = 1.0;
        }
      }
      for (let i = shockwaves.current.length - 1; i >= 0; i--) {
        const s = shockwaves.current[i];
        s.radius += (s.maxRadius - s.radius) * 0.15;
        s.life -= 0.04;
        if (s.life <= 0) shockwaves.current.splice(i, 1);
        else {
          ctx.save();
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
          ctx.strokeStyle = s.color;
          ctx.lineWidth = 10 * s.life;
          ctx.globalAlpha = s.life;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.radius * 0.8, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 4 * s.life;
          ctx.stroke();
          ctx.restore();
        }
      }
      processIncomingBubbles(canvas.width, canvas.height);
      ctx.restore();
      animationFrameId = requestAnimationFrame(render);
    };
    animationFrameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrameId);
  }, [controls, isGameOver, processIncomingBubbles, isMultiplayer, useSinglePlayerLayout, getBubblePos, checkMatches, updateAvailableColors, pickQueueBall, level, onGameOver, remoteState]);

  const resetGame = useCallback(() => {
    if (!canvasRef.current) return;
    if (level?.isTutorial) setTutorialStep(0);
    scoreRef.current = 0;
    setScore(0);
    isGameOverRef.current = false;
    setIsGameOver(false);
    setIsLevelWin(false);
    setLevelStars(0);
    setTimeRemaining(null);
    levelWinFiredRef.current = false;
    maxComboReachedRef.current = 0;
    if (timeLimitTimerRef.current) {
      clearInterval(timeLimitTimerRef.current);
      timeLimitTimerRef.current = null;
    }
    incomingBubblesRef.current = [];
    lastAttackIdRef.current = -1;
    nextBubbleIdRef.current = 0;
    gameOverReasonRef.current = null;
    initGrid(canvasRef.current.width);
    ballPos.current = { ...anchorPos.current };
    ballVel.current = { x: 0, y: 0 };
    isFlying.current = false;
  }, [initGrid, level?.isTutorial]);

  const getSnapshot = useCallback((): BoardSnapshot | null => {
    const layout = layoutRef.current;
    if (!layout || layout.width <= 0 || layout.height <= 0) return null;
    return {
      width: layout.width,
      height: layout.height,
      bubbles: bubbles.current.map((b) => ({
        id: b.id,
        x: b.x,
        y: b.y,
        color: b.color,
        type: b.type,
        active: b.active,
      })),
      ballPos: { ...ballPos.current },
      angle: angleRef.current,
      score: scoreRef.current,
      ballColor: selectedColorRef.current,
    };
  }, []);

  useImperativeHandle(ref, () => ({ resetGame, getSnapshot }), [resetGame, getSnapshot]);

  useEffect(() => {
    tutorialStepRef.current = tutorialStep;
  }, [tutorialStep]);

  useEffect(() => {
    if (level) {
      setShowIntro(true);
      if (level.id === 1) setTutorialStep(0);
      const t = setTimeout(() => setShowIntro(false), 3000);
      return () => clearTimeout(t);
    }
  }, [level]);

  return (
    <div className="flex-1 relative h-full overflow-hidden border-x border-white/5">
      <AnimatePresence>
        {showIntro && level && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.8, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 1.2, opacity: 0 }}
              className="text-center"
            >
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-emerald-500 font-black tracking-[0.5em] uppercase text-sm mb-4 block"
              >
                Mission {level.id}
              </motion.span>
              <motion.h2
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-5xl sm:text-7xl font-black text-white tracking-tighter mb-6"
              >
                {level.name.toUpperCase()}
              </motion.h2>
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: '100%' }}
                transition={{ delay: 0.6, duration: 1 }}
                className="h-1 bg-emerald-500 mx-auto mb-6 max-w-xs"
              />
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.2 }}
                className="flex items-center justify-center gap-4 text-slate-400"
              >
                <Target size={20} />
                <span className="text-xl sm:text-2xl font-bold tracking-widest">TARGET: {level.targetScore.toLocaleString()}</span>
              </motion.div>
              {(level.timeLimit != null || level.targetCombo != null) && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1.5 }}
                  className="flex items-center justify-center gap-4 text-slate-400 mt-2"
                >
                  {level.timeLimit != null && (
                    <span className="text-sm sm:text-base font-bold tracking-widest">TIME: {level.timeLimit}s</span>
                  )}
                  {level.targetCombo != null && (
                    <span className="text-sm sm:text-base font-bold tracking-widest">COMBO: {level.targetCombo}+</span>
                  )}
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {isLevelWin && level && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="text-center p-6 sm:p-8 rounded-2xl sm:rounded-[40px] border border-emerald-500/30 bg-[#1a1a1a] shadow-2xl max-w-md w-full">
            <div className="mb-6 flex justify-center gap-2">
              {[1, 2, 3].map((i) => (
                <Star
                  key={i}
                  size={40}
                  className={i <= levelStars ? 'text-yellow-400 fill-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]' : 'text-white/10'}
                />
              ))}
            </div>
            <h2 className="text-3xl sm:text-5xl font-black mb-2 tracking-tighter text-white">LEVEL CLEAR!</h2>
            <p className="text-emerald-400 font-bold tracking-widest uppercase text-xs sm:text-sm mb-6">Mission Accomplished</p>
            <div className="bg-white/5 rounded-xl sm:rounded-2xl p-4 mb-6 border border-white/5">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Score</div>
              <div className="text-xl sm:text-2xl font-mono font-bold text-white">{scoreRef.current.toLocaleString()}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-2 mb-1">Target</div>
              <div className="text-lg font-mono font-bold text-emerald-400">{level.targetScore.toLocaleString()}</div>
            </div>
            <button
              onClick={() => onLevelWin?.(levelStars)}
              className="w-full py-4 px-8 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-lg transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
            >
              <Zap size={20} fill="currentColor" /> BACK TO MAP
            </button>
          </div>
        </div>
      )}
      {isGameOver && !hideOwnGameOver && (
        <div className={`absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md ${level ? 'p-4 sm:p-6' : isMultiplayer ? 'p-2 sm:p-3' : 'p-4 sm:p-6'}`}>
          <div
            className={`text-center rounded-xl border shadow-2xl w-full overflow-y-auto
              ${level
                ? 'p-8 rounded-3xl border-white/10 bg-white/5 max-w-md mx-4'
                : isMultiplayer
                  ? 'p-3 sm:p-4 max-w-[280px] sm:max-w-[320px] max-h-[100%] border-white/10 bg-white/5'
                  : 'p-4 sm:p-6 md:p-8 rounded-2xl sm:rounded-3xl max-w-md max-h-[90vh] border-white/10 bg-white/5'}`}
          >
            <div className={level ? 'mb-6 flex justify-center' : isMultiplayer ? 'mb-2 flex justify-center' : 'mb-3 sm:mb-6 flex justify-center'}>
              <div className={level ? 'p-4 rounded-full bg-red-500/20 text-red-500' : isMultiplayer ? 'p-2 rounded-full bg-red-500/20 text-red-500' : 'p-3 sm:p-4 rounded-full bg-red-500/20 text-red-500'}>
                <AlertTriangle className={level ? 'w-16 h-16 sm:w-16 sm:h-16' : isMultiplayer ? 'w-8 h-8 sm:w-10 sm:h-10' : 'w-10 h-10 sm:w-14 sm:h-14 md:w-16 md:h-16'} />
              </div>
            </div>
            <h2 className={`font-bold tracking-tighter text-white ${level ? 'text-5xl mb-2' : isMultiplayer ? 'text-xl sm:text-2xl mb-0.5' : 'text-3xl sm:text-4xl md:text-5xl mb-1 sm:mb-2'}`}>
              {level ? 'MISSION FAILED' : 'GAME OVER'}
            </h2>
            <p className={`text-slate-400 ${level ? 'mb-2' : isMultiplayer ? 'mb-1' : 'mb-1 sm:mb-2'}`}>{playerName}</p>
            <p className={`text-slate-400 ${level ? 'mb-8' : isMultiplayer ? 'mb-2' : 'mb-4 sm:mb-8'}`}>
              {level
                ? (gameOverReasonRef.current === 'time' ? "Time ran out!" : "Bubbles reached the danger zone!")
                : 'The bubbles reached the bottom!'}
            </p>
            <div className={`bg-white/5 rounded-lg border border-white/5 ${level ? 'rounded-2xl p-6 mb-8' : isMultiplayer ? 'p-3 mb-3' : 'rounded-xl sm:rounded-2xl p-4 sm:p-6 mb-4 sm:mb-8'}`}>
              <div className={`uppercase tracking-widest text-slate-500 ${level ? 'text-sm mb-1' : isMultiplayer ? 'text-[10px] mb-0.5' : 'text-xs sm:text-sm mb-1'}`}>Final Score</div>
              <div className={`font-mono font-bold ${level ? 'text-4xl text-red-400 mb-4' : isMultiplayer ? 'text-lg sm:text-xl mb-2 text-emerald-400' : 'text-2xl sm:text-3xl md:text-4xl mb-3 sm:mb-4 text-emerald-400'}`}>{score.toLocaleString()}</div>
              {level ? (
                <div className="pt-4 border-t border-white/5">
                  <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Target Score</div>
                  <div className="text-xl font-mono font-bold text-white">{level.targetScore.toLocaleString()}</div>
                </div>
              ) : (
                <div className={`border-t border-white/5 ${isMultiplayer ? 'pt-2' : 'pt-3 sm:pt-4'}`}>
                  <div className={`uppercase tracking-widest text-slate-500 ${isMultiplayer ? 'text-[9px] mb-0.5' : 'text-[10px] mb-1'}`}>Best Score</div>
                  <div className={`font-mono font-bold text-white ${isMultiplayer ? 'text-sm sm:text-base' : 'text-lg sm:text-xl'}`}>{highScore.toLocaleString()}</div>
                </div>
              )}
            </div>
            {level ? (
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => onGameOver?.()}
                  className="flex-1 py-4 px-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-bold transition-all active:scale-95"
                >
                  MAP
                </button>
                <button
                  type="button"
                  onClick={resetGame}
                  className="flex-[2] py-4 px-8 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xl transition-all active:scale-95 flex items-center justify-center gap-3 shadow-lg shadow-emerald-500/20"
                >
                  <Zap size={24} fill="currentColor" /> RETRY
                </button>
              </div>
            ) : (
              <button
                onClick={resetGame}
                className={`w-full rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 ${isMultiplayer ? 'py-2.5 sm:py-3 px-4 text-sm sm:text-base' : 'py-3 sm:py-4 px-6 sm:px-8 rounded-2xl text-base sm:text-xl gap-3'}`}
              >
                <Zap className={isMultiplayer ? 'w-4 h-4 sm:w-5 sm:h-5' : 'w-5 h-5 sm:w-6 sm:h-6'} fill="currentColor" /> TRY AGAIN
              </button>
            )}
          </div>
        </div>
      )}
      <div ref={gameContainerRef} className="absolute inset-0">
        <div
          ref={touchTargetRef}
          className="absolute inset-0"
          style={{ touchAction: 'none' }}
          {...(isMultiplayer
            ? {}
            : {
                onTouchStart: handleTouchStart,
                onTouchMove: handleTouchMove,
                onTouchEnd: handleTouchEnd,
                onTouchCancel: handleTouchCancel,
              })}
        >
          <canvas ref={canvasRef} className="absolute inset-0" />
        </div>
        {/* In-game tutorial (exempel-design): visas under spelet, steg växlar på drag → skjut → matcha */}
        {level?.isTutorial && !showIntro && !isGameOver && !isLevelWin && (
          <div className="absolute inset-0 z-40 pointer-events-none">
            {tutorialStep < 2 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 bg-black/40"
                style={{
                  maskImage: 'radial-gradient(circle at 50% 85%, transparent 120px, black 150px)',
                  WebkitMaskImage: 'radial-gradient(circle at 50% 85%, transparent 120px, black 150px)',
                }}
              />
            )}
            <div className="absolute bottom-56 left-1/2 -translate-x-1/2 w-full max-w-sm px-6">
              <motion.div
                initial={{ y: 20, opacity: 0, scale: 0.95 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                key={tutorialStep}
                className="bg-[#1e1e1e]/95 backdrop-blur-xl text-white p-6 rounded-[32px] shadow-2xl border border-emerald-500/30 flex items-start gap-4"
              >
                <div className="p-3 rounded-2xl bg-emerald-500/20 text-emerald-500 shrink-0">
                  <Info size={24} />
                </div>
                <div className="flex-1">
                  <p className="text-emerald-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">
                    Tutorial Step {tutorialStep + 1}
                  </p>
                  <p className="text-lg font-bold leading-tight text-slate-100">
                    {level.tutorialSteps?.[tutorialStep]}
                  </p>
                  <div className="mt-4 flex items-center gap-1.5">
                    {level.tutorialSteps?.map((_, i) => (
                      <div
                        key={i}
                        className={`h-1 rounded-full transition-all duration-500 ${i === tutorialStep ? 'bg-emerald-500 w-8' : 'bg-white/10 w-2'}`}
                      />
                    ))}
                  </div>
                </div>
              </motion.div>
            </div>
            {tutorialStep === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute bottom-[24%] left-1/2 -translate-x-1/2 flex flex-col items-center"
              >
                <motion.div
                  animate={{ y: [0, 40, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  className="text-emerald-500"
                >
                  <MousePointer2 size={40} className="rotate-180" />
                </motion.div>
                <p className="text-emerald-500 font-black text-xs uppercase tracking-widest mt-4">Pull down</p>
              </motion.div>
            )}
          </div>
        )}
        <AnimatePresence>
          {combo && (() => {
            const n = combo.count;
            const tier = n >= 15 ? 'legendary' : n >= 10 ? 'incredible' : 'amazing';
            const config = {
              amazing: {
                gradient: 'from-yellow-400 to-orange-600',
                subtitle: 'Amazing Shot!',
                scale: 1.2,
                textSize: 'text-2xl sm:text-4xl md:text-6xl',
                subtitleSize: 'text-sm sm:text-base md:text-xl',
              },
              incredible: {
                gradient: 'from-pink-400 via-purple-500 to-indigo-600',
                subtitle: 'Incredible!',
                scale: 1.35,
                textSize: 'text-3xl sm:text-5xl md:text-6xl',
                subtitleSize: 'text-base sm:text-lg md:text-xl',
              },
              legendary: {
                gradient: 'from-amber-300 via-yellow-400 to-red-500',
                subtitle: 'LEGENDARY!',
                scale: 1.5,
                textSize: 'text-3xl sm:text-5xl md:text-7xl',
                subtitleSize: 'text-base sm:text-xl md:text-2xl',
              },
            }[tier];
            const c = config;
            return (
              <motion.div
                key={combo.x + combo.y + n}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: c.scale }}
                exit={{ opacity: 0, scale: 1.5 }}
                className="absolute inset-0 pointer-events-none z-50 flex flex-col items-center justify-center max-w-[90vw] px-2"
              >
                <div className={`bg-gradient-to-b ${c.gradient} text-transparent bg-clip-text ${c.textSize} font-black italic tracking-tighter drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)] text-center`}>
                  {n} COMBO!
                </div>
                <div className={`text-white ${c.subtitleSize} font-bold uppercase tracking-widest mt-[-6px] sm:mt-[-10px] drop-shadow-md text-center ${tier === 'legendary' ? 'animate-pulse' : ''}`}>
                  {c.subtitle}
                </div>
              </motion.div>
            );
          })()}
        </AnimatePresence>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#121212] z-50">
            <div className="flex flex-col items-center">
              <Loader2 className="w-12 h-12 text-[#42a5f5] animate-spin mb-4" />
              <p className="text-[#e3e3e3] text-lg font-medium">Starting Engine...</p>
            </div>
          </div>
        )}
        {/* HUD: single-player-layout = Score+Target vänster, kontroller mitten, bollkö höger; annars = controls vänster, Score+Target+bollkö höger */}
        <div className={`absolute bottom-0 left-0 right-0 z-40 flex flex-row items-end gap-3 pt-1.5 safe-bottom pb-2 sm:pb-6 px-3 sm:px-4 ${useSinglePlayerLayout ? 'justify-between' : ''}`}>
          {useSinglePlayerLayout ? (
            <>
              {/* Vänster: Score + Best – samma utseende som Single Player */}
              <div className="flex flex-col items-start gap-2 shrink-0">
                {level && (
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <div className="bg-emerald-500/10 backdrop-blur-sm px-2.5 py-1.5 rounded-lg border border-emerald-500/20 shadow-lg flex items-center gap-1.5">
                      <Target className="w-3.5 h-3.5 text-emerald-500" />
                      <div>
                        <p className="text-[8px] text-emerald-500 uppercase tracking-tight font-bold">Target</p>
                        <p className="text-xs font-mono font-bold text-white leading-none">{level.targetScore.toLocaleString()}</p>
                      </div>
                    </div>
                    {timeRemaining != null && (
                      <div className="bg-amber-500/10 backdrop-blur-sm px-2.5 py-1.5 rounded-lg border border-amber-500/20 shadow-lg flex items-center gap-1.5">
                        <Zap className="w-3.5 h-3.5 text-amber-500" />
                        <div>
                          <p className="text-[8px] text-amber-500 uppercase tracking-tight font-bold">Time</p>
                          <p className="text-xs font-mono font-bold text-white leading-none">{timeRemaining}s</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="bg-[#1e1e1e]/90 sm:bg-[#1e1e1e] backdrop-blur-sm px-2 py-1.5 rounded-lg border border-[#444746] shadow-lg flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <div className="bg-[#42a5f5]/20 p-1 sm:p-1.5 rounded-full shrink-0">
                    <Trophy className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#42a5f5]" />
                  </div>
                  <div className="flex items-baseline gap-2 sm:gap-2.5 min-w-0">
                    <div>
                      <p className="text-[9px] text-[#c4c7c5] uppercase tracking-tight font-medium">Score</p>
                      <p className="text-xs sm:text-base font-bold text-white tabular-nums">{score.toLocaleString()}</p>
                    </div>
                    <div className="w-px h-4 bg-[#444746]/60 shrink-0" />
                    <div>
                      <p className="text-[9px] text-[#c4c7c5] uppercase tracking-tight font-medium">Best</p>
                      <p className="text-xs sm:text-base font-bold font-mono tabular-nums text-amber-400">{highScore.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
                {level && (
                  <div className="w-full min-w-[80px] max-w-[140px] bg-white/10 h-1 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${Math.min(100, (score / level.targetScore) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
              {/* Mitten: kontroller som Single Player (← / → och SPACE) */}
              <div className="hidden sm:flex shrink-0 items-center gap-6 text-[#757575] text-[10px] font-bold uppercase tracking-widest bg-black/20 px-6 py-2 rounded-full backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <span className="bg-[#333] px-2 py-1 rounded border border-[#444]">← / →</span>
                  <span>Aim</span>
                </div>
                <div className="w-px h-3 bg-[#444]" />
                <div className="flex items-center gap-2">
                  <span className="bg-[#333] px-3 py-1 rounded border border-[#444]">SPACE</span>
                  <span>Fire</span>
                </div>
              </div>
              {/* Höger: bollkö */}
              <div className="bg-[#1e1e1e]/95 px-2 py-2 rounded-xl border border-[#444746]/80 shadow-lg flex items-center gap-2 shrink-0 ml-auto">
                {colorQueue.length === 0 ? (
                  <p className="text-xs text-gray-500">—</p>
                ) : (
                  <div className="flex items-center gap-2 flex-nowrap">
                    {colorQueue.slice(0, COLOR_QUEUE_SIZE).map((ball, i) => {
                      const isCurrent = i === 0;
                      const config = COLOR_CONFIG[ball.color];
                      return (
                        <div
                          key={`${i}-${ball.id}`}
                          className={`relative w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center ${isCurrent ? 'scale-110 ring-2 ring-white/50 z-10' : 'opacity-80 scale-90'}`}
                          style={{
                            background: `radial-gradient(circle at 35% 35%, ${config.hex}, ${adjustColor(config.hex, -60)})`,
                            boxShadow: isCurrent ? `0 0 10px ${config.hex}, inset 0 -2px 2px rgba(0,0,0,0.3)` : '0 1px 3px rgba(0,0,0,0.3), inset 0 -1px 2px rgba(0,0,0,0.2)',
                          }}
                        >
                          {ball.color === 'bomb' && <span className="text-sm leading-none">💣</span>}
                          {(ball.color === 'fire' || ball.isFire) && <span className="text-sm leading-none">🔥</span>}
                          {isCurrent && (
                            <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[7px] font-bold text-white/90 uppercase">Now</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Local PvP: Score + Best vänster (som Single Player), kontroller mitten, bollkö höger */}
              <div className="flex flex-col items-start gap-2 shrink-0">
                <div className="bg-[#1e1e1e]/90 sm:bg-[#1e1e1e] backdrop-blur-sm px-2 py-1.5 rounded-lg border border-[#444746] shadow-lg flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <div className="bg-[#42a5f5]/20 p-1 sm:p-1.5 rounded-full shrink-0">
                    <Trophy className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#42a5f5]" />
                  </div>
                  <div className="flex items-baseline gap-2 sm:gap-2.5 min-w-0">
                    <div>
                      <p className="text-[9px] text-[#c4c7c5] uppercase tracking-tight font-medium">Score</p>
                      <p className="text-xs sm:text-base font-bold text-white tabular-nums">{score.toLocaleString()}</p>
                    </div>
                    <div className="w-px h-4 bg-[#444746]/60 shrink-0" />
                    <div>
                      <p className="text-[9px] text-[#c4c7c5] uppercase tracking-tight font-medium">Best</p>
                      <p className="text-xs sm:text-base font-bold font-mono tabular-nums text-amber-400">{highScore.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="hidden sm:flex shrink-0 items-center gap-6 text-[#757575] text-[10px] font-bold uppercase tracking-widest bg-black/20 px-6 py-2 rounded-full backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <span className="bg-[#333] px-2 py-1 rounded border border-[#444]">{controls.left} / {controls.right}</span>
                  <span>Aim</span>
                </div>
                <div className="w-px h-3 bg-[#444]" />
                <div className="flex items-center gap-2">
                  <span className="bg-[#333] px-3 py-1 rounded border border-[#444]">{controls.fire}</span>
                  <span>Fire</span>
                </div>
              </div>
              <div className="bg-[#1e1e1e]/95 px-2 py-2 rounded-xl border border-[#444746]/80 shadow-lg flex items-center gap-2 shrink-0 ml-auto">
                {colorQueue.length === 0 ? (
                  <p className="text-xs text-gray-500">—</p>
                ) : (
                  <div className="flex items-center gap-2 flex-nowrap">
                    {colorQueue.slice(0, COLOR_QUEUE_SIZE).map((ball, i) => {
                      const isCurrent = i === 0;
                      const config = COLOR_CONFIG[ball.color];
                      return (
                        <div
                          key={`${i}-${ball.id}`}
                          className={`relative w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center ${isCurrent ? 'scale-110 ring-2 ring-white/50 z-10' : 'opacity-80 scale-90'}`}
                          style={{
                            background: `radial-gradient(circle at 35% 35%, ${config.hex}, ${adjustColor(config.hex, -60)})`,
                            boxShadow: isCurrent ? `0 0 10px ${config.hex}, inset 0 -2px 2px rgba(0,0,0,0.3)` : '0 1px 3px rgba(0,0,0,0.3), inset 0 -1px 2px rgba(0,0,0,0.2)',
                          }}
                        >
                          {ball.color === 'bomb' && <span className="text-sm leading-none">💣</span>}
                          {(ball.color === 'fire' || ball.isFire) && <span className="text-sm leading-none">🔥</span>}
                          {isCurrent && (
                            <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[7px] font-bold text-white/90 uppercase">Now</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

GameBoard.displayName = 'GameBoard';

export default GameBoard;

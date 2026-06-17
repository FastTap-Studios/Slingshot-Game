/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Point, Bubble, Particle, BubbleColor, Shockwave, BoardSnapshot } from '../types';
import { Loader2, Trophy, Play, Pause, User, Users, Globe, Copy, Check, Zap, AlertTriangle, Map as MapIcon, Target, X } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import GameBoard, { GameBoardHandle } from './GameBoard';
import LevelMap from './LevelMap';
import SplashScreen from './SplashScreen';
import AdBanner from './AdBanner';
import { Level } from '../types';
import { LEVELS } from '../levels';

type GameMode = 'menu' | 'single' | 'multi' | 'online-setup' | 'online-game' | 'map' | 'level-game';

interface AttackEvent {
  id: number;
  colors: BubbleColor[];
}

const P1_CONTROLS = { left: 'ArrowLeft', right: 'ArrowRight', fire: ' ' };
const P2_CONTROLS = { left: 'd', right: 'a', fire: 'w' };

const SOCKET_PORT = 3000;
/** Socket URL: VITE_SOCKET_URL i prod (Cloudflare). Lokalt: samma host på port 3000. */
function getSocketUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const envUrl = typeof import.meta.env?.VITE_SOCKET_URL === 'string' ? import.meta.env.VITE_SOCKET_URL.trim() : '';
  if (envUrl) return envUrl;
  if (import.meta.env.DEV) {
    return `http://${window.location.hostname}:${SOCKET_PORT}`;
  }
  return undefined;
}

const PINCH_THRESHOLD = 0.05;
const GRAVITY = 0.0; 
const FRICTION = 0.998; 

// Reference dimensions (design size): 12 columns, bubble radius 22
const REFERENCE_WIDTH = 12 * 2 * 22; // 528
const REFERENCE_BUBBLE_RADIUS = 22;
const REFERENCE_SLINGSHOT_OFFSET = 180;
const REFERENCE_WALL_MARKER_WIDTH = 6;
const GRID_COLS = 12;
const GRID_ROWS = 8;
const DEBUG_HEIGHT_MARKERS = false;
const NEW_ROW_INTERVAL_SEC = 10;

// Scale from canvas width so we always get exactly 12 columns
const getScale = (width: number) => width / REFERENCE_WIDTH;
const getBubbleRadius = (width: number) => REFERENCE_BUBBLE_RADIUS * getScale(width);
const getRowHeight = (width: number) => getBubbleRadius(width) * Math.sqrt(3);
const getSlingshotOffset = (width: number) => REFERENCE_SLINGSHOT_OFFSET * getScale(width);
const getWallMarkerWidth = (width: number) => REFERENCE_WALL_MARKER_WIDTH * getScale(width);

const MAX_DRAG_DIST = 180;
const MIN_FORCE_MULT = 0.15;
const MAX_FORCE_MULT = 0.45;

const DEFAULT_ANGLE = Math.PI / 2;
const MIN_ANGLE = (10 * Math.PI) / 180;
const MAX_ANGLE = (170 * Math.PI) / 180;
const CONSTANT_POWER = 120;

// Material Design Colors & Scoring Strategy
const COLOR_CONFIG: Record<BubbleColor, { hex: string, points: number, label: string }> = {
  red:    { hex: '#ef5350', points: 100, label: 'Red' },
  blue:   { hex: '#42a5f5', points: 150, label: 'Blue' },
  green:  { hex: '#66bb6a', points: 200, label: 'Green' },
  yellow: { hex: '#ffee58', points: 250, label: 'Yellow' },
  purple: { hex: '#ab47bc', points: 300, label: 'Purple' },
  orange: { hex: '#ffa726', points: 500, label: 'Orange' },
  rainbow: { hex: '#ffffff', points: 1000, label: 'Rainbow' },
  bomb:   { hex: '#37474f', points: 800, label: 'Bomb' },
  fire:   { hex: '#ff5722', points: 1200, label: 'Fire' },
};

const COLOR_KEYS: BubbleColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];
const SPECIAL_KEYS: BubbleColor[] = ['bomb', 'fire'];

const COLOR_QUEUE_SIZE = 3;
const FIRE_COOLDOWN = 25;   // min bollar mellan varje flammboll
const FIRE_CHANCE = 0.005;  // 0.5% chans när cooldown är uppfylld
const BOMB_CHANCE = 0.015;  // 1.5% chans för bomb // Number of balls visible (current + next 2) – compact

type QueueBall = { id: number; color: BubbleColor; isFire?: boolean };

const adjustColor = (color: string, amount: number) => {
    const hex = color.replace('#', '');
    const r = Math.max(0, Math.min(255, parseInt(hex.substring(0, 2), 16) + amount));
    const g = Math.max(0, Math.min(255, parseInt(hex.substring(2, 4), 16) + amount));
    const b = Math.max(0, Math.min(255, parseInt(hex.substring(4, 6), 16) + amount));
    
    const componentToHex = (c: number) => {
        const hex = c.toString(16);
        return hex.length === 1 ? "0" + hex : hex;
    };
    
    return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
};

// --- Audio Engine (from example with sound effects) ---
const audioCtx =
  typeof window !== 'undefined'
    ? new (window.AudioContext || (window as any).webkitAudioContext)()
    : null;

const playTone = (
  freq: number,
  type: OscillatorType,
  duration: number,
  volume: number
) => {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    0.01,
    audioCtx.currentTime + duration
  );

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
  gameOver: () => {
    playTone(200, 'sawtooth', 0.3, 0.3);
    setTimeout(() => playTone(150, 'sawtooth', 0.3, 0.3), 150);
    setTimeout(() => playTone(100, 'sawtooth', 0.5, 0.3), 300);
  },
};

const GeminiSlingshot: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameContainerRef = useRef<HTMLDivElement>(null);
  
  // Game State Refs
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
  const touchStartX = useRef<number>(0);
  const touchStartAngle = useRef<number>(0);
  
  // Button Control State
  const angleRef = useRef(DEFAULT_ANGLE);
  const powerRef = useRef(CONSTANT_POWER);

  // Current active color (Ref for loop, State for UI)
  const selectedColorRef = useRef<BubbleColor>('red');
  
  // React State
  const [loading, setLoading] = useState(true);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [selectedColor, setSelectedColor] = useState<BubbleColor>('red');
  const [availableColors, setAvailableColors] = useState<BubbleColor[]>([]);
  const [colorQueue, setColorQueue] = useState<QueueBall[]>([]); // [current, next, ...] each with unique id for animation
  const [combo, setCombo] = useState<{ count: number; x: number; y: number } | null>(null);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [mode, setMode] = useState<GameMode>('menu');
  const [selectedLevel, setSelectedLevel] = useState<Level | null>(null);
  const [levelProgress, setLevelProgress] = useState<Level[]>(() => {
    try {
      const saved = localStorage.getItem('slingshot_galaxy_levels');
      if (!saved) return LEVELS;
      const parsed: Level[] = JSON.parse(saved);
      return LEVELS.map(defaultLevel => {
        const s = parsed.find(p => p.id === defaultLevel.id);
        if (s) {
          // Endast progress från sparad data – nivådefinition (targetScore, timeLimit, etc.) kommer alltid från LEVELS
          return { ...defaultLevel, unlocked: s.unlocked, completed: s.completed, stars: s.stars };
        }
        return defaultLevel;
      });
    } catch {
      return LEVELS;
    }
  });
  const [p1Attack, setP1Attack] = useState<AttackEvent | undefined>();
  const [p2Attack, setP2Attack] = useState<AttackEvent | undefined>();
  const [multiGameOverPlayer, setMultiGameOverPlayer] = useState<1 | 2 | null>(null);
  const p1BoardRef = useRef<GameBoardHandle>(null);
  const p2BoardRef = useRef<GameBoardHandle>(null);
  const [roomId, setRoomId] = useState<string>('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<number>(1);
  const [isWaiting, setIsWaiting] = useState<boolean>(true);
  const [isMatchmaking, setIsMatchmaking] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [opponentScore, setOpponentScore] = useState<number | null>(null);
  const opponentStateRef = useRef<BoardSnapshot | null>(null);
  const [opponentAttack, setOpponentAttack] = useState<AttackEvent | undefined>();
  const [opponentGameOver, setOpponentGameOver] = useState<boolean>(false);
  const [opponentLeft, setOpponentLeft] = useState<boolean>(false);
  const [onlineSelfGameOver, setOnlineSelfGameOver] = useState<boolean>(false);
  const [rematchRequested, setRematchRequested] = useState<boolean>(false);
  const [opponentRequestedRematch, setOpponentRequestedRematch] = useState<boolean>(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const pendingOnlineActionRef = useRef<'find-match' | { type: 'join-room'; roomId: string } | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const roomIdRef = useRef<string>('');
  const myOnlineBoardRef = useRef<GameBoardHandle>(null);
  const nextQueueIdRef = useRef(0);
  const ballsSinceLastFireRef = useRef(FIRE_COOLDOWN);
  const lastRowAddTimeRef = useRef(0);
  const canvasWidthRef = useRef(0);
  const gridOffsetRef = useRef(0);
  const isGameOverRef = useRef(false);
  const dropFloatingBubblesRef = useRef<() => number>(() => 0);
  const isPausedRef = useRef(false);
  const highScoreRef = useRef(0);
  const bubbleRadiusRef = useRef(REFERENCE_BUBBLE_RADIUS);
  const rowHeightRef = useRef(REFERENCE_BUBBLE_RADIUS * Math.sqrt(3));
  const slingshotOffsetRef = useRef(REFERENCE_SLINGSHOT_OFFSET);

  useEffect(() => {
    const saved = localStorage.getItem('gemini_slingshot_highscore');
    if (saved) setHighScore(parseInt(saved, 10));
  }, []);

  useEffect(() => {
    isGameOverRef.current = isGameOver;
  }, [isGameOver]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);
  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    if (mode !== 'online-setup' && mode !== 'online-game') return;
    const s = socket ?? (() => {
      const url = getSocketUrl();
      const n = url ? io(url, { withCredentials: false, transports: ['websocket'] }) : io({ transports: ['websocket'] });
      setSocket(n);
      return n;
    })();
    s.on('player-assignment', (id: number) => setMyPlayerId(id));
    s.on('game-start', (data?: { roomId: string }) => {
      if (data?.roomId) setRoomId(data.roomId);
      setIsWaiting(false);
      setOpponentAttack(undefined);
      opponentStateRef.current = null;
      setOpponentScore(null);
      setOpponentGameOver(false);
      setOnlineSelfGameOver(false);
      setRematchRequested(false);
      setOpponentRequestedRematch(false);
      setMode('online-game');
    });
    s.on('waiting-for-match', () => setIsMatchmaking(true));
    s.on('receive-attack', (attack: AttackEvent) => setOpponentAttack(attack));
    s.on('opponent-game-over', (playerIdWhoLost: number) => {
      setOpponentGameOver(playerIdWhoLost !== myPlayerId);
    });
    s.on('opponent-state', (state: BoardSnapshot) => {
      opponentStateRef.current = state;
      setOpponentScore((prev) => (prev === state.score ? prev : state.score));
    });
    s.on('opponent-left', () => {
      setOpponentLeft(true);
      setOpponentGameOver(true);
    });
    s.on('connect', () => setSocketError(null));
    s.on('connect_error', () => setSocketError('Could not connect. Run "npm run server" on the computer and open the game from this device using the computer\'s IP (e.g. http://192.168.x.x:5173).'));
    const sendPending = () => {
      const pending = pendingOnlineActionRef.current;
      if (!pending) return;
      pendingOnlineActionRef.current = null;
      if (pending === 'find-match') s.emit('find-match');
      else s.emit('join-room', pending.roomId);
    };
    if (s.connected) sendPending();
    else s.once('connect', sendPending);
    return () => {
      s.off('player-assignment')
        .off('game-start')
        .off('waiting-for-match')
        .off('receive-attack')
        .off('opponent-game-over')
        .off('opponent-state')
        .off('opponent-left')
        .off('connect')
        .off('connect_error');
    };
  }, [mode, myPlayerId, socket]);

  useEffect(() => {
    try {
      localStorage.setItem('slingshot_galaxy_levels', JSON.stringify(levelProgress));
    } catch {
      // ignore
    }
  }, [levelProgress]);

  useEffect(() => {
    if (!socket || (mode !== 'online-setup' && mode !== 'online-game')) return;
    const s = socket;
    const onRematchStart = () => {
      setOpponentAttack(undefined);
      opponentStateRef.current = null;
      setOpponentScore(null);
      setOpponentGameOver(false);
      setOnlineSelfGameOver(false);
      setRematchRequested(false);
      setOpponentRequestedRematch(false);
      setTimeout(() => myOnlineBoardRef.current?.resetGame(), 0);
    };
    const onOpponentRequestedRematch = () => setOpponentRequestedRematch(true);
    s.on('rematch-start', onRematchStart);
    s.on('opponent-requested-rematch', onOpponentRequestedRematch);
    return () => {
      s.off('rematch-start', onRematchStart);
      s.off('opponent-requested-rematch', onOpponentRequestedRematch);
    };
  }, [socket, mode]);

  useEffect(() => {
    if (mode === 'online-setup' || mode === 'online-game') return;
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }
    opponentStateRef.current = null;
    setOpponentScore(null);
  }, [mode, socket]);

  const handleSyncSnapshot = useCallback(
    (state: BoardSnapshot) => {
      if (!socket || !roomId) return;
      socket.volatile.emit('sync-state', { roomId, state });
    },
    [socket, roomId]
  );

  const handleGameOver = useCallback(() => {
    if (!socket || !roomId) return;
    setOnlineSelfGameOver(true);
    socket.emit('game-over', { roomId, playerId: myPlayerId });
  }, [socket, roomId, myPlayerId]);

  const handleOnlineCombo = useCallback(
    (count: number) => {
      if (!socket || !roomId) return;
      const sendCount = count === 3 ? 1 : count === 4 ? 2 : Math.max(1, Math.floor(count * 0.75));
      const colors: BubbleColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];
      const attack: AttackEvent = { id: Date.now(), colors: Array.from({ length: sendCount }, () => colors[Math.floor(Math.random() * colors.length)]) };
      socket.emit('send-attack', { roomId, attack });
    },
    [socket, roomId]
  );

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleP1Combo = useCallback((count: number) => {
    const sendCount = count === 3 ? 1 : count === 4 ? 2 : Math.max(1, Math.floor(count * 0.75));
    const colors: BubbleColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];
    setP2Attack({ id: Date.now(), colors: Array.from({ length: sendCount }, () => colors[Math.floor(Math.random() * colors.length)]) });
  }, []);

  const handleP2Combo = useCallback((count: number) => {
    const sendCount = count === 3 ? 1 : count === 4 ? 2 : Math.max(1, Math.floor(count * 0.75));
    const colors: BubbleColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];
    setP1Attack({ id: Date.now(), colors: Array.from({ length: sendCount }, () => colors[Math.floor(Math.random() * colors.length)]) });
  }, []);

  useEffect(() => {
    highScoreRef.current = highScore;
  }, [highScore]);

  // Sync state to ref
  useEffect(() => {
    selectedColorRef.current = selectedColor;
  }, [selectedColor]);

  // Keep "current" color in sync with head of queue
  useEffect(() => {
    if (colorQueue.length > 0) {
      setSelectedColor(colorQueue[0].color);
      selectedColorRef.current = colorQueue[0].color;
      currentBallIsFireRef.current = colorQueue[0].isFire ?? false;
    }
  }, [colorQueue]);
  
  const getBubblePos = useCallback((row: number, col: number, width: number) => {
    const R = getBubbleRadius(width);
    const rowH = getRowHeight(width);
    const xOffset = (width - (GRID_COLS * R * 2)) / 2 + R;
    const isStaggered = (row + gridOffsetRef.current) % 2 !== 0;
    const x = xOffset + col * (R * 2) + (isStaggered ? R : 0);
    const y = R + row * rowH;
    return { x, y };
  }, []);

  const pickQueueBall = useCallback((available: BubbleColor[]): QueueBall => {
    if (available.length === 0) return { id: nextQueueIdRef.current++, color: COLOR_KEYS[0] };
    if (Math.random() < BOMB_CHANCE) {
      ballsSinceLastFireRef.current += 1;
      return { id: nextQueueIdRef.current++, color: 'bomb' };
    }
    if (ballsSinceLastFireRef.current >= FIRE_COOLDOWN && Math.random() < FIRE_CHANCE) {
      ballsSinceLastFireRef.current = 0;
      return { id: nextQueueIdRef.current++, color: COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)], isFire: true };
    }
    ballsSinceLastFireRef.current += 1;
    return { id: nextQueueIdRef.current++, color: available[Math.floor(Math.random() * available.length)] };
  }, []);

  const updateAvailableColors = useCallback(() => {
    const activeColors = new Set<BubbleColor>();
    bubbles.current.forEach(b => {
        if (b.active) activeColors.add(b.color);
    });
    const available = Array.from(activeColors);
    setAvailableColors(available);

    if (available.length === 0) {
      setColorQueue([]);
      return;
    }

    setColorQueue(prev => {
      if (prev.length > 0) return prev;
      const newQueue: QueueBall[] = [];
      for (let i = 0; i < COLOR_QUEUE_SIZE; i++) {
        newQueue.push(pickQueueBall(available));
      }
      return newQueue;
    });
  }, [pickQueueBall]);

  const initGrid = useCallback((width: number) => {
    gridOffsetRef.current = 0;
    const newBubbles: Bubble[] = [];
    const isMobile = width < REFERENCE_WIDTH;
    const initialRows = 6;
    for (let r = 0; r < initialRows; r++) { 
      for (let c = 0; c < ((r + gridOffsetRef.current) % 2 !== 0 ? GRID_COLS - 1 : GRID_COLS); c++) {
        if (Math.random() > 0.1) {
            const { x, y } = getBubblePos(r, c, width);
            const isSpecial = Math.random() < 0.02;
            let color: BubbleColor;
            let type: Bubble['type'] | undefined;
            if (isSpecial) {
              const special = SPECIAL_KEYS[Math.floor(Math.random() * SPECIAL_KEYS.length)];
              if (special === 'bomb') {
                color = 'bomb';
              } else {
                color = COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
                type = 'fire';
              }
            } else {
              color = COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
            }
            newBubbles.push({
              id: `${r}-${c}`,
              row: r,
              col: c,
              x,
              y,
              color,
              type,
              active: true
            });
        }
      }
    }
    bubbles.current = newBubbles;
    updateAvailableColors();
  }, [getBubblePos, updateAvailableColors]);

  const addRowFromTop = useCallback((width: number) => {
    gridOffsetRef.current = (gridOffsetRef.current + 1) % 2;
    type WithOrigCol = Bubble & { _origCol: number };
    const shifted: WithOrigCol[] = bubbles.current.map(b => {
      const newRow = b.row + 1;
      const isOddNew = (newRow + gridOffsetRef.current) % 2 !== 0;
      const colsInNewRow = isOddNew ? GRID_COLS - 1 : GRID_COLS;
      const newCol = b.col < colsInNewRow ? b.col : colsInNewRow - 1;
      return { ...b, row: newRow, col: newCol, _origCol: b.col };
    });
    shifted.sort((a, b) => a.row - b.row || a.col - b.col || a._origCol - b._origCol);
    const seen = new Set<string>();
    const existing: Bubble[] = shifted.filter(b => {
      const key = `${b.row}-${b.col}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(({ _origCol, ...b }) => b);
    const isStaggeredRow0 = (0 + gridOffsetRef.current) % 2 !== 0;
    const colsRow0 = isStaggeredRow0 ? GRID_COLS - 1 : GRID_COLS;
    const newBubbles: Bubble[] = [];
    for (let c = 0; c < colsRow0; c++) {
      if (Math.random() > 0.15) {
        const { x } = getBubblePos(0, c, width);
        const isSpecial = Math.random() < 0.03;
        let color: BubbleColor;
        let type: Bubble['type'] | undefined;
        if (isSpecial) {
          const special = SPECIAL_KEYS[Math.floor(Math.random() * SPECIAL_KEYS.length)];
          if (special === 'bomb') {
            color = 'bomb';
          } else {
            color = COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
            type = 'fire';
          }
        } else {
          color = COLOR_KEYS[Math.floor(Math.random() * COLOR_KEYS.length)];
        }
        newBubbles.push({
          id: `0-${c}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          row: 0,
          col: c,
          x,
          y: -getRowHeight(width), // Start above the screen for slide-in animation
          color,
          type,
          active: true
        });
      }
    }
    bubbles.current = [...existing, ...newBubbles];

    // Game over check runs every frame in the render loop instead (immediate trigger at green line)
    updateAvailableColors();
  }, [getBubblePos, updateAvailableColors, initGrid]);

  const createExplosion = useCallback((x: number, y: number, color: string, intensity = 1) => {
    const count = 15 * intensity;
    for (let i = 0; i < count; i++) {
      particles.current.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 12 * intensity,
        vy: (Math.random() - 0.5) * 12 * intensity,
        life: 1.0,
        color
      });
    }
  }, []);

  const createShockwave = useCallback((x: number, y: number, color: string) => {
    shockwaves.current.push({
      x,
      y,
      radius: 0,
      maxRadius: 120,
      life: 1.0,
      color,
    });
  }, []);

  const resetGame = () => {
    if (!canvasRef.current) return;
    scoreRef.current = 0;
    setScore(0);
    setIsGameOver(false);
    setIsPaused(false);
    initGrid(canvasRef.current.width);
    ballPos.current = { ...anchorPos.current };
    ballVel.current = { x: 0, y: 0 };
    isFlying.current = false;
  };

  const isPathClear = useCallback((target: Bubble) => {
    if (!anchorPos.current) return false;
    const startX = anchorPos.current.x;
    const startY = anchorPos.current.y;
    const endX = target.x;
    const endY = target.y;

    const dx = endX - startX;
    const dy = endY - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const R = bubbleRadiusRef.current;
    const steps = Math.ceil(distance / (R / 2)); 

    for (let i = 1; i < steps - 2; i++) { 
        const t = i / steps;
        const cx = startX + dx * t;
        const cy = startY + dy * t;

        for (const b of bubbles.current) {
            if (!b.active || b.id === target.id) continue;
            const distSq = Math.pow(cx - b.x, 2) + Math.pow(cy - b.y, 2);
            if (distSq < Math.pow(R * 1.8, 2)) {
                return false; 
            }
        }
    }
    return true;
  }, []);

  const isNeighbor = useCallback((a: Bubble, b: Bubble) => {
    const dr = b.row - a.row;
    const dc = b.col - a.col;
    if (Math.abs(dr) > 1) return false;
    if (dr === 0) return Math.abs(dc) === 1;
    const aIsStaggered = (a.row + gridOffsetRef.current) % 2 !== 0;
    if (aIsStaggered) {
        return dc === 0 || dc === 1;
    } else {
        return dc === -1 || dc === 0;
    }
  }, []);

  const popBubble = useCallback((bubble: Bubble, processed = new Set<string>()): number => {
    if (!bubble.active || processed.has(bubble.id)) return 0;
    processed.add(bubble.id);

    bubble.active = false;
    bubble.isFalling = true;
    bubble.vx = (Math.random() - 0.5) * 6;
    bubble.vy = -Math.random() * 8 - 4; // Initial jump up

    const isBomb = bubble.color === 'bomb';
    const isFire = bubble.type === 'fire';
    createExplosion(
      bubble.x,
      bubble.y,
      COLOR_CONFIG[bubble.color].hex,
      isBomb || isFire ? 3 : 1
    );
    scoreRef.current += COLOR_CONFIG[bubble.color].points;

    let count = 1;
    if (bubble.color === 'bomb') {
      sounds.match();
      createShockwave(bubble.x, bubble.y, '#ff9800');
      const bombNeighbors = bubbles.current.filter(
        b => b.active && isNeighbor(bubble, b)
      );
      bombNeighbors.forEach(n => {
        count += popBubble(n, processed);
      });
    } else if (bubble.type === 'fire') {
      sounds.match();
      createShockwave(bubble.x, bubble.y, '#ff5722');
      const neighbors1 = bubbles.current.filter(
        b => b.active && isNeighbor(bubble, b)
      );
      neighbors1.forEach(n => {
        count += popBubble(n, processed);
      });
      const neighbors2: Bubble[] = [];
      bubbles.current.forEach(b => {
        if (!b.active || b.isBurning || processed.has(b.id)) return;
        const isDist2 = neighbors1.some(n1 => isNeighbor(n1, b));
        if (isDist2 && b.id !== bubble.id) neighbors2.push(b);
      });
      neighbors2.forEach(n => {
        n.isBurning = true;
        setTimeout(() => {
          if (n.active) popBubble(n);
          setScore(scoreRef.current);
          dropFloatingBubblesRef.current?.();
        }, 2000);
      });
    }
    return count;
  }, [createExplosion, isNeighbor]);

  const dropFloatingBubbles = useCallback((): number => {
    const activeBubbles = bubbles.current.filter(b => b.active);
    if (activeBubbles.length === 0) return 0;

    const connectedToTop = new Set<string>();
    const queue = activeBubbles.filter(b => b.row === 0);
    queue.forEach(b => connectedToTop.add(b.id));

    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      const neighbors = bubbles.current.filter(
        b =>
          b.active &&
          !connectedToTop.has(b.id) &&
          isNeighbor(current, b)
      );
      for (const n of neighbors) {
        connectedToTop.add(n.id);
        queue.push(n);
      }
    }

    const floating = activeBubbles.filter(b => !connectedToTop.has(b.id));
    if (floating.length > 0) {
      floating.forEach(b => popBubble(b));
    }
    return floating.length;
  }, [popBubble, isNeighbor]);

  useEffect(() => {
    dropFloatingBubblesRef.current = dropFloatingBubbles;
  }, [dropFloatingBubbles]);

  const checkMatches = useCallback((startBubble: Bubble) => {
    if (isGameOver) return false;
    // Bomb: trigger pop on bomb + neighbors, then drop floating
    const neighbors = bubbles.current.filter(
      b => b.active && isNeighbor(startBubble, b)
    );
    const bombSource =
      startBubble.color === 'bomb'
        ? startBubble
        : neighbors.find(n => n.color === 'bomb');

    if (bombSource) {
      let totalPopped = popBubble(bombSource);
      if (startBubble.active) totalPopped += popBubble(startBubble);
      totalPopped += dropFloatingBubbles();
      setScore(scoreRef.current);
      if (totalPopped > 5) {
        setCombo({ count: totalPopped, x: startBubble.x, y: startBubble.y });
        setTimeout(() => setCombo(null), 1500);
      }
      return true;
    }

    // Regular color cluster matching (fire balls match by their color like normal)
    const toCheck = [startBubble];
    const visited = new Set<string>();
    const matches: Bubble[] = [];
    const targetColor = startBubble.color;

    while (toCheck.length > 0) {
      const current = toCheck.pop()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);

      if (current.color === targetColor) {
        matches.push(current);
        const sameColorNeighbors = bubbles.current.filter(
          b =>
            b.active &&
            !visited.has(b.id) &&
            isNeighbor(current, b)
        );
        toCheck.push(...sameColorNeighbors);
      }
    }

    if (matches.length >= 3) {
      sounds.match();
      matches.forEach(b => popBubble(b));
      const dropped = dropFloatingBubbles();
      const totalPopped = matches.length + dropped;
      if (totalPopped > 5) {
        setCombo({ count: totalPopped, x: startBubble.x, y: startBubble.y });
        setTimeout(() => setCombo(null), 1500);
      }
      const multiplier = matches.length > 3 ? 1.5 : 1.0;
      const baseSum = matches.reduce(
        (acc, b) => acc + COLOR_CONFIG[b.color].points,
        0
      );
      scoreRef.current += Math.floor((multiplier - 1) * baseSum);
      setScore(scoreRef.current);
      return true;
    }
    return false;
  }, [popBubble, dropFloatingBubbles, isNeighbor, isGameOver]);

  // --- Rendering Helper ---
  const drawBubble = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, colorKey: BubbleColor, bubbleType?: Bubble['type'], isBurning?: boolean) => {
    const useFlame = bubbleType === 'fire' || colorKey === 'fire' || isBurning;
    const config = COLOR_CONFIG[colorKey];
    const baseColor = config?.hex ?? '#ff5722';
    
    const grad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
    if (useFlame && (bubbleType === 'fire' || isBurning) && colorKey !== 'fire') {
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
    } else {
      ctx.strokeStyle = adjustColor(baseColor, -80);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    
    // Secondary "Glossy" Highlight (Hard reflection)
    ctx.beginPath();
    ctx.ellipse(x - radius * 0.3, y - radius * 0.35, radius * 0.25, radius * 0.15, Math.PI / 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fill();
  };

  const handleFire = useCallback(() => {
    if (isFlying.current) return;

    sounds.shoot();

    const w = canvasWidthRef.current || REFERENCE_WIDTH;
    const scale = getScale(w);
    const power = CONSTANT_POWER * scale;
    const dx = -Math.cos(angleRef.current) * power;
    const dy = -Math.sin(angleRef.current) * power;
    const stretchDist = power;

    isFlying.current = true;
    flightStartTime.current = performance.now();
    const maxDrag = MAX_DRAG_DIST * scale;
    const powerRatio = Math.min(stretchDist / maxDrag, 1.0);
    const velocityMultiplier = MIN_FORCE_MULT + (MAX_FORCE_MULT - MIN_FORCE_MULT) * (powerRatio * powerRatio);

    ballVel.current = {
        x: dx * velocityMultiplier,
        y: dy * velocityMultiplier
    };

    flyingBallColorRef.current = selectedColorRef.current;
    flyingBallIsFireRef.current = currentBallIsFireRef.current;

    const activeColors = new Set<BubbleColor>();
    bubbles.current.forEach(b => {
      if (b.active) activeColors.add(b.color);
    });
    const available = Array.from(activeColors);

    setColorQueue(prev => {
      const next = prev.slice(1) as QueueBall[];
      if (available.length > 0) {
        next.push(pickQueueBall(available));
      }
      return next;
    });
    updateAvailableColors();
  }, [updateAvailableColors, pickQueueBall]);

  // Keyboard Controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed.current.add(e.key);
      if (e.key === ' ') {
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
  }, [handleFire]);

  const TOUCH_ANGLE_SENSITIVITY = 0.008;
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartX.current = e.touches[0].clientX;
      touchStartAngle.current = angleRef.current;
    }
  }, []);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1 && !isFlying.current) {
      const dx = e.touches[0].clientX - touchStartX.current;
      angleRef.current = Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, touchStartAngle.current + dx * TOUCH_ANGLE_SENSITIVITY));
    }
  }, []);
  const handleTouchEnd = useCallback(() => {
    handleFire();
  }, [handleFire]);

  // --- Main Game Loop ---

  useEffect(() => {
    if (mode !== 'single' || !canvasRef.current || !gameContainerRef.current) return;

    const canvas = canvasRef.current;
    const container = gameContainerRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    // Set initial size from actual rendered container (matches viewport on mobile)
    const initialRect = container.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(initialRect.width));
    canvas.height = Math.max(1, Math.floor(initialRect.height));

    bubbleRadiusRef.current = getBubbleRadius(canvas.width);
    rowHeightRef.current = getRowHeight(canvas.width);
    slingshotOffsetRef.current = getSlingshotOffset(canvas.width);
    anchorPos.current = { x: canvas.width / 2, y: canvas.height - slingshotOffsetRef.current };
    ballPos.current = { ...anchorPos.current };
    canvasWidthRef.current = canvas.width;
    initGrid(canvas.width);
    lastRowAddTimeRef.current = performance.now();

    let animationFrameId: number;
    let lastTime = performance.now();

    const BUBBLE_LERP = 0.12;

    const render = (currentTime: number) => {
      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;
      canvasWidthRef.current = canvas.width;
      bubbleRadiusRef.current = getBubbleRadius(canvas.width);
      rowHeightRef.current = getRowHeight(canvas.width);
      slingshotOffsetRef.current = getSlingshotOffset(canvas.width);

      // Paus: hoppa över all spelogik men fortsätt rita
      if (!isPausedRef.current) {
      // Game over: trigger immediately when any bubble touches the slingshot line (every frame)
      if (!isGameOverRef.current && anchorPos.current) {
        const slingshotLineY = anchorPos.current.y;
        const rowH = rowHeightRef.current;
        const R = bubbleRadiusRef.current;
        // Trigger en radhöjd ovanför slangbellan
        const triggerY = slingshotLineY - rowH;
        const gameOver = bubbles.current.some(
          b => b.active && b.y + R >= triggerY
        );
        if (gameOver) {
          sounds.gameOver();
          setIsGameOver(true);
          if (scoreRef.current > highScoreRef.current) {
            highScoreRef.current = scoreRef.current;
            setHighScore(scoreRef.current);
            localStorage.setItem(
              'gemini_slingshot_highscore',
              scoreRef.current.toString()
            );
          }
        }
      }

      // Add new row from top every N seconds (only while game is running)
      if (!isGameOverRef.current) {
        if (currentTime - lastRowAddTimeRef.current >= NEW_ROW_INTERVAL_SEC * 1000) {
          lastRowAddTimeRef.current = currentTime;
          addRowFromTop(canvas.width);
        }
      }

      // Smooth Aiming (Frame-rate independent, frozen on game over)
      if (!isGameOverRef.current && !isFlying.current) {
        const rotationSpeed = 0.003; // Slightly faster for better feel
        if (keysPressed.current.has('ArrowLeft')) {
          angleRef.current -= rotationSpeed * deltaTime;
        }
        if (keysPressed.current.has('ArrowRight')) {
          angleRef.current += rotationSpeed * deltaTime;
        }
        
        // Clamp angle between 10 and 170 degrees
        angleRef.current = Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, angleRef.current));
      }

      } // end !isPausedRef.current (game logic)

      // Responsive Resize: use actual rendered size so mobile view matches viewport edges
      const rect = container.getBoundingClientRect();
      const renderW = Math.max(1, Math.floor(rect.width));
      const renderH = Math.max(1, Math.floor(rect.height));
      if (canvas.width !== renderW || canvas.height !== renderH) {
        canvas.width = renderW;
        canvas.height = renderH;
        canvasWidthRef.current = canvas.width;
        bubbleRadiusRef.current = getBubbleRadius(canvas.width);
        rowHeightRef.current = getRowHeight(canvas.width);
        slingshotOffsetRef.current = getSlingshotOffset(canvas.width);
        anchorPos.current = { x: canvas.width / 2, y: canvas.height - slingshotOffsetRef.current };
        if (!isFlying.current) {
          ballPos.current = { ...anchorPos.current };
        }
        // Recompute all bubble positions for new canvas size so grid stays aligned
        bubbles.current = bubbles.current.map(b => ({
          ...b,
          ...getBubblePos(b.row, b.col, canvas.width)
        }));
      }

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#121212';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const R = bubbleRadiusRef.current;
      const gridWidth = GRID_COLS * R * 2;
      const xOffset = (canvas.width - gridWidth) / 2 + R;
      const gridLeft = xOffset - R;
      const gridRight = xOffset + gridWidth - R;
      const isMobileView = canvas.width < REFERENCE_WIDTH;
      
      const bgLeft = isMobileView ? gridLeft : 0;
      const bgWidth = isMobileView ? gridWidth : canvas.width;
      const bgGrad = ctx.createLinearGradient(bgLeft, 0, bgLeft, canvas.height);
      bgGrad.addColorStop(0, '#1a1a1a');
      bgGrad.addColorStop(1, '#0d0d0d');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(bgLeft, 0, bgWidth, canvas.height);

      // Side wall markers (placement zone where shot balls land) — hidden on mobile (edges = screen)
      if (!isMobileView) {
        const wallW = getWallMarkerWidth(canvas.width);
        const wallInner = 'rgba(66, 165, 245, 0.5)';
        const wallOuter = 'rgba(66, 165, 245, 0.85)';
        ctx.fillStyle = wallInner;
        ctx.fillRect(gridLeft, 0, wallW, canvas.height);
        ctx.fillRect(gridRight - wallW, 0, wallW, canvas.height);
        ctx.fillStyle = wallOuter;
        ctx.fillRect(gridLeft, 0, 2, canvas.height);
        ctx.fillRect(gridRight - 2, 0, 2, canvas.height);
      }

      // --- SLINGSHOT LOGIC --- (pausad när isPausedRef)
      if (!isPausedRef.current && !isGameOverRef.current && !isFlying.current) {
        const power = CONSTANT_POWER * getScale(canvas.width);
        const targetX = anchorPos.current.x + Math.cos(angleRef.current) * power;
        const targetY = anchorPos.current.y + Math.sin(angleRef.current) * power;
        
        // Smooth transition to target position
        ballPos.current.x += (targetX - ballPos.current.x) * 0.2;
        ballPos.current.y += (targetY - ballPos.current.y) * 0.2;
      }

      // --- Physics --- (pausad när isPausedRef)
      if (!isPausedRef.current && !isGameOverRef.current && isFlying.current) {
        // Infinite bounce safeguard: if flying for more than 5 seconds (5000ms), cancel shot
        if (performance.now() - flightStartTime.current > 5000) {
            isFlying.current = false;
            ballPos.current = { ...anchorPos.current };
            ballVel.current = { x: 0, y: 0 };
        } else {
            const currentSpeed = Math.sqrt(ballVel.current.x ** 2 + ballVel.current.y ** 2);
            const R = bubbleRadiusRef.current;
            const steps = Math.ceil(currentSpeed / (R * 0.8)); 
            let collisionOccurred = false;

            const gridW = GRID_COLS * R * 2;
            const xOff = (canvas.width - gridW) / 2 + R;
            const leftWallX = xOff - R + R;
            const rightWallX = xOff + gridW - R - R;

            for (let i = 0; i < steps; i++) {
                ballPos.current.x += ballVel.current.x / steps;
                ballPos.current.y += ballVel.current.y / steps;
                
                if (ballPos.current.x < leftWallX) {
                    ballVel.current.x *= -1;
                    ballPos.current.x = leftWallX;
                }
                if (ballPos.current.x > rightWallX) {
                    ballVel.current.x *= -1;
                    ballPos.current.x = rightWallX;
                }

                if (ballPos.current.y < R) {
                    collisionOccurred = true;
                    break;
                }

                for (const b of bubbles.current) {
                    if (!b.active) continue;
                    const dist = Math.sqrt(
                        Math.pow(ballPos.current.x - b.x, 2) + 
                        Math.pow(ballPos.current.y - b.y, 2)
                    );
                    if (dist < R * 1.8) { 
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

                const maxLogicalRows = Math.ceil(canvas.height / rowHeightRef.current) + 5; // allow placement as deep as visible play area
                for (let r = 0; r < maxLogicalRows; r++) {
                    const colsInRow = (r + gridOffsetRef.current) % 2 !== 0 ? GRID_COLS - 1 : GRID_COLS;
                    for (let c = 0; c < colsInRow; c++) {
                        const { x, y } = getBubblePos(r, c, canvas.width);
                        const occupied = bubbles.current.some(
                          b =>
                            (b.active || b.isFalling) &&
                            b.row === r &&
                            b.col === c
                        );
                        if (occupied) continue;

                        const dist = Math.sqrt(
                            Math.pow(ballPos.current.x - x, 2) + 
                            Math.pow(ballPos.current.y - y, 2)
                        );
                        
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
                    type: isFireShot ? 'fire' : undefined,
                    active: true
                };
                bubbles.current.push(newBubble);
                checkMatches(newBubble);
                updateAvailableColors(); 
                
                // Reset shot
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

      // --- Drawing ---
      
      // Draw Grid Bubbles: uppdatera fallande bara när inte pausad
      if (!isGameOverRef.current) {
        bubbles.current.forEach(b => {
          if (b.isFalling && !isPausedRef.current) {
            b.vx = b.vx ?? 0;
            b.vy = (b.vy ?? 0) + 0.6;
            b.x += b.vx;
            b.y += b.vy;
            ctx.save();
            const fade = Math.max(
              0,
              1 - (b.y - canvas.height * 0.5) / (canvas.height * 0.5)
            );
            ctx.globalAlpha = fade;
          drawBubble(ctx, b.x, b.y, R - 1, b.color, b.type, b.isBurning);
          ctx.restore();
          return;
        }
        if (!b.active) return;
        const target = getBubblePos(b.row, b.col, canvas.width);
        b.x += (target.x - b.x) * BUBBLE_LERP;
        b.y += (target.y - b.y) * BUBBLE_LERP;
        drawBubble(ctx, b.x, b.y, R - 1, b.color, b.type, b.isBurning);
      });

        bubbles.current = bubbles.current.filter(
          b => b.active || (b.isFalling && b.y < canvas.height + 50)
        );
      } else {
        // On game over, just draw bubbles at their last positions
        bubbles.current.forEach(b => {
          if (!b.active) return;
          drawBubble(ctx, b.x, b.y, R - 1, b.color, b.type, b.isBurning);
        });
      }

      // --- Trajectory Line (Previously Commented Out) ---
      // Logic removed per request to clean up file, but previously existed here.

      // --- Game over trigger zone (synlig linje en rad ovanför slangbellan) ---
      const triggerY = anchorPos.current.y - rowHeightRef.current;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 80, 80, 0.9)';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(gridLeft, triggerY);
      ctx.lineTo(gridRight, triggerY);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 70, 70, 0.95)';
      ctx.font = 'bold 11px Inter';
      ctx.textAlign = 'right';
      ctx.fillText('DANGER ZONE', canvas.width - 10, triggerY - 5);
      ctx.restore();

      // --- Gemini Launcher Structure (Background) --- scaled by game scale
      const scale = getScale(canvas.width);
      const launcherX = anchorPos.current.x;
      const launcherY = anchorPos.current.y;
      const glowColor = '#42a5f5';
      const time = performance.now();
      const armLen = 40 * scale;
      const armY = launcherY + 40 * scale;
      const tipY = launcherY - 10 * scale;
      const baseW = 15 * scale;
      const baseWide = 25 * scale;
      const coreR = 8 * scale;
      const tipR = 4 * scale;

      ctx.save();
      const baseGradient = ctx.createLinearGradient(
        launcherX - baseW,
        armY,
        launcherX + baseW,
        canvas.height
      );
      baseGradient.addColorStop(0, '#1e1e1e');
      baseGradient.addColorStop(0.5, '#333333');
      baseGradient.addColorStop(1, '#121212');

      ctx.fillStyle = baseGradient;
      ctx.beginPath();
      ctx.moveTo(launcherX - baseW, armY);
      ctx.lineTo(launcherX + baseW, armY);
      ctx.lineTo(launcherX + baseWide, canvas.height);
      ctx.lineTo(launcherX - baseWide, canvas.height);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#444746';
      ctx.lineWidth = 2 * scale;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(launcherX, armY, coreR, 0, Math.PI * 2);
      ctx.fillStyle = glowColor;
      ctx.shadowBlur = 15 * scale;
      ctx.shadowColor = glowColor;
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.lineWidth = 8 * scale;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#616161';

      ctx.beginPath();
      ctx.moveTo(launcherX, armY);
      ctx.quadraticCurveTo(launcherX - armLen, armY, launcherX - armLen, tipY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(launcherX, armY);
      ctx.quadraticCurveTo(launcherX + armLen, armY, launcherX + armLen, tipY);
      ctx.stroke();

      ctx.fillStyle = glowColor;
      ctx.beginPath();
      ctx.arc(launcherX - armLen, tipY, tipR, 0, Math.PI * 2);
      ctx.arc(launcherX + armLen, tipY, tipR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Laser Sight (från exempel: stoppar vid bollar, väggstuds, streckad linje + målmarkör)
      const currentSelected = selectedColorRef.current;

      if (!isFlying.current) {
        ctx.save();
        const highlightColor = COLOR_CONFIG[currentSelected].hex;
        ctx.shadowBlur = 15;
        ctx.shadowColor = highlightColor;

        const laserGridLeft = gridLeft;
        const laserGridRight = gridRight;
        const stepSize = 5;
        const maxDistance = 1200;

        let curX = launcherX;
        let curY = launcherY;
        let dirX = Math.cos(angleRef.current + Math.PI);
        let dirY = Math.sin(angleRef.current + Math.PI);
        let distanceTravelled = 0;
        let hitPoint = { x: curX, y: curY };
        let hitSomething = false;

        const points: { x: number; y: number }[] = [{ x: curX, y: curY }];

        while (distanceTravelled < maxDistance && !hitSomething) {
          curX += dirX * stepSize;
          curY += dirY * stepSize;
          distanceTravelled += stepSize;

          // Väggstuds (grid-väggar)
          if (curX < laserGridLeft) {
            curX = laserGridLeft;
            dirX *= -1;
            points.push({ x: curX, y: curY });
          } else if (curX > laserGridRight) {
            curX = laserGridRight;
            dirX *= -1;
            points.push({ x: curX, y: curY });
          } else {
            points.push({ x: curX, y: curY });
          }

          // Kollision med boll? (linjen ska inte gå igenom bollar)
          const collision = bubbles.current.find(
            b =>
              b.active &&
              Math.sqrt((curX - b.x) ** 2 + (curY - b.y) ** 2) < R * 2
          );
          if (collision || curY < R) {
            hitPoint = { x: curX, y: curY };
            hitSomething = true;
          }
        }

        if (!hitSomething) {
          hitPoint = { x: curX, y: curY };
        }

        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.lineTo(hitPoint.x, hitPoint.y);

        const totalDash = 30;
        const dashOffset = (time * 0.05) % totalDash;
        ctx.setLineDash([12, 18]);
        ctx.lineDashOffset = -dashOffset;

        ctx.strokeStyle = `${highlightColor}88`;
        ctx.lineWidth = 3;
        ctx.stroke();

        // Målmarkör i slutet (från exempel)
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(hitPoint.x, hitPoint.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = highlightColor;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(hitPoint.x, hitPoint.y, 12 + Math.sin(time * 0.01) * 4, 0, Math.PI * 2);
        ctx.strokeStyle = highlightColor;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.restore();
      }

      // 1. Draw Energy Bands (Back)
      if (!isFlying.current) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(launcherX - 35 * scale, launcherY - 15 * scale);
        ctx.lineTo(ballPos.current.x, ballPos.current.y);
        ctx.lineWidth = 4;
        ctx.strokeStyle = glowColor;
        ctx.shadowBlur = 15;
        ctx.shadowColor = glowColor;
        ctx.globalAlpha = 0.6 + Math.sin(time * 0.01) * 0.2;
        ctx.stroke();
        ctx.restore();
      }

      // 2. Draw the "Next" ball
      if (isFlying.current) {
        const distFromAnchor = Math.sqrt(
          Math.pow(ballPos.current.x - launcherX, 2) +
            Math.pow(ballPos.current.y - launcherY, 2)
        );

        if (distFromAnchor > R * 2) {
          ctx.save();
          ctx.globalAlpha = 0.8;
          drawBubble(
            ctx,
            launcherX,
            launcherY,
            R,
            selectedColorRef.current,
            currentBallIsFireRef.current ? 'fire' : undefined
          );
          ctx.restore();
        }
      }

      // 3. Draw the active ball
      ctx.save();
      const currentFlyingColor = flyingBallColorRef.current;
      const ballColor =
        isFlying.current && currentFlyingColor
          ? currentFlyingColor
          : selectedColorRef.current;
      const ballIsFire = isFlying.current ? flyingBallIsFireRef.current : currentBallIsFireRef.current;
      drawBubble(ctx, ballPos.current.x, ballPos.current.y, R, ballColor, ballIsFire ? 'fire' : undefined);
      ctx.restore();

      // 4. Draw Energy Bands (Front)
      if (!isFlying.current) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(ballPos.current.x, ballPos.current.y);
        ctx.lineTo(launcherX + 35 * scale, launcherY - 15 * scale);
        ctx.lineWidth = 4;
        ctx.strokeStyle = glowColor;
        ctx.shadowBlur = 15;
        ctx.shadowColor = glowColor;
        ctx.globalAlpha = 0.6 + Math.sin(time * 0.01) * 0.2;
        ctx.stroke();
        ctx.restore();
      }

      // Particles
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

      // Shockwaves from bomb explosions
      for (let i = shockwaves.current.length - 1; i >= 0; i--) {
        const s = shockwaves.current[i];
        s.radius += (s.maxRadius - s.radius) * 0.15;
        s.life -= 0.04;

        if (s.life <= 0) {
          shockwaves.current.splice(i, 1);
        } else {
          ctx.save();
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
          ctx.strokeStyle = s.color;
          ctx.lineWidth = 10 * s.life;
          ctx.globalAlpha = s.life;
          ctx.stroke();

          // Inner glow
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.radius * 0.8, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 4 * s.life;
          ctx.stroke();
          ctx.restore();
        }
      }

      // Debug height markers at actual game edges (for talking about positions)
      // Drawn in the same transformed coordinate system as the bubbles/slingshot,
      // so they line up identiskt oavsett skärmstorlek.
      if (DEBUG_HEIGHT_MARKERS) {
        ctx.save();

        // 1) Top & bottom of active bubble cluster (game coords)
        let topBubbleY: number | null = null;
        let bottomBubbleY: number | null = null;
        bubbles.current.forEach(b => {
          if (!b.active) return;
          const top = b.y - R;
          const bottom = b.y + R;
          if (topBubbleY === null || top < topBubbleY) topBubbleY = top;
          if (bottomBubbleY === null || bottom > bottomBubbleY) bottomBubbleY = bottom;
        });

        // Use current grid play-area horizontally
        const xOffsetDbg = (canvas.width - (GRID_COLS * R * 2)) / 2 + R;
        const gridLeftDbg = xOffsetDbg - R;
        const gridRightDbg = xOffsetDbg + (GRID_COLS * R * 2) - R;

        const markers: { y: number; color: string; label: string }[] = [];

        if (topBubbleY !== null) {
          markers.push({ y: topBubbleY, color: 'rgba(244, 67, 54, 0.7)', label: 'Top bubblor' }); // Red
        }
        if (bottomBubbleY !== null) {
          markers.push({ y: bottomBubbleY, color: 'rgba(255, 193, 7, 0.8)', label: 'Botten bubblor' }); // Amber
        }

        // 2) Slingshot anchor Y
        markers.push({
          y: anchorPos.current.y,
          color: 'rgba(76, 175, 80, 0.9)', // Green
          label: 'Slangbella'
        });

        markers.push({
          // Faktisk spelbotten i koordinatsystemet där vi ritar slangbella/handtag
          y: canvas.height,
          color: 'rgba(33, 150, 243, 0.9)', // Blue
          label: 'Canvas-botten'
        });

        ctx.font = '10px Roboto, system-ui, sans-serif';
        ctx.textBaseline = 'middle';

        markers.forEach(m => {
          const y = m.y;
          ctx.beginPath();
          ctx.moveTo(gridLeftDbg, y);
          ctx.lineTo(gridRightDbg, y);
          ctx.strokeStyle = m.color;
          ctx.lineWidth = 2;
          ctx.stroke();

          // Small label at left edge of play area
          ctx.fillStyle = m.color;
          ctx.fillText(m.label, gridLeftDbg + 6, y);
        });

        ctx.restore();
      }

      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);
    setLoading(false);

    return () => {
        cancelAnimationFrame(animationFrameId);
    };
  }, [initGrid, addRowFromTop, pickQueueBall, mode]);

  const handleLevelWin = useCallback((stars: number) => {
    if (!selectedLevel) return;
    setLevelProgress((prev) =>
      prev.map((l) => {
        if (l.id === selectedLevel.id)
          return { ...l, completed: true, stars: Math.max(l.stars, stars) };
        if (l.id === selectedLevel.id + 1) return { ...l, unlocked: true };
        return l;
      })
    );
    setSelectedLevel(null);
    setMode('map');
  }, [selectedLevel]);

  if (mode === 'online-setup') {
    return (
      <div className="flex flex-col w-full h-full min-h-0">
        <AdBanner
          adClient={import.meta.env.VITE_ADSENSE_CLIENT}
          adSlot={import.meta.env.VITE_ADSENSE_SLOT}
          visible={true}
        />
      <div className="flex flex-col items-center justify-center flex-1 min-h-0 w-full bg-[#0a0a0a] text-white p-6">
        <div className="p-8 rounded-[40px] bg-[#1a1a1a] border border-white/5 max-w-md w-full text-center shadow-2xl">
          <div className="p-5 rounded-3xl bg-purple-500/10 mb-6 inline-block">
            <Globe size={48} className="text-purple-400 animate-pulse" />
          </div>
          <h2 className="text-3xl font-bold mb-2">
            {isMatchmaking ? 'Finding Opponent...' : 'Waiting for Friend'}
          </h2>
          <p className="text-slate-500 mb-8">
            {isMatchmaking
              ? 'Searching for a pilot to battle. This should only take a moment...'
              : 'Share this room code with your friend to start the battle!'}
          </p>
          {!isMatchmaking && (
            <div className="flex items-center gap-2 bg-black/40 p-4 rounded-2xl border border-white/10 mb-8">
              <div className="flex-1 font-mono text-2xl font-bold tracking-widest text-purple-400">{roomId}</div>
              <button
                onClick={copyRoomId}
                className="p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-all text-slate-400 hover:text-white"
              >
                {copied ? <Check size={20} className="text-emerald-400" /> : <Copy size={20} />}
              </button>
            </div>
          )}
          {isMatchmaking && (
            <div className="flex justify-center gap-2 mb-8">
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" />
            </div>
          )}
          {socketError && (
            <p className="text-red-400 text-sm mb-4">{socketError}</p>
          )}
          <button
            onClick={() => {
              socket?.disconnect();
              setMode('menu');
              setIsMatchmaking(false);
              setSocketError(null);
            }}
            className="text-slate-500 hover:text-white transition-all text-sm font-bold uppercase tracking-widest"
          >
            Cancel and Return
          </button>
        </div>
      </div>
      </div>
    );
  }

  if (mode === 'online-game') {
    return (
      <div className="flex flex-col w-full h-full min-h-0">
        <AdBanner
          adClient={import.meta.env.VITE_ADSENSE_CLIENT}
          adSlot={import.meta.env.VITE_ADSENSE_SLOT}
          visible={true}
        />
      <div
        className="w-full flex-1 min-h-0 bg-[#050505] flex flex-col relative overflow-hidden"
        style={{
          width: '100vw',
          maxWidth: '100vw',
          marginLeft: 'calc(-1 * env(safe-area-inset-left, 0px))',
          marginRight: 'calc(-1 * env(safe-area-inset-right, 0px))',
        }}
      >
        <div className="absolute top-4 right-4 z-50 flex items-center gap-3 pr-[env(safe-area-inset-right,0px)]">
          <div className="px-4 py-2 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-400 text-xs font-bold tracking-widest uppercase">
            Online: {roomId}
          </div>
          <button
            onClick={() => {
              socket?.disconnect();
              opponentStateRef.current = null;
              setOpponentScore(null);
              setMode('menu');
            }}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all border border-white/5"
          >
            EXIT
          </button>
        </div>
        <div className="h-1/2 w-full relative rotate-180 overflow-hidden pointer-events-none flex justify-center">
          <div className="h-full w-full max-w-[528px] relative">
          {opponentScore != null && (
            <div className="absolute top-2 left-2 z-50 rotate-180 text-xs font-bold text-emerald-400/90 bg-black/40 px-2 py-1 rounded">
              Opponent score: {opponentScore}
            </div>
          )}
          {opponentScore == null && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
              <p className="text-white/30 font-black text-4xl tracking-tighter rotate-180">OPPONENT</p>
            </div>
          )}
          <GameBoard
            playerId={myPlayerId === 1 ? 2 : 1}
            playerName="Opponent"
            controls={{ left: 'none', right: 'none', fire: 'none' }}
            onCombo={() => {}}
            incomingAttack={undefined}
            isMultiplayer={true}
            isRemoteMirror
            remoteStateRef={opponentStateRef}
          />
          </div>
        </div>
        <div className="h-px w-full bg-purple-500/30 z-50 relative shadow-[0_0_15px_rgba(168,85,247,0.4)]" />
        <div className="h-1/2 w-full relative overflow-hidden flex justify-center">
          <div className="h-full w-full max-w-[528px] relative">
          <GameBoard
            ref={myOnlineBoardRef}
            playerId={myPlayerId}
            playerName="You"
            controls={P1_CONTROLS}
            onCombo={handleOnlineCombo}
            onGameOver={handleGameOver}
            incomingAttack={opponentAttack}
            isMultiplayer={true}
            invertTouch={false}
            hideOwnGameOver={onlineSelfGameOver}
            isFrozen={opponentGameOver || onlineSelfGameOver}
            onSyncSnapshot={handleSyncSnapshot}
          />
          </div>
        </div>
        {opponentGameOver && !onlineSelfGameOver && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 sm:p-6">
            <div className="p-6 sm:p-8 rounded-2xl sm:rounded-[40px] bg-[#1a1a1a] border border-emerald-500/50 max-w-md w-full text-center shadow-2xl">
              <div className="p-4 sm:p-5 rounded-2xl sm:rounded-3xl bg-emerald-500/10 mb-4 sm:mb-6 inline-block">
                <Zap className="w-10 h-10 sm:w-12 sm:h-12 text-emerald-400" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold mb-1 sm:mb-2 text-white">Victory!</h2>
              <p className="text-slate-400 text-xs sm:text-base mb-4 sm:mb-8">
                {opponentLeft
                  ? "Your opponent left the match. You win by forfeit."
                  : "Your opponent's defenses have crumbled. You are the champion!"}
              </p>
              {!socket?.connected && (
                <p className="text-amber-400 text-sm mb-4">No connection. Return to Menu and start again.</p>
              )}
              {socket?.connected && !opponentLeft && rematchRequested && (
                <p className="text-slate-400 text-sm mb-4">Waiting for opponent...</p>
              )}
              {socket?.connected && !opponentLeft && !rematchRequested && opponentRequestedRematch && (
                <p className="text-emerald-400 text-sm mb-4">Your opponent wants to play again! Press Try again to start.</p>
              )}
              <div className="flex flex-col sm:flex-row gap-3">
                {socket?.connected && !opponentLeft && (
                  <button
                    onClick={() => {
                      // Snabb rematch i samma rum som snabbmatch / join-room
                      const r = (roomId || roomIdRef.current || '').trim().toUpperCase();
                      const s = socket || socketRef.current;
                      if (!s) {
                        console.warn('[Rematch] No socket');
                        return;
                      }
                      if (!r) {
                        console.warn('[Rematch] No roomId', { roomId, ref: roomIdRef.current });
                        return;
                      }
                      if (rematchRequested) return;
                      setRematchRequested(true);
                      s.emit('request-rematch', { roomId: r });
                      console.log('[Rematch] Sent request-rematch', { roomId: r, connected: s.connected });
                    }}
                    disabled={rematchRequested}
                    className="flex-1 rounded-xl sm:rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:pointer-events-none text-black font-bold py-3 sm:py-4 transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                  >
                    <Zap className="w-5 h-5 sm:w-6 sm:h-6" /> Try again
                  </button>
                )}
                {socket?.connected && opponentLeft && (
                  <button
                    onClick={() => {
                      // Ny motståndare: återanvänd QUICK MATCH-logiken
                      setSocketError(null);
                      pendingOnlineActionRef.current = 'find-match';
                      setIsMatchmaking(true);
                      setMode('online-setup');
                    }}
                    className="flex-1 rounded-xl sm:rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-3 sm:py-4 transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                  >
                    <Zap className="w-5 h-5 sm:w-6 sm:h-6" /> Find new opponent
                  </button>
                )}
                <button
                  onClick={() => {
                    socket?.disconnect();
                    opponentStateRef.current = null;
                    setOpponentScore(null);
                    setMode('menu');
                    setOpponentGameOver(false);
                    setOnlineSelfGameOver(false);
                    setRematchRequested(false);
                    setOpponentRequestedRematch(false);
                    setOpponentLeft(false);
                  }}
                  className={`rounded-xl sm:rounded-2xl bg-white/10 hover:bg-white/20 text-white font-bold py-3 sm:py-4 transition-all active:scale-95 border border-white/20 ${
                    socket?.connected ? 'flex-1' : 'w-full'
                  }`}
                >
                  Return to Menu
                </button>
              </div>
            </div>
          </div>
        )}
        {onlineSelfGameOver && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 sm:p-6">
            <div className="p-6 sm:p-8 rounded-2xl sm:rounded-[40px] bg-[#1a1a1a] border border-white/10 max-w-md w-full text-center shadow-2xl">
              <div className="p-4 sm:p-5 rounded-2xl sm:rounded-3xl bg-red-500/20 mb-4 sm:mb-6 inline-block">
                <AlertTriangle className="w-10 h-10 sm:w-12 sm:h-12 text-red-400" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold mb-1 sm:mb-2 text-white">Game Over</h2>
              <p className="text-slate-400 text-xs sm:text-base mb-4 sm:mb-8">The bubbles reached the bottom. You lost this round.</p>
              {!socket?.connected && (
                <p className="text-amber-400 text-sm mb-4">No connection. Return to Menu and start again.</p>
              )}
              {socket?.connected && rematchRequested && (
                <p className="text-slate-400 text-sm mb-4">Waiting for opponent...</p>
              )}
              {socket?.connected && !rematchRequested && opponentRequestedRematch && (
                <p className="text-emerald-400 text-sm mb-4">Your opponent wants to play again! Press Try again to start.</p>
              )}
              <div className="flex flex-col sm:flex-row gap-3">
                {socket?.connected && (
                  <button
                    onClick={() => {
                      const r = (roomId || roomIdRef.current || '').trim().toUpperCase();
                      const s = socket || socketRef.current;
                      if (!s) {
                        console.warn('[Rematch] No socket');
                        return;
                      }
                      if (!r) {
                        console.warn('[Rematch] No roomId', { roomId, ref: roomIdRef.current });
                        return;
                      }
                      if (rematchRequested) return;
                      setRematchRequested(true);
                      s.emit('request-rematch', { roomId: r });
                      console.log('[Rematch] Sent request-rematch', { roomId: r, connected: s.connected });
                    }}
                    disabled={rematchRequested}
                    className="flex-1 rounded-xl sm:rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 disabled:pointer-events-none text-black font-bold py-3 sm:py-4 transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                  >
                    <Zap className="w-5 h-5 sm:w-6 sm:h-6" /> Try again
                  </button>
                )}
                <button
                  onClick={() => {
                    socket?.disconnect();
                    opponentStateRef.current = null;
                    setOpponentScore(null);
                    setMode('menu');
                    setOpponentGameOver(false);
                    setOnlineSelfGameOver(false);
                    setRematchRequested(false);
                    setOpponentRequestedRematch(false);
                    setOpponentLeft(false);
                  }}
                  className={`rounded-xl sm:rounded-2xl bg-white/10 hover:bg-white/20 text-white font-bold py-3 sm:py-4 transition-all active:scale-95 border border-white/20 ${
                    socket?.connected ? 'flex-1' : 'w-full'
                  }`}
                >
                  Return to Menu
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    );
  }

  if (mode === 'multi') {
    const handleMultiTryAgain = () => {
      setP1Attack(undefined);
      setP2Attack(undefined);
      p1BoardRef.current?.resetGame();
      p2BoardRef.current?.resetGame();
      setMultiGameOverPlayer(null);
    };
    return (
      <div className="flex flex-col w-full h-full min-h-0">
        <AdBanner
          adClient={import.meta.env.VITE_ADSENSE_CLIENT}
          adSlot={import.meta.env.VITE_ADSENSE_SLOT}
          visible={true}
        />
      <div
        className="flex flex-col flex-1 min-h-0 w-full bg-[#050505] overflow-hidden font-roboto text-[#e3e3e3] relative"
        style={{
          width: '100vw',
          maxWidth: '100vw',
          marginLeft: 'calc(-1 * env(safe-area-inset-left, 0px))',
          marginRight: 'calc(-1 * env(safe-area-inset-right, 0px))',
        }}
      >
        <button
          onClick={() => setMode('menu')}
          className="absolute top-1/2 left-4 -translate-y-1/2 z-50 p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all border border-white/5 rotate-90 origin-left text-xs font-bold tracking-widest pl-[max(1rem,env(safe-area-inset-left))]"
        >
          MENU
        </button>
        <div className="h-1/2 w-full relative rotate-180 overflow-hidden">
          <GameBoard
            ref={p2BoardRef}
            playerId={2}
            playerName="Player 2"
            controls={P2_CONTROLS}
            onCombo={handleP2Combo}
            onGameOver={() => setMultiGameOverPlayer(2)}
            incomingAttack={p2Attack}
            isMultiplayer={true}
            hideOwnGameOver={true}
            isFrozen={multiGameOverPlayer !== null}
            invertTouch={true}
          />
        </div>
        <div className="h-px w-full bg-white/20 z-50 relative shadow-[0_0_10px_rgba(255,255,255,0.3)]" />
        <div className="h-1/2 w-full relative overflow-hidden">
          <GameBoard
            ref={p1BoardRef}
            playerId={1}
            playerName="Player 1"
            controls={P1_CONTROLS}
            onCombo={handleP1Combo}
            onGameOver={() => setMultiGameOverPlayer(1)}
            incomingAttack={p1Attack}
            isMultiplayer={true}
            hideOwnGameOver={true}
            isFrozen={multiGameOverPlayer !== null}
          />
        </div>
        {multiGameOverPlayer !== null && (
          <div className="absolute inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-md">
            {/* Player 2's half (top) – result rotated so P2 can read from their side of the screen */}
            <div className="flex-1 flex items-center justify-center min-h-0">
              <div className={`text-center px-4 py-6 rotate-180 ${multiGameOverPlayer === 2 ? 'text-red-400' : 'text-emerald-400'}`}>
                <p className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight">
                  {multiGameOverPlayer === 2 ? 'You lose' : 'You win'}
                </p>
                <p className="text-slate-400 text-sm sm:text-base mt-2">Player 2</p>
              </div>
            </div>
            {/* Center: Menu + Play again – mobilanpassade touch-targets */}
            <div className="flex-shrink-0 flex flex-col sm:flex-row flex-wrap justify-center items-stretch sm:items-center gap-3 sm:gap-4 py-4 sm:py-6 px-4 border-y border-white/10 bg-black/30">
              <button
                onClick={() => setMode('menu')}
                className="min-h-[48px] sm:min-h-0 py-3.5 sm:py-4 px-6 sm:px-8 rounded-xl sm:rounded-2xl bg-white/10 hover:bg-white/20 active:bg-white/25 text-white font-bold text-base sm:text-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2 border border-white/20 touch-manipulation"
              >
                Menu
              </button>
              <button
                onClick={handleMultiTryAgain}
                className="min-h-[52px] sm:min-h-0 py-4 sm:py-5 px-8 sm:px-12 rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-400 text-black font-bold text-lg sm:text-xl transition-all active:scale-[0.98] flex items-center justify-center gap-3 shadow-lg shadow-emerald-500/30 touch-manipulation"
              >
                <Zap className="w-6 h-6 sm:w-7 sm:h-7 flex-shrink-0" fill="currentColor" /> Play again
              </button>
            </div>
            {/* Player 1's half (bottom) – result on their side */}
            <div className="flex-1 flex items-center justify-center min-h-0">
              <div className={`text-center px-4 py-6 ${multiGameOverPlayer === 1 ? 'text-red-400' : 'text-emerald-400'}`}>
                <p className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight">
                  {multiGameOverPlayer === 1 ? 'You lose' : 'You win'}
                </p>
                <p className="text-slate-400 text-sm sm:text-base mt-2">Player 1</p>
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    );
  }

  if (mode === 'map') {
    return (
      <LevelMap
        levels={levelProgress}
        onBack={() => setMode('menu')}
        onSelectLevel={(level) => {
          setSelectedLevel(level);
          setMode('level-game');
        }}
      />
    );
  }

  if (showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  if (mode === 'level-game' && selectedLevel) {
    return (
      <div className="flex flex-col w-full h-full min-h-0">
        <AdBanner
          adClient={import.meta.env.VITE_ADSENSE_CLIENT}
          adSlot={import.meta.env.VITE_ADSENSE_SLOT}
          visible={true}
        />
      <div className="flex flex-col flex-1 min-h-0 w-full bg-[#121212] overflow-hidden font-roboto text-[#e3e3e3] relative">
        <div className="absolute top-4 right-4 z-50 flex items-center gap-3">
          <div className="px-4 py-2 rounded-full bg-yellow-500/20 border border-yellow-500/30 text-yellow-400 text-xs font-bold tracking-widest uppercase">
            Level {selectedLevel.id}: {selectedLevel.name}
          </div>
          <button
            onClick={() => {
              setSelectedLevel(null);
              setMode('map');
            }}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all border border-white/5"
          >
            EXIT
          </button>
        </div>
        {/* Samma spelarea som Single Player: begränsad bredd, centrerad, samma banhöjd */}
        <div className="flex-1 relative min-h-0 w-full min-w-0 max-w-[100vw] md:max-w-[528px] md:mx-auto overflow-hidden touch-none">
          <GameBoard
            playerId={1}
            playerName="Pilot"
            controls={P1_CONTROLS}
            onCombo={() => {}}
            onGameOver={() => {
              setSelectedLevel(null);
              setMode('map');
            }}
            onLevelWin={handleLevelWin}
            level={selectedLevel}
            isMultiplayer={false}
            useSinglePlayerLayout={true}
          />
        </div>
        </div>
      </div>
    );
  }

  if (mode === 'single') {
    return (
      <div className="flex flex-col w-full h-full min-h-0">
        <AdBanner
          adClient={import.meta.env.VITE_ADSENSE_CLIENT}
          adSlot={import.meta.env.VITE_ADSENSE_SLOT}
          visible={true}
        />
        <div className="flex flex-col flex-1 min-h-0 w-full bg-[#121212] overflow-hidden font-roboto text-[#e3e3e3] relative">
      <>
      {/* Game Over Overlay */}
      {isGameOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="text-center p-8 rounded-3xl border border-white/10 bg-white/5 shadow-2xl max-w-md w-full mx-4">
            <div className="mb-6 flex justify-center">
              <div className="p-4 rounded-full bg-red-500/20 text-red-500">
                <AlertTriangle size={64} />
              </div>
            </div>
            <h2 className="text-5xl font-bold mb-2 tracking-tighter text-white">
              GAME OVER
            </h2>
            <p className="text-slate-400 mb-8">
              The bubbles reached the bottom!
            </p>

            <div className="bg-white/5 rounded-2xl p-6 mb-8 border border-white/5">
              <div className="text-sm uppercase tracking-widest text-slate-500 mb-1">
                Final Score
              </div>
              <div className="text-4xl font-mono font-bold text-emerald-400 mb-4">
                {score.toLocaleString()}
              </div>

              <div className="pt-4 border-t border-white/5">
                <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">
                  Best Score
                </div>
                <div className="text-xl font-mono font-bold text-white">
                  {highScore.toLocaleString()}
                </div>
              </div>

              {score >= highScore && score > 0 && (
                <div className="mt-4 py-1 px-3 bg-yellow-500/20 text-yellow-500 text-[10px] font-bold uppercase tracking-widest rounded-full inline-block animate-pulse">
                  New Record!
                </div>
              )}
            </div>

            <button
              onClick={resetGame}
              className="w-full py-4 px-8 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xl transition-all active:scale-95 flex items-center justify-center gap-3 shadow-lg shadow-emerald-500/20"
            >
              <Zap size={24} fill="currentColor" />
              TRY AGAIN
            </button>
          </div>
        </div>
      )}

      {/* Game Area: på desktop begränsad bredd (REFERENCE_WIDTH) så det inte blir inzoomat */}
      <div
        ref={gameContainerRef}
        className="flex-1 relative min-h-0 w-full min-w-0 max-w-[100vw] md:max-w-[528px] md:mx-auto overflow-hidden touch-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" style={{ width: '100%', height: '100%' }} />

        {/* Paus-knapp – uppe till höger, döljs vid game over */}
        {!isGameOver && (
          <button
            type="button"
            onClick={() => setIsPaused(p => !p)}
            className="absolute top-2 right-2 z-40 p-2 rounded-xl bg-[#1e1e1e]/90 border border-[#444746] text-[#c4c7c5] hover:bg-[#2d2d2d] hover:text-white active:scale-95 transition-colors"
            aria-label={isPaused ? 'Resume' : 'Pause'}
          >
            {isPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
          </button>
        )}

        {/* Pausad-overlay – klick var som helst för att fortsätta; EXIT till menyn */}
        {isPaused && (
          <div
            className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setIsPaused(false)}
            onKeyDown={(e) => e.key === 'Escape' && setIsPaused(false)}
            role="button"
            tabIndex={0}
            aria-label="Resume game"
          >
            <div className="text-center pointer-events-none">
              <p className="text-2xl font-bold text-white uppercase tracking-widest">Paused</p>
              <p className="text-sm text-[#c4c7c5] mt-1">Tap anywhere to resume</p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                resetGame();
                setMode('menu');
              }}
              className="mt-6 px-6 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-sm uppercase tracking-widest border border-white/20 transition-colors"
            >
              Exit to menu
            </button>
          </div>
        )}

        {/* Combo Overlay – nivåer för större combos, portal så den hamnar i skärmens mitt */}
        {typeof document !== 'undefined' && createPortal(
          <AnimatePresence>
            {combo && (() => {
              const n = combo.count;
              const tier = n >= 15 ? 'legendary' : n >= 10 ? 'incredible' : 'amazing';
              const config = {
                amazing: {
                  gradient: 'from-yellow-400 to-orange-600',
                  subtitle: 'Amazing Shot!',
                  scale: 1.2,
                  duration: 0.3,
                  textSize: 'text-5xl sm:text-6xl',
                },
                incredible: {
                  gradient: 'from-pink-400 via-purple-500 to-indigo-600',
                  subtitle: 'Incredible!',
                  scale: 1.35,
                  duration: 0.35,
                  textSize: 'text-6xl sm:text-7xl',
                },
                legendary: {
                  gradient: 'from-amber-300 via-yellow-400 to-red-500',
                  subtitle: 'LEGENDARY!',
                  scale: 1.5,
                  duration: 0.4,
                  textSize: 'text-7xl sm:text-8xl',
                },
              }[tier];
              const c = config;
              return (
                <motion.div
                  key={combo.x + combo.y + n}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 pointer-events-none z-[100] flex items-center justify-center"
                  aria-hidden
                >
                  <motion.span
                    initial={{ scale: 0.3 }}
                    animate={{ scale: c.scale }}
                    exit={{ scale: 1.6 }}
                    transition={{ duration: c.duration, type: 'spring', stiffness: 200, damping: 20 }}
                    className="flex flex-col items-center"
                  >
                    <div className={`bg-gradient-to-b ${c.gradient} text-transparent bg-clip-text ${c.textSize} font-black italic tracking-tighter drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)]`}>
                      {n} COMBO!
                    </div>
                    <div className={`text-white font-bold uppercase tracking-widest mt-[-6px] drop-shadow-md ${tier === 'legendary' ? 'animate-pulse' : ''}`}
                      style={{ fontSize: tier === 'legendary' ? '1.35rem' : tier === 'incredible' ? '1.15rem' : undefined }}
                    >
                      {c.subtitle}
                    </div>
                    {tier === 'legendary' && (
                      <div className="absolute -inset-8 pointer-events-none rounded-full bg-amber-400/20 blur-2xl" aria-hidden />
                    )}
                  </motion.span>
                </motion.div>
              );
            })()}
          </AnimatePresence>,
          document.body
        )}

        {/* Loading Overlay */}
        {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#121212] z-50">
            <div className="flex flex-col items-center">
                <Loader2 className="w-12 h-12 text-[#42a5f5] animate-spin mb-4" />
                <p className="text-[#e3e3e3] text-lg font-medium">Starting Engine...</p>
            </div>
            </div>
        )}

        {/* HUD: Score+Best vänster nedre hörn; tangent-hint mitten; bollkö höger */}
        <div className="absolute bottom-0 left-0 right-0 z-40 flex flex-row items-end justify-between gap-3 pt-1.5 safe-bottom pb-2 sm:pb-6 px-3 sm:px-4">
            {/* Vänster nedre hörn: Score+Best */}
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

            {/* Keyboard hint – mitten, döljs på touch */}
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

            {/* Höger: Bollkö */}
            <div className="ml-auto flex flex-col items-end gap-2">
                <div className="bg-[#1e1e1e]/95 px-2 py-2 rounded-xl border border-[#444746]/80 shadow-lg flex items-center gap-2 shrink-0">
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
                                    className={`queue-ball-animate-in relative w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center
                                        ${isCurrent ? 'scale-110 ring-2 ring-white/50 z-10' : 'opacity-80 scale-90'}
                                    `}
                                    style={{
                                        background: `radial-gradient(circle at 35% 35%, ${config.hex}, ${adjustColor(config.hex, -60)})`,
                                        boxShadow: isCurrent
                                            ? `0 0 10px ${config.hex}, inset 0 -2px 2px rgba(0,0,0,0.3)`
                                            : '0 1px 3px rgba(0,0,0,0.3), inset 0 -1px 2px rgba(0,0,0,0.2)'
                                    }}
                                >
                                    {ball.color === 'bomb' && <span className="text-sm leading-none">💣</span>}
                                    {(ball.color === 'fire' || ball.isFire) && <span className="text-sm leading-none">🔥</span>}
                                    {ball.color !== 'bomb' && ball.color !== 'fire' && (
                                        <div className="absolute top-1 left-1.5 w-1.5 h-0.5 bg-white/40 rounded-full transform -rotate-45 filter blur-[1px]" />
                                    )}
                                    {isCurrent && (
                                        <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[7px] font-bold text-white/90 uppercase">Now</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
                </div>
            </div>
        </div>
      </div>
        </>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center w-full flex-1 min-h-0 bg-[#050505] text-white relative overflow-x-hidden overflow-y-auto overscroll-y-contain box-border"
      style={{
        paddingTop: 'max(0.25rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(0.25rem, env(safe-area-inset-left))',
        paddingRight: 'max(0.25rem, env(safe-area-inset-right))',
      }}
    >
      {/* Background - fixed, no layout space */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden>
        {[...Array(50)].map((_, i) => (
          <motion.div
            key={i}
            animate={{ opacity: [0.1, 0.5, 0.1], scale: [1, 1.2, 1] }}
            transition={{ duration: 2 + Math.random() * 3, repeat: Infinity, delay: Math.random() * 5, ease: 'easeInOut' }}
            className="absolute rounded-full bg-white"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              width: `${Math.random() * 2 + 1}px`,
              height: `${Math.random() * 2 + 1}px`,
            }}
          />
        ))}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(600px,90vmin)] h-[min(600px,90vmin)] bg-emerald-500/5 rounded-full blur-[120px]" />
        <div className="absolute top-1/4 left-1/4 w-[min(400px,60vmin)] h-[min(400px,60vmin)] bg-blue-500/5 rounded-full blur-[100px]" />
      </div>

      <div className="flex flex-col items-center w-full max-w-7xl mx-auto flex-1 min-h-0 min-w-0 relative z-10 py-2 sm:py-4 md:py-6">
        {/* Title block - compact on small screens */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex-shrink-0 text-center w-full min-w-0 px-1 mb-2 sm:mb-4 md:mb-6"
        >
          <div className="flex justify-center mb-1 sm:mb-2 md:mb-4">
            <motion.div
              animate={{ rotate: [0, 5, -5, 0], scale: [1, 1.05, 1] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              className="p-2 sm:p-4 md:p-6 lg:p-8 rounded-full bg-emerald-500/20 text-emerald-500 border border-emerald-500/30"
            >
              <Zap className="w-8 h-8 sm:w-12 sm:h-12 md:w-16 md:h-16 lg:w-20 lg:h-20" fill="currentColor" />
            </motion.div>
          </div>
          <h1 className="text-xl min-[360px]:text-2xl min-[400px]:text-3xl sm:text-4xl md:text-5xl lg:text-7xl xl:text-8xl font-black tracking-tighter mb-0.5 sm:mb-1 md:mb-2 bg-gradient-to-b from-white via-white to-slate-500 text-transparent bg-clip-text drop-shadow-2xl leading-tight break-words">
            COSMIC SLINGSHOT
          </h1>
          <div className="flex items-center justify-center gap-1 sm:gap-2 md:gap-4 flex-wrap">
            <div className="h-px w-3 sm:w-6 md:w-16 bg-emerald-500/30 shrink-0" />
            <p className="text-emerald-500 text-[7px] min-[360px]:text-[8px] min-[400px]:text-[10px] sm:text-sm md:text-base tracking-[0.1em] sm:tracking-[0.4em] uppercase font-black whitespace-nowrap">Tactical Combat Arena</p>
            <div className="h-px w-3 sm:w-6 md:w-16 bg-emerald-500/30 shrink-0" />
          </div>
        </motion.div>

        {/* Menu cards - grid fills available space */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 md:gap-4 lg:gap-6 w-full min-w-0 flex-1 content-start">
        <motion.button
          whileHover={{ y: -2, scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          onClick={() => {
            resetGame();
            setMode('single');
          }}
          className="group relative overflow-hidden p-3 sm:p-4 md:p-6 lg:p-8 rounded-xl sm:rounded-2xl md:rounded-[32px] bg-[#0a0a0a] border border-white/5 hover:border-emerald-500/50 transition-all duration-300 text-left min-w-0"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative z-10 flex items-center gap-3 sm:gap-4 md:block md:gap-0 min-w-0">
            <div className="p-2 sm:p-3 md:p-5 rounded-lg md:rounded-2xl lg:rounded-3xl bg-white/5 md:mb-6 w-fit shrink-0">
              <User size={18} className="text-emerald-400 sm:w-5 sm:h-5 md:w-8 md:h-8" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base md:text-2xl lg:text-3xl font-black md:mb-2 tracking-tight truncate">SINGLE PLAYER</h2>
              <p className="text-slate-500 text-[9px] sm:text-[10px] md:text-base leading-snug opacity-70 line-clamp-2">Master your skills and set new high scores.</p>
            </div>
          </div>
        </motion.button>

        <motion.button
          whileHover={{ y: -2, scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          onClick={() => setMode('map')}
          className="group relative overflow-hidden p-3 sm:p-4 md:p-6 lg:p-8 rounded-xl sm:rounded-2xl md:rounded-[32px] bg-[#0a0a0a] border border-white/5 hover:border-yellow-500/50 transition-all duration-300 text-left min-w-0"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative z-10 flex items-center gap-3 sm:gap-4 md:block md:gap-0 min-w-0">
            <div className="p-2 sm:p-3 md:p-5 rounded-lg md:rounded-2xl lg:rounded-3xl bg-white/5 md:mb-6 w-fit shrink-0">
              <MapIcon size={18} className="text-yellow-400 sm:w-5 sm:h-5 md:w-8 md:h-8" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base md:text-2xl lg:text-3xl font-black md:mb-2 tracking-tight truncate">GALAXY MAP</h2>
              <p className="text-slate-500 text-[9px] sm:text-[10px] md:text-base leading-snug opacity-70 line-clamp-2">Campaign mode. Unlock new sectors.</p>
            </div>
          </div>
        </motion.button>

        <motion.button
          whileHover={{ y: -2, scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          onClick={() => setMode('multi')}
          className="group relative overflow-hidden p-3 sm:p-4 md:p-6 lg:p-8 rounded-xl sm:rounded-2xl md:rounded-[32px] bg-[#0a0a0a] border border-white/5 hover:border-blue-500/50 transition-all duration-300 text-left min-w-0"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative z-10 flex items-center gap-3 sm:gap-4 md:block md:gap-0 min-w-0">
            <div className="p-2 sm:p-3 md:p-5 rounded-lg md:rounded-2xl lg:rounded-3xl bg-white/5 md:mb-6 w-fit shrink-0">
              <Users size={18} className="text-blue-400 sm:w-5 sm:h-5 md:w-8 md:h-8" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base md:text-2xl lg:text-3xl font-black md:mb-2 tracking-tight truncate">LOCAL PVP</h2>
              <p className="text-slate-500 text-[9px] sm:text-[10px] md:text-base leading-snug opacity-70">Same-screen battle.</p>
            </div>
          </div>
        </motion.button>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="group relative overflow-hidden p-3 sm:p-4 md:p-6 lg:p-8 rounded-xl sm:rounded-2xl md:rounded-[32px] bg-[#0a0a0a] border border-white/5 hover:border-purple-500/50 transition-all duration-300 flex flex-col min-w-0"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative z-10 flex flex-col h-full min-w-0">
            <div className="flex items-center gap-3 sm:gap-4 md:block md:gap-0 mb-2 md:mb-0">
              <div className="p-2 sm:p-3 md:p-5 rounded-lg md:rounded-2xl lg:rounded-3xl bg-white/5 md:mb-6 w-fit shrink-0">
                <Globe size={18} className="text-purple-400 sm:w-5 sm:h-5 md:w-8 md:h-8" />
              </div>
              <h2 className="text-sm sm:text-base md:text-2xl lg:text-3xl font-black md:mb-3 tracking-tight truncate">ONLINE PVP</h2>
            </div>

            <div className="flex flex-col gap-1.5 sm:gap-2 md:gap-4 mt-auto min-w-0">
              <button
                onClick={() => {
                  setSocketError(null);
                  const url = getSocketUrl();
                  const s = url ? io(url, { withCredentials: false, transports: ['websocket'] }) : io({ transports: ['websocket'] });
                  setSocket(s);
                  pendingOnlineActionRef.current = 'find-match';
                  setMode('online-setup');
                  setIsMatchmaking(true);
                }}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black py-2 sm:py-2.5 md:py-4 rounded-lg sm:rounded-xl md:rounded-2xl transition-all text-[10px] sm:text-xs md:text-sm active:scale-95 min-h-[36px] sm:min-h-[40px]"
              >
                QUICK MATCH
              </button>

              <div className="flex items-center gap-1.5 sm:gap-2 md:gap-3 my-0.5">
                <div className="h-px flex-1 min-w-0 bg-white/10" />
                <span className="text-[6px] sm:text-[7px] md:text-[10px] text-slate-600 font-black uppercase tracking-widest shrink-0">PRIVATE</span>
                <div className="h-px flex-1 min-w-0 bg-white/10" />
              </div>

              <div className="flex gap-1.5 sm:gap-2 md:gap-3 min-w-0">
                <input
                  type="text"
                  placeholder="CODE"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="w-12 sm:w-14 md:w-24 min-w-0 flex-1 bg-black/40 border border-white/10 rounded-lg sm:rounded-xl md:rounded-2xl px-1.5 sm:px-2 md:px-3 py-1.5 sm:py-2 md:py-3 text-center font-mono focus:outline-none focus:border-purple-500/50 transition-all text-[9px] sm:text-[10px] md:text-sm"
                />
                <button
                  onClick={() => {
                    setSocketError(null);
                    const idToJoin = roomId || Math.random().toString(36).substring(2, 7).toUpperCase();
                    setRoomId(idToJoin);
                    const url = getSocketUrl();
                    const s = url ? io(url, { withCredentials: false, transports: ['websocket'] }) : io({ transports: ['websocket'] });
                    setSocket(s);
                    pendingOnlineActionRef.current = { type: 'join-room', roomId: idToJoin };
                    setMode('online-setup');
                    setIsMatchmaking(false);
                  }}
                  className="flex-1 min-w-0 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border border-purple-500/30 font-black py-1.5 sm:py-2 md:py-3 rounded-lg sm:rounded-xl md:rounded-2xl transition-all text-[9px] sm:text-[10px] md:text-sm active:scale-95 min-h-[36px] sm:min-h-[40px]"
                >
                  {roomId ? 'JOIN' : 'NEW'}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

        {/* Footer - compact */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="flex flex-col items-center gap-1 sm:gap-2 flex-shrink-0 py-2 sm:py-3 min-w-0"
        >
          <button
            type="button"
            onClick={() => setShowHowToPlay(true)}
            className="text-slate-500 hover:text-emerald-500/90 text-[10px] sm:text-xs font-black tracking-[0.3em] uppercase transition-colors"
          >
            How to play
          </button>
          <span className="text-slate-700 text-[10px] font-black tracking-[0.5em] uppercase">V1.2 • MULTIPLAYER</span>
          <div className="h-1 w-16 bg-emerald-500/20 rounded-full" />
        </motion.div>
      </div>

      {/* How to Play Modal */}
      <AnimatePresence>
        {showHowToPlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
            style={{
              paddingTop: 'max(1rem, env(safe-area-inset-top))',
              paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
              paddingLeft: 'max(1rem, env(safe-area-inset-left))',
              paddingRight: 'max(1rem, env(safe-area-inset-right))',
            }}
            onClick={() => setShowHowToPlay(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[#111] border border-white/10 rounded-2xl md:rounded-[40px] p-4 md:p-8 max-w-lg w-full max-h-[85dvh] overflow-y-auto shadow-2xl"
            >
              <div className="flex items-center justify-between mb-4 md:mb-6">
                <h3 className="text-lg md:text-2xl font-black tracking-tight">HOW TO PLAY</h3>
                <button
                  type="button"
                  onClick={() => setShowHowToPlay(false)}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-all"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
                <div className="flex flex-col items-center text-center gap-2">
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-500">
                    <Target size={20} className="md:w-6 md:h-6" />
                  </div>
                  <h4 className="font-black text-xs uppercase tracking-widest">Aim & Fire</h4>
                  <p className="text-slate-500 text-xs md:text-sm">Use arrows or drag to aim. Match 3+ bubbles to pop and send attacks.</p>
                </div>
                <div className="flex flex-col items-center text-center gap-2">
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-blue-500/20 flex items-center justify-center text-blue-500">
                    <Zap size={20} className="md:w-6 md:h-6" />
                  </div>
                  <h4 className="font-black text-xs uppercase tracking-widest">Match & Combo</h4>
                  <p className="text-slate-500 text-xs md:text-sm">Combos send falling bubbles to your opponent in PvP!</p>
                </div>
                <div className="flex flex-col items-center text-center gap-2">
                  <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-500">
                    <Globe size={20} className="md:w-6 md:h-6" />
                  </div>
                  <h4 className="font-black text-xs uppercase tracking-widest">Special Orbs</h4>
                  <p className="text-slate-500 text-xs md:text-sm">Bombs and Fire bubbles clear the board.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowHowToPlay(false)}
                className="mt-6 w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm transition-colors"
              >
                GOT IT
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default GeminiSlingshot;
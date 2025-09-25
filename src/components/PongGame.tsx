'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import SoundGenerator from '@/utils/soundUtils';

interface GameState {
  ballX: number;
  ballY: number;
  ballVelX: number;
  ballVelY: number;
  prevBallX: number;
  leftPaddleY: number;
  rightPaddleY: number;
  leftHealth: number;
  rightHealth: number;
  isRunning: boolean;
  currentSpeedMultiplier: number;
}

const PongGame: React.FC = () => {
  // Constants - define these first so they can be used in refs
  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 600;
  const PADDLE_WIDTH = 10;
  const PADDLE_HEIGHT = 100;
  const BALL_SIZE = 10;
  const BASE_PADDLE_SPEED = 8;
  const BASE_BALL_SPEED = 5;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameLoopRef = useRef<number>();
  const soundRef = useRef<SoundGenerator | null>(null);

  // Use ref for performance-critical game state
  const gameStateRef = useRef<GameState>({
    ballX: 400,
    ballY: 300,
    ballVelX: BASE_BALL_SPEED,
    ballVelY: 3,
    prevBallX: 400,
    leftPaddleY: 250,
    rightPaddleY: 250,
    leftHealth: 100,
    rightHealth: 100,
    isRunning: false,
    currentSpeedMultiplier: 1.0,
  });

  // AI state tracking
  const aiStateRef = useRef({
    targetY: 250,
    lastBallDirection: 0,
    frameCounter: 0,
  });

  // Animation state for paddle blinking
  const animationStateRef = useRef({
    blinkingPaddle: null as 'left' | 'right' | null,
    blinkTimer: 0,
    blinkCycleTimer: 0,
    isBlinkVisible: true,
  });

  // Only use useState for UI-reactive values
  const [isRunning, setIsRunning] = useState(false);
  const [leftHealth, setLeftHealth] = useState(100);
  const [rightHealth, setRightHealth] = useState(100);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState<'PLAYER' | 'CPU' | null>(null);

  const keysRef = useRef<{ [key: string]: boolean }>({});

  const createHealthBar = (health: number) => {
    const maxHealth = 100;
    const barLength = 10;
    const healthPercent = Math.max(0, health) / maxHealth;
    const filledBars = Math.floor(healthPercent * barLength);
    const emptyBars = barLength - filledBars;

    const filled = '█'.repeat(filledBars);
    const empty = '░'.repeat(emptyBars);

    return `[${filled}${empty}] ${Math.max(0, health)}/100`;
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const state = gameStateRef.current;

    // Clear canvas with pure black
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw center line with terminal green
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 2, 0);
    ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw paddles with terminal green
    ctx.fillStyle = '#00ff00';

    const animState = animationStateRef.current;

    // Draw left paddle (only if not blinking or if blink is visible)
    if (animState.blinkingPaddle !== 'left' || animState.isBlinkVisible) {
      ctx.fillRect(0, state.leftPaddleY, PADDLE_WIDTH, PADDLE_HEIGHT);
    }

    // Draw right paddle (only if not blinking or if blink is visible)
    if (animState.blinkingPaddle !== 'right' || animState.isBlinkVisible) {
      ctx.fillRect(CANVAS_WIDTH - PADDLE_WIDTH, state.rightPaddleY, PADDLE_WIDTH, PADDLE_HEIGHT);
    }

    // Draw ball with terminal green
    ctx.fillRect(state.ballX, state.ballY, BALL_SIZE, BALL_SIZE);

  }, []);

  const updateGame = useCallback(() => {
    const state = gameStateRef.current;
    const keys = keysRef.current;
    const animState = animationStateRef.current;

    // Handle blinking animation
    if (animState.blinkingPaddle) {
      animState.blinkTimer += 16; // Approximate frame time (60fps)
      animState.blinkCycleTimer += 16;

      // Toggle blink visibility every 200ms
      if (animState.blinkCycleTimer >= 200) {
        animState.isBlinkVisible = !animState.isBlinkVisible;
        animState.blinkCycleTimer = 0;
      }

      // End blinking after 2 seconds and reset ball
      if (animState.blinkTimer >= 2000) {
        animState.blinkingPaddle = null;
        animState.blinkTimer = 0;
        animState.blinkCycleTimer = 0;
        animState.isBlinkVisible = true;

        // Reset ball position
        state.ballX = CANVAS_WIDTH / 2;
        state.ballY = CANVAS_HEIGHT / 2;
        state.prevBallX = CANVAS_WIDTH / 2;
        state.ballVelX = state.ballVelX > 0 ? -BASE_BALL_SPEED : BASE_BALL_SPEED;
        state.ballVelY = (Math.random() - 0.5) * 6;
        state.currentSpeedMultiplier = 1.0;
        soundRef.current?.score();
      }

      // If blinking, skip normal ball movement
      return;
    }

    // Update human player (left paddle)
    if (keys['w'] && state.leftPaddleY > 0) {
      state.leftPaddleY -= BASE_PADDLE_SPEED;
    }
    if (keys['s'] && state.leftPaddleY < CANVAS_HEIGHT - PADDLE_HEIGHT) {
      state.leftPaddleY += BASE_PADDLE_SPEED;
    }

    // Update AI player (right paddle)
    const aiState = aiStateRef.current;
    aiState.frameCounter++;

    // Update AI target periodically when ball is approaching
    if (state.ballVelX > 0) {
      // Ball approaching AI - update target every 4 frames for accuracy
      if (aiState.frameCounter % 4 === 0) {
        const ballCenterY = state.ballY + BALL_SIZE / 2;
        const targetOffset = (Math.random() - 0.5) * 30; // Increased error: ±15px
        aiState.targetY = ballCenterY + targetOffset;
      }
    }
    aiState.lastBallDirection = state.ballVelX;

    // AI always moves toward some strategic position
    let targetY;

    if (state.ballVelX > 0) {
      // Ball approaching AI - move toward calculated target
      targetY = aiState.targetY;
    } else {
      // Ball moving away - move toward center ready position
      targetY = CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2;
    }

    // Move toward the target position
    const paddleCenterY = state.rightPaddleY + PADDLE_HEIGHT / 2;
    const diff = targetY - paddleCenterY;

    if (Math.abs(diff) > 5) { // Small dead zone to prevent jittering
      if (diff > 0 && state.rightPaddleY < CANVAS_HEIGHT - PADDLE_HEIGHT) {
        state.rightPaddleY += BASE_PADDLE_SPEED * 0.85; // Slightly slower than human
      }
      if (diff < 0 && state.rightPaddleY > 0) {
        state.rightPaddleY -= BASE_PADDLE_SPEED * 0.85;
      }
    }

    // Store previous position before updating
    state.prevBallX = state.ballX;

    // Update ball position (apply speed multiplier)
    state.ballX += state.ballVelX * state.currentSpeedMultiplier;
    state.ballY += state.ballVelY * state.currentSpeedMultiplier;

    // Ball collision with top and bottom walls
    if (state.ballY <= 0 || state.ballY >= CANVAS_HEIGHT - BALL_SIZE) {
      state.ballVelY = -state.ballVelY;
      soundRef.current?.wallBounce();
    }

    // Ball collision with left paddle (swept collision detection)
    if (state.prevBallX > PADDLE_WIDTH && state.ballX <= PADDLE_WIDTH &&
        state.ballY >= state.leftPaddleY &&
        state.ballY <= state.leftPaddleY + PADDLE_HEIGHT) {
      state.ballVelX = -state.ballVelX;
      const hitPos = (state.ballY - state.leftPaddleY) / PADDLE_HEIGHT;
      state.ballVelY = (hitPos - 0.5) * 8;

      // Move ball to paddle boundary to prevent sticking
      state.ballX = PADDLE_WIDTH + 1;

      // Increase speed by 10% on paddle hit
      state.currentSpeedMultiplier *= 1.1;

      soundRef.current?.paddleHit();
    }

    // Ball collision with right paddle (swept collision detection)
    const rightPaddleLeft = CANVAS_WIDTH - PADDLE_WIDTH;
    if (state.prevBallX < rightPaddleLeft - BALL_SIZE && state.ballX >= rightPaddleLeft - BALL_SIZE &&
        state.ballY >= state.rightPaddleY &&
        state.ballY <= state.rightPaddleY + PADDLE_HEIGHT) {
      state.ballVelX = -state.ballVelX;
      const hitPos = (state.ballY - state.rightPaddleY) / PADDLE_HEIGHT;
      state.ballVelY = (hitPos - 0.5) * 8;

      // Move ball to paddle boundary to prevent sticking
      state.ballX = rightPaddleLeft - BALL_SIZE - 1;

      // Increase speed by 10% on paddle hit
      state.currentSpeedMultiplier *= 1.1;

      soundRef.current?.paddleHit();
    }

    // Ball out of bounds (health loss)
    if (state.ballX < 0) {
      state.leftHealth -= 10;
      setLeftHealth(state.leftHealth);

      // Reset speed multiplier when point is scored
      state.currentSpeedMultiplier = 1.0;

      // Check for game over
      if (state.leftHealth <= 0) {
        state.isRunning = false;
        setIsRunning(false);
        setGameOver(true);
        setWinner('CPU');
        soundRef.current?.gameOver();
        return;
      }

      // Start blinking animation for left paddle (they missed)
      animState.blinkingPaddle = 'left';
      animState.blinkTimer = 0;
      animState.blinkCycleTimer = 0;
      animState.isBlinkVisible = true;

      // Stop ball movement during animation
      state.ballVelX = 0;
      state.ballVelY = 0;
    }
    if (state.ballX > CANVAS_WIDTH) {
      state.rightHealth -= 10;
      setRightHealth(state.rightHealth);

      // Reset speed multiplier when point is scored
      state.currentSpeedMultiplier = 1.0;

      // Check for game over
      if (state.rightHealth <= 0) {
        state.isRunning = false;
        setIsRunning(false);
        setGameOver(true);
        setWinner('PLAYER');
        soundRef.current?.gameOver();
        return;
      }

      // Start blinking animation for right paddle (they missed)
      animState.blinkingPaddle = 'right';
      animState.blinkTimer = 0;
      animState.blinkCycleTimer = 0;
      animState.isBlinkVisible = true;

      // Stop ball movement during animation
      state.ballVelX = 0;
      state.ballVelY = 0;
    }
  }, []);

  const gameLoop = useCallback(() => {
    if (gameStateRef.current.isRunning) {
      updateGame();
      draw();
      gameLoopRef.current = requestAnimationFrame(gameLoop);
    }
  }, [updateGame, draw]);

  const startGame = () => {
    if (gameOver) {
      // Reset game state for new game
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }

      gameStateRef.current = {
        ballX: CANVAS_WIDTH / 2,
        ballY: CANVAS_HEIGHT / 2,
        ballVelX: BASE_BALL_SPEED,
        ballVelY: 3,
        prevBallX: CANVAS_WIDTH / 2,
        leftPaddleY: 250,
        rightPaddleY: 250,
        leftHealth: 100,
        rightHealth: 100,
        isRunning: true,
        currentSpeedMultiplier: 1.0,
      };

      // Reset AI state
      aiStateRef.current = {
        targetY: 250,
        lastBallDirection: 0,
        frameCounter: 0,
      };

      // Reset animation state
      animationStateRef.current = {
        blinkingPaddle: null,
        blinkTimer: 0,
        blinkCycleTimer: 0,
        isBlinkVisible: true,
      };

      setIsRunning(true);
      setLeftHealth(100);
      setRightHealth(100);
      setGameOver(false);
      setWinner(null);
      soundRef.current?.gameStart();
      gameLoopRef.current = requestAnimationFrame(gameLoop);
      return;
    }

    gameStateRef.current.isRunning = true;
    setIsRunning(true);
    soundRef.current?.gameStart();
    gameLoopRef.current = requestAnimationFrame(gameLoop);
  };

  const pauseGame = () => {
    gameStateRef.current.isRunning = false;
    setIsRunning(false);
    soundRef.current?.gamePause();
    if (gameLoopRef.current) {
      cancelAnimationFrame(gameLoopRef.current);
    }
  };

  const toggleSound = () => {
    if (soundRef.current) {
      const newState = soundRef.current.toggleSound();
      setSoundEnabled(newState);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current[e.key] = true;

      // Handle pause/unpause/start with Enter key
      if (e.key === 'Enter') {
        e.preventDefault();
        if (isRunning) {
          pauseGame();
        } else {
          startGame(); // Handles both game over restart and normal start/unpause
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current[e.key] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isRunning, pauseGame]);

  useEffect(() => {
    soundRef.current = new SoundGenerator();
    draw();

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }
    };
  }, [draw]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black font-mono">

      {/* Health bars above game canvas - hide during overlays */}
      {isRunning && (
        <div className="flex justify-between w-full max-w-[800px] mb-4 text-green-400 font-mono text-lg">
          <div className="text-left">
            PLAYER: {createHealthBar(leftHealth)}
          </div>
          <div className="text-right">
            CPU: {createHealthBar(rightHealth)}
          </div>
        </div>
      )}

      <div className="relative">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="border-2 border-green-400 shadow-lg shadow-green-400/20"
          style={{ imageRendering: 'pixelated', backgroundColor: '#000000' }}
        />
        <div className="absolute -top-2 -left-2 w-2 h-2 bg-green-400"></div>
        <div className="absolute -top-2 -right-2 w-2 h-2 bg-green-400"></div>
        <div className="absolute -bottom-2 -left-2 w-2 h-2 bg-green-400"></div>
        <div className="absolute -bottom-2 -right-2 w-2 h-2 bg-green-400"></div>

        {gameOver && (
          <div className="absolute inset-0 bg-black bg-opacity-90 flex items-center justify-center">
            <div className="text-center text-green-400 font-mono">
              <div className="text-6xl font-bold mb-4">
                GAME OVER
              </div>
              <div className="text-lg text-green-300 animate-pulse">
                Press ENTER to play again
              </div>
            </div>
          </div>
        )}

        {!isRunning && !gameOver && (
          <div className="absolute inset-0 bg-black bg-opacity-90 flex items-center justify-center">
            <div className="text-center text-green-400 font-mono">
              <div className="text-4xl font-bold mb-4">
                PAUSED
              </div>
              <div className="text-lg text-green-300 animate-pulse">
                Press ENTER to continue
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sound toggle - hide during overlays */}
      {isRunning && (
        <div className="mt-6 text-green-400 text-center font-mono">
          <button
            onClick={toggleSound}
            className="px-3 py-2 bg-black text-green-400 border border-green-400 font-mono text-sm hover:bg-green-400 hover:text-black transition-all"
          >
            [ SOUND: {soundEnabled ? 'ON' : 'OFF'} ]
          </button>
        </div>
      )}

    </div>
  );
};

export default PongGame;
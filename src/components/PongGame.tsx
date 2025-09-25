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

type Screen = 'menu' | 'game' | 'play' | 'settings' | 'online';

const PongGame: React.FC = () => {
  const [currentScreen, setCurrentScreen] = useState<Screen>('menu');
  const [restartKey, setRestartKey] = useState(0);
  // Constants - define these first so they can be used in refs
  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 600;
  const PADDLE_WIDTH = 10;
  const PADDLE_HEIGHT = 100;
  const BALL_SIZE = 10;
  const BULLET_SIZE = 15;
  const BASE_PADDLE_SPEED = 8;
  const BASE_BALL_SPEED = 5;
  const BULLET_SPEED = 25;

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

  // CPU paddle pixel system (10 wide x 100 tall = 1000 pixels)
  const cpuPaddlePixelsRef = useRef<number[][]>([]);

  // Initialize CPU paddle pixels
  const initializeCpuPaddle = () => {
    const pixels: number[][] = [];
    for (let x = 0; x < PADDLE_WIDTH; x++) {
      pixels[x] = [];
      for (let y = 0; y < PADDLE_HEIGHT; y++) {
        pixels[x][y] = 1.0; // 1.0 = fully solid, 0.0 = destroyed
      }
    }
    return pixels;
  };

  // Global paddle health tracking - 5 bullets to destroy entire paddle
  const cpuPaddleHealthRef = useRef<number>(5);

  // Track how many pixels have been removed from top and bottom edges
  const cpuPaddleEdgesRef = useRef<{topPixelsRemoved: number, bottomPixelsRemoved: number}>({
    topPixelsRemoved: 0,
    bottomPixelsRemoved: 0
  });

  // Bullet system
  const bulletsRef = useRef<{x: number, y: number, vx: number, vy: number}[]>([]);
  const lastShotTimeRef = useRef(0);

  // Item system
  const itemsRef = useRef<{x: number, y: number, spawnTime: number, type: 'bullets'}[]>([]);
  const lastItemSpawnRef = useRef(0);

  // Only use useState for UI-reactive values
  const [isRunning, setIsRunning] = useState(false);
  const [leftHealth, setLeftHealth] = useState(100);
  const [rightHealth, setRightHealth] = useState(100);
  const [remainingBullets, setRemainingBullets] = useState(8);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [gameOver, setGameOver] = useState(false);
  const [winner, setWinner] = useState<'PLAYER' | 'CPU' | null>(null);
  const [noBulletsMessage, setNoBulletsMessage] = useState(false);

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

  const createBulletDisplay = (bullets: number) => {
    const bulletIcon = '■';
    const emptyIcon = '□';
    const maxBullets = 8; // Updated max to match new system
    const safeBullets = Math.max(0, Math.min(bullets, maxBullets)); // Clamp between 0 and 8
    const activeBullets = bulletIcon.repeat(safeBullets);
    const usedBullets = emptyIcon.repeat(maxBullets - safeBullets);
    return activeBullets + usedBullets;
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
    const animState = animationStateRef.current;

    // Draw left paddle (solid rectangle, only if not blinking or if blink is visible)
    if (animState.blinkingPaddle !== 'left' || animState.isBlinkVisible) {
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(0, state.leftPaddleY, PADDLE_WIDTH, PADDLE_HEIGHT);
    }

    // Draw right paddle (pixel by pixel, only if not blinking or if blink is visible)
    if (animState.blinkingPaddle !== 'right' || animState.isBlinkVisible) {
      const cpuPixels = cpuPaddlePixelsRef.current;
      const paddleX = CANVAS_WIDTH - PADDLE_WIDTH;

      // Ensure pixels are initialized
      if (cpuPixels.length === 0) {
        cpuPaddlePixelsRef.current = initializeCpuPaddle();
      }

      for (let x = 0; x < PADDLE_WIDTH; x++) {
        for (let y = 0; y < PADDLE_HEIGHT; y++) {
          const pixelHealth = cpuPixels[x]?.[y];
          if (pixelHealth && pixelHealth > 0) {
            // Set opacity based on pixel health
            ctx.globalAlpha = pixelHealth;
            ctx.fillStyle = '#00ff00';
            ctx.fillRect(paddleX + x, state.rightPaddleY + y, 1, 1);
          }
        }
      }
      ctx.globalAlpha = 1.0; // Reset alpha
    }

    // Draw ball with terminal green
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(state.ballX, state.ballY, BALL_SIZE, BALL_SIZE);

    // Draw bullets
    ctx.fillStyle = '#ffff00'; // Yellow bullets for contrast
    const bullets = bulletsRef.current;
    for (let i = 0; i < bullets.length; i++) {
      const bullet = bullets[i];
      ctx.fillRect(bullet.x, bullet.y, BULLET_SIZE, BULLET_SIZE); // Much bigger bullets (15x15)
    }

    // Draw items
    const items = itemsRef.current;
    const currentTime = Date.now();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemSize = 20;

      // Pulse effect - make items blink to attract attention
      const age = currentTime - item.spawnTime;
      const pulseRate = 0.002; // Speed of pulsing
      const opacity = 0.7 + 0.3 * Math.sin(age * pulseRate); // Pulse between 0.7 and 1.0

      if (item.type === 'bullets') {
        // Draw ammo box with pulsing effect
        ctx.globalAlpha = opacity;
        ctx.fillStyle = '#ffa500'; // Orange color for bullet items
        ctx.fillRect(item.x, item.y, itemSize, itemSize);

        // Draw inner bullets pattern [••]
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(item.x + 4, item.y + 8, 3, 3); // First bullet
        ctx.fillRect(item.x + 13, item.y + 8, 3, 3); // Second bullet
        ctx.globalAlpha = 1.0; // Reset alpha
      }
    }

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

    // Update bullets
    const bullets = bulletsRef.current;
    let cpuPixels = cpuPaddlePixelsRef.current;

    // Ensure pixels are initialized
    if (cpuPixels.length === 0) {
      cpuPixels = cpuPaddlePixelsRef.current = initializeCpuPaddle();
    }

    const paddleX = CANVAS_WIDTH - PADDLE_WIDTH;

    for (let i = bullets.length - 1; i >= 0; i--) {
      const bullet = bullets[i];

      // Move bullet
      bullet.x += bullet.vx;
      bullet.y += bullet.vy;

      // Remove bullets that go off screen (but allow them to hit the right edge)
      if (bullet.x > CANVAS_WIDTH + 20 || bullet.x < 0 || bullet.y < 0 || bullet.y > CANVAS_HEIGHT) {
        bullets.splice(i, 1);
        continue;
      }

      // Check collision with CPU paddle pixels (20x20 bullet)
      const bulletLeft = bullet.x;
      const bulletRight = bullet.x + BULLET_SIZE;
      const bulletTop = bullet.y;
      const bulletBottom = bullet.y + BULLET_SIZE;

      if (bulletRight > paddleX && bulletLeft < paddleX + PADDLE_WIDTH &&
          bulletBottom > state.rightPaddleY && bulletTop < state.rightPaddleY + PADDLE_HEIGHT) {

        console.log('💥 Bullet collision detected!', {
          bullet: {left: bulletLeft, right: bulletRight, top: bulletTop, bottom: bulletBottom},
          paddle: {x: paddleX, y: state.rightPaddleY, health: cpuPaddleHealthRef.current}
        });

        // Edge-shrinking destruction: bullet removes pixels from top and bottom edges
        let hitPixels = false;

        // Find the primary column based on bullet center
        const bulletCenterX = bullet.x + BULLET_SIZE / 2;
        const primaryColumn = Math.floor(bulletCenterX - paddleX);

        console.log('🔢 Column calculation:');
        console.log('  bulletX:', bullet.x, 'bulletCenterX:', bulletCenterX);
        console.log('  paddleX:', paddleX, 'primaryColumn:', primaryColumn);
        console.log('  paddleHealth:', cpuPaddleHealthRef.current);
        console.log('  columnValid:', primaryColumn >= 0 && primaryColumn < PADDLE_WIDTH);

        // Only damage if bullet hits valid column and paddle still has health
        if (primaryColumn >= 0 && primaryColumn < PADDLE_WIDTH && cpuPaddleHealthRef.current > 0) {
          console.log('🔍 Checking primary column:', primaryColumn, 'CPU paddle health:', cpuPaddleHealthRef.current);

          // Check if bullet actually overlaps with any solid pixel in this column
          let foundOverlap = false;
          let pixelsChecked = 0;
          let solidPixels = 0;
          let overlappingPixels = 0;

          for (let py = 0; py < PADDLE_HEIGHT; py++) {
            const pixelLeft = paddleX + primaryColumn;
            const pixelRight = pixelLeft + 1;
            const pixelTop = state.rightPaddleY + py;
            const pixelBottom = pixelTop + 1;

            pixelsChecked++;
            const pixelHealth = cpuPixels[primaryColumn] && cpuPixels[primaryColumn][py] !== undefined ? cpuPixels[primaryColumn][py] : 'undefined';

            if (pixelHealth > 0) {
              solidPixels++;
            }

            // Check if bullet overlaps this pixel
            if (bulletLeft < pixelRight && bulletRight > pixelLeft &&
                bulletTop < pixelBottom && bulletBottom > pixelTop) {

              overlappingPixels++;
              console.log(`🎯 Pixel overlap at [${primaryColumn}, ${py}] health:`, pixelHealth);

              // Check if this pixel is solid
              if (cpuPixels[primaryColumn] && cpuPixels[primaryColumn][py] !== undefined && cpuPixels[primaryColumn][py] > 0) {
                foundOverlap = true;
                console.log('✅ Found solid pixel to damage!');
                break;
              }
            }
          }

          console.log('📊 Pixel check summary:', {
            pixelsChecked,
            solidPixels,
            overlappingPixels,
            foundSolidOverlap: foundOverlap
          });

          // If we found overlap with solid pixels, shrink the paddle from edges
          if (foundOverlap) {
            console.log('🎯 Hit confirmed! Reducing paddle health from', cpuPaddleHealthRef.current, 'to', cpuPaddleHealthRef.current - 1);

            // Play bullet impact sound
            soundRef.current?.bulletImpact();

            cpuPaddleHealthRef.current--; // Reduce global paddle health

            // Calculate how many pixels to remove from each edge (20 pixels total per hit)
            const pixelsPerHit = Math.floor(PADDLE_HEIGHT / 5); // 100 / 5 = 20 pixels per hit
            const pixelsFromEachEdge = Math.floor(pixelsPerHit / 2); // 10 pixels from each edge

            const edges = cpuPaddleEdgesRef.current;

            // Remove pixels from top and bottom edges across all columns
            for (let col = 0; col < PADDLE_WIDTH; col++) {
              if (cpuPixels[col]) {
                // Remove from top edge - start from where we left off
                const topStart = edges.topPixelsRemoved;
                const topEnd = Math.min(topStart + pixelsFromEachEdge, PADDLE_HEIGHT / 2);
                for (let y = topStart; y < topEnd; y++) {
                  if (cpuPixels[col][y] !== undefined) {
                    cpuPixels[col][y] = 0;
                  }
                }

                // Remove from bottom edge - start from where we left off
                const bottomStart = Math.max(PADDLE_HEIGHT - edges.bottomPixelsRemoved - pixelsFromEachEdge, PADDLE_HEIGHT / 2);
                const bottomEnd = PADDLE_HEIGHT - edges.bottomPixelsRemoved;
                for (let y = bottomStart; y < bottomEnd; y++) {
                  if (cpuPixels[col][y] !== undefined) {
                    cpuPixels[col][y] = 0;
                  }
                }
              }
            }

            // Update edge tracking
            edges.topPixelsRemoved = Math.min(edges.topPixelsRemoved + pixelsFromEachEdge, PADDLE_HEIGHT / 2);
            edges.bottomPixelsRemoved = Math.min(edges.bottomPixelsRemoved + pixelsFromEachEdge, PADDLE_HEIGHT / 2);

            console.log('🔥 Paddle damaged! Edge tracking:', {
              topRemoved: edges.topPixelsRemoved,
              bottomRemoved: edges.bottomPixelsRemoved,
              pixelsRemovedThisHit: pixelsFromEachEdge * 2
            });

            // Play paddle damage sound (separate from bullet impact)
            setTimeout(() => soundRef.current?.paddleDamaged(), 100);

            hitPixels = true;
          }
        }

        if (hitPixels) {
          // Remove the bullet after hitting pixels
          bullets.splice(i, 1);
        }
      }
    }

    // Update items
    const currentTime = Date.now();
    const items = itemsRef.current;

    // Spawn new items every 12-15 seconds
    const spawnInterval = 12000 + Math.random() * 3000; // 12-15 seconds
    if (currentTime - lastItemSpawnRef.current > spawnInterval) {
      // Spawn right at the left edge where paddle is
      const safeX = 0; // Right against the left edge
      const safeY = 50 + Math.random() * (CANVAS_HEIGHT - 100); // Random Y across safe range

      items.push({
        x: safeX,
        y: safeY,
        spawnTime: currentTime,
        type: 'bullets'
      });

      lastItemSpawnRef.current = currentTime;
      console.log('📦 Bullet item spawned at:', safeX.toFixed(0), safeY.toFixed(0));

      // Play item spawn sound
      soundRef.current?.itemSpawned();
    }

    // Remove expired items (10 second lifespan)
    for (let i = items.length - 1; i >= 0; i--) {
      if (currentTime - items[i].spawnTime > 10000) {
        console.log('⏰ Item expired and removed');
        items.splice(i, 1);
      }
    }

    // Check for paddle-item collisions
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      const itemSize = 20; // Size of item box

      // Check collision with left paddle (player)
      if (item.x < PADDLE_WIDTH + itemSize &&
          item.x + itemSize > 0 &&
          item.y < state.leftPaddleY + PADDLE_HEIGHT &&
          item.y + itemSize > state.leftPaddleY) {

        // Collect the item!
        if (item.type === 'bullets') {
          const newBulletCount = Math.min(remainingBullets + 2, 8); // Max 8 bullets
          setRemainingBullets(newBulletCount);
          console.log('🎯 Bullet item collected! Bullets:', remainingBullets, '→', newBulletCount);

          // Play collection sound
          soundRef.current?.itemCollected();
        }

        // Remove the collected item
        items.splice(i, 1);
      }
    }

    // Update human player (left paddle)
    if (keys['w'] && state.leftPaddleY > 0) {
      state.leftPaddleY -= BASE_PADDLE_SPEED;
      console.log('Moving paddle UP, new Y:', state.leftPaddleY);
    }
    if (keys['s'] && state.leftPaddleY < CANVAS_HEIGHT - PADDLE_HEIGHT) {
      state.leftPaddleY += BASE_PADDLE_SPEED;
      console.log('Moving paddle DOWN, new Y:', state.leftPaddleY);
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

    // Ball collision with right paddle (pixel-based collision detection)
    const rightPaddleLeft = CANVAS_WIDTH - PADDLE_WIDTH;
    if (state.prevBallX < rightPaddleLeft && state.ballX + BALL_SIZE > rightPaddleLeft &&
        state.ballY + BALL_SIZE > state.rightPaddleY &&
        state.ballY < state.rightPaddleY + PADDLE_HEIGHT) {

      // Debug: Check if collision detection is running
      console.log('🏓 Ball collision check starting');

      // Proper pixel collision: check only where ball actually overlaps paddle
      let hitSolidPixel = false;
      let totalPixelsChecked = 0;
      let solidPixelsFound = 0;
      let overlappingPixels = 0;

      // Calculate ball's collision area with paddle
      const ballLeft = state.ballX;
      const ballRight = state.ballX + BALL_SIZE;
      const ballTop = state.ballY;
      const ballBottom = state.ballY + BALL_SIZE;

      console.log('Ball bounds:', { ballLeft, ballRight, ballTop, ballBottom });
      console.log('Paddle bounds:', { paddleLeft: rightPaddleLeft, paddleRight: rightPaddleLeft + PADDLE_WIDTH, paddleTop: state.rightPaddleY, paddleBottom: state.rightPaddleY + PADDLE_HEIGHT });

      // Check only paddle pixels that overlap with the ball
      for (let x = 0; x < PADDLE_WIDTH; x++) {
        for (let y = 0; y < PADDLE_HEIGHT; y++) {
          const pixelLeft = rightPaddleLeft + x;
          const pixelRight = pixelLeft + 1;
          const pixelTop = state.rightPaddleY + y;
          const pixelBottom = pixelTop + 1;

          totalPixelsChecked++;

          // Check pixel health
          const pixelHealth = cpuPixels[x] && cpuPixels[x][y] !== undefined ? cpuPixels[x][y] : 'undefined';
          if (pixelHealth > 0) {
            solidPixelsFound++;
          }

          // Check if ball overlaps this specific pixel
          if (ballLeft < pixelRight && ballRight > pixelLeft &&
              ballTop < pixelBottom && ballBottom > pixelTop) {

            overlappingPixels++;
            console.log(`Pixel overlap found at [${x},${y}] health: ${pixelHealth}`);

            // Check if this overlapping pixel is solid (health > 0)
            if (cpuPixels[x] && cpuPixels[x][y] && cpuPixels[x][y] > 0) {
              hitSolidPixel = true;
              console.log('✅ Solid pixel hit! Ball should bounce');
              break;
            } else {
              console.log('❌ Destroyed pixel, ball passes through');
            }
          }
        }
        if (hitSolidPixel) break;
      }

      console.log(`Collision summary: ${totalPixelsChecked} pixels checked, ${solidPixelsFound} solid, ${overlappingPixels} overlapping, hitSolid: ${hitSolidPixel}`);

      if (hitSolidPixel) {
        state.ballVelX = -state.ballVelX;
        const hitPos = (state.ballY - state.rightPaddleY) / PADDLE_HEIGHT;
        state.ballVelY = (hitPos - 0.5) * 8;

        // Move ball to paddle boundary to prevent sticking
        state.ballX = rightPaddleLeft - BALL_SIZE - 1;

        // Increase speed by 10% on paddle hit
        state.currentSpeedMultiplier *= 1.1;

        soundRef.current?.paddleHit();
      }
    }

    // Ball out of bounds (health loss)
    if (state.ballX < 0) {
      state.leftHealth -= 10;
      setLeftHealth(state.leftHealth);

      // Play health loss sound
      soundRef.current?.healthLoss();

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

      // Play health loss sound
      soundRef.current?.healthLoss();

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

      // Reset CPU paddle pixels and health
      cpuPaddlePixelsRef.current = initializeCpuPaddle();
      cpuPaddleHealthRef.current = 5;
      cpuPaddleEdgesRef.current = { topPixelsRemoved: 0, bottomPixelsRemoved: 0 };

      // Clear all bullets and items
      bulletsRef.current = [];
      itemsRef.current = [];
      lastItemSpawnRef.current = 0;

      setIsRunning(true);
      setLeftHealth(100);
      setRightHealth(100);
      setRemainingBullets(8);
      setGameOver(false);
      setWinner(null);
      setNoBulletsMessage(false);
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

      // ESC key - return to menu from any screen
      if (e.key === 'Escape' && currentScreen !== 'menu') {
        e.preventDefault();
        setCurrentScreen('menu');
        return;
      }

      // Handle pause/unpause/start with Enter key
      if (e.key === 'Enter') {
        e.preventDefault();
        if (isRunning) {
          pauseGame();
        } else {
          startGame(); // Handles both game over restart and normal start/unpause
        }
      }

      // Handle shooting with spacebar
      if (e.key === ' ' && isRunning) {
        e.preventDefault();
        const currentTime = Date.now();

        // Rate limit shooting (300ms cooldown)
        if (currentTime - lastShotTimeRef.current > 300) {
          // Check if player has bullets remaining
          if (remainingBullets > 0) {
            const paddleCenterY = gameStateRef.current.leftPaddleY + PADDLE_HEIGHT / 2;

            // Create bullet from left paddle center
            const newBullet = {
              x: PADDLE_WIDTH + 2, // Start just to the right of left paddle
              y: paddleCenterY - BULLET_SIZE / 2, // Center the bullet vertically
              vx: BULLET_SPEED, // Much faster bullet speed
              vy: 0  // Straight horizontal shot
            };
            bulletsRef.current.push(newBullet);
            console.log('🔫 Bullet fired!', newBullet, 'Remaining bullets:', remainingBullets - 1);

            // Play bullet firing sound
            soundRef.current?.bulletFired();

            // Decrease bullet count
            setRemainingBullets(remainingBullets - 1);
          } else {
            // No bullets remaining - play empty gun sound and show message
            soundRef.current?.emptyGun();
            setNoBulletsMessage(true);

            // Hide message after 1 second
            setTimeout(() => setNoBulletsMessage(false), 1000);
          }

          lastShotTimeRef.current = currentTime;
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
  }, [isRunning, pauseGame, currentScreen]);

  useEffect(() => {
    soundRef.current = new SoundGenerator();
    // Initialize CPU paddle pixels and health on component mount
    cpuPaddlePixelsRef.current = initializeCpuPaddle();
    cpuPaddleHealthRef.current = 5;
    cpuPaddleEdgesRef.current = { topPixelsRemoved: 0, bottomPixelsRemoved: 0 };
    draw();

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }
    };
  }, [draw]);

  // Main Menu Component
  const MainMenu = () => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black font-mono text-green-400">
      <div className="text-center space-y-8">
        {/* Title - Clean and Simple */}
        <div className="text-center mb-16">
          <div className="text-8xl font-bold text-green-400 mb-4 tracking-wider">
            PONGY MAN
          </div>
          <div className="text-xl text-green-300 mb-8">
            ████████████████████████████████
          </div>
          <div className="text-lg text-green-300">
            [ DESTRUCTIBLE PADDLE EDITION ]
          </div>
        </div>

        {/* Menu Options */}
        <div className="space-y-6 text-2xl">
          <button
            onClick={() => {
              soundRef.current?.menuClick();
              setCurrentScreen('game');
              startGame();
            }}
            onMouseEnter={() => soundRef.current?.menuHover()}
            className="block w-full px-8 py-4 border-2 border-green-400 bg-black text-green-400 hover:bg-green-400 hover:text-black transition-colors duration-200 font-mono"
          >
            [ STORY MODE ]
          </button>

          <button
            onClick={() => {
              soundRef.current?.menuClick();
              setCurrentScreen('play');
            }}
            onMouseEnter={() => soundRef.current?.menuHover()}
            className="block w-full px-8 py-4 border-2 border-green-400 bg-black text-green-400 hover:bg-green-400 hover:text-black transition-colors duration-200 font-mono"
          >
            [ PLAY ]
          </button>

          <button
            onClick={() => {
              soundRef.current?.menuClick();
              setCurrentScreen('online');
            }}
            onMouseEnter={() => soundRef.current?.menuHover()}
            className="block w-full px-8 py-4 border-2 border-green-400 bg-black text-green-400 hover:bg-green-400 hover:text-black transition-colors duration-200 font-mono"
          >
            [ ONLINE ]
          </button>

          <button
            onClick={() => {
              soundRef.current?.menuClick();
              setCurrentScreen('settings');
            }}
            onMouseEnter={() => soundRef.current?.menuHover()}
            className="block w-full px-8 py-4 border-2 border-green-400 bg-black text-green-400 hover:bg-green-400 hover:text-black transition-colors duration-200 font-mono"
          >
            [ SETTINGS ]
          </button>
        </div>
      </div>
    </div>
  );

  // Placeholder Screens
  const PlaceholderScreen = ({ title, onBack }: { title: string, onBack: () => void }) => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black font-mono text-green-400">
      <div className="text-center space-y-8">
        <h1 className="text-4xl font-bold">{title}</h1>
        <p className="text-xl">Coming Soon...</p>
        <button
          onClick={() => {
            soundRef.current?.menuClick();
            onBack();
          }}
          onMouseEnter={() => soundRef.current?.menuHover()}
          className="px-8 py-4 border-2 border-green-400 bg-black text-green-400 hover:bg-green-400 hover:text-black transition-colors duration-200 font-mono"
        >
          [ BACK TO MENU ]
        </button>
      </div>
    </div>
  );

  const PlatformerScreen = ({ onBack }: { onBack: () => void }) => {
    const platformerCanvasRef = useRef<HTMLCanvasElement>(null);
    const platformerLoopRef = useRef<number>();
    const [gameOver, setGameOver] = useState(false);

    // Character state
    const characterRef = useRef({
      x: 100, // Start further in the world
      y: 125,
      width: 24,
      height: 24,
      velocityX: 0,
      velocityY: 0,
      grounded: false,
      facingRight: true,
      currentAnimation: 'idle' as keyof typeof animations,
      currentFrame: 0,
      frameTimer: 0,
      isRunning: false,
    });

    // Camera state
    const cameraRef = useRef({
      x: 0,
      y: -130,
      targetX: 0,
      targetY: -130,
    });

    // Sprite animation data
    const animations = {
      idle: { frames: 2, row: 0, startCol: 0, speed: 30 },
      kick: { frames: 2, row: 0, startCol: 2, speed: 15 },
      attack: { frames: 2, row: 0, startCol: 4, speed: 15 },
      damage: { frames: 2, row: 0, startCol: 6, speed: 15 },
      walk: { frames: 4, row: 1, startCol: 0, speed: 6 },
      run: { frames: 4, row: 1, startCol: 4, speed: 3 },
      push: { frames: 4, row: 2, startCol: 0, speed: 12 },
      pull: { frames: 4, row: 2, startCol: 4, speed: 12 },
      jump: { frames: 8, row: 3, startCol: 0, speed: 6 },
      win: { frames: 4, row: 4, startCol: 0, speed: 15 },
      die: { frames: 4, row: 4, startCol: 4, speed: 15 },
      sit: { frames: 2, row: 5, startCol: 0, speed: 30 },
    };

    // Input handling
    const keysRef = useRef<{[key: string]: boolean}>({});

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        keysRef.current[e.key] = true;

        // Handle game over controls
        if (gameOver) {
          if (e.key === 'r' || e.key === 'R') {
            // Force complete component restart by incrementing key
            setRestartKey(prev => prev + 1);
            setGameOver(false);
            return;
          }
          if (e.key === 'Escape') {
            onBack();
            return;
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
    }, [gameOver, onBack]);

    // Game loop
    useEffect(() => {

      // Don't start game loop if game is over
      if (gameOver) {
        return;
      }

      const canvas = platformerCanvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Load sprite sheet
      const spriteImage = new Image();
      spriteImage.src = '/character-sprite.png';

      // Load tilemap
      const tilemapImage = new Image();
      tilemapImage.src = '/tilemap.png';

      // Load background image
      const backgroundImage = new Image();
      backgroundImage.src = '/background.png';

      // Load parallax background images
      const bgImage = new Image();
      bgImage.src = '/bg-layer.png';

      const midImage = new Image();
      midImage.src = '/mid-layer.png';

      const fgImage = new Image();
      fgImage.src = '/fg-layer.png';

      // Define level platforms - single long continuous platform + left wall
      const platforms = [
        // One long platform spanning the entire level, positioned right under character's starting position
        { type: 'rect', x: -150, y: 149, width: 4000, height: 20 },
        // Vertical wall at left end of platform - too high to jump over
        { type: 'rect', x: -150, y: 69, width: 20, height: 80 }
      ];

      const gameLoop = () => {
        const character = characterRef.current;
        const keys = keysRef.current;

        // Handle input and movement
        let newVelocityX = 0;
        let newAnimation: keyof typeof animations = 'idle';

        // Horizontal movement (adjusted speeds for zoom)
        if (keys['ArrowLeft']) {
          newVelocityX = keys['Shift'] ? -2.5 : -1.5;
          character.facingRight = false;
          newAnimation = keys['Shift'] ? 'run' : 'walk';
        } else if (keys['ArrowRight']) {
          newVelocityX = keys['Shift'] ? 2.5 : 1.5;
          character.facingRight = true;
          newAnimation = keys['Shift'] ? 'run' : 'walk';
        }

        // Attack actions
        if (keys['z'] || keys['Z']) {
          newAnimation = 'attack';
        } else if (keys['x'] || keys['X']) {
          newAnimation = 'kick';
        }

        // Jumping (adjusted for zoom)
        if (keys[' '] && character.grounded) {
          character.velocityY = -6;
          character.grounded = false;
          newAnimation = 'jump';
        }

        // Apply physics (adjusted gravity for zoom)
        character.velocityX = newVelocityX;
        character.velocityY += 0.3; // gravity

        // Simple wall blocking - prevent movement into left wall area
        const nextX = character.x + character.velocityX;

        // Left wall boundary check - if character would move into the wall area, stop them
        if (nextX < -130) { // Wall extends from x=-150 to x=-130
          character.x = -130; // Keep character at the wall boundary
          character.velocityX = 0; // Stop horizontal movement
        } else {
          character.x = nextX; // Normal movement
        }

        character.y += character.velocityY;

        // Platform collision detection
        character.grounded = false;
        for (const platform of platforms) {
          if (platform.type === 'rect') {
            // Check for overlap
            const overlapX = character.x + character.width > platform.x && character.x < platform.x + platform.width;
            const overlapY = character.y + character.height > platform.y && character.y < platform.y + platform.height;

            if (overlapX && overlapY) {
              // Determine if this is primarily a horizontal or vertical collision
              const overlapLeft = (character.x + character.width) - platform.x;
              const overlapRight = (platform.x + platform.width) - character.x;
              const overlapTop = (character.y + character.height) - platform.y;
              const overlapBottom = (platform.y + platform.height) - character.y;

              const minOverlapX = Math.min(overlapLeft, overlapRight);
              const minOverlapY = Math.min(overlapTop, overlapBottom);

              // If horizontal overlap is smaller, it's a horizontal collision (hitting wall from side)
              if (minOverlapX < minOverlapY && character.velocityX !== 0) {
                if (character.velocityX > 0) {
                  // Moving right, hit left side of wall
                  character.x = platform.x - character.width;
                } else {
                  // Moving left, hit right side of wall
                  character.x = platform.x + platform.width;
                }
                character.velocityX = 0;
              }
              // Otherwise it's a vertical collision (landing on top or hitting bottom)
              else if (character.velocityY >= 0 && character.y + character.height >= platform.y &&
                       character.y + character.height <= platform.y + 20) {
                character.y = platform.y - character.height;
                character.velocityY = 0;
                character.grounded = true;
                if (newAnimation === 'jump') {
                  newAnimation = character.velocityX !== 0 ? (Math.abs(character.velocityX) > 1.5 ? 'run' : 'walk') : 'idle';
                }
                break;
              }
            }
          } else if (platform.type === 'triangle') {
            // Simplified triangle collision (treat as sloped surface)
            const leftX = Math.min(platform.x1, platform.x2, platform.x3);
            const rightX = Math.max(platform.x1, platform.x2, platform.x3);
            const topY = Math.min(platform.y1, platform.y2, platform.y3);
            const bottomY = Math.max(platform.y1, platform.y2, platform.y3);

            if (character.x + character.width > leftX &&
                character.x < rightX &&
                character.y + character.height >= topY &&
                character.y + character.height <= bottomY + 10 &&
                character.velocityY >= 0) {

              // Calculate slope height at character position
              const charCenterX = character.x + character.width / 2;
              let slopeY;

              // Calculate slope based on the actual triangle shape
              // For the downward ramp: (500,100) -> (560,100) -> (560,130)
              // This creates a slope from (500,100) to (560,130)

              if (platform.x1 === 500 && platform.y1 === 100) { // Downward ramp specifically
                const progress = (charCenterX - platform.x1) / (platform.x3 - platform.x1);
                slopeY = platform.y1 + (platform.y3 - platform.y1) * progress;
              } else if (platform.x1 === 320 && platform.y1 === 140) { // Upward ramp specifically
                const progress = (charCenterX - platform.x1) / (platform.x2 - platform.x1);
                slopeY = platform.y1 + (platform.y2 - platform.y1) * progress;
              } else { // Mountain peak - use lowest point as base
                if (charCenterX <= 900) { // Left side of mountain
                  const progress = (charCenterX - platform.x1) / (platform.x2 - platform.x1);
                  slopeY = platform.y1 + (platform.y2 - platform.y1) * progress;
                } else { // Right side of mountain
                  const progress = (charCenterX - platform.x2) / (platform.x3 - platform.x2);
                  slopeY = platform.y2 + (platform.y3 - platform.y2) * progress;
                }
              }

              if (character.y + character.height >= slopeY - 5) {
                character.y = slopeY - character.height;
                character.velocityY = 0;
                character.grounded = true;
                if (newAnimation === 'jump') {
                  newAnimation = character.velocityX !== 0 ? (Math.abs(character.velocityX) > 1.5 ? 'run' : 'walk') : 'idle';
                }
                break;
              }
            }
          }
        }

        // No screen boundaries for character - they can move freely in world space

        // Update animation
        if (character.currentAnimation !== newAnimation) {
          character.currentAnimation = newAnimation;
          character.currentFrame = 0;
          character.frameTimer = 0;
        }

        // Animation timing
        character.frameTimer++;
        const animData = animations[character.currentAnimation];
        if (character.frameTimer >= animData.speed) {
          character.frameTimer = 0;
          character.currentFrame = (character.currentFrame + 1) % animData.frames;
        }

        // Set up crisp pixel rendering and zoom
        ctx.imageSmoothingEnabled = false;
        ctx.save();
        ctx.scale(2, 2); // 2x zoom for wider view

        const currentCamera = cameraRef.current;

        // Clear canvas (accounting for zoom)
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, canvas.width / 2, canvas.height / 2);

        // Define screen dimensions and ground thickness first
        const screenWidth = canvas.width / 2;
        const screenHeight = canvas.height / 2;
        const groundThickness = 20; // Fixed thin ground platform

        // Update camera to follow character
        const cameraState = cameraRef.current;
        const screenCenterX = screenWidth / 2;

        // Set camera target to follow character horizontally only - vertically locked
        cameraState.targetX = character.x + character.width / 2 - screenCenterX;
        // cameraState.targetY stays unchanged - vertically locked


        // Smooth camera movement (lerp)
        const lerpFactor = 0.1;
        cameraState.x += (cameraState.targetX - cameraState.x) * lerpFactor;
        cameraState.y += (cameraState.targetY - cameraState.y) * lerpFactor;

        // Check if character fell off screen (death condition)
        const cameraBottomY = cameraState.y + screenHeight;
        if (character.y > cameraBottomY + 100) { // 100px buffer below camera view
          setGameOver(true);
          return; // Stop the game loop
        }

        // Draw looping background
        if (backgroundImage.complete && backgroundImage.naturalHeight !== 0) {
          const bgWidth = backgroundImage.width;
          const bgHeight = backgroundImage.height;

          // Background offset (independent of camera) - change this to move background
          const backgroundOffsetX = 0; // Change this value to shift background left/right
          const backgroundOffsetY = 0; // Change this value to shift background up/down

          // Calculate background scroll position (slower than camera for parallax effect)
          const bgScrollX = currentCamera.x * 0.3 + backgroundOffsetX;

          // Scale background to fit screen height while preserving aspect ratio
          const scale = screenHeight / bgHeight;
          const scaledWidth = bgWidth * scale;
          const scaledHeight = screenHeight;

          // Draw repeating background tiles to cover the screen (using scaled width)
          const startX = Math.floor(-bgScrollX / scaledWidth) - 1;
          const endX = Math.ceil((screenWidth - bgScrollX) / scaledWidth) + 1;

          for (let x = startX; x <= endX; x++) {
            const drawX = x * scaledWidth - (bgScrollX % scaledWidth);

            const drawY = backgroundOffsetY; // Apply vertical offset
            ctx.drawImage(backgroundImage, drawX, drawY, scaledWidth, scaledHeight);
          }
        }

        // Draw all platforms
        ctx.fillStyle = '#00ff00';

        for (const platform of platforms) {
          if (platform.type === 'rect') {
            // Draw tiled platform using tilemap
            const screenX = platform.x - currentCamera.x;
            const screenY = platform.y - currentCamera.y;

            // Draw platform with tilemap tiles
            if (tilemapImage.complete && tilemapImage.naturalHeight !== 0) {
              const tileSize = 16; // Each tile is 16x16 pixels

              // Single consistent tile set - solid black tiles from tilemap
              const tiles = {
                topLeft: { x: 272, y: 112 }, topMiddle: { x: 272, y: 112 }, topRight: { x: 272, y: 112 },
                middleLeft: { x: 272, y: 112 }, middle: { x: 272, y: 112 }, middleRight: { x: 272, y: 112 },
                bottomLeft: { x: 272, y: 112 }, bottomMiddle: { x: 272, y: 112 }, bottomRight: { x: 272, y: 112 }
              };

              // Draw tiles to fill the platform area
              const tilesX = Math.ceil(platform.width / tileSize);
              const tilesY = Math.ceil(platform.height / tileSize);

              for (let tx = 0; tx < tilesX; tx++) {
                for (let ty = 0; ty < tilesY; ty++) {
                  const destX = screenX + (tx * tileSize);
                  const destY = screenY + (ty * tileSize);

                  // Choose tile based on position
                  let selectedTile;
                  const isTop = ty === 0;
                  const isBottom = ty === tilesY - 1;
                  const isLeft = tx === 0;
                  const isRight = tx === tilesX - 1;

                  if (isTop && isLeft) selectedTile = tiles.topLeft;
                  else if (isTop && isRight) selectedTile = tiles.topRight;
                  else if (isTop) selectedTile = tiles.topMiddle;
                  else if (isBottom && isLeft) selectedTile = tiles.bottomLeft;
                  else if (isBottom && isRight) selectedTile = tiles.bottomRight;
                  else if (isBottom) selectedTile = tiles.bottomMiddle;
                  else if (isLeft) selectedTile = tiles.middleLeft;
                  else if (isRight) selectedTile = tiles.middleRight;
                  else selectedTile = tiles.middle;

                  // Clip the tile if it extends beyond platform bounds
                  const drawWidth = Math.min(tileSize, platform.width - (tx * tileSize));
                  const drawHeight = Math.min(tileSize, platform.height - (ty * tileSize));

                  ctx.drawImage(
                    tilemapImage,
                    selectedTile.x, selectedTile.y, drawWidth, drawHeight, // Source
                    destX, destY, drawWidth, drawHeight // Destination
                  );
                }
              }
            } else {
              // Fallback to green rectangle if tilemap isn't loaded yet
              ctx.fillRect(screenX, screenY, platform.width, platform.height);
            }
          } else if (platform.type === 'triangle') {
            // Draw triangle platform
            const screenX1 = platform.x1 - currentCamera.x;
            const screenY1 = platform.y1 - currentCamera.y;
            const screenX2 = platform.x2 - currentCamera.x;
            const screenY2 = platform.y2 - currentCamera.y;
            const screenX3 = platform.x3 - currentCamera.x;
            const screenY3 = platform.y3 - currentCamera.y;

            ctx.beginPath();
            ctx.moveTo(screenX1, screenY1);
            ctx.lineTo(screenX2, screenY2);
            ctx.lineTo(screenX3, screenY3);
            ctx.closePath();
            ctx.fill();
          }
        }

        // Draw black rectangle extending from left edge of screen to collision boundary, from top to bottom of screen
        ctx.fillStyle = '#000000';
        const redRectRightX = -130 - currentCamera.x; // Right edge at collision boundary
        const redRectTopY = 0;                        // Top edge of screen
        const redRectBottomY = screenHeight;          // Bottom edge of screen
        const redRectLeftX = 0;                       // Left edge of screen
        const redRectWidth = redRectRightX - redRectLeftX; // Width from screen edge to boundary
        const redRectHeight = redRectBottomY - redRectTopY; // Height from screen top to bottom
        ctx.fillRect(redRectLeftX, redRectTopY, redRectWidth, redRectHeight); // Rectangle spanning entire left area to collision boundary

        // Draw character sprite (convert world coordinates to screen coordinates)
        if (spriteImage.complete && spriteImage.naturalHeight !== 0) {
          const anim = animations[character.currentAnimation];
          const sourceX = (anim.startCol + character.currentFrame) * 24;
          const sourceY = anim.row * 24;

          // Convert character world position to screen position
          const characterScreenX = character.x - currentCamera.x;
          const characterScreenY = character.y - currentCamera.y;


          ctx.save();
          if (!character.facingRight) {
            ctx.scale(-1, 1);
            ctx.drawImage(
              spriteImage,
              sourceX, sourceY, 24, 24,
              -(characterScreenX + character.width), characterScreenY, character.width, character.height
            );
          } else {
            ctx.drawImage(
              spriteImage,
              sourceX, sourceY, 24, 24,
              characterScreenX, characterScreenY, character.width, character.height
            );
          }
          ctx.restore();
        }

        // Draw controls in world coordinates with distance-based transparency
        const controlsWorldX = 70; // Center controls near character's starting position
        const controlsWorldY = 20; // Fixed world position
        const controlsScreenX = controlsWorldX - cameraState.x;
        const controlsScreenY = controlsWorldY - cameraState.y;

        // Calculate horizontal distance-based opacity
        const characterCenterX = character.x + character.width / 2;
        const horizontalDistance = Math.abs(characterCenterX - controlsWorldX);

        // Opacity decreases with horizontal distance (max distance ~200px for full fade)
        const maxDistance = 200;
        const opacity = Math.max(0.1, 1 - (horizontalDistance / maxDistance));

        ctx.font = '8px monospace'; // Same size as menu buttons
        ctx.fillStyle = `rgba(0, 255, 0, ${opacity})`;

        ctx.fillText('Use ← → arrow keys to move', controlsScreenX, controlsScreenY);

        // Draw second controls copy further right
        const controls2WorldX = 530; // Position much further right (double the distance from 70 to 300)
        const controls2WorldY = 20; // Same Y position
        const controls2ScreenX = controls2WorldX - cameraState.x;
        const controls2ScreenY = controls2WorldY - cameraState.y;

        // Calculate horizontal distance-based opacity for second controls
        const horizontalDistance2 = Math.abs(characterCenterX - controls2WorldX);
        const opacity2 = Math.max(0.1, 1 - (horizontalDistance2 / maxDistance));

        ctx.font = '8px monospace'; // Same size as menu buttons
        ctx.fillStyle = `rgba(0, 255, 0, ${opacity2})`;

        ctx.fillText('Press SPACE to jump', controls2ScreenX, controls2ScreenY);

        // Draw third controls copy even further right
        const controls3WorldX = 1920; // Position moved right 20% more (1600 * 1.2 = 1920)
        const controls3WorldY = 20; // Same Y position
        const controls3ScreenX = controls3WorldX - cameraState.x;
        const controls3ScreenY = controls3WorldY - cameraState.y;

        // Calculate horizontal distance-based opacity for third controls
        const horizontalDistance3 = Math.abs(characterCenterX - controls3WorldX);
        const opacity3 = Math.max(0.1, 1 - (horizontalDistance3 / maxDistance));

        ctx.font = '8px monospace'; // Same size as menu buttons
        ctx.fillStyle = `rgba(0, 255, 0, ${opacity3})`;

        ctx.fillText('Press Z or X to have a little dance', controls3ScreenX, controls3ScreenY);

        // Draw fourth controls copy with double the distance between first and second
        const controls4WorldX = 990; // 70 + (460 * 2) = 70 + 920 = 990
        const controls4WorldY = 20; // Same Y position
        const controls4ScreenX = controls4WorldX - cameraState.x;
        const controls4ScreenY = controls4WorldY - cameraState.y;

        // Calculate horizontal distance-based opacity for fourth controls
        const horizontalDistance4 = Math.abs(characterCenterX - controls4WorldX);
        const opacity4 = Math.max(0.1, 1 - (horizontalDistance4 / maxDistance));

        ctx.font = '8px monospace'; // Same size as menu buttons
        ctx.fillStyle = `rgba(0, 255, 0, ${opacity4})`;

        ctx.fillText('Hold SHIFT to run faster', controls4ScreenX, controls4ScreenY);

        // Draw fifth controls copy very far from the third text
        const controls5WorldX = 3500; // Position very far from third text at 2465
        const controls5WorldY = 20; // Same Y position
        const controls5ScreenX = controls5WorldX - cameraState.x;
        const controls5ScreenY = controls5WorldY - cameraState.y;

        // Calculate horizontal distance-based opacity for fifth controls
        const horizontalDistance5 = Math.abs(characterCenterX - controls5WorldX);
        const opacity5 = Math.max(0.1, 1 - (horizontalDistance5 / maxDistance));

        ctx.font = '8px monospace'; // Same size as menu buttons
        ctx.fillStyle = `rgba(0, 255, 0, ${opacity5})`;

        ctx.fillText('Controls:', controls5ScreenX, controls5ScreenY);
        ctx.fillText('← → : Move', controls5ScreenX, controls5ScreenY + 15);
        ctx.fillText('Shift: Run', controls5ScreenX, controls5ScreenY + 30);
        ctx.fillText('Space: Jump', controls5ScreenX, controls5ScreenY + 45);
        ctx.fillText('Z: Attack', controls5ScreenX, controls5ScreenY + 60);
        ctx.fillText('X: Kick', controls5ScreenX, controls5ScreenY + 75);

        // Restore canvas transform
        ctx.restore();

        // Continue game loop only if game is not over
        if (!gameOver) {
          platformerLoopRef.current = requestAnimationFrame(gameLoop);
        }
      };

      gameLoop();

      return () => {
        if (platformerLoopRef.current) {
          cancelAnimationFrame(platformerLoopRef.current);
        }
      };
    }, [gameOver, restartKey]);

    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-black font-mono">
        <div className="mb-4">
          <button
            onClick={() => {
              soundRef.current?.menuClick();
              if (platformerLoopRef.current) {
                cancelAnimationFrame(platformerLoopRef.current);
              }
              onBack();
            }}
            onMouseEnter={() => soundRef.current?.menuHover()}
            className="px-6 py-2 border-2 border-green-400 bg-black text-green-400 hover:bg-green-400 hover:text-black transition-colors duration-200 font-mono"
          >
            [ BACK TO MENU ]
          </button>
        </div>

        <div className="relative">
          <canvas
            ref={platformerCanvasRef}
            width={800}
            height={600}
            className="border-2 border-white bg-black"
          />

          {gameOver && (
            <div className="absolute inset-0 bg-black bg-opacity-90 flex items-center justify-center">
              <div className="text-center text-green-400 font-mono">
                <div className="text-6xl font-bold mb-4">
                  GAME OVER
                </div>
                <div className="text-2xl mb-4">
                  You fell to your doom!
                </div>
                <div className="text-lg text-green-300 animate-pulse">
                  Press R to restart or ESC to return to menu
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Render current screen
  if (currentScreen === 'menu') {
    return <MainMenu />;
  }

  if (currentScreen === 'online') {
    return <PlaceholderScreen title="ONLINE MODE" onBack={() => setCurrentScreen('menu')} />;
  }

  if (currentScreen === 'settings') {
    return <PlaceholderScreen title="SETTINGS" onBack={() => setCurrentScreen('menu')} />;
  }

  if (currentScreen === 'play') {
    return <PlatformerScreen onBack={() => setCurrentScreen('menu')} />;
  }

  // Game screen (currentScreen === 'game')
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-black font-mono">

      {/* Health bars above game canvas - hide during overlays */}
      {isRunning && (
        <>
          <div className="flex justify-between w-full max-w-[800px] mb-2 text-green-400 font-mono text-lg">
            <div className="text-left">
              PLAYER: {createHealthBar(leftHealth)}
            </div>
            <div className="text-right">
              CPU: {createHealthBar(rightHealth)}
            </div>
          </div>

          {/* Bullet display */}
          <div className="flex justify-center w-full max-w-[800px] mb-4 text-yellow-400 font-mono text-lg relative">
            <div className="text-center">
              BULLETS: {createBulletDisplay(remainingBullets)}
            </div>

            {/* NO BULLETS message */}
            {noBulletsMessage && (
              <div className="absolute top-8 left-1/2 transform -translate-x-1/2 text-red-400 font-mono text-sm bg-black px-2 py-1 border border-red-400 animate-pulse">
                NO BULLETS!
              </div>
            )}
          </div>
        </>
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
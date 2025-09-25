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
  }, [isRunning, pauseGame]);

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
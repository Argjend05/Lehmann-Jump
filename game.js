/**
 * Tilt-Shift Dungeon - Main Game Logic
 */

// Configuration
const CONFIG = {
    fps: 60,
    physicsStepsPerFrame: 1, // Slowed down for better playability
    glowEffects: true
};

// Physics/Tile Types
const TYPE = {
    EMPTY: 0,
    WALL: 1,
    SAND: 2,
    SWITCH_OFF: 3,
    SWITCH_ON: 4,
    GOAL: 5,
    SPAWNER: 6,
    HAZARD: 7
};

// Base Colors
const COLORS = [
    'transparent', // 0: EMPTY (drawn as background)
    '#252538', // 1: WALL (Blueish grey)
    '#00D4FF', // 2: SAND (Base color, will be randomized slightly)
    '#FF0055', // 3: SWITCH_OFF (Neon Red)
    '#00FF66', // 4: SWITCH_ON (Neon Green)
    '#FFCC00', // 5: GOAL (Gold portal)
    '#FFFFFF', // 6: SPAWNER (White/Invisible mostly)
    '#AA00FF'  // 7: HAZARD (Acid purple)
];

// Globals
let canvas, ctx;
let width, height;
let gridW, gridH;
let cellSize;
let offsetX = 0, offsetY = 0;
let grid = [];
let currentFrame = 0;
let gravity = { x: 0, y: 1 };
let isPlaying = false;
let currentLevelNum = 1;
let levelComplete = false;
let totalSwitches = 0;
let activatedSwitches = new Set();

// Initialize DOM and Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('game-canvas');
    ctx = canvas.getContext('2d', { alpha: false });
    
    // UI Elements
    const startBtn = document.getElementById('start-btn');
    const nextBtn = document.getElementById('next-btn');
    const errorMsg = document.getElementById('error-msg');
    
    window.addEventListener('resize', handleResize);
    handleResize();

    startBtn.addEventListener('click', async () => {
        try {
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                const permissionState = await DeviceOrientationEvent.requestPermission();
                if (permissionState === 'granted') {
                    window.addEventListener('deviceorientation', handleOrientation);
                    startGame();
                } else {
                    errorMsg.innerText = "Permission refusée. Le jeu nécessite l'accès à l'accéléromètre.";
                }
            } else {
                window.addEventListener('deviceorientation', handleOrientation);
                startGame();
            }
        } catch (e) {
            errorMsg.innerText = "Utilisation de la souris pour simuler l'inclinaison.";
            window.addEventListener('mousemove', (e) => {
                const cx = window.innerWidth / 2;
                const cy = window.innerHeight / 2;
                let dx = e.clientX - cx;
                let dy = e.clientY - cy;
                const len = Math.sqrt(dx*dx + dy*dy) || 1;
                gravity.x = dx / len;
                gravity.y = dy / len;
            });
            startGame();
        }
    });

    nextBtn.addEventListener('click', () => {
        document.getElementById('win-screen').classList.add('hidden');
        currentLevelNum++;
        if (currentLevelNum > LEVELS.length) {
            currentLevelNum = 1; 
        }
        loadLevel(currentLevelNum);
        isPlaying = true;
    });
});

function handleResize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    
    // If playing, recompute cell size and offsets without destroying grid
    if (gridW && gridH) {
        computeOffsets();
    }
}

function computeOffsets() {
    let maxW = width - 40;
    let maxH = height - 120; // 120px padding for HUD at top
    cellSize = Math.max(2, Math.floor(Math.min(maxW / gridW, maxH / gridH)));
    offsetX = Math.floor((width - gridW * cellSize) / 2);
    offsetY = Math.floor((height - gridH * cellSize) / 2) + 20;
}

function initGrid(w, h) {
    gridW = w;
    gridH = h;
    grid = new Array(gridW);
    for (let x = 0; x < gridW; x++) {
        grid[x] = new Array(gridH);
        for (let y = 0; y < gridH; y++) {
            grid[x][y] = { type: TYPE.EMPTY, updated: -1 };
        }
    }
}

// Mobile Tilt Orientation mappings
function handleOrientation(event) {
    if (!event.beta && !event.gamma) return;
    
    let maxTilt = 40; // max responsiveness
    let gX = Math.max(-maxTilt, Math.min(maxTilt, event.gamma)) / maxTilt;
    
    // If phone is flat on table, beta=0. If held in hand vertically, beta=90.
    // Let's assume resting angle is ~45 degrees.
    let restingAngle = 45;
    let b = event.beta;
    if (b > 135) b = 135;
    if (b < -45) b = -45;
    
    let gY = (b - restingAngle) / maxTilt;
    gY = Math.max(-1, Math.min(1, gY));

    gravity.x = gX;
    gravity.y = gY;
    
    const len = Math.sqrt(gravity.x*gravity.x + gravity.y*gravity.y);
    if (len > 1) {
        gravity.x /= len;
        gravity.y /= len;
    }
}

function startGame() {
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    
    loadLevel(currentLevelNum);
    isPlaying = true;
    levelComplete = false;
    
    requestAnimationFrame(gameLoop);
}

function randomFluidColor() {
    // Generate slight hue variation around cyan/blue
    const hues = [180, 190, 200];
    const h = hues[Math.floor(Math.random() * hues.length)];
    const s = 90 + Math.random() * 10;
    const l = 50 + Math.random() * 20;
    return `hsl(${h}, ${s}%, ${l}%)`;
}

function loadLevel(num) {
    let idx = (num - 1) % LEVELS.length;
    let lvl = LEVELS[idx];
    
    // Update HUD
    document.getElementById('level-num').innerText = num + " - " + lvl.name;
    
    // Parse level map
    let map = lvl.map;
    let expandFactor = 4; // High resolution fluid (4x4 pixels per map character)
    let w = map[0].length * expandFactor;
    let h = map.length * expandFactor;
    
    initGrid(w, h);
    computeOffsets();
    
    totalSwitches = 0;
    activatedSwitches.clear();
    
    for (let y = 0; y < map.length; y++) {
        for (let x = 0; x < map[0].length; x++) {
            let char = map[y][x] || ' ';
            let currentSwitchId = 0;
            if (char === 'X') {
                totalSwitches++;
                currentSwitchId = totalSwitches;
            }
            
            for (let dy = 0; dy < expandFactor; dy++) {
                for (let dx = 0; dx < expandFactor; dx++) {
                    let cell = { type: TYPE.EMPTY, updated: -1 };
                    let cx = x * expandFactor + dx;
                    let cy = y * expandFactor + dy;
                    
                    if (char === '#') {
                        cell.type = TYPE.WALL;
                    } else if (char === 'S') {
                        // Place spawner in a 2x2 core to avoid huge spawn blocks
                        if (dx >= 1 && dx <= 2 && dy >= 1 && dy <= 2) {
                            cell.type = TYPE.SPAWNER; 
                            cell.params = { amount: 1500 }; // Ensure plenty of fluid
                        }
                    } else if (char === 'X') {
                        // Switch pad
                        if (dx >= 1 && dx <= 2 && dy >= 1 && dy <= 2) {
                            cell.type = TYPE.SWITCH_OFF;
                            cell.switchId = currentSwitchId;
                        }
                    } else if (char === '~') {
                        // Hazard block
                        cell.type = TYPE.HAZARD;
                    }
                    
                    grid[cx][cy] = cell;
                }
            }
        }
    }
    
    levelComplete = false;
}

// ---- PHYSICS ENGINE ---- //

function isEmpty(x, y) {
    if (x < 0 || x >= gridW || y < 0 || y >= gridH) return false;
    let t = grid[x][y].type;
    return t === TYPE.EMPTY || t === TYPE.SWITCH_OFF || t === TYPE.SWITCH_ON || t === TYPE.HAZARD;
}

function handleCollisionInteraction(x1, y1, x2, y2) {
    let t1 = grid[x1][y1].type;
    let t2 = grid[x2][y2].type;
    
    // Hazard wipes sand
    if ((t1 === TYPE.SAND && t2 === TYPE.HAZARD) || (t2 === TYPE.SAND && t1 === TYPE.HAZARD)) {
        if (t1 === TYPE.SAND) grid[x1][y1] = { type: TYPE.EMPTY, updated: currentFrame };
        if (t2 === TYPE.SAND) grid[x2][y2] = { type: TYPE.EMPTY, updated: currentFrame };
        return false; // didn't swap
    }
    
    // If it's a switch
    if (t1 === TYPE.SWITCH_OFF || t2 === TYPE.SWITCH_OFF) {
        if (t1 === TYPE.SAND || t2 === TYPE.SAND) {
            let sX = t1 === TYPE.SWITCH_OFF ? x1 : x2;
            let sY = t1 === TYPE.SWITCH_OFF ? y1 : y2;
            let sid = grid[sX][sY].switchId;
            
            // Turn all pixels of this switch ON
            let anyChange = false;
            for(let ix = 0; ix < gridW; ix++) {
                for(let iy = 0; iy < gridH; iy++) {
                    if (grid[ix][iy].type === TYPE.SWITCH_OFF && grid[ix][iy].switchId === sid) {
                        grid[ix][iy].type = TYPE.SWITCH_ON;
                        anyChange = true;
                    }
                }
            }
            if (anyChange) {
                activatedSwitches.add(sid);
                checkWinCondition();
            }
            return false; // Do not occupy the switch space
        }
    }
    
    // Normal swap
    let temp = grid[x1][y1];
    grid[x1][y1] = grid[x2][y2];
    grid[x2][y2] = temp;
    return true;
}

function checkWinCondition() {
    if (totalSwitches > 0 && activatedSwitches.size >= totalSwitches && !levelComplete) {
        levelComplete = true;
        setTimeout(() => {
            isPlaying = false;
            document.getElementById('win-screen').classList.remove('hidden');
        }, 1200);
    }
}

function updatePhysics() {
    currentFrame++;
    
    // 1. Spawners
    if (currentFrame % 2 === 0) {
        for (let x = 0; x < gridW; x++) {
            for (let y = 0; y < gridH; y++) {
                let cell = grid[x][y];
                if (cell.type === TYPE.SPAWNER && cell.params && cell.params.amount > 0) {
                    // Try to spawn a slow trickle (max 2 per frame per spawner)
                    let spawnedCount = 0;
                    for (let sx = -1; sx <= 1 && spawnedCount < 2; sx++) {
                        for (let sy = -1; sy <= 1 && spawnedCount < 2; sy++) {
                            let tx = x + sx, ty = y + sy;
                            if (tx>=0 && tx<gridW && ty>=0 && ty<gridH && grid[tx][ty].type === TYPE.EMPTY) {
                                grid[tx][ty] = { type: TYPE.SAND, updated: currentFrame, color: randomFluidColor() };
                                cell.params.amount--;
                                spawnedCount++;
                            }
                        }
                    }
                }
            }
        }
    }

    // Determine iteration direction
    let startY = gravity.y >= 0 ? gridH - 1 : 0;
    let endY = gravity.y >= 0 ? -1 : gridH;
    let dyIter = gravity.y >= 0 ? -1 : 1;

    let primaryDx = 0, primaryDy = 0;
    if (Math.abs(gravity.x) > 0.05) primaryDx = Math.sign(gravity.x);
    if (Math.abs(gravity.y) > 0.05) primaryDy = Math.sign(gravity.y);

    if (primaryDx === 0 && primaryDy === 0) return; // No gravity

    for (let y = startY; y !== endY; y += dyIter) {
        // Randomize X iteration avoiding deterministic biased sliding
        let xArr = [];
        for (let x=0; x<gridW; x++) xArr.push(x);
        for (let i = xArr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [xArr[i], xArr[j]] = [xArr[j], xArr[i]];
        }
        
        for (let x of xArr) {
            let cell = grid[x][y];
            
            if (cell.type === TYPE.SAND && cell.updated !== currentFrame) {
                let tX = x + primaryDx;
                let tY = y + primaryDy;
                
                // 1. Direct move
                if (isEmpty(tX, tY)) {
                    if (handleCollisionInteraction(x, y, tX, tY)) {
                        grid[tX][tY].updated = currentFrame;
                    }
                    continue;
                }
                
                // 2. Sliding
                if (primaryDx !== 0 && primaryDy !== 0) {
                    if (Math.random() > 0.5) {
                        if (isEmpty(x + primaryDx, y)) { if(handleCollisionInteraction(x,y,x+primaryDx,y)) grid[x+primaryDx][y].updated = currentFrame; continue; }
                        if (isEmpty(x, y + primaryDy)) { if(handleCollisionInteraction(x,y,x,y+primaryDy)) grid[x][y+primaryDy].updated = currentFrame; continue; }
                    } else {
                        if (isEmpty(x, y + primaryDy)) { if(handleCollisionInteraction(x,y,x,y+primaryDy)) grid[x][y+primaryDy].updated = currentFrame; continue; }
                        if (isEmpty(x + primaryDx, y)) { if(handleCollisionInteraction(x,y,x+primaryDx,y)) grid[x+primaryDx][y].updated = currentFrame; continue; }
                    }
                } else if (primaryDy !== 0) {
                    let slideDx = Math.sign(gravity.x) || (Math.random() > 0.5 ? 1 : -1);
                    if (isEmpty(x + slideDx, tY)) {
                        if(handleCollisionInteraction(x, y, x + slideDx, tY)) grid[x+slideDx][tY].updated = currentFrame; continue;
                    } else if (isEmpty(x - slideDx, tY)) {
                        if(handleCollisionInteraction(x, y, x - slideDx, tY)) grid[x-slideDx][tY].updated = currentFrame; continue;
                    }
                } else if (primaryDx !== 0) {
                    let slideDy = Math.sign(gravity.y) || (Math.random() > 0.5 ? 1 : -1);
                    if (isEmpty(tX, y + slideDy)) {
                        if(handleCollisionInteraction(x, y, tX, y + slideDy)) grid[tX][y+slideDy].updated = currentFrame; continue;
                    } else if (isEmpty(tX, y - slideDy)) {
                        if(handleCollisionInteraction(x, y, tX, y - slideDy)) grid[tX][y-slideDy].updated = currentFrame; continue;
                    }
                }
            }
        }
    }
}

// ---- RENDERING ---- //

function drawRoundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
}

function render() {
    // Clear screen
    ctx.fillStyle = '#05050A';
    ctx.fillRect(0, 0, width, height);
    
    // Draw background for grid to give it depth
    ctx.fillStyle = '#0A0A14';
    ctx.fillRect(offsetX, offsetY, gridW * cellSize, gridH * cellSize);

    for (let x = 0; x < gridW; x++) {
        for (let y = 0; y < gridH; y++) {
            let cell = grid[x][y];
            if (cell.type === TYPE.EMPTY) continue;
            
            let pX = offsetX + x * cellSize;
            let pY = offsetY + y * cellSize;
            // Pad slightly for visual anti-aliasing between cells manually
            let s = cellSize;
            
            ctx.shadowBlur = 0;

            if (cell.type === TYPE.SAND) {
                ctx.fillStyle = cell.color || COLORS[TYPE.SAND];
                ctx.fillRect(pX, pY, s + 0.5, s + 0.5);
            } else if (cell.type === TYPE.WALL) {
                ctx.fillStyle = COLORS[TYPE.WALL];
                ctx.fillRect(pX, pY, s + 0.5, s + 0.5);
            } else if (cell.type === TYPE.SWITCH_OFF || cell.type === TYPE.SWITCH_ON) {
                ctx.fillStyle = COLORS[cell.type];
                if (CONFIG.glowEffects) {
                    ctx.shadowColor = COLORS[cell.type];
                    ctx.shadowBlur = 10;
                }
                ctx.fillRect(pX, pY, s, s);
            } else if (cell.type === TYPE.SPAWNER) {
                ctx.fillStyle = COLORS[TYPE.SPAWNER];
                ctx.fillRect(pX, pY, s, s);
            } else if (cell.type === TYPE.HAZARD) {
                ctx.fillStyle = COLORS[TYPE.HAZARD];
                if (CONFIG.glowEffects) {
                    ctx.shadowColor = COLORS[TYPE.HAZARD];
                    ctx.shadowBlur = 10;
                }
                ctx.fillRect(pX, pY, s + 0.5, s + 0.5);
                
                // Bubble animation
                if (Math.random() > 0.98) {
                    ctx.fillStyle = '#E066FF';
                    ctx.fillRect(pX + Math.random()*s, pY + Math.random()*s, 2, 2);
                }
            }
        }
    }
    ctx.shadowBlur = 0;
}

function gameLoop() {
    if (!isPlaying) return;
    
    for(let i=0; i<CONFIG.physicsStepsPerFrame; i++) {
        updatePhysics();
    }
    
    render();
    requestAnimationFrame(gameLoop);
}

/**
 * Tilt-Shift Dungeon - Main Game Logic
 */

// Configuration
const CONFIG = {
    gridSize: 80, // Number of cells across the width
    fps: 60,
    gravityMultiplier: 0.1, // Responsiveness of gravity vector
};

// Physics/Tile Types
const TYPE = {
    EMPTY: 0,
    WALL: 1,
    SAND: 2,
    SWITCH_OFF: 3,
    SWITCH_ON: 4,
    GOAL: 5,
    SPAWNER: 6
};

// Colors
const COLORS = [
    '#05050A', // 0: EMPTY (Dark background)
    '#303045', // 1: WALL (Blueish grey)
    '#00E5FF', // 2: SAND (Neon Cyan fluid)
    '#FF0055', // 3: SWITCH_OFF (Neon Red)
    '#00FF66', // 4: SWITCH_ON (Neon Green)
    '#FFCC00', // 5: GOAL (Gold portal)
    '#FFFFFF'  // 6: SPAWNER (White)
];

// Globals
let canvas, ctx;
let width, height;
let gridW, gridH;
let cellSize;
let grid = [];
let currentFrame = 0;
let gravity = { x: 0, y: 1 }; // Default down
let isPlaying = false;
let currentLevelNum = 1;
let levelComplete = false;

// Helper to draw walls
function drawRect(rx, ry, rw, rh, type = TYPE.WALL) {
    for (let x = Math.floor(rx); x < Math.floor(rx + rw); x++) {
        for (let y = Math.floor(ry); y < Math.floor(ry + rh); y++) {
            if (x >= 0 && x < gridW && y >= 0 && y < gridH) {
                grid[x][y] = { type: type, updated: -1 };
            }
        }
    }
}

// Perimeter walls
function drawPerimeter() {
    drawRect(0, 0, gridW, 1);
    drawRect(0, gridH - 1, gridW, 1);
    drawRect(0, 0, 1, gridH);
    drawRect(gridW - 1, 0, 1, gridH);
}

// Levels
const LEVELS = [
    {
        // Level 1: Introduction (Fall down, tilt right)
        build: () => {
            drawPerimeter();
            // L-shape tunnel
            drawRect(0, gridH/2, gridW*0.6, 2);
            drawRect(gridW*0.6, gridH/2, 2, gridH/2);
            
            // Switch at bottom right of the tunnel
            grid[Math.floor(gridW*0.8)][Math.floor(gridH*0.8)] = { type: TYPE.SWITCH_OFF, updated: -1 };
            
            // Spawner top left
            grid[Math.floor(gridW*0.2)][10] = { type: TYPE.SPAWNER, updated: -1, params: { amount: 300 } };
        }
    },
    {
        // Level 2: The S-Curve Maze
        build: () => {
            drawPerimeter();
            // Shelves
            drawRect(0, gridH*0.33, gridW*0.8, 4);
            drawRect(gridW*0.2, gridH*0.66, gridW*0.8, 4);
            
            // Switch tucked under
            grid[Math.floor(gridW*0.1)][Math.floor(gridH*0.85)] = { type: TYPE.SWITCH_OFF, updated: -1 };
            
            // Spawner
            grid[Math.floor(gridW*0.5)][5] = { type: TYPE.SPAWNER, updated: -1, params: { amount: 400 } };
        }
    },
    {
        // Level 3: Dual Switches
        build: () => {
            drawPerimeter();
            drawRect(gridW/2 - 2, 0, 4, gridH*0.7); // Center divider
            drawRect(0, gridH*0.7 - 4, gridW*0.3, 4);
            drawRect(gridW*0.7, gridH*0.7 - 4, gridW*0.3, 4);
            
            // Switches in left and right pockets
            grid[Math.floor(gridW*0.1)][Math.floor(gridH*0.6)] = { type: TYPE.SWITCH_OFF, updated: -1 };
            grid[Math.floor(gridW*0.9)][Math.floor(gridH*0.6)] = { type: TYPE.SWITCH_OFF, updated: -1 };
            
            // Spawner in center, must split the sand
            grid[Math.floor(gridW/2)][Math.floor(gridH*0.8)] = { type: TYPE.SPAWNER, updated: -1, params: { amount: 200 } }; // Upside down logic! Users must tilt up
        }
    }
];

// Initialize DOM and Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('game-canvas');
    ctx = canvas.getContext('2d', { alpha: false }); // Optimize for no transparency
    
    // UI Elements
    const startBtn = document.getElementById('start-btn');
    const nextBtn = document.getElementById('next-btn');
    const errorMsg = document.getElementById('error-msg');
    
    // Resize handler
    window.addEventListener('resize', handleResize);
    handleResize();

    // Start Button Click
    startBtn.addEventListener('click', async () => {
        try {
            // Request Device Orientation Permission for iOS 13+
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                const permissionState = await DeviceOrientationEvent.requestPermission();
                if (permissionState === 'granted') {
                    window.addEventListener('deviceorientation', handleOrientation);
                    startGame();
                } else {
                    errorMsg.innerText = "Permission refusée. Le jeu nécessite l'accès à l'accéléromètre.";
                }
            } else {
                // Non-iOS 13+ devices
                window.addEventListener('deviceorientation', handleOrientation);
                startGame();
            }
        } catch (e) {
            errorMsg.innerText = "Erreur: " + e.message;
            // Fallback for desktop testing (mouse click acts as gravity target)
            window.addEventListener('mousemove', (e) => {
                const cx = window.innerWidth / 2;
                const cy = window.innerHeight / 2;
                let dx = e.clientX - cx;
                let dy = e.clientY - cy;
                const len = Math.sqrt(dx*dx + dy*dy) || 1;
                gravity.x = dx / len;
                gravity.y = dy / len;
            });
            startGame(); // Let desktop users play with mouse
        }
    });

    nextBtn.addEventListener('click', () => {
        document.getElementById('win-screen').classList.add('hidden');
        currentLevelNum++;
        // If we ran out of levels, just loop level 1 for now or generate
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
    
    gridW = CONFIG.gridSize;
    cellSize = width / gridW;
    gridH = Math.ceil(height / cellSize);
    
    // Only rebuild grid if game not playing (to avoid squashing particles)
    if (!isPlaying) {
        initGrid();
    }
}

function initGrid() {
    grid = new Array(gridW);
    for (let x = 0; x < gridW; x++) {
        grid[x] = new Array(gridH);
        for (let y = 0; y < gridH; y++) {
            grid[x][y] = { type: TYPE.EMPTY, updated: -1 };
        }
    }
}

// Mobile Tilt Orientation
function handleOrientation(event) {
    if (!event.beta || !event.gamma) return;
    
    // Usually beta is pitch (-180 to 180), gamma is roll (-90 to 90)
    // Tilted forward: beta increases. Tilted right: gamma increases.
    // Portrait mode mapping:
    // x gravity relies on gamma (left/right tilt)
    // y gravity relies on beta (forward/back tilt - minus baseline if needed, normally 0 is flat on table)

    // Normalize roughly to [-1, 1]
    let maxTilt = 45; // Degrees at which gravity is maxed
    
    // Clamp
    let gX = Math.max(-maxTilt, Math.min(maxTilt, event.gamma)) / maxTilt;
    let gY = Math.max(-maxTilt, Math.min(maxTilt, event.beta)) / maxTilt; // Assuming flat is 0. If holding up, beta is ~90.

    // If holding the phone mostly vertical (beta ~ 60-90), we might want to offset beta so that "neutral" is 60.
    // Let's assume the user holds it flat-ish like a tray, so 0 is neutral.

    gravity.x = gX;
    gravity.y = gY;
    
    // Ensure vector is not too long
    const len = Math.sqrt(gravity.x*gravity.x + gravity.y*gravity.y);
    if (len > 1) {
        gravity.x /= len;
        gravity.y /= len;
    }
}

function startGame() {
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('level-num').innerText = currentLevelNum;
    
    loadLevel(currentLevelNum);
    isPlaying = true;
    levelComplete = false;
    
    requestAnimationFrame(gameLoop);
}

function loadLevel(num) {
    initGrid();
    let idx = (num - 1) % LEVELS.length;
    LEVELS[idx].build();
    levelComplete = false;
}

// ---- PHYSICS ENGINE ----

// Returns true if cell is valid and empty
function isEmpty(x, y) {
    if (x < 0 || x >= gridW || y < 0 || y >= gridH) return false;
    return grid[x][y].type === TYPE.EMPTY || grid[x][y].type === TYPE.SWITCH_OFF || grid[x][y].type === TYPE.SWITCH_ON;
}

// Swaps two cells
function swap(x1, y1, x2, y2) {
    let temp = grid[x1][y1];
    grid[x1][y1] = grid[x2][y2];
    grid[x2][y2] = temp;
    
    // Check switch interactions
    if (grid[x1][y1].type === TYPE.SWITCH_OFF || grid[x2][y2].type === TYPE.SWITCH_OFF) {
        // Find which is the switch and which is sand
        let sX = grid[x1][y1].type === TYPE.SWITCH_OFF ? x1 : (grid[x2][y2].type === TYPE.SWITCH_OFF ? x2 : -1);
        let sY = grid[x1][y1].type === TYPE.SWITCH_OFF ? y1 : (grid[x2][y2].type === TYPE.SWITCH_OFF ? y2 : -1);
        let pX = grid[x1][y1].type === TYPE.SAND ? x1 : (grid[x2][y2].type === TYPE.SAND ? x2 : -1);
        let pY = grid[x1][y1].type === TYPE.SAND ? y1 : (grid[x2][y2].type === TYPE.SAND ? y2 : -1);
        
        if (sX !== -1 && pX !== -1) {
            // Activate switch
            grid[sX][sY].type = TYPE.SWITCH_ON;
            checkWinCondition();
        }
    }
}

function checkWinCondition() {
    let switchesOff = 0;
    for (let x=0; x<gridW; x++) {
        for (let y=0; y<gridH; y++) {
            if (grid[x][y].type === TYPE.SWITCH_OFF) switchesOff++;
        }
    }
    if (switchesOff === 0 && !levelComplete) {
        levelComplete = true;
        setTimeout(() => {
            isPlaying = false;
            document.getElementById('win-screen').classList.remove('hidden');
        }, 1000);
    }
}

function updatePhysics() {
    currentFrame++;
    
    // Spawners
    for (let x = 0; x < gridW; x++) {
        for (let y = 0; y < gridH; y++) {
            let cell = grid[x][y];
            if (cell.type === TYPE.SPAWNER) {
                if (cell.params && cell.params.amount > 0 && currentFrame % 2 === 0) {
                    // Try to spawn below
                    if (y + 1 < gridH && grid[x][y+1].type === TYPE.EMPTY) {
                        grid[x][y+1] = { type: TYPE.SAND, updated: currentFrame };
                        cell.params.amount--;
                    }
                }
            }
        }
    }

    // Determine iteration direction to avoid multiple moves per frame
    // Iterate from bottom up if gravity is down, top down if gravity is up
    let startY = gravity.y >= 0 ? gridH - 1 : 0;
    let endY = gravity.y >= 0 ? -1 : gridH;
    let dyIter = gravity.y >= 0 ? -1 : 1;

    let startX = gravity.x >= 0 ? gridW - 1 : 0;
    let endX = gravity.x >= 0 ? -1 : gridW;
    let dxIter = gravity.x >= 0 ? -1 : 1;

    // Discretize gravity vectors into preferred moves
    // We want a primary move direction, and secondary fallback directions
    
    // Convert gravity into primary grid vector
    // -1, 0, or 1
    let primaryDx = 0, primaryDy = 0;
    
    if (Math.abs(gravity.x) > 0.1) primaryDx = Math.sign(gravity.x);
    if (Math.abs(gravity.y) > 0.1) primaryDy = Math.sign(gravity.y);

    if (primaryDx === 0 && primaryDy === 0) return; // No gravity

    // Main physics pass
    for (let y = startY; y !== endY; y += dyIter) {
        // Randomize X iteration for natural settling
        let xArr = [];
        for (let x=0; x<gridW; x++) xArr.push(x);
        for (let i = xArr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [xArr[i], xArr[j]] = [xArr[j], xArr[i]];
        }
        
        for (let x of xArr) {
            let cell = grid[x][y];
            
            if (cell.type === TYPE.SAND && cell.updated !== currentFrame) {
                // Try to move in primary direction
                let tX = x + primaryDx;
                let tY = y + primaryDy;
                
                // 1. Direct move
                if (isEmpty(tX, tY)) {
                    swap(x, y, tX, tY);
                    grid[tX][tY].updated = currentFrame;
                    continue;
                }
                
                // 2. Sliding along edges if hitting a wall directly
                // If diagonal
                if (primaryDx !== 0 && primaryDy !== 0) {
                    if (Math.random() > 0.5) {
                        if (isEmpty(x + primaryDx, y)) { swap(x, y, x + primaryDx, y); grid[x+primaryDx][y].updated = currentFrame; continue; }
                        if (isEmpty(x, y + primaryDy)) { swap(x, y, x, y + primaryDy); grid[x][y+primaryDy].updated = currentFrame; continue; }
                    } else {
                        if (isEmpty(x, y + primaryDy)) { swap(x, y, x, y + primaryDy); grid[x][y+primaryDy].updated = currentFrame; continue; }
                        if (isEmpty(x + primaryDx, y)) { swap(x, y, x + primaryDx, y); grid[x+primaryDx][y].updated = currentFrame; continue; }
                    }
                } else if (primaryDy !== 0) {
                    // Straight vertical move fails, try sliding sideways
                    // Slide direction depends on slight x gravity
                    let slideDx = Math.sign(gravity.x) || (Math.random() > 0.5 ? 1 : -1);
                    if (isEmpty(x + slideDx, tY)) {
                        swap(x, y, x + slideDx, tY); grid[x+slideDx][tY].updated = currentFrame; continue;
                    } else if (isEmpty(x - slideDx, tY)) {
                        swap(x, y, x - slideDx, tY); grid[x-slideDx][tY].updated = currentFrame; continue;
                    }
                } else if (primaryDx !== 0) {
                    // Straight horizontal move fails, try sliding vertically
                    let slideDy = Math.sign(gravity.y) || (Math.random() > 0.5 ? 1 : -1);
                    if (isEmpty(tX, y + slideDy)) {
                        swap(x, y, tX, y + slideDy); grid[tX][y+slideDy].updated = currentFrame; continue;
                    } else if (isEmpty(tX, y - slideDy)) {
                        swap(x, y, tX, y - slideDy); grid[tX][y-slideDy].updated = currentFrame; continue;
                    }
                }
            }
        }
    }
}

// ---- RENDERING ----

function render() {
    // Fill background
    ctx.fillStyle = COLORS[0];
    ctx.fillRect(0, 0, width, height);

    // Draw cells
    for (let x = 0; x < gridW; x++) {
        for (let y = 0; y < gridH; y++) {
            let cell = grid[x][y];
            if (cell.type !== TYPE.EMPTY) {
                ctx.fillStyle = COLORS[cell.type];
                
                // Slightly larger rects to avoid pixel gaps, use floored coordinates
                let pX = Math.floor(x * cellSize);
                let pY = Math.floor(y * cellSize);
                let pS = Math.ceil(cellSize);
                
                ctx.fillRect(pX, pY, pS, pS);
            }
        }
    }
}

function gameLoop() {
    if (!isPlaying) return;
    
    // Can do multiple physics steps per frame for faster fluid
    updatePhysics();
    updatePhysics();
    
    render();
    
    requestAnimationFrame(gameLoop);
}

// --- CONSTANTS & SETTINGS ---
const GRAVITY = 1800;
const JUMP_FORCE = -1000;
const SPRING_FORCE = -1600;
const MAX_SPEED = 600;
const ACCELERATION = 4000;
const DECELERATION = 4000;
const PLATFORM_WIDTH = 75;
const PLATFORM_HEIGHT = 16;

// --- ECS FRAMEWORK ---
class Entity {
    constructor() {
        this.id = Math.random().toString(36).substr(2, 9);
        this.components = {};
        this.toBeRemoved = false;
    }
    addComponent(c) { this.components[c.name] = c; return this; }
    hasComponent(n) { return !!this.components[n]; }
    getComponent(n) { return this.components[n]; }
}

const entities = [];
let particles = [];
let stars = [];

function addEntity(e) { entities.push(e); }
function removeEntity(e) { e.toBeRemoved = true; }
function getEntities(req) {
    return entities.filter(e => !e.toBeRemoved && req.every(n => e.hasComponent(n)));
}
function cleanUpEntities() {
    for (let i = entities.length - 1; i >= 0; i--) {
        if (entities[i].toBeRemoved) entities.splice(i, 1);
    }
}

// --- COMPONENTS ---
function Transform(x, y, w, h) { return { name: 'transform', x, y, w, h }; }
function Velocity(vx, vy) { return { name: 'velocity', vx, vy }; }
function GravityCmp(f) { return { name: 'gravity', force: f }; }
function PlatformCmp(t) { return { name: 'platform', type: t, broken: false, speedX: (Math.random() > 0.5 ? 1 : -1) * (60 + Math.random()*60) }; }
function BonusCmp(t) { return { name: 'bonus', type: t }; } // 0:coin, 1:spring, 2:magnet, 3:rocket
function PlayerCmp() { return { name: 'player', magnetTime: 0, rocketTime: 0, coins: 0 }; }

// --- GLOBALS ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let cw = window.innerWidth, ch = window.innerHeight;
let cameraY = 0;
let highestPlatY = window.innerHeight;
let score = 0;
let lastTime = 0;
let animationFrameId;

const GAME_STATE = { MENU: 0, PLAYING: 1, GAMEOVER: 2 };
let currentState = GAME_STATE.MENU;
const input = { tiltX: 0, touchLeft: false, touchRight: false, keys: {} };

// --- DOM ELEMENTS ---
const $scoreEl = document.getElementById('scoreEl');
const $moneyEl = document.getElementById('moneyEl');
const $menuScreen = document.getElementById('menuScreen');
const $gameOverScreen = document.getElementById('gameOverScreen');
const $finalScore = document.getElementById('finalScore');
const $finalCoins = document.getElementById('finalCoins');
const $highScoreMenu = document.getElementById('highScoreMenu');

// --- SETUP RESIZE & STARS ---
function resize() {
    cw = window.innerWidth;
    ch = window.innerHeight;
    let ratio = window.devicePixelRatio || 1;
    canvas.width = cw * ratio;
    canvas.height = ch * ratio;
    canvas.style.width = cw + "px";
    canvas.style.height = ch + "px";
    ctx.scale(ratio, ratio);
    ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
resize();

for(let i=0; i<60; i++) {
    stars.push({
        x: Math.random() * 2000, 
        y: Math.random() * 2000, 
        size: 2 + Math.random() * 3,
        speed: 0.1 + Math.random() * 0.4,
        color: Math.random() > 0.5 ? '#fff' : '#aaa'
    });
}

// --- PARTICLES ---
function spawnParticles(x, y, color, num, speed=150) {
    for (let i = 0; i < num; i++) {
        particles.push({
            x: x, y: y,
            vx: (Math.random() - 0.5) * speed * 2,
            vy: (Math.random() - 0.5) * speed * 2,
            size: 4 + Math.random() * 6,
            life: 0.3 + Math.random() * 0.4,
            maxLife: 0.7,
            color: color
        });
    }
}
function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

// --- SYSTEMS ---
function InputSystem(dt) {
    getEntities(['player', 'velocity']).forEach(e => {
        let v = e.getComponent('velocity');
        let targetVx = 0;

        // Priority: Touch > Keyboard > Tilt
        if (input.touchLeft || input.keys['ArrowLeft']) targetVx = -1;
        else if (input.touchRight || input.keys['ArrowRight']) targetVx = 1;
        else if (Math.abs(input.tiltX) > 0.05) targetVx = input.tiltX;

        let targetSpeed = targetVx * MAX_SPEED;

        if (targetSpeed !== 0) {
            let isReversing = (targetSpeed < 0 && v.vx > 0) || (targetSpeed > 0 && v.vx < 0);
            let activeAccel = isReversing ? ACCELERATION * 4 : ACCELERATION;

            if (v.vx < targetSpeed) {
                v.vx += activeAccel * dt;
                if (v.vx > targetSpeed) v.vx = targetSpeed;
            } else if (v.vx > targetSpeed) {
                v.vx -= activeAccel * dt;
                if (v.vx < targetSpeed) v.vx = targetSpeed;
            }
        } else {
            let activeDecel = DECELERATION * 3;
            if (v.vx > 0) { v.vx -= activeDecel * dt; if (v.vx < 0) v.vx = 0; }
            else if (v.vx < 0) { v.vx += activeDecel * dt; if (v.vx > 0) v.vx = 0; }
        }
    });
}

function PhysicsSystem(dt) {
    getEntities(['transform', 'velocity']).forEach(e => {
        let t = e.getComponent('transform');
        let v = e.getComponent('velocity');
        
        let inRocketDelay = e.hasComponent('player') && e.getComponent('player').rocketTime > 0;
        
        if (e.hasComponent('gravity') && !inRocketDelay) {
            v.vy += e.getComponent('gravity').force * dt;
        } else if (inRocketDelay) {
            v.vy = -1600; // rocket speed overrides gravity
        }
        
        t.x += v.vx * dt;
        t.y += v.vy * dt;
        
        // Player Constraints
        if (e.hasComponent('player')) {
            if (t.x > cw) t.x = -t.w;
            if (t.x + t.w < 0) t.x = cw;
            
            if (t.y > cameraY + ch + 150) {
                setGameOver();
            }
            if (t.y < cameraY + ch * 0.4) {
                cameraY = t.y - ch * 0.4;
            }
        }
        
        // Moving Platforms
        if (e.hasComponent('platform')) {
            let pLogic = e.getComponent('platform');
            if (pLogic.type === 1) { 
                if (t.x <= 0) pLogic.speedX = Math.abs(pLogic.speedX);
                else if (t.x + t.w >= cw) pLogic.speedX = -Math.abs(pLogic.speedX);
                v.vx = pLogic.speedX;
            } else {
                v.vx = 0; 
            }
        }
    });
}

function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
}

function CollisionSystem(dt) {
    let pEnt = getEntities(['player'])[0];
    if (!pEnt) return;
    let pT = pEnt.getComponent('transform');
    let pV = pEnt.getComponent('velocity');
    let pLogic = pEnt.getComponent('player');
    
    // Bonuses Logic
    getEntities(['bonus', 'transform']).forEach(bEnt => {
        let bT = bEnt.getComponent('transform');
        let bType = bEnt.getComponent('bonus').type;
        
        // Magnet
        if (bType === 0 && pLogic.magnetTime > 0) {
            let dx = (pT.x + pT.w/2) - (bT.x + bT.w/2);
            let dy = (pT.y + pT.h/2) - (bT.y + bT.h/2);
            let dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < 400 && dist > 1) {
                let speed = 900 * (1 / (dist/200)); 
                bT.x += (dx/dist) * speed * dt; 
                bT.y += (dy/dist) * speed * dt;
            }
        }
        
        if (aabb(pT, bT)) {
            removeEntity(bEnt);
            
            if (bType === 0) { 
                pLogic.coins++; 
                score += 2; 
                spawnParticles(bT.x+10, bT.y+10, '#ffeb3b', 5, 50);
            } 
            if (bType === 1) { 
                pV.vy = SPRING_FORCE; 
                spawnParticles(pT.x+pT.w/2, pT.y+pT.h, '#e91e63', 10);
            } 
            if (bType === 2) { 
                pLogic.magnetTime = 8; 
                spawnParticles(bT.x+10, bT.y+10, '#9c27b0', 10);
            } 
            if (bType === 3) { 
                pLogic.rocketTime = 4; 
                spawnParticles(bT.x+10, bT.y+10, '#ff5722', 15);
            } 
        }
    });

    // Platform Collision
    if (pV.vy > 0 && pLogic.rocketTime <= 0) {
        getEntities(['platform', 'transform']).forEach(plat => {
            let platLogic = plat.getComponent('platform');
            if (platLogic.broken) return;
            let pt = plat.getComponent('transform');
            
            if (aabb(pT, pt)) {
                let prevBottom = pT.y - pV.vy * dt + pT.h;
                // Jump logic - if we were mostly above
                if (prevBottom <= pt.y + 24) { // Increased jump forgiveness
                    pV.vy = JUMP_FORCE;
                    spawnParticles(pT.x + pT.w/2, pT.y + pT.h, '#fff', 5, 80);
                    if (platLogic.type === 2) { // fragile
                        platLogic.broken = true;
                        removeEntity(plat);
                        spawnParticles(pt.x + pt.w/2, pt.y + pt.h/2, '#ffc107', 15, 200);
                    }
                }
            }
        });
    }
}

function SpawnerSystem() {
    while (highestPlatY > cameraY - ch - 150) {
        let currentAlt = Math.floor(-highestPlatY / 10);
        let difficulty = Math.min(1, currentAlt / 500); // reaches max around 5000 units
        
        let baseY = 70;
        let randomY = 50 + (difficulty * 100); 
        let gapY = baseY + Math.random() * randomY; 
        if (gapY > 260) gapY = 260; // Absolute max jump limit
        
        highestPlatY -= gapY;
        
        let type = 0;
        let r = Math.random();
        if (r < difficulty * 0.9) {
            if (Math.random() < 0.4) type = 1; // moving
            else type = 2; // fragile
        }
        
        let w = PLATFORM_WIDTH * (1 - difficulty * 0.4); 
        if (w < 40) w = 40;
        let h = PLATFORM_HEIGHT;
        
        let x = Math.random() * (cw - w);
        
        let plat = new Entity();
        plat.addComponent(Transform(x, highestPlatY, w, h));
        plat.addComponent(PlatformCmp(type));
        plat.addComponent(Velocity(0, 0));
        if (type === 1) plat.getComponent('velocity').vx = plat.getComponent('platform').speedX;
        addEntity(plat);
        
        // Spawn bonus (15% chance overall)
        if (Math.random() < 0.15 && type !== 2) {
            let bType = 0; 
            let br = Math.random();
            if (br > 0.6) bType = 1; // spring
            if (br > 0.8) bType = 2; // magnet
            if (br > 0.92) bType = 3; // rocket
            
            let item = new Entity();
            item.addComponent(Transform(x + w/2 - 12, highestPlatY - 32, 24, 24));
            item.addComponent(BonusCmp(bType));
            addEntity(item);
        }
    }
}

// --- RENDER SYSTEM ---
function renderSystem() {
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#171721';
    ctx.fillRect(0, 0, cw, ch);
    
    // Draw Parallax Stars
    stars.forEach(s => {
        let sx = s.x % cw;
        let sy = (s.y - cameraY * s.speed) % ch;
        if (sy < 0) sy += ch;
        ctx.fillStyle = s.color;
        ctx.globalAlpha = s.size / 5;
        ctx.fillRect(sx, sy, s.size, s.size);
    });
    ctx.globalAlpha = 1;
    
    ctx.save();
    ctx.translate(0, -cameraY);
    
    // Render Entities
    const renderables = getEntities(['transform']);

    renderables.forEach(e => {
        let t = e.getComponent('transform');
        
        if (e.hasComponent('platform')) {
            let pType = e.getComponent('platform');
            if (pType.broken) return;
            
            if (pType.type === 0) { ctx.fillStyle = '#8bc34a'; } // normal
            else if (pType.type === 1) { ctx.fillStyle = '#03a9f4'; } // moving
            else if (pType.type === 2) { ctx.fillStyle = '#ff9800'; } // fragile
            
            ctx.fillRect(t.x, t.y, t.w, t.h);
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fillRect(t.x, t.y, t.w, t.h/3);
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(t.x, t.y + t.h - t.h/3, t.w, t.h/3);
            
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.strokeRect(t.x, t.y, t.w, t.h);

        }
        else if (e.hasComponent('bonus')) {
            let bType = e.getComponent('bonus').type;
            if (bType === 0) ctx.fillStyle = '#ffeb3b'; // coin
            if (bType === 1) ctx.fillStyle = '#e91e63'; // spring
            if (bType === 2) ctx.fillStyle = '#9c27b0'; // magnet
            if (bType === 3) ctx.fillStyle = '#ff5722'; // rocket
            
            ctx.fillRect(t.x, t.y, t.w, t.h);
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.strokeRect(t.x, t.y, t.w, t.h);
            
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.fillRect(t.x + 2, t.y + 2, t.w - 4, 4);

            ctx.fillStyle = '#fff';
            if (bType === 0) { ctx.fillStyle = '#f57f17'; ctx.fillRect(t.x + 6, t.y + 6, 12, 12); }
            if (bType === 1) { ctx.fillRect(t.x + 6, t.y + 10, 12, 6); }
            if (bType === 2) { ctx.fillRect(t.x + 6, t.y + 6, 12, 12); ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(t.x + 10, t.y + 12, 4, 6); }
            if (bType === 3) { ctx.beginPath(); ctx.moveTo(t.x + t.w/2, t.y + 4); ctx.lineTo(t.x + t.w - 4, t.y + t.h - 4); ctx.lineTo(t.x + 4, t.y + t.h - 4); ctx.fill(); }
        }
    });

    // Render Player
    getEntities(['player']).forEach(e => {
        let t = e.getComponent('transform');
        let v = e.getComponent('velocity');
        let pCmp = e.getComponent('player');

        const drawBlob = (xOff) => {
            ctx.save();
            ctx.translate(t.x + t.w/2 + xOff, t.y + t.h);
            
            // Squash & Stretch dynamics
            let stretch = Math.max(-0.4, Math.min(1.0, Math.abs(v.vy) / 2000));
            let scaleY = 1 + stretch;
            let scaleX = 1 - stretch * 0.4;
            ctx.scale(scaleX, scaleY);
            
            // Magnet outline
            if (pCmp.magnetTime > 0) {
                ctx.fillStyle = '#9c27b0';
                ctx.fillRect(-t.w/2 - 4, -t.h - 4, t.w + 8, t.h + 8);
            }

            // Body
            ctx.fillStyle = pCmp.rocketTime > 0 ? '#ff5722' : '#00e5ff';
            ctx.fillRect(-t.w/2, -t.h, t.w, t.h);
            
            // Highlight
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fillRect(-t.w/2 + 2, -t.h + 2, t.w - 4, 6);
            
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.strokeRect(-t.w/2, -t.h, t.w, t.h);
            
            // Eyes
            ctx.fillStyle = '#000';
            let dir = Math.sign(v.vx) * 4;
            if(Math.abs(v.vx) < 50) dir = 0;
            ctx.fillRect(-t.w/2 + 6 + dir, -t.h + 8, 4, 6);
            ctx.fillRect(t.w/2 - 10 + dir, -t.h + 8, 4, 6);
            
            // Exhaust
            if (pCmp.rocketTime > 0) {
                ctx.fillStyle = '#ffeb3b';
                ctx.fillRect(-t.w/2 + 4, 0, t.w - 8, 15 + Math.random()*20);
                ctx.fillStyle = '#e65100';
                ctx.fillRect(-t.w/2 + 8, 5, t.w - 16, Math.random()*20);
            }
            
            ctx.restore();
        };

        drawBlob(0);
        if (t.x > cw - t.w) drawBlob(-cw);
        else if (t.x < 0) drawBlob(cw);

    });

    // Particles
    particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    ctx.globalAlpha = 1;
    
    ctx.restore();
}

// --- GAME LOOP ---
function gameLoop(time) {
    if (currentState !== GAME_STATE.PLAYING) return;
    animationFrameId = requestAnimationFrame(gameLoop);
    
    let dt = (time - lastTime) / 1000;
    lastTime = time;
    if (dt > 0.1) dt = 0.1; // clamp to prevent clipping
    
    let pEnt = getEntities(['player'])[0];
    if (pEnt) {
        let pLogic = pEnt.getComponent('player');
        if (pLogic.magnetTime > 0) pLogic.magnetTime -= dt;
        if (pLogic.rocketTime > 0) pLogic.rocketTime -= dt;
    }
    
    InputSystem(dt);
    PhysicsSystem(dt);
    CollisionSystem(dt);
    SpawnerSystem();
    
    // Cleanup
    entities.forEach(e => {
        if (e.hasComponent('transform') && e.getComponent('transform').y > cameraY + ch + 400) {
            removeEntity(e);
        }
    });
    cleanUpEntities();
    updateParticles(dt);
    
    renderSystem();
    
    // Update HUD
    let currentAlt = Math.max(0, Math.floor(-cameraY / 10));
    if (currentAlt > score) score = currentAlt;
    $scoreEl.innerText = score + 'm';
    if (pEnt) $moneyEl.innerText = pEnt.getComponent('player').coins;
}

function initGame() {
    entities.length = 0;
    particles.length = 0;
    cameraY = 0;
    score = 0;
    highestPlatY = window.innerHeight;
    $scoreEl.innerText = '0m';
    $moneyEl.innerText = '0';
    
    let p = new Entity();
    p.addComponent(Transform(cw/2 - 16, ch - 200, 32, 28));
    p.addComponent(Velocity(0, 0));
    p.addComponent(GravityCmp(GRAVITY));
    p.addComponent(PlayerCmp());
    addEntity(p);
    
    let base = new Entity();
    base.addComponent(Transform(cw/2 - PLATFORM_WIDTH, ch - 80, PLATFORM_WIDTH*2, 20));
    base.addComponent(PlatformCmp(0));
    addEntity(base);
    
    for (let i = 0; i < 20; i++) SpawnerSystem();
}

function setGameOver() {
    currentState = GAME_STATE.GAMEOVER;
    cancelAnimationFrame(animationFrameId);
    
    let maxHS = localStorage.getItem('pixelJumperHS') || 0;
    let pEnt = getEntities(['player'])[0];
    let coinsRound = pEnt ? pEnt.getComponent('player').coins : 0;
    
    if (score > maxHS) localStorage.setItem('pixelJumperHS', score);
    
    $finalScore.innerText = score;
    $finalCoins.innerText = coinsRound;
    $gameOverScreen.classList.remove('hidden');
}

// --- INPUT HANDLING ---
window.addEventListener('keydown', e => input.keys[e.code] = true);
window.addEventListener('keyup', e => input.keys[e.code] = false);

canvas.addEventListener('touchstart', e => updateTouch(e), {passive: false});
canvas.addEventListener('touchmove', e => updateTouch(e), {passive: false});
canvas.addEventListener('touchend', e => updateTouch(e), {passive: false});
canvas.addEventListener('touchcancel', e => updateTouch(e), {passive: false});

function updateTouch(e) {
    e.preventDefault();
    input.touchLeft = false;
    input.touchRight = false;
    for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].clientX < cw / 2) input.touchLeft = true;
        else input.touchRight = true;
    }
}

function handleOrientation(e) {
    if (e.gamma !== null) {
        let g = e.gamma;
        if (g > 30) g = 30; // Max speed at 30 deg instead of 45
        if (g < -30) g = -30;
        input.tiltX = g / 30; 
    }
}

document.getElementById('startBtn').addEventListener('click', attemptStart);
document.getElementById('restartBtn').addEventListener('click', attemptStart);

function attemptStart() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(res => {
                if (res === 'granted') window.addEventListener('deviceorientation', handleOrientation);
                startGame();
            })
            .catch(e => { console.error(e); startGame(); });
    } else {
        window.addEventListener('deviceorientation', handleOrientation);
        startGame();
    }
}

function startGame() {
    $menuScreen.classList.add('hidden');
    $gameOverScreen.classList.add('hidden');
    currentState = GAME_STATE.PLAYING;
    initGame();
    requestAnimationFrame(t => {
        lastTime = t;
        animationFrameId = requestAnimationFrame(gameLoop);
    });
}

// --- INIT ---
let initialHS = localStorage.getItem('pixelJumperHS') || 0;
$highScoreMenu.innerText = 'HIGH SCORE: ' + initialHS + 'M';

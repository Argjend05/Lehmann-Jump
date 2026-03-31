// --- CONSTANTS & SETTINGS ---
const GRAVITY = 1400;
const JUMP_FORCE = -850;
const SPRING_FORCE = -1400;
const MAX_SPEED = 500;
const ACCELERATION = 3500;
const DECELERATION = 3500;
const PLATFORM_WIDTH = 80;
const PLATFORM_HEIGHT = 16;

// --- AUDIO SYSTEM ---
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let soundEnabled = true;

function initAudio() {
    if (!AudioContext) return; // Prevent crashes on unsupported browsers
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playSound(freqs, type = "square", duration = 0.1, vol = 0.1) {
    if (!soundEnabled || !audioCtx) return;
    let osc = audioCtx.createOscillator();
    let gain = audioCtx.createGain();
    osc.type = type;
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    let now = audioCtx.currentTime;
    freqs.forEach((f, i) => {
        osc.frequency.setValueAtTime(f, now + i * (duration / freqs.length));
    });

    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

    osc.start(now);
    osc.stop(now + duration);
}

const SFX = {
    jump: () => playSound([300, 450], 'square', 0.15, 0.05),
    spring: () => playSound([400, 800, 1200], 'triangle', 0.3, 0.05),
    coin: (pitchIdx = 0) => playSound([800 + pitchIdx * 50, 1200 + pitchIdx * 50], 'sine', 0.15, 0.05),
    break: () => playSound([200, 100], 'sawtooth', 0.2, 0.05),
    rocket: () => playSound([100, 200, 400, 800], 'square', 0.4, 0.08),
    die: () => playSound([300, 200, 100, 50], 'sawtooth', 0.6, 0.1),
    magnet: () => playSound([600, 400, 600], 'sine', 0.2, 0.05)
};

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
let clouds = [];
let motionTrails = [];
let floatingTexts = [];
const stars = [];
for(let i=0; i<100; i++) stars.push({x: Math.random()*3000, y: Math.random()*3000, size: Math.random()*2.5});

function lerpColor(start, end, t) { return Math.floor(start + (end - start) * t); }

function spawnFloatingText(text, x, y, color = '#fff') {
    floatingTexts.push({ text, x, y, life: 1, color });
}

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
function PlatformCmp(t) { return { name: 'platform', type: t, broken: false, respawnTimer: 0, speedX: (Math.random() > 0.5 ? 1 : -1) * (60 + Math.random() * 60) }; }
function BonusCmp(t) { return { name: 'bonus', type: t }; } // 0:coin, 1:spring, 2:magnet, 3:rocket
function PlayerCmp() { return { name: 'player', magnetTime: 0, rocketTime: 0, coins: 0 }; }

// --- GLOBALS ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let cw = window.innerWidth, ch = window.innerHeight;
let gameScale = 1;
let cameraY = 0;
let targetCameraY = 0;
let highestPlatY = ch;
let score = 0;
let lastTime = 0;
let animationFrameId;

let screenShake = 0;
let comboCount = 0;
let comboTimer = 0;

const GAME_STATE = { MENU: 0, PLAYING: 1, GAMEOVER: 2, PAUSE: 3 };
let currentState = GAME_STATE.MENU;
const input = { tiltX: 0, touchLeft: false, touchRight: false, keys: {} };

// --- DOM ELEMENTS ---
const $scoreEl = document.getElementById('scoreEl');
const $moneyEl = document.getElementById('moneyEl');
const $comboEl = document.getElementById('comboEl');
const $menuScreen = document.getElementById('menuScreen');
const $gameOverScreen = document.getElementById('gameOverScreen');
const $pauseScreen = document.getElementById('pauseScreen');
const $finalScore = document.getElementById('finalScore');
const $finalCoins = document.getElementById('finalCoins');
const $highScoreMenu = document.getElementById('highScoreMenu');
const $pauseBtn = document.getElementById('pauseBtn');
const $soundBtn = document.getElementById('soundBtn');

// --- SETUP ---
function resize() {
    let screenW = window.innerWidth;
    let screenH = window.innerHeight;
    
    // Virtual sizing: Prevent "zoomed in" feel on mobile screens.
    if (screenW < 500) {
        gameScale = screenW / 500;
        cw = 500;
        ch = screenH / gameScale;
    } else {
        gameScale = 1;
        cw = screenW;
        ch = screenH;
    }

    let ratio = window.devicePixelRatio || 1;
    canvas.width = screenW * ratio;
    canvas.height = screenH * ratio;
    canvas.style.width = screenW + "px";
    canvas.style.height = screenH + "px";
    
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio * gameScale, ratio * gameScale);
    ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
resize();

// Init Parallax Clouds for the sunny sky
for (let i = 0; i < 15; i++) {
    clouds.push({
        x: Math.random() * cw * 2,
        y: Math.random() * ch * 5,
        w: 60 + Math.random() * 100,
        h: 20 + Math.random() * 30,
        speed: 0.2 + Math.random() * 0.8,
        opacity: 0.5 + Math.random() * 0.4
    });
}

function spawnParticles(x, y, color, num, speed = 150) {
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
        if (p.life <= 0) {
            particles.splice(i, 1);
        }
    }
}

function addShake(amt) {
    screenShake = Math.max(screenShake, amt);
}

// --- SYSTEMS ---
let dashCooldown = 0;
let lastLeftTap = 0, lastRightTap = 0;
let leftKeyHeldLast = false, rightKeyHeldLast = false;

function InputSystem(dt) {
    if (dashCooldown > 0) dashCooldown -= dt;
    getEntities(['player', 'velocity']).forEach(e => {
        let v = e.getComponent('velocity');
        let t = e.getComponent('transform');
        let targetVx = 0;

        if (input.touchLeft || input.keys['ArrowLeft']) {
            if (!leftKeyHeldLast) {
                if (performance.now() - lastLeftTap < 150 && dashCooldown <= 0) {
                    v.vx = -MAX_SPEED * 3; dashCooldown = 0.5; SFX.rocket(); addShake(6);
                }
                lastLeftTap = performance.now();
            }
            leftKeyHeldLast = true;
            targetVx = -1;
        } else { leftKeyHeldLast = false; }

        if (input.touchRight || input.keys['ArrowRight']) {
            if (!rightKeyHeldLast) {
                if (performance.now() - lastRightTap < 150 && dashCooldown <= 0) {
                    v.vx = MAX_SPEED * 3; dashCooldown = 0.5; SFX.rocket(); addShake(6);
                }
                lastRightTap = performance.now();
            }
            rightKeyHeldLast = true;
            if (targetVx === 0) targetVx = 1;
        } else { rightKeyHeldLast = false; }

        if (targetVx === 0 && Math.abs(input.tiltX) > 0.05) targetVx = input.tiltX;

        // Visual dash effect at high speeds
        if (Math.abs(v.vx) > MAX_SPEED * 1.1) {
            spawnParticles(t.x + t.w/2, t.y + t.h/2, '#00e5ff', 2, 50);
        }

        let targetSpeed = targetVx * MAX_SPEED;

        if (targetSpeed !== 0) {
            let isReversing = (targetSpeed < 0 && v.vx > 0) || (targetSpeed > 0 && v.vx < 0);
            let activeAccel = isReversing ? ACCELERATION * 4 : ACCELERATION;

            if (v.vx < targetSpeed) {
                v.vx += activeAccel * dt;
                if (v.vx > targetSpeed && v.vx <= MAX_SPEED) v.vx = targetSpeed;
            } else if (v.vx > targetSpeed) {
                v.vx -= activeAccel * dt;
                if (v.vx < targetSpeed && v.vx >= -MAX_SPEED) v.vx = targetSpeed;
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

        // Player Gravity vs Rocket
        let inRocketDelay = e.hasComponent('player') && e.getComponent('player').rocketTime > 0;

        if (e.hasComponent('gravity') && !inRocketDelay) {
            v.vy += e.getComponent('gravity').force * dt;
            if (v.vy > 1500) v.vy = 1500; // Keep terminal velocity to prevent phasing through platforms
        } else if (inRocketDelay) {
            v.vy = -1800;
        }

        t.x += v.vx * dt;
        t.y += v.vy * dt;

        // Player Constraints & Camera
        if (e.hasComponent('player')) {
            if (t.x > cw) t.x = -t.w;
            if (t.x + t.w < 0) t.x = cw;

            if (t.y > cameraY + ch + 200) {
                setGameOver();
            }
            if (t.y < targetCameraY + ch * 0.4) {
                targetCameraY = t.y - ch * 0.4;
            }
        }

        // Moving Platform Handling & Timers
        if (e.hasComponent('platform')) {
            let pLogic = e.getComponent('platform');
            if (pLogic.broken && pLogic.respawnTimer > 0) {
                pLogic.respawnTimer -= dt;
                if (pLogic.respawnTimer <= 0) {
                    pLogic.broken = false;
                    pLogic.respawnTimer = 0;
                    spawnParticles(t.x + t.w / 2, t.y + t.h / 2, '#ff9800', 10, 100);
                }
            }
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
    let check = (pos) => pos.x < b.x + b.w && pos.x + pos.w > b.x && pos.y < b.y + b.h && pos.y + pos.h > b.y;
    if (check(a)) return true;
    if (a.x < 0) return check({ ...a, x: a.x + cw });
    if (a.x + a.w > cw) return check({ ...a, x: a.x - cw });
    return false;
}

function CollisionSystem(dt) {
    let pEnt = getEntities(['player'])[0];
    if (!pEnt) return;
    let pT = pEnt.getComponent('transform');
    let pV = pEnt.getComponent('velocity');
    let pLogic = pEnt.getComponent('player');

    // Bonuses
    getEntities(['bonus', 'transform']).forEach(bEnt => {
        let bT = bEnt.getComponent('transform');
        let bType = bEnt.getComponent('bonus').type;

        if (bType === 0 && pLogic.magnetTime > 0) {
            let dx = (pT.x + pT.w / 2) - (bT.x + bT.w / 2);
            let dy = (pT.y + pT.h / 2) - (bT.y + bT.h / 2);
            let dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 400 && dist > 1) {
                let speed = 1000 * (1 / (dist / 200));
                bT.x += (dx / dist) * speed * dt;
                bT.y += (dy / dist) * speed * dt;
            }
        }

        if (aabb(pT, bT)) {
            removeEntity(bEnt);
            if (bType === 0) {
                pLogic.coins++;
                comboCount++;
                comboTimer = 2.0; // 2 seconds to extend combo
                let cMult = Math.min(10, comboCount); // max 10x
                score += 5 * cMult;
                SFX.coin(Math.min(10, comboCount));
                spawnParticles(bT.x + 10, bT.y + 10, '#ffeb3b', 5, 50);
            }
            if (bType === 1) { pV.vy = SPRING_FORCE; SFX.spring(); addShake(5); spawnParticles(pT.x + pT.w / 2, pT.y + pT.h, '#e91e63', 10); }
            if (bType === 2) { pLogic.magnetTime = 8; SFX.magnet(); spawnParticles(bT.x + 10, bT.y + 10, '#9c27b0', 10); }
            if (bType === 3) { pLogic.rocketTime = 4; SFX.rocket(); addShake(8); spawnParticles(bT.x + 10, bT.y + 10, '#ff5722', 15); }
        }
    });

    // Platforms
    getEntities(['platform', 'transform']).forEach(plat => {
        let platLogic = plat.getComponent('platform');
        if (platLogic.broken) return;
        let pt = plat.getComponent('transform');

        // Spike collision (instant death, anywhere) 
        let spikeHitbox = { x: pt.x + 4, y: pt.y + 4, w: pt.w - 8, h: pt.h - 4 }; // Forgiving hitbox
        if (platLogic.type === 3 && aabb(pT, spikeHitbox)) {
            if (pLogic.rocketTime <= 0) {
                document.getElementById('ui-layer').style.boxShadow = 'inset 0 0 150px rgba(255,0,0,0.8)';
                setTimeout(() => document.getElementById('ui-layer').style.boxShadow = 'none', 500);
                setGameOver();
                return;
            } else {
                platLogic.broken = true;
                platLogic.respawnTimer = 3;
                SFX.break(); addShake(15);
                spawnParticles(pt.x + pt.w / 2, pt.y + pt.h / 2, '#f44336', 15, 200);
            }
        }

        // Normal Jump (only when falling) - sweeping collision to prevent phasing
        if (pV.vy > 0 && pLogic.rocketTime <= 0 && platLogic.type !== 3) {
            let prevY = pT.y - pV.vy * dt;
            let sweepBox = { x: pT.x, y: prevY, w: pT.w, h: pT.h + (pT.y - prevY) };
            if (aabb(sweepBox, pt)) {
                let prevBottom = prevY + pT.h;
                if (prevBottom <= pt.y + 24) {
                    pT.y = pt.y - pT.h; // snap exact
                    
                    // Perfect Jump Check!
                    let distToLeft = Math.abs((pT.x + pT.w) - pt.x);
                    let distToRight = Math.abs(pT.x - (pt.x + pt.w));
                    let isPerfect = distToLeft < 15 || distToRight < 15;
                    
                    if (isPerfect && platLogic.type !== 2) {
                        pV.vy = JUMP_FORCE * 1.35;
                        SFX.spring();
                        addShake(8);
                        spawnFloatingText("PARFAIT !", pT.x, pT.y - 10, '#00e5ff');
                        score += 20;
                        spawnParticles(pT.x + pT.w / 2, pT.y + pT.h, '#00e5ff', 20, 200);
                    } else {
                        pV.vy = JUMP_FORCE;
                        SFX.jump();
                        spawnParticles(pT.x + pT.w / 2, pT.y + pT.h, '#fff', 5, 80);
                    }
                    
                    if (platLogic.type === 2) {
                        platLogic.broken = true;
                        platLogic.respawnTimer = 1.5;
                        SFX.break(); addShake(8);
                        spawnParticles(pt.x + pt.w / 2, pt.y + pt.h / 2, '#ffc107', 15, 200);
                    }
                }
            }
        }
    });
}

function SpawnerSystem() {
    while (highestPlatY > cameraY - ch - 200) {
        let currentAlt = Math.floor(-highestPlatY / 10);
        let difficulty = Math.min(1, currentAlt / 500);

        let baseY = 80;
        let randomY = 60 + (difficulty * 120);
        let gapY = baseY + Math.random() * randomY;
        if (gapY > 220) gapY = 220; // Reduced max jump gap for mobile balancing

        highestPlatY -= gapY;

        let type = 0;
        let r = Math.random();
        // Difficulty scaling for platforms
        if (r < difficulty * 0.8) {
            let r2 = Math.random();
            if (r2 < 0.35) type = 1; // moving
            else if (r2 < 0.7) type = 2; // fragile
            else type = 3; // spike
        }
        // Force simple platform occasionally to not make it impossible
        if (currentAlt > 100 && Math.random() < 0.2) type = 0;

        // Prevent consecutive red spikes
        let allPlats = entities.filter(e => e.hasComponent('platform'));
        if (allPlats.length > 0 && type === 3) {
            let lastType = allPlats[allPlats.length - 1].getComponent('platform').type;
            if (lastType === 3) type = 2; // Downgrade to fragile
        }

        let w = PLATFORM_WIDTH * (1 - difficulty * 0.3);
        if (w < 45) w = 45;
        let h = PLATFORM_HEIGHT;

        let x = Math.random() * (cw - w);

        let plat = new Entity();
        plat.addComponent(Transform(x, highestPlatY, w, h));
        plat.addComponent(PlatformCmp(type));
        plat.addComponent(Velocity(0, 0));
        if (type === 1) plat.getComponent('velocity').vx = plat.getComponent('platform').speedX;
        addEntity(plat);

        // Provide a safe alternative path on the same level if it's a spike
        if (type === 3) {
            let safeX = x + w + 60;
            if (safeX + w > cw) safeX = x - w - 60;
            if (safeX < 0) safeX = Math.random() * (cw - w);

            let safePlat = new Entity();
            safePlat.addComponent(Transform(safeX, highestPlatY + (Math.random() * 30 - 15), w, h));
            safePlat.addComponent(PlatformCmp(0));
            safePlat.addComponent(Velocity(0, 0));
            addEntity(safePlat);
        }

        // Spawn bonus (20% chance overall on non-spikes)
        if (Math.random() < 0.2 && type !== 3) {
            let bType = 0;
            let br = Math.random();
            if (br > 0.6) bType = 1; // spring
            if (br > 0.8) bType = 2; // magnet
            if (br > 0.95) bType = 3; // rocket

            let item = new Entity();
            item.addComponent(Transform(x + w / 2 - 12, highestPlatY - 32, 24, 24));
            item.addComponent(BonusCmp(bType));
            addEntity(item);
        }
    }
}

// --- RENDER SYSTEM ---
function renderSystem(dt) {
    ctx.clearRect(0, 0, cw, ch);

    // Dynamic Sky Gradient based on altitude
    let currentAlt = Math.max(0, -cameraY);
    let r1, g1, b1, r2, g2, b2;
    if (currentAlt < 5000) {
        let p = currentAlt / 5000;
        r1 = lerpColor(79, 255, p); g1 = lerpColor(195, 112, p); b1 = lerpColor(247, 67, p); // Cyan to Orange Red
        r2 = lerpColor(225, 255, p); g2 = lerpColor(245, 193, p); b2 = lerpColor(254, 7, p);
    } else if (currentAlt < 10000) {
        let p = (currentAlt - 5000) / 5000;
        r1 = lerpColor(255, 10, p); g1 = lerpColor(112, 10, p); b1 = lerpColor(67, 30, p); // Sunset to Deep Space
        r2 = lerpColor(255, 10, p); g2 = lerpColor(193, 10, p); b2 = lerpColor(7, 40, p);
    } else {
        r1 = 10; g1 = 10; b1 = 30; r2 = 10; g2 = 10; b2 = 40; // Deep Space
    }

    let grad = ctx.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, `rgb(${r1},${g1},${b1})`);
    grad.addColorStop(1, `rgb(${r2},${g2},${b2})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cw, ch);

    // Fade in stars for Space!
    if (r1 < 100) {
        let starAlpha = 1 - (r1 / 100);
        ctx.globalAlpha = starAlpha;
        ctx.fillStyle = '#fff';
        stars.forEach(s => {
            let sx = s.x % cw;
            let sy = ((s.y - cameraY*0.05) % ch + ch) % ch;
            if (Math.random() > 0.99) ctx.fillStyle = '#00e5ff'; // twinkling
            else ctx.fillStyle = '#fff';
            ctx.fillRect(sx, sy, s.size, s.size);
        });
        ctx.globalAlpha = 1;
    }

    // Deep Parallax Clouds
    clouds.forEach(c => {
        let sx = c.x % (cw + 200) - 100;
        let depthSpeed = c.speed * 0.15;
        let period = ch + 400;
        let sy = ((c.y - cameraY * depthSpeed) % period + period) % period - 200;

        let cloudAlpha = c.opacity * Math.max(0, (r1 - 50) / 205); // Fade clouds at night
        ctx.globalAlpha = cloudAlpha;

        // Slight drop shadow for volume
        ctx.fillStyle = 'rgba(0,0,0,0.05)';
        ctx.fillRect(sx, sy + 4, c.w, c.h);
        ctx.fillRect(sx + c.w * 0.1, sy - c.h * 0.4 + 4, c.w * 0.4, c.h * 0.4);
        ctx.fillRect(sx + c.w * 0.4, sy - c.h * 0.7 + 4, c.w * 0.5, c.h * 0.7);
        ctx.fillRect(sx + c.w * 0.8, sy - c.h * 0.2 + 4, c.w * 0.3, c.h * 0.2);

        ctx.fillStyle = '#ffffff';
        // Draw pixelated chunky cloud
        ctx.fillRect(sx, sy, c.w, c.h);
        ctx.fillRect(sx + c.w * 0.1, sy - c.h * 0.4, c.w * 0.4, c.h * 0.4);
        ctx.fillRect(sx + c.w * 0.4, sy - c.h * 0.7, c.w * 0.5, c.h * 0.7);
        ctx.fillRect(sx + c.w * 0.8, sy - c.h * 0.2, c.w * 0.3, c.h * 0.2);
    });
    ctx.globalAlpha = 1;

    ctx.save();

    // Tour de l'Europe Facade Parallax
    let parallaxY = cameraY * 0.4;
    
    // Scale for mobile explicitly to fix 2-window issue!
    let isMobile = cw < 600;
    let windowWidth = isMobile ? 30 : 60;
    let pillarWidth = isMobile ? 20 : 40;
    let floorHeight = isMobile ? 45 : 80;
    let bandHeight = isMobile ? 8 : 15;

    let startY = Math.floor(parallaxY / floorHeight) * floorHeight;
    let endY = startY + ch + floorHeight * 2;

    ctx.translate(0, -parallaxY);

    // Calculate centered tower dimensions
    let towerColumns = Math.max(1, Math.floor((cw - 40) / (windowWidth + pillarWidth)) - 1);
    let towerWidth = towerColumns * windowWidth + (towerColumns + 1) * pillarWidth;
    let towerX = (cw - towerWidth) / 2;

    let concLight = '#c5bea7';
    let concDark = '#a8a28e';
    let windowGlass = '#2c3338';
    let windowFrame = '#e1ddc6';
    let blindColor = '#efebd8';

    // Base wall
    ctx.fillStyle = windowFrame;
    ctx.fillRect(towerX, startY, towerWidth, endY - startY);

    // Draw floors
    for (let y = startY; y < endY; y += floorHeight) {
        let wy = y + bandHeight;
        let wh = floorHeight - bandHeight;

        for (let col = 0; col < towerColumns; col++) {
            let x = towerX + pillarWidth + col * (windowWidth + pillarWidth);
            let rnd = Math.sin((y + x) * 123.456) * 10000;
            let r = rnd - Math.floor(rnd);

            // Glass
            ctx.fillStyle = windowGlass;
            ctx.fillRect(x + 2, wy + 2, windowWidth - 4, wh - 4);

            // Blinds
            if (r > 0.4) {
                let blindH = (r - 0.4) / 0.6 * (wh - 4);
                ctx.fillStyle = isMobile ? '#d4d0be' : blindColor; // slightly darker block for mobile
                ctx.fillRect(x + 2, wy + 2, windowWidth - 4, blindH);
                
                if (!isMobile) {
                    ctx.fillStyle = 'rgba(0,0,0,0.1)';
                    for (let b = wy + 2; b < wy + 2 + blindH; b += 4) {
                        ctx.fillRect(x + 2, b, windowWidth - 4, 1);
                    }
                }
            }
        }

        // Horizontal band
        ctx.fillStyle = concDark;
        ctx.fillRect(towerX, y, towerWidth, bandHeight);
    }

    // Vertical pillars
    for (let col = 0; col <= towerColumns; col++) {
        let x = towerX + col * (windowWidth + pillarWidth);
        ctx.fillStyle = concLight;
        ctx.fillRect(x, startY, pillarWidth, endY - startY);
        // Shadow & Highlight
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(x - 5, startY, 5, endY - startY);
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fillRect(x, startY, 5, endY - startY);
    }

    ctx.restore();
    ctx.save();

    // Screen Shake Apply
    if (screenShake > 0) {
        let sx = (Math.random() - 0.5) * screenShake * 2;
        let sy = (Math.random() - 0.5) * screenShake * 2;
        ctx.translate(sx, sy);
        screenShake *= Math.pow(0.8, dt * 60);
        if (screenShake < 0.5) screenShake = 0;
    }

    ctx.translate(0, -cameraY);

    const renderables = getEntities(['transform']);

    renderables.forEach(e => {
        let t = e.getComponent('transform');

        if (e.hasComponent('platform')) {
            let pType = e.getComponent('platform');
            if (pType.broken) {
                // Ghost Fade
                ctx.globalAlpha = 0.2 + (Math.random() * 0.1);
                ctx.fillStyle = pType.type === 3 ? '#d84315' : '#8d6e63';
                ctx.fillRect(t.x, t.y, t.w, t.h);
                ctx.globalAlpha = 1;
                return;
            }

            let base, high, shad;
            if (pType.type === 0) { // Normal
                base = '#78909c'; high = '#b0bec5'; shad = '#455a64';
            } else if (pType.type === 1) { // Moving
                base = '#fbc02d'; high = '#fff59d'; shad = '#f57f17';
            } else if (pType.type === 2) { // Fragile
                base = '#8d6e63'; high = '#a1887f'; shad = '#5d4037';
            } else if (pType.type === 3) { // Heated
                base = '#d84315'; high = '#ffcc80'; shad = '#bf360c';
            }

            // Beam body
            ctx.fillStyle = base;
            ctx.fillRect(t.x, t.y, t.w, t.h);

            ctx.fillStyle = high;
            ctx.fillRect(t.x, t.y, t.w, t.h / 4);

            ctx.fillStyle = shad;
            ctx.fillRect(t.x, t.y + t.h - t.h / 4, t.w, t.h / 4);

            // Stripes for Moving Platforms
            if (pType.type === 1) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(t.x, t.y, t.w, t.h);
                ctx.clip();
                ctx.fillStyle = '#212121';
                for (let i = -t.h; i < t.w; i += 20) {
                    ctx.beginPath();
                    ctx.moveTo(t.x + i + 10, t.y);
                    ctx.lineTo(t.x + i + 20, t.y);
                    ctx.lineTo(t.x + i + 10 - t.h, t.y + t.h);
                    ctx.lineTo(t.x + i - t.h, t.y + t.h);
                    ctx.fill();
                }
                ctx.restore();
            }

            // Rivets
            ctx.fillStyle = shad;
            for (let rx = 10; rx < t.w - 10; rx += 16) {
                ctx.fillRect(t.x + rx, t.y + t.h / 2 - 2, 4, 4);
                ctx.fillStyle = high;
                ctx.fillRect(t.x + rx, t.y + t.h / 2 - 3, 2, 2);
                ctx.fillStyle = shad;
            }

            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.strokeRect(t.x, t.y, t.w, t.h);

            // Heated aura for Spike substitute
            if (pType.type === 3) {
                let pulse = Math.sin(performance.now() / 150) * 4;
                ctx.fillStyle = 'rgba(255, 87, 34, 0.5)';
                ctx.fillRect(t.x, t.y - 6 - pulse, t.w, 6 + pulse);
                ctx.fillStyle = 'rgba(255, 204, 128, 0.8)';
                ctx.fillRect(t.x + 4, t.y - 2 - pulse / 2, t.w - 8, 2);
            }
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
            if (bType === 3) { ctx.beginPath(); ctx.moveTo(t.x + t.w / 2, t.y + 4); ctx.lineTo(t.x + t.w - 4, t.y + t.h - 4); ctx.lineTo(t.x + 4, t.y + t.h - 4); ctx.fill(); }
        }
    });

    // Trails Update & Render
    motionTrails.forEach(tr => {
        ctx.globalAlpha = tr.life;
        ctx.fillStyle = tr.color;
        ctx.fillRect(tr.x, tr.y, tr.w, tr.h);
        tr.life -= dt * 2.5; // faint speed
    });
    ctx.globalAlpha = 1;
    motionTrails = motionTrails.filter(tr => tr.life > 0);

    // Render Player
    getEntities(['player']).forEach(e => {
        let t = e.getComponent('transform');
        let v = e.getComponent('velocity');
        let pCmp = e.getComponent('player');

        // Spawn Trail if extremely fast
        if (Math.abs(v.vy) > 1000 || Math.abs(v.vx) > 500 || pCmp.rocketTime > 0) {
            motionTrails.push({ x: t.x, y: t.y, w: t.w, h: t.h, life: 0.5, color: pCmp.rocketTime > 0 ? '#ff5722' : '#00e5ff' });
        }

        const drawBlob = (xOff) => {
            ctx.save();
            ctx.translate(t.x + t.w / 2 + xOff, t.y + t.h);

            let stretch = Math.max(-0.4, Math.min(1.0, Math.abs(v.vy) / 2000));
            let scaleY = 1 + stretch;
            let scaleX = 1 - stretch * 0.4;
            ctx.scale(scaleX, scaleY);

            // Magnet outline pulse
            if (pCmp.magnetTime > 0) {
                let pulse = Math.abs(Math.sin(performance.now() / 150)) * 4;
                ctx.fillStyle = '#9c27b0';
                ctx.fillRect(-t.w / 2 - 4 - pulse, -t.h - 4 - pulse, t.w + 8 + pulse * 2, t.h + 8 + pulse * 2);
            }

            // Body
            ctx.fillStyle = pCmp.rocketTime > 0 ? '#ff5722' : '#00e5ff';
            ctx.fillRect(-t.w / 2, -t.h, t.w, t.h);

            // Highlight
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fillRect(-t.w / 2 + 2, -t.h + 2, t.w - 4, 6);

            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.strokeRect(-t.w / 2, -t.h, t.w, t.h);

            // Eyes
            ctx.fillStyle = '#000';
            let dir = Math.sign(v.vx) * 4;
            if (Math.abs(v.vx) < 50) dir = 0;
            ctx.fillRect(-t.w / 2 + 6 + dir, -t.h + 8, 4, 6);
            ctx.fillRect(t.w / 2 - 10 + dir, -t.h + 8, 4, 6);

            // Exhaust
            if (pCmp.rocketTime > 0) {
                ctx.fillStyle = '#ffeb3b';
                ctx.fillRect(-t.w / 2 + 4, 0, t.w - 8, 15 + Math.random() * 20);
                ctx.fillStyle = '#e65100';
                ctx.fillRect(-t.w / 2 + 8, 5, t.w - 16, Math.random() * 20);
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

    // Floating Texts
    floatingTexts.forEach(ft => {
        ctx.globalAlpha = ft.life;
        ctx.fillStyle = ft.color;
        ctx.font = '16px "Press Start 2P"';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
        ft.y -= dt * 40;
        ft.life -= dt * 0.8;
    });
    ctx.globalAlpha = 1;
    floatingTexts = floatingTexts.filter(ft => ft.life > 0);

    ctx.restore();
}

let bgmTimer = 0;
let bgmStep = 0;
const bgmNotes = [220, 261.63, 329.63, 392, 440, 523.25]; // A minor pentatonic

function MusicSystem(dt) {
    if (!soundEnabled || !audioCtx || currentState !== GAME_STATE.PLAYING) return;
    
    let pEnt = getEntities(['player'])[0];
    let isRocket = pEnt && pEnt.getComponent('player').rocketTime > 0;
    
    let currentAlt = Math.max(0, Math.floor(-cameraY / 10));
    let baseInterval = Math.max(0.08, 0.2 - (currentAlt / 20000));
    if (isRocket) baseInterval = 0.08;
    
    bgmTimer -= dt;
    if (bgmTimer <= 0) {
        bgmTimer = baseInterval;
        let note = bgmNotes[bgmStep % bgmNotes.length];
        bgmStep++;
        
        if (Math.random() > 0.8) note *= 2; 
        if (isRocket) note *= 2;
        
        let osc = audioCtx.createOscillator();
        let gain = audioCtx.createGain();
        osc.type = isRocket ? 'square' : 'sine';
        osc.frequency.setValueAtTime(note, audioCtx.currentTime);
        
        gain.gain.setValueAtTime(0.03, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + baseInterval * 1.5);
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + baseInterval * 1.5);
    }
}

// --- GAME LOOP ---
function gameLoop(time) {
    if (currentState !== GAME_STATE.PLAYING) return;
    animationFrameId = requestAnimationFrame(gameLoop);

    let currentTime = time || performance.now();
    let dt = (currentTime - lastTime) / 1000;
    lastTime = currentTime;

    if (isNaN(dt) || dt < 0.001 || dt > 0.1) dt = 0.016; // strict anti-NaN fallback

    // Smooth Camera Lerp
    if (!isNaN(targetCameraY) && !isNaN(cameraY)) {
        cameraY += (targetCameraY - cameraY) * 8 * dt;
    }

    let pEnt = getEntities(['player'])[0];
    if (pEnt) {
        let pLogic = pEnt.getComponent('player');
        if (pLogic.magnetTime > 0) pLogic.magnetTime -= dt;
        if (pLogic.rocketTime > 0) pLogic.rocketTime -= dt;
    }

    // Combos
    if (comboCount > 0) {
        comboTimer -= dt;
        if (comboTimer <= 0) {
            comboCount = 0;
            $comboEl.classList.add('hidden');
        } else if (comboCount > 1) {
            $comboEl.classList.remove('hidden');
            $comboEl.innerText = `COMBO x${comboCount} !`;
        }
    }

    InputSystem(dt);
    PhysicsSystem(dt);
    CollisionSystem(dt);
    SpawnerSystem();
    MusicSystem(dt);

    // Cleanup
    entities.forEach(e => {
        if (e.hasComponent('transform') && e.getComponent('transform').y > cameraY + ch + 400) {
            removeEntity(e);
        }
    });
    cleanUpEntities();
    updateParticles(dt);

    renderSystem(dt);

    // Update HUD
    let currentAlt = Math.max(0, Math.floor(-cameraY / 10));
    if (currentAlt > score) score = currentAlt;
    $scoreEl.innerText = score + 'm';
    if (pEnt) $moneyEl.innerText = pEnt.getComponent('player').coins;
}

function initGame() {
    entities.length = 0;
    particles.length = 0;
    motionTrails.length = 0;
    floatingTexts.length = 0;
    cameraY = 0;
    targetCameraY = 0;
    score = 0;
    comboCount = 0;
    highestPlatY = ch;
    $scoreEl.innerText = '0m';
    $moneyEl.innerText = '0';
    $comboEl.classList.add('hidden');

    let p = new Entity();
    p.addComponent(Transform(cw / 2 - 16, ch - 200, 32, 28));
    p.addComponent(Velocity(0, 0));
    p.addComponent(GravityCmp(GRAVITY));
    p.addComponent(PlayerCmp());
    addEntity(p);

    let base = new Entity();
    base.addComponent(Transform(cw / 2 - PLATFORM_WIDTH, ch - 80, PLATFORM_WIDTH * 2, 20));
    base.addComponent(PlatformCmp(0));
    addEntity(base);

    for (let i = 0; i < 20; i++) SpawnerSystem();
}

function setGameOver() {
    SFX.die();
    currentState = GAME_STATE.GAMEOVER;
    cancelAnimationFrame(animationFrameId);
    $pauseBtn.style.display = 'none';

    let maxHS = localStorage.getItem('pixelJumperHS') || 0;
    let pEnt = getEntities(['player'])[0];
    let coinsRound = pEnt ? pEnt.getComponent('player').coins : 0;

    if (score > maxHS) localStorage.setItem('pixelJumperHS', score);

    $finalScore.innerText = score;
    $finalCoins.innerText = coinsRound;
    $gameOverScreen.classList.remove('hidden');
}

function togglePause() {
    if (currentState === GAME_STATE.PLAYING) {
        currentState = GAME_STATE.PAUSE;
        cancelAnimationFrame(animationFrameId);
        $pauseScreen.classList.remove('hidden');
    } else if (currentState === GAME_STATE.PAUSE) {
        resumeGame();
    }
}

function resumeGame() {
    $pauseScreen.classList.add('hidden');
    if (document.activeElement) document.activeElement.blur();
    cancelAnimationFrame(animationFrameId);
    currentState = GAME_STATE.PLAYING;
    lastTime = performance.now();
    animationFrameId = requestAnimationFrame(gameLoop);
}

// --- INPUT HANDLING ---
window.addEventListener('keydown', e => {
    input.keys[e.code] = true;
    if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
});
window.addEventListener('keyup', e => input.keys[e.code] = false);

canvas.addEventListener('touchstart', e => updateTouch(e), { passive: false });
canvas.addEventListener('touchmove', e => updateTouch(e), { passive: false });
canvas.addEventListener('touchend', e => updateTouch(e), { passive: false });
canvas.addEventListener('touchcancel', e => updateTouch(e), { passive: false });

function updateTouch(e) {
    e.preventDefault(); // disable double zoom
    input.touchLeft = false;
    input.touchRight = false;
    let screenHalf = window.innerWidth / 2;
    for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].clientX < screenHalf) input.touchLeft = true;
        else input.touchRight = true;
    }
}

function handleOrientation(e) {
    if (e.gamma != null) {
        let g = Number(e.gamma) || 0;
        if (g > 30) g = 30; // Max speed at 30 deg
        if (g < -30) g = -30;
        input.tiltX = g / 30;
    }
}

document.getElementById('startBtn').addEventListener('click', attemptStart);
document.getElementById('restartBtn').addEventListener('click', attemptStart);
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
$pauseBtn.addEventListener('click', togglePause);

$soundBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    $soundBtn.innerText = soundEnabled ? '🔊' : '🔇';
    if (soundEnabled) initAudio();
});

function attemptStart() {
    initAudio(); // Required on gesture
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
    $pauseScreen.classList.add('hidden');
    $pauseBtn.style.display = 'block';
    
    if (document.activeElement) document.activeElement.blur();
    cancelAnimationFrame(animationFrameId);

    currentState = GAME_STATE.PLAYING;
    initGame();
    requestAnimationFrame(t => {
        lastTime = t;
        animationFrameId = requestAnimationFrame(gameLoop);
    });
}

// --- INIT ---
let initialHS = localStorage.getItem('pixelJumperHS') || 0;
$highScoreMenu.innerText = 'MEILLEUR SCORE : ' + initialHS + 'M';

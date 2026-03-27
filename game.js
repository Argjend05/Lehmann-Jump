// --- CONSTANTS & SETTINGS ---
const GRAVITY = 1800;
const JUMP_FORCE = -1000;
const SPRING_FORCE = -1600;
const MAX_SPEED = 600;
const ACCELERATION = 4000;
const DECELERATION = 4000;
const PLATFORM_WIDTH = 75;
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
let stars = [];
let motionTrails = [];

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
let cameraY = 0;
let targetCameraY = 0;
let highestPlatY = window.innerHeight;
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

// Init Multi-layered Parallax Stars
for (let i = 0; i < 80; i++) {
    stars.push({
        x: Math.random() * 2000,
        y: Math.random() * 4000,
        size: Math.random() > 0.8 ? 3 : (Math.random() > 0.5 ? 2 : 1), // 1 to 3
        speed: 0.1 + Math.random() * 0.6,
        color: Math.random() > 0.9 ? '#ffeb3b' : (Math.random() > 0.5 ? '#fff' : '#aaa')
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
function InputSystem(dt) {
    getEntities(['player', 'velocity']).forEach(e => {
        let v = e.getComponent('velocity');
        let targetVx = 0;

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
                    pV.vy = JUMP_FORCE;
                    SFX.jump();
                    spawnParticles(pT.x + pT.w / 2, pT.y + pT.h, '#fff', 5, 80);
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
        if (gapY > 260) gapY = 260; // Max jump limit

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
    ctx.fillStyle = '#0d0d14';
    ctx.fillRect(0, 0, cw, ch);

    // Parallax Stars
    stars.forEach(s => {
        let sx = s.x % cw;
        // The further away (smaller), the slower they move
        let depthSpeed = s.speed * (s.size / 3);
        let sy = (s.y - cameraY * depthSpeed) % ch;
        if (sy < 0) sy += ch;
        ctx.fillStyle = s.color;
        ctx.globalAlpha = s.size / 4; // dimmer if smaller
        ctx.fillRect(sx, sy, s.size, s.size);
    });
    ctx.globalAlpha = 1;

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
                ctx.globalAlpha = 0.2 + (Math.random() * 0.1); // subtle flicker
                ctx.fillStyle = pType.type === 3 ? '#f44336' : '#ff9800';
                ctx.fillRect(t.x, t.y, t.w, t.h);
                ctx.globalAlpha = 1;
                return;
            }

            if (pType.type === 0) { ctx.fillStyle = '#8bc34a'; } // normal
            else if (pType.type === 1) { ctx.fillStyle = '#03a9f4'; } // moving
            else if (pType.type === 2) { ctx.fillStyle = '#ff9800'; } // fragile
            else if (pType.type === 3) { ctx.fillStyle = '#f44336'; } // spikes

            ctx.fillRect(t.x, t.y, t.w, t.h);
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fillRect(t.x, t.y, t.w, t.h / 3);
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(t.x, t.y + t.h - t.h / 3, t.w, t.h / 3);

            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.strokeRect(t.x, t.y, t.w, t.h);

            // Add sharp looking lines for spikes
            if (pType.type === 3) {
                ctx.fillStyle = '#000';
                for (let i = 0; i < t.w; i += 8) {
                    ctx.beginPath();
                    ctx.moveTo(t.x + i, t.y); ctx.lineTo(t.x + i + 4, t.y - 8); ctx.lineTo(t.x + i + 8, t.y);
                    ctx.fill();
                }
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

    ctx.restore();
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
            $comboEl.innerText = `COMBO x${comboCount}!`;
        }
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
    cameraY = 0;
    targetCameraY = 0;
    score = 0;
    comboCount = 0;
    highestPlatY = window.innerHeight;
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
    for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].clientX < cw / 2) input.touchLeft = true;
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

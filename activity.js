document.addEventListener('DOMContentLoaded', () => {
    const body = document.body;
    const scene = document.getElementById('scene');
    const moon = document.getElementById('moon');
    const imgOff = document.getElementById('imgOff');
    const imgOn = document.getElementById('imgOn');
    const canvas = document.getElementById('fx');
    const ctx = canvas.getContext('2d');

    const TRANSITION_MS = 1800;
    const CLICK_MS = 600;
    const AUDIO_SRC = 'audio/audio-20261113T173018Z-1-001/audio/fairy.mp3';
    const AUDIO_VOLUME = 0.9;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = window.matchMedia('(pointer: coarse)').matches;

    let shiftTimer = null;
    let clickTimer = null;
    let strikeTimer = null;
    let lightningTimer = null;
    let fadeTimer = null;

    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const rand = (a, b) => a + Math.random() * (b - a);

    /* ---------- Audio (with fades) ---------- */

    const fairySound = new Audio(AUDIO_SRC);
    fairySound.preload = 'auto';
    fairySound.load();

    function fadeVolume(target, ms, done) {
        clearInterval(fadeTimer);
        const from = fairySound.volume;
        const start = performance.now();
        fadeTimer = setInterval(() => {
            const t = clamp((performance.now() - start) / ms, 0, 1);
            fairySound.volume = clamp(lerp(from, target, t), 0, 1);
            if (t >= 1) {
                clearInterval(fadeTimer);
                if (done) done();
            }
        }, 30);
    }

    function playFairySound() {
        clearInterval(fadeTimer);
        fairySound.currentTime = 0;
        fairySound.volume = 0;
        const attempt = fairySound.play();
        if (attempt && typeof attempt.catch === 'function') {
            attempt.catch(() => {}); // ignore blocked or missing audio so the toggle never breaks
        }
        fadeVolume(AUDIO_VOLUME, 500);
    }

    function stopFairySound() {
        fadeVolume(0, 450, () => {
            fairySound.pause();
            fairySound.currentTime = 0;
        });
    }

    /* ---------- Preloading ---------- */

    function decodeImage(img) {
        if (img.decode) {
            return img.decode().catch(() => {});
        }
        if (img.complete) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
        });
    }

    ['image/off.jpg', 'image/on.png'].forEach((src) => {
        const preload = new Image();
        preload.src = src;
    });

    Promise.all([decodeImage(imgOff), decodeImage(imgOn)]).then(() => {
        scene.classList.add('ready');
    });
    setTimeout(() => scene.classList.add('ready'), 2500);

    /* ---------- Particle system (canvas, sprite-based, additive) ---------- */

    function makeSprite(rgb) {
        const s = document.createElement('canvas');
        s.width = s.height = 64;
        const c = s.getContext('2d');
        const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, `rgba(${rgb},1)`);
        g.addColorStop(0.18, `rgba(${rgb},0.7)`);
        g.addColorStop(0.5, `rgba(${rgb},0.16)`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        c.fillStyle = g;
        c.fillRect(0, 0, 64, 64);
        return s;
    }

    const spriteCalm = makeSprite('222,255,150');
    const spriteHaunt = makeSprite('170,200,255');

    let W = 0, H = 0, DPR = 1;
    let particles = [];
    const bursts = [];
    let mood = 0;         // 0 = peaceful, 1 = haunted (eased)
    const pointer = { x: -9999, y: -9999, nx: 0, ny: 0, active: false };

    function resize() {
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width = Math.round(W * DPR);
        canvas.height = Math.round(H * DPR);
        const count = reduceMotion ? 18 : clamp(Math.round((W * H) / (coarse ? 26000 : 17000)), 24, 90);
        particles = Array.from({ length: count }, () => ({
            x: Math.random() * W,
            y: Math.random() * H,
            z: rand(0.35, 1),
            ph: rand(0, Math.PI * 2),
            tw: rand(0.6, 1.8),
            r: rand(0.6, 1.3),
            ox: 0,
            oy: 0
        }));
    }
    resize();
    window.addEventListener('resize', resize);

    function updateParticles(dt, t) {
        const speed = reduceMotion ? 0.3 : 1;
        const m = mood;
        for (const p of particles) {
            // Peaceful: lazy figure-eight wander. Haunted: slow rising wisps with sideways drift.
            const wx = Math.sin(t * 0.55 + p.ph) * 14 + Math.cos(t * 0.31 + p.ph * 2) * 8;
            const wy = Math.cos(t * 0.47 + p.ph) * 10;
            const driftX = lerp(0, -9, m);
            const driftY = lerp(0, -16, m);
            p.x += (wx + driftX) * p.z * dt * speed;
            p.y += (wy + driftY) * p.z * dt * speed;

            // Cursor interaction: particles scatter softly away from the pointer
            if (pointer.active) {
                const dx = p.x - pointer.x;
                const dy = p.y - pointer.y;
                const d2 = dx * dx + dy * dy;
                const R = 170;
                if (d2 < R * R && d2 > 1) {
                    const d = Math.sqrt(d2);
                    const f = (1 - d / R) * 260 * dt;
                    p.ox += (dx / d) * f;
                    p.oy += (dy / d) * f;
                }
            }
            p.ox *= Math.pow(0.12, dt);
            p.oy *= Math.pow(0.12, dt);

            if (p.x < -40) p.x = W + 40;
            if (p.x > W + 40) p.x = -40;
            if (p.y < -40) p.y = H + 40;
            if (p.y > H + 40) p.y = -40;
        }

        for (let i = bursts.length - 1; i >= 0; i--) {
            const b = bursts[i];
            b.life -= dt;
            if (b.life <= 0) { bursts.splice(i, 1); continue; }
            const drag = Math.pow(0.35, dt);
            b.vx *= drag;
            b.vy = b.vy * drag - 12 * dt;
            b.x += b.vx * dt;
            b.y += b.vy * dt;
        }
    }

    function drawSprite(sprite, x, y, size, alpha) {
        if (alpha < 0.01) return;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
    }

    function drawParticles(t) {
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'lighter';

        const parX = pointer.nx * 26;
        const parY = pointer.ny * 16;
        const calmA = 1 - mood;
        const hauntA = mood;

        for (const p of particles) {
            const tw = 0.5 + 0.5 * Math.sin(t * p.tw + p.ph);
            const flicker = tw * tw;
            const base = lerp(0.2 + flicker * 0.8, 0.12 + flicker * 0.5, mood);
            const size = p.r * p.z * lerp(34, 52, mood);
            const x = p.x + p.ox - parX * p.z * 1.6;
            const y = p.y + p.oy - parY * p.z * 1.6;
            drawSprite(spriteCalm, x, y, size, base * calmA * p.z);
            drawSprite(spriteHaunt, x, y, size, base * hauntA * p.z);
        }

        const burstSprite = mood > 0.5 ? spriteHaunt : spriteCalm;
        for (const b of bursts) {
            const k = b.life / b.max;
            drawSprite(burstSprite, b.x, b.y, b.size * (0.4 + k), k * k * 0.95);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }

    function emitBurst() {
        const r = moon.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const n = reduceMotion ? 10 : coarse ? 36 : 64;
        for (let i = 0; i < n; i++) {
            const a = rand(0, Math.PI * 2);
            const v = rand(60, 360);
            const life = rand(0.9, 2.2);
            bursts.push({
                x: cx + Math.cos(a) * r.width * 0.35,
                y: cy + Math.sin(a) * r.height * 0.35,
                vx: Math.cos(a) * v,
                vy: Math.sin(a) * v,
                life,
                max: life,
                size: rand(18, 54)
            });
        }
    }

    /* ---------- Camera: parallax, spring push-in, shake ---------- */

    const cam = { base: 1.04, s: 0, v: 0 };   // spring offset on top of base zoom
    const shake = { x: 0, y: 0, power: 0 };
    const look = { x: 0, y: 0 };               // smoothed pointer (-1..1)

    function kickCamera(impulse, shakePower) {
        if (reduceMotion) return;
        cam.v += impulse;
        shake.power = Math.max(shake.power, shakePower);
    }

    function updateCamera(dt, t) {
        // Critically-underdamped spring gives a physical dolly "punch"
        const k = 70, d = 9;
        cam.v += (-k * cam.s - d * cam.v) * dt;
        cam.s += cam.v * dt;

        shake.power *= Math.pow(0.002, dt);
        shake.x = Math.sin(t * 61) * shake.power;
        shake.y = Math.cos(t * 53) * shake.power;

        const follow = reduceMotion ? 0 : 1 - Math.pow(0.0008, dt);
        look.x += (pointer.nx - look.x) * follow;
        look.y += (pointer.ny - look.y) * follow;

        // Subtle handheld breathing keeps the frame alive when idle
        const breathe = reduceMotion ? 0 : Math.sin(t * 0.35) * 0.004;

        const st = scene.style;
        st.setProperty('--px', look.x.toFixed(4));
        st.setProperty('--py', look.y.toFixed(4));
        st.setProperty('--sx', shake.x.toFixed(2));
        st.setProperty('--sy', shake.y.toFixed(2));
        st.setProperty('--cam', (cam.base + cam.s + breathe).toFixed(4));
    }

    /* ---------- Magnetic moon + pointer tracking ---------- */

    const magnet = { x: 0, y: 0, tx: 0, ty: 0 };

    function onPointerMove(e) {
        pointer.x = e.clientX;
        pointer.y = e.clientY;
        pointer.nx = (e.clientX / W) * 2 - 1;
        pointer.ny = (e.clientY / H) * 2 - 1;
        pointer.active = true;
        scene.style.setProperty('--mx', e.clientX + 'px');
        scene.style.setProperty('--my', e.clientY + 'px');
        scene.classList.add('pointer');

        if (reduceMotion) return;
        const r = moon.getBoundingClientRect();
        const cx = r.left + r.width / 2 - magnet.x;
        const cy = r.top + r.height / 2 - magnet.y;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const dist = Math.hypot(dx, dy);
        const reach = Math.max(r.width * 1.8, 140);
        if (dist < reach) {
            const pull = (1 - dist / reach) * 0.22;
            magnet.tx = dx * pull;
            magnet.ty = dy * pull;
        } else {
            magnet.tx = magnet.ty = 0;
        }
    }

    function onPointerLeave() {
        pointer.active = false;
        pointer.x = pointer.y = -9999;
        pointer.nx = pointer.ny = 0;
        magnet.tx = magnet.ty = 0;
        scene.classList.remove('pointer');
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('blur', onPointerLeave);
    if (coarse) {
        window.addEventListener('pointerup', () => setTimeout(onPointerLeave, 600), { passive: true });
    }

    /* ---------- Main render loop ---------- */

    let last = performance.now();
    let running = true;

    function frame(now) {
        if (!running) return;
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        const t = now / 1000;

        const target = body.classList.contains('is-on') ? 1 : 0;
        mood += (target - mood) * (1 - Math.pow(0.18, dt));   // eased ~1.8s crossfade

        magnet.x += (magnet.tx - magnet.x) * (1 - Math.pow(0.0005, dt));
        magnet.y += (magnet.ty - magnet.y) * (1 - Math.pow(0.0005, dt));
        moon.style.translate = `${magnet.x.toFixed(2)}px ${magnet.y.toFixed(2)}px`;

        updateCamera(dt, t);
        updateParticles(dt, t);
        drawParticles(t);
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // Pause everything when the tab is hidden to save battery
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            running = false;
        } else if (!running) {
            running = true;
            last = performance.now();
            requestAnimationFrame(frame);
        }
    });

    /* ---------- Lightning (haunted forest) ---------- */

    function scheduleLightning() {
        clearTimeout(lightningTimer);
        if (reduceMotion || !body.classList.contains('is-on')) return;
        lightningTimer = setTimeout(() => {
            if (!body.classList.contains('is-on') || document.hidden) {
                scheduleLightning();
                return;
            }
            scene.classList.remove('strike');
            void scene.offsetWidth;
            scene.classList.add('strike');
            kickCamera(0.05, 3);
            clearTimeout(strikeTimer);
            strikeTimer = setTimeout(() => scene.classList.remove('strike'), 750);
            scheduleLightning();
        }, rand(6000, 13000));
    }

    /* ---------- Animations ---------- */

    function playBrightnessDip() {
        clearTimeout(shiftTimer);
        scene.classList.remove('shifting');
        void scene.offsetWidth;
        scene.classList.add('shifting');
        shiftTimer = setTimeout(() => {
            scene.classList.remove('shifting');
        }, TRANSITION_MS);
    }

    function playClickBounce() {
        clearTimeout(clickTimer);
        moon.classList.remove('is-clicked');
        void moon.offsetWidth; // restart animation on rapid clicks
        moon.classList.add('is-clicked');
        clickTimer = setTimeout(() => {
            moon.classList.remove('is-clicked');
        }, 1900);
    }

    /* ---------- Toggle ---------- */

    function toggleMoon() {
        const turningOn = !body.classList.contains('is-on');

        body.classList.toggle('is-on', turningOn);
        body.classList.add('has-interacted'); // hides the "Click the moon" label
        moon.setAttribute('aria-pressed', String(turningOn));
        moon.setAttribute(
            'aria-label',
            turningOn
                ? 'Moon: click to return to the peaceful forest'
                : 'Moon: click to reveal the haunted forest'
        );

        if (turningOn) {
            playFairySound();
        } else {
            stopFairySound();
        }

        playClickBounce();
        playBrightnessDip();
        emitBurst();
        kickCamera(turningOn ? 0.55 : 0.35, turningOn ? 7 : 3);
        scheduleLightning();
    }

    moon.addEventListener('click', toggleMoon);
});
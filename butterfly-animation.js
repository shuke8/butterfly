/**
 * Butterfly Animation for rolstroi.ru
 * 3 butterflies: 1 big (bottom-left, 3x3cm) + 2 small (top-right, 2x2cm)
 * Natural flight within limited radius, then land back at corners
 */
(function () {
  'use strict';

  // ============ CONFIGURATION ============
  const CONFIG = {
    // Base path to butterfly images (change this when deploying to the site)
    imagePath: './assets/',

    // Butterfly definitions
    butterflies: [
      {
        id: 'babochka-big',
        size: 113, // 3cm in px at 96dpi
        wingLeftImg: 'big-left.png',
        wingRightImg: 'big-right.png',
        // Bottom-left corner
        restX: 40,
        restY: -100,  // from bottom (negative = from bottom)
        corner: 'bottom-left',
        radius: 280,
        delay: 600,
        flightDuration: 3800,
        idleInterval: [9000, 16000],
      },
      {
        id: 'babochka-sm1',
        size: 76, // 2cm in px
        wingLeftImg: 'small-left.png',
        wingRightImg: 'small-right.png',
        // Top-right corner (upper)
        restX: -110,
        restY: 70,
        corner: 'top-right',
        radius: 210,
        delay: 900,
        flightDuration: 3200,
        idleInterval: [10000, 18000],
      },
      {
        id: 'babochka-sm2',
        size: 76,
        wingLeftImg: 'small-left.png',
        wingRightImg: 'small-right.png',
        // Top-right corner (lower)
        restX: -55,
        restY: 190,
        corner: 'top-right',
        radius: 230,
        delay: 1400,
        flightDuration: 3400,
        idleInterval: [12000, 22000],
      },
    ],
  };

  // ============ INJECT CSS ============
  function injectCSS() {
    if (document.getElementById('babochka-styles')) return;
    const style = document.createElement('style');
    style.id = 'babochka-styles';
    style.textContent = `
      .babochka-wrap {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 99999;
        pointer-events: none;
        will-change: transform;
      }
      .babochka-inner {
        display: flex;
        align-items: center;
        justify-content: center;
        transform-style: preserve-3d;
      }
      .babochka-wl, .babochka-wr {
        display: block;
        will-change: transform;
        transform-style: preserve-3d;
      }
      .babochka-wl {
        transform-origin: 100% 50%;
      }
      .babochka-wr {
        transform-origin: 0% 50%;
      }
      .babochka-wl img, .babochka-wr img {
        display: block;
        width: 100%;
        height: auto;
        pointer-events: none;
        user-select: none;
        -webkit-user-drag: none;
      }
    `;
    document.head.appendChild(style);
  }

  // ============ MATH HELPERS ============
  function rand(a, b) { return Math.random() * (b - a) + a; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // Smooth easing
  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  // Cubic bezier point
  function bz(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  }

  // Simple 1D noise for organic feel
  function noise(seed) {
    let x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  // ============ BUTTERFLY CLASS ============
  class Butterfly {
    constructor(cfg) {
      this.cfg = cfg;
      this.el = null;
      this.wl = null;
      this.wr = null;

      this.state = 'idle'; // idle | flying
      this.x = 0;
      this.y = 0;
      this.restX = 0;
      this.restY = 0;
      this.rot = 0;         // body rotation (degrees)
      this.scale = 1;

      // Wing state
      this.flapT = rand(0, 100); // phase offset so butterflies don't sync
      this.flapAngle = 15;       // current max angle
      this.targetFlapAngle = 15;
      this.flapSpeed = 0.012;    // radians per ms
      this.targetFlapSpeed = 0.012;

      // Flight state
      this.flightPath = null;
      this.flightStart = 0;
      this.flightDur = 0;

      // Idle micro-flutter
      this.idleFlutterTimer = null;
      this.idleFlutterActive = false;

      this.bobPhase = rand(0, Math.PI * 2);
      this.lastNow = 0;
      this.raf = null;
      this.nextFlightTimer = null;
    }

    // --- DOM ---
    create() {
      const c = this.cfg;
      this.el = document.createElement('div');
      this.el.className = 'babochka-wrap';
      this.el.id = c.id;

      const inner = document.createElement('div');
      inner.className = 'babochka-inner';

      const ww = Math.round(c.size * 0.52);

      // Left wing
      this.wl = document.createElement('div');
      this.wl.className = 'babochka-wl';
      this.wl.style.width = ww + 'px';
      const il = new Image();
      il.src = CONFIG.imagePath + c.wingLeftImg;
      il.alt = '';
      this.wl.appendChild(il);

      // Right wing
      this.wr = document.createElement('div');
      this.wr.className = 'babochka-wr';
      this.wr.style.width = ww + 'px';
      const ir = new Image();
      ir.src = CONFIG.imagePath + c.wingRightImg;
      ir.alt = '';
      this.wr.appendChild(ir);

      inner.appendChild(this.wl);
      inner.appendChild(this.wr);
      this.el.appendChild(inner);
      document.body.appendChild(this.el);

      this.calcRest();
      this.x = this.restX;
      this.y = this.restY;
      this.applyTransform();

      // Start idle
      this.setIdle();
      this.scheduleIdleMicroFlutter();

      // First flight after delay
      this.nextFlightTimer = setTimeout(() => this.takeOff(), c.delay);
    }

    calcRest() {
      const c = this.cfg;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (c.corner === 'bottom-left') {
        this.restX = c.restX;
        this.restY = vh + c.restY;
      } else {
        this.restX = vw + c.restX;
        this.restY = c.restY;
      }
    }

    applyTransform() {
      this.el.style.transform =
        `translate3d(${this.x | 0}px, ${this.y | 0}px, 0) rotate(${this.rot.toFixed(1)}deg) scale(${this.scale.toFixed(3)})`;
    }

    applyWings() {
      // Natural wing beat: sine wave + harmonics for organic feel
      const base = Math.sin(this.flapT);
      const harmonic = Math.sin(this.flapT * 3) * 0.08;
      const beat = base + harmonic;

      const aL = this.flapAngle * (beat + noise(this.flapT) * 0.05);
      const aR = this.flapAngle * (beat - noise(this.flapT + 50) * 0.05);

      this.wl.style.transform = `perspective(300px) rotateY(${aL.toFixed(1)}deg)`;
      this.wr.style.transform = `perspective(300px) rotateY(${(-aR).toFixed(1)}deg)`;
    }

    // --- State transitions ---
    setIdle() {
      this.state = 'idle';
      this.targetFlapAngle = 15;
      this.targetFlapSpeed = 0.012;
    }

    setFlying() {
      this.state = 'flying';
      this.targetFlapAngle = 72;
      this.targetFlapSpeed = 0.055;
    }

    // Occasional small wing flutter while sitting (like a real butterfly)
    scheduleIdleMicroFlutter() {
      const delay = rand(3000, 8000);
      this.idleFlutterTimer = setTimeout(() => {
        if (this.state === 'idle') {
          // Quick flutter: increase flap angle briefly
          this.targetFlapAngle = 45;
          this.targetFlapSpeed = 0.04;
          setTimeout(() => {
            if (this.state === 'idle') {
              this.targetFlapAngle = 15;
              this.targetFlapSpeed = 0.012;
            }
          }, 400 + rand(0, 300));
        }
        this.scheduleIdleMicroFlutter();
      }, delay);
    }

    // --- Flight path generation ---
    generatePath() {
      const c = this.cfg;
      const r = c.radius;
      const sx = this.restX;
      const sy = this.restY;

      // Direction away from corner
      let dx = c.corner === 'bottom-left' ? 1 : -1;
      let dy = c.corner === 'bottom-left' ? -1 : 1;

      // Generate 3-5 waypoints in an arc within the radius
      const numWP = 3 + Math.floor(rand(0, 2));
      const wps = [];

      for (let i = 0; i < numWP; i++) {
        const frac = (i + 1) / (numWP + 1);
        // Base angle spreads from 0.1π to 0.9π for variety
        const baseAngle = lerp(0.1, 0.9, frac) * Math.PI * 0.5;
        // Add randomness
        const angle = baseAngle + rand(-0.3, 0.3);
        const dist = rand(0.25, 0.85) * r;

        let wx = sx + Math.cos(angle) * dist * dx;
        let wy = sy + Math.sin(angle) * dist * dy;

        // Keep within viewport
        wx = clamp(wx, 30, window.innerWidth - 30);
        wy = clamp(wy, 30, window.innerHeight - 30);

        wps.push({ x: wx, y: wy });
      }

      // Build bezier segments
      const segs = [];
      let prev = { x: sx, y: sy };

      for (const wp of wps) {
        const mx = (prev.x + wp.x) / 2;
        const my = (prev.y + wp.y) / 2;
        segs.push({
          p0: prev,
          p1: { x: mx + rand(-50, 50), y: prev.y + rand(-40, 40) },
          p2: { x: mx + rand(-50, 50), y: wp.y + rand(-40, 40) },
          p3: wp,
        });
        prev = wp;
      }

      // Return to rest
      const mx = (prev.x + sx) / 2;
      const my = (prev.y + sy) / 2;
      segs.push({
        p0: prev,
        p1: { x: mx + rand(-30, 30), y: my + rand(-30, 30) },
        p2: { x: sx + rand(-20, 20) * dx, y: sy + rand(-20, 20) * dy },
        p3: { x: sx, y: sy },
      });

      return segs;
    }

    takeOff() {
      if (this.state === 'flying') return;

      this.setFlying();
      this.flightPath = this.generatePath();
      this.flightStart = performance.now();
      this.flightDur = this.cfg.flightDuration + rand(-400, 400);
    }

    updateFlight(now) {
      const elapsed = now - this.flightStart;
      if (elapsed >= this.flightDur) {
        // Land
        this.x = this.restX;
        this.y = this.restY;
        this.rot = 0;
        this.scale = 1;
        this.setIdle();
        this.applyTransform();
        this.scheduleNextFlight();
        return;
      }

      let t = elapsed / this.flightDur;

      // Piecewise easing: gentle take-off, natural mid-flight, smooth landing
      let et;
      if (t < 0.12) {
        et = easeInOut(t / 0.12) * 0.12;
      } else if (t > 0.82) {
        et = 0.82 + easeInOut((t - 0.82) / 0.18) * 0.18;
      } else {
        et = t;
      }

      // Map to path segments
      const n = this.flightPath.length;
      const sf = et * n;
      const si = Math.min(Math.floor(sf), n - 1);
      const st = sf - si;
      const s = this.flightPath[si];

      const nx = bz(s.p0.x, s.p1.x, s.p2.x, s.p3.x, st);
      const ny = bz(s.p0.y, s.p1.y, s.p2.y, s.p3.y, st);

      // Natural bobbing tied to wing beats
      this.bobPhase += 0.18;
      const bobAmp = t < 0.1 ? t * 50 : t > 0.85 ? (1 - t) * 30 : 5;
      const bob = Math.sin(this.bobPhase) * bobAmp;

      // Slight lateral wobble (butterflies sway side-to-side)
      const wobble = Math.sin(this.bobPhase * 0.7 + 1.3) * 3;

      // Rotation follows flight direction (subtle banking)
      const ddx = nx - this.x;
      const ddy = ny - this.y;
      if (Math.abs(ddx) > 0.5 || Math.abs(ddy) > 0.5) {
        const target = Math.atan2(ddy, ddx) * (180 / Math.PI);
        // Dampen: only use ~25% of actual direction for subtle effect
        this.rot = lerp(this.rot, target * 0.25, 0.06);
      }

      // Slow down flapping near landing
      if (t > 0.7) {
        const slow = (t - 0.7) / 0.3;
        this.targetFlapAngle = lerp(72, 20, slow);
        this.targetFlapSpeed = lerp(0.055, 0.015, slow);
      }

      // Slight scale variation for depth illusion
      this.scale = 1 + Math.sin(t * Math.PI) * 0.06;

      this.x = nx + wobble;
      this.y = ny + bob;
      this.applyTransform();
    }

    scheduleNextFlight() {
      const [lo, hi] = this.cfg.idleInterval;
      this.nextFlightTimer = setTimeout(() => this.takeOff(), rand(lo, hi));
    }

    // --- Main loop ---
    tick(now) {
      const dt = this.lastNow ? now - this.lastNow : 16;
      this.lastNow = now;

      // Smoothly approach target flap params
      this.flapAngle = lerp(this.flapAngle, this.targetFlapAngle, clamp(dt * 0.004, 0, 1));
      this.flapSpeed = lerp(this.flapSpeed, this.targetFlapSpeed, clamp(dt * 0.004, 0, 1));

      // Advance wing phase
      this.flapT += this.flapSpeed * dt;
      this.applyWings();

      if (this.state === 'flying') {
        this.updateFlight(now);
      }

      this.raf = requestAnimationFrame((t) => this.tick(t));
    }

    start() {
      this.tick(performance.now());
    }

    handleResize() {
      const ox = this.restX;
      const oy = this.restY;
      this.calcRest();
      if (this.state === 'idle') {
        this.x = this.restX;
        this.y = this.restY;
        this.applyTransform();
      } else {
        this.x += this.restX - ox;
        this.y += this.restY - oy;
      }
    }

    destroy() {
      if (this.raf) cancelAnimationFrame(this.raf);
      if (this.nextFlightTimer) clearTimeout(this.nextFlightTimer);
      if (this.idleFlutterTimer) clearTimeout(this.idleFlutterTimer);
      if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    }
  }

  // ============ INITIALIZATION ============
  let instances = [];

  function init() {
    // Skip on very small screens
    if (window.innerWidth < 500) return;

    // Prevent double-init
    if (instances.length) return;

    injectCSS();

    CONFIG.butterflies.forEach(cfg => {
      const b = new Butterfly(cfg);
      b.create();
      b.start();
      instances.push(b);
    });

    window.addEventListener('resize', () => {
      instances.forEach(b => b.handleResize());
    });
  }

  function destroy() {
    instances.forEach(b => b.destroy());
    instances = [];
  }

  // Auto-start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Small delay to not compete with page rendering
    setTimeout(init, 100);
  }

  // Public API
  window.ButterflyAnimation = {
    init,
    destroy,
    get butterflies() { return instances; },
  };
})();

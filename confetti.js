/**
 * Lightweight Canvas Confetti Engine
 */
(function (global) {
  'use strict';

  class ConfettiEngine {
    constructor() {
      this.canvas = null;
      this.ctx = null;
      this.particles = [];
      this.animId = null;
    }

    createCanvas() {
      if (this.canvas) return;
      this.canvas = document.createElement('canvas');
      this.canvas.id = 'confetti-canvas';
      this.canvas.style.position = 'fixed';
      this.canvas.style.top = '0';
      this.canvas.style.left = '0';
      this.canvas.style.width = '100vw';
      this.canvas.style.height = '100vh';
      this.canvas.style.pointerEvents = 'none';
      this.canvas.style.zIndex = '9999';
      document.body.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      if (!this.canvas) return;
      this.canvas.width = window.innerWidth * window.devicePixelRatio;
      this.canvas.height = window.innerHeight * window.devicePixelRatio;
      if (this.ctx) {
        this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      }
    }

    burst(options) {
      this.createCanvas();
      const count = (options && options.count) || 120;
      const colors = (options && options.colors) || ['#2563eb', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];
      const originX = (options && options.x !== undefined) ? options.x : window.innerWidth / 2;
      const originY = (options && options.y !== undefined) ? options.y : window.innerHeight * 0.4;

      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const velocity = Math.random() * 8 + 4;
        this.particles.push({
          x: originX,
          y: originY,
          vx: Math.cos(angle) * velocity + (Math.random() - 0.5) * 4,
          vy: Math.sin(angle) * velocity - Math.random() * 4 - 3,
          size: Math.random() * 7 + 4,
          color: colors[Math.floor(Math.random() * colors.length)],
          rotation: Math.random() * 360,
          rotationSpeed: (Math.random() - 0.5) * 12,
          opacity: 1,
          gravity: 0.18,
          drag: 0.98,
          wobble: Math.random() * 10
        });
      }

      if (!this.animId) {
        this.animate();
      }
    }

    animate() {
      if (!this.ctx) return;
      this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.vx *= p.drag;
        p.vy *= p.drag;
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;
        p.opacity -= 0.009;

        if (p.opacity <= 0 || p.y > window.innerHeight + 20) {
          this.particles.splice(i, 1);
          continue;
        }

        this.ctx.save();
        this.ctx.translate(p.x, p.y);
        this.ctx.rotate((p.rotation * Math.PI) / 180);
        this.ctx.globalAlpha = Math.max(0, p.opacity);
        this.ctx.fillStyle = p.color;
        this.ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        this.ctx.restore();
      }

      if (this.particles.length > 0) {
        this.animId = requestAnimationFrame(() => this.animate());
      } else {
        this.ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
        this.animId = null;
      }
    }
  }

  global.confettiEngine = new ConfettiEngine();
})(typeof window !== 'undefined' ? window : this);


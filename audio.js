/**
 * Subtle & Classic Audio Engine using Web Audio API
 * Generates delicate acoustic-style feedback tones, chimes, and fanfare.
 */
(function (global) {
  'use strict';

  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.volume = 0.4;
      this.initOnInteraction = this.initOnInteraction.bind(this);

      if (typeof window !== 'undefined') {
        window.addEventListener('click', this.initOnInteraction, { once: true });
        window.addEventListener('keydown', this.initOnInteraction, { once: true });
        window.addEventListener('touchstart', this.initOnInteraction, { once: true });
      }
    }

    init() {
      if (!this.ctx && typeof window !== 'undefined') {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.ctx = new AudioContext();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    }

    initOnInteraction() {
      this.init();
    }

    toggle() {
      this.enabled = !this.enabled;
      return this.enabled;
    }

    playVote() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880.00, now + 0.08); // A5

      gain.gain.setValueAtTime(this.volume * 0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.13);
    }

    playTick() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);

      gain.gain.setValueAtTime(this.volume * 0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.05);
    }

    playReveal() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      // Classic ascending 3-tone arpeggio (C major / G major)
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, index) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + index * 0.09);

        const startTime = now + index * 0.09;
        gain.gain.setValueAtTime(0.0001, startTime);
        gain.gain.exponentialRampToValueAtTime(this.volume * 0.35, startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.35);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + 0.36);
      });
    }

    playVictory() {
      if (!this.enabled) return;
      this.init();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const chords = [
        { freqs: [523.25, 659.25, 783.99], time: 0, dur: 0.18 }, // C maj
        { freqs: [587.33, 739.99, 880.00], time: 0.18, dur: 0.18 }, // D maj
        { freqs: [659.25, 830.61, 987.77], time: 0.36, dur: 0.22 }, // E maj
        { freqs: [1046.50, 1318.51, 1567.98], time: 0.58, dur: 0.6 } // High C maj
      ];

      chords.forEach(chord => {
        chord.freqs.forEach(f => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(f, now + chord.time);

          const start = now + chord.time;
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(this.volume * 0.22, start + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + chord.dur);

          osc.connect(gain);
          gain.connect(this.ctx.destination);

          osc.start(start);
          osc.stop(start + chord.dur + 0.05);
        });
      });
    }
  }

  global.soundEngine = new SoundEngine();
})(typeof window !== 'undefined' ? window : this);


/**
 * Central State Manager for Live Voting App
 */
(function (global) {
  'use strict';

  class StateManager {
    constructor() {
      this.state = {
        currentView: 'home', // 'home', 'host', 'projector', 'voter'
        activePoll: null,
        userRole: null, // 'host', 'voter', 'projector'
        participant: {
          id: this.getOrCreateParticipantId(),
          name: localStorage.getItem('lva_user_name') || '',
          votes: {} // questionId -> selection
        },
        theme: localStorage.getItem('lva_theme') || 'dark',
        soundEnabled: localStorage.getItem('lva_sound') !== 'false',
        timer: {
          remaining: 0,
          total: 0,
          isRunning: false,
          intervalId: null
        }
      };

      this.listeners = [];
    }

    getOrCreateParticipantId() {
      let id = localStorage.getItem('lva_participant_id');
      if (!id) {
        id = 'p_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
        localStorage.setItem('lva_participant_id', id);
      }
      return id;
    }

    subscribe(listener) {
      this.listeners.push(listener);
      return () => {
        this.listeners = this.listeners.filter(l => l !== listener);
      };
    }

    notify() {
      this.listeners.forEach(fn => fn(this.state));
    }

    setTheme(theme) {
      this.state.theme = theme;
      localStorage.setItem('lva_theme', theme);
      if (document.documentElement) {
        document.documentElement.setAttribute('data-theme', theme);
      }
      this.notify();
    }

    toggleTheme() {
      const nextTheme = this.state.theme === 'dark' ? 'light' : 'dark';
      this.setTheme(nextTheme);
    }

    toggleSound() {
      this.state.soundEnabled = !this.state.soundEnabled;
      localStorage.setItem('lva_sound', this.state.soundEnabled);
      this.notify();
    }

    setParticipantName(name) {
      this.state.participant.name = (name || '').trim();
      localStorage.setItem('lva_user_name', this.state.participant.name);
      this.notify();
    }

    setActivePoll(poll) {
      this.state.activePoll = poll;
      this.notify();
    }

    setView(viewName) {
      this.state.currentView = viewName;
      this.notify();
    }

    recordLocalVote(questionId, selection) {
      this.state.participant.votes[questionId] = selection;
      this.notify();
    }
  }

  // Export Singleton to global scope
  global.appState = new StateManager();

})(typeof window !== 'undefined' ? window : this);

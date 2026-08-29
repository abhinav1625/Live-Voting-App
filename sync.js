/**
 * Real-Time Synchronization Layer
 * Provides zero-latency communication across tabs, windows, and wireless devices
 * using BroadcastChannel, LocalStorage events, and optional WebRTC PeerJS.
 */
(function (global) {
  'use strict';

  class SyncEngine {
    constructor() {
      this.channel = null;
      this.roomCode = null;
      this.isHost = false;
      this.listeners = {};
      this.peer = null;
      this.connections = [];
      this.storageKeyPrefix = 'lva_room_';

      this.handleStorageEvent = this.handleStorageEvent.bind(this);
    }

    on(event, callback) {
      if (!this.listeners[event]) {
        this.listeners[event] = [];
      }
      this.listeners[event].push(callback);
    }

    off(event, callback) {
      if (!this.listeners[event]) return;
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }

    emit(event, data) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(cb => {
          try {
            cb(data);
          } catch (err) {
            console.error('Error in sync listener:', err);
          }
        });
      }
    }

    connect(roomCode, isHost = false) {
      this.disconnect();
      this.roomCode = (roomCode || '').toUpperCase().trim();
      this.isHost = isHost;

      // 1. BroadcastChannel setup (modern browsers, same origin tabs)
      if (typeof window !== 'undefined' && window.BroadcastChannel) {
        try {
          this.channel = new BroadcastChannel(`lva_sync_${this.roomCode}`);
          this.channel.onmessage = (e) => {
            if (e.data && e.data.type) {
              this.emit(e.data.type, e.data.payload);
            }
          };
        } catch (e) {
          console.warn('BroadcastChannel error:', e);
        }
      }

      // 2. Storage event listener fallback (same browser cross-window)
      if (typeof window !== 'undefined') {
        window.addEventListener('storage', this.handleStorageEvent);
      }

      // 3. WebRTC / PeerJS initialization if PeerJS is available in global
      this.initPeerJS();
    }

    disconnect() {
      if (this.channel) {
        try { this.channel.close(); } catch (_) {}
        this.channel = null;
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', this.handleStorageEvent);
      }
      if (this.peer) {
        try { this.peer.destroy(); } catch (_) {}
        this.peer = null;
      }
      this.connections = [];
    }

    handleStorageEvent(e) {
      if (!e.key || !this.roomCode) return;
      if (e.key === `lva_event_${this.roomCode}` && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed && parsed.type) {
            this.emit(parsed.type, parsed.payload);
          }
        } catch (_) {}
      }
    }

    broadcast(type, payload) {
      const message = { type, payload, timestamp: Date.now() };

      // Send via BroadcastChannel
      if (this.channel) {
        try {
          this.channel.postMessage(message);
        } catch (e) {
          console.warn('BroadcastChannel post error:', e);
        }
      }

      // Send via LocalStorage trigger for cross-tab sync
      try {
        localStorage.setItem(`lva_event_${this.roomCode}`, JSON.stringify(message));
      } catch (_) {}

      // Send via PeerJS WebRTC data channels if any connected peers
      if (this.connections && this.connections.length > 0) {
        this.connections.forEach(conn => {
          if (conn.open) {
            try {
              conn.send(message);
            } catch (_) {}
          }
        });
      }
    }

    sendVote(voteData) {
      // Broadcast vote to host & peers
      this.broadcast('vote_received', voteData);
    }

    broadcastHostState(pollState) {
      this.broadcast('state_update', pollState);
      // Persist in localStorage as authoritative state
      try {
        localStorage.setItem(`lva_poll_${this.roomCode}`, JSON.stringify(pollState));
      } catch (_) {}
    }

    getPersistedState(roomCode) {
      try {
        const raw = localStorage.getItem(`lva_poll_${roomCode}`);
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    }

    initPeerJS() {
      // Optional WebRTC support if PeerJS script is loaded
      if (typeof window !== 'undefined' && window.Peer) {
        try {
          const peerId = this.isHost ? `lva-host-${this.roomCode.toLowerCase()}` : undefined;
          this.peer = new window.Peer(peerId, { debug: 1 });

          if (this.isHost) {
            this.peer.on('connection', (conn) => {
              this.connections.push(conn);
              conn.on('open', () => {
                // Send current active poll state to new participant
                const activePoll = global.appState && global.appState.state && global.appState.state.activePoll;
                if (activePoll) {
                  try {
                    conn.send({ type: 'state_update', payload: activePoll, timestamp: Date.now() });
                  } catch (_) {}
                }
              });
              conn.on('data', (data) => {
                if (data && data.type) {
                  this.emit(data.type, data.payload);
                }
              });
            });
          } else {
            // Participant connects to Host peer
            const hostPeerId = `lva-host-${this.roomCode.toLowerCase()}`;
            this.peer.on('open', () => {
              const conn = this.peer.connect(hostPeerId, { reliable: true });
              this.connections.push(conn);
              conn.on('data', (data) => {
                if (data && data.type) {
                  this.emit(data.type, data.payload);
                }
              });
            });
          }
        } catch (err) {
          console.warn('PeerJS WebRTC initialization bypassed (local sync active).');
        }
      }
    }
  }

  global.syncEngine = new SyncEngine();
})(typeof window !== 'undefined' ? window : this);


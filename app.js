/**
 * Main Application Orchestrator for Live Voting App
 */
(function (global) {
  'use strict';

  class LiveVotingApp {
    constructor() {
      this.state = global.appState;
      this.sync = global.syncEngine;
      this.poll = global.pollEngine;
      this.qr = global.QRCodeGenerator;
      this.audio = global.soundEngine;
      this.confetti = global.confettiEngine;

      this.currentQuestionTimer = null;
      this.cameraStream = null;
      this.qrScanInterval = null;

      // Options state for modal builder (defaults to 4 options)
      this.modalOptions = [
        { text: '', isCorrect: true },
        { text: '', isCorrect: false },
        { text: '', isCorrect: false },
        { text: '', isCorrect: false }
      ];

      this.init();
    }

    init() {
      // Set initial theme
      if (document.documentElement) {
        document.documentElement.setAttribute('data-theme', this.state.state.theme);
      }

      // Bind global sync event listeners
      this.bindSyncEvents();

      // Bind UI event listeners
      this.bindDOMEvents();

      // Initialize modal options builder
      this.renderModalOptionRows();

      // Listen for URL route / parameters
      this.handleRoute();
      window.addEventListener('popstate', () => this.handleRoute());

      // State subscription
      this.state.subscribe((s) => this.renderHeaderState(s));
    }

    /* --------------------------------------------------------------------------
       ROUTING & VIEW MANAGEMENT
       -------------------------------------------------------------------------- */
    handleRoute() {
      const urlParams = new URLSearchParams(window.location.search);
      const hash = window.location.hash.replace('#', '');
      const joinCode = urlParams.get('join') || urlParams.get('room');

      if (joinCode) {
        // Auto-join as participant
        this.joinPoll(joinCode.toUpperCase());
        return;
      }

      if (hash.startsWith('host=')) {
        const room = hash.split('=')[1];
        this.loadHostSession(room);
        return;
      }

      if (hash.startsWith('projector=')) {
        const room = hash.split('=')[1];
        this.loadProjectorSession(room);
        return;
      }

      if (hash.startsWith('voter=')) {
        const room = hash.split('=')[1];
        this.joinPoll(room);
        return;
      }

      // Default home
      this.showView('home');
    }

    showView(viewName) {
      this.state.setView(viewName);

      const views = document.querySelectorAll('.view-section');
      views.forEach(v => {
        if (v.id === `view-${viewName}`) {
          v.classList.add('active');
        } else {
          v.classList.remove('active');
        }
      });
    }

    showToast(message, duration = 3000) {
      const container = document.getElementById('toast-container');
      if (!container) return;

      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.textContent = message;
      container.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }

    /* --------------------------------------------------------------------------
       REAL-TIME SYNC EVENT HANDLERS
       -------------------------------------------------------------------------- */
    bindSyncEvents() {
      // 1. Host receives vote from participant
      this.sync.on('vote_received', (voteData) => {
        if (this.state.state.userRole === 'host' && this.state.state.activePoll) {
          const poll = this.state.state.activePoll;
          if (poll.status === 'locked') return;

          const { questionId, participantId, participantName, selection, timeRemaining } = voteData;

          if (!poll.responses[questionId]) {
            poll.responses[questionId] = {};
          }

          // Register participant if not present
          if (!poll.participants[participantId]) {
            poll.participants[participantId] = {
              id: participantId,
              name: participantName || `Voter #${Object.keys(poll.participants).length + 1}`,
              joinedAt: new Date().toISOString()
            };
          }

          // Record vote
          poll.responses[questionId][participantId] = {
            selection,
            timeRemaining,
            timestamp: Date.now()
          };

          // Play subtle audio pop
          if (this.audio) this.audio.playVote();

          // Save & broadcast update to projectors and voters
          this.state.setActivePoll(poll);
          this.sync.broadcastHostState(poll);

          // Update host & projector views
          this.renderActiveQuestionVisualizer();
          this.renderHostHeaderCounts();
        }
      });

      // 2. Participant & Projector receive state update from Host
      this.sync.on('state_update', (updatedPoll) => {
        if (this.state.state.userRole !== 'host') {
          this.state.setActivePoll(updatedPoll);

          if (this.state.state.currentView === 'voter') {
            this.renderVoterScreen();
          } else if (this.state.state.currentView === 'projector') {
            this.renderProjectorScreen();
          }
        }
      });

      // 3. Reveal answer signal
      this.sync.on('reveal_answer', (data) => {
        if (this.audio) this.audio.playReveal();
        if (this.confetti) this.confetti.burst();
      });

      // 4. Timer synchronization events
      this.sync.on('timer_start', (data) => {
        this.state.state.timer.total = data.total;
        this.state.state.timer.remaining = data.remaining;
        this.state.state.timer.isRunning = true;
        this.updateTimerUI();
      });

      this.sync.on('timer_tick', (data) => {
        this.state.state.timer.total = data.total;
        this.state.state.timer.remaining = data.remaining;
        this.state.state.timer.isRunning = true;
        this.updateTimerUI();
        if (data.remaining <= 5 && data.remaining > 0) {
          if (this.audio) this.audio.playTick();
        }
      });

      this.sync.on('timer_stop', () => {
        this.stopTimer(false);
        this.updateTimerUI();
      });
    }

    /* --------------------------------------------------------------------------
       POLL CREATION & HOSTING
       -------------------------------------------------------------------------- */
    createNewPoll(title = 'Live Voting Session') {
      const newPoll = this.poll.createDefaultPoll(title);
      this.state.state.userRole = 'host';
      this.state.setActivePoll(newPoll);
      this.sync.connect(newPoll.roomCode, true);
      this.sync.broadcastHostState(newPoll);

      window.location.hash = `host=${newPoll.roomCode}`;
      this.showView('host');
      this.renderHostStudio();
      this.showToast(`Poll room created! PIN: ${newPoll.roomCode}`);

      // Auto open add-question modal if no questions exist
      if (newPoll.questions.length === 0) {
        setTimeout(() => {
          this.openAddQuestionModal();
        }, 300);
      }
    }

    loadHostSession(roomCode) {
      const persisted = this.sync.getPersistedState(roomCode);
      if (persisted) {
        this.state.state.userRole = 'host';
        this.state.setActivePoll(persisted);
        this.sync.connect(roomCode, true);
        this.showView('host');
        this.renderHostStudio();
      } else {
        this.createNewPoll('Live Voting Session');
      }
    }

    loadProjectorSession(roomCode) {
      this.state.state.userRole = 'projector';
      this.sync.connect(roomCode, false);
      const persisted = this.sync.getPersistedState(roomCode);
      if (persisted) {
        this.state.setActivePoll(persisted);
      }
      this.showView('projector');
      this.renderProjectorScreen();
    }

    joinPoll(roomCode) {
      roomCode = (roomCode || '').toUpperCase().trim();
      if (!roomCode) {
        this.showToast('Please enter a valid 6-character room PIN');
        return;
      }

      this.state.state.userRole = 'voter';
      this.sync.connect(roomCode, false);

      const persisted = this.sync.getPersistedState(roomCode);
      if (persisted) {
        this.state.setActivePoll(persisted);
      }

      window.location.hash = `voter=${roomCode}`;
      this.showView('voter');
      this.renderVoterScreen();
    }

    /* --------------------------------------------------------------------------
       HOST STUDIO RENDERING & ACTIONS
       -------------------------------------------------------------------------- */
    renderHostStudio() {
      const poll = this.state.state.activePoll;
      if (!poll) return;

      // Update room code displays
      document.querySelectorAll('.current-room-code').forEach(el => {
        el.textContent = poll.roomCode;
      });

      // Render Question Sidebar
      this.renderHostSidebarList();

      // Render Top Bar & Active Question
      this.renderHostHeaderCounts();
      this.renderActiveQuestionVisualizer();
      this.updateTimerUI();
    }

    renderHostSidebarList() {
      const poll = this.state.state.activePoll;
      const listEl = document.getElementById('host-question-list');
      if (!listEl || !poll) return;

      listEl.innerHTML = '';

      if (poll.questions.length === 0) {
        listEl.innerHTML = `
          <div style="text-align: center; padding: 1.5rem 0.5rem; color: var(--text-muted); font-size: 0.85rem;">
            No questions yet.<br>Click "+ Add" or "📦 Sets" to create questions.
          </div>
        `;
        return;
      }

      poll.questions.forEach((q, idx) => {
        const item = document.createElement('div');
        item.className = `q-nav-item ${idx === poll.activeQuestionIndex ? 'active' : ''}`;
        item.innerHTML = `
          <div style="display: flex; align-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; cursor: pointer;">
            <span style="font-size: 0.8rem; font-weight: 700; margin-right: 0.4rem;">${idx + 1}.</span>
            <span style="overflow: hidden; text-overflow: ellipsis;">${q.title || 'Untitled Question'}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.35rem; flex-shrink: 0;">
            <span class="q-type-tag">${q.type}</span>
            <button type="button" class="q-item-delete-btn" title="Delete Question" data-index="${idx}">🗑️</button>
          </div>
        `;

        // Switch active question when clicking item body
        item.querySelector('div:first-child').addEventListener('click', () => {
          this.switchHostActiveQuestion(idx);
        });

        // Delete question button
        const delBtn = item.querySelector('.q-item-delete-btn');
        if (delBtn) {
          delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteQuestion(idx);
          });
        }

        listEl.appendChild(item);
      });
    }

    deleteQuestion(index) {
      const poll = this.state.state.activePoll;
      if (!poll || index < 0 || index >= poll.questions.length) return;

      const deletedQ = poll.questions[index];
      poll.questions.splice(index, 1);

      // Clean up responses for deleted question
      if (deletedQ && poll.responses[deletedQ.id]) {
        delete poll.responses[deletedQ.id];
      }

      // Adjust active question index safely
      if (poll.questions.length === 0) {
        poll.activeQuestionIndex = 0;
      } else if (poll.activeQuestionIndex >= poll.questions.length) {
        poll.activeQuestionIndex = Math.max(0, poll.questions.length - 1);
      }

      this.stopTimer();
      this.state.setActivePoll(poll);
      this.sync.broadcastHostState(poll);
      this.renderHostStudio();
      this.showToast(`Deleted question.`);
    }

    getQuestionStatus(questionId) {
      const poll = this.state.state.activePoll;
      if (!poll || !questionId) return 'open';
      if (poll.revealedQuestions && poll.revealedQuestions[questionId]) return 'revealed';
      if (poll.questionStatuses && poll.questionStatuses[questionId]) return poll.questionStatuses[questionId];
      return 'open';
    }

    setQuestionStatus(questionId, status) {
      const poll = this.state.state.activePoll;
      if (!poll || !questionId) return;
      if (!poll.questionStatuses) poll.questionStatuses = {};
      if (!poll.revealedQuestions) poll.revealedQuestions = {};

      poll.questionStatuses[questionId] = status;
      if (status === 'revealed') {
        poll.revealedQuestions[questionId] = true;
      }
      
      // Keep active question's status synced with poll.status
      const currentQ = poll.questions && poll.questions[poll.activeQuestionIndex];
      if (currentQ && currentQ.id === questionId) {
        poll.status = status;
      }
    }

    switchHostActiveQuestion(index) {
      const poll = this.state.state.activePoll;
      if (!poll || index < 0 || index >= poll.questions.length) return;

      poll.activeQuestionIndex = index;
      const targetQ = poll.questions[index];
      const savedStatus = targetQ ? this.getQuestionStatus(targetQ.id) : 'open';

      // Keep previous question revealed state or lock state when navigating!
      poll.status = savedStatus;

      this.stopTimer(true);
      this.state.setActivePoll(poll);
      this.sync.broadcastHostState(poll);
      this.renderHostStudio();
      if (this.state.state.currentView === 'projector') {
        this.renderProjectorScreen();
      }
    }

    renderHostHeaderCounts() {
      const poll = this.state.state.activePoll;
      if (!poll) return;

      const currentQ = poll.questions[poll.activeQuestionIndex];
      const stats = currentQ ? this.poll.calculateStats(currentQ, poll.responses) : null;
      const count = stats ? stats.totalResponses : 0;

      const qStatus = currentQ ? this.getQuestionStatus(currentQ.id) : poll.status;
      const isRevealed = qStatus === 'revealed';
      const isLocked = qStatus === 'locked' || isRevealed;

      const countEl = document.getElementById('host-total-responses');
      if (countEl) {
        countEl.textContent = `${count} ${count === 1 ? 'Response' : 'Responses'}`;
      }

      const statusEl = document.getElementById('host-poll-status');
      if (statusEl) {
        statusEl.className = `status-pill ${qStatus}`;
        statusEl.textContent = qStatus.toUpperCase();
      }

      // Update toggle buttons text
      const lockBtn = document.getElementById('btn-host-lock');
      if (lockBtn) {
        lockBtn.innerHTML = isLocked ? '🔓 Unlock Voting' : '🔒 Lock Voting';
      }

      const revealBtn = document.getElementById('btn-host-reveal');
      if (revealBtn) {
        if (currentQ) {
          revealBtn.style.display = 'inline-flex';
          const isQuiz = currentQ.type === 'quiz';
          if (isRevealed) {
            revealBtn.innerHTML = isQuiz ? '✨ Answer Revealed' : '✨ Results Revealed';
          } else {
            revealBtn.innerHTML = isQuiz ? '🎯 Reveal Correct Answer' : '📊 Reveal Results';
          }
        } else {
          revealBtn.style.display = 'none';
        }
      }
    }

    renderActiveQuestionVisualizer() {
      const poll = this.state.state.activePoll;
      const stageEl = document.getElementById('host-visualizer-stage');
      const toolbar = document.querySelector('.stage-controls-toolbar');
      if (!stageEl || !poll) return;

      // Handle Empty Questions State
      if (poll.questions.length === 0) {
        const typeEl = document.getElementById('host-active-q-type');
        const titleEl = document.getElementById('host-active-q-title');
        const subEl = document.getElementById('host-active-q-subtitle');

        if (typeEl) typeEl.textContent = 'EMPTY POLL ROOM';
        if (titleEl) titleEl.textContent = 'Welcome to your Live Voting Session';
        if (subEl) subEl.textContent = 'You have not added any questions yet.';
        if (toolbar) toolbar.style.display = 'none';

        stageEl.innerHTML = `
          <div style="text-align: center; padding: 3.5rem 1.5rem; background-color: var(--bg-input); border-radius: var(--radius-lg); border: 2px dashed var(--border-subtle);">
            <div style="font-size: 3rem; margin-bottom: 1rem;">✍️</div>
            <h2 style="font-size: 1.5rem; margin-bottom: 0.5rem;">Add Your Questions</h2>
            <p style="color: var(--text-secondary); max-width: 480px; margin: 0 auto 1.75rem;">
              You can add questions one-by-one, or load a complete ready-made question set in one click!
            </p>
            <div style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
              <button id="btn-empty-add-q" class="btn btn-primary btn-lg">
                + Add Single Question
              </button>
              <button id="btn-empty-bulk-sets" class="btn btn-secondary btn-lg">
                📦 Import Complete Question Set
              </button>
            </div>
          </div>
        `;

        const emptyAddBtn = document.getElementById('btn-empty-add-q');
        if (emptyAddBtn) {
          emptyAddBtn.addEventListener('click', () => {
            this.openAddQuestionModal();
          });
        }

        const emptyBulkBtn = document.getElementById('btn-empty-bulk-sets');
        if (emptyBulkBtn) {
          emptyBulkBtn.addEventListener('click', () => {
            this.openBulkQuestionsModal();
          });
        }
        return;
      }

      if (toolbar) toolbar.style.display = 'flex';

      const currentQ = poll.questions[poll.activeQuestionIndex];
      if (!currentQ) return;

      // Render Title & Type
      const typeEl = document.getElementById('host-active-q-type');
      const titleEl = document.getElementById('host-active-q-title');
      const subEl = document.getElementById('host-active-q-subtitle');

      if (typeEl) typeEl.textContent = `Question ${poll.activeQuestionIndex + 1} of ${poll.questions.length} • ${currentQ.type.toUpperCase()}`;
      if (titleEl) titleEl.textContent = currentQ.title;
      if (subEl) subEl.textContent = currentQ.subtitle || '';

      const stats = this.poll.calculateStats(currentQ, poll.responses);
      const isRevealed = this.getQuestionStatus(currentQ.id) === 'revealed';

      stageEl.innerHTML = '';

      switch (currentQ.type) {
        case 'poll':
        case 'quiz':
        case 'binary': {
          const container = document.createElement('div');
          container.className = 'live-visualizer-container';

          stats.options.forEach((opt, idx) => {
            const letter = String.fromCharCode(65 + idx);
            const card = document.createElement('div');
            
            // Apply green for correct, red for wrong when quiz is revealed
            let statusClass = '';
            if (currentQ.type === 'quiz' && isRevealed) {
              statusClass = opt.isCorrect ? 'is-correct animate-winner' : 'is-wrong';
            }
            card.className = `choice-bar-card ${statusClass}`;

            const fillWidth = isRevealed ? opt.percentage : 0;
            const percentageHtml = isRevealed 
              ? `<span class="choice-percentage">${opt.percentage}%</span>` 
              : `<span class="choice-percentage" style="opacity: 0.35; font-size: 1.15rem;">—</span>`;
            const countHtml = isRevealed 
              ? `<span class="choice-vote-count">${opt.count} ${opt.count === 1 ? 'vote' : 'votes'}</span>` 
              : `<span class="choice-vote-count" style="opacity: 0.35;">—</span>`;

            card.innerHTML = `
              <div class="choice-bar-fill" style="width: ${fillWidth}%;"></div>
              <div class="choice-bar-content">
                <div class="choice-letter-badge">${letter}</div>
                <span>${opt.text}</span>
                ${isRevealed && currentQ.type === 'quiz' && opt.isCorrect ? '<span style="color: var(--accent-correct); font-weight: 700; margin-left: 0.5rem;">✓ Correct Answer</span>' : ''}
                ${isRevealed && currentQ.type === 'quiz' && !opt.isCorrect ? '<span style="color: var(--accent-wrong); font-weight: 600; margin-left: 0.5rem; opacity: 0.8;">✗ Incorrect</span>' : ''}
              </div>
              <div class="choice-stats-group">
                ${percentageHtml}
                ${countHtml}
              </div>
            `;
            container.appendChild(card);
          });

          // If quiz and revealed, show explanation
          if (currentQ.type === 'quiz' && isRevealed && currentQ.explanation) {
            const expBox = document.createElement('div');
            expBox.className = 'quiz-explanation-box';
            expBox.innerHTML = `
              <div class="explanation-title">💡 Official Explanation</div>
              <div>${currentQ.explanation}</div>
            `;
            container.appendChild(expBox);
          }

          stageEl.appendChild(container);
          break;
        }

        case 'rating': {
          const container = document.createElement('div');
          container.className = 'rating-visualizer';

          if (!isRevealed) {
            container.innerHTML = `
              <div class="rating-big-average" style="padding: 2rem 0;">
                <div class="rating-avg-number" style="opacity: 0.4;">★</div>
                <div style="color: var(--text-secondary); font-size: 1.1rem; margin-top: 0.5rem;">
                  ${stats.totalResponses} ${stats.totalResponses === 1 ? 'Rating' : 'Ratings'} collected
                </div>
                <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.25rem;">
                  Click "Reveal Results" to show average rating and distribution.
                </div>
              </div>
            `;
          } else {
            let starsHtml = '';
            const avgRounded = Math.round(stats.average);
            for (let i = 1; i <= stats.scaleMax; i++) {
              starsHtml += i <= avgRounded ? '★' : '☆';
            }

            container.innerHTML = `
              <div class="rating-big-average">
                <div class="rating-avg-number">${stats.averageDisplay}</div>
                <div class="rating-stars-row">${starsHtml}</div>
                <div style="color: var(--text-secondary); font-size: 0.95rem;">Average out of ${stats.scaleMax} stars (${stats.totalResponses} ratings)</div>
              </div>
              <div class="rating-histogram">
                ${stats.distribution.slice().reverse().map(d => `
                  <div class="rating-hist-row">
                    <span style="min-width: 60px; font-weight: 600;">${d.value} ★</span>
                    <div class="rating-hist-bar">
                      <div class="rating-hist-fill" style="width: ${d.percentage}%;"></div>
                    </div>
                    <span style="min-width: 40px; text-align: right; font-family: var(--font-mono); font-size: 0.85rem;">${d.percentage}%</span>
                    <span style="min-width: 50px; text-align: right; color: var(--text-muted); font-size: 0.8rem;">(${d.count})</span>
                  </div>
                `).join('')}
              </div>
            `;
          }
          stageEl.appendChild(container);
          break;
        }

        case 'wordcloud': {
          const container = document.createElement('div');
          container.className = 'wordcloud-container';

          if (!isRevealed) {
            container.innerHTML = `
              <div style="text-align: center; padding: 2rem 0;">
                <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">💬</div>
                <div style="font-size: 1.15rem; font-weight: 600; color: var(--text-primary);">
                  ${stats.totalResponses} ${stats.totalResponses === 1 ? 'Word' : 'Words'} submitted
                </div>
                <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 0.25rem;">
                  Click "Reveal Results" to build and display the live Word Cloud.
                </div>
              </div>
            `;
          } else if (stats.words.length === 0) {
            container.innerHTML = '<div style="color: var(--text-muted); font-style: italic;">No words submitted yet. Waiting for audience responses...</div>';
          } else {
            stats.words.forEach(w => {
              const tag = document.createElement('span');
              tag.className = 'wordcloud-tag';
              const ratio = w.count / stats.maxCount;
              const fontSize = (1.1 + ratio * 1.7).toFixed(2);
              tag.style.fontSize = `${fontSize}rem`;
              tag.style.color = w.color;
              tag.innerHTML = `${w.word} <span style="font-size: 0.7em; opacity: 0.7; font-family: var(--font-mono); font-weight: 400;">(${w.count})</span>`;
              container.appendChild(tag);
            });
          }
          stageEl.appendChild(container);
          break;
        }
      }
    }

    /* --------------------------------------------------------------------------
       CUSTOMIZABLE TIMER SYSTEM & PROJECTOR FULLSCREEN CONTROLLER
       -------------------------------------------------------------------------- */
    startTimer(seconds) {
      this.stopTimer(false);

      const poll = this.state.state.activePoll;
      // If poll was previously locked, open it for the timed round
      if (poll && poll.status === 'locked') {
        poll.status = 'open';
        this.state.setActivePoll(poll);
        this.sync.broadcastHostState(poll);
        this.renderHostHeaderCounts();
      }

      this.state.state.timer.total = seconds;
      this.state.state.timer.remaining = seconds;
      this.state.state.timer.isRunning = true;

      this.sync.broadcast('timer_start', { total: seconds, remaining: seconds });
      this.updateTimerUI();

      this.currentQuestionTimer = setInterval(() => {
        this.state.state.timer.remaining--;
        const rem = this.state.state.timer.remaining;

        this.sync.broadcast('timer_tick', { remaining: rem, total: this.state.state.timer.total });
        this.updateTimerUI();

        if (rem <= 5 && rem > 0) {
          if (this.audio) this.audio.playTick();
        }

        // Automatic lock when timer completes
        if (rem <= 0) {
          this.stopTimer(true);

          const activePoll = this.state.state.activePoll;
          if (activePoll && activePoll.status === 'open') {
            activePoll.status = 'locked'; // Automatically lock voting
            this.state.setActivePoll(activePoll);
            this.sync.broadcastHostState(activePoll);
            this.renderHostHeaderCounts();
            if (this.audio) this.audio.playReveal();
            this.showToast('⏱ Time is up! Voting locked automatically.');
            if (this.state.state.currentView === 'projector') {
              this.renderProjectorScreen();
            } else if (this.state.state.currentView === 'voter') {
              this.renderVoterScreen();
            }
          }
        }
      }, 1000);
    }

    stopTimer(shouldBroadcast = true) {
      if (this.currentQuestionTimer) {
        clearInterval(this.currentQuestionTimer);
        this.currentQuestionTimer = null;
      }
      this.state.state.timer.isRunning = false;

      if (shouldBroadcast) {
        this.sync.broadcast('timer_stop', {});
      }

      this.updateTimerUI();
      if (this.state.state.currentView === 'projector') {
        this.renderProjectorScreen();
      }
    }

    updateTimerUI() {
      const isRunning = this.state.state.timer.isRunning;
      const rem = this.state.state.timer.remaining;
      const total = this.state.state.timer.total || 30;

      // 1. Host timer button & badge
      const hostTimerBtn = document.getElementById('btn-host-timer');
      if (hostTimerBtn) {
        hostTimerBtn.textContent = isRunning ? '⏹ Stop Timer' : '▶ Start Timer';
        if (isRunning) {
          hostTimerBtn.classList.remove('btn-primary');
          hostTimerBtn.classList.add('btn-danger');
        } else {
          hostTimerBtn.classList.remove('btn-danger');
          hostTimerBtn.classList.add('btn-primary');
        }
      }

      const hostTimerBadge = document.getElementById('host-timer-badge');
      if (hostTimerBadge) {
        hostTimerBadge.style.display = isRunning ? 'inline-flex' : 'none';
        hostTimerBadge.textContent = `⏱ ${rem}s`;
      }

      // 2. Projector timer button
      const projTimerBtn = document.getElementById('btn-projector-timer');
      if (projTimerBtn) {
        projTimerBtn.textContent = isRunning ? '⏹ Stop' : '▶ Timer';
        if (isRunning) {
          projTimerBtn.classList.remove('btn-primary');
          projTimerBtn.classList.add('btn-danger');
        } else {
          projTimerBtn.classList.remove('btn-danger');
          projTimerBtn.classList.add('btn-primary');
        }
      }

      // 3. Projector Mode ONLY: Fullscreen countdown timer overlay & hide options
      const overlay = document.getElementById('projector-fullscreen-timer-overlay');
      const mainStage = document.getElementById('projector-main-stage-grid');
      const bigNum = document.getElementById('projector-timer-big-num');
      const ringStroke = document.getElementById('projector-timer-ring-stroke');
      const titleEl = document.getElementById('projector-timer-q-title');

      if (this.state.state.currentView === 'projector') {
        if (isRunning && rem > 0) {
          // Hide options & QR card, show full-screen dramatic timer
          if (overlay) overlay.style.display = 'flex';
          if (mainStage) mainStage.style.display = 'none';

          const poll = this.state.state.activePoll;
          const currentQ = poll && poll.questions && poll.questions[poll.activeQuestionIndex];
          if (titleEl && currentQ) {
            titleEl.textContent = currentQ.title;
          }

          if (bigNum) {
            bigNum.textContent = rem;
            if (rem <= 5) {
              bigNum.style.color = '#ef4444';
              bigNum.style.textShadow = '0 0 35px rgba(239, 68, 68, 0.7)';
            } else {
              bigNum.style.color = '#ffffff';
              bigNum.style.textShadow = '0 0 35px rgba(59, 130, 246, 0.5)';
            }
          }

          if (ringStroke) {
            const circumference = 628.318; // 2 * PI * 100
            const progress = Math.max(0, Math.min(1, rem / total));
            const offset = circumference * (1 - progress);
            ringStroke.style.strokeDashoffset = offset;
            if (rem <= 5) {
              ringStroke.classList.add('warning');
            } else {
              ringStroke.classList.remove('warning');
            }
          }
        } else {
          // Time is over / stopped: restore options and results on projector
          if (overlay) overlay.style.display = 'none';
          if (mainStage) mainStage.style.display = 'grid';
        }
      }

      // 4. Voter Screen Small Live Countdown Timer
      const voterTimerPill = document.getElementById('voter-timer-pill');
      const voterTimerNum = document.getElementById('voter-timer-num');

      if (voterTimerPill) {
        if (isRunning && rem > 0) {
          voterTimerPill.style.display = 'inline-flex';
          if (voterTimerNum) voterTimerNum.textContent = rem;
          if (rem <= 5) {
            voterTimerPill.classList.add('warning');
          } else {
            voterTimerPill.classList.remove('warning');
          }
        } else {
          voterTimerPill.style.display = 'none';
        }
      }
    }

    /* --------------------------------------------------------------------------
       PARTICIPANT / VOTER SCREEN
       -------------------------------------------------------------------------- */
    renderVoterScreen() {
      const poll = this.state.state.activePoll;
      const container = document.getElementById('voter-content-card');
      if (!container) return;

      if (!poll || !poll.questions || poll.questions.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 2.5rem 1rem;">
            <div style="font-size: 2.5rem; margin-bottom: 1rem;">⏳</div>
            <h2>Connected to Session!</h2>
            <p style="color: var(--text-secondary); margin-top: 0.5rem;">Waiting for the host to add or start the first question...</p>
          </div>
        `;
        return;
      }

      const currentQ = poll.questions[poll.activeQuestionIndex];
      const participantId = this.state.state.participant.id;
      const existingVote = poll.responses && poll.responses[currentQ.id] && poll.responses[currentQ.id][participantId];
      const qStatus = this.getQuestionStatus(currentQ.id);
      const isRevealed = qStatus === 'revealed';
      const isLocked = qStatus === 'locked' || isRevealed;

      // Header room PIN display
      const roomPinEl = document.getElementById('voter-room-pin');
      if (roomPinEl) roomPinEl.textContent = poll.roomCode;

      const qIndexEl = document.getElementById('voter-q-index');
      if (qIndexEl) qIndexEl.textContent = `Question ${poll.activeQuestionIndex + 1} of ${poll.questions.length}`;

      container.innerHTML = `
        <div style="margin-bottom: 1.5rem;">
          <div style="font-size: 0.8rem; text-transform: uppercase; font-weight: 700; color: var(--brand-primary); margin-bottom: 0.3rem;">
            ${currentQ.type.toUpperCase()}
          </div>
          <h2 style="font-size: 1.5rem; line-height: 1.3;">${currentQ.title}</h2>
          ${currentQ.subtitle ? `<p style="color: var(--text-secondary); font-size: 0.95rem; margin-top: 0.3rem;">${currentQ.subtitle}</p>` : ''}
        </div>
      `;

      // If already voted & NOT revealed yet -> show waiting checkmark
      if (existingVote && !isRevealed) {
        const confBox = document.createElement('div');
        confBox.className = 'voted-confirmation-box';
        confBox.innerHTML = `
          <div class="confirmation-check-icon">✓</div>
          <h3 style="font-size: 1.3rem;">Vote Recorded!</h3>
          <p style="color: var(--text-secondary);">Waiting for the presenter to reveal results or advance to the next question...</p>
        `;
        container.appendChild(confBox);
        return;
      }

      // If poll is locked and participant hasn't voted yet
      if (isLocked && !existingVote && !isRevealed) {
        const lockBanner = document.createElement('div');
        lockBanner.style.backgroundColor = 'var(--accent-wrong-bg)';
        lockBanner.style.border = '1px solid var(--accent-wrong-border)';
        lockBanner.style.color = 'var(--accent-wrong)';
        lockBanner.style.padding = '0.9rem 1.25rem';
        lockBanner.style.borderRadius = 'var(--radius-md)';
        lockBanner.style.marginBottom = '1.25rem';
        lockBanner.style.fontWeight = '700';
        lockBanner.style.textAlign = 'center';
        lockBanner.innerHTML = `🔒 Voting has ended / closed for this question.`;
        container.appendChild(lockBanner);
      }

      // If revealed on a Quiz question -> show results feedback banner at top
      if (isRevealed && currentQ.type === 'quiz') {
        const correctOpt = (currentQ.options || []).find(o => o.isCorrect);
        const userPickedCorrect = existingVote && correctOpt && (existingVote.selection === correctOpt.id);

        const banner = document.createElement('div');
        if (userPickedCorrect) {
          banner.style.backgroundColor = 'var(--accent-correct-bg)';
          banner.style.border = '2px solid var(--accent-correct-border)';
          banner.style.color = 'var(--accent-correct)';
          banner.style.padding = '1rem 1.25rem';
          banner.style.borderRadius = 'var(--radius-md)';
          banner.style.marginBottom = '1.25rem';
          banner.style.fontWeight = '700';
          banner.style.textAlign = 'center';
          banner.innerHTML = `🎉 Outstanding! You chose the correct answer (+1000 pts)!`;
        } else if (existingVote) {
          banner.style.backgroundColor = 'var(--accent-wrong-bg)';
          banner.style.border = '2px solid var(--accent-wrong-border)';
          banner.style.color = 'var(--accent-wrong)';
          banner.style.padding = '1rem 1.25rem';
          banner.style.borderRadius = 'var(--radius-md)';
          banner.style.marginBottom = '1.25rem';
          banner.style.fontWeight = '700';
          banner.style.textAlign = 'center';
          banner.innerHTML = `❌ Incorrect. The correct answer was ${correctOpt ? correctOpt.text : 'highlighted below'}.`;
        }
        container.appendChild(banner);
      }

      // Render interactive voting controls
      const formWrapper = document.createElement('div');

      switch (currentQ.type) {
        case 'poll':
        case 'quiz':
        case 'binary': {
          let selectedOptId = existingVote ? existingVote.selection : null;

          currentQ.options.forEach((opt, idx) => {
            const letter = String.fromCharCode(65 + idx);
            const optCard = document.createElement('div');
            let isCorrectChoice = isRevealed && opt.isCorrect;
            let isUserSelection = selectedOptId === opt.id;

            let cardClass = 'voter-option-card';
            if (isUserSelection && !isRevealed) {
              cardClass += ' selected';
            }
            if (isRevealed && currentQ.type === 'quiz') {
              if (opt.isCorrect) {
                cardClass += ' is-correct animate-winner';
              } else {
                cardClass += ' is-wrong';
              }
            }

            optCard.className = cardClass;
            optCard.innerHTML = `
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <div class="choice-letter-badge">${letter}</div>
                <span>${opt.text}</span>
              </div>
              <div>
                ${isRevealed && currentQ.type === 'quiz' && opt.isCorrect ? '<span style="color: var(--accent-correct); font-weight: 700;">✓ Correct Answer</span>' : ''}
                ${isRevealed && currentQ.type === 'quiz' && isUserSelection && !opt.isCorrect ? '<span style="color: var(--accent-wrong); font-weight: 700;">✗ Your Pick (Wrong)</span>' : ''}
                ${isRevealed && currentQ.type === 'quiz' && !isUserSelection && !opt.isCorrect ? '<span style="color: var(--accent-wrong); font-weight: 600; opacity: 0.7;">✗ Incorrect</span>' : ''}
              </div>
            `;

            if (!isLocked) {
              optCard.addEventListener('click', () => {
                formWrapper.querySelectorAll('.voter-option-card').forEach(c => c.classList.remove('selected'));
                optCard.classList.add('selected');
                selectedOptId = opt.id;
              });
            }

            formWrapper.appendChild(optCard);
          });

          if (!isLocked) {
            const submitBtn = document.createElement('button');
            submitBtn.className = 'btn btn-primary voter-submit-btn';
            submitBtn.textContent = 'Submit Vote';
            submitBtn.addEventListener('click', () => {
              if (!selectedOptId) {
                this.showToast('Please select an option before submitting.');
                return;
              }
              this.submitVoterResponse(currentQ.id, selectedOptId);
            });
            formWrapper.appendChild(submitBtn);
          }

          break;
        }

        case 'rating': {
          let selectedRating = existingVote ? existingVote.selection : null;
          const starsWrapper = document.createElement('div');
          starsWrapper.style.display = 'flex';
          starsWrapper.style.justifyContent = 'center';
          starsWrapper.style.gap = '0.75rem';
          starsWrapper.style.margin = '2rem 0';

          for (let i = currentQ.scaleMin || 1; i <= (currentQ.scaleMax || 5); i++) {
            const starBtn = document.createElement('button');
            starBtn.className = 'btn btn-secondary';
            starBtn.style.fontSize = '1.75rem';
            starBtn.style.padding = '0.75rem 1rem';
            starBtn.innerHTML = `★<div style="font-size: 0.8rem; font-weight: 700;">${i}</div>`;

            if (selectedRating === i) {
              starBtn.classList.remove('btn-secondary');
              starBtn.classList.add('btn-primary');
            }

            if (!isLocked) {
              starBtn.addEventListener('click', () => {
                starsWrapper.querySelectorAll('button').forEach(b => {
                  b.classList.remove('btn-primary');
                  b.classList.add('btn-secondary');
                });
                starBtn.classList.remove('btn-secondary');
                starBtn.classList.add('btn-primary');
                selectedRating = i;
              });
            }

            starsWrapper.appendChild(starBtn);
          }

          formWrapper.appendChild(starsWrapper);

          if (!isLocked) {
            const submitBtn = document.createElement('button');
            submitBtn.className = 'btn btn-primary voter-submit-btn';
            submitBtn.textContent = 'Submit Rating';
            submitBtn.addEventListener('click', () => {
              if (!selectedRating) {
                this.showToast('Please select a star rating first.');
                return;
              }
              this.submitVoterResponse(currentQ.id, selectedRating);
            });
            formWrapper.appendChild(submitBtn);
          }
          break;
        }

        case 'wordcloud': {
          const inputWrapper = document.createElement('div');
          inputWrapper.style.margin = '1.5rem 0';
          inputWrapper.innerHTML = `
            <input type="text" id="voter-word-input" class="input-text" placeholder="${currentQ.placeholder || 'Type your word or phrase...'}" maxlength="40" ${isLocked ? 'disabled' : ''} />
          `;
          formWrapper.appendChild(inputWrapper);

          if (!isLocked) {
            const submitBtn = document.createElement('button');
            submitBtn.className = 'btn btn-primary voter-submit-btn';
            submitBtn.textContent = 'Send Word';
            submitBtn.addEventListener('click', () => {
              const input = document.getElementById('voter-word-input');
              const val = (input ? input.value : '').trim();
              if (!val) {
                this.showToast('Please enter a word or phrase.');
                return;
              }
              this.submitVoterResponse(currentQ.id, val);
            });
            formWrapper.appendChild(submitBtn);
          }
          break;
        }
      }

      // If revealed, show explanation if available
      if (isRevealed && currentQ.explanation) {
        const exp = document.createElement('div');
        exp.className = 'quiz-explanation-box';
        exp.innerHTML = `<strong>💡 Explanation:</strong> ${currentQ.explanation}`;
        formWrapper.appendChild(exp);
      }

      container.appendChild(formWrapper);
      this.updateTimerUI();
    }

    submitVoterResponse(questionId, selection) {
      const poll = this.state.state.activePoll;
      if (!poll) return;

      if (poll.status === 'locked' || poll.status === 'revealed') {
        this.showToast('Voting is closed for this question.');
        return;
      }

      const participant = this.state.state.participant;
      const voteData = {
        questionId: questionId,
        participantId: participant.id,
        participantName: participant.name,
        selection: selection,
        timeRemaining: this.state.state.timer.remaining,
        timestamp: Date.now()
      };

      // Play local tactile sound
      if (this.audio) this.audio.playVote();

      // Record locally
      this.state.recordLocalVote(questionId, selection);

      // Send to SyncEngine
      this.sync.sendVote(voteData);

      // Re-render voter confirmation screen
      this.renderVoterScreen();
      this.showToast('Vote submitted successfully!');
    }

    /* --------------------------------------------------------------------------
       PROJECTOR / PRESENTATION VIEW
       -------------------------------------------------------------------------- */
    renderProjectorScreen() {
      const poll = this.state.state.activePoll;
      if (!poll) return;

      // Update room code & join link
      const joinPinEl = document.getElementById('projector-room-pin');
      if (joinPinEl) joinPinEl.textContent = poll.roomCode;

      const joinUrl = this.getJoinUrl(poll.roomCode);
      const urlTextEl = document.getElementById('projector-join-url');
      if (urlTextEl) urlTextEl.textContent = window.location.host || 'livevote.app';

      // Render Large QR Code on Projector Screen
      const qrContainer = document.getElementById('projector-qr-container');
      if (qrContainer && this.qr) {
        qrContainer.innerHTML = this.qr.generateSVG(joinUrl, { size: 240 });
      }

      const miniQr = document.getElementById('projector-mini-qr');
      if (miniQr && this.qr) {
        miniQr.innerHTML = this.qr.generateSVG(joinUrl, { size: 64 });
      }

      // Update Navigation Counter & Buttons
      const counterEl = document.getElementById('projector-q-counter');
      const prevBtn = document.getElementById('btn-projector-prev-q');
      const nextBtn = document.getElementById('btn-projector-next-q');
      const revealBtn = document.getElementById('btn-projector-reveal');

      const totalQ = poll.questions ? poll.questions.length : 0;
      const activeIdx = poll.activeQuestionIndex || 0;

      if (counterEl) {
        counterEl.textContent = totalQ > 0 ? `Question ${activeIdx + 1} of ${totalQ}` : 'No Questions';
      }

      if (prevBtn) {
        prevBtn.disabled = activeIdx <= 0;
        prevBtn.style.opacity = activeIdx <= 0 ? '0.5' : '1';
      }

      if (nextBtn) {
        nextBtn.disabled = activeIdx >= totalQ - 1;
        nextBtn.style.opacity = activeIdx >= totalQ - 1 ? '0.5' : '1';
      }

      const currentQ = poll.questions && poll.questions[activeIdx];
      const qStatus = currentQ ? this.getQuestionStatus(currentQ.id) : poll.status;
      const isRevealed = qStatus === 'revealed';

      if (revealBtn) {
        if (currentQ) {
          revealBtn.style.display = 'inline-flex';
          const isQuiz = currentQ.type === 'quiz';
          if (isRevealed) {
            revealBtn.textContent = isQuiz ? '✨ Answer Revealed' : '✨ Results Revealed';
          } else {
            revealBtn.textContent = isQuiz ? '🎯 Reveal Answer' : '📊 Reveal Results';
          }
        } else {
          revealBtn.style.display = 'none';
        }
      }

      // Render Active Question
      const titleEl = document.getElementById('projector-q-title');
      const stageEl = document.getElementById('projector-visualizer-stage');

      if (!currentQ) {
        if (titleEl) titleEl.textContent = 'Waiting for Host to Add Questions';
        if (stageEl) stageEl.innerHTML = '<div style="color: var(--text-muted); font-size: 1.25rem; padding: 2rem 0;">Scan QR code above to be ready when voting starts.</div>';
        return;
      }

      if (titleEl) {
        titleEl.textContent = currentQ.title;
      }

      if (stageEl) {
        const stats = this.poll.calculateStats(currentQ, poll.responses);
        stageEl.innerHTML = '';

        if (currentQ.type === 'poll' || currentQ.type === 'quiz' || currentQ.type === 'binary') {
          const container = document.createElement('div');
          container.className = 'live-visualizer-container';

          stats.options.forEach((opt, idx) => {
            const letter = String.fromCharCode(65 + idx);
            const card = document.createElement('div');
            
            let statusClass = '';
            if (currentQ.type === 'quiz' && isRevealed) {
              statusClass = opt.isCorrect ? 'is-correct animate-winner' : 'is-wrong';
            }
            card.className = `choice-bar-card ${statusClass}`;
            card.style.padding = '1.4rem 1.75rem';

            const fillWidth = isRevealed ? opt.percentage : 0;
            const percentageHtml = isRevealed 
              ? `<span class="choice-percentage" style="font-size: 1.6rem;">${opt.percentage}%</span>` 
              : `<span class="choice-percentage" style="font-size: 1.4rem; opacity: 0.35;">—</span>`;
            const countHtml = isRevealed 
              ? `<span class="choice-vote-count" style="font-size: 1rem;">${opt.count} votes</span>` 
              : `<span class="choice-vote-count" style="font-size: 0.95rem; opacity: 0.35;">—</span>`;

            card.innerHTML = `
              <div class="choice-bar-fill" style="width: ${fillWidth}%;"></div>
              <div class="choice-bar-content">
                <div class="choice-letter-badge" style="width: 34px; height: 34px; font-size: 1.1rem;">${letter}</div>
                <span style="font-size: 1.3rem;">${opt.text}</span>
                ${isRevealed && currentQ.type === 'quiz' && opt.isCorrect ? '<span style="color: var(--accent-correct); font-weight: 700; margin-left: 0.75rem;">✓ Correct Answer</span>' : ''}
                ${isRevealed && currentQ.type === 'quiz' && !opt.isCorrect ? '<span style="color: var(--accent-wrong); font-weight: 600; margin-left: 0.75rem; opacity: 0.8;">✗ Incorrect</span>' : ''}
              </div>
              <div class="choice-stats-group">
                ${percentageHtml}
                ${countHtml}
              </div>
            `;
            container.appendChild(card);
          });

          stageEl.appendChild(container);
        } else if (currentQ.type === 'rating') {
          const ratingDiv = document.createElement('div');
          ratingDiv.className = 'rating-visualizer';
          if (!isRevealed) {
            ratingDiv.innerHTML = `
              <div class="rating-big-average" style="padding: 3rem 0;">
                <div class="rating-avg-number" style="font-size: 6rem; opacity: 0.35;">★</div>
                <div style="font-size: 1.5rem; color: var(--text-secondary); margin-top: 0.5rem;">
                  ${stats.totalResponses} ${stats.totalResponses === 1 ? 'Response' : 'Responses'} collected
                </div>
                <div style="font-size: 1rem; color: var(--text-muted); margin-top: 0.5rem;">
                  Waiting for presenter to reveal rating results.
                </div>
              </div>
            `;
          } else {
            ratingDiv.innerHTML = `
              <div class="rating-big-average">
                <div class="rating-avg-number" style="font-size: 6rem;">${stats.averageDisplay}</div>
                <div style="font-size: 1.5rem; color: var(--text-secondary); margin-top: 0.5rem;">Average Rating (${stats.totalResponses} responses)</div>
              </div>
            `;
          }
          stageEl.appendChild(ratingDiv);
        } else if (currentQ.type === 'wordcloud') {
          const cloudDiv = document.createElement('div');
          cloudDiv.className = 'wordcloud-container';
          cloudDiv.style.minHeight = '360px';

          if (!isRevealed) {
            cloudDiv.innerHTML = `
              <div style="text-align: center; padding: 3rem 0;">
                <div style="font-size: 3.5rem; margin-bottom: 0.75rem;">💬</div>
                <div style="font-size: 1.5rem; font-weight: 600; color: var(--text-primary);">
                  ${stats.totalResponses} ${stats.totalResponses === 1 ? 'Word' : 'Words'} submitted
                </div>
                <div style="font-size: 1.1rem; color: var(--text-muted); margin-top: 0.5rem;">
                  Waiting for presenter to reveal Word Cloud.
                </div>
              </div>
            `;
          } else {
            stats.words.forEach(w => {
              const tag = document.createElement('span');
              tag.className = 'wordcloud-tag';
              const ratio = w.count / stats.maxCount;
              tag.style.fontSize = `${(1.4 + ratio * 2.4).toFixed(2)}rem`;
              tag.style.color = w.color;
              tag.innerHTML = `${w.word} <span style="font-size: 0.6em; opacity: 0.7;">(${w.count})</span>`;
              cloudDiv.appendChild(tag);
            });
          }
          stageEl.appendChild(cloudDiv);
        }
      }

      // Total responses pill
      const countEl = document.getElementById('projector-response-count');
      if (countEl && currentQ) {
        const stats = this.poll.calculateStats(currentQ, poll.responses);
        countEl.textContent = `${stats.totalResponses} ${stats.totalResponses === 1 ? 'Vote' : 'Votes'}`;
      }

      // Ensure timer overlay state is updated
      this.updateTimerUI();
    }

    getJoinUrl(roomCode) {
      const base = window.location.origin + window.location.pathname;
      return `${base}?join=${encodeURIComponent(roomCode)}`;
    }

    /* --------------------------------------------------------------------------
       MODAL 4-OPTIONS BUILDER & MULTI-QUESTION WORKFLOW
       -------------------------------------------------------------------------- */
    openAddQuestionModal() {
      const modal = document.getElementById('add-question-modal');
      if (!modal) return;

      // Reset options builder to 4 default options
      this.modalOptions = [
        { text: '', isCorrect: true },
        { text: '', isCorrect: false },
        { text: '', isCorrect: false },
        { text: '', isCorrect: false }
      ];

      const titleInput = document.getElementById('input-new-q-title');
      const expInput = document.getElementById('input-new-q-explanation');
      if (titleInput) titleInput.value = '';
      if (expInput) expInput.value = '';

      const poll = this.state.state.activePoll;
      const currentCount = poll && poll.questions ? poll.questions.length : 0;
      const counterBadge = document.getElementById('modal-q-counter-badge');
      if (counterBadge) {
        counterBadge.textContent = `Question #${currentCount + 1}${currentCount > 0 ? ` (${currentCount} saved)` : ''}`;
      }

      this.renderModalOptionRows();
      modal.classList.add('active');

      if (titleInput) {
        setTimeout(() => titleInput.focus(), 150);
      }
    }

    saveCurrentQuestionFromModal(andClose = false) {
      const titleInput = document.getElementById('input-new-q-title');
      const typeSelect = document.getElementById('select-new-q-type');
      const expInput = document.getElementById('input-new-q-explanation');

      const title = (titleInput ? titleInput.value : '').trim();

      // If user clicked "Submit & Finish" without typing a title, close safely
      if (!title) {
        if (andClose) {
          this.closeModal('add-question-modal');
          return;
        } else {
          this.showToast('Please enter a question title before adding the next one.');
          if (titleInput) titleInput.focus();
          return;
        }
      }

      const type = typeSelect ? typeSelect.value : 'quiz';

      let options = [];
      if (type === 'binary') {
        options = [
          { id: `opt_${Date.now()}_1`, text: 'Yes 👍', isCorrect: false },
          { id: `opt_${Date.now()}_2`, text: 'No 👎', isCorrect: false }
        ];
      } else if (type === 'rating' || type === 'wordcloud') {
        options = [];
      } else {
        // Read options from modalOptions builder
        let hasCorrect = false;
        options = this.modalOptions.map((opt, idx) => {
          const letter = String.fromCharCode(65 + idx);
          const customText = (opt.text || '').trim();
          const finalText = customText || `Option ${letter}`;
          const isCorr = type === 'quiz' ? !!opt.isCorrect : false;
          if (isCorr) hasCorrect = true;

          return {
            id: `opt_${Date.now()}_${idx}`,
            text: finalText,
            isCorrect: isCorr
          };
        });

        // Ensure for quiz that at least one option is marked correct (default to first)
        if (type === 'quiz' && !hasCorrect && options.length > 0) {
          options[0].isCorrect = true;
        }
      }

      const newQ = {
        id: `q_${Date.now()}`,
        type: type,
        title: title,
        subtitle: '',
        options: options,
        explanation: expInput ? expInput.value.trim() : '',
        timerSeconds: 0
      };

      const poll = this.state.state.activePoll;
      if (poll) {
        poll.questions.push(newQ);

        // Start from first question (index 0) by default
        if (poll.questions.length === 1) {
          poll.activeQuestionIndex = 0;
        }

        this.state.setActivePoll(poll);
        this.sync.broadcastHostState(poll);
        this.renderHostStudio();

        if (andClose) {
          this.closeModal('add-question-modal');
          this.showToast(`Saved Question #${poll.questions.length}!`);
        } else {
          // Reset inputs for NEXT question, keeping modal open
          if (titleInput) {
            titleInput.value = '';
            titleInput.focus();
          }
          if (expInput) expInput.value = '';
          this.modalOptions = [
            { text: '', isCorrect: true },
            { text: '', isCorrect: false },
            { text: '', isCorrect: false },
            { text: '', isCorrect: false }
          ];
          this.renderModalOptionRows();

          const counterBadge = document.getElementById('modal-q-counter-badge');
          if (counterBadge) {
            counterBadge.textContent = `Question #${poll.questions.length + 1} (${poll.questions.length} saved)`;
          }

          this.showToast(`Question #${poll.questions.length} saved! Ready for next question.`);
        }
      }
    }

    renderModalOptionRows() {
      const container = document.getElementById('options-builder-container');
      const typeSelect = document.getElementById('select-new-q-type');
      const optionsWrapper = document.getElementById('wrapper-new-q-options');
      const correctHint = document.getElementById('label-correct-hint');
      if (!container || !typeSelect) return;

      const qType = typeSelect.value;

      if (qType === 'rating' || qType === 'wordcloud' || qType === 'binary') {
        if (optionsWrapper) optionsWrapper.style.display = 'none';
        return;
      }

      if (optionsWrapper) optionsWrapper.style.display = 'block';
      if (correctHint) {
        correctHint.style.display = qType === 'quiz' ? 'inline' : 'none';
      }

      container.innerHTML = '';

      this.modalOptions.forEach((opt, idx) => {
        const letter = String.fromCharCode(65 + idx);
        const row = document.createElement('div');
        row.className = `option-builder-row ${opt.isCorrect && qType === 'quiz' ? 'is-correct-selected' : ''}`;

        let correctRadioHtml = '';
        if (qType === 'quiz') {
          correctRadioHtml = `
            <label class="correct-radio-label">
              <input type="radio" name="opt_correct_radio" value="${idx}" ${opt.isCorrect ? 'checked' : ''} style="cursor: pointer; accent-color: var(--accent-correct);" />
              <span>Correct Answer</span>
            </label>
          `;
        }

        let removeBtnHtml = '';
        if (this.modalOptions.length > 2) {
          removeBtnHtml = `<button type="button" class="btn-remove-option" title="Remove Option" data-index="${idx}">✕</button>`;
        }

        row.innerHTML = `
          <div class="option-builder-letter">${letter}</div>
          <input type="text" class="input-text option-row-input" data-index="${idx}" placeholder="Option ${letter}" value="${opt.text}" style="flex: 1; padding: 0.5rem 0.75rem;" />
          ${correctRadioHtml}
          ${removeBtnHtml}
        `;

        // Radio change listener
        const radio = row.querySelector('input[type="radio"]');
        if (radio) {
          radio.addEventListener('change', () => {
            this.modalOptions.forEach((o, i) => { o.isCorrect = (i === idx); });
            this.renderModalOptionRows();
          });
        }

        // Input text change listener
        const textInput = row.querySelector('.option-row-input');
        if (textInput) {
          textInput.addEventListener('input', (e) => {
            this.modalOptions[idx].text = e.target.value;
          });
        }

        // Remove button listener
        const removeBtn = row.querySelector('.btn-remove-option');
        if (removeBtn) {
          removeBtn.addEventListener('click', () => {
            if (this.modalOptions.length > 2) {
              const wasCorrect = this.modalOptions[idx].isCorrect;
              this.modalOptions.splice(idx, 1);
              if (wasCorrect && this.modalOptions.length > 0) {
                this.modalOptions[0].isCorrect = true;
              }
              this.renderModalOptionRows();
            }
          });
        }

        container.appendChild(row);
      });
    }

    /* --------------------------------------------------------------------------
       QUESTION SETS & BULK IMPORT ENGINE
       -------------------------------------------------------------------------- */
    openBulkQuestionsModal() {
      const modal = document.getElementById('bulk-questions-modal');
      if (!modal) return;
      modal.classList.add('active');
    }

    loadPresetQuestionSet(presetKey) {
      const presets = {
        trivia: [
          {
            id: `q_${Date.now()}_1`,
            type: 'quiz',
            title: 'What is the capital city of Australia?',
            options: [
              { id: 'opt_1_1', text: 'Sydney', isCorrect: false },
              { id: 'opt_1_2', text: 'Melbourne', isCorrect: false },
              { id: 'opt_1_3', text: 'Canberra', isCorrect: true },
              { id: 'opt_1_4', text: 'Brisbane', isCorrect: false }
            ],
            explanation: 'Canberra is the federal capital of Australia.',
            timerSeconds: 0
          },
          {
            id: `q_${Date.now()}_2`,
            type: 'quiz',
            title: 'Which planet has the most moons in our Solar System?',
            options: [
              { id: 'opt_2_1', text: 'Mars', isCorrect: false },
              { id: 'opt_2_2', text: 'Saturn', isCorrect: true },
              { id: 'opt_2_3', text: 'Jupiter', isCorrect: false },
              { id: 'opt_2_4', text: 'Neptune', isCorrect: false }
            ],
            explanation: 'Saturn has over 140 confirmed natural satellites (moons).',
            timerSeconds: 0
          },
          {
            id: `q_${Date.now()}_3`,
            type: 'quiz',
            title: 'What is the chemical symbol for Gold?',
            options: [
              { id: 'opt_3_1', text: 'Au', isCorrect: true },
              { id: 'opt_3_2', text: 'Ag', isCorrect: false },
              { id: 'opt_3_3', text: 'Fe', isCorrect: false },
              { id: 'opt_3_4', text: 'Gd', isCorrect: false }
            ],
            explanation: 'Au comes from the Latin word "Aurum".',
            timerSeconds: 0
          },
          {
            id: `q_${Date.now()}_4`,
            type: 'quiz',
            title: 'How many hearts does an octopus have?',
            options: [
              { id: 'opt_4_1', text: '1', isCorrect: false },
              { id: 'opt_4_2', text: '2', isCorrect: false },
              { id: 'opt_4_3', text: '3', isCorrect: true },
              { id: 'opt_4_4', text: '4', isCorrect: false }
            ],
            explanation: 'An octopus has 3 hearts: two pump blood to the gills, one to the body.',
            timerSeconds: 0
          },
          {
            id: `q_${Date.now()}_5`,
            type: 'quiz',
            title: 'Which ocean is the deepest in the world?',
            options: [
              { id: 'opt_5_1', text: 'Atlantic Ocean', isCorrect: false },
              { id: 'opt_5_2', text: 'Indian Ocean', isCorrect: false },
              { id: 'opt_5_3', text: 'Pacific Ocean', isCorrect: true },
              { id: 'opt_5_4', text: 'Arctic Ocean', isCorrect: false }
            ],
            explanation: 'The Pacific Ocean contains the Mariana Trench (Challenger Deep).',
            timerSeconds: 0
          }
        ],

        tech: [
          {
            id: `q_${Date.now()}_1`,
            type: 'quiz',
            title: 'In CSS, which display value creates a flexible 2-dimensional grid system?',
            options: [
              { id: 'opt_1_1', text: 'display: flex', isCorrect: false },
              { id: 'opt_1_2', text: 'display: grid', isCorrect: true },
              { id: 'opt_1_3', text: 'display: table', isCorrect: false },
              { id: 'opt_1_4', text: 'display: inline-block', isCorrect: false }
            ],
            explanation: 'CSS Grid is designed for 2D layouts (rows and columns simultaneously).',
            timerSeconds: 0
          },
          {
            id: `q_${Date.now()}_2`,
            type: 'quiz',
            title: 'Which HTTP status code signifies "Created" upon a successful POST request?',
            options: [
              { id: 'opt_2_1', text: '200 OK', isCorrect: false },
              { id: 'opt_2_2', text: '201 Created', isCorrect: true },
              { id: 'opt_2_3', text: '204 No Content', isCorrect: false },
              { id: 'opt_2_4', text: '301 Moved Permanently', isCorrect: false }
            ],
            explanation: '201 Created is the standard response for resource creation.',
            timerSeconds: 0
          },
          {
            id: `q_${Date.now()}_3`,
            type: 'quiz',
            title: 'What does JSON stand for?',
            options: [
              { id: 'opt_3_1', text: 'JavaScript Object Notation', isCorrect: true },
              { id: 'opt_3_2', text: 'Java Standard Online Network', isCorrect: false },
              { id: 'opt_3_3', text: 'JavaScript Oriented Nodes', isCorrect: false },
              { id: 'opt_3_4', text: 'Java Serialized Output Name', isCorrect: false }
            ],
            explanation: 'JSON stands for JavaScript Object Notation.',
            timerSeconds: 0
          },
          {
            id: `q_${Date.now()}_4`,
            type: 'quiz',
            title: 'Which data structure follows the LIFO (Last In, First Out) principle?',
            options: [
              { id: 'opt_4_1', text: 'Queue', isCorrect: false },
              { id: 'opt_4_2', text: 'Stack', isCorrect: true },
              { id: 'opt_4_3', text: 'Binary Tree', isCorrect: false },
              { id: 'opt_4_4', text: 'Hash Table', isCorrect: false }
            ],
            explanation: 'Stacks operate on Last-In, First-Out (LIFO).',
            timerSeconds: 0
          },
          {
            id: `q_${Date.now()}_5`,
            type: 'quiz',
            title: 'What command creates and switches to a new Git branch simultaneously?',
            options: [
              { id: 'opt_5_1', text: 'git branch -new <name>', isCorrect: false },
              { id: 'opt_5_2', text: 'git switch -c <name>', isCorrect: true },
              { id: 'opt_5_3', text: 'git create-branch <name>', isCorrect: false },
              { id: 'opt_5_4', text: 'git merge <name>', isCorrect: false }
            ],
            explanation: '`git switch -c <name>` (or `git checkout -b`) creates and checks out the branch.',
            timerSeconds: 0
          }
        ],

        team: [
          {
            id: `q_${Date.now()}_1`,
            type: 'wordcloud',
            title: 'In one word, what is your top focus or energy for today?',
            subtitle: 'Submit your word or phrase to build our live team word cloud',
            placeholder: 'e.g. Focus, Innovation, Collaboration...',
            options: [],
            explanation: '',
            timerSeconds: 0
          },
          {
            id: `q_${Date.now()}_2`,
            type: 'rating',
            title: 'How confident are you about our current sprint goals?',
            subtitle: 'Rate from 1 (Low) to 5 (Extremely Confident)',
            scaleMin: 1,
            scaleMax: 5,
            options: [],
            explanation: '',
            timerSeconds: 0
          },
          {
            id: `q_${Date.now()}_3`,
            type: 'poll',
            title: 'Which area needs the most team focus next week?',
            options: [
              { id: 'opt_3_1', text: 'Core Product Features', isCorrect: false },
              { id: 'opt_3_2', text: 'Bug Fixes & Tech Debt', isCorrect: false },
              { id: 'opt_3_3', text: 'User Experience & Polish', isCorrect: false },
              { id: 'opt_3_4', text: 'Documentation & Testing', isCorrect: false }
            ],
            explanation: '',
            timerSeconds: 0
          },
          {
            id: `q_${Date.now()}_4`,
            type: 'binary',
            title: 'Are we ready to schedule our next major product demo?',
            options: [
              { id: 'opt_4_1', text: 'Yes 👍', isCorrect: false },
              { id: 'opt_4_2', text: 'No 👎', isCorrect: false }
            ],
            explanation: '',
            timerSeconds: 0
          }
        ],

        product: [
          {
            id: `q_${Date.now()}_1`,
            type: 'poll',
            title: 'What should be our #1 priority for the upcoming release?',
            options: [
              { id: 'opt_1_1', text: 'Speed & Performance Optimization', isCorrect: false },
              { id: 'opt_1_2', text: 'Mobile Responsive Experience', isCorrect: false },
              { id: 'opt_1_3', text: 'Advanced Analytics Dashboard', isCorrect: false },
              { id: 'opt_1_4', text: 'Third-party Integrations & API', isCorrect: false }
            ],
            explanation: '',
            timerSeconds: 0
          },
          {
            id: `q_${Date.now()}_2`,
            type: 'rating',
            title: 'How would you rate the overall usability of our latest prototype?',
            scaleMin: 1,
            scaleMax: 5,
            options: [],
            explanation: '',
            timerSeconds: 0
          },
          {
            id: `q_${Date.now()}_3`,
            type: 'binary',
            title: 'Do you feel the release timeline is realistic and achievable?',
            options: [
              { id: 'opt_3_1', text: 'Yes 👍', isCorrect: false },
              { id: 'opt_3_2', text: 'No 👎', isCorrect: false }
            ],
            explanation: '',
            timerSeconds: 0
          },
          {
            id: `q_${Date.now()}_4`,
            type: 'wordcloud',
            title: 'What is the biggest opportunity we should tackle next?',
            placeholder: 'e.g. AI automation, onboarding, latency...',
            options: [],
            explanation: '',
            timerSeconds: 0
          }
        ]
      };

      const selectedSet = presets[presetKey];
      if (!selectedSet) return;

      const poll = this.state.state.activePoll;
      if (poll) {
        poll.questions = JSON.parse(JSON.stringify(selectedSet));
        poll.activeQuestionIndex = 0; // Starts from first question
        poll.responses = {}; // Clear old responses

        this.state.setActivePoll(poll);
        this.sync.broadcastHostState(poll);
        this.closeModal('bulk-questions-modal');

        this.renderHostStudio();
        this.showToast(`Loaded ${poll.questions.length} questions from preset set!`);
      }
    }

    parseBulkQuestionsText(text) {
      if (!text || !text.trim()) return [];

      const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
      const parsedQuestions = [];

      blocks.forEach((block, bIdx) => {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) return;

        // First line is title
        let rawTitle = lines[0].replace(/^[\d]+[\.\)]\s*/, '').trim();
        let qType = 'poll';
        let options = [];
        let explanation = '';

        // Check for special tags
        const lowerBlock = block.toLowerCase();
        if (lowerBlock.includes('[rating]')) {
          qType = 'rating';
        } else if (lowerBlock.includes('[wordcloud]')) {
          qType = 'wordcloud';
        } else if (lowerBlock.includes('[binary]')) {
          qType = 'binary';
          options = [
            { id: `opt_${Date.now()}_${bIdx}_1`, text: 'Yes 👍', isCorrect: false },
            { id: `opt_${Date.now()}_${bIdx}_2`, text: 'No 👎', isCorrect: false }
          ];
        } else {
          // Parse options (lines starting with A), B), -, etc.)
          let hasCorrect = false;
          const optLines = lines.slice(1).filter(l => !l.startsWith('[') && !l.startsWith('💡'));

          optLines.forEach((optLine, oIdx) => {
            const isCorrect = optLine.includes('*') || optLine.includes('(correct)');
            let cleanOpt = optLine.replace(/^([A-Za-z\d][\.\)]|-|\*)\s*/, '').replace(/\*|\(correct\)/gi, '').trim();
            if (!cleanOpt) cleanOpt = `Option ${String.fromCharCode(65 + oIdx)}`;

            if (isCorrect) {
              hasCorrect = true;
            }

            options.push({
              id: `opt_${Date.now()}_${bIdx}_${oIdx}`,
              text: cleanOpt,
              isCorrect: isCorrect
            });
          });

          // If options have a correct answer, question is a Quiz
          if (hasCorrect) {
            qType = 'quiz';
          } else if (options.length === 0) {
            // Default 4 options
            options = [
              { id: `opt_${Date.now()}_${bIdx}_0`, text: 'Option A', isCorrect: false },
              { id: `opt_${Date.now()}_${bIdx}_1`, text: 'Option B', isCorrect: false },
              { id: `opt_${Date.now()}_${bIdx}_2`, text: 'Option C', isCorrect: false },
              { id: `opt_${Date.now()}_${bIdx}_3`, text: 'Option D', isCorrect: false }
            ];
          }
        }

        parsedQuestions.push({
          id: `q_${Date.now()}_${bIdx}`,
          type: qType,
          title: rawTitle,
          subtitle: '',
          options: options,
          explanation: explanation,
          timerSeconds: 0
        });
      });

      return parsedQuestions;
    }

    importFromBulkText(text, mode = 'replace') {
      const parsed = this.parseBulkQuestionsText(text);
      if (parsed.length === 0) {
        this.showToast('No valid questions found in text.');
        return;
      }

      const poll = this.state.state.activePoll;
      if (poll) {
        if (mode === 'replace') {
          poll.questions = parsed;
          poll.responses = {};
        } else {
          poll.questions.push(...parsed);
        }

        poll.activeQuestionIndex = 0; // Starts from first question
        this.state.setActivePoll(poll);
        this.sync.broadcastHostState(poll);
        this.closeModal('bulk-questions-modal');

        this.renderHostStudio();
        this.showToast(`Imported ${parsed.length} questions successfully!`);
      }
    }

    exportJsonQuestionSet() {
      const poll = this.state.state.activePoll;
      if (!poll || !poll.questions || poll.questions.length === 0) {
        this.showToast('No questions to export.');
        return;
      }

      const exportData = {
        title: poll.title || 'Live Voting Question Set',
        exportedAt: new Date().toISOString(),
        questions: poll.questions
      };

      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `QuestionSet_${poll.roomCode}.json`;
      link.click();
      this.showToast('Question set exported as JSON!');
    }

    handleJsonFileUpload(file) {
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          const questions = Array.isArray(data) ? data : data.questions;

          if (Array.isArray(questions) && questions.length > 0) {
            const poll = this.state.state.activePoll;
            if (poll) {
              poll.questions = questions;
              poll.activeQuestionIndex = 0;
              poll.responses = {};

              this.state.setActivePoll(poll);
              this.sync.broadcastHostState(poll);
              this.closeModal('bulk-questions-modal');

              this.renderHostStudio();
              this.showToast(`Imported ${questions.length} questions from JSON!`);
            }
          } else {
            this.showToast('Invalid JSON question set structure.');
          }
        } catch (err) {
          console.error(err);
          this.showToast('Error reading JSON file.');
        }
      };
      reader.readAsText(file);
    }

    /* --------------------------------------------------------------------------
       QR CODE MODAL & DOWNLOAD
       -------------------------------------------------------------------------- */
    openQRModal() {
      const poll = this.state.state.activePoll;
      if (!poll) return;

      const modal = document.getElementById('qr-modal');
      const qrTarget = document.getElementById('qr-modal-svg');
      const pinText = document.getElementById('qr-modal-pin');
      const urlInput = document.getElementById('qr-modal-url');

      if (!modal || !qrTarget) return;

      const joinUrl = this.getJoinUrl(poll.roomCode);

      if (this.qr) {
        qrTarget.innerHTML = this.qr.generateSVG(joinUrl, { size: 260 });
      }

      if (pinText) pinText.textContent = poll.roomCode;
      if (urlInput) urlInput.value = joinUrl;

      modal.classList.add('active');
    }

    downloadQRCodePNG() {
      const poll = this.state.state.activePoll;
      if (!poll) return;

      const joinUrl = this.getJoinUrl(poll.roomCode);
      const canvas = document.createElement('canvas');
      
      // High-res 1000x1000 PNG for presentations & printing
      if (this.qr) {
        this.qr.renderToCanvas(canvas, joinUrl, { size: 1000, margin: 4 });
        const link = document.createElement('a');
        link.download = `LiveVotingApp_QR_${poll.roomCode}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        this.showToast('High-res QR Code downloaded!');
      }
    }

    /* --------------------------------------------------------------------------
       CAMERA QR SCANNER MODAL (IN-BROWSER SCANNER)
       -------------------------------------------------------------------------- */
    async openQRScannerModal() {
      const modal = document.getElementById('scanner-modal');
      const video = document.getElementById('qr-scanner-video');
      const statusEl = document.getElementById('scanner-status-text');

      if (!modal || !video) return;
      modal.classList.add('active');

      if (statusEl) statusEl.textContent = 'Requesting camera access...';

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
        this.cameraStream = stream;
        video.srcObject = stream;
        await video.play();

        if (statusEl) statusEl.textContent = 'Point camera at Host QR Code...';

        // Check if native BarcodeDetector is supported
        if ('BarcodeDetector' in window) {
          const barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
          this.qrScanInterval = setInterval(async () => {
            try {
              const barcodes = await barcodeDetector.detect(video);
              if (barcodes.length > 0) {
                const rawValue = barcodes[0].rawValue;
                this.handleScannedQRCode(rawValue);
              }
            } catch (_) {}
          }, 300);
        } else {
          if (statusEl) statusEl.textContent = 'Camera active. Point at QR code to join.';
        }
      } catch (err) {
        console.warn('Camera error:', err);
        if (statusEl) statusEl.textContent = 'Camera not available. You can enter the PIN manually.';
      }
    }

    closeQRScannerModal() {
      const modal = document.getElementById('scanner-modal');
      if (modal) modal.classList.remove('active');

      if (this.qrScanInterval) {
        clearInterval(this.qrScanInterval);
        this.qrScanInterval = null;
      }

      if (this.cameraStream) {
        this.cameraStream.getTracks().forEach(track => track.stop());
        this.cameraStream = null;
      }
    }

    handleScannedQRCode(scannedText) {
      if (!scannedText) return;
      this.closeQRScannerModal();

      // Extract PIN from URL or raw text
      let pin = scannedText.trim();
      if (scannedText.includes('join=')) {
        const match = scannedText.match(/[?&]join=([A-Za-z0-9]+)/);
        if (match) pin = match[1];
      } else if (scannedText.includes('#voter=')) {
        const match = scannedText.match(/#voter=([A-Za-z0-9]+)/);
        if (match) pin = match[1];
      }

      this.showToast(`Scanned room code: ${pin.toUpperCase()}`);
      this.joinPoll(pin.toUpperCase());
    }

    closeModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) modal.classList.remove('active');
    }

    renderHeaderState(state) {
      const themeBtn = document.getElementById('btn-toggle-theme');
      if (themeBtn) {
        themeBtn.textContent = state.theme === 'dark' ? '☀️' : '🌙';
        themeBtn.title = `Switch to ${state.theme === 'dark' ? 'Light' : 'Dark'} Mode`;
      }

      const soundBtn = document.getElementById('btn-toggle-sound');
      if (soundBtn) {
        soundBtn.textContent = state.soundEnabled ? '🔔' : '🔕';
        soundBtn.title = state.soundEnabled ? 'Mute Sounds' : 'Enable Sounds';
      }

      const roomPill = document.getElementById('header-room-pill');
      if (roomPill) {
        if (state.activePoll && state.currentView !== 'home') {
          roomPill.style.display = 'inline-flex';
          const codeSpan = document.getElementById('header-room-code');
          if (codeSpan) codeSpan.textContent = state.activePoll.roomCode;
        } else {
          roomPill.style.display = 'none';
        }
      }
    }

    /* --------------------------------------------------------------------------
       DOM EVENT BINDINGS
       -------------------------------------------------------------------------- */
    bindDOMEvents() {
      // Theme & Sound toggles
      const themeBtn = document.getElementById('btn-toggle-theme');
      if (themeBtn) themeBtn.addEventListener('click', () => this.state.toggleTheme());

      const soundBtn = document.getElementById('btn-toggle-sound');
      if (soundBtn) soundBtn.addEventListener('click', () => this.state.toggleSound());

      // Brand home button
      const brand = document.getElementById('app-brand-btn');
      if (brand) brand.addEventListener('click', () => this.showView('home'));

      // Home Actions
      const createPollBtn = document.getElementById('btn-home-create-poll');
      if (createPollBtn) createPollBtn.addEventListener('click', () => this.createNewPoll());

      const joinBtn = document.getElementById('btn-home-join-submit');
      if (joinBtn) {
        joinBtn.addEventListener('click', () => {
          const pinInput = document.getElementById('input-join-pin');
          const nameInput = document.getElementById('input-join-name');
          if (nameInput) this.state.setParticipantName(nameInput.value);
          if (pinInput) this.joinPoll(pinInput.value);
        });
      }

      // Camera QR Scanner trigger
      const scanQrBtn = document.getElementById('btn-home-scan-qr');
      if (scanQrBtn) scanQrBtn.addEventListener('click', () => this.openQRScannerModal());

      const closeScannerBtn = document.getElementById('btn-close-scanner');
      if (closeScannerBtn) closeScannerBtn.addEventListener('click', () => this.closeQRScannerModal());

      // Question Type select change in modal
      const typeSelect = document.getElementById('select-new-q-type');
      if (typeSelect) {
        typeSelect.addEventListener('change', () => this.renderModalOptionRows());
      }

      // Add Option Row button in modal
      const addOptRowBtn = document.getElementById('btn-add-option-row');
      if (addOptRowBtn) {
        addOptRowBtn.addEventListener('click', () => {
          if (this.modalOptions.length < 8) {
            this.modalOptions.push({ text: '', isCorrect: false });
            this.renderModalOptionRows();
          } else {
            this.showToast('Maximum 8 options supported per question.');
          }
        });
      }

      // Host Controls
      const lockBtn = document.getElementById('btn-host-lock');
      if (lockBtn) {
        lockBtn.addEventListener('click', () => {
          const poll = this.state.state.activePoll;
          if (!poll || poll.questions.length === 0) return;
          const currentQ = poll.questions[poll.activeQuestionIndex];
          const curStatus = this.getQuestionStatus(currentQ.id);
          const nextStatus = curStatus === 'locked' ? ((poll.revealedQuestions && poll.revealedQuestions[currentQ.id]) ? 'revealed' : 'open') : 'locked';
          this.setQuestionStatus(currentQ.id, nextStatus);
          this.state.setActivePoll(poll);
          this.sync.broadcastHostState(poll);
          this.renderHostHeaderCounts();
          this.showToast(nextStatus === 'locked' ? 'Voting is now LOCKED' : 'Voting is now OPEN');
        });
      }

      const revealBtn = document.getElementById('btn-host-reveal');
      if (revealBtn) {
        revealBtn.addEventListener('click', () => {
          const poll = this.state.state.activePoll;
          if (!poll || poll.questions.length === 0) return;
          const currentQ = poll.questions[poll.activeQuestionIndex];
          this.setQuestionStatus(currentQ.id, 'revealed');
          this.state.setActivePoll(poll);
          this.sync.broadcastHostState(poll);
          this.sync.broadcast('reveal_answer', { questionId: currentQ.id });
          if (this.audio) this.audio.playVictory();
          if (this.confetti) this.confetti.burst();
          this.renderActiveQuestionVisualizer();
          this.renderHostHeaderCounts();
        });
      }

      // Host Timer Start/Stop
      const timerBtn = document.getElementById('btn-host-timer');
      if (timerBtn) {
        timerBtn.addEventListener('click', () => {
          if (this.state.state.timer.isRunning) {
            this.stopTimer(true);
            this.showToast('Timer stopped.');
          } else {
            const durationSelect = document.getElementById('select-timer-duration');
            const seconds = durationSelect ? parseInt(durationSelect.value, 10) : 30;
            this.startTimer(seconds);
            this.showToast(`${seconds}s Countdown timer started!`);
          }
        });
      }

      // Projector Timer Start/Stop
      const projTimerBtn = document.getElementById('btn-projector-timer');
      if (projTimerBtn) {
        projTimerBtn.addEventListener('click', () => {
          if (this.state.state.timer.isRunning) {
            this.stopTimer(true);
            this.showToast('Timer stopped.');
          } else {
            const durationSelect = document.getElementById('select-projector-timer-duration');
            const seconds = durationSelect ? parseInt(durationSelect.value, 10) : 30;
            this.startTimer(seconds);
            this.showToast(`${seconds}s Countdown started on projector!`);
          }
        });
      }

      // Projector Fullscreen Timer Cancel Early button
      const projCancelTimerBtn = document.getElementById('btn-projector-cancel-timer');
      if (projCancelTimerBtn) {
        projCancelTimerBtn.addEventListener('click', () => {
          this.stopTimer(true);
          this.showToast('Timer stopped early.');
        });
      }

      // Clear / Reset votes for current question
      const clearBtn = document.getElementById('btn-host-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          const poll = this.state.state.activePoll;
          if (!poll || poll.questions.length === 0) return;
          const currentQ = poll.questions[poll.activeQuestionIndex];
          if (currentQ && poll.responses[currentQ.id]) {
            delete poll.responses[currentQ.id];
            this.state.setActivePoll(poll);
            this.sync.broadcastHostState(poll);
            this.renderHostStudio();
            this.showToast('Votes reset for current question.');
          }
        });
      }

      // Delete current question from toolbar
      const deleteQBtn = document.getElementById('btn-host-delete-q');
      if (deleteQBtn) {
        deleteQBtn.addEventListener('click', () => {
          const poll = this.state.state.activePoll;
          if (poll && poll.questions.length > 0) {
            this.deleteQuestion(poll.activeQuestionIndex);
          }
        });
      }

      // Host Next / Prev Question
      const nextQBtn = document.getElementById('btn-host-next-q');
      if (nextQBtn) {
        nextQBtn.addEventListener('click', () => {
          const poll = this.state.state.activePoll;
          if (poll && poll.activeQuestionIndex < poll.questions.length - 1) {
            this.switchHostActiveQuestion(poll.activeQuestionIndex + 1);
          }
        });
      }

      const prevQBtn = document.getElementById('btn-host-prev-q');
      if (prevQBtn) {
        prevQBtn.addEventListener('click', () => {
          const poll = this.state.state.activePoll;
          if (poll && poll.activeQuestionIndex > 0) {
            this.switchHostActiveQuestion(poll.activeQuestionIndex - 1);
          }
        });
      }

      // Projector Next / Prev / Reveal / Fullscreen Controls
      const projPrevBtn = document.getElementById('btn-projector-prev-q');
      if (projPrevBtn) {
        projPrevBtn.addEventListener('click', () => {
          const poll = this.state.state.activePoll;
          if (poll && poll.activeQuestionIndex > 0) {
            this.switchHostActiveQuestion(poll.activeQuestionIndex - 1);
          }
        });
      }

      const projNextBtn = document.getElementById('btn-projector-next-q');
      if (projNextBtn) {
        projNextBtn.addEventListener('click', () => {
          const poll = this.state.state.activePoll;
          if (poll && poll.activeQuestionIndex < poll.questions.length - 1) {
            this.switchHostActiveQuestion(poll.activeQuestionIndex + 1);
          }
        });
      }

      const projRevealBtn = document.getElementById('btn-projector-reveal');
      if (projRevealBtn) {
        projRevealBtn.addEventListener('click', () => {
          const poll = this.state.state.activePoll;
          if (!poll || poll.questions.length === 0) return;
          const currentQ = poll.questions[poll.activeQuestionIndex];
          this.setQuestionStatus(currentQ.id, 'revealed');
          this.state.setActivePoll(poll);
          this.sync.broadcastHostState(poll);
          this.sync.broadcast('reveal_answer', { questionId: currentQ.id });
          if (this.audio) this.audio.playVictory();
          if (this.confetti) this.confetti.burst();
          this.renderProjectorScreen();
        });
      }

      const projFullscreenBtn = document.getElementById('btn-projector-fullscreen');
      if (projFullscreenBtn) {
        projFullscreenBtn.addEventListener('click', () => {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => console.warn(err));
            projFullscreenBtn.textContent = '✖ Exit Fullscreen';
          } else {
            document.exitFullscreen().catch(err => console.warn(err));
            projFullscreenBtn.textContent = '⛶ Fullscreen';
          }
        });
      }

      // Keyboard navigation (Arrow keys on Projector or Host)
      window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const isProjectorOrHost = this.state.state.currentView === 'projector' || this.state.state.currentView === 'host';
        if (!isProjectorOrHost) return;

        const poll = this.state.state.activePoll;
        if (!poll || !poll.questions || poll.questions.length === 0) return;

        if (e.key === 'ArrowRight') {
          if (poll.activeQuestionIndex < poll.questions.length - 1) {
            this.switchHostActiveQuestion(poll.activeQuestionIndex + 1);
          }
        } else if (e.key === 'ArrowLeft') {
          if (poll.activeQuestionIndex > 0) {
            this.switchHostActiveQuestion(poll.activeQuestionIndex - 1);
          }
        } else if (e.key === ' ' || e.key === 'Enter') {
          const currentQ = poll.questions[poll.activeQuestionIndex];
          if (currentQ) {
            if (this.getQuestionStatus(currentQ.id) !== 'revealed') {
              this.setQuestionStatus(currentQ.id, 'revealed');
              this.state.setActivePoll(poll);
              this.sync.broadcastHostState(poll);
              this.sync.broadcast('reveal_answer', { questionId: currentQ.id });
              if (this.audio) this.audio.playVictory();
              if (this.confetti) this.confetti.burst();
              if (this.state.state.currentView === 'projector') this.renderProjectorScreen();
              if (this.state.state.currentView === 'host') this.renderHostStudio();
            }
          }
        }
      });

      const qrBtn = document.getElementById('btn-host-show-qr');
      if (qrBtn) qrBtn.addEventListener('click', () => this.openQRModal());

      const downloadQrBtn = document.getElementById('btn-download-qr-png');
      if (downloadQrBtn) downloadQrBtn.addEventListener('click', () => this.downloadQRCodePNG());

      const projectorBtn = document.getElementById('btn-host-projector');
      if (projectorBtn) {
        projectorBtn.addEventListener('click', () => {
          const poll = this.state.state.activePoll;
          if (poll) {
            window.open(`${window.location.origin}${window.location.pathname}#projector=${poll.roomCode}`, '_blank');
          }
        });
      }

      // Export CSV
      const exportCsvBtn = document.getElementById('btn-host-export-csv');
      if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', () => {
          const poll = this.state.state.activePoll;
          if (!poll) return;
          const csvContent = this.poll.exportToCSV(poll);
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = `LiveVotingApp_Export_${poll.roomCode}.csv`;
          link.click();
          this.showToast('Exported poll results as CSV!');
        });
      }

      // Question Set Modal Trigger (Host Sidebar)
      const bulkSetsBtn = document.getElementById('btn-host-bulk-sets');
      if (bulkSetsBtn) {
        bulkSetsBtn.addEventListener('click', () => this.openBulkQuestionsModal());
      }

      // Bulk Modal Tab switching
      document.querySelectorAll('.bulk-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const tab = e.target.getAttribute('data-tab');
          document.querySelectorAll('.bulk-tab-btn').forEach(b => b.classList.remove('active'));
          e.target.classList.add('active');

          document.querySelectorAll('.bulk-tab-panel').forEach(panel => {
            panel.style.display = 'none';
          });
          const activePanel = document.getElementById(`bulk-tab-content-${tab}`);
          if (activePanel) activePanel.style.display = 'block';
        });
      });

      // Preset Load Buttons
      document.querySelectorAll('.btn-load-preset').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const presetKey = e.target.getAttribute('data-preset');
          this.loadPresetQuestionSet(presetKey);
        });
      });

      // Bulk Text live counter
      const bulkTextInput = document.getElementById('input-bulk-paste-text');
      if (bulkTextInput) {
        bulkTextInput.addEventListener('input', () => {
          const parsed = this.parseBulkQuestionsText(bulkTextInput.value);
          const countEl = document.getElementById('bulk-detected-count');
          if (countEl) {
            countEl.textContent = `${parsed.length} ${parsed.length === 1 ? 'question' : 'questions'} detected`;
          }
        });
      }

      // Submit Bulk Text Import
      const submitBulkTextBtn = document.getElementById('btn-submit-bulk-paste');
      if (submitBulkTextBtn) {
        submitBulkTextBtn.addEventListener('click', () => {
          const text = bulkTextInput ? bulkTextInput.value : '';
          const modeRadio = document.querySelector('input[name="bulk_import_mode"]:checked');
          const mode = modeRadio ? modeRadio.value : 'replace';
          this.importFromBulkText(text, mode);
        });
      }

      // JSON File Trigger and Change
      const triggerJsonBtn = document.getElementById('btn-trigger-json-upload');
      const jsonFileInput = document.getElementById('input-json-file-upload');
      if (triggerJsonBtn && jsonFileInput) {
        triggerJsonBtn.addEventListener('click', () => jsonFileInput.click());
        jsonFileInput.addEventListener('change', (e) => {
          if (e.target.files && e.target.files[0]) {
            this.handleJsonFileUpload(e.target.files[0]);
          }
        });
      }

      // JSON Export Button
      const exportJsonBtn = document.getElementById('btn-export-json-set');
      if (exportJsonBtn) {
        exportJsonBtn.addEventListener('click', () => this.exportJsonQuestionSet());
      }

      // Add Single Question Modal Trigger
      const addQBtn = document.getElementById('btn-host-add-question');
      if (addQBtn) {
        addQBtn.addEventListener('click', () => {
          this.openAddQuestionModal();
        });
      }

      // "+ Add Next Question" Button (Saves and keeps modal open for subsequent question)
      const addNextQBtn = document.getElementById('btn-modal-add-next-q');
      if (addNextQBtn) {
        addNextQBtn.addEventListener('click', () => {
          this.saveCurrentQuestionFromModal(false);
        });
      }

      // "✓ Submit & Finish" Button (Saves if title entered, then closes modal)
      const addQSubmitBtn = document.getElementById('btn-modal-add-q-submit');
      if (addQSubmitBtn) {
        addQSubmitBtn.addEventListener('click', () => {
          this.saveCurrentQuestionFromModal(true);
        });
      }

      // Close modal buttons
      document.querySelectorAll('.btn-close-modal').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const modal = e.target.closest('.modal-backdrop');
          if (modal) modal.classList.remove('active');
        });
      });

      // Copy QR Link
      const copyLinkBtn = document.getElementById('btn-copy-qr-link');
      if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', () => {
          const urlInput = document.getElementById('qr-modal-url');
          if (urlInput) {
            urlInput.select();
            navigator.clipboard.writeText(urlInput.value).then(() => {
              this.showToast('Join link copied to clipboard!');
            });
          }
        });
      }

      // Open new test tab
      const openTestTabBtn = document.getElementById('btn-open-test-tab');
      if (openTestTabBtn) {
        openTestTabBtn.addEventListener('click', () => {
          const poll = this.state.state.activePoll;
          if (poll) {
            window.open(`${window.location.origin}${window.location.pathname}?join=${poll.roomCode}`, '_blank');
          }
        });
      }
    }
  }

  // Initialize App on DOM Ready
  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      global.app = new LiveVotingApp();
    });
  }
})(typeof window !== 'undefined' ? window : this);

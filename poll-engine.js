/**
 * Core Poll Engine & Statistical Calculator
 * Handles room creation, voting types, percentage distribution, ratings, word clouds, and scoring.
 */
(function (global) {
  'use strict';

  class PollEngine {
    constructor() {
      this.colorPalette = [
        '#2563eb', // Academic Blue
        '#10b981', // Emerald
        '#f59e0b', // Amber
        '#8b5cf6', // Violet
        '#ec4899', // Rose
        '#06b6d4', // Cyan
        '#f97316', // Orange
        '#64748b'  // Slate
      ];
    }

    generateRoomCode() {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return code;
    }

    createDefaultPoll(title = 'My Live Voting Session') {
      return {
        id: 'poll_' + Date.now(),
        roomCode: this.generateRoomCode(),
        title: title,
        createdAt: new Date().toISOString(),
        activeQuestionIndex: 0,
        status: 'open', // 'open', 'locked', 'revealed', 'ended'
        showLiveResults: true,
        allowAnonymous: true,
        questions: [],
        // Map: questionId -> 'open' | 'locked' | 'revealed'
        questionStatuses: {},
        // Map: questionId -> boolean (permanently tracks if question answer was revealed)
        revealedQuestions: {},
        // Map: questionId -> { participantId -> voteData }
        responses: {},
        // Map: participantId -> { id, name, score, joinedAt, answeredCount }
        participants: {}
      };
    }

    /**
     * Calculates statistics and percentage distribution for a given question
     */
    calculateStats(question, responsesMap = {}) {
      if (!question) return null;

      const questionResponses = responsesMap[question.id] || {};
      const participantIds = Object.keys(questionResponses);
      const totalResponses = participantIds.length;

      switch (question.type) {
        case 'poll':
        case 'quiz':
        case 'binary': {
          const optionCounts = {};
          const options = question.options || [];

          options.forEach(opt => {
            optionCounts[opt.id] = 0;
          });

          let totalVotesCounted = 0;
          participantIds.forEach(pId => {
            const resp = questionResponses[pId];
            if (!resp) return;
            const selected = Array.isArray(resp.selection) ? resp.selection : [resp.selection];
            selected.forEach(optId => {
              if (optionCounts[optId] !== undefined) {
                optionCounts[optId]++;
                totalVotesCounted++;
              }
            });
          });

          const optionStats = options.map((opt, idx) => {
            const count = optionCounts[opt.id] || 0;
            // Calculate percentage based on total responding participants or total votes
            const denominator = totalResponses > 0 ? totalResponses : 1;
            const percentage = totalResponses > 0 ? Math.round((count / denominator) * 100) : 0;
            const color = this.colorPalette[idx % this.colorPalette.length];

            return {
              id: opt.id,
              text: opt.text,
              isCorrect: !!opt.isCorrect,
              count: count,
              percentage: percentage,
              color: color
            };
          });

          return {
            type: question.type,
            totalResponses: totalResponses,
            totalVotesCounted: totalVotesCounted,
            options: optionStats,
            hasCorrectAnswer: options.some(o => o.isCorrect)
          };
        }

        case 'rating': {
          const scaleMin = question.scaleMin || 1;
          const scaleMax = question.scaleMax || 5;
          const distribution = {};
          for (let i = scaleMin; i <= scaleMax; i++) {
            distribution[i] = 0;
          }

          let sum = 0;
          let count = 0;

          participantIds.forEach(pId => {
            const resp = questionResponses[pId];
            if (resp && typeof resp.selection === 'number') {
              const val = Math.max(scaleMin, Math.min(scaleMax, Math.round(resp.selection)));
              distribution[val] = (distribution[val] || 0) + 1;
              sum += val;
              count++;
            }
          });

          const average = count > 0 ? (sum / count).toFixed(1) : '0.0';
          const items = [];
          for (let i = scaleMin; i <= scaleMax; i++) {
            const num = distribution[i] || 0;
            const pct = count > 0 ? Math.round((num / count) * 100) : 0;
            items.push({
              value: i,
              count: num,
              percentage: pct,
              label: (question.labels && question.labels[i]) || `${i} Stars`
            });
          }

          return {
            type: 'rating',
            totalResponses: totalResponses,
            average: parseFloat(average),
            averageDisplay: average,
            scaleMin: scaleMin,
            scaleMax: scaleMax,
            distribution: items
          };
        }

        case 'wordcloud': {
          const wordCounts = {};
          participantIds.forEach(pId => {
            const resp = questionResponses[pId];
            if (resp && typeof resp.selection === 'string') {
              const text = resp.selection.trim();
              if (text) {
                // Split multi-word if comma/semicolon, otherwise treat phrase cleanly
                const parts = text.split(/[,;\n]+/).map(w => w.trim()).filter(Boolean);
                parts.forEach(p => {
                  const cleaned = p.toLowerCase();
                  if (cleaned.length >= 2 && cleaned.length <= 40) {
                    // Capitalize first letter for display
                    const display = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
                    wordCounts[display] = (wordCounts[display] || 0) + 1;
                  }
                });
              }
            }
          });

          const sortedWords = Object.entries(wordCounts)
            .map(([word, count], idx) => ({
              word: word,
              count: count,
              color: this.colorPalette[idx % this.colorPalette.length]
            }))
            .sort((a, b) => b.count - a.count);

          const maxCount = sortedWords.length > 0 ? sortedWords[0].count : 1;

          return {
            type: 'wordcloud',
            totalResponses: totalResponses,
            totalUniqueWords: sortedWords.length,
            words: sortedWords.slice(0, 40),
            maxCount: maxCount
          };
        }

        default:
          return { type: question.type, totalResponses: totalResponses };
      }
    }

    /**
     * Compute leaderboard for quiz questions
     */
    computeLeaderboard(poll) {
      if (!poll || !poll.participants) return [];

      const participants = poll.participants;
      const responses = poll.responses || {};
      const scores = {};

      Object.keys(participants).forEach(pId => {
        scores[pId] = {
          id: pId,
          name: participants[pId].name || 'Participant',
          score: 0,
          correctCount: 0,
          totalAnswered: 0
        };
      });

      poll.questions.forEach(q => {
        if (q.type !== 'quiz') return;
        const qResponses = responses[q.id] || {};
        const correctOpt = (q.options || []).find(o => o.isCorrect);
        if (!correctOpt) return;

        Object.keys(qResponses).forEach(pId => {
          if (!scores[pId]) return;
          scores[pId].totalAnswered++;
          const resp = qResponses[pId];
          const isCorrect = resp && (resp.selection === correctOpt.id || (Array.isArray(resp.selection) && resp.selection.includes(correctOpt.id)));

          if (isCorrect) {
            scores[pId].correctCount++;
            // Base score 1000 + speed bonus if timeRemaining recorded
            let bonus = 0;
            if (resp.timeRemaining && q.timerSeconds > 0) {
              bonus = Math.round((resp.timeRemaining / q.timerSeconds) * 500);
            }
            scores[pId].score += 1000 + bonus;
          }
        });
      });

      return Object.values(scores)
        .sort((a, b) => b.score - a.score || b.correctCount - a.correctCount);
    }

    /**
     * Export poll summary as CSV string
     */
    exportToCSV(poll) {
      if (!poll) return '';
      let csv = `"Live Voting App - Export"\n`;
      csv += `"Poll Title","${(poll.title || '').replace(/"/g, '""')}"\n`;
      csv += `"Room Code","${poll.roomCode}"\n`;
      csv += `"Exported At","${new Date().toLocaleString()}"\n\n`;

      poll.questions.forEach((q, idx) => {
        csv += `"Question ${idx + 1} (${q.type.toUpperCase()})","${(q.title || '').replace(/"/g, '""')}"\n`;
        const stats = this.calculateStats(q, poll.responses);

        if (stats.type === 'poll' || stats.type === 'quiz' || stats.type === 'binary') {
          csv += `"Option","Votes","Percentage","Correct Answer?"\n`;
          stats.options.forEach(opt => {
            csv += `"${(opt.text || '').replace(/"/g, '""')}",${opt.count},"${opt.percentage}%",${opt.isCorrect ? 'YES' : 'NO'}\n`;
          });
        } else if (stats.type === 'rating') {
          csv += `"Metric","Value"\n`;
          csv += `"Average Score","${stats.averageDisplay} / ${stats.scaleMax}"\n`;
          csv += `"Total Responses",${stats.totalResponses}\n`;
          stats.distribution.forEach(d => {
            csv += `"${d.value} Stars",${d.count},"${d.percentage}%"\n`;
          });
        } else if (stats.type === 'wordcloud') {
          csv += `"Word / Phrase","Frequency"\n`;
          stats.words.forEach(w => {
            csv += `"${w.word.replace(/"/g, '""')}",${w.count}\n`;
          });
        }
        csv += `\n`;
      });

      return csv;
    }
  }

  global.pollEngine = new PollEngine();
})(typeof window !== 'undefined' ? window : this);


// AstroPilot — Session Memory & Learning
// ==========================================
// Logs every processing session and learns what works for each
// target type. Over time, AstroPilot adjusts its processing
// parameters based on what produced the best scores.
//
// The memory system tracks:
//   - What parameters were used for each target type
//   - What scores those parameters achieved
//   - Parameter ranges that consistently produce good results
//   - Cross-type learnings (e.g., "GHS works better than STF for nebulae")

const fs = require('fs');
const path = require('path');
const platform = require('./platform');

function getMemoryDir() {
   return path.join(platform.getAstroPilotDir(), 'memory');
}

function getSessionLogPath() {
   return path.join(getMemoryDir(), 'sessions.json');
}

function getLearningsPath() {
   return path.join(getMemoryDir(), 'learnings.json');
}

function ensureDir(dir) {
   fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Session logging
// ---------------------------------------------------------------------------

function loadSessions() {
   const logPath = getSessionLogPath();
   if (!fs.existsSync(logPath)) return [];
   try {
      return JSON.parse(fs.readFileSync(logPath, 'utf-8'));
   } catch {
      return [];
   }
}

function saveSessions(sessions) {
   ensureDir(getMemoryDir());
   fs.writeFileSync(getSessionLogPath(), JSON.stringify(sessions, null, 2));
}

function logSession(entry) {
   const sessions = loadSessions();

   const record = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      timestamp: new Date().toISOString(),
      target: entry.target || null,
      targetType: entry.targetType || null,
      profileName: entry.profileName || null,
      stretch: entry.stretch || null,
      processing: entry.processing || null,
      score: entry.score || null,
      gatesPassed: entry.gatesPassed || null,
      linearSteps: entry.linearSteps || [],
      creativeSteps: entry.creativeSteps || [],
      equipment: entry.equipment || null,
      integration: entry.integration || null,
      notes: entry.notes || null
   };

   sessions.push(record);

   // Keep last 500 sessions
   if (sessions.length > 500) {
      sessions.splice(0, sessions.length - 500);
   }

   saveSessions(sessions);
   updateLearnings(sessions);

   return record;
}

// ---------------------------------------------------------------------------
// Learnings — aggregate insights from session history
// ---------------------------------------------------------------------------

function loadLearnings() {
   const learningsPath = getLearningsPath();
   if (!fs.existsSync(learningsPath)) return {};
   try {
      return JSON.parse(fs.readFileSync(learningsPath, 'utf-8'));
   } catch {
      return {};
   }
}

function saveLearnings(learnings) {
   ensureDir(getMemoryDir());
   fs.writeFileSync(getLearningsPath(), JSON.stringify(learnings, null, 2));
}

function updateLearnings(sessions) {
   const learnings = {};

   // Group sessions by target type
   const byType = {};
   for (const s of sessions) {
      if (!s.targetType || !s.score) continue;
      if (!byType[s.targetType]) byType[s.targetType] = [];
      byType[s.targetType].push(s);
   }

   for (const [targetType, typeSessions] of Object.entries(byType)) {
      const learning = {
         targetType: targetType,
         sessionCount: typeSessions.length,
         updatedAt: new Date().toISOString()
      };

      // Score statistics
      const scores = typeSessions.map(s => s.score).filter(s => typeof s === 'number');
      if (scores.length > 0) {
         learning.scores = {
            best: Math.max(...scores),
            worst: Math.min(...scores),
            average: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
            trend: scores.length >= 3 ? computeTrend(scores) : 'insufficient_data'
         };
      }

      // Best stretch algorithm
      const stretchScores = {};
      for (const s of typeSessions) {
         if (!s.stretch || !s.score) continue;
         if (!stretchScores[s.stretch]) stretchScores[s.stretch] = [];
         stretchScores[s.stretch].push(s.score);
      }
      if (Object.keys(stretchScores).length > 0) {
         learning.bestStretch = pickBest(stretchScores);
      }

      // Best parameter ranges
      learning.parameterInsights = extractParameterInsights(typeSessions);

      // Gate pass rate
      const gateResults = typeSessions.filter(s => s.gatesPassed !== null);
      if (gateResults.length > 0) {
         const passCount = gateResults.filter(s => s.gatesPassed).length;
         learning.gatePassRate = Math.round(passCount / gateResults.length * 100);
      }

      learnings[targetType] = learning;
   }

   // Cross-type learnings
   learnings._global = computeGlobalLearnings(sessions);

   saveLearnings(learnings);
   return learnings;
}

// ---------------------------------------------------------------------------
// Parameter insight extraction
// ---------------------------------------------------------------------------

function extractParameterInsights(sessions) {
   const insights = {};

   // Separate sessions into good (score >= 75) and poor (score < 60)
   const good = sessions.filter(s => s.score && s.score >= 75 && s.processing);
   const poor = sessions.filter(s => s.score && s.score < 60 && s.processing);

   if (good.length < 2) return insights;

   // Extract ranges from good sessions
   const params = ['lheRadius', 'lheSlopeLimit', 'lheAmount', 'saturationStrength', 'sCurveStrength'];

   for (const param of params) {
      const goodVals = good.map(s => s.processing[param]).filter(v => v !== undefined && v !== null && typeof v === 'number');
      const poorVals = poor.map(s => s.processing[param]).filter(v => v !== undefined && v !== null && typeof v === 'number');

      if (goodVals.length >= 2) {
         insights[param] = {
            goodRange: { min: Math.min(...goodVals), max: Math.max(...goodVals) },
            goodAverage: goodVals.reduce((a, b) => a + b, 0) / goodVals.length
         };
         if (poorVals.length >= 2) {
            insights[param].poorAverage = poorVals.reduce((a, b) => a + b, 0) / poorVals.length;
         }
      }
   }

   // Noise reduction insights
   const goodNR = good
      .map(s => s.processing.noiseReduction)
      .filter(nr => nr && nr.sigmaL);
   if (goodNR.length >= 2) {
      const sigmaLs = goodNR.map(nr => nr.sigmaL);
      insights.nrSigmaL = {
         goodRange: { min: Math.min(...sigmaLs), max: Math.max(...sigmaLs) },
         goodAverage: sigmaLs.reduce((a, b) => a + b, 0) / sigmaLs.length
      };
   }

   return insights;
}

// ---------------------------------------------------------------------------
// Suggest profile adjustments based on learnings
// ---------------------------------------------------------------------------

function suggestAdjustments(targetType, currentProfile) {
   const learnings = loadLearnings();
   const learning = learnings[targetType];
   if (!learning || learning.sessionCount < 3) return null;

   const suggestions = [];

   // Suggest better stretch if data supports it
   if (learning.bestStretch && currentProfile.stretch !== learning.bestStretch.method) {
      suggestions.push({
         parameter: 'stretch',
         current: currentProfile.stretch,
         suggested: learning.bestStretch.method,
         reason: learning.bestStretch.method + ' averaged ' + learning.bestStretch.averageScore +
            '/100 across ' + learning.bestStretch.count + ' sessions'
      });
   }

   // Suggest parameter adjustments based on good ranges
   if (learning.parameterInsights && currentProfile.processing) {
      const proc = currentProfile.processing;
      const insights = learning.parameterInsights;

      for (const [param, insight] of Object.entries(insights)) {
         if (!insight.goodRange || proc[param] === undefined) continue;

         const current = proc[param];
         if (typeof current !== 'number') continue;

         if (current < insight.goodRange.min || current > insight.goodRange.max) {
            suggestions.push({
               parameter: param,
               current: current,
               suggested: Math.round(insight.goodAverage * 100) / 100,
               reason: 'Good results used ' + insight.goodRange.min.toFixed(2) +
                  ' to ' + insight.goodRange.max.toFixed(2) +
                  ' (avg ' + insight.goodAverage.toFixed(2) + ')'
            });
         }
      }
   }

   if (suggestions.length === 0) return null;

   return {
      targetType: targetType,
      basedOn: learning.sessionCount + ' sessions',
      bestScore: learning.scores ? learning.scores.best : null,
      suggestions: suggestions
   };
}

// ---------------------------------------------------------------------------
// Statistics and summaries
// ---------------------------------------------------------------------------

function getSessionStats() {
   const sessions = loadSessions();
   if (sessions.length === 0) return null;

   const scored = sessions.filter(s => s.score);
   const types = {};
   for (const s of sessions) {
      if (s.targetType) types[s.targetType] = (types[s.targetType] || 0) + 1;
   }

   return {
      totalSessions: sessions.length,
      scoredSessions: scored.length,
      averageScore: scored.length > 0
         ? Math.round(scored.reduce((sum, s) => sum + s.score, 0) / scored.length)
         : null,
      bestScore: scored.length > 0 ? Math.max(...scored.map(s => s.score)) : null,
      targetTypes: types,
      firstSession: sessions[0].timestamp,
      lastSession: sessions[sessions.length - 1].timestamp,
      gatePassRate: computeGatePassRate(sessions)
   };
}

function getTargetTypeStats(targetType) {
   const sessions = loadSessions().filter(s => s.targetType === targetType);
   if (sessions.length === 0) return null;

   const scored = sessions.filter(s => s.score);
   const targets = {};
   for (const s of sessions) {
      if (s.target) targets[s.target] = (targets[s.target] || 0) + 1;
   }

   return {
      sessionCount: sessions.length,
      targets: targets,
      averageScore: scored.length > 0
         ? Math.round(scored.reduce((sum, s) => sum + s.score, 0) / scored.length)
         : null,
      bestScore: scored.length > 0 ? Math.max(...scored.map(s => s.score)) : null,
      scoreTrend: scored.length >= 3 ? computeTrend(scored.map(s => s.score)) : 'insufficient_data'
   };
}

// ---------------------------------------------------------------------------
// Skill progression
// ---------------------------------------------------------------------------

function getSkillProgression() {
   const sessions = loadSessions();
   const scored = sessions.filter(s => s.score && s.timestamp);
   if (scored.length < 2) return null;

   // Split into time windows
   scored.sort(function(a, b) { return a.timestamp.localeCompare(b.timestamp); });

   const windowSize = Math.max(3, Math.floor(scored.length / 5));
   const windows = [];
   for (let i = 0; i < scored.length; i += windowSize) {
      const slice = scored.slice(i, i + windowSize);
      const scores = slice.map(s => s.score);
      windows.push({
         from: slice[0].timestamp,
         to: slice[slice.length - 1].timestamp,
         count: slice.length,
         average: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
         best: Math.max(...scores)
      });
   }

   // Determine level
   const recentAvg = windows[windows.length - 1].average;
   let level;
   if (recentAvg >= 90) level = 'Expert';
   else if (recentAvg >= 80) level = 'Advanced';
   else if (recentAvg >= 70) level = 'Intermediate';
   else if (recentAvg >= 60) level = 'Developing';
   else level = 'Beginner';

   // Calculate improvement
   const firstAvg = windows[0].average;
   const improvement = recentAvg - firstAvg;

   return {
      level: level,
      totalSessions: scored.length,
      currentAverage: recentAvg,
      improvement: improvement,
      windows: windows,
      milestones: computeMilestones(sessions)
   };
}

function computeMilestones(sessions) {
   const milestones = [];

   if (sessions.length >= 1) milestones.push({ name: 'First processed image', achieved: sessions[0].timestamp });
   if (sessions.length >= 10) milestones.push({ name: '10 images processed', achieved: sessions[9].timestamp });
   if (sessions.length >= 50) milestones.push({ name: '50 images processed', achieved: sessions[49].timestamp });
   if (sessions.length >= 100) milestones.push({ name: '100 images processed', achieved: sessions[99].timestamp });

   const scored = sessions.filter(s => s.score);
   const first70 = scored.find(s => s.score >= 70);
   if (first70) milestones.push({ name: 'First score above 70', achieved: first70.timestamp });
   const first80 = scored.find(s => s.score >= 80);
   if (first80) milestones.push({ name: 'First score above 80', achieved: first80.timestamp });
   const first90 = scored.find(s => s.score >= 90);
   if (first90) milestones.push({ name: 'First score above 90', achieved: first90.timestamp });

   const firstGatePass = sessions.find(s => s.gatesPassed === true);
   if (firstGatePass) milestones.push({ name: 'First all-gates pass', achieved: firstGatePass.timestamp });

   const types = new Set(sessions.filter(s => s.targetType).map(s => s.targetType));
   if (types.size >= 5) milestones.push({ name: '5 different target types', achieved: true });
   if (types.size >= 10) milestones.push({ name: '10 different target types', achieved: true });

   return milestones;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeTrend(values) {
   if (values.length < 3) return 'insufficient_data';
   const mid = Math.floor(values.length / 2);
   const firstHalf = values.slice(0, mid);
   const secondHalf = values.slice(mid);
   const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
   const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
   const diff = secondAvg - firstAvg;
   if (diff > 5) return 'improving';
   if (diff < -5) return 'declining';
   return 'stable';
}

function pickBest(groupedScores) {
   let bestMethod = null;
   let bestAvg = -1;
   let bestCount = 0;

   for (const [method, scores] of Object.entries(groupedScores)) {
      if (scores.length === 0) continue;
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (avg > bestAvg) {
         bestAvg = avg;
         bestMethod = method;
         bestCount = scores.length;
      }
   }

   return bestMethod ? { method: bestMethod, averageScore: Math.round(bestAvg), count: bestCount } : null;
}

function computeGatePassRate(sessions) {
   const withGates = sessions.filter(s => s.gatesPassed !== null && s.gatesPassed !== undefined);
   if (withGates.length === 0) return null;
   return Math.round(withGates.filter(s => s.gatesPassed).length / withGates.length * 100);
}

function computeGlobalLearnings(sessions) {
   const scored = sessions.filter(s => s.score);
   if (scored.length < 5) return { note: 'Need more sessions for global insights' };

   return {
      totalSessions: sessions.length,
      averageScore: Math.round(scored.reduce((sum, s) => sum + s.score, 0) / scored.length),
      gatePassRate: computeGatePassRate(sessions),
      trend: computeTrend(scored.map(s => s.score))
   };
}

module.exports = {
   logSession,
   loadSessions,
   loadLearnings,
   updateLearnings,
   suggestAdjustments,
   getSessionStats,
   getTargetTypeStats,
   getSkillProgression,
   getMemoryDir
};

// AstroPilot — Image Scorer & Quality Gates
// =============================================
// Evaluates a processed image on 8 dimensions (0-100 each) and
// checks it against quality gates. Uses PixInsight measurements
// via the bridge to compute objective scores.
//
// Usage:
//   const { scoreImage } = require('./scorer');
//   const result = await scoreImage('MyImage', { targetType: 'emission_nebula' });
//   console.log(result.scores);     // { detail: 82, background: 91, ... }
//   console.log(result.overall);    // 85
//   console.log(result.gatesPassed); // true/false

const bridge = require('../bridge/client');

function log(msg) {
   console.log('[AstroPilot] ' + msg);
}

function clamp(val, min, max) {
   return Math.max(min, Math.min(max, val));
}

// ---------------------------------------------------------------------------
// Individual scoring functions (each returns 0-100)
// ---------------------------------------------------------------------------

function scoreDetailCredibility(tonalData, artifactData) {
   // Higher dynamic range + low artifacts = good detail
   let score = 80;

   const avgDR = tonalData.averageDynamicRange;
   // Good DR is 0.7+, great is 0.9+
   if (avgDR > 0.9) score += 15;
   else if (avgDR > 0.7) score += 10;
   else if (avgDR > 0.5) score += 0;
   else score -= 20;

   // Penalize for artifacts that suggest over-sharpening or ringing
   score -= artifactData.issueCount * 8;

   return clamp(score, 0, 100);
}

function scoreBackgroundQuality(bgData) {
   let score = 100;

   // Gradient penalty (ideal: <0.005)
   const gradient = bgData.gradient;
   if (gradient > 0.03) score -= 40;
   else if (gradient > 0.02) score -= 25;
   else if (gradient > 0.01) score -= 15;
   else if (gradient > 0.005) score -= 5;

   // Channel imbalance penalty (ideal: <0.002)
   const imbalance = bgData.channelImbalance;
   if (imbalance > 0.02) score -= 30;
   else if (imbalance > 0.01) score -= 15;
   else if (imbalance > 0.005) score -= 8;
   else if (imbalance > 0.002) score -= 3;

   // Noise penalty (relative — lower is better)
   const noise = bgData.averageNoise;
   if (noise > 0.05) score -= 20;
   else if (noise > 0.03) score -= 10;
   else if (noise > 0.01) score -= 5;

   return clamp(score, 0, 100);
}

function scoreColorNaturalness(bgData, tonalData) {
   let score = 90;

   // Background should be near-neutral
   const meds = bgData.backgroundMedians;
   if (meds.length >= 3) {
      const spread = Math.max(
         Math.abs(meds[0] - meds[1]),
         Math.abs(meds[1] - meds[2]),
         Math.abs(meds[0] - meds[2])
      );
      if (spread > 0.03) score -= 30;
      else if (spread > 0.02) score -= 20;
      else if (spread > 0.01) score -= 10;
      else if (spread > 0.005) score -= 5;
   }

   // Channels should have similar dynamic range
   const channels = tonalData.channels;
   if (channels.length >= 3) {
      const drs = channels.map(c => c.dynamicRange);
      const drSpread = Math.max(...drs) - Math.min(...drs);
      if (drSpread > 0.3) score -= 15;
      else if (drSpread > 0.2) score -= 8;
   }

   return clamp(score, 0, 100);
}

function scoreStarIntegrity(starData) {
   let score = 85;

   // Star count — want at least 50
   const count = starData.estimatedStarCount;
   if (count < 20) score -= 25;
   else if (count < 50) score -= 10;
   else if (count > 500) score += 5;

   // Mask brightness indicates star bloat (lower is tighter stars)
   const brightness = starData.maskMeanBrightness;
   if (brightness > 0.15) score -= 20;
   else if (brightness > 0.10) score -= 10;
   else if (brightness > 0.05) score -= 5;
   else score += 5;

   return clamp(score, 0, 100);
}

function scoreTonalBalance(tonalData) {
   let score = 90;

   for (const ch of tonalData.channels) {
      // Penalize clipping
      if (ch.max >= 0.999) score -= 10;

      // Penalize black crush
      if (ch.median < 0.03) score -= 15;
      else if (ch.median < 0.05) score -= 5;

      // Good midtone balance is 0.15-0.35
      if (ch.median > 0.5) score -= 10;
      else if (ch.median < 0.08) score -= 10;

      // Dynamic range usage
      if (ch.dynamicRange < 0.5) score -= 10;
   }

   return clamp(score, 0, 100);
}

function scoreSubjectSeparation(sepData, targetType) {
   let score = 70;

   const ratio = sepData.contrastRatio;

   // Expected contrast depends on target type
   const expectations = {
      'spiral_galaxy': 2.0,
      'edge_on_galaxy': 2.5,
      'elliptical_galaxy': 1.5,
      'galaxy_cluster': 1.3,
      'emission_nebula': 3.0,
      'planetary_nebula': 2.0,
      'reflection_nebula': 1.5,
      'dark_nebula': 1.3,
      'supernova_remnant': 2.0,
      'globular_cluster': 3.0,
      'open_cluster': 1.5,
      'mixed_field': 1.5
   };

   const expected = expectations[targetType] || 1.5;

   if (ratio >= expected * 1.5) score = 95;
   else if (ratio >= expected) score = 85;
   else if (ratio >= expected * 0.7) score = 70;
   else if (ratio >= expected * 0.5) score = 55;
   else score = 40;

   return clamp(score, 0, 100);
}

function scoreArtifacts(artifactData) {
   // Start at 100 and subtract for each issue
   let score = 100;
   score -= artifactData.issueCount * 15;
   return clamp(score, 0, 100);
}

function scoreAestheticCoherence(scores) {
   // Aesthetic coherence is about consistency across all dimensions.
   // High variance between scores means something is off.
   const vals = Object.values(scores);
   const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
   const variance = vals.reduce((sum, v) => sum + (v - avg) ** 2, 0) / vals.length;
   const stdDev = Math.sqrt(variance);

   // Low variance = coherent processing
   let score = 90;
   if (stdDev > 25) score = 50;
   else if (stdDev > 20) score = 60;
   else if (stdDev > 15) score = 70;
   else if (stdDev > 10) score = 80;
   else if (stdDev > 5) score = 85;

   // Bonus if everything is above 70
   if (Math.min(...vals) >= 70) score += 5;
   if (Math.min(...vals) >= 80) score += 5;

   return clamp(score, 0, 100);
}

// ---------------------------------------------------------------------------
// Quality gates
// ---------------------------------------------------------------------------

function checkQualityGates(measurements, targetType) {
   const gates = [];

   // Gate 1: No burnt highlights (>3% of any channel above 0.93)
   const tonal = measurements.tonal;
   let clipped = false;
   for (const ch of tonal.channels) {
      if (ch.max >= 0.999 && ch.mean > 0.5) clipped = true;
   }
   gates.push({
      name: 'No burnt highlights',
      passed: !clipped,
      detail: clipped ? 'Significant clipping detected' : 'OK'
   });

   // Gate 2: Minimum star count
   const starCount = measurements.stars.estimatedStarCount;
   gates.push({
      name: 'Minimum 50 detected stars',
      passed: starCount >= 50,
      detail: starCount + ' stars detected'
   });

   // Gate 3: Background channel balance
   const bg = measurements.background;
   gates.push({
      name: 'Background channel balance',
      passed: bg.channelImbalance < 0.015,
      detail: 'Imbalance: ' + bg.channelImbalance.toFixed(4)
   });

   // Gate 4: Subject contrast ratio
   const sep = measurements.separation;
   const minRatios = {
      'spiral_galaxy': 1.3,
      'edge_on_galaxy': 1.5,
      'emission_nebula': 1.5,
      'globular_cluster': 2.0,
      'mixed_field': 1.2
   };
   const minRatio = minRatios[targetType] || 1.2;
   gates.push({
      name: 'Subject contrast ratio',
      passed: sep.contrastRatio >= minRatio,
      detail: 'Ratio: ' + sep.contrastRatio.toFixed(2) + ' (min: ' + minRatio.toFixed(1) + ')'
   });

   // Gate 5: No major artifacts
   const artifacts = measurements.artifacts;
   gates.push({
      name: 'No major artifacts',
      passed: artifacts.issueCount <= 1,
      detail: artifacts.issueCount + ' issue(s) found'
   });

   return gates;
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

async function scoreImage(targetId, options) {
   const opts = Object.assign({
      targetType: 'mixed_field'
   }, options || {});

   log('Scoring image: ' + targetId);

   // Gather all measurements in parallel-ish (bridge is sequential anyway)
   log('Measuring background...');
   const bgData = await bridge.sendCommand('measure_background', { target: targetId });

   log('Measuring stars...');
   const starData = await bridge.sendCommand('measure_stars', { target: targetId });

   log('Measuring subject separation...');
   const sepData = await bridge.sendCommand('measure_subject_separation', { target: targetId });

   log('Detecting artifacts...');
   const artifactData = await bridge.sendCommand('detect_artifacts', { target: targetId });

   log('Measuring tonal balance...');
   const tonalData = await bridge.sendCommand('measure_tonal_balance', { target: targetId });

   const measurements = {
      background: bgData,
      stars: starData,
      separation: sepData,
      artifacts: artifactData,
      tonal: tonalData
   };

   // Compute individual scores
   const scores = {};
   scores.detail = scoreDetailCredibility(tonalData, artifactData);
   scores.background = scoreBackgroundQuality(bgData);
   scores.color = scoreColorNaturalness(bgData, tonalData);
   scores.stars = scoreStarIntegrity(starData);
   scores.tonal = scoreTonalBalance(tonalData);
   scores.separation = scoreSubjectSeparation(sepData, opts.targetType);
   scores.artifacts = scoreArtifacts(artifactData);
   scores.aesthetic = scoreAestheticCoherence(scores);

   // Overall score (weighted average)
   const weights = {
      detail: 1.5,
      background: 1.2,
      color: 1.0,
      stars: 1.0,
      tonal: 1.0,
      separation: 1.3,
      artifacts: 1.5,
      aesthetic: 0.8
   };

   let weightedSum = 0;
   let weightTotal = 0;
   for (const [dim, score] of Object.entries(scores)) {
      const w = weights[dim] || 1.0;
      weightedSum += score * w;
      weightTotal += w;
   }
   const overall = Math.round(weightedSum / weightTotal);

   // Quality gates
   const gates = checkQualityGates(measurements, opts.targetType);
   const gatesPassed = gates.every(g => g.passed);

   // Build result
   const result = {
      target: targetId,
      targetType: opts.targetType,
      scores: scores,
      overall: overall,
      gates: gates,
      gatesPassed: gatesPassed,
      measurements: measurements
   };

   // Log summary
   log('');
   log('Scores:');
   const labels = {
      detail: 'Detail Credibility',
      background: 'Background Quality',
      color: 'Color Naturalness',
      stars: 'Star Integrity',
      tonal: 'Tonal Balance',
      separation: 'Subject Separation',
      artifacts: 'Artifact Penalty',
      aesthetic: 'Aesthetic Coherence'
   };
   for (const [dim, score] of Object.entries(scores)) {
      const bar = scoreBar(score);
      log('  ' + padRight(labels[dim], 22) + bar + '  ' + score);
   }
   log('');
   log('  Overall: ' + overall + '/100');
   log('');

   log('Quality gates:');
   for (const gate of gates) {
      log('  ' + (gate.passed ? 'PASS' : 'FAIL') + '  ' + gate.name + ' — ' + gate.detail);
   }
   log('');
   log(gatesPassed ? 'All gates passed.' : 'Some gates failed — review needed.');

   return result;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function scoreBar(score) {
   const filled = Math.round(score / 5);
   const empty = 20 - filled;
   return '[' + '#'.repeat(filled) + '.'.repeat(empty) + ']';
}

function padRight(str, len) {
   while (str.length < len) str += ' ';
   return str;
}

module.exports = { scoreImage };

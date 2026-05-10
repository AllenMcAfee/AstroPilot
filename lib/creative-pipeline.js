// AstroPilot — Creative Processing Pipeline
// =============================================
// Automated nonlinear processing driven by the target's processing
// profile. Takes a linear-processed image and produces a finished
// result through stretching, detail enhancement, color processing,
// star work, and final polish.
//
// Usage:
//   const { classifyTarget } = require('./target-classifier');
//   const { creativePipeline } = require('./creative-pipeline');
//   const classification = await classifyTarget('MyImage');
//   const result = await creativePipeline('MyImage', classification.profile);

const bridge = require('../bridge/client');

function log(msg) {
   console.log('[AstroPilot] ' + msg);
}

// ---------------------------------------------------------------------------
// Main creative pipeline
// ---------------------------------------------------------------------------

async function creativePipeline(targetId, profile, options) {
   const opts = Object.assign({
      // Sub-pipeline toggles
      stretch: true,
      detailEnhancement: true,
      colorProcessing: true,
      starProcessing: true,
      finalPolish: true,
      // Starless processing
      starlessId: null,
      starsId: null,
      // Narrowband windows
      haWindowId: null,
      oiiiWindowId: null,
      // Overrides
      stretchMethod: null,
      skipHDRMT: false,
      skipDarkStructure: false,
      skipSharpening: false
   }, options || {});

   const proc = profile.processing || {};
   const report = {
      target: targetId,
      profile: profile.name,
      steps: []
   };

   // -----------------------------------------------------------------------
   // 4a — Stretch & Initial Enhancement
   // -----------------------------------------------------------------------

   if (opts.stretch) {
      log('--- Stretch ---');

      // Apply selected stretch algorithm
      const stretchMethod = opts.stretchMethod || profile.stretch || 'auto_stf';
      log('Stretching with ' + stretchMethod + '...');

      const stretchResult = await bridge.sendCommand('stretch', {
         target: targetId,
         method: stretchMethod
      });
      report.steps.push({ phase: '4a', step: 'stretch', method: stretchResult.method, details: stretchResult });
      log('Stretch complete: ' + stretchResult.method);

      // Star recombination if we did starless processing
      if (opts.starsId) {
         log('Recombining stars (screen blend)...');
         const blendResult = await bridge.sendCommand('screen_blend_stars', {
            target: targetId,
            starsWindowId: opts.starsId,
            amount: 1.0
         });
         report.steps.push({ phase: '4a', step: 'star_recombination', details: blendResult });
      }

      // Post-stretch color balance
      log('Post-stretch color balance...');
      await bridge.sendCommand('color_balance', { target: targetId });
      report.steps.push({ phase: '4a', step: 'post_stretch_color_balance' });

      // Background floor cleanup
      log('Background floor cleanup...');
      await bridge.sendCommand('background_fix', { target: targetId });
      report.steps.push({ phase: '4a', step: 'background_floor_cleanup' });
   }

   // -----------------------------------------------------------------------
   // 4b — Detail Enhancement
   // -----------------------------------------------------------------------

   if (opts.detailEnhancement) {
      log('--- Detail Enhancement ---');

      // LHE with profile-tuned parameters
      log('Local histogram equalization...');
      const lheResult = await bridge.sendCommand('enhance', {
         target: targetId,
         lheRadius: proc.lheRadius || 64,
         lheSlopeLimit: proc.lheSlopeLimit || 1.5,
         lheAmount: proc.lheAmount || 0.35,
         saturationBoost: false,
         sCurve: false
      });
      report.steps.push({ phase: '4b', step: 'lhe', details: lheResult });

      // HDRMT for bright core compression (galaxies, bright nebulae)
      if (!opts.skipHDRMT && needsHDRMT(profile)) {
         log('HDR Multiscale Transform...');
         try {
            const hdrmtResult = await bridge.sendCommand('hdrmt', {
               target: targetId,
               layers: 6,
               toLightness: true
            });
            report.steps.push({ phase: '4b', step: 'hdrmt', details: hdrmtResult });
         } catch (e) {
            log('HDRMT failed: ' + e.message + ' (continuing)');
            report.steps.push({ phase: '4b', step: 'hdrmt', error: e.message });
         }
      }

      // Dark structure enhancement (galaxies with dust lanes)
      if (!opts.skipDarkStructure && needsDarkStructure(profile)) {
         log('Dark structure enhancement...');
         const dseResult = await bridge.sendCommand('dark_structure_enhance', {
            target: targetId,
            amount: 0.25,
            sigma: 30
         });
         report.steps.push({ phase: '4b', step: 'dark_structure', details: dseResult });
      }

      // Sharpening (masked)
      if (!opts.skipSharpening) {
         log('Sharpening...');
         const sharpResult = await bridge.sendCommand('sharpen', {
            target: targetId,
            method: 'usm',
            sigma: 2.5,
            amount: 0.25
         });
         report.steps.push({ phase: '4b', step: 'sharpen', details: sharpResult });
      }
   }

   // -----------------------------------------------------------------------
   // 4c — Color Processing
   // -----------------------------------------------------------------------

   if (opts.colorProcessing) {
      log('--- Color Processing ---');

      // Ha integration
      if (opts.haWindowId) {
         log('Blending Ha...');
         const haResult = await bridge.sendCommand('ha_blend', {
            target: targetId,
            haWindowId: opts.haWindowId,
            amount: 0.35,
            lumAmount: 0.15
         });
         report.steps.push({ phase: '4c', step: 'ha_blend', details: haResult });
      }

      // OIII integration
      if (opts.oiiiWindowId) {
         log('Blending OIII...');
         const oiiiResult = await bridge.sendCommand('oiii_blend', {
            target: targetId,
            oiiiWindowId: opts.oiiiWindowId,
            amount: 0.30
         });
         report.steps.push({ phase: '4c', step: 'oiii_blend', details: oiiiResult });
      }

      // SCNR green removal
      if (needsSCNR(profile, opts)) {
         log('SCNR green removal...');
         try {
            const scnrResult = await bridge.sendCommand('scnr', {
               target: targetId,
               amount: 0.80
            });
            report.steps.push({ phase: '4c', step: 'scnr', details: scnrResult });
         } catch (e) {
            log('SCNR failed: ' + e.message + ' (continuing)');
         }
      }

      // Selective color saturation
      log('Color saturation...');
      const satResult = await bridge.sendCommand('selective_color_saturation', {
         target: targetId,
         strength: proc.saturationStrength || 'moderate'
      });
      report.steps.push({ phase: '4c', step: 'saturation', details: satResult });
   }

   // -----------------------------------------------------------------------
   // 4d — Star Processing
   // -----------------------------------------------------------------------

   if (opts.starProcessing && proc.starReduction && proc.starReduction.iterations > 0) {
      log('--- Star Processing ---');

      // Star color enhancement
      log('Enhancing star colors...');
      try {
         const starColorResult = await bridge.sendCommand('star_color_enhance', {
            target: targetId
         });
         report.steps.push({ phase: '4d', step: 'star_color_enhance', details: starColorResult });
      } catch (e) {
         log('Star color enhancement failed: ' + e.message + ' (continuing)');
      }

      // Star size reduction
      log('Reducing stars...');
      const srResult = await bridge.sendCommand('star_reduction', {
         target: targetId,
         iterations: proc.starReduction.iterations,
         amount: proc.starReduction.amount
      });
      report.steps.push({ phase: '4d', step: 'star_reduction', details: srResult });

      // Star halo reduction
      if (proc.dehalo) {
         log('Reducing star halos...');
         const dhResult = await bridge.sendCommand('dehalo', {
            target: targetId,
            sigma: proc.dehalo.sigma,
            amount: proc.dehalo.amount
         });
         report.steps.push({ phase: '4d', step: 'dehalo', details: dhResult });
      }
   } else if (opts.starProcessing) {
      log('--- Star Processing: skipped (stars are the subject) ---');
      report.steps.push({ phase: '4d', step: 'skipped', reason: 'Stars are the subject for this target type' });
   }

   // -----------------------------------------------------------------------
   // 4e — Final Polish
   // -----------------------------------------------------------------------

   if (opts.finalPolish) {
      log('--- Final Polish ---');

      // S-curve contrast
      log('S-curve contrast...');
      const sCurveResult = await bridge.sendCommand('s_curve', {
         target: targetId,
         strength: proc.sCurveStrength || 'moderate'
      });
      report.steps.push({ phase: '4e', step: 's_curve', details: sCurveResult });

      // Final color balance
      log('Final color balance...');
      await bridge.sendCommand('color_balance', { target: targetId });
      report.steps.push({ phase: '4e', step: 'final_color_balance' });

      // Final noise check and optional NR pass
      const drCheck = await bridge.sendCommand('check_dynamic_range', { target: targetId });
      report.steps.push({ phase: '4e', step: 'dynamic_range_check', details: drCheck });

      if (drCheck.issues.length > 0) {
         log('Dynamic range issues:');
         drCheck.issues.forEach(function(issue) { log('  - ' + issue); });
      } else {
         log('Dynamic range: healthy');
      }
   }

   // -----------------------------------------------------------------------
   // Summary
   // -----------------------------------------------------------------------

   const stepCount = report.steps.length;
   const phases = {};
   for (const s of report.steps) {
      phases[s.phase] = (phases[s.phase] || 0) + 1;
   }

   log('');
   log('Creative pipeline complete: ' + stepCount + ' steps');
   log('  4a Stretch: ' + (phases['4a'] || 0) + ' steps');
   log('  4b Detail:  ' + (phases['4b'] || 0) + ' steps');
   log('  4c Color:   ' + (phases['4c'] || 0) + ' steps');
   log('  4d Stars:   ' + (phases['4d'] || 0) + ' steps');
   log('  4e Polish:  ' + (phases['4e'] || 0) + ' steps');

   return report;
}

// ---------------------------------------------------------------------------
// Profile-based decision helpers
// ---------------------------------------------------------------------------

function needsHDRMT(profile) {
   const type = profile.name;
   return type === 'Spiral Galaxy' ||
          type === 'Edge-on Galaxy' ||
          type === 'Elliptical Galaxy' ||
          type === 'Emission Nebula' ||
          type === 'Globular Cluster';
}

function needsDarkStructure(profile) {
   const type = profile.name;
   return type === 'Spiral Galaxy' ||
          type === 'Edge-on Galaxy' ||
          type === 'Dark Nebula';
}

function needsSCNR(profile, opts) {
   // SCNR is useful after Ha blending or with OSC cameras
   if (opts.haWindowId) return true;
   const type = profile.name;
   return type === 'Emission Nebula' ||
          type === 'Supernova Remnant' ||
          type === 'Planetary Nebula';
}

module.exports = { creativePipeline };

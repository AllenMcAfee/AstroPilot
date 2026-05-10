// AstroPilot — Linear Pre-Processing
// ======================================
// Runs on a stacked master while it's still in a linear state (before
// stretching). Handles gradient removal, background neutralization,
// color calibration, noise reduction, deconvolution, and star extraction.
//
// Each step has graceful fallback: SPCC -> PCC, NXT -> MLT, BXT -> skip,
// SXT -> skip. The pipeline never fails because an optional tool is missing.
//
// Usage:
//   const { linearPreprocess } = require('./linear-preprocess');
//   const result = await linearPreprocess('MyStackedImage', { extractStars: true });

const bridge = require('../bridge/client');

function log(msg) {
   console.log('[AstroPilot] ' + msg);
}

// ---------------------------------------------------------------------------
// Check what's installed
// ---------------------------------------------------------------------------

async function checkTools() {
   const available = await bridge.sendCommand('check_installed_processes');
   return available;
}

// ---------------------------------------------------------------------------
// Main linear pre-processing pipeline
// ---------------------------------------------------------------------------

async function linearPreprocess(targetId, options) {
   const opts = Object.assign({
      gradientRemoval: true,
      backgroundNeutralization: true,
      colorCalibration: true,
      noiseReduction: true,
      deconvolution: true,
      extractStars: false,
      // Per-step options
      abePolyDegree: 4,
      nxtDenoise: 0.9,
      nxtDetail: 0.15,
      bxtSharpenStars: 0.5,
      bxtSharpenNonstellar: 0.75,
      colorCalibrationMethod: 'auto',
      noiseReductionMethod: 'auto',
      // Equipment info for PCC fallback
      solverFocalLength: null,
      solverPixelSize: null,
      narrowband: false
   }, options || {});

   log('Starting linear pre-processing on ' + targetId);

   // Check what tools are available
   const tools = await checkTools();
   log('Available tools: ' + Object.keys(tools).filter(k => tools[k]).join(', '));

   const report = {
      target: targetId,
      steps: [],
      toolsAvailable: tools
   };

   // -----------------------------------------------------------------------
   // Step 1: Gradient removal
   // -----------------------------------------------------------------------

   if (opts.gradientRemoval) {
      log('Removing gradients...');
      try {
         const result = await bridge.sendCommand('gradient_removal', {
            target: targetId,
            polyDegree: opts.abePolyDegree
         });
         report.steps.push({
            step: 'gradient_removal',
            method: result.method,
            details: result
         });
         log('Gradient removal: ' + result.method);
      } catch (e) {
         report.steps.push({
            step: 'gradient_removal',
            method: 'failed',
            error: e.message
         });
         log('Gradient removal failed: ' + e.message + ' (continuing)');
      }
   }

   // -----------------------------------------------------------------------
   // Step 2: Background neutralization
   // -----------------------------------------------------------------------

   if (opts.backgroundNeutralization) {
      log('Neutralizing background...');
      try {
         const result = await bridge.sendCommand('background_neutralization', {
            target: targetId
         });
         report.steps.push({
            step: 'background_neutralization',
            details: result
         });
         log('Background neutralized');
      } catch (e) {
         report.steps.push({
            step: 'background_neutralization',
            method: 'failed',
            error: e.message
         });
         log('Background neutralization failed: ' + e.message + ' (continuing)');
      }
   }

   // -----------------------------------------------------------------------
   // Step 3: Color calibration (SPCC -> PCC)
   // -----------------------------------------------------------------------

   if (opts.colorCalibration) {
      log('Calibrating colors...');
      try {
         const ccParams = {
            target: targetId,
            method: opts.colorCalibrationMethod,
            narrowband: opts.narrowband
         };
         if (opts.solverFocalLength) ccParams.solverFocalLength = opts.solverFocalLength;
         if (opts.solverPixelSize) ccParams.solverPixelSize = opts.solverPixelSize;

         const result = await bridge.sendCommand('color_calibration', ccParams);
         report.steps.push({
            step: 'color_calibration',
            method: result.method,
            details: result
         });
         log('Color calibration: ' + result.method);
      } catch (e) {
         report.steps.push({
            step: 'color_calibration',
            method: 'failed',
            error: e.message
         });
         log('Color calibration failed: ' + e.message + ' (continuing)');
      }
   }

   // -----------------------------------------------------------------------
   // Step 4: Linear noise reduction (NXT -> MLT)
   // -----------------------------------------------------------------------

   if (opts.noiseReduction) {
      log('Reducing noise (linear)...');
      const nrParams = {
         target: targetId,
         method: opts.noiseReductionMethod,
         denoise: opts.nxtDenoise,
         detail: opts.nxtDetail
      };

      const result = await bridge.sendCommand('linear_noise_reduction', nrParams);
      report.steps.push({
         step: 'linear_noise_reduction',
         method: result.method,
         details: result
      });

      if (result.method === 'skipped') {
         log('Noise reduction skipped: ' + result.reason);
      } else {
         log('Noise reduction: ' + result.method);
      }
   }

   // -----------------------------------------------------------------------
   // Step 5: Deconvolution (BXT or skip)
   // -----------------------------------------------------------------------

   if (opts.deconvolution) {
      log('Deconvolution...');
      const result = await bridge.sendCommand('deconvolution', {
         target: targetId,
         sharpenStars: opts.bxtSharpenStars,
         sharpenNonstellar: opts.bxtSharpenNonstellar
      });
      report.steps.push({
         step: 'deconvolution',
         method: result.method,
         details: result
      });

      if (result.method === 'skipped') {
         log('Deconvolution skipped: ' + result.reason);
      } else {
         log('Deconvolution: ' + result.method);
      }
   }

   // -----------------------------------------------------------------------
   // Step 6: Star extraction (SXT or skip)
   // -----------------------------------------------------------------------

   if (opts.extractStars) {
      log('Extracting stars...');
      const result = await bridge.sendCommand('star_extraction', {
         target: targetId
      });
      report.steps.push({
         step: 'star_extraction',
         method: result.method,
         details: result
      });

      if (result.method === 'skipped') {
         log('Star extraction skipped: ' + result.reason);
      } else {
         report.starlessId = result.starlessId;
         report.starsId = result.starsId;
         log('Stars extracted: starless=' + result.starlessId + ', stars=' + result.starsId);
      }
   }

   // -----------------------------------------------------------------------
   // Summary
   // -----------------------------------------------------------------------

   const applied = report.steps.filter(s => s.method !== 'skipped' && s.method !== 'failed');
   const skipped = report.steps.filter(s => s.method === 'skipped');
   const failed = report.steps.filter(s => s.method === 'failed');

   log('Linear pre-processing complete: ' +
      applied.length + ' applied, ' +
      skipped.length + ' skipped, ' +
      failed.length + ' failed');

   return report;
}

module.exports = { linearPreprocess, checkTools };

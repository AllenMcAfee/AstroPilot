// AstroPilot — Stacking Orchestrator
// =====================================
// Takes a classified Session (from classifier.js) and drives PixInsight
// through the bridge to produce calibrated, stacked masters.
//
// Usage:
//   const { scanDirectory } = require('./classifier');
//   const { stackSession } = require('./stacker');
//   const session = scanDirectory('/path/to/subs');
//   const result = await stackSession(session, bridge, { outputDir: '/path/to/output' });

const fs = require('fs');
const path = require('path');
const bridge = require('../bridge/client');
const { validateSession } = require('./validator');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir) {
   fs.mkdirSync(dir, { recursive: true });
}

function log(msg) {
   console.log('[AstroPilot] ' + msg);
}

function filePaths(frames) {
   return frames.map(f => f.filePath);
}

// Find files in a directory matching a postfix pattern
function findOutputFiles(dir, postfix) {
   if (!fs.existsSync(dir)) return [];
   return fs.readdirSync(dir)
      .filter(f => f.includes(postfix) && (f.endsWith('.fits') || f.endsWith('.xisf') || f.endsWith('.fit')))
      .map(f => path.join(dir, f))
      .sort();
}

// ---------------------------------------------------------------------------
// Master calibration frame creation
// ---------------------------------------------------------------------------

async function createMasterFrame(frames, frameType, outputDir, outputName) {
   if (frames.length === 0) return null;

   log('Creating master ' + frameType + ' from ' + frames.length + ' frames...');

   const result = await bridge.sendCommand('create_master_calibration', {
      files: filePaths(frames),
      frameType: frameType
   });

   if (!result.resultWindowId) {
      throw new Error('Master ' + frameType + ' integration produced no output');
   }

   // Save and close
   const masterPath = path.join(outputDir, outputName + '.xisf');
   await bridge.sendCommand('save_image', {
      target: result.resultWindowId,
      filePath: masterPath
   });
   await bridge.sendCommand('close_image', { target: result.resultWindowId });

   log('Master ' + frameType + ' saved: ' + masterPath);
   return masterPath;
}

// ---------------------------------------------------------------------------
// Main stacking pipeline
// ---------------------------------------------------------------------------

async function stackSession(session, options) {
   const opts = Object.assign({
      outputDir: path.join(session.dir, 'AstroPilot_output'),
      skipCalibration: false,
      skipMeasurement: false,
      skipRegistration: false,
      autoCrop: true
   }, options || {});

   const outputDir = opts.outputDir;
   const calibDir = path.join(outputDir, 'calibrated');
   const registeredDir = path.join(outputDir, 'registered');
   const mastersDir = path.join(outputDir, 'masters');

   ensureDir(outputDir);
   ensureDir(calibDir);
   ensureDir(registeredDir);
   ensureDir(mastersDir);

   const lights = session.lights();
   if (lights.length === 0) {
      throw new Error('No light frames found in session');
   }

   // -----------------------------------------------------------------------
   // Pre-stacking validation
   // -----------------------------------------------------------------------

   if (!opts.skipValidation) {
      log('Validating calibration frame compatibility...');
      const validation = validateSession(session);

      if (validation.errors().length > 0) {
         log('');
         log(validation.summary());
         log('');
      }

      if (validation.warnings().length > 0 && validation.errors().length === 0) {
         log(validation.warnings().length + ' warning(s) — proceeding with caution');
         for (const w of validation.warnings()) {
            log('  [WARN] ' + w.message);
         }
         log('');
      }

      if (!validation.canProceed() && !opts.forceStack) {
         throw new Error(
            'Validation failed with ' + validation.errors().length + ' error(s). ' +
            'Fix the issues above or use --force to stack anyway.'
         );
      }

      if (!validation.canProceed() && opts.forceStack) {
         log('WARNING: Stacking despite validation errors (--force). Results may be degraded.');
         log('');
      }
   }

   const report = {
      inputDir: session.dir,
      outputDir: outputDir,
      lightsCount: lights.length,
      steps: [],
      masters: {}
   };

   // -----------------------------------------------------------------------
   // Step 1: Create master calibration frames
   // -----------------------------------------------------------------------

   let masterDark = null;
   let masterFlat = null;
   let masterBias = null;

   if (!opts.skipCalibration) {
      const darks = session.darks();
      const flats = session.flats();
      const biases = session.biases();
      const flatDarks = session.flatDarks();

      if (biases.length > 0) {
         masterBias = await createMasterFrame(biases, 'bias', mastersDir, 'master_bias');
         report.masters.bias = { path: masterBias, frameCount: biases.length };
         report.steps.push('Created master bias from ' + biases.length + ' frames');
      }

      if (darks.length > 0) {
         masterDark = await createMasterFrame(darks, 'dark', mastersDir, 'master_dark');
         report.masters.dark = { path: masterDark, frameCount: darks.length };
         report.steps.push('Created master dark from ' + darks.length + ' frames');
      }

      if (flats.length > 0) {
         // If we have flat-darks but no bias, use flat-darks for flat calibration
         // For now, just integrate flats directly
         masterFlat = await createMasterFrame(flats, 'flat', mastersDir, 'master_flat');
         report.masters.flat = { path: masterFlat, frameCount: flats.length };
         report.steps.push('Created master flat from ' + flats.length + ' frames');
      }
   }

   // -----------------------------------------------------------------------
   // Step 2: Calibrate light frames
   // -----------------------------------------------------------------------

   let calibratedFiles;

   if (!opts.skipCalibration && (masterDark || masterFlat || masterBias)) {
      log('Calibrating ' + lights.length + ' light frames...');

      const calibParams = {
         lights: filePaths(lights),
         outputDir: calibDir
      };
      if (masterDark) calibParams.masterDark = masterDark;
      if (masterFlat) calibParams.masterFlat = masterFlat;
      if (masterBias) calibParams.masterBias = masterBias;

      await bridge.sendCommand('calibrate', calibParams);

      calibratedFiles = findOutputFiles(calibDir, '_c');
      if (calibratedFiles.length === 0) {
         throw new Error('Calibration produced no output files in ' + calibDir);
      }

      report.steps.push('Calibrated ' + calibratedFiles.length + ' light frames');
      log('Calibrated ' + calibratedFiles.length + ' frames');
   } else {
      // No calibration frames available — use lights directly
      calibratedFiles = filePaths(lights);
      if (!opts.skipCalibration) {
         log('No calibration frames found, using uncalibrated lights');
         report.steps.push('Skipped calibration (no darks/flats/bias found)');
      } else {
         report.steps.push('Calibration skipped by user');
      }
   }

   // -----------------------------------------------------------------------
   // Step 3: Measure subframes (quality metrics)
   // -----------------------------------------------------------------------

   let measurements = null;
   let weights = null;

   if (!opts.skipMeasurement) {
      log('Measuring subframe quality...');

      const measureResult = await bridge.sendCommand('measure_subframes', {
         files: calibratedFiles
      });

      measurements = measureResult.measurements;
      report.measurements = measurements;
      report.steps.push('Measured ' + measurements.length + ' subframes');

      // Extract weights for integration
      if (measurements.length > 0 && measurements[0].weight !== undefined) {
         weights = measurements.map(m => m.weight);
      }

      // Log quality summary
      if (measurements.length > 0) {
         const fwhms = measurements.map(m => m.fwhm).filter(v => v > 0);
         const snrs = measurements.map(m => m.snrWeight).filter(v => v > 0);
         if (fwhms.length > 0) {
            const avgFwhm = fwhms.reduce((a, b) => a + b, 0) / fwhms.length;
            const minFwhm = Math.min(...fwhms);
            const maxFwhm = Math.max(...fwhms);
            log('FWHM: avg=' + avgFwhm.toFixed(2) + ' min=' + minFwhm.toFixed(2) + ' max=' + maxFwhm.toFixed(2));
         }
      }
   } else {
      report.steps.push('Subframe measurement skipped by user');
   }

   // -----------------------------------------------------------------------
   // Step 4: Register (align) frames
   // -----------------------------------------------------------------------

   let registeredFiles;

   if (!opts.skipRegistration) {
      log('Registering ' + calibratedFiles.length + ' frames...');

      // Pick best frame as reference (lowest FWHM if we have measurements)
      let referenceImage = calibratedFiles[0];
      if (measurements && measurements.length > 0) {
         const best = measurements.reduce((a, b) =>
            (a.fwhm > 0 && (b.fwhm <= 0 || a.fwhm < b.fwhm)) ? a : b
         );
         if (best.filePath) referenceImage = best.filePath;
      }

      await bridge.sendCommand('register_frames', {
         files: calibratedFiles,
         outputDir: registeredDir,
         referenceImage: referenceImage
      });

      registeredFiles = findOutputFiles(registeredDir, '_r');
      if (registeredFiles.length === 0) {
         throw new Error('Registration produced no output files in ' + registeredDir);
      }

      report.steps.push('Registered ' + registeredFiles.length + ' frames (ref: ' + path.basename(referenceImage) + ')');
      log('Registered ' + registeredFiles.length + ' frames');
   } else {
      registeredFiles = calibratedFiles;
      report.steps.push('Registration skipped by user');
   }

   // -----------------------------------------------------------------------
   // Step 5: Integrate (stack)
   // -----------------------------------------------------------------------

   log('Integrating ' + registeredFiles.length + ' frames...');

   const integrateParams = {
      files: registeredFiles,
      weightMode: weights ? 'PSFSignalWeight' : 'NoiseEvaluation'
   };
   if (weights) integrateParams.weights = weights;

   const intResult = await bridge.sendCommand('integrate', integrateParams);

   if (!intResult.resultWindowId) {
      throw new Error('Integration produced no output');
   }

   report.steps.push('Integrated ' + registeredFiles.length + ' frames (' + intResult.rejectionAlgorithm + ')');
   report.resultWindowId = intResult.resultWindowId;
   log('Integration complete: ' + intResult.resultWindowId);

   // -----------------------------------------------------------------------
   // Step 6: Auto-crop stacking artifacts
   // -----------------------------------------------------------------------

   if (opts.autoCrop) {
      log('Auto-cropping stacking edges...');

      const cropResult = await bridge.sendCommand('crop_stacking_edges', {
         target: intResult.resultWindowId
      });

      if (cropResult.cropped) {
         report.steps.push('Cropped stacking edges: ' +
            cropResult.original.width + 'x' + cropResult.original.height + ' -> ' +
            cropResult.newSize.width + 'x' + cropResult.newSize.height);
         log('Cropped to ' + cropResult.newSize.width + 'x' + cropResult.newSize.height);
      } else {
         report.steps.push('No stacking edges to crop');
      }
   }

   // -----------------------------------------------------------------------
   // Save result
   // -----------------------------------------------------------------------

   const target = session.lights()[0].target || 'result';
   const filter = session.lights()[0].filter;
   const resultName = target.replace(/\s+/g, '_') + (filter ? '_' + filter : '') + '_stacked';
   const resultPath = path.join(outputDir, resultName + '.xisf');

   await bridge.sendCommand('save_image', {
      target: intResult.resultWindowId,
      filePath: resultPath
   });

   report.resultPath = resultPath;
   report.steps.push('Saved stacked result: ' + resultPath);
   log('Saved: ' + resultPath);

   // Write the report as JSON
   const reportPath = path.join(outputDir, 'stacking_report.json');
   fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

   return report;
}

// ---------------------------------------------------------------------------
// Multi-filter stacking
// ---------------------------------------------------------------------------

async function stackByFilter(session, options) {
   const byFilter = session.byFilter();
   const filters = Object.keys(byFilter);

   if (filters.length <= 1) {
      return stackSession(session, options);
   }

   log('Multi-filter session detected: ' + filters.join(', '));

   const results = {};
   const { Session } = require('./classifier');

   for (const filter of filters) {
      log('');
      log('--- Stacking filter: ' + filter + ' ---');

      // Build a sub-session with just this filter's lights + all calibration frames
      const filterFrames = [
         ...byFilter[filter],
         ...session.darks(),
         ...session.flats().filter(f => !f.filter || f.filter === filter),
         ...session.biases(),
         ...session.flatDarks()
      ];

      const filterSession = new Session(session.dir, filterFrames);
      const filterOpts = Object.assign({}, options, {
         outputDir: path.join(
            (options && options.outputDir) || path.join(session.dir, 'AstroPilot_output'),
            filter
         )
      });

      results[filter] = await stackSession(filterSession, filterOpts);
   }

   return results;
}

module.exports = { stackSession, stackByFilter };

// AstroPilot — Pre-Stacking Validation
// ========================================
// Validates calibration frame compatibility and sub quality before
// stacking. Catches problems that would silently degrade the result:
// wrong darks, mismatched gain, saturated flats, temperature drift, etc.
//
// Usage:
//   const { scanDirectory } = require('./classifier');
//   const { validateSession } = require('./validator');
//   const session = scanDirectory('/path/to/subs');
//   const report = validateSession(session);
//   console.log(report.summary());

// ---------------------------------------------------------------------------
// Severity levels
// ---------------------------------------------------------------------------

const SEVERITY = {
   ERROR:   'error',    // Will produce bad results — should not proceed
   WARNING: 'warning',  // May degrade quality — proceed with caution
   INFO:    'info'      // Worth noting but not harmful
};

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const THRESHOLDS = {
   // Dark matching
   darkTempTolerance: 5,        // Max degrees C difference between dark and light temps
   darkExposureTolerance: 0.01, // Max fractional exposure time difference (1%)

   // Flat validation
   flatADUMin: 0.20,            // Minimum median ADU for a useful flat (fraction of range)
   flatADUMax: 0.75,            // Maximum median ADU before saturation risk
   flatADUIdealMin: 0.30,       // Ideal range lower bound
   flatADUIdealMax: 0.60,       // Ideal range upper bound

   // Bias validation
   biasMaxExposure: 0.001,      // Max exposure for a bias frame (seconds)

   // Sub quality
   tempDriftMax: 3,             // Max temp drift across a session (degrees C)

   // ADU / saturation
   saturationThreshold: 0.95,   // Fraction of max — above this is likely clipped
   pedesalMinimum: 0.001       // Below this median, something is wrong
};

// ---------------------------------------------------------------------------
// Main validation
// ---------------------------------------------------------------------------

function validateSession(session) {
   const issues = [];
   const lights = session.lights();
   const darks = session.darks();
   const flats = session.flats();
   const biases = session.biases();
   const flatDarks = session.flatDarks();

   if (lights.length === 0) {
      issues.push(issue(SEVERITY.ERROR, 'no_lights', 'No light frames found'));
      return new ValidationReport(session, issues);
   }

   // 1. Validate light frame consistency
   validateLightConsistency(lights, issues);

   // 2. Validate darks against lights
   if (darks.length > 0) {
      validateDarkMatch(lights, darks, issues);
   }

   // 3. Validate flats
   if (flats.length > 0) {
      validateFlats(lights, flats, issues);
   }

   // 4. Validate biases
   if (biases.length > 0) {
      validateBiases(lights, biases, issues);
   }

   // 5. Validate flat-darks against flats
   if (flatDarks.length > 0 && flats.length > 0) {
      validateFlatDarks(flats, flatDarks, issues);
   }

   // 6. Check for missing calibration
   validateCalibrationCompleteness(lights, darks, flats, biases, flatDarks, issues);

   return new ValidationReport(session, issues);
}

// ---------------------------------------------------------------------------
// 1. Light frame consistency
// ---------------------------------------------------------------------------

function validateLightConsistency(lights, issues) {
   // Camera consistency
   const cameras = unique(lights.map(f => f.camera).filter(Boolean));
   if (cameras.length > 1) {
      issues.push(issue(SEVERITY.ERROR, 'mixed_cameras',
         'Light frames from multiple cameras: ' + cameras.join(', ') +
         '. Calibration frames must match each camera separately.',
         { cameras: cameras }));
   }

   // Gain consistency
   const gains = unique(lights.map(f => f.gain).filter(notNull));
   if (gains.length > 1) {
      issues.push(issue(SEVERITY.WARNING, 'mixed_gains',
         'Light frames with different gain values: ' + gains.join(', ') +
         '. Darks and biases must match gain settings.',
         { gains: gains }));
   }

   // Offset consistency
   const offsets = unique(lights.map(f => f.offset).filter(notNull));
   if (offsets.length > 1) {
      issues.push(issue(SEVERITY.WARNING, 'mixed_offsets',
         'Light frames with different offset values: ' + offsets.join(', '),
         { offsets: offsets }));
   }

   // Binning consistency
   const binnings = unique(lights.map(f => f.binning).filter(notNull));
   if (binnings.length > 1) {
      issues.push(issue(SEVERITY.ERROR, 'mixed_binning',
         'Light frames with different binning: ' + binnings.join(', ') +
         '. Cannot stack frames with different binning.',
         { binnings: binnings }));
   }

   // Temperature drift
   const temps = lights.map(f => f.temperature).filter(notNull);
   if (temps.length >= 2) {
      const minTemp = Math.min(...temps);
      const maxTemp = Math.max(...temps);
      const drift = maxTemp - minTemp;
      if (drift > THRESHOLDS.tempDriftMax) {
         issues.push(issue(SEVERITY.WARNING, 'temp_drift',
            'Sensor temperature drifted ' + drift.toFixed(1) + 'C across the session (' +
            minTemp.toFixed(1) + 'C to ' + maxTemp.toFixed(1) + 'C). ' +
            'Dark current changes with temperature — darks may not calibrate evenly.',
            { minTemp: minTemp, maxTemp: maxTemp, drift: drift }));
      }
   }

   // Check for very short or suspiciously long exposures
   const exposures = lights.map(f => f.exposure).filter(notNull);
   if (exposures.length > 0) {
      const minExp = Math.min(...exposures);
      const maxExp = Math.max(...exposures);
      if (minExp < 1) {
         issues.push(issue(SEVERITY.WARNING, 'very_short_exposure',
            'Some light frames have very short exposures (' + minExp + 's). ' +
            'These may be test frames or accidentally included.',
            { minExposure: minExp }));
      }
      // Different exposure times within lights (not just filter-grouped)
      const uniqueExps = unique(exposures);
      if (uniqueExps.length > 3) {
         issues.push(issue(SEVERITY.INFO, 'many_exposure_lengths',
            uniqueExps.length + ' different exposure times found in lights: ' +
            uniqueExps.sort((a, b) => a - b).map(e => e + 's').join(', '),
            { exposures: uniqueExps }));
      }
   }
}

// ---------------------------------------------------------------------------
// 2. Dark frame validation
// ---------------------------------------------------------------------------

function validateDarkMatch(lights, darks, issues) {
   const lightCamera = majorityValue(lights.map(f => f.camera).filter(Boolean));
   const darkCamera = majorityValue(darks.map(f => f.camera).filter(Boolean));

   // Camera match
   if (lightCamera && darkCamera && lightCamera !== darkCamera) {
      issues.push(issue(SEVERITY.ERROR, 'dark_camera_mismatch',
         'Darks are from a different camera (' + darkCamera + ') than lights (' + lightCamera + '). ' +
         'Dark current patterns are sensor-specific — these darks will add noise instead of removing it.',
         { lightCamera: lightCamera, darkCamera: darkCamera }));
   }

   // Gain match
   const lightGains = unique(lights.map(f => f.gain).filter(notNull));
   const darkGains = unique(darks.map(f => f.gain).filter(notNull));
   if (lightGains.length > 0 && darkGains.length > 0) {
      const unmatchedGains = lightGains.filter(g => !darkGains.includes(g));
      if (unmatchedGains.length > 0) {
         issues.push(issue(SEVERITY.ERROR, 'dark_gain_mismatch',
            'No matching darks for gain ' + unmatchedGains.join(', ') + '. ' +
            'Dark frames have gain ' + darkGains.join(', ') + '. ' +
            'Gain directly affects dark current and read noise — mismatched darks will leave artifacts.',
            { lightGains: lightGains, darkGains: darkGains }));
      }
   }

   // Offset match
   const lightOffsets = unique(lights.map(f => f.offset).filter(notNull));
   const darkOffsets = unique(darks.map(f => f.offset).filter(notNull));
   if (lightOffsets.length > 0 && darkOffsets.length > 0) {
      const unmatchedOffsets = lightOffsets.filter(o => !darkOffsets.includes(o));
      if (unmatchedOffsets.length > 0) {
         issues.push(issue(SEVERITY.ERROR, 'dark_offset_mismatch',
            'No matching darks for offset ' + unmatchedOffsets.join(', ') + '. ' +
            'Dark frames have offset ' + darkOffsets.join(', ') + '. ' +
            'Offset sets the ADU pedestal — mismatched offset will shift the black point.',
            { lightOffsets: lightOffsets, darkOffsets: darkOffsets }));
      }
   }

   // Exposure time match
   const lightExps = unique(lights.map(f => f.exposure).filter(notNull));
   const darkExps = unique(darks.map(f => f.exposure).filter(notNull));
   if (lightExps.length > 0 && darkExps.length > 0) {
      for (const lightExp of lightExps) {
         const matched = darkExps.find(d => Math.abs(d - lightExp) / lightExp < THRESHOLDS.darkExposureTolerance);
         if (!matched) {
            issues.push(issue(SEVERITY.ERROR, 'dark_exposure_mismatch',
               'No darks matching ' + lightExp + 's exposure. ' +
               'Available dark exposures: ' + darkExps.map(e => e + 's').join(', ') + '. ' +
               'Dark current scales with exposure — mismatched darks will under- or over-subtract.',
               { lightExposure: lightExp, darkExposures: darkExps }));
         }
      }
   }

   // Temperature match
   const lightTemps = lights.map(f => f.temperature).filter(notNull);
   const darkTemps = darks.map(f => f.temperature).filter(notNull);
   if (lightTemps.length > 0 && darkTemps.length > 0) {
      const avgLightTemp = average(lightTemps);
      const avgDarkTemp = average(darkTemps);
      const tempDiff = Math.abs(avgLightTemp - avgDarkTemp);

      if (tempDiff > THRESHOLDS.darkTempTolerance) {
         issues.push(issue(SEVERITY.WARNING, 'dark_temp_mismatch',
            'Dark frames averaged ' + avgDarkTemp.toFixed(1) + 'C but lights averaged ' +
            avgLightTemp.toFixed(1) + 'C (difference: ' + tempDiff.toFixed(1) + 'C). ' +
            'Dark current roughly doubles every 6C — consider re-shooting darks at the matching temperature.',
            { lightTemp: avgLightTemp, darkTemp: avgDarkTemp, diff: tempDiff }));
      } else if (tempDiff > 2) {
         issues.push(issue(SEVERITY.INFO, 'dark_temp_close',
            'Dark temperature offset: ' + tempDiff.toFixed(1) + 'C ' +
            '(darks ' + avgDarkTemp.toFixed(1) + 'C, lights ' + avgLightTemp.toFixed(1) + 'C). Acceptable.',
            { lightTemp: avgLightTemp, darkTemp: avgDarkTemp, diff: tempDiff }));
      }
   }

   // Binning match
   const lightBin = majorityValue(lights.map(f => f.binning).filter(notNull));
   const darkBin = majorityValue(darks.map(f => f.binning).filter(notNull));
   if (lightBin && darkBin && lightBin !== darkBin) {
      issues.push(issue(SEVERITY.ERROR, 'dark_binning_mismatch',
         'Darks are ' + darkBin + 'x binning but lights are ' + lightBin + 'x. ' +
         'Resolution mismatch — these darks cannot be applied.',
         { lightBinning: lightBin, darkBinning: darkBin }));
   }
}

// ---------------------------------------------------------------------------
// 3. Flat frame validation
// ---------------------------------------------------------------------------

function validateFlats(lights, flats, issues) {
   const lightCamera = majorityValue(lights.map(f => f.camera).filter(Boolean));
   const flatCamera = majorityValue(flats.map(f => f.camera).filter(Boolean));

   // Camera match
   if (lightCamera && flatCamera && lightCamera !== flatCamera) {
      issues.push(issue(SEVERITY.ERROR, 'flat_camera_mismatch',
         'Flats are from a different camera (' + flatCamera + ') than lights (' + lightCamera + '). ' +
         'Vignetting and dust patterns are sensor/optical-path specific.',
         { lightCamera: lightCamera, flatCamera: flatCamera }));
   }

   // Filter match
   const lightFilters = unique(lights.map(f => f.filter).filter(Boolean));
   const flatFilters = unique(flats.map(f => f.filter).filter(Boolean));
   if (lightFilters.length > 0 && flatFilters.length > 0) {
      const unmatched = lightFilters.filter(f => !flatFilters.includes(f));
      if (unmatched.length > 0) {
         issues.push(issue(SEVERITY.ERROR, 'flat_filter_mismatch',
            'No flats for filter(s): ' + unmatched.join(', ') + '. ' +
            'Available flat filters: ' + flatFilters.join(', ') + '. ' +
            'Each filter has different vignetting and dust shadows — uncalibrated filters will show gradients.',
            { lightFilters: lightFilters, flatFilters: flatFilters, unmatched: unmatched }));
      }
   }

   // Binning match
   const lightBin = majorityValue(lights.map(f => f.binning).filter(notNull));
   const flatBin = majorityValue(flats.map(f => f.binning).filter(notNull));
   if (lightBin && flatBin && lightBin !== flatBin) {
      issues.push(issue(SEVERITY.ERROR, 'flat_binning_mismatch',
         'Flats are ' + flatBin + 'x binning but lights are ' + lightBin + 'x. ' +
         'Resolution mismatch — flat correction will be wrong.',
         { lightBinning: lightBin, flatBinning: flatBin }));
   }

   // ADU level estimation from exposure time heuristics
   // (True ADU validation requires reading pixel data, but we can flag
   // suspiciously short or long flat exposures)
   const flatExps = flats.map(f => f.exposure).filter(notNull);
   if (flatExps.length > 0) {
      const minFlatExp = Math.min(...flatExps);
      const maxFlatExp = Math.max(...flatExps);

      if (minFlatExp < 0.001) {
         issues.push(issue(SEVERITY.WARNING, 'flat_too_short',
            'Some flats have very short exposures (' + minFlatExp + 's). ' +
            'These may not have enough signal for proper flat correction.',
            { minExposure: minFlatExp }));
      }

      if (maxFlatExp > 30) {
         issues.push(issue(SEVERITY.INFO, 'flat_long_exposure',
            'Some flats have exposures over 30s (' + maxFlatExp + 's). ' +
            'Long flat exposures accumulate dark current — consider using flat-darks.',
            { maxExposure: maxFlatExp }));
      }
   }

   // Flat count — more is better for noise
   if (flats.length < 10) {
      issues.push(issue(SEVERITY.INFO, 'few_flats',
         'Only ' + flats.length + ' flat frames. 15-30 flats are recommended for a clean master flat.',
         { count: flats.length }));
   }
}

// ---------------------------------------------------------------------------
// 4. Bias frame validation
// ---------------------------------------------------------------------------

function validateBiases(lights, biases, issues) {
   const lightCamera = majorityValue(lights.map(f => f.camera).filter(Boolean));
   const biasCamera = majorityValue(biases.map(f => f.camera).filter(Boolean));

   // Camera match
   if (lightCamera && biasCamera && lightCamera !== biasCamera) {
      issues.push(issue(SEVERITY.ERROR, 'bias_camera_mismatch',
         'Bias frames are from a different camera (' + biasCamera + ') than lights (' + lightCamera + ').',
         { lightCamera: lightCamera, biasCamera: biasCamera }));
   }

   // Gain match
   const lightGains = unique(lights.map(f => f.gain).filter(notNull));
   const biasGains = unique(biases.map(f => f.gain).filter(notNull));
   if (lightGains.length > 0 && biasGains.length > 0) {
      const unmatchedGains = lightGains.filter(g => !biasGains.includes(g));
      if (unmatchedGains.length > 0) {
         issues.push(issue(SEVERITY.ERROR, 'bias_gain_mismatch',
            'No matching biases for gain ' + unmatchedGains.join(', ') + '. ' +
            'Bias frames have gain ' + biasGains.join(', ') + '. ' +
            'Read noise pattern changes with gain — mismatched biases add structured noise.',
            { lightGains: lightGains, biasGains: biasGains }));
      }
   }

   // Offset match
   const lightOffsets = unique(lights.map(f => f.offset).filter(notNull));
   const biasOffsets = unique(biases.map(f => f.offset).filter(notNull));
   if (lightOffsets.length > 0 && biasOffsets.length > 0) {
      const unmatchedOffsets = lightOffsets.filter(o => !biasOffsets.includes(o));
      if (unmatchedOffsets.length > 0) {
         issues.push(issue(SEVERITY.ERROR, 'bias_offset_mismatch',
            'No matching biases for offset ' + unmatchedOffsets.join(', ') + '. ' +
            'Bias frames have offset ' + biasOffsets.join(', ') + '.',
            { lightOffsets: lightOffsets, biasOffsets: biasOffsets }));
      }
   }

   // Exposure should be zero or near-zero
   const biasExps = biases.map(f => f.exposure).filter(notNull);
   if (biasExps.length > 0) {
      const maxBiasExp = Math.max(...biasExps);
      if (maxBiasExp > THRESHOLDS.biasMaxExposure) {
         issues.push(issue(SEVERITY.WARNING, 'bias_has_exposure',
            'Bias frames have non-zero exposure (' + maxBiasExp + 's). ' +
            'True bias frames should have the shortest possible exposure (ideally 0s). ' +
            'These may actually be dark frames.',
            { maxExposure: maxBiasExp }));
      }
   }

   // Binning match
   const lightBin = majorityValue(lights.map(f => f.binning).filter(notNull));
   const biasBin = majorityValue(biases.map(f => f.binning).filter(notNull));
   if (lightBin && biasBin && lightBin !== biasBin) {
      issues.push(issue(SEVERITY.ERROR, 'bias_binning_mismatch',
         'Biases are ' + biasBin + 'x binning but lights are ' + lightBin + 'x.',
         { lightBinning: lightBin, biasBinning: biasBin }));
   }

   // Bias count
   if (biases.length < 20) {
      issues.push(issue(SEVERITY.INFO, 'few_biases',
         'Only ' + biases.length + ' bias frames. 30-50 biases are recommended for a clean master bias.',
         { count: biases.length }));
   }
}

// ---------------------------------------------------------------------------
// 5. Flat-dark validation
// ---------------------------------------------------------------------------

function validateFlatDarks(flats, flatDarks, issues) {
   // Exposure match between flat-darks and flats
   const flatExps = unique(flats.map(f => f.exposure).filter(notNull));
   const fdExps = unique(flatDarks.map(f => f.exposure).filter(notNull));

   if (flatExps.length > 0 && fdExps.length > 0) {
      for (const flatExp of flatExps) {
         const matched = fdExps.find(d => Math.abs(d - flatExp) / Math.max(flatExp, 0.001) < THRESHOLDS.darkExposureTolerance);
         if (!matched) {
            issues.push(issue(SEVERITY.WARNING, 'flatdark_exposure_mismatch',
               'No flat-darks matching flat exposure ' + flatExp + 's. ' +
               'Available flat-dark exposures: ' + fdExps.map(e => e + 's').join(', ') + '. ' +
               'Flat-darks should match flat exposure to properly remove thermal signal from flats.',
               { flatExposure: flatExp, flatDarkExposures: fdExps }));
         }
      }
   }

   // Camera match
   const flatCamera = majorityValue(flats.map(f => f.camera).filter(Boolean));
   const fdCamera = majorityValue(flatDarks.map(f => f.camera).filter(Boolean));
   if (flatCamera && fdCamera && flatCamera !== fdCamera) {
      issues.push(issue(SEVERITY.ERROR, 'flatdark_camera_mismatch',
         'Flat-darks are from a different camera (' + fdCamera + ') than flats (' + flatCamera + ').',
         { flatCamera: flatCamera, flatDarkCamera: fdCamera }));
   }
}

// ---------------------------------------------------------------------------
// 6. Calibration completeness
// ---------------------------------------------------------------------------

function validateCalibrationCompleteness(lights, darks, flats, biases, flatDarks, issues) {
   if (darks.length === 0) {
      issues.push(issue(SEVERITY.WARNING, 'no_darks',
         'No dark frames found. Dark subtraction removes thermal noise, amp glow, and hot pixels. ' +
         'Results will have more noise and hot pixel artifacts without darks.',
         {}));
   }

   if (flats.length === 0) {
      issues.push(issue(SEVERITY.WARNING, 'no_flats',
         'No flat frames found. Flat calibration corrects vignetting, dust shadows, and optical illumination gradients. ' +
         'The stacked image will show uneven brightness across the field.',
         {}));
   }

   // If we have flats with longer exposures but no flat-darks and no biases
   if (flats.length > 0 && flatDarks.length === 0 && biases.length === 0) {
      const flatExps = flats.map(f => f.exposure).filter(notNull);
      if (flatExps.length > 0 && Math.max(...flatExps) > 2) {
         issues.push(issue(SEVERITY.INFO, 'no_flat_calibration',
            'Flats have exposures up to ' + Math.max(...flatExps).toFixed(1) + 's but no flat-darks or biases were found. ' +
            'Longer flat exposures accumulate dark current that won\'t be subtracted.',
            {}));
      }
   }

   // Dark count relative to lights
   if (darks.length > 0 && darks.length < 10) {
      issues.push(issue(SEVERITY.INFO, 'few_darks',
         'Only ' + darks.length + ' dark frames. 15-30 darks are recommended for a clean master dark.',
         { count: darks.length }));
   }
}

// ---------------------------------------------------------------------------
// Validation report
// ---------------------------------------------------------------------------

class ValidationReport {
   constructor(session, issues) {
      this.session = session;
      this.issues = issues;
   }

   errors() { return this.issues.filter(i => i.severity === SEVERITY.ERROR); }
   warnings() { return this.issues.filter(i => i.severity === SEVERITY.WARNING); }
   infos() { return this.issues.filter(i => i.severity === SEVERITY.INFO); }

   hasErrors() { return this.errors().length > 0; }
   hasWarnings() { return this.warnings().length > 0; }
   isClean() { return this.issues.length === 0; }

   canProceed() {
      // Can proceed if no errors (warnings are okay)
      return !this.hasErrors();
   }

   summary() {
      const lines = [];

      lines.push('Pre-Stacking Validation');
      lines.push('=======================');

      const errors = this.errors();
      const warnings = this.warnings();
      const infos = this.infos();

      if (this.isClean()) {
         lines.push('All checks passed. Good to stack.');
         return lines.join('\n');
      }

      lines.push('');

      if (errors.length > 0) {
         lines.push('ERRORS (' + errors.length + '):');
         for (const e of errors) {
            lines.push('  [ERROR] ' + e.message);
         }
         lines.push('');
      }

      if (warnings.length > 0) {
         lines.push('WARNINGS (' + warnings.length + '):');
         for (const w of warnings) {
            lines.push('  [WARN]  ' + w.message);
         }
         lines.push('');
      }

      if (infos.length > 0) {
         lines.push('INFO (' + infos.length + '):');
         for (const i of infos) {
            lines.push('  [INFO]  ' + i.message);
         }
         lines.push('');
      }

      if (this.canProceed()) {
         lines.push('Validation passed with ' + warnings.length + ' warning(s). Safe to proceed.');
      } else {
         lines.push('Validation FAILED with ' + errors.length + ' error(s). Fix these before stacking.');
      }

      return lines.join('\n');
   }

   toJSON() {
      return {
         canProceed: this.canProceed(),
         errorCount: this.errors().length,
         warningCount: this.warnings().length,
         infoCount: this.infos().length,
         issues: this.issues
      };
   }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function issue(severity, code, message, data) {
   return { severity: severity, code: code, message: message, data: data || {} };
}

function unique(arr) {
   return [...new Set(arr)];
}

function notNull(x) {
   return x !== null && x !== undefined;
}

function average(arr) {
   if (arr.length === 0) return 0;
   return arr.reduce(function(a, b) { return a + b; }, 0) / arr.length;
}

function majorityValue(arr) {
   if (arr.length === 0) return null;
   const counts = {};
   for (const v of arr) {
      counts[v] = (counts[v] || 0) + 1;
   }
   let best = null;
   let bestCount = 0;
   for (const [v, c] of Object.entries(counts)) {
      if (c > bestCount) { best = v; bestCount = c; }
   }
   return best;
}

module.exports = { validateSession, ValidationReport, SEVERITY, THRESHOLDS };

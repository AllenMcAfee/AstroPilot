// AstroPilot — Frame Classifier
// ================================
// Scans a directory of FITS/XISF files, reads their headers, and
// classifies each frame by type (light, dark, flat, bias, flat-dark),
// filter, target, camera, exposure, gain, and temperature.
//
// Usage:
//   const { scanDirectory } = require('./classifier');
//   const session = await scanDirectory('/path/to/subs');
//   console.log(session.summary());

const fs = require('fs');
const path = require('path');
const { parseFitsHeaders } = require('./fits-header');
const { parseXisfHeaders } = require('./xisf-header');

const FITS_EXTENSIONS = new Set(['.fits', '.fit', '.fts']);
const XISF_EXTENSIONS = new Set(['.xisf']);

// ---------------------------------------------------------------------------
// Header reading
// ---------------------------------------------------------------------------

function readHeaders(filePath) {
   const ext = path.extname(filePath).toLowerCase();
   if (FITS_EXTENSIONS.has(ext)) return parseFitsHeaders(filePath);
   if (XISF_EXTENSIONS.has(ext)) return parseXisfHeaders(filePath);
   return null;
}

// ---------------------------------------------------------------------------
// Frame type detection
// ---------------------------------------------------------------------------

// IMAGETYP values vary wildly across capture software. These cover the
// common ones from NINA, SGP, APT, MaxIm, SharpCap, and ASIStudio.
const TYPE_PATTERNS = {
   light:     /light|science|object/i,
   dark:      /^dark$/i,
   flat:      /^flat$/i,
   bias:      /bias|offset|zero/i,
   flatdark:  /flat[\s\-_]?dark|dark[\s\-_]?flat/i
};

function classifyType(headers, filePath) {
   // 1. Try IMAGETYP keyword
   const imagetyp = headers.IMAGETYP || headers['FRAME'] || '';
   if (typeof imagetyp === 'string' && imagetyp.length > 0) {
      // Check flat-dark first since it contains both "flat" and "dark"
      if (TYPE_PATTERNS.flatdark.test(imagetyp)) return 'flatdark';
      if (TYPE_PATTERNS.bias.test(imagetyp)) return 'bias';
      if (TYPE_PATTERNS.dark.test(imagetyp)) return 'dark';
      if (TYPE_PATTERNS.flat.test(imagetyp)) return 'flat';
      if (TYPE_PATTERNS.light.test(imagetyp)) return 'light';
   }

   // 2. Fall back to filename/directory hints
   const lower = filePath.toLowerCase();
   if (/flat[\s_-]?dark/i.test(lower)) return 'flatdark';
   if (/[\\/]bias[\\/]|[\\/]offset[\\/]|_bias_/i.test(lower)) return 'bias';
   if (/[\\/]dark[\\/]|_dark_/i.test(lower)) return 'dark';
   if (/[\\/]flat[\\/]|_flat_/i.test(lower)) return 'flat';

   // 3. Heuristic: zero-length exposure = bias, short with no target = dark
   const exptime = headers.EXPTIME || headers.EXPOSURE || 0;
   if (exptime === 0) return 'bias';

   return 'light';
}

// ---------------------------------------------------------------------------
// Filter detection
// ---------------------------------------------------------------------------

function classifyFilter(headers) {
   const raw = headers.FILTER || headers['FILTNAM'] || '';
   if (!raw) return null;

   const f = String(raw).trim();

   // Normalize common filter names
   const normalized = f.replace(/[\s_-]/g, '').toUpperCase();
   const filterMap = {
      'L': 'L', 'LUM': 'L', 'LUMINANCE': 'L', 'CLEAR': 'L',
      'R': 'R', 'RED': 'R',
      'G': 'G', 'GREEN': 'G',
      'B': 'B', 'BLUE': 'B',
      'HA': 'Ha', 'HALPHA': 'Ha', 'H': 'Ha',
      'OIII': 'OIII', 'O3': 'OIII',
      'SII': 'SII', 'S2': 'SII',
      'NII': 'NII', 'N2': 'NII'
   };

   return filterMap[normalized] || f;
}

// ---------------------------------------------------------------------------
// Target grouping
// ---------------------------------------------------------------------------

function classifyTarget(headers) {
   // Prefer OBJECT keyword
   if (headers.OBJECT) return String(headers.OBJECT).trim();

   // Could cluster by RA/DEC in the future
   return 'Unknown';
}

// ---------------------------------------------------------------------------
// Equipment & settings
// ---------------------------------------------------------------------------

function extractSettings(headers) {
   return {
      camera: headers.INSTRUME || headers.CAMERA || null,
      telescope: headers.TELESCOP || null,
      exposure: headers.EXPTIME || headers.EXPOSURE || null,
      gain: headers.GAIN || headers.EGAIN || null,
      offset: headers.OFFSET || null,
      temperature: headers['CCD-TEMP'] || headers.CCDTEMP || headers['SET-TEMP'] || null,
      binning: headers.XBINNING || headers.BINNING || null,
      dateObs: headers['DATE-OBS'] || null,
      ra: headers.RA || headers.OBJCTRA || null,
      dec: headers.DEC || headers.OBJCTDEC || null
   };
}

// ---------------------------------------------------------------------------
// Frame object
// ---------------------------------------------------------------------------

function buildFrame(filePath, headers) {
   const settings = extractSettings(headers);
   return {
      filePath,
      fileName: path.basename(filePath),
      type: classifyType(headers, filePath),
      filter: classifyFilter(headers),
      target: classifyTarget(headers),
      ...settings,
      headers
   };
}

// ---------------------------------------------------------------------------
// Directory scanner
// ---------------------------------------------------------------------------

function findImageFiles(dir) {
   const results = [];
   const allExtensions = new Set([...FITS_EXTENSIONS, ...XISF_EXTENSIONS]);

   function walk(currentDir) {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
         const fullPath = path.join(currentDir, entry.name);
         if (entry.isDirectory()) {
            walk(fullPath);
         } else if (allExtensions.has(path.extname(entry.name).toLowerCase())) {
            results.push(fullPath);
         }
      }
   }

   walk(dir);
   return results.sort();
}

function scanDirectory(dir) {
   if (!fs.existsSync(dir)) {
      throw new Error('Directory not found: ' + dir);
   }

   const files = findImageFiles(dir);
   const frames = [];

   for (const filePath of files) {
      try {
         const headers = readHeaders(filePath);
         if (headers) {
            frames.push(buildFrame(filePath, headers));
         }
      } catch (e) {
         // Skip files we can't parse, but note them
         frames.push({
            filePath,
            fileName: path.basename(filePath),
            type: 'unknown',
            error: e.message
         });
      }
   }

   return new Session(dir, frames);
}

// ---------------------------------------------------------------------------
// Session — holds classified frames and provides grouping/summary
// ---------------------------------------------------------------------------

class Session {
   constructor(dir, frames) {
      this.dir = dir;
      this.frames = frames;
   }

   byType() {
      const groups = {};
      for (const f of this.frames) {
         if (!groups[f.type]) groups[f.type] = [];
         groups[f.type].push(f);
      }
      return groups;
   }

   byFilter() {
      const groups = {};
      for (const f of this.frames) {
         if (f.type !== 'light') continue;
         const key = f.filter || 'none';
         if (!groups[key]) groups[key] = [];
         groups[key].push(f);
      }
      return groups;
   }

   byTarget() {
      const groups = {};
      for (const f of this.frames) {
         if (f.type !== 'light') continue;
         const key = f.target || 'Unknown';
         if (!groups[key]) groups[key] = [];
         groups[key].push(f);
      }
      return groups;
   }

   lights() { return this.frames.filter(f => f.type === 'light'); }
   darks() { return this.frames.filter(f => f.type === 'dark'); }
   flats() { return this.frames.filter(f => f.type === 'flat'); }
   biases() { return this.frames.filter(f => f.type === 'bias'); }
   flatDarks() { return this.frames.filter(f => f.type === 'flatdark'); }

   totalExposure() {
      return this.lights().reduce((sum, f) => sum + (f.exposure || 0), 0);
   }

   summary() {
      const byType = this.byType();
      const lines = [];

      lines.push('Session: ' + this.dir);
      lines.push('Total files: ' + this.frames.length);
      lines.push('');

      // Frame counts by type
      lines.push('Frame counts:');
      for (const type of ['light', 'dark', 'flat', 'bias', 'flatdark', 'unknown']) {
         const count = (byType[type] || []).length;
         if (count > 0) lines.push('  ' + type + ': ' + count);
      }

      // Lights breakdown
      const lights = this.lights();
      if (lights.length > 0) {
         lines.push('');
         lines.push('Lights:');

         // By target
         const byTarget = this.byTarget();
         for (const [target, tFrames] of Object.entries(byTarget)) {
            const totalSec = tFrames.reduce((s, f) => s + (f.exposure || 0), 0);
            lines.push('  ' + target + ': ' + tFrames.length + ' frames, ' + formatTime(totalSec));
         }

         // By filter
         const byFilter = this.byFilter();
         if (Object.keys(byFilter).length > 1 || !byFilter['none']) {
            lines.push('');
            lines.push('  Filters:');
            for (const [filter, fFrames] of Object.entries(byFilter)) {
               const totalSec = fFrames.reduce((s, f) => s + (f.exposure || 0), 0);
               lines.push('    ' + filter + ': ' + fFrames.length + ' frames, ' + formatTime(totalSec));
            }
         }

         // Equipment
         const cameras = unique(lights.map(f => f.camera).filter(Boolean));
         const telescopes = unique(lights.map(f => f.telescope).filter(Boolean));
         const exposures = unique(lights.map(f => f.exposure).filter(Boolean));
         const gains = unique(lights.map(f => f.gain).filter(x => x != null));
         const temps = lights.map(f => f.temperature).filter(x => x != null);

         if (cameras.length || telescopes.length) {
            lines.push('');
            lines.push('  Equipment:');
            if (cameras.length) lines.push('    Camera: ' + cameras.join(', '));
            if (telescopes.length) lines.push('    Telescope: ' + telescopes.join(', '));
         }

         if (exposures.length || gains.length || temps.length) {
            lines.push('');
            lines.push('  Settings:');
            if (exposures.length) lines.push('    Exposure: ' + exposures.map(e => e + 's').join(', '));
            if (gains.length) lines.push('    Gain: ' + gains.join(', '));
            if (temps.length) {
               const avg = temps.reduce((a, b) => a + b, 0) / temps.length;
               lines.push('    Sensor temp: ' + avg.toFixed(1) + 'C (avg)');
            }
         }
      }

      // Calibration match check
      const darks = this.darks();
      const flats = this.flats();
      const biases = this.biases();

      if (lights.length > 0) {
         lines.push('');
         lines.push('Calibration:');
         lines.push('  Darks: ' + (darks.length > 0 ? darks.length + ' frames' : 'MISSING'));
         lines.push('  Flats: ' + (flats.length > 0 ? flats.length + ' frames' : 'MISSING'));
         lines.push('  Bias/Offset: ' + (biases.length > 0 ? biases.length + ' frames' : 'not found (may use flat-darks or synthetic)'));

         // Check exposure match between lights and darks
         if (darks.length > 0) {
            const lightExps = unique(lights.map(f => f.exposure).filter(Boolean));
            const darkExps = unique(darks.map(f => f.exposure).filter(Boolean));
            const matched = lightExps.filter(e => darkExps.includes(e));
            if (matched.length < lightExps.length) {
               const unmatched = lightExps.filter(e => !darkExps.includes(e));
               lines.push('  WARNING: No matching darks for exposure(s): ' + unmatched.map(e => e + 's').join(', '));
            }
         }

         // Check filter match between lights and flats
         if (flats.length > 0) {
            const lightFilters = unique(lights.map(f => f.filter).filter(Boolean));
            const flatFilters = unique(flats.map(f => f.filter).filter(Boolean));
            if (lightFilters.length > 0) {
               const unmatched = lightFilters.filter(f => !flatFilters.includes(f));
               if (unmatched.length > 0) {
                  lines.push('  WARNING: No matching flats for filter(s): ' + unmatched.join(', '));
               }
            }
         }
      }

      return lines.join('\n');
   }

   toJSON() {
      return {
         dir: this.dir,
         totalFiles: this.frames.length,
         byType: countKeys(this.byType()),
         totalExposure: this.totalExposure(),
         targets: Object.keys(this.byTarget()),
         filters: Object.keys(this.byFilter()),
         frames: this.frames.map(f => ({
            fileName: f.fileName,
            type: f.type,
            filter: f.filter,
            target: f.target,
            exposure: f.exposure,
            gain: f.gain,
            temperature: f.temperature,
            camera: f.camera,
            dateObs: f.dateObs
         }))
      };
   }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unique(arr) {
   return [...new Set(arr)];
}

function countKeys(groups) {
   const counts = {};
   for (const [key, val] of Object.entries(groups)) {
      counts[key] = val.length;
   }
   return counts;
}

function formatTime(seconds) {
   if (seconds < 60) return seconds + 's';
   if (seconds < 3600) return (seconds / 60).toFixed(1) + 'm';
   const h = Math.floor(seconds / 3600);
   const m = Math.round((seconds % 3600) / 60);
   return h + 'h ' + m + 'm';
}

module.exports = { scanDirectory, readHeaders, Session };

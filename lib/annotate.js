// AstroPilot — Image Annotation & Metadata
// ============================================
// Adds watermarks, info panels, and FITS metadata to processed images.
//
// Usage:
//   const { annotateImage } = require('./annotate');
//   await annotateImage('MyImage', {
//     watermark: { text: 'Allen McAfee', position: 'bottom-right' },
//     infoPanel: { targetName: 'M42', integration: '4h 0m', ... },
//     metadata: { author: 'Allen McAfee', ... }
//   });

const bridge = require('../bridge/client');
const crypto = require('crypto');

function log(msg) {
   console.log('[AstroPilot] ' + msg);
}

// ---------------------------------------------------------------------------
// Watermark
// ---------------------------------------------------------------------------

async function addWatermark(targetId, options) {
   const opts = Object.assign({
      text: '',
      position: 'bottom-right',
      fontSize: null,
      opacity: 0.5,
      bold: true,
      italic: false
   }, options || {});

   if (!opts.text) return null;

   log('Adding watermark: "' + opts.text + '"');

   const result = await bridge.sendCommand('watermark', {
      target: targetId,
      text: opts.text,
      position: opts.position,
      fontSize: opts.fontSize,
      opacity: opts.opacity,
      bold: opts.bold,
      italic: opts.italic
   });

   return result;
}

// ---------------------------------------------------------------------------
// Info panel
// ---------------------------------------------------------------------------

async function addInfoPanel(targetId, options) {
   const opts = Object.assign({
      targetName: null,
      designations: null,
      constellation: null,
      integration: null,
      equipment: null,
      date: null,
      location: null,
      bortle: null,
      processing: null,
      fontSize: null,
      panelHeight: null
   }, options || {});

   // Need at least something to show
   const hasContent = opts.targetName || opts.integration || opts.equipment || opts.date;
   if (!hasContent) return null;

   log('Adding info panel');

   const result = await bridge.sendCommand('info_panel', {
      target: targetId,
      targetName: opts.targetName,
      designations: opts.designations,
      constellation: opts.constellation,
      integration: opts.integration,
      equipment: opts.equipment,
      date: opts.date,
      location: opts.location,
      bortle: opts.bortle,
      processing: opts.processing,
      fontSize: opts.fontSize,
      panelHeight: opts.panelHeight
   });

   return result;
}

// ---------------------------------------------------------------------------
// Metadata embedding
// ---------------------------------------------------------------------------

async function embedMetadata(targetId, options) {
   const opts = Object.assign({
      object: null,
      ra: null,
      dec: null,
      dateObs: null,
      telescope: null,
      camera: null,
      filter: null,
      totalExposure: null,
      frameCount: null,
      author: null,
      location: null,
      processingSteps: []
   }, options || {});

   const keywords = {};

   if (opts.object) keywords.OBJECT = { value: opts.object, comment: 'Target name' };
   if (opts.ra) keywords.RA = { value: String(opts.ra), comment: 'Right ascension (hours)' };
   if (opts.dec) keywords.DEC = { value: String(opts.dec), comment: 'Declination (degrees)' };
   if (opts.dateObs) keywords['DATE-OBS'] = { value: opts.dateObs, comment: 'Observation date' };
   if (opts.telescope) keywords.TELESCOP = { value: opts.telescope, comment: 'Telescope' };
   if (opts.camera) keywords.INSTRUME = { value: opts.camera, comment: 'Camera' };
   if (opts.filter) keywords.FILTER = { value: opts.filter, comment: 'Filter(s) used' };
   if (opts.totalExposure) keywords.EXPTIME = { value: String(opts.totalExposure), comment: 'Total integration (seconds)' };
   if (opts.frameCount) keywords.NFRAMES = { value: String(opts.frameCount), comment: 'Number of frames stacked' };
   if (opts.author) keywords.AUTHOR = { value: opts.author, comment: 'Photographer' };
   if (opts.location) keywords.SITELAT = { value: opts.location, comment: 'Observation location' };

   // AstroPilot metadata
   keywords.SOFTWARE = { value: 'AstroPilot', comment: 'Processing software' };

   // Processing hash for reproducibility
   if (opts.processingSteps.length > 0) {
      const hash = crypto.createHash('sha256')
         .update(JSON.stringify(opts.processingSteps))
         .digest('hex')
         .substring(0, 12);
      keywords.PROCHASH = { value: hash, comment: 'Processing reproducibility hash' };
   }

   if (Object.keys(keywords).length === 0) return null;

   log('Embedding ' + Object.keys(keywords).length + ' metadata keywords');

   const result = await bridge.sendCommand('embed_metadata', {
      target: targetId,
      keywords: keywords
   });

   return result;
}

// ---------------------------------------------------------------------------
// Build info from classification and session data
// ---------------------------------------------------------------------------

function buildAnnotationData(classification, session, options) {
   const opts = options || {};
   const data = {};

   // Watermark
   if (opts.author) {
      const datePart = opts.date || new Date().toISOString().split('T')[0];
      data.watermark = {
         text: opts.author + (opts.showDate !== false ? '  ' + datePart : ''),
         position: opts.watermarkPosition || 'bottom-right',
         opacity: opts.watermarkOpacity || 0.5
      };
   }

   // Info panel
   const panel = {};
   if (classification && classification.target) {
      const t = classification.target;
      panel.targetName = t.name;
      if (t.aliases && t.aliases.length > 0) {
         panel.designations = t.aliases.slice(0, 3).join('  /  ');
      }
   }

   if (session) {
      const lights = session.lights ? session.lights() : [];
      if (lights.length > 0) {
         const totalSec = lights.reduce((s, f) => s + (f.exposure || 0), 0);
         panel.integration = formatTime(totalSec);

         const cameras = [...new Set(lights.map(f => f.camera).filter(Boolean))];
         const telescopes = [...new Set(lights.map(f => f.telescope).filter(Boolean))];
         const parts = [];
         if (telescopes.length) parts.push(telescopes[0]);
         if (cameras.length) parts.push(cameras[0]);
         if (parts.length) panel.equipment = parts.join('  +  ');

         if (lights[0].dateObs) {
            panel.date = String(lights[0].dateObs).split('T')[0];
         }
      }
   }

   if (opts.location) panel.location = opts.location;
   if (opts.bortle) panel.bortle = String(opts.bortle);
   panel.processing = 'Processed with AstroPilot';

   data.infoPanel = panel;

   // Metadata
   const meta = {};
   if (classification && classification.target) {
      meta.object = classification.target.name;
      if (classification.target.ra) meta.ra = classification.target.ra;
      if (classification.target.dec) meta.dec = classification.target.dec;
   }
   if (session) {
      const lights = session.lights ? session.lights() : [];
      if (lights.length > 0) {
         meta.totalExposure = lights.reduce((s, f) => s + (f.exposure || 0), 0);
         meta.frameCount = lights.length;
         if (lights[0].camera) meta.camera = lights[0].camera;
         if (lights[0].telescope) meta.telescope = lights[0].telescope;
         if (lights[0].dateObs) meta.dateObs = lights[0].dateObs;
         const filters = [...new Set(lights.map(f => f.filter).filter(Boolean))];
         if (filters.length) meta.filter = filters.join('+');
      }
   }
   if (opts.author) meta.author = opts.author;
   if (opts.location) meta.location = opts.location;

   data.metadata = meta;

   return data;
}

// ---------------------------------------------------------------------------
// Main annotation function
// ---------------------------------------------------------------------------

async function annotateImage(targetId, options) {
   const opts = options || {};
   const report = { target: targetId, steps: [] };

   // 1. Embed metadata first (before any visual changes)
   if (opts.metadata) {
      const metaResult = await embedMetadata(targetId, opts.metadata);
      if (metaResult) {
         report.steps.push({ step: 'metadata', keywords: metaResult.keywordsSet });
         log('Embedded ' + metaResult.keywordsSet + ' keywords');
      }
   }

   // 2. Watermark
   if (opts.watermark && opts.watermark.text) {
      const wmResult = await addWatermark(targetId, opts.watermark);
      if (wmResult) {
         report.steps.push({ step: 'watermark', text: wmResult.text, position: wmResult.position });
      }
   }

   // 3. Info panel (creates a new window)
   let finalTargetId = targetId;
   if (opts.infoPanel) {
      const panelResult = await addInfoPanel(targetId, opts.infoPanel);
      if (panelResult) {
         finalTargetId = panelResult.annotatedTarget;
         report.steps.push({ step: 'info_panel', newWindow: finalTargetId, lines: panelResult.linesDrawn });

         // Embed metadata on the annotated version too
         if (opts.metadata) {
            await embedMetadata(finalTargetId, opts.metadata);
         }
      }
   }

   report.finalTargetId = finalTargetId;
   log('Annotation complete. Final image: ' + finalTargetId);

   return report;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(seconds) {
   if (seconds < 60) return seconds + 's';
   if (seconds < 3600) return (seconds / 60).toFixed(1) + ' min';
   const h = Math.floor(seconds / 3600);
   const m = Math.round((seconds % 3600) / 60);
   return h + 'h ' + m + 'm';
}

module.exports = {
   annotateImage,
   addWatermark,
   addInfoPanel,
   embedMetadata,
   buildAnnotationData
};

// AstroPilot — Target Classifier
// ==================================
// Identifies the target from FITS keywords, catalog lookup, or plate
// solving, then selects the appropriate processing profile.
//
// Usage:
//   const { classifyTarget } = require('./target-classifier');
//   const result = await classifyTarget('MyImage');
//   console.log(result.target);   // { name: 'M42', type: 'emission_nebula', ... }
//   console.log(result.profile);  // { stretch: 'ghs', ... }

const bridge = require('../bridge/client');
const { lookupByName, lookupByCoordinates, parseRA, parseDEC, TYPES } = require('./catalog');
const { getProfile, selectCombination } = require('./profiles');

function log(msg) {
   console.log('[AstroPilot] ' + msg);
}

// ---------------------------------------------------------------------------
// Identify from FITS keywords
// ---------------------------------------------------------------------------

function identifyFromKeywords(keywords) {
   // Try OBJECT keyword first
   for (const kw of keywords) {
      if (kw.name === 'OBJECT' && kw.value) {
         const match = lookupByName(kw.value.trim());
         if (match) {
            return {
               method: 'OBJECT keyword',
               objectName: kw.value.trim(),
               catalogEntry: match
            };
         }
         // Even if not in catalog, return the name
         return {
            method: 'OBJECT keyword (not in catalog)',
            objectName: kw.value.trim(),
            catalogEntry: null
         };
      }
   }

   // Try RA/DEC
   let ra = null, dec = null;
   for (const kw of keywords) {
      if (kw.name === 'RA' || kw.name === 'OBJCTRA') ra = kw.value;
      if (kw.name === 'DEC' || kw.name === 'OBJCTDEC') dec = kw.value;
   }

   if (ra !== null && dec !== null) {
      const raH = parseRA(ra);
      const decD = parseDEC(dec);
      if (!isNaN(raH) && !isNaN(decD)) {
         const match = lookupByCoordinates(raH, decD, 2.0);
         if (match) {
            return {
               method: 'RA/DEC coordinate match (' + match.distance.toFixed(2) + ' deg)',
               objectName: match.entry.names[0],
               catalogEntry: match.entry,
               coordinates: { ra: raH, dec: decD }
            };
         }
         return {
            method: 'RA/DEC (no catalog match)',
            objectName: null,
            catalogEntry: null,
            coordinates: { ra: raH, dec: decD }
         };
      }
   }

   return null;
}

// ---------------------------------------------------------------------------
// Plate solving through the bridge
// ---------------------------------------------------------------------------

async function plateSolve(targetId) {
   try {
      const result = await bridge.runScript(
         'var w = ImageWindow.windowById("' + targetId + '");' +
         'if (w.isNull) throw new Error("Window not found");' +
         'var IS = new ImageSolver;' +
         'IS.executeOn(w.mainView);' +
         'var kw = w.keywords;' +
         'var ra = null, dec = null;' +
         'for (var i = 0; i < kw.length; i++) {' +
         '  if (kw[i].name === "OBJCTRA") ra = kw[i].value;' +
         '  if (kw[i].name === "OBJCTDEC") dec = kw[i].value;' +
         '}' +
         '__result = { ra: ra, dec: dec };'
      );

      if (result.result && result.result.ra && result.result.dec) {
         const raH = parseRA(result.result.ra);
         const decD = parseDEC(result.result.dec);
         return { ra: raH, dec: decD };
      }
   } catch (e) {
      log('Plate solving failed: ' + e.message);
   }
   return null;
}

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

async function classifyTarget(targetId, options) {
   const opts = Object.assign({
      plateSolve: true,
      availableFilters: []
   }, options || {});

   log('Classifying target: ' + targetId);

   // Step 1: Get image stats and keywords
   const stats = await bridge.getImageStatistics(targetId);
   const keywords = stats.keywords || [];

   // Step 2: Try to identify from keywords
   let identification = identifyFromKeywords(keywords);

   // Step 3: Plate solve if we couldn't identify
   if (!identification && opts.plateSolve) {
      log('No target identified from keywords, attempting plate solve...');
      const coords = await plateSolve(targetId);
      if (coords) {
         const match = lookupByCoordinates(coords.ra, coords.dec, 2.0);
         if (match) {
            identification = {
               method: 'Plate solve + coordinate match (' + match.distance.toFixed(2) + ' deg)',
               objectName: match.entry.names[0],
               catalogEntry: match.entry,
               coordinates: coords
            };
         } else {
            identification = {
               method: 'Plate solve (no catalog match)',
               objectName: null,
               catalogEntry: null,
               coordinates: coords
            };
         }
      }
   }

   // Step 4: Build result
   const result = {
      targetId: targetId,
      imageSize: { width: stats.width, height: stats.height, channels: stats.numberOfChannels }
   };

   if (identification) {
      result.identification = identification;
      result.objectName = identification.objectName;
      result.method = identification.method;

      if (identification.catalogEntry) {
         const entry = identification.catalogEntry;
         result.target = {
            name: entry.names[0],
            aliases: entry.names.slice(1),
            type: entry.type,
            ra: entry.ra,
            dec: entry.dec,
            size: entry.size,
            notes: entry.notes
         };
      } else {
         // Known name but not in our catalog — default to mixed field
         result.target = {
            name: identification.objectName || 'Unknown',
            type: TYPES.MIXED_FIELD
         };
      }
   } else {
      log('Could not identify target — using generic profile');
      result.target = {
         name: 'Unknown',
         type: TYPES.MIXED_FIELD
      };
      result.method = 'unidentified';
   }

   // Step 5: Select processing profile
   const profile = getProfile(result.target.type);
   result.profile = Object.assign({}, profile);

   // Adjust combination strategy based on available filters
   if (opts.availableFilters.length > 0) {
      result.profile.combination = selectCombination(profile, opts.availableFilters);
   }

   log('Target: ' + result.target.name + ' (' + result.target.type + ')');
   log('Profile: ' + result.profile.name);
   log('Stretch: ' + result.profile.stretch);
   log('Combination: ' + result.profile.combination);
   if (result.profile.focus) {
      result.profile.focus.forEach(function(f) { log('  - ' + f); });
   }

   return result;
}

// ---------------------------------------------------------------------------
// Classify from a Session (pre-stacking)
// ---------------------------------------------------------------------------

function classifyFromSession(session) {
   const lights = session.lights();
   if (lights.length === 0) return null;

   // Get target from the first light frame
   const targetName = lights[0].target;
   const entry = targetName ? lookupByName(targetName) : null;

   const filters = [...new Set(lights.map(f => f.filter).filter(Boolean))];

   const result = {
      objectName: targetName,
      method: entry ? 'OBJECT keyword' : 'unidentified'
   };

   if (entry) {
      result.target = {
         name: entry.names[0],
         aliases: entry.names.slice(1),
         type: entry.type,
         ra: entry.ra,
         dec: entry.dec,
         size: entry.size,
         notes: entry.notes
      };
   } else {
      result.target = {
         name: targetName || 'Unknown',
         type: TYPES.MIXED_FIELD
      };
   }

   const profile = getProfile(result.target.type);
   result.profile = Object.assign({}, profile);

   if (filters.length > 0) {
      result.profile.combination = selectCombination(profile, filters);
      result.availableFilters = filters;
   }

   return result;
}

module.exports = { classifyTarget, classifyFromSession };

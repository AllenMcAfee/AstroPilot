// AstroPilot — Processing Profiles
// ====================================
// Maps target types to processing strategies. Each profile defines
// which stretch to use, how aggressive to be with NR, how to handle
// stars, what color processing to apply, and what channel combination
// strategy to follow.
//
// These are opinionated defaults based on what works well for each
// target type. Every value can be overridden per-session.

const { TYPES } = require('./catalog');

// ---------------------------------------------------------------------------
// Stretch algorithms
// ---------------------------------------------------------------------------

const STRETCH = {
   STATISTICAL: 'statistical',   // Seti Statistical Stretch — good for galaxies
   GHS:         'ghs',           // Generalized Hyperbolic Stretch — good for nebulae
   ARCSINH:     'arcsinh',       // Arcsinh Stretch — preserves star colors
   AUTO_STF:    'auto_stf'       // ScreenTransferFunction auto-stretch — safe fallback
};

// ---------------------------------------------------------------------------
// Channel combination strategies
// ---------------------------------------------------------------------------

const COMBINATION = {
   RGB:    'RGB',       // Broadband RGB
   LRGB:   'LRGB',      // Luminance + RGB
   HA_RGB: 'HaRGB',     // Ha blended into RGB
   SHO:    'SHO',        // Hubble palette (SII=R, Ha=G, OIII=B)
   HOO:    'HOO',        // Ha=R, OIII=G, OIII=B
   HA_LRGB: 'HaLRGB'    // Ha + Luminance + RGB
};

// ---------------------------------------------------------------------------
// Profile definitions
// ---------------------------------------------------------------------------

const PROFILES = {};

PROFILES[TYPES.SPIRAL_GALAXY] = {
   name: 'Spiral Galaxy',
   stretch: STRETCH.STATISTICAL,
   combination: COMBINATION.LRGB,
   processing: {
      lheRadius: 64,
      lheSlopeLimit: 1.5,
      lheAmount: 0.35,
      saturationBoost: true,
      saturationStrength: 'moderate',
      sCurve: true,
      sCurveStrength: 'gentle',
      noiseReduction: { sigmaL: 2.0, sigmaC: 3.0, amountL: 0.8 },
      starReduction: { iterations: 2, amount: 0.65 },
      dehalo: { sigma: 150, amount: 0.12 }
   },
   focus: [
      'Bring out dust lanes with local contrast',
      'Preserve spiral arm Ha regions',
      'Keep core from blowing out (HDRMT if needed)',
      'Subtle IFN enhancement if present'
   ]
};

PROFILES[TYPES.EDGE_ON_GALAXY] = {
   name: 'Edge-on Galaxy',
   stretch: STRETCH.STATISTICAL,
   combination: COMBINATION.LRGB,
   processing: {
      lheRadius: 48,
      lheSlopeLimit: 2.0,
      lheAmount: 0.40,
      saturationBoost: true,
      saturationStrength: 'moderate',
      sCurve: true,
      sCurveStrength: 'moderate',
      noiseReduction: { sigmaL: 2.0, sigmaC: 3.0, amountL: 0.85 },
      starReduction: { iterations: 2, amount: 0.70 },
      dehalo: { sigma: 120, amount: 0.15 }
   },
   focus: [
      'Maximize dust lane contrast',
      'Extend faint outer halo',
      'Dark structure enhancement'
   ]
};

PROFILES[TYPES.ELLIPTICAL_GALAXY] = {
   name: 'Elliptical Galaxy',
   stretch: STRETCH.STATISTICAL,
   combination: COMBINATION.LRGB,
   processing: {
      lheRadius: 80,
      lheSlopeLimit: 1.2,
      lheAmount: 0.25,
      saturationBoost: true,
      saturationStrength: 'gentle',
      sCurve: true,
      sCurveStrength: 'gentle',
      noiseReduction: { sigmaL: 2.5, sigmaC: 3.5, amountL: 0.9 },
      starReduction: { iterations: 1, amount: 0.50 },
      dehalo: { sigma: 200, amount: 0.10 }
   },
   focus: [
      'Preserve smooth luminosity gradient',
      'Reveal outer halo and shells',
      'Keep globular cluster system visible'
   ]
};

PROFILES[TYPES.GALAXY_CLUSTER] = {
   name: 'Galaxy Cluster',
   stretch: STRETCH.STATISTICAL,
   combination: COMBINATION.LRGB,
   processing: {
      lheRadius: 48,
      lheSlopeLimit: 1.5,
      lheAmount: 0.30,
      saturationBoost: true,
      saturationStrength: 'moderate',
      sCurve: true,
      sCurveStrength: 'moderate',
      noiseReduction: { sigmaL: 2.0, sigmaC: 3.0, amountL: 0.85 },
      starReduction: { iterations: 2, amount: 0.65 },
      dehalo: { sigma: 150, amount: 0.12 }
   },
   focus: [
      'Show color diversity between galaxies',
      'Keep background uniform',
      'Preserve tiny galaxy detail'
   ]
};

PROFILES[TYPES.EMISSION_NEBULA] = {
   name: 'Emission Nebula',
   stretch: STRETCH.GHS,
   combination: COMBINATION.HA_RGB,
   processing: {
      lheRadius: 100,
      lheSlopeLimit: 2.0,
      lheAmount: 0.45,
      saturationBoost: true,
      saturationStrength: 'strong',
      sCurve: true,
      sCurveStrength: 'moderate',
      noiseReduction: { sigmaL: 1.5, sigmaC: 2.5, amountL: 0.75 },
      starReduction: { iterations: 3, amount: 0.80 },
      dehalo: { sigma: 100, amount: 0.18 }
   },
   focus: [
      'Ha-dominant processing, blend into red/luminance',
      'Bring out filamentary detail',
      'Multi-zone enhancement (bright core vs faint edges)',
      'Aggressive star reduction to reveal nebulosity'
   ]
};

PROFILES[TYPES.PLANETARY_NEBULA] = {
   name: 'Planetary Nebula',
   stretch: STRETCH.GHS,
   combination: COMBINATION.RGB,
   processing: {
      lheRadius: 32,
      lheSlopeLimit: 2.5,
      lheAmount: 0.50,
      saturationBoost: true,
      saturationStrength: 'strong',
      sCurve: true,
      sCurveStrength: 'strong',
      noiseReduction: { sigmaL: 1.5, sigmaC: 2.0, amountL: 0.70 },
      starReduction: { iterations: 1, amount: 0.50 },
      dehalo: { sigma: 80, amount: 0.15 }
   },
   focus: [
      'Reveal shell structure and inner detail',
      'Ha/OIII color separation',
      'Central star visibility',
      'Faint outer halo'
   ]
};

PROFILES[TYPES.REFLECTION_NEBULA] = {
   name: 'Reflection Nebula',
   stretch: STRETCH.GHS,
   combination: COMBINATION.RGB,
   processing: {
      lheRadius: 80,
      lheSlopeLimit: 1.3,
      lheAmount: 0.30,
      saturationBoost: true,
      saturationStrength: 'gentle',
      sCurve: true,
      sCurveStrength: 'gentle',
      noiseReduction: { sigmaL: 2.5, sigmaC: 3.5, amountL: 0.9 },
      starReduction: { iterations: 1, amount: 0.50 },
      dehalo: { sigma: 200, amount: 0.10 }
   },
   focus: [
      'Preserve blue scattered light color',
      'Gentle processing to avoid artifacts in subtle gradients',
      'Surrounding dust cloud context'
   ]
};

PROFILES[TYPES.DARK_NEBULA] = {
   name: 'Dark Nebula',
   stretch: STRETCH.GHS,
   combination: COMBINATION.RGB,
   processing: {
      lheRadius: 64,
      lheSlopeLimit: 1.8,
      lheAmount: 0.40,
      saturationBoost: true,
      saturationStrength: 'moderate',
      sCurve: true,
      sCurveStrength: 'moderate',
      noiseReduction: { sigmaL: 2.0, sigmaC: 3.0, amountL: 0.85 },
      starReduction: { iterations: 2, amount: 0.65 },
      dehalo: { sigma: 150, amount: 0.12 }
   },
   focus: [
      'Maximize contrast of dark cloud against background',
      'Keep surrounding emission/star field natural',
      'Dark structure enhancement'
   ]
};

PROFILES[TYPES.SUPERNOVA_REMNANT] = {
   name: 'Supernova Remnant',
   stretch: STRETCH.GHS,
   combination: COMBINATION.HOO,
   processing: {
      lheRadius: 80,
      lheSlopeLimit: 2.5,
      lheAmount: 0.50,
      saturationBoost: true,
      saturationStrength: 'strong',
      sCurve: true,
      sCurveStrength: 'moderate',
      noiseReduction: { sigmaL: 1.5, sigmaC: 2.0, amountL: 0.70 },
      starReduction: { iterations: 3, amount: 0.85 },
      dehalo: { sigma: 100, amount: 0.15 }
   },
   focus: [
      'Filamentary detail is everything',
      'Ha/OIII color separation',
      'Heavy star reduction to clear the view',
      'Gentle NR to preserve faint filaments'
   ]
};

PROFILES[TYPES.GLOBULAR_CLUSTER] = {
   name: 'Globular Cluster',
   stretch: STRETCH.ARCSINH,
   combination: COMBINATION.LRGB,
   processing: {
      lheRadius: 32,
      lheSlopeLimit: 1.5,
      lheAmount: 0.30,
      saturationBoost: true,
      saturationStrength: 'moderate',
      sCurve: true,
      sCurveStrength: 'gentle',
      noiseReduction: { sigmaL: 2.0, sigmaC: 2.5, amountL: 0.80 },
      starReduction: { iterations: 0, amount: 0 },
      dehalo: { sigma: 150, amount: 0.10 }
   },
   focus: [
      'Resolve individual stars in the core',
      'Preserve star colors (red giants vs blue)',
      'No star reduction — stars are the subject',
      'HDRMT for core vs outskirts'
   ]
};

PROFILES[TYPES.OPEN_CLUSTER] = {
   name: 'Open Cluster',
   stretch: STRETCH.ARCSINH,
   combination: COMBINATION.RGB,
   processing: {
      lheRadius: 48,
      lheSlopeLimit: 1.2,
      lheAmount: 0.20,
      saturationBoost: true,
      saturationStrength: 'moderate',
      sCurve: true,
      sCurveStrength: 'gentle',
      noiseReduction: { sigmaL: 2.0, sigmaC: 3.0, amountL: 0.85 },
      starReduction: { iterations: 0, amount: 0 },
      dehalo: { sigma: 200, amount: 0.08 }
   },
   focus: [
      'Star color diversity is the main attraction',
      'Preserve field context',
      'No star reduction',
      'Arcsinh stretch for natural star colors'
   ]
};

PROFILES[TYPES.MIXED_FIELD] = {
   name: 'Mixed Field',
   stretch: STRETCH.GHS,
   combination: COMBINATION.RGB,
   processing: {
      lheRadius: 64,
      lheSlopeLimit: 1.5,
      lheAmount: 0.35,
      saturationBoost: true,
      saturationStrength: 'moderate',
      sCurve: true,
      sCurveStrength: 'moderate',
      noiseReduction: { sigmaL: 2.0, sigmaC: 3.0, amountL: 0.85 },
      starReduction: { iterations: 1, amount: 0.50 },
      dehalo: { sigma: 150, amount: 0.12 }
   },
   focus: [
      'Balance competing elements',
      'Conservative processing to avoid artifacts'
   ]
};

// ---------------------------------------------------------------------------
// Profile selection
// ---------------------------------------------------------------------------

function getProfile(targetType) {
   return PROFILES[targetType] || PROFILES[TYPES.MIXED_FIELD];
}

// Adjust combination strategy based on available filters
function selectCombination(profile, availableFilters) {
   const filters = new Set(availableFilters.map(f => f ? f.toUpperCase() : null));
   const has = f => filters.has(f);

   // If we have narrowband, prefer narrowband combinations
   if (has('HA') && has('OIII') && has('SII')) return COMBINATION.SHO;
   if (has('HA') && has('OIII')) return COMBINATION.HOO;

   // If we have Ha + broadband
   if (has('HA') && has('L')) return COMBINATION.HA_LRGB;
   if (has('HA') && (has('R') || has('G') || has('B'))) return COMBINATION.HA_RGB;

   // Broadband
   if (has('L') && (has('R') || has('G') || has('B'))) return COMBINATION.LRGB;
   if (has('R') || has('G') || has('B')) return COMBINATION.RGB;

   // Mono or OSC — just use what the profile says
   return profile.combination;
}

module.exports = { PROFILES, STRETCH, COMBINATION, getProfile, selectCombination };

// AstroPilot — Processing Report Generator
// ============================================
// Generates HTML, Markdown, and JSON reports documenting every step
// of the processing pipeline. Designed to teach beginners what
// happened and why, while also serving as a shareable processing log.
//
// Usage:
//   const { generateReport } = require('./report');
//   const report = generateReport(reportData);
//   report.writeAll('/path/to/output');

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Educational content — why each step matters
// ---------------------------------------------------------------------------

const STEP_EXPLANATIONS = {
   // Pre-processing
   calibrate: {
      what: 'Calibration removes systematic camera artifacts from each frame.',
      why: 'Your camera sensor has fixed-pattern noise (hot pixels, amp glow) and uneven illumination from your optical train. Darks remove thermal noise, flats correct vignetting and dust shadows, and bias frames remove the readout noise floor.',
      tip: 'Always shoot darks at the same temperature and exposure as your lights. Flats should be taken without moving the camera.'
   },
   register_frames: {
      what: 'Registration aligns all frames to a common reference so they can be stacked.',
      why: 'Between exposures your mount tracks imperfectly, and the field rotates slightly. Registration detects stars in each frame and computes the geometric transformation needed to align them.',
      tip: 'The frame with the lowest FWHM (sharpest stars) makes the best reference.'
   },
   integrate: {
      what: 'Integration combines all aligned frames into a single image with much higher signal-to-noise ratio.',
      why: 'Signal adds up linearly while noise adds as the square root, so stacking N frames improves SNR by roughly sqrt(N). Pixel rejection algorithms remove satellite trails, cosmic rays, and other transient artifacts.',
      tip: 'More frames is always better. Even mediocre frames contribute signal.'
   },

   // Linear pre-processing
   gradient_removal: {
      what: 'Gradient removal flattens uneven illumination across the background.',
      why: 'Light pollution, moonlight, and optical artifacts create brightness gradients across your image. These must be removed before stretching or they become much harder to fix later.',
      tip: 'If ABE leaves artifacts, try reducing the polynomial degree or switching to DBE with manual sample placement.'
   },
   background_neutralization: {
      what: 'Background neutralization makes the sky background a neutral gray.',
      why: 'Light pollution tints the background with color (usually orange/brown). Neutralizing it ensures your color calibration has a clean reference.',
      tip: 'Pick a background region free of nebulosity or IFN for the best result.'
   },
   color_calibration: {
      what: 'Color calibration adjusts channel weights so star colors match their known spectral types.',
      why: 'Your camera sensor, filters, and atmosphere all affect the relative sensitivity to different wavelengths. Color calibration corrects for this using a catalog of known star colors.',
      tip: 'SPCC uses Gaia spectral data and is more accurate than PCC for most setups.'
   },
   linear_noise_reduction: {
      what: 'Linear noise reduction removes noise while the image is still in its linear state.',
      why: 'Noise reduction is more effective before stretching because the noise is still Gaussian and separable from signal. After stretching, noise gets compressed into the shadows where it is harder to treat without losing faint detail.',
      tip: 'Be conservative here — you can always do more NR later, but you cannot recover detail that was smoothed away.'
   },
   deconvolution: {
      what: 'Deconvolution sharpens the image by reversing the blurring effect of the atmosphere and optics.',
      why: 'Every telescope and atmosphere combination has a point spread function (PSF) that smears point sources into discs. Deconvolution mathematically reverses this, recovering detail hidden by the blur.',
      tip: 'BlurXTerminator automates PSF estimation. Without it, classic deconvolution needs careful PSF measurement and deringing protection.'
   },

   // Stretching
   stretch: {
      what: 'Stretching transforms the linear data into a visible image by expanding the faint signal.',
      why: 'Your camera captures data linearly — most of the interesting detail lives in the bottom 1-5% of the dynamic range and looks black to your eye. Stretching is a nonlinear transformation that brings out faint detail while preserving bright structures.',
      tip: 'The stretch algorithm matters: statistical stretch works well for galaxies, GHS gives more shadow control for nebulae, and arcsinh preserves star colors in cluster fields.'
   },
   star_recombination: {
      what: 'Stars were removed before processing and are now blended back into the starless result.',
      why: 'Processing nebulae and galaxies is much easier without stars in the way. The screen blend mode adds stars back naturally without affecting the background.',
      tip: 'You can reduce the blend amount below 1.0 to keep stars smaller in the final image.'
   },

   // Detail enhancement
   lhe: {
      what: 'Local Histogram Equalization enhances contrast on a local scale.',
      why: 'Global contrast adjustments cannot simultaneously bring out dust lanes in a galaxy core and faint outer arms. LHE adapts the contrast enhancement to each region independently.',
      tip: 'Smaller radius = finer detail. Larger radius = broader structures. The amount controls how much of the effect is applied.'
   },
   hdrmt: {
      what: 'HDR Multiscale Transform compresses the dynamic range of bright regions.',
      why: 'Galaxy cores and bright nebula regions often blow out when you stretch enough to see faint outer detail. HDRMT selectively compresses the bright end while leaving faint structures alone.',
      tip: 'Use inverted HDRMT to lift extremely faint structures like IFN or outer galaxy halos.'
   },
   dark_structure: {
      what: 'Dark structure enhancement darkens dust lanes and absorption features.',
      why: 'Dust lanes in spiral galaxies and dark nebulae are defined by contrast against the brighter background. This step selectively deepens dark features without affecting the rest of the image.',
      tip: 'Be careful with the amount — too much creates unnatural dark halos around bright regions.'
   },
   sharpen: {
      what: 'Sharpening enhances fine detail by boosting high-frequency spatial information.',
      why: 'Even after deconvolution, some softness remains from the stacking and noise reduction process. A gentle sharpening pass recovers fine structure.',
      tip: 'Always sharpen with a mask to protect smooth areas and background from noise amplification.'
   },

   // Color processing
   ha_blend: {
      what: 'Ha data is blended into the red channel and partially into luminance.',
      why: 'Hydrogen-alpha narrowband captures emission nebulae with much higher contrast than broadband filters. Blending it in reveals nebulosity that is invisible or very faint in the RGB data.',
      tip: 'Soft clamping prevents the Ha regions from blowing out. Start with 30-40% amount and adjust to taste.'
   },
   oiii_blend: {
      what: 'OIII data is blended into the green and blue channels.',
      why: 'Doubly-ionized oxygen emits at 500.7nm (blue-green). Adding OIII data reveals structures in planetary nebulae, supernova remnants, and some emission nebulae that broadband misses.',
      tip: 'OIII is typically blended equally into green and blue for a natural teal color.'
   },
   scnr: {
      what: 'SCNR removes green color cast.',
      why: 'Narrowband blending and certain OSC camera debayering patterns can leave a green tint in the image. SCNR neutralizes it without affecting other colors.',
      tip: 'Average Neutral protection method preserves more color information than Maximum Neutral.'
   },
   saturation: {
      what: 'Selective saturation boosts color intensity in the midtones.',
      why: 'Deep sky objects often appear washed out after stretching. A targeted saturation boost in the midtones brings out nebula colors, spiral arm blues, and star formation region reds without over-saturating bright stars.',
      tip: 'Apply saturation before the S-curve — contrast adjustments can shift perceived color intensity.'
   },

   // Star processing
   star_color_enhance: {
      what: 'Star colors are boosted using a star mask to protect the background.',
      why: 'Stars have real astrophysical colors — red giants, blue supergiants, yellow dwarfs. Enhancing these colors makes the star field more interesting and scientifically meaningful.',
      tip: 'This step only affects pixels under the star mask, so background nebulosity is unaffected.'
   },
   star_reduction: {
      what: 'Stars are shrunk using morphological erosion through a star mask.',
      why: 'Large bloated stars distract from the deep sky object and cover up faint detail. Star reduction makes them more proportional without removing them entirely.',
      tip: 'Skip this for open and globular clusters where stars are the subject.'
   },
   dehalo: {
      what: 'Halo reduction removes diffuse glow around bright stars.',
      why: 'Bright stars create halos from internal reflections in the optical train, atmospheric scattering, and sensor bloom. Subtracting the large-scale glow model cleans these up.',
      tip: 'Higher sigma values target only the broadest halos. Lower sigma catches tighter halos but risks affecting the subject.'
   },

   // Final polish
   s_curve: {
      what: 'An S-curve contrast adjustment deepens shadows and brightens highlights.',
      why: 'The final contrast pass gives the image "pop" — making the subject stand out from the background with a more pleasing tonal distribution.',
      tip: 'Start gentle. Too much S-curve kills shadow detail and blows highlights.'
   },
   color_balance: {
      what: 'Final color balance ensures neutral background and even channel distributions.',
      why: 'Every processing step shifts the channel statistics slightly. A final balance pass corrects any accumulated drift.',
      tip: 'This is the same color balance used throughout — matching channel medians and standard deviations to a reference.'
   },
   dynamic_range_check: {
      what: 'A final check for clipping, black crush, or other dynamic range issues.',
      why: 'Processing can inadvertently clip highlights or crush shadows. Catching this before saving ensures no data is permanently lost.',
      tip: 'If you see clipping, undo the last contrast adjustment and try a gentler curve.'
   }
};

const GLOSSARY = {
   'SNR': 'Signal-to-Noise Ratio. Higher is better. Stacking more frames improves SNR.',
   'FWHM': 'Full Width at Half Maximum. A measure of star size in pixels. Lower means sharper.',
   'Median': 'The middle value when all pixels are sorted. Less affected by outliers than the mean.',
   'Mean': 'The average pixel value. Useful for overall brightness assessment.',
   'StdDev': 'Standard deviation. Measures how spread out pixel values are — higher means more contrast or more noise.',
   'Dynamic Range': 'The span from darkest to brightest pixel. Good images use most of the available range.',
   'Clipping': 'When pixels hit pure white (1.0) or pure black (0.0), detail is permanently lost.',
   'Linear': 'Before stretching. The image is mathematically proportional to the light captured.',
   'Nonlinear': 'After stretching. The relationship between pixel value and light captured is no longer proportional.',
   'PSF': 'Point Spread Function. How a point source (star) is spread by the optics and atmosphere.',
   'Calibration': 'Removing camera artifacts using dark, flat, and bias frames.',
   'Registration': 'Aligning multiple frames so they can be stacked.',
   'Integration': 'Combining aligned frames into one image by averaging with outlier rejection.',
   'Ha': 'Hydrogen-alpha. Emission line at 656nm (deep red). Traces ionized hydrogen in nebulae.',
   'OIII': 'Doubly-ionized oxygen. Emission line at 500.7nm (blue-green). Found in planetary nebulae and SNR.',
   'SII': 'Ionized sulfur. Emission line at 672nm (deep red). Traces shock-heated gas.',
   'ABE': 'Automatic Background Extractor. Fits a polynomial surface to remove gradients.',
   'SPCC': 'Spectrophotometric Color Calibration. Uses Gaia star catalog for accurate color.',
   'PCC': 'Photometric Color Calibration. Uses plate-solved coordinates and star catalogs.',
   'SCNR': 'Subtractive Chromatic Noise Reduction. Removes color cast (usually green).',
   'LHE': 'Local Histogram Equalization. Enhances contrast on a local scale.',
   'HDRMT': 'HDR Multiscale Transform. Compresses dynamic range of bright regions.',
   'STF': 'Screen Transfer Function. PixInsight\'s auto-stretch preview.',
   'GHS': 'Generalized Hyperbolic Stretch. Highly configurable nonlinear stretch.',
   'IFN': 'Integrated Flux Nebulae. Extremely faint galactic cirrus visible in deep images.',
   'OSC': 'One-Shot Color. A camera with a Bayer color filter array (as opposed to monochrome).',
   'SHO': 'Hubble Palette. SII mapped to red, Ha to green, OIII to blue.',
   'HOO': 'Bicolor palette. Ha mapped to red, OIII mapped to green and blue.'
};

// ---------------------------------------------------------------------------
// Report data assembly
// ---------------------------------------------------------------------------

function assembleReportData(options) {
   // Merge all pipeline outputs into a single report structure
   return Object.assign({
      title: 'AstroPilot Processing Report',
      target: { name: 'Unknown' },
      date: new Date().toISOString().split('T')[0],
      acquisition: null,
      classification: null,
      stackingReport: null,
      linearSteps: [],
      creativeSteps: [],
      scores: null,
      gates: null,
      overall: null
   }, options);
}

// ---------------------------------------------------------------------------
// HTML report
// ---------------------------------------------------------------------------

function generateHTML(data) {
   const d = assembleReportData(data);
   const lines = [];

   lines.push('<!DOCTYPE html>');
   lines.push('<html lang="en"><head>');
   lines.push('<meta charset="UTF-8">');
   lines.push('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
   lines.push('<title>' + esc(d.title) + '</title>');
   lines.push('<style>');
   lines.push(CSS);
   lines.push('</style>');
   lines.push('</head><body>');

   // Cover
   lines.push('<header class="cover">');
   lines.push('<h1>' + esc(d.target.name || 'Deep Sky Object') + '</h1>');
   if (d.target.aliases && d.target.aliases.length > 0) {
      lines.push('<p class="aliases">' + d.target.aliases.map(esc).join(' &middot; ') + '</p>');
   }
   lines.push('<p class="meta">' + esc(d.date) + '</p>');
   if (d.target.type) lines.push('<p class="meta">Type: ' + esc(formatType(d.target.type)) + '</p>');
   if (d.target.notes) lines.push('<p class="notes">' + esc(d.target.notes) + '</p>');
   lines.push('</header>');

   // Acquisition summary
   if (d.acquisition) {
      lines.push('<section>');
      lines.push('<h2>Acquisition</h2>');
      const a = d.acquisition;
      lines.push('<table class="info-table">');
      if (a.camera) lines.push(infoRow('Camera', a.camera));
      if (a.telescope) lines.push(infoRow('Telescope', a.telescope));
      if (a.filters) lines.push(infoRow('Filters', a.filters.join(', ')));
      if (a.totalExposure) lines.push(infoRow('Total Integration', formatSeconds(a.totalExposure)));
      if (a.frameCount) lines.push(infoRow('Frames', a.frameCount));
      if (a.gain) lines.push(infoRow('Gain', a.gain));
      if (a.temperature) lines.push(infoRow('Sensor Temp', a.temperature + '&deg;C'));
      lines.push('</table>');
      lines.push('</section>');
   }

   // Stacking
   if (d.stackingReport) {
      lines.push('<section>');
      lines.push('<h2>Pre-Processing</h2>');
      const sr = d.stackingReport;
      if (sr.steps) {
         lines.push('<ol>');
         for (const step of sr.steps) {
            lines.push('<li>' + esc(step) + '</li>');
         }
         lines.push('</ol>');
      }
      lines.push('</section>');
   }

   // Classification
   if (d.classification) {
      lines.push('<section>');
      lines.push('<h2>Target Identification</h2>');
      lines.push('<p>Identified as <strong>' + esc(d.target.name) + '</strong> (' + esc(formatType(d.target.type)) + ')</p>');
      lines.push('<p>Method: ' + esc(d.classification.method) + '</p>');
      if (d.classification.profile) {
         const p = d.classification.profile;
         lines.push('<p>Processing strategy:</p>');
         lines.push('<table class="info-table">');
         lines.push(infoRow('Stretch', p.stretch));
         lines.push(infoRow('Combination', p.combination));
         lines.push('</table>');
         if (p.focus && p.focus.length > 0) {
            lines.push('<p>Focus areas:</p><ul>');
            for (const f of p.focus) lines.push('<li>' + esc(f) + '</li>');
            lines.push('</ul>');
         }
      }
      lines.push('</section>');
   }

   // Processing steps with educational explanations
   const allSteps = [].concat(d.linearSteps || [], d.creativeSteps || []);
   if (allSteps.length > 0) {
      lines.push('<section>');
      lines.push('<h2>Processing Steps</h2>');
      for (let i = 0; i < allSteps.length; i++) {
         const step = allSteps[i];
         const stepName = step.step || step.phase || 'step';
         const explanation = STEP_EXPLANATIONS[stepName] || {};

         lines.push('<div class="step">');
         lines.push('<h3>' + (i + 1) + '. ' + esc(formatStepName(stepName)) + '</h3>');
         if (step.method) lines.push('<p class="method">Method: ' + esc(step.method) + '</p>');
         if (explanation.what) lines.push('<p>' + esc(explanation.what) + '</p>');
         if (explanation.why) lines.push('<div class="why"><strong>Why?</strong> ' + esc(explanation.why) + '</div>');
         if (explanation.tip) lines.push('<div class="tip"><strong>Tip:</strong> ' + esc(explanation.tip) + '</div>');
         lines.push('</div>');
      }
      lines.push('</section>');
   }

   // Quality scores
   if (d.scores) {
      lines.push('<section>');
      lines.push('<h2>Quality Scores</h2>');
      lines.push('<div class="scores">');
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
      for (const [dim, score] of Object.entries(d.scores)) {
         const pct = Math.round(score);
         const cls = pct >= 80 ? 'good' : pct >= 60 ? 'ok' : 'poor';
         lines.push('<div class="score-row">');
         lines.push('<span class="score-label">' + esc(labels[dim] || dim) + '</span>');
         lines.push('<div class="score-bar"><div class="score-fill ' + cls + '" style="width:' + pct + '%"></div></div>');
         lines.push('<span class="score-value">' + pct + '</span>');
         lines.push('</div>');
      }
      if (d.overall !== null && d.overall !== undefined) {
         lines.push('<div class="overall">Overall: <strong>' + d.overall + '/100</strong></div>');
      }
      lines.push('</div>');
      lines.push('</section>');
   }

   // Quality gates
   if (d.gates) {
      lines.push('<section>');
      lines.push('<h2>Quality Gates</h2>');
      lines.push('<table class="gates-table">');
      lines.push('<tr><th>Gate</th><th>Result</th><th>Detail</th></tr>');
      for (const gate of d.gates) {
         const cls = gate.passed ? 'pass' : 'fail';
         lines.push('<tr class="' + cls + '">');
         lines.push('<td>' + esc(gate.name) + '</td>');
         lines.push('<td class="gate-result">' + (gate.passed ? 'PASS' : 'FAIL') + '</td>');
         lines.push('<td>' + esc(gate.detail) + '</td>');
         lines.push('</tr>');
      }
      lines.push('</table>');
      lines.push('</section>');
   }

   // Glossary
   lines.push('<section>');
   lines.push('<h2>Glossary</h2>');
   lines.push('<dl class="glossary">');
   for (const [term, def] of Object.entries(GLOSSARY)) {
      lines.push('<dt>' + esc(term) + '</dt><dd>' + esc(def) + '</dd>');
   }
   lines.push('</dl>');
   lines.push('</section>');

   lines.push('<footer>Generated by AstroPilot</footer>');
   lines.push('</body></html>');

   return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Markdown report (for AstroBin descriptions)
// ---------------------------------------------------------------------------

function generateMarkdown(data) {
   const d = assembleReportData(data);
   const lines = [];

   lines.push('# ' + (d.target.name || 'Deep Sky Object'));
   if (d.target.aliases && d.target.aliases.length > 0) {
      lines.push('*' + d.target.aliases.join(', ') + '*');
   }
   lines.push('');

   if (d.target.type) lines.push('**Type:** ' + formatType(d.target.type));
   if (d.target.notes) lines.push('**Notes:** ' + d.target.notes);
   lines.push('');

   // Acquisition
   if (d.acquisition) {
      lines.push('## Acquisition');
      const a = d.acquisition;
      if (a.telescope) lines.push('- **Telescope:** ' + a.telescope);
      if (a.camera) lines.push('- **Camera:** ' + a.camera);
      if (a.filters) lines.push('- **Filters:** ' + a.filters.join(', '));
      if (a.totalExposure) lines.push('- **Total Integration:** ' + formatSeconds(a.totalExposure));
      if (a.frameCount) lines.push('- **Frames:** ' + a.frameCount);
      lines.push('');
   }

   // Processing
   const allSteps = [].concat(d.linearSteps || [], d.creativeSteps || []);
   if (allSteps.length > 0) {
      lines.push('## Processing');
      for (const step of allSteps) {
         const name = formatStepName(step.step || step.phase || 'step');
         const method = step.method ? ' (' + step.method + ')' : '';
         lines.push('- ' + name + method);
      }
      lines.push('');
   }

   // Scores
   if (d.scores && d.overall !== null) {
      lines.push('## Quality');
      lines.push('Overall score: **' + d.overall + '/100**');
      lines.push('');
   }

   lines.push('*Processed with AstroPilot*');

   return lines.join('\n');
}

// ---------------------------------------------------------------------------
// JSON report
// ---------------------------------------------------------------------------

function generateJSON(data) {
   const d = assembleReportData(data);
   return JSON.stringify(d, null, 2);
}

// ---------------------------------------------------------------------------
// Write all formats
// ---------------------------------------------------------------------------

function writeReport(data, outputDir) {
   fs.mkdirSync(outputDir, { recursive: true });

   const targetSlug = (data.target && data.target.name || 'image')
      .replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();

   const htmlPath = path.join(outputDir, targetSlug + '_report.html');
   const mdPath = path.join(outputDir, targetSlug + '_report.md');
   const jsonPath = path.join(outputDir, targetSlug + '_report.json');

   fs.writeFileSync(htmlPath, generateHTML(data));
   fs.writeFileSync(mdPath, generateMarkdown(data));
   fs.writeFileSync(jsonPath, generateJSON(data));

   return { html: htmlPath, markdown: mdPath, json: jsonPath };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(str) {
   if (!str) return '';
   return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function infoRow(label, value) {
   return '<tr><td class="label">' + esc(label) + '</td><td>' + esc(String(value)) + '</td></tr>';
}

function formatType(type) {
   return String(type).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatStepName(step) {
   return String(step).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatSeconds(seconds) {
   if (seconds < 60) return seconds + 's';
   if (seconds < 3600) return (seconds / 60).toFixed(1) + ' min';
   const h = Math.floor(seconds / 3600);
   const m = Math.round((seconds % 3600) / 60);
   return h + 'h ' + m + 'm';
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 24px; background: #0d1117; color: #c9d1d9; line-height: 1.6; }
header.cover { text-align: center; padding: 48px 0 32px; border-bottom: 1px solid #30363d; margin-bottom: 32px; }
h1 { font-size: 2.2em; color: #f0f6fc; margin-bottom: 8px; }
h2 { font-size: 1.4em; color: #f0f6fc; margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 1px solid #21262d; }
h3 { font-size: 1.1em; color: #e6edf3; margin-bottom: 8px; }
.aliases { color: #8b949e; font-style: italic; }
.meta { color: #8b949e; margin: 4px 0; }
.notes { color: #8b949e; font-size: 0.9em; margin-top: 12px; }
section { margin-bottom: 32px; }
.info-table { border-collapse: collapse; width: 100%; }
.info-table td { padding: 6px 12px; border-bottom: 1px solid #21262d; }
.info-table .label { color: #8b949e; width: 160px; }
.step { margin-bottom: 24px; padding: 16px; background: #161b22; border-radius: 6px; border: 1px solid #30363d; }
.method { color: #8b949e; font-size: 0.9em; margin-bottom: 8px; }
.why { margin: 8px 0; padding: 10px 14px; background: #1c2128; border-left: 3px solid #58a6ff; border-radius: 4px; font-size: 0.9em; }
.tip { margin: 8px 0; padding: 10px 14px; background: #1c2128; border-left: 3px solid #3fb950; border-radius: 4px; font-size: 0.9em; }
.scores { margin: 16px 0; }
.score-row { display: flex; align-items: center; margin: 6px 0; }
.score-label { width: 180px; font-size: 0.9em; }
.score-bar { flex: 1; height: 16px; background: #21262d; border-radius: 8px; overflow: hidden; margin: 0 12px; }
.score-fill { height: 100%; border-radius: 8px; transition: width 0.3s; }
.score-fill.good { background: #3fb950; }
.score-fill.ok { background: #d29922; }
.score-fill.poor { background: #f85149; }
.score-value { width: 32px; text-align: right; font-weight: bold; }
.overall { margin-top: 16px; font-size: 1.2em; text-align: center; }
.gates-table { border-collapse: collapse; width: 100%; }
.gates-table th, .gates-table td { padding: 8px 12px; border-bottom: 1px solid #21262d; text-align: left; }
.gates-table th { color: #8b949e; font-weight: normal; }
.gate-result { font-weight: bold; }
tr.pass .gate-result { color: #3fb950; }
tr.fail .gate-result { color: #f85149; }
.glossary { margin: 16px 0; }
dt { font-weight: bold; color: #e6edf3; margin-top: 12px; }
dd { color: #8b949e; margin-left: 0; font-size: 0.9em; }
footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #21262d; color: #484f58; font-size: 0.85em; text-align: center; }
ol, ul { margin: 8px 0 8px 24px; }
li { margin: 4px 0; }
`;

module.exports = {
   generateHTML,
   generateMarkdown,
   generateJSON,
   writeReport,
   assembleReportData,
   STEP_EXPLANATIONS,
   GLOSSARY
};

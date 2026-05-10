// AstroPilot — AstroBin Integration
// ====================================
// Generates AstroBin-compatible image descriptions and handles
// uploads via the AstroBin API v2.
//
// You'll need an AstroBin API key and secret — get them at:
// https://www.astrobin.com/api/v2/api-key/
//
// Store credentials with:
//   astropilot config set astrobin.apiKey YOUR_KEY
//   astropilot config set astrobin.apiSecret YOUR_SECRET

const fs = require('fs');
const path = require('path');
const https = require('https');
const url = require('url');
const config = require('./config');

// ---------------------------------------------------------------------------
// Description generation
// ---------------------------------------------------------------------------

function generateDescription(data) {
   const lines = [];

   // Target info
   if (data.target) {
      if (data.target.aliases && data.target.aliases.length > 0) {
         lines.push('**' + data.target.name + '** (' + data.target.aliases.join(', ') + ')');
      } else {
         lines.push('**' + data.target.name + '**');
      }
      if (data.target.type) {
         lines.push('*' + formatTargetType(data.target.type) + '*');
      }
      lines.push('');
   }

   // Acquisition details
   if (data.acquisition) {
      lines.push('### Acquisition');
      const acq = data.acquisition;
      if (acq.date) lines.push('- **Date:** ' + acq.date);
      if (acq.location) lines.push('- **Location:** ' + acq.location);
      if (acq.bortle) lines.push('- **Bortle:** ' + acq.bortle);
      if (acq.integration) lines.push('- **Total integration:** ' + acq.integration);
      if (acq.filters && acq.filters.length > 0) {
         for (const f of acq.filters) {
            lines.push('- **' + f.name + ':** ' + f.count + ' x ' + f.exposure + 's');
         }
      }
      lines.push('');
   }

   // Equipment
   if (data.equipment) {
      lines.push('### Equipment');
      if (data.equipment.telescope) lines.push('- **Telescope:** ' + data.equipment.telescope);
      if (data.equipment.camera) lines.push('- **Camera:** ' + data.equipment.camera);
      if (data.equipment.mount) lines.push('- **Mount:** ' + data.equipment.mount);
      if (data.equipment.filters && data.equipment.filters.length > 0) {
         lines.push('- **Filters:** ' + data.equipment.filters.join(', '));
      }
      lines.push('');
   }

   // Processing summary
   if (data.processing) {
      lines.push('### Processing');
      lines.push('Processed with AstroPilot (automated PixInsight pipeline)');
      lines.push('');

      if (data.processing.profile) {
         lines.push('- **Profile:** ' + data.processing.profile);
      }
      if (data.processing.stretch) {
         lines.push('- **Stretch:** ' + data.processing.stretch);
      }
      if (data.processing.steps && data.processing.steps.length > 0) {
         lines.push('- **Key steps:** ' + data.processing.steps.join(', '));
      }
      lines.push('');
   }

   // Score
   if (data.score) {
      lines.push('### Quality Score');
      lines.push('Overall: **' + data.score.overall + '/100**');
      if (data.score.gatesPassed) {
         lines.push('All quality gates passed.');
      }
      lines.push('');
   }

   return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Build description from pipeline results
// ---------------------------------------------------------------------------

function buildDescription(classification, session, scoreResult, options) {
   const opts = options || {};
   const data = {};

   // Target
   if (classification && classification.target) {
      data.target = {
         name: classification.target.name,
         type: classification.target.type,
         aliases: classification.target.aliases
      };
   }

   // Acquisition
   const acq = {};
   if (session) {
      const lights = session.lights ? session.lights() : [];
      if (lights.length > 0) {
         const totalSec = lights.reduce(function(s, f) { return s + (f.exposure || 0); }, 0);
         acq.integration = formatTime(totalSec);

         if (lights[0].dateObs) acq.date = String(lights[0].dateObs).split('T')[0];

         // Group by filter for exposure breakdown
         const byFilter = {};
         for (const f of lights) {
            const filterName = f.filter || 'No filter';
            if (!byFilter[filterName]) byFilter[filterName] = { count: 0, exposure: f.exposure || 0 };
            byFilter[filterName].count++;
         }
         acq.filters = Object.entries(byFilter).map(function(entry) {
            return { name: entry[0], count: entry[1].count, exposure: entry[1].exposure };
         });
      }
   }
   if (opts.location) acq.location = opts.location;
   if (opts.bortle) acq.bortle = opts.bortle;
   if (opts.date) acq.date = opts.date;
   data.acquisition = acq;

   // Equipment
   if (opts.equipment) {
      data.equipment = opts.equipment;
   } else if (session) {
      const lights = session.lights ? session.lights() : [];
      if (lights.length > 0) {
         data.equipment = {};
         if (lights[0].telescope) data.equipment.telescope = lights[0].telescope;
         if (lights[0].camera) data.equipment.camera = lights[0].camera;
      }
   }

   // Processing
   if (classification && classification.profile) {
      data.processing = {
         profile: classification.profile.name,
         stretch: classification.profile.stretch
      };
   }

   // Score
   if (scoreResult) {
      data.score = {
         overall: scoreResult.overall,
         gatesPassed: scoreResult.gatesPassed
      };
   }

   return generateDescription(data);
}

// ---------------------------------------------------------------------------
// AstroBin API upload
// ---------------------------------------------------------------------------

function getCredentials() {
   const apiKey = config.get('astrobin.apiKey');
   const apiSecret = config.get('astrobin.apiSecret');
   if (!apiKey || !apiSecret) return null;
   return { apiKey: apiKey, apiSecret: apiSecret };
}

function httpRequest(options, postData) {
   return new Promise(function(resolve, reject) {
      const req = https.request(options, function(res) {
         let body = '';
         res.on('data', function(chunk) { body += chunk; });
         res.on('end', function() {
            resolve({ statusCode: res.statusCode, headers: res.headers, body: body });
         });
      });
      req.on('error', reject);
      if (postData) req.write(postData);
      req.end();
   });
}

async function uploadToAstroBin(imagePath, description, options) {
   const creds = getCredentials();
   if (!creds) {
      return { success: false, error: 'AstroBin credentials not configured. Run: astropilot config set astrobin.apiKey YOUR_KEY' };
   }

   const opts = options || {};

   if (!fs.existsSync(imagePath)) {
      return { success: false, error: 'Image file not found: ' + imagePath };
   }

   // Step 1: Create image entry
   const imageData = JSON.stringify({
      title: opts.title || '',
      description: description || '',
      is_wip: opts.isWip !== false
   });

   const createOptions = {
      hostname: 'www.astrobin.com',
      path: '/api/v2/images/?api_key=' + creds.apiKey + '&api_secret=' + creds.apiSecret,
      method: 'POST',
      headers: {
         'Content-Type': 'application/json',
         'Content-Length': Buffer.byteLength(imageData)
      }
   };

   let createResult;
   try {
      createResult = await httpRequest(createOptions, imageData);
   } catch (e) {
      return { success: false, error: 'API request failed: ' + e.message };
   }

   if (createResult.statusCode !== 201) {
      return {
         success: false,
         error: 'Failed to create image entry (HTTP ' + createResult.statusCode + ')',
         detail: createResult.body
      };
   }

   let imageEntry;
   try {
      imageEntry = JSON.parse(createResult.body);
   } catch {
      return { success: false, error: 'Invalid response from AstroBin' };
   }

   // Step 2: Upload the file
   const boundary = '----AstroPilotUpload' + Date.now();
   const fileBuffer = fs.readFileSync(imagePath);
   const fileName = path.basename(imagePath);

   const prefix = '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="image_file"; filename="' + fileName + '"\r\n' +
      'Content-Type: application/octet-stream\r\n\r\n';
   const suffix = '\r\n--' + boundary + '--\r\n';

   const uploadBody = Buffer.concat([
      Buffer.from(prefix),
      fileBuffer,
      Buffer.from(suffix)
   ]);

   const uploadHash = imageEntry.hash || imageEntry.id;
   const uploadOptions = {
      hostname: 'www.astrobin.com',
      path: '/api/v2/images/' + uploadHash + '/image-upload/?api_key=' + creds.apiKey + '&api_secret=' + creds.apiSecret,
      method: 'POST',
      headers: {
         'Content-Type': 'multipart/form-data; boundary=' + boundary,
         'Content-Length': uploadBody.length
      }
   };

   let uploadResult;
   try {
      uploadResult = await httpRequest(uploadOptions, uploadBody);
   } catch (e) {
      return { success: false, error: 'Upload failed: ' + e.message, imageHash: uploadHash };
   }

   if (uploadResult.statusCode >= 200 && uploadResult.statusCode < 300) {
      return {
         success: true,
         imageHash: uploadHash,
         url: 'https://www.astrobin.com/' + uploadHash + '/',
         isWip: opts.isWip !== false
      };
   }

   return {
      success: false,
      error: 'Upload failed (HTTP ' + uploadResult.statusCode + ')',
      imageHash: uploadHash,
      detail: uploadResult.body
   };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTargetType(type) {
   return type.replace(/_/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); });
}

function formatTime(seconds) {
   if (seconds < 60) return seconds + 's';
   if (seconds < 3600) return (seconds / 60).toFixed(1) + ' min';
   var h = Math.floor(seconds / 3600);
   var m = Math.round((seconds % 3600) / 60);
   return h + 'h ' + m + 'm';
}

module.exports = {
   generateDescription,
   buildDescription,
   uploadToAstroBin,
   getCredentials
};

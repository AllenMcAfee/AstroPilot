// AstroPilot — Equipment Profile Management
// =============================================
// Save and load telescope + camera + mount configurations so you don't
// have to re-enter details for every session.

const fs = require('fs');
const path = require('path');
const platform = require('./platform');

function ensureDir(dir) {
   fs.mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Profile I/O
// ---------------------------------------------------------------------------

function getProfilePath(name) {
   return path.join(platform.getEquipmentDir(), name + '.json');
}

function listProfiles() {
   const dir = platform.getEquipmentDir();
   if (!fs.existsSync(dir)) return [];
   return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''))
      .sort();
}

function loadProfile(name) {
   const profilePath = getProfilePath(name);
   if (!fs.existsSync(profilePath)) return null;
   try {
      return JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
   } catch {
      return null;
   }
}

function saveProfile(name, profile) {
   ensureDir(platform.getEquipmentDir());
   profile.name = name;
   profile.updatedAt = new Date().toISOString();
   fs.writeFileSync(getProfilePath(name), JSON.stringify(profile, null, 2));
   return profile;
}

function deleteProfile(name) {
   const profilePath = getProfilePath(name);
   if (fs.existsSync(profilePath)) {
      fs.unlinkSync(profilePath);
      return true;
   }
   return false;
}

// ---------------------------------------------------------------------------
// Profile creation helper
// ---------------------------------------------------------------------------

function createProfile(name, options) {
   const profile = {
      name: name,
      telescope: {
         name: null,
         focalLength: null,
         aperture: null
      },
      camera: {
         name: null,
         pixelSize: null,
         resolution: null,
         sensor: null
      },
      mount: {
         name: null
      },
      filters: [],
      accessories: [],
      notes: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
   };

   if (options) {
      if (options.telescope) Object.assign(profile.telescope, options.telescope);
      if (options.camera) Object.assign(profile.camera, options.camera);
      if (options.mount) Object.assign(profile.mount, options.mount);
      if (options.filters) profile.filters = options.filters;
      if (options.accessories) profile.accessories = options.accessories;
      if (options.notes) profile.notes = options.notes;
   }

   return saveProfile(name, profile);
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function displayProfile(profile) {
   if (!profile) {
      console.log('Profile not found.');
      return;
   }

   console.log('Equipment Profile: ' + profile.name);
   console.log('');

   if (profile.telescope && profile.telescope.name) {
      console.log('Telescope:');
      console.log('  ' + profile.telescope.name);
      if (profile.telescope.focalLength) console.log('  Focal length: ' + profile.telescope.focalLength + 'mm');
      if (profile.telescope.aperture) console.log('  Aperture: ' + profile.telescope.aperture + 'mm');
   }

   if (profile.camera && profile.camera.name) {
      console.log('Camera:');
      console.log('  ' + profile.camera.name);
      if (profile.camera.pixelSize) console.log('  Pixel size: ' + profile.camera.pixelSize + 'um');
      if (profile.camera.resolution) console.log('  Resolution: ' + profile.camera.resolution);
      if (profile.camera.sensor) console.log('  Sensor: ' + profile.camera.sensor);
   }

   if (profile.mount && profile.mount.name) {
      console.log('Mount:');
      console.log('  ' + profile.mount.name);
   }

   if (profile.filters && profile.filters.length > 0) {
      console.log('Filters:');
      profile.filters.forEach(function(f) { console.log('  ' + f); });
   }

   if (profile.accessories && profile.accessories.length > 0) {
      console.log('Accessories:');
      profile.accessories.forEach(function(a) { console.log('  ' + a); });
   }

   if (profile.notes) {
      console.log('Notes: ' + profile.notes);
   }

   console.log('');
   console.log('Last updated: ' + profile.updatedAt);
}

// ---------------------------------------------------------------------------
// Computed properties
// ---------------------------------------------------------------------------

function getImageScale(profile) {
   if (!profile || !profile.telescope || !profile.camera) return null;
   const fl = profile.telescope.focalLength;
   const px = profile.camera.pixelSize;
   if (!fl || !px) return null;
   // Image scale in arcseconds per pixel: 206.265 * pixelSize(um) / focalLength(mm)
   return 206.265 * px / fl;
}

function getEquipmentSummary(profile) {
   if (!profile) return null;
   const parts = [];
   if (profile.telescope && profile.telescope.name) parts.push(profile.telescope.name);
   if (profile.camera && profile.camera.name) parts.push(profile.camera.name);
   if (parts.length === 0) return null;
   return parts.join('  +  ');
}

module.exports = {
   listProfiles,
   loadProfile,
   saveProfile,
   deleteProfile,
   createProfile,
   displayProfile,
   getImageScale,
   getEquipmentSummary
};

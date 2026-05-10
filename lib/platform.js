// AstroPilot — Cross-Platform Support
// ======================================
// Detects the OS, finds PixInsight installations, and resolves paths
// that differ across Windows, macOS, and Linux.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// OS detection
// ---------------------------------------------------------------------------

function getPlatform() {
   const p = process.platform;
   if (p === 'win32') return 'windows';
   if (p === 'darwin') return 'macos';
   return 'linux';
}

// ---------------------------------------------------------------------------
// PixInsight installation detection
// ---------------------------------------------------------------------------

const PI_SEARCH_PATHS = {
   windows: [
      'C:\\Program Files\\PixInsight',
      'C:\\Program Files (x86)\\PixInsight',
      path.join(os.homedir(), 'PixInsight')
   ],
   macos: [
      '/Applications/PixInsight/PixInsight.app',
      path.join(os.homedir(), 'Applications/PixInsight/PixInsight.app')
   ],
   linux: [
      '/opt/PixInsight',
      path.join(os.homedir(), 'PixInsight'),
      '/usr/local/PixInsight'
   ]
};

function findPixInsightInstallation() {
   const platform = getPlatform();
   const candidates = PI_SEARCH_PATHS[platform] || [];

   for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
         return candidate;
      }
   }

   // Try PATH lookup
   try {
      if (platform === 'windows') {
         const result = execSync('where PixInsight.exe 2>nul', { encoding: 'utf-8' }).trim();
         if (result) return path.dirname(result);
      } else {
         const result = execSync('which PixInsight 2>/dev/null', { encoding: 'utf-8' }).trim();
         if (result) return path.dirname(result);
      }
   } catch {
      // Not on PATH
   }

   return null;
}

// ---------------------------------------------------------------------------
// PixInsight scripts directory
// ---------------------------------------------------------------------------

function getPixInsightScriptsDir(piPath) {
   if (!piPath) return null;

   const platform = getPlatform();

   if (platform === 'macos') {
      // Inside .app bundle
      const bundleScripts = path.join(piPath, 'Contents', 'Resources', 'scripts');
      if (fs.existsSync(bundleScripts)) return bundleScripts;
   }

   // Standard location inside PI install
   const scripts = path.join(piPath, 'scripts');
   if (fs.existsSync(scripts)) return scripts;

   // User scripts directory
   const userScripts = path.join(piPath, 'src', 'scripts');
   if (fs.existsSync(userScripts)) return userScripts;

   return null;
}

// ---------------------------------------------------------------------------
// PixInsight executable
// ---------------------------------------------------------------------------

function getPixInsightExecutable(piPath) {
   if (!piPath) return null;

   const platform = getPlatform();

   if (platform === 'windows') {
      const exe = path.join(piPath, 'bin', 'PixInsight.exe');
      if (fs.existsSync(exe)) return exe;
      const exeRoot = path.join(piPath, 'PixInsight.exe');
      if (fs.existsSync(exeRoot)) return exeRoot;
   } else if (platform === 'macos') {
      const exe = path.join(piPath, 'Contents', 'MacOS', 'PixInsight');
      if (fs.existsSync(exe)) return exe;
   } else {
      const exe = path.join(piPath, 'bin', 'PixInsight');
      if (fs.existsSync(exe)) return exe;
   }

   return null;
}

// ---------------------------------------------------------------------------
// AstroPilot directories
// ---------------------------------------------------------------------------

function getAstroPilotDir() {
   return path.join(os.homedir(), '.astropilot');
}

function getBridgeDir() {
   return path.join(getAstroPilotDir(), 'bridge');
}

function getConfigPath() {
   return path.join(getAstroPilotDir(), 'config.json');
}

function getEquipmentDir() {
   return path.join(getAstroPilotDir(), 'equipment');
}

// ---------------------------------------------------------------------------
// Platform info summary
// ---------------------------------------------------------------------------

function getPlatformInfo() {
   const platform = getPlatform();
   const piPath = findPixInsightInstallation();

   return {
      platform: platform,
      arch: process.arch,
      nodeVersion: process.version,
      homeDir: os.homedir(),
      astropilotDir: getAstroPilotDir(),
      pixinsight: piPath ? {
         path: piPath,
         executable: getPixInsightExecutable(piPath),
         scriptsDir: getPixInsightScriptsDir(piPath)
      } : null
   };
}

module.exports = {
   getPlatform,
   findPixInsightInstallation,
   getPixInsightScriptsDir,
   getPixInsightExecutable,
   getAstroPilotDir,
   getBridgeDir,
   getConfigPath,
   getEquipmentDir,
   getPlatformInfo,
   PI_SEARCH_PATHS
};

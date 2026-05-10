// AstroPilot Bridge — Node.js Client
// ====================================
// Sends JSON commands to the PixInsight watcher and polls for results.
//
// Usage:
//   const bridge = require('./bridge/client');
//   await bridge.ping();
//   await bridge.listOpenImages();
//   await bridge.getImageStatistics('MyImage');
//   await bridge.runProcess('PixelMath', 'MyImage', { expression: '$T * 2' });
//   await bridge.runScript('__result = ImageWindow.windows.length;');
//   await bridge.shutdown();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const BRIDGE_BASE = path.join(os.homedir(), '.astropilot', 'bridge');
const COMMANDS_DIR = path.join(BRIDGE_BASE, 'commands');
const RESULTS_DIR = path.join(BRIDGE_BASE, 'results');
const POLL_INTERVAL_MS = 200;
const DEFAULT_TIMEOUT_MS = 300000; // 5 minutes

function ensureDir(dir) {
   fs.mkdirSync(dir, { recursive: true });
}

function generateId() {
   return crypto.randomUUID();
}

function sleep(ms) {
   return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if the watcher is running by looking for the pid file.
 */
function isWatcherRunning() {
   const pidPath = path.join(BRIDGE_BASE, 'watcher.pid');
   return fs.existsSync(pidPath);
}

/**
 * Get watcher info from the pid file.
 */
function getWatcherInfo() {
   const pidPath = path.join(BRIDGE_BASE, 'watcher.pid');
   if (!fs.existsSync(pidPath)) return null;
   try {
      return JSON.parse(fs.readFileSync(pidPath, 'utf-8'));
   } catch {
      return null;
   }
}

/**
 * Send a command to the watcher and wait for the result.
 */
async function sendCommand(command, params, timeoutMs) {
   if (typeof params === 'undefined') params = {};
   if (typeof timeoutMs === 'undefined') timeoutMs = DEFAULT_TIMEOUT_MS;

   ensureDir(COMMANDS_DIR);
   ensureDir(RESULTS_DIR);

   const id = generateId();
   const cmd = {
      id: id,
      command: command,
      params: params,
      timestamp: Date.now()
   };

   // Write command file atomically (write to temp, then rename)
   const cmdPath = path.join(COMMANDS_DIR, id + '.json');
   const tmpPath = cmdPath + '.tmp';
   fs.writeFileSync(tmpPath, JSON.stringify(cmd, null, 2));
   fs.renameSync(tmpPath, cmdPath);

   // Poll for result
   const resultPath = path.join(RESULTS_DIR, id + '.json');
   const deadline = Date.now() + timeoutMs;

   while (Date.now() < deadline) {
      if (fs.existsSync(resultPath)) {
         // Small delay to ensure the watcher has finished writing
         await sleep(50);
         const text = fs.readFileSync(resultPath, 'utf-8');
         fs.unlinkSync(resultPath);

         const response = JSON.parse(text);
         if (response.status === 'error') {
            const err = new Error(response.error || 'Command failed');
            err.command = command;
            err.commandId = id;
            throw err;
         }
         return response.result;
      }
      await sleep(POLL_INTERVAL_MS);
   }

   // Timeout — clean up the command file if it's still there
   if (fs.existsSync(cmdPath)) {
      fs.unlinkSync(cmdPath);
   }
   const err = new Error('Command timed out after ' + timeoutMs + 'ms');
   err.command = command;
   err.commandId = id;
   throw err;
}

// ---- High-Level API ----

async function ping() {
   return sendCommand('ping');
}

async function listOpenImages() {
   return sendCommand('list_open_images');
}

async function getImageStatistics(target) {
   return sendCommand('get_image_statistics', { target: target });
}

async function runProcess(processName, target, settings) {
   return sendCommand('run_process', {
      process: processName,
      target: target,
      settings: settings || {}
   });
}

async function runScript(code, timeoutMs) {
   return sendCommand('run_script', { code: code }, timeoutMs);
}

// ---- Pipeline Commands ----

async function colorBalance(target) {
   return sendCommand('color_balance', { target: target });
}

async function backgroundFix(target) {
   return sendCommand('background_fix', { target: target });
}

async function dehalo(target, options) {
   const params = { target: target };
   if (options) {
      if (options.sigma !== undefined) params.sigma = options.sigma;
      if (options.amount !== undefined) params.amount = options.amount;
   }
   return sendCommand('dehalo', params);
}

async function noiseReduction(target, options) {
   const params = { target: target };
   if (options) {
      if (options.sigmaL !== undefined) params.sigmaL = options.sigmaL;
      if (options.sigmaC !== undefined) params.sigmaC = options.sigmaC;
      if (options.amountL !== undefined) params.amountL = options.amountL;
      if (options.amountC !== undefined) params.amountC = options.amountC;
      if (options.iterationsL !== undefined) params.iterationsL = options.iterationsL;
      if (options.iterationsC !== undefined) params.iterationsC = options.iterationsC;
   }
   return sendCommand('noise_reduction', params);
}

async function starReduction(target, options) {
   const params = { target: target };
   if (options) {
      if (options.iterations !== undefined) params.iterations = options.iterations;
      if (options.amount !== undefined) params.amount = options.amount;
      if (options.structureSize !== undefined) params.structureSize = options.structureSize;
   }
   return sendCommand('star_reduction', params);
}

async function enhance(target, options) {
   const params = { target: target };
   if (options) {
      if (options.lheRadius !== undefined) params.lheRadius = options.lheRadius;
      if (options.lheSlopeLimit !== undefined) params.lheSlopeLimit = options.lheSlopeLimit;
      if (options.lheAmount !== undefined) params.lheAmount = options.lheAmount;
      if (options.saturationBoost !== undefined) params.saturationBoost = options.saturationBoost;
      if (options.sCurve !== undefined) params.sCurve = options.sCurve;
   }
   return sendCommand('enhance', params);
}

async function shutdown() {
   ensureDir(COMMANDS_DIR);
   fs.writeFileSync(path.join(COMMANDS_DIR, 'shutdown'), '');
}

module.exports = {
   sendCommand,
   ping,
   listOpenImages,
   getImageStatistics,
   runProcess,
   runScript,
   colorBalance,
   backgroundFix,
   dehalo,
   noiseReduction,
   starReduction,
   enhance,
   shutdown,
   isWatcherRunning,
   getWatcherInfo,
   BRIDGE_BASE,
   COMMANDS_DIR,
   RESULTS_DIR
};

// AstroPilot — Configuration Management
// ========================================
// Loads and saves user configuration from ~/.astropilot/config.json.
// Provides a first-run wizard for initial setup.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const platform = require('./platform');

// ---------------------------------------------------------------------------
// Config file I/O
// ---------------------------------------------------------------------------

function loadConfig() {
   const configPath = platform.getConfigPath();
   if (!fs.existsSync(configPath)) return null;
   try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
   } catch {
      return null;
   }
}

function saveConfig(config) {
   const dir = platform.getAstroPilotDir();
   fs.mkdirSync(dir, { recursive: true });
   const configPath = platform.getConfigPath();
   fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
   return configPath;
}

function getConfig() {
   return loadConfig() || defaultConfig();
}

function defaultConfig() {
   return {
      version: 1,
      pixinsight: {
         path: null,
         autoDetected: false
      },
      author: null,
      location: null,
      bortle: null,
      defaultEquipmentProfile: null,
      watermark: {
         enabled: true,
         position: 'bottom-right',
         opacity: 0.5,
         showDate: true
      },
      report: {
         format: 'html',
         outputDir: null
      },
      pipeline: {
         autoCrop: true,
         extractStars: false
      }
   };
}

// ---------------------------------------------------------------------------
// Config getters / setters
// ---------------------------------------------------------------------------

function get(key) {
   const config = getConfig();
   const parts = key.split('.');
   let obj = config;
   for (const part of parts) {
      if (obj === null || obj === undefined) return undefined;
      obj = obj[part];
   }
   return obj;
}

function set(key, value) {
   const config = getConfig();
   const parts = key.split('.');
   let obj = config;
   for (let i = 0; i < parts.length - 1; i++) {
      if (obj[parts[i]] === undefined || obj[parts[i]] === null) {
         obj[parts[i]] = {};
      }
      obj = obj[parts[i]];
   }
   obj[parts[parts.length - 1]] = value;
   saveConfig(config);
   return value;
}

// ---------------------------------------------------------------------------
// Interactive setup wizard
// ---------------------------------------------------------------------------

function ask(rl, question, defaultValue) {
   const suffix = defaultValue ? ' [' + defaultValue + ']' : '';
   return new Promise(function(resolve) {
      rl.question(question + suffix + ': ', function(answer) {
         resolve(answer.trim() || defaultValue || '');
      });
   });
}

async function runSetupWizard() {
   const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
   });

   console.log('');
   console.log('AstroPilot Setup');
   console.log('================');
   console.log('');

   const config = defaultConfig();

   // Detect PixInsight
   console.log('Looking for PixInsight...');
   const piPath = platform.findPixInsightInstallation();
   if (piPath) {
      console.log('Found: ' + piPath);
      config.pixinsight.path = piPath;
      config.pixinsight.autoDetected = true;
   } else {
      console.log('Not found automatically.');
      const manualPath = await ask(rl, 'PixInsight install path (leave blank to skip)', '');
      if (manualPath && fs.existsSync(manualPath)) {
         config.pixinsight.path = manualPath;
      }
   }
   console.log('');

   // Author
   config.author = await ask(rl, 'Your name (for watermarks and metadata)', '');

   // Location
   config.location = await ask(rl, 'Default imaging location (optional)', '');

   // Bortle
   const bortleStr = await ask(rl, 'Typical Bortle class (1-9, optional)', '');
   if (bortleStr && !isNaN(parseInt(bortleStr))) {
      config.bortle = parseInt(bortleStr);
   }

   console.log('');

   // Save
   const configPath = saveConfig(config);
   console.log('Configuration saved to ' + configPath);

   // Offer to install watcher
   if (config.pixinsight.path) {
      const scriptsDir = platform.getPixInsightScriptsDir(config.pixinsight.path);
      if (scriptsDir) {
         const installWatcher = await ask(rl, 'Install watcher script to PixInsight? (y/n)', 'y');
         if (installWatcher.toLowerCase() === 'y') {
            const result = installWatcherScript(config.pixinsight.path);
            if (result.success) {
               console.log('Watcher installed: ' + result.path);
            } else {
               console.log('Could not install watcher: ' + result.error);
            }
         }
      }
   }

   console.log('');
   console.log('Setup complete. Run "astropilot status" to check your configuration.');
   console.log('');

   rl.close();
   return config;
}

// ---------------------------------------------------------------------------
// Watcher script installer
// ---------------------------------------------------------------------------

function installWatcherScript(piPath) {
   const scriptsDir = platform.getPixInsightScriptsDir(piPath || platform.findPixInsightInstallation());
   if (!scriptsDir) {
      return { success: false, error: 'Could not find PixInsight scripts directory' };
   }

   const watcherSrc = path.join(__dirname, '..', 'bridge', 'pjsr', 'watcher.js');
   if (!fs.existsSync(watcherSrc)) {
      return { success: false, error: 'Watcher source not found: ' + watcherSrc };
   }

   // Create AstroPilot subdirectory in PI scripts
   const destDir = path.join(scriptsDir, 'AstroPilot');
   try {
      fs.mkdirSync(destDir, { recursive: true });
   } catch (e) {
      return { success: false, error: 'Could not create directory: ' + e.message };
   }

   const destPath = path.join(destDir, 'watcher.js');
   try {
      fs.copyFileSync(watcherSrc, destPath);
   } catch (e) {
      return { success: false, error: 'Could not copy watcher: ' + e.message };
   }

   return { success: true, path: destPath };
}

// ---------------------------------------------------------------------------
// Display config
// ---------------------------------------------------------------------------

function displayConfig() {
   const config = getConfig();
   const info = platform.getPlatformInfo();

   console.log('AstroPilot Configuration');
   console.log('========================');
   console.log('');
   console.log('Platform:     ' + info.platform + ' (' + info.arch + ')');
   console.log('Node.js:      ' + info.nodeVersion);
   console.log('Config file:  ' + platform.getConfigPath());
   console.log('');

   if (config.pixinsight && config.pixinsight.path) {
      console.log('PixInsight:   ' + config.pixinsight.path +
         (config.pixinsight.autoDetected ? ' (auto-detected)' : ''));
   } else {
      console.log('PixInsight:   not configured');
   }

   if (info.pixinsight) {
      if (info.pixinsight.executable) console.log('  Executable: ' + info.pixinsight.executable);
      if (info.pixinsight.scriptsDir) console.log('  Scripts:    ' + info.pixinsight.scriptsDir);
   }

   console.log('');
   if (config.author) console.log('Author:       ' + config.author);
   if (config.location) console.log('Location:     ' + config.location);
   if (config.bortle) console.log('Bortle:       ' + config.bortle);
   if (config.defaultEquipmentProfile) console.log('Equipment:    ' + config.defaultEquipmentProfile);
   console.log('');

   console.log('Watermark:    ' + (config.watermark.enabled ? 'on' : 'off') +
      ' (' + config.watermark.position + ', ' + (config.watermark.opacity * 100) + '% opacity)');
   console.log('Report:       ' + config.report.format);
   console.log('Auto-crop:    ' + (config.pipeline.autoCrop ? 'yes' : 'no'));
}

module.exports = {
   loadConfig,
   saveConfig,
   getConfig,
   defaultConfig,
   get,
   set,
   runSetupWizard,
   installWatcherScript,
   displayConfig
};

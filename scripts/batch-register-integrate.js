// Batch register and integrate calibrated frames
// Runs via the watcher's run_script command

const fs = require('fs');
const path = require('path');
const bridge = require('../bridge/client');

const calibDir = 'F:/Astro/1_Sessions/2024-04-NGC4435/calibrated';
const regDir = 'F:/Astro/1_Sessions/2024-04-NGC4435/registered';
const outDir = 'F:/Astro/1_Sessions/2024-04-NGC4435/output';

const files = fs.readdirSync(calibDir)
   .filter(f => f.endsWith('.xisf') && !f.includes('test'))
   .map(f => path.join(calibDir, f).split(path.sep).join('/'));

console.log('Processing ' + files.length + ' calibrated frames');
console.log('Step 1: Register...');

const filesJson = JSON.stringify(files);

const code = `
var files = ${filesJson};
var regDir = "${regDir}";
var outDir = "${outDir}";

// ---- REGISTRATION ----
// Use StarAlignment with executeOn approach: open each frame,
// align it to a reference, and save manually

var refPath = files[0];

// First, we need to try executeGlobal and see if outputData has paths
var SA = new StarAlignment;
SA.referenceImage = refPath;
SA.referenceIsFile = true;
SA.outputDirectory = regDir;
SA.outputPostfix = "_r";
SA.outputExtension = ".xisf";
SA.overwriteExistingFiles = true;
SA.noGUIMessages = true;
SA.generateDrizzleData = false;

var targets = [];
for (var i = 0; i < files.length; i++) {
   targets.push([true, true, files[i]]);
}
SA.targets = targets;

SA.executeGlobal();

// Check if files were actually written
var File = new FileFind;
var foundFiles = [];
File.begin(regDir + "/*_r.xisf");
do {
   if (File.name && File.name !== "." && File.name !== "..") {
      foundFiles.push(regDir + "/" + File.name);
   }
} while (File.next());
File.end();

if (foundFiles.length === 0) {
   // executeGlobal didn't write files - check outputData for image IDs
   // and save them manually from open windows
   var windows = ImageWindow.windows;
   var regFiles = [];
   for (var i = 0; i < windows.length; i++) {
      var wId = windows[i].mainView.id;
      if (wId.indexOf("_r") !== -1 || wId.indexOf("registered") !== -1) {
         var savePath = regDir + "/" + wId + ".xisf";
         windows[i].saveAs(savePath, false, false, false, false);
         regFiles.push(savePath);
         windows[i].forceClose();
      }
   }
   if (regFiles.length > 0) {
      foundFiles = regFiles;
   }
}

__result = "Registered files found: " + foundFiles.length;
`;

bridge.sendCommand('run_script', { code: code }, 600000)
   .then(r => {
      console.log(r.result);

      // Now check if we need to integrate
      const regFiles = fs.readdirSync(regDir)
         .filter(f => f.endsWith('.xisf'))
         .map(f => path.join(regDir, f).split(path.sep).join('/'));

      if (regFiles.length > 0) {
         console.log('Step 2: Integrating ' + regFiles.length + ' registered frames...');
         return bridge.sendCommand('integrate', { files: regFiles }, 600000);
      } else {
         console.log('No registered files found - checking PI windows...');
         return bridge.sendCommand('list_open_images', {});
      }
   })
   .then(r => console.log('Result:', JSON.stringify(r)))
   .catch(e => console.error('Error:', e.message));

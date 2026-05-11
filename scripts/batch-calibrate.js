// Batch calibrate lights with master dark/bias/flat
// Usage: node scripts/batch-calibrate.js

const fs = require('fs');
const path = require('path');
const bridge = require('../bridge/client');

const lightDir = 'F:/Astro/1_Sessions/2024-04-NGC4435/Lights';
const outDir = 'F:/Astro/1_Sessions/2024-04-NGC4435/calibrated';
const masterDark = 'F:/Astro/2_MASTERS/asi/Darks/MasterDark_Gain120_240s.tif';
const masterBias = 'F:/Astro/2_MASTERS/asi/Bias/MasterOffset_Gain120.tif';
const masterFlat = 'F:/Astro/2_MASTERS/asi/Flats/MasterFlat_Gain120.tif';

const lights = fs.readdirSync(lightDir)
   .filter(f => f.endsWith('.fit'))
   .map(f => path.join(lightDir, f).split(path.sep).join('/'));

console.log('Calibrating ' + lights.length + ' frames...');

// Build PJSR code with embedded file list
const filesJson = JSON.stringify(lights);

const code = `
var OP_SUB = 3;
var OP_DIV = 5;
var OP_MUL = 2;

var files = ${filesJson};
var outDir = "${outDir}";

// Open masters once
var darkW = ImageWindow.open("${masterDark}")[0];
var biasW = ImageWindow.open("${masterBias}")[0];
var flatW = ImageWindow.open("${masterFlat}")[0];
var flatMed = flatW.mainView.image.median();

var done = 0;
var failed = 0;
for (var i = 0; i < files.length; i++) {
   try {
      var w = ImageWindow.open(files[i])[0];
      var v = w.mainView;
      v.beginProcess();
      v.image.apply(biasW.mainView.image, OP_SUB);
      v.image.apply(darkW.mainView.image, OP_SUB);
      v.image.apply(flatW.mainView.image, OP_DIV);
      v.image.apply(flatMed, OP_MUL);
      v.endProcess();

      var baseName = files[i].substring(files[i].lastIndexOf("/") + 1);
      baseName = baseName.substring(0, baseName.lastIndexOf(".")) + "_c.xisf";
      w.saveAs(outDir + "/" + baseName, false, false, false, false);
      w.forceClose();
      done++;
      if (done % 20 === 0) console.noteln("AstroPilot: Calibrated " + done + "/" + files.length);
   } catch(e) {
      console.warningln("AstroPilot: Failed " + files[i] + ": " + e.message);
      failed++;
   }
}

darkW.forceClose();
biasW.forceClose();
flatW.forceClose();
__result = "Calibrated " + done + " frames, " + failed + " failed";
`;

bridge.sendCommand('run_script', { code: code }, 600000)
   .then(r => console.log(r.result))
   .catch(e => console.error('Error:', e.message));

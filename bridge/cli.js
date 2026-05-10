#!/usr/bin/env node
// AstroPilot Bridge — CLI test tool
//
// Usage:
//   node bridge/cli.js ping
//   node bridge/cli.js list
//   node bridge/cli.js stats <windowId>
//   node bridge/cli.js run "<pjsr code>"
//   node bridge/cli.js process <ProcessName> <windowId> [settingsJson]
//   node bridge/cli.js shutdown
//   node bridge/cli.js status

const bridge = require('./client');
const { scanDirectory } = require('../lib/classifier');
const { stackSession, stackByFilter } = require('../lib/stacker');
const { linearPreprocess, checkTools } = require('../lib/linear-preprocess');
const { classifyTarget, classifyFromSession } = require('../lib/target-classifier');
const { lookupByName } = require('../lib/catalog');

const args = process.argv.slice(2);
const command = args[0];

if (!command) {
   console.log('AstroPilot Bridge CLI');
   console.log('');
   console.log('Commands:');
   console.log('  status                        Check if watcher is running');
   console.log('  ping                          Ping the watcher');
   console.log('  list                          List open images');
   console.log('  stats <windowId>              Get image statistics');
   console.log('  run "<code>"                  Execute PJSR code');
   console.log('  process <name> <id> [json]    Run a PI process');
   console.log('');
   console.log('Pipeline:');
   console.log('  color-balance <id>            Neutralize background, equalize channels');
   console.log('  background-fix <id>           Remove per-channel floor offsets');
   console.log('  dehalo <id> [sigma] [amount]  Reduce diffuse glow');
   console.log('  noise-reduction <id>          ACDNR noise reduction');
   console.log('  star-reduction <id>           Star mask + morphological erosion');
   console.log('  enhance <id>                  LHE + saturation + S-curve');
   console.log('  pipeline <id>                 Run full recommended pipeline');
   console.log('');
   console.log('Pre-processing:');
   console.log('  scan <directory>              Scan and classify FITS/XISF files');
   console.log('  scan <directory> --json       Same, but output as JSON');
   console.log('  stack <directory> [outDir]    Calibrate, register, and stack');
   console.log('  linear <windowId>            Linear pre-processing (gradients, color cal, NR)');
   console.log('  classify <windowId>          Identify target and select processing profile');
   console.log('  lookup <name>                Look up a target in the built-in catalog');
   console.log('  tools                        Check which PI processes are installed');
   console.log('');
   console.log('  shutdown                      Stop the watcher');
   process.exit(0);
}

function fmtRGB(obj) {
   return 'R=' + obj.R.toFixed(6) + ' G=' + obj.G.toFixed(6) + ' B=' + obj.B.toFixed(6);
}

async function main() {
   try {
      switch (command) {
         case 'status': {
            const info = bridge.getWatcherInfo();
            if (info) {
               console.log('Watcher is running');
               console.log('  Version:', info.version);
               console.log('  Started:', info.started);
            } else {
               console.log('Watcher is not running');
            }
            break;
         }
         case 'ping': {
            const result = await bridge.ping();
            console.log(JSON.stringify(result, null, 2));
            break;
         }
         case 'list': {
            const result = await bridge.listOpenImages();
            if (result.count === 0) {
               console.log('No images open.');
            } else {
               console.log(result.count + ' image(s) open:');
               for (const w of result.windows) {
                  console.log('  ' + w.id + '  ' + w.width + 'x' + w.height + '  ' + w.channels + 'ch  ' + w.bitsPerSample + 'bit');
               }
            }
            break;
         }
         case 'stats': {
            if (!args[1]) { console.error('Usage: stats <windowId>'); process.exit(1); }
            const result = await bridge.getImageStatistics(args[1]);
            console.log(JSON.stringify(result, null, 2));
            break;
         }
         case 'run': {
            if (!args[1]) { console.error('Usage: run "<code>"'); process.exit(1); }
            const result = await bridge.runScript(args[1]);
            console.log(JSON.stringify(result, null, 2));
            break;
         }
         case 'process': {
            if (!args[1] || !args[2]) { console.error('Usage: process <name> <windowId> [settingsJson]'); process.exit(1); }
            const settings = args[3] ? JSON.parse(args[3]) : {};
            const result = await bridge.runProcess(args[1], args[2], settings);
            console.log(JSON.stringify(result, null, 2));
            break;
         }
         case 'color-balance': {
            if (!args[1]) { console.error('Usage: color-balance <windowId>'); process.exit(1); }
            const cbResult = await bridge.colorBalance(args[1]);
            console.log('Color balance applied to', cbResult.target);
            console.log('  Scale factors: R=' + cbResult.scaleFactors.R.toFixed(4) + ' B=' + cbResult.scaleFactors.B.toFixed(4));
            console.log('  Before medians:', fmtRGB(cbResult.before.medians));
            console.log('  After  medians:', fmtRGB(cbResult.after.medians));
            break;
         }
         case 'background-fix': {
            if (!args[1]) { console.error('Usage: background-fix <windowId>'); process.exit(1); }
            const bfResult = await bridge.backgroundFix(args[1]);
            console.log('Background fix applied to', bfResult.target);
            console.log('  Floors removed:', fmtRGB(bfResult.floorsRemoved));
            console.log('  After minimums:', fmtRGB(bfResult.after.minimums));
            break;
         }
         case 'dehalo': {
            if (!args[1]) { console.error('Usage: dehalo <windowId> [sigma] [amount]'); process.exit(1); }
            const dhOpts = {};
            if (args[2]) dhOpts.sigma = parseFloat(args[2]);
            if (args[3]) dhOpts.amount = parseFloat(args[3]);
            const dhResult = await bridge.dehalo(args[1], dhOpts);
            console.log('Dehalo applied to', dhResult.target, '(sigma=' + dhResult.sigma + ', amount=' + dhResult.amount + ')');
            break;
         }
         case 'noise-reduction': {
            if (!args[1]) { console.error('Usage: noise-reduction <windowId>'); process.exit(1); }
            const nrResult = await bridge.noiseReduction(args[1]);
            console.log('Noise reduction applied to', nrResult.target);
            console.log('  Luminance:   sigma=' + nrResult.luminance.sigma + ' amount=' + nrResult.luminance.amount);
            console.log('  Chrominance: sigma=' + nrResult.chrominance.sigma + ' amount=' + nrResult.chrominance.amount);
            break;
         }
         case 'star-reduction': {
            if (!args[1]) { console.error('Usage: star-reduction <windowId>'); process.exit(1); }
            const srResult = await bridge.starReduction(args[1]);
            console.log('Star reduction applied to', srResult.target);
            console.log('  Iterations=' + srResult.iterations + ' amount=' + srResult.amount);
            break;
         }
         case 'enhance': {
            if (!args[1]) { console.error('Usage: enhance <windowId>'); process.exit(1); }
            const enResult = await bridge.enhance(args[1]);
            console.log('Enhancement applied to', enResult.target);
            enResult.stepsApplied.forEach(function(s) { console.log('  ' + s); });
            break;
         }
         case 'pipeline': {
            if (!args[1]) { console.error('Usage: pipeline <windowId>'); process.exit(1); }
            const id = args[1];
            console.log('Running full pipeline on', id, '...\n');

            console.log('1/10 Analyzing...');
            const stats = await bridge.getImageStatistics(id);
            console.log('     ' + stats.width + 'x' + stats.height + ' ' + stats.numberOfChannels + 'ch\n');

            console.log('2/10 Color balance...');
            await bridge.colorBalance(id);
            console.log('     Done\n');

            console.log('3/10 Background fix...');
            const bf = await bridge.backgroundFix(id);
            console.log('     Floors removed:', fmtRGB(bf.floorsRemoved), '\n');

            console.log('4/10 Color balance (post-bgfix)...');
            await bridge.colorBalance(id);
            console.log('     Done\n');

            console.log('5/10 Dehalo...');
            await bridge.dehalo(id);
            console.log('     Done\n');

            console.log('6/10 Color balance (post-dehalo)...');
            await bridge.colorBalance(id);
            console.log('     Done\n');

            console.log('7/10 Noise reduction...');
            await bridge.noiseReduction(id);
            console.log('     Done\n');

            console.log('8/10 Color balance (post-NR)...');
            await bridge.colorBalance(id);
            console.log('     Done\n');

            console.log('9/10 Star reduction...');
            await bridge.starReduction(id);
            console.log('     Done\n');

            console.log('10/10 Enhance...');
            const en = await bridge.enhance(id);
            en.stepsApplied.forEach(function(s) { console.log('      ' + s); });

            console.log('\nPipeline complete!');
            break;
         }
         case 'scan': {
            if (!args[1]) { console.error('Usage: scan <directory> [--json]'); process.exit(1); }
            const session = scanDirectory(args[1]);
            if (args.includes('--json')) {
               console.log(JSON.stringify(session.toJSON(), null, 2));
            } else {
               console.log(session.summary());
            }
            break;
         }
         case 'stack': {
            if (!args[1]) { console.error('Usage: stack <directory> [outputDir]'); process.exit(1); }
            const stackSession_ = scanDirectory(args[1]);
            console.log(stackSession_.summary());
            console.log('');

            const stackOpts = {};
            if (args[2] && !args[2].startsWith('--')) stackOpts.outputDir = args[2];

            const byFilter = stackSession_.byFilter();
            const filterCount = Object.keys(byFilter).length;

            let result;
            if (filterCount > 1) {
               console.log('Stacking ' + filterCount + ' filters separately...\n');
               result = await stackByFilter(stackSession_, stackOpts);
            } else {
               result = await stackSession(stackSession_, stackOpts);
            }

            console.log('\nStacking complete!');
            if (result.resultPath) {
               console.log('Result: ' + result.resultPath);
            } else {
               for (const [filter, r] of Object.entries(result)) {
                  console.log('  ' + filter + ': ' + r.resultPath);
               }
            }
            break;
         }
         case 'classify': {
            if (!args[1]) { console.error('Usage: classify <windowId>'); process.exit(1); }
            const classResult = await classifyTarget(args[1], {
               plateSolve: !args.includes('--no-solve')
            });
            console.log('');
            console.log('Target: ' + classResult.target.name);
            if (classResult.target.aliases && classResult.target.aliases.length > 0) {
               console.log('Also known as: ' + classResult.target.aliases.join(', '));
            }
            console.log('Type: ' + classResult.target.type);
            console.log('Identified by: ' + classResult.method);
            if (classResult.target.notes) console.log('Notes: ' + classResult.target.notes);
            console.log('');
            console.log('Processing profile: ' + classResult.profile.name);
            console.log('  Stretch: ' + classResult.profile.stretch);
            console.log('  Combination: ' + classResult.profile.combination);
            if (classResult.profile.focus) {
               console.log('  Focus:');
               classResult.profile.focus.forEach(function(f) { console.log('    - ' + f); });
            }
            const p = classResult.profile.processing;
            if (p) {
               console.log('  LHE: radius=' + p.lheRadius + ' slope=' + p.lheSlopeLimit + ' amount=' + p.lheAmount);
               console.log('  Stars: ' + (p.starReduction.iterations > 0
                  ? p.starReduction.iterations + ' iterations, ' + (p.starReduction.amount * 100) + '% amount'
                  : 'no reduction (stars are the subject)'));
               console.log('  NR: luminance sigma=' + p.noiseReduction.sigmaL + ', chrominance sigma=' + p.noiseReduction.sigmaC);
            }
            break;
         }
         case 'lookup': {
            if (!args[1]) { console.error('Usage: lookup <name>'); process.exit(1); }
            const searchName = args.slice(1).join(' ');
            const entry = lookupByName(searchName);
            if (entry) {
               console.log('Found: ' + entry.names[0]);
               if (entry.names.length > 1) console.log('Aliases: ' + entry.names.slice(1).join(', '));
               console.log('Type: ' + entry.type);
               console.log('RA: ' + entry.ra.toFixed(3) + 'h  DEC: ' + (entry.dec >= 0 ? '+' : '') + entry.dec.toFixed(3) + '°');
               console.log('Size: ' + entry.size + ' arcmin');
               if (entry.notes) console.log('Notes: ' + entry.notes);
            } else {
               console.log('Not found in catalog: ' + searchName);
            }
            break;
         }
         case 'tools': {
            const tools = await checkTools();
            console.log('Installed processes:');
            for (const [name, installed] of Object.entries(tools)) {
               console.log('  ' + (installed ? '+' : '-') + ' ' + name);
            }
            break;
         }
         case 'linear': {
            if (!args[1]) { console.error('Usage: linear <windowId> [--stars] [--no-gradient] [--no-color] [--no-nr] [--no-deconv]'); process.exit(1); }
            const linOpts = {
               extractStars: args.includes('--stars'),
               gradientRemoval: !args.includes('--no-gradient'),
               colorCalibration: !args.includes('--no-color'),
               noiseReduction: !args.includes('--no-nr'),
               deconvolution: !args.includes('--no-deconv')
            };
            const linResult = await linearPreprocess(args[1], linOpts);
            console.log('');
            console.log('Steps:');
            for (const step of linResult.steps) {
               const icon = step.method === 'skipped' ? '~' : step.method === 'failed' ? 'x' : '+';
               console.log('  ' + icon + ' ' + step.step + ': ' + step.method);
            }
            break;
         }
         case 'shutdown': {
            await bridge.shutdown();
            console.log('Shutdown sentinel written. Watcher will stop on next poll.');
            break;
         }
         default:
            console.error('Unknown command: ' + command);
            process.exit(1);
      }
   } catch (e) {
      console.error('Error:', e.message);
      process.exit(1);
   }
}

main();

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
const { creativePipeline } = require('../lib/creative-pipeline');
const { scoreImage } = require('../lib/scorer');
const { writeReport } = require('../lib/report');
const { annotateImage, buildAnnotationData } = require('../lib/annotate');
const { getPlatformInfo } = require('../lib/platform');
const config = require('../lib/config');
const equipment = require('../lib/equipment');
const recipes = require('../lib/recipes');
const memory = require('../lib/memory');
const astrobin = require('../lib/astrobin');
const { validateSession } = require('../lib/validator');

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
   console.log('End-to-end:');
   console.log('  auto <directory>              Full pipeline: scan, validate, stack, process, score, report');
   console.log('  auto <directory> --force      Proceed despite validation errors');
   console.log('  auto <directory> --no-annotate  Skip watermark/info panel');
   console.log('  auto-open <windowId>          Full pipeline on an already-open image');
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
   console.log('  validate <directory>          Check calibration compatibility before stacking');
   console.log('  validate <directory> --json   Same, but output as JSON');
   console.log('  stack <directory> [outDir]    Calibrate, register, and stack');
   console.log('  stack <dir> --force           Stack despite validation errors');
   console.log('  linear <windowId>            Linear pre-processing (gradients, color cal, NR)');
   console.log('  classify <windowId>          Identify target and select processing profile');
   console.log('  lookup <name>                Look up a target in the built-in catalog');
   console.log('  creative <windowId>          Run adaptive creative processing pipeline');
   console.log('  score <windowId>             Score image quality (8 dimensions + gates)');
   console.log('  report <windowId> [outDir]   Generate processing report (HTML + MD + JSON)');
   console.log('  annotate <windowId>          Add watermark, info panel, and metadata');
   console.log('  tools                        Check which PI processes are installed');
   console.log('');
   console.log('Setup:');
   console.log('  init                          First-run setup wizard');
   console.log('  config                        Show current configuration');
   console.log('  config set <key> <value>      Set a config value');
   console.log('  info                          Show platform and install details');
   console.log('  install-watcher [piPath]      Install watcher to PixInsight scripts');
   console.log('');
   console.log('Equipment:');
   console.log('  equipment list                List saved equipment profiles');
   console.log('  equipment show <name>         Show a profile');
   console.log('  equipment create <name>       Create a new profile (JSON on stdin)');
   console.log('  equipment delete <name>       Delete a profile');
   console.log('');
   console.log('Recipes:');
   console.log('  recipe list                   List saved processing recipes');
   console.log('  recipe show <name>            Show a recipe');
   console.log('  recipe delete <name>          Delete a recipe');
   console.log('  recipe export <name> <file>   Export a recipe to a file');
   console.log('  recipe import <file>          Import a recipe from a file');
   console.log('');
   console.log('Learning:');
   console.log('  history                       Show processing session history');
   console.log('  learnings [targetType]        Show what AstroPilot has learned');
   console.log('  suggest <targetType>          Get parameter suggestions from past sessions');
   console.log('  progress                      Show skill progression and milestones');
   console.log('');
   console.log('AstroBin:');
   console.log('  astrobin-desc <windowId>      Generate AstroBin description');
   console.log('  astrobin-upload <file>        Upload image to AstroBin');
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
         case 'auto': {
            if (!args[1]) { console.error('Usage: auto <directory> [--force] [--no-annotate] [--author="Name"]'); process.exit(1); }
            const autoDir = args[1];
            const autoForce = args.includes('--force');
            const autoAnnotate = !args.includes('--no-annotate');
            const autoSavedCfg = config.getConfig();

            const autoOpts = {};
            for (const arg of args.slice(2)) {
               if (arg.startsWith('--author=')) autoOpts.author = arg.slice(9).replace(/^"|"$/g, '');
               if (arg.startsWith('--location=')) autoOpts.location = arg.slice(11).replace(/^"|"$/g, '');
               if (arg.startsWith('--bortle=')) autoOpts.bortle = arg.slice(9);
               if (arg.startsWith('--output=')) autoOpts.outputDir = arg.slice(9).replace(/^"|"$/g, '');
            }
            if (!autoOpts.author && autoSavedCfg.author) autoOpts.author = autoSavedCfg.author;
            if (!autoOpts.location && autoSavedCfg.location) autoOpts.location = autoSavedCfg.location;
            if (!autoOpts.bortle && autoSavedCfg.bortle) autoOpts.bortle = String(autoSavedCfg.bortle);

            console.log('AstroPilot — Full Pipeline');
            console.log('=========================');
            console.log('');

            // --- Preflight: watcher check ---
            console.log('[1/9] Checking watcher...');
            if (!bridge.isWatcherRunning()) {
               console.error('');
               console.error('The PixInsight watcher is not running.');
               console.error('Open PixInsight, go to Script > Run, and select bridge/pjsr/watcher.js');
               console.error('Then run this command again.');
               process.exit(1);
            }
            try {
               await bridge.ping();
               console.log('      Watcher is alive.');
            } catch (e) {
               console.error('      Watcher PID file exists but ping failed: ' + e.message);
               console.error('      Restart the watcher in PixInsight and try again.');
               process.exit(1);
            }
            console.log('');

            // --- Step 1: Scan ---
            console.log('[2/9] Scanning ' + autoDir + '...');
            const autoSession = scanDirectory(autoDir);
            console.log(autoSession.summary());
            console.log('');

            // --- Step 2: Validate ---
            console.log('[3/9] Validating calibration frames...');
            const autoValidation = validateSession(autoSession);
            if (autoValidation.errors().length > 0) {
               console.log(autoValidation.summary());
               console.log('');
               if (!autoForce) {
                  console.error('Fix the errors above or re-run with --force to proceed anyway.');
                  process.exit(1);
               }
               console.log('WARNING: Proceeding despite errors (--force).');
               console.log('');
            } else if (autoValidation.warnings().length > 0) {
               for (const w of autoValidation.warnings()) {
                  console.log('  [WARN] ' + w.message);
               }
               console.log('');
            } else {
               console.log('      All checks passed.');
               console.log('');
            }

            // --- Step 3: Stack ---
            console.log('[4/9] Stacking...');
            const autoStackOpts = {
               skipValidation: true,  // already validated above
               forceStack: autoForce
            };
            if (autoOpts.outputDir) autoStackOpts.outputDir = autoOpts.outputDir;

            const autoByFilter = autoSession.byFilter();
            const autoFilterCount = Object.keys(autoByFilter).length;
            let autoStackResult;
            if (autoFilterCount > 1) {
               console.log('      ' + autoFilterCount + ' filters — stacking separately...');
               autoStackResult = await stackByFilter(autoSession, autoStackOpts);
            } else {
               autoStackResult = await stackSession(autoSession, autoStackOpts);
            }

            // Determine the result window ID
            let autoWindowId;
            if (autoStackResult.resultWindowId) {
               autoWindowId = autoStackResult.resultWindowId;
            } else if (autoStackResult.resultPath) {
               // Single-filter result — the window should still be open
               // The stacker leaves it open with the resultWindowId
               autoWindowId = autoStackResult.resultWindowId;
            } else {
               // Multi-filter: find the first result
               for (const [filter, r] of Object.entries(autoStackResult)) {
                  if (r.resultWindowId) {
                     autoWindowId = r.resultWindowId;
                     console.log('      Using ' + filter + ' stack: ' + autoWindowId);
                     break;
                  }
               }
            }

            if (!autoWindowId) {
               // Fall back to listing open images
               const openImages = await bridge.listOpenImages();
               if (openImages.count > 0) {
                  autoWindowId = openImages.windows[openImages.windows.length - 1].id;
                  console.log('      Using most recent open image: ' + autoWindowId);
               } else {
                  console.error('      Stacking completed but no open image found.');
                  process.exit(1);
               }
            }
            console.log('      Stacked: ' + autoWindowId);
            console.log('');

            // --- Step 4: Linear pre-processing ---
            console.log('[5/9] Linear pre-processing...');
            const autoLinResult = await linearPreprocess(autoWindowId, {
               extractStars: false,
               gradientRemoval: true,
               colorCalibration: true,
               noiseReduction: true,
               deconvolution: true
            });
            for (const step of autoLinResult.steps) {
               const icon = step.method === 'skipped' ? '~' : step.method === 'failed' ? 'x' : '+';
               console.log('      ' + icon + ' ' + step.step + ': ' + step.method);
            }
            console.log('');

            // --- Step 5: Classify ---
            console.log('[6/9] Classifying target...');
            const autoClassResult = await classifyTarget(autoWindowId, { plateSolve: true });
            console.log('      Target: ' + autoClassResult.target.name + ' (' + autoClassResult.target.type + ')');
            console.log('      Profile: ' + autoClassResult.profile.name);
            console.log('      Stretch: ' + autoClassResult.profile.stretch);
            console.log('');

            // --- Step 6: Creative processing ---
            console.log('[7/9] Creative processing...');
            const autoCreativeResult = await creativePipeline(autoWindowId, autoClassResult.profile, {});
            console.log('      ' + autoCreativeResult.steps.length + ' steps completed.');
            console.log('');

            // --- Step 7: Score ---
            console.log('[8/9] Scoring...');
            const autoScoreResult = await scoreImage(autoWindowId, {
               targetType: autoClassResult.target.type
            });
            console.log('');
            console.log('      Overall: ' + autoScoreResult.overall + '/100');
            console.log('      Gates: ' + (autoScoreResult.gatesPassed ? 'ALL PASSED' : 'SOME FAILED'));
            console.log('');

            // --- Step 8: Report + Annotate ---
            console.log('[9/9] Output...');
            const autoReportDir = autoOpts.outputDir || (autoSession.dir + '/AstroPilot_output');
            const autoReportData = {
               target: autoClassResult.target,
               classification: autoClassResult,
               scores: autoScoreResult.scores,
               overall: autoScoreResult.overall,
               gates: autoScoreResult.gates,
               creativeSteps: autoCreativeResult.steps,
               linearSteps: autoLinResult.steps
            };
            const autoReportPaths = writeReport(autoReportData, autoReportDir);
            console.log('      Report: ' + autoReportPaths.html);

            // Annotate
            if (autoAnnotate && autoOpts.author) {
               const autoAnnData = buildAnnotationData(autoClassResult, autoSession, autoOpts);
               const autoAnnOpts = {};
               if (autoAnnData.watermark) autoAnnOpts.watermark = autoAnnData.watermark;
               if (autoAnnData.infoPanel) autoAnnOpts.infoPanel = autoAnnData.infoPanel;
               if (autoAnnData.metadata) autoAnnOpts.metadata = autoAnnData.metadata;
               const autoAnnResult = await annotateImage(autoWindowId, autoAnnOpts);
               if (autoAnnResult.finalTargetId !== autoWindowId) {
                  console.log('      Annotated: ' + autoAnnResult.finalTargetId);
               } else {
                  console.log('      Annotated.');
               }
            }

            // --- Log session and save recipe ---
            memory.logSession({
               target: autoClassResult.target.name,
               targetType: autoClassResult.target.type,
               profileName: autoClassResult.profile.name,
               stretch: autoClassResult.profile.stretch,
               processing: autoClassResult.profile.processing,
               score: autoScoreResult.overall,
               gatesPassed: autoScoreResult.gatesPassed,
               linearSteps: autoLinResult.steps,
               creativeSteps: autoCreativeResult.steps
            });

            const autoRecipeName = (autoClassResult.target.name + '-' + new Date().toISOString().split('T')[0])
               .replace(/\s+/g, '-').toLowerCase();
            const autoRecipe = recipes.buildRecipeFromResults(
               autoRecipeName,
               autoClassResult,
               autoLinResult,
               autoCreativeResult,
               autoScoreResult,
               { author: autoOpts.author }
            );
            recipes.saveRecipe(autoRecipe);

            // --- Done ---
            console.log('');
            console.log('========================================');
            console.log('  Done!');
            console.log('  Target:  ' + autoClassResult.target.name);
            console.log('  Score:   ' + autoScoreResult.overall + '/100');
            console.log('  Gates:   ' + (autoScoreResult.gatesPassed ? 'all passed' : 'some failed'));
            console.log('  Report:  ' + autoReportPaths.html);
            console.log('  Recipe:  ' + autoRecipeName);
            console.log('  Image:   ' + autoWindowId);
            console.log('========================================');
            break;
         }
         case 'auto-open': {
            if (!args[1]) { console.error('Usage: auto-open <windowId> [--linear] [--no-annotate] [--author="Name"]'); process.exit(1); }
            const aoId = args[1];
            const aoLinear = args.includes('--linear');
            const aoAnnotate = !args.includes('--no-annotate');
            const aoSavedCfg = config.getConfig();

            const aoOpts = {};
            for (const arg of args.slice(2)) {
               if (arg.startsWith('--author=')) aoOpts.author = arg.slice(9).replace(/^"|"$/g, '');
               if (arg.startsWith('--location=')) aoOpts.location = arg.slice(11).replace(/^"|"$/g, '');
               if (arg.startsWith('--bortle=')) aoOpts.bortle = arg.slice(9);
               if (arg.startsWith('--output=')) aoOpts.outputDir = arg.slice(9).replace(/^"|"$/g, '');
            }
            if (!aoOpts.author && aoSavedCfg.author) aoOpts.author = aoSavedCfg.author;
            if (!aoOpts.location && aoSavedCfg.location) aoOpts.location = aoSavedCfg.location;
            if (!aoOpts.bortle && aoSavedCfg.bortle) aoOpts.bortle = String(aoSavedCfg.bortle);

            console.log('AstroPilot — Process Open Image');
            console.log('===============================');
            console.log('');

            // Preflight
            console.log('[1] Checking watcher...');
            try {
               await bridge.ping();
               console.log('    Watcher is alive.');
            } catch (e) {
               console.error('    Watcher is not responding: ' + e.message);
               console.error('    Start the watcher in PixInsight and try again.');
               process.exit(1);
            }
            console.log('');

            // Verify image exists
            console.log('[2] Checking image...');
            try {
               const aoStats = await bridge.getImageStatistics(aoId);
               console.log('    ' + aoStats.width + 'x' + aoStats.height + ', ' + aoStats.numberOfChannels + ' channels');
            } catch (e) {
               console.error('    Image not found: ' + aoId);
               console.error('    Open images:');
               try {
                  const aoImages = await bridge.listOpenImages();
                  for (const w of aoImages.windows) {
                     console.error('      ' + w.id);
                  }
               } catch { /* ignore */ }
               process.exit(1);
            }
            console.log('');

            // Linear (optional)
            let aoLinResult = { steps: [] };
            if (aoLinear) {
               console.log('[3] Linear pre-processing...');
               aoLinResult = await linearPreprocess(aoId, {
                  extractStars: false,
                  gradientRemoval: true,
                  colorCalibration: true,
                  noiseReduction: true,
                  deconvolution: true
               });
               for (const step of aoLinResult.steps) {
                  const icon = step.method === 'skipped' ? '~' : step.method === 'failed' ? 'x' : '+';
                  console.log('    ' + icon + ' ' + step.step + ': ' + step.method);
               }
               console.log('');
            }

            // Classify
            console.log(aoLinear ? '[4] Classifying...' : '[3] Classifying...');
            const aoClassResult = await classifyTarget(aoId, { plateSolve: true });
            console.log('    Target: ' + aoClassResult.target.name + ' (' + aoClassResult.target.type + ')');
            console.log('    Profile: ' + aoClassResult.profile.name);
            console.log('');

            // Creative
            console.log(aoLinear ? '[5] Creative processing...' : '[4] Creative processing...');
            const aoCreativeResult = await creativePipeline(aoId, aoClassResult.profile, {});
            console.log('    ' + aoCreativeResult.steps.length + ' steps completed.');
            console.log('');

            // Score
            console.log(aoLinear ? '[6] Scoring...' : '[5] Scoring...');
            const aoScoreResult = await scoreImage(aoId, {
               targetType: aoClassResult.target.type
            });
            console.log('');
            console.log('    Overall: ' + aoScoreResult.overall + '/100');
            console.log('    Gates: ' + (aoScoreResult.gatesPassed ? 'ALL PASSED' : 'SOME FAILED'));
            console.log('');

            // Report
            console.log(aoLinear ? '[7] Output...' : '[6] Output...');
            const aoReportDir = aoOpts.outputDir || '.';
            const aoReportData = {
               target: aoClassResult.target,
               classification: aoClassResult,
               scores: aoScoreResult.scores,
               overall: aoScoreResult.overall,
               gates: aoScoreResult.gates,
               creativeSteps: aoCreativeResult.steps,
               linearSteps: aoLinResult.steps
            };
            const aoReportPaths = writeReport(aoReportData, aoReportDir);
            console.log('    Report: ' + aoReportPaths.html);

            // Annotate
            if (aoAnnotate && aoOpts.author) {
               const aoAnnData = buildAnnotationData(aoClassResult, null, aoOpts);
               const aoAnnOpts = {};
               if (aoAnnData.watermark) aoAnnOpts.watermark = aoAnnData.watermark;
               if (aoAnnData.infoPanel) aoAnnOpts.infoPanel = aoAnnData.infoPanel;
               if (aoAnnData.metadata) aoAnnOpts.metadata = aoAnnData.metadata;
               await annotateImage(aoId, aoAnnOpts);
               console.log('    Annotated.');
            }

            // Log session
            memory.logSession({
               target: aoClassResult.target.name,
               targetType: aoClassResult.target.type,
               profileName: aoClassResult.profile.name,
               stretch: aoClassResult.profile.stretch,
               processing: aoClassResult.profile.processing,
               score: aoScoreResult.overall,
               gatesPassed: aoScoreResult.gatesPassed,
               linearSteps: aoLinResult.steps,
               creativeSteps: aoCreativeResult.steps
            });

            console.log('');
            console.log('========================================');
            console.log('  Done!');
            console.log('  Target:  ' + aoClassResult.target.name);
            console.log('  Score:   ' + aoScoreResult.overall + '/100');
            console.log('  Gates:   ' + (aoScoreResult.gatesPassed ? 'all passed' : 'some failed'));
            console.log('  Report:  ' + aoReportPaths.html);
            console.log('  Image:   ' + aoId);
            console.log('========================================');
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
         case 'validate': {
            if (!args[1]) { console.error('Usage: validate <directory> [--json]'); process.exit(1); }
            const valSession = scanDirectory(args[1]);
            const valReport = validateSession(valSession);
            if (args.includes('--json')) {
               console.log(JSON.stringify(valReport.toJSON(), null, 2));
            } else {
               console.log(valReport.summary());
            }
            process.exit(valReport.canProceed() ? 0 : 1);
            break;
         }
         case 'stack': {
            if (!args[1]) { console.error('Usage: stack <directory> [outputDir] [--force] [--skip-validation]'); process.exit(1); }
            const stackSession_ = scanDirectory(args[1]);
            console.log(stackSession_.summary());
            console.log('');

            const stackOpts = {};
            if (args[2] && !args[2].startsWith('--')) stackOpts.outputDir = args[2];
            if (args.includes('--force')) stackOpts.forceStack = true;
            if (args.includes('--skip-validation')) stackOpts.skipValidation = true;

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
         case 'score': {
            if (!args[1]) { console.error('Usage: score <windowId>'); process.exit(1); }
            const scoreId = args[1];

            // Classify first to get target type for scoring context
            console.log('Classifying target...');
            const scoreClassInfo = await classifyTarget(scoreId, { plateSolve: false });
            console.log('Target: ' + scoreClassInfo.target.name + ' (' + scoreClassInfo.target.type + ')');
            console.log('');

            await scoreImage(scoreId, { targetType: scoreClassInfo.target.type });
            break;
         }
         case 'report': {
            if (!args[1]) { console.error('Usage: report <windowId> [outputDir]'); process.exit(1); }
            const reportId = args[1];
            const reportDir = args[2] || '.';

            // Classify
            console.log('Classifying target...');
            const reportClassInfo = await classifyTarget(reportId, { plateSolve: false });

            // Score
            console.log('Scoring image...');
            const reportScore = await scoreImage(reportId, { targetType: reportClassInfo.target.type });

            // Build report data
            const reportData = {
               target: reportClassInfo.target,
               classification: reportClassInfo,
               scores: reportScore.scores,
               overall: reportScore.overall,
               gates: reportScore.gates,
               creativeSteps: reportScore.measurements ? [] : []
            };

            // Write
            const paths = writeReport(reportData, reportDir);
            console.log('');
            console.log('Reports written:');
            console.log('  HTML:     ' + paths.html);
            console.log('  Markdown: ' + paths.markdown);
            console.log('  JSON:     ' + paths.json);
            break;
         }
         case 'annotate': {
            if (!args[1]) { console.error('Usage: annotate <windowId> [--author="Name"] [--location="Place"] [--bortle=4] [--no-panel] [--no-watermark]'); process.exit(1); }
            const annId = args[1];

            // Parse options (fall back to saved config)
            const savedConfig = config.getConfig();
            const annOpts = {};
            if (savedConfig.author) annOpts.author = savedConfig.author;
            if (savedConfig.location) annOpts.location = savedConfig.location;
            if (savedConfig.bortle) annOpts.bortle = String(savedConfig.bortle);
            for (const arg of args.slice(2)) {
               if (arg.startsWith('--author=')) annOpts.author = arg.slice(9).replace(/^"|"$/g, '');
               if (arg.startsWith('--location=')) annOpts.location = arg.slice(11).replace(/^"|"$/g, '');
               if (arg.startsWith('--bortle=')) annOpts.bortle = arg.slice(9);
            }
            const noPanel = args.includes('--no-panel');
            const noWatermark = args.includes('--no-watermark');

            // Classify target
            console.log('Classifying target...');
            const annClassInfo = await classifyTarget(annId, { plateSolve: false });

            // Build annotation data
            const annData = buildAnnotationData(annClassInfo, null, annOpts);

            const annotateOpts = {};
            if (!noWatermark && annData.watermark) annotateOpts.watermark = annData.watermark;
            if (!noPanel && annData.infoPanel) annotateOpts.infoPanel = annData.infoPanel;
            if (annData.metadata) annotateOpts.metadata = annData.metadata;

            const annResult = await annotateImage(annId, annotateOpts);

            console.log('');
            console.log('Annotation complete:');
            for (const step of annResult.steps) {
               if (step.step === 'metadata') console.log('  Metadata: ' + step.keywords + ' keywords embedded');
               if (step.step === 'watermark') console.log('  Watermark: "' + step.text + '" at ' + step.position);
               if (step.step === 'info_panel') console.log('  Info panel: ' + step.lines + ' lines, new window: ' + step.newWindow);
            }
            console.log('  Final image: ' + annResult.finalTargetId);
            break;
         }
         case 'creative': {
            if (!args[1]) { console.error('Usage: creative <windowId> [--ha=<id>] [--oiii=<id>] [--stars=<id>]'); process.exit(1); }
            const creativeId = args[1];

            // Parse optional narrowband/stars window args
            const creativeOpts = {};
            for (const arg of args.slice(2)) {
               if (arg.startsWith('--ha=')) creativeOpts.haWindowId = arg.slice(5);
               if (arg.startsWith('--oiii=')) creativeOpts.oiiiWindowId = arg.slice(7);
               if (arg.startsWith('--stars=')) creativeOpts.starsId = arg.slice(8);
            }

            // Classify target to get profile
            console.log('Classifying target...');
            const classInfo = await classifyTarget(creativeId, { plateSolve: false });
            console.log('Target: ' + classInfo.target.name + ' (' + classInfo.target.type + ')');
            console.log('Profile: ' + classInfo.profile.name);
            console.log('');

            const creativeResult = await creativePipeline(creativeId, classInfo.profile, creativeOpts);
            console.log('');
            console.log('Steps completed: ' + creativeResult.steps.length);
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
         case 'init': {
            await config.runSetupWizard();
            break;
         }
         case 'config': {
            if (args[1] === 'set') {
               if (!args[2] || !args[3]) { console.error('Usage: config set <key> <value>'); process.exit(1); }
               const val = args[3] === 'true' ? true : args[3] === 'false' ? false : isNaN(args[3]) ? args[3] : Number(args[3]);
               config.set(args[2], val);
               console.log(args[2] + ' = ' + JSON.stringify(val));
            } else {
               config.displayConfig();
            }
            break;
         }
         case 'info': {
            const info = getPlatformInfo();
            console.log('Platform:     ' + info.platform + ' (' + info.arch + ')');
            console.log('Node.js:      ' + info.nodeVersion);
            console.log('Home:         ' + info.homeDir);
            console.log('AstroPilot:   ' + info.astropilotDir);
            console.log('');
            if (info.pixinsight) {
               console.log('PixInsight:   ' + info.pixinsight.path);
               if (info.pixinsight.executable) console.log('  Executable: ' + info.pixinsight.executable);
               if (info.pixinsight.scriptsDir) console.log('  Scripts:    ' + info.pixinsight.scriptsDir);
            } else {
               console.log('PixInsight:   not found (run "astropilot init" to configure)');
            }
            break;
         }
         case 'install-watcher': {
            const piPath = args[1] || config.get('pixinsight.path');
            if (!piPath) {
               console.error('No PixInsight path configured. Run "astropilot init" first or pass a path.');
               process.exit(1);
            }
            const installResult = config.installWatcherScript(piPath);
            if (installResult.success) {
               console.log('Watcher installed: ' + installResult.path);
               console.log('Open PixInsight, go to Script > Run, and select this file.');
            } else {
               console.error('Install failed: ' + installResult.error);
               process.exit(1);
            }
            break;
         }
         case 'equipment': {
            const eqCmd = args[1];
            if (!eqCmd || eqCmd === 'list') {
               const profiles = equipment.listProfiles();
               if (profiles.length === 0) {
                  console.log('No equipment profiles saved.');
                  console.log('Create one: astropilot equipment create "my-rig"');
               } else {
                  console.log(profiles.length + ' equipment profile(s):');
                  for (const name of profiles) {
                     const p = equipment.loadProfile(name);
                     const summary = equipment.getEquipmentSummary(p);
                     console.log('  ' + name + (summary ? '  (' + summary + ')' : ''));
                  }
               }
            } else if (eqCmd === 'show') {
               if (!args[2]) { console.error('Usage: equipment show <name>'); process.exit(1); }
               const profile = equipment.loadProfile(args[2]);
               equipment.displayProfile(profile);
            } else if (eqCmd === 'create') {
               if (!args[2]) { console.error('Usage: equipment create <name> [jsonFile]'); process.exit(1); }
               const eqName = args[2];
               let eqOpts = {};
               if (args[3]) {
                  // Read options from JSON file
                  const fs = require('fs');
                  eqOpts = JSON.parse(fs.readFileSync(args[3], 'utf-8'));
               }
               const profile = equipment.createProfile(eqName, eqOpts);
               console.log('Created equipment profile: ' + eqName);
               equipment.displayProfile(profile);
            } else if (eqCmd === 'delete') {
               if (!args[2]) { console.error('Usage: equipment delete <name>'); process.exit(1); }
               if (equipment.deleteProfile(args[2])) {
                  console.log('Deleted: ' + args[2]);
               } else {
                  console.log('Profile not found: ' + args[2]);
               }
            } else {
               console.error('Unknown equipment command: ' + eqCmd);
               console.error('Try: list, show, create, delete');
               process.exit(1);
            }
            break;
         }
         case 'recipe': {
            const recCmd = args[1];
            if (!recCmd || recCmd === 'list') {
               const recs = recipes.listRecipes();
               if (recs.length === 0) {
                  console.log('No recipes saved yet.');
                  console.log('Recipes are created automatically when you run the creative pipeline.');
               } else {
                  console.log(recs.length + ' recipe(s):');
                  for (const r of recs) {
                     const score = r.score ? ' (score: ' + r.score.overall + ')' : '';
                     const type = r.targetType ? ' [' + r.targetType + ']' : '';
                     console.log('  ' + r.name + type + score);
                  }
               }
            } else if (recCmd === 'show') {
               if (!args[2]) { console.error('Usage: recipe show <name>'); process.exit(1); }
               const recipe = recipes.loadRecipe(args[2]);
               recipes.displayRecipe(recipe);
            } else if (recCmd === 'delete') {
               if (!args[2]) { console.error('Usage: recipe delete <name>'); process.exit(1); }
               if (recipes.deleteRecipe(args[2])) {
                  console.log('Deleted: ' + args[2]);
               } else {
                  console.log('Recipe not found: ' + args[2]);
               }
            } else if (recCmd === 'export') {
               if (!args[2] || !args[3]) { console.error('Usage: recipe export <name> <outputFile>'); process.exit(1); }
               const exported = recipes.exportRecipe(args[2], args[3]);
               if (exported) {
                  console.log('Exported to: ' + exported);
               } else {
                  console.log('Recipe not found: ' + args[2]);
               }
            } else if (recCmd === 'import') {
               if (!args[2]) { console.error('Usage: recipe import <file>'); process.exit(1); }
               const imported = recipes.importRecipe(args[2]);
               if (imported) {
                  console.log('Imported: ' + imported.recipe.name);
                  console.log('Saved to: ' + imported.path);
               } else {
                  console.log('Could not import: ' + args[2]);
               }
            } else {
               console.error('Unknown recipe command: ' + recCmd);
               console.error('Try: list, show, delete, export, import');
               process.exit(1);
            }
            break;
         }
         case 'history': {
            const stats = memory.getSessionStats();
            if (!stats) {
               console.log('No processing sessions recorded yet.');
               console.log('Sessions are logged automatically when you run the pipeline.');
            } else {
               console.log('Processing History');
               console.log('==================');
               console.log('Total sessions:  ' + stats.totalSessions);
               console.log('Scored sessions: ' + stats.scoredSessions);
               if (stats.averageScore) console.log('Average score:   ' + stats.averageScore);
               if (stats.bestScore) console.log('Best score:      ' + stats.bestScore);
               if (stats.gatePassRate !== null) console.log('Gate pass rate:  ' + stats.gatePassRate + '%');
               console.log('');
               console.log('First session:   ' + stats.firstSession);
               console.log('Last session:    ' + stats.lastSession);
               console.log('');
               if (Object.keys(stats.targetTypes).length > 0) {
                  console.log('Target types:');
                  for (const [type, count] of Object.entries(stats.targetTypes)) {
                     console.log('  ' + type + ': ' + count + ' session(s)');
                  }
               }
            }
            break;
         }
         case 'learnings': {
            const learningType = args[1];
            if (learningType) {
               const typeStats = memory.getTargetTypeStats(learningType);
               if (!typeStats) {
                  console.log('No sessions recorded for type: ' + learningType);
               } else {
                  console.log('Learnings for ' + learningType);
                  console.log('Sessions: ' + typeStats.sessionCount);
                  if (typeStats.averageScore) console.log('Average score: ' + typeStats.averageScore);
                  if (typeStats.bestScore) console.log('Best score: ' + typeStats.bestScore);
                  if (typeStats.scoreTrend !== 'insufficient_data') console.log('Trend: ' + typeStats.scoreTrend);
                  if (Object.keys(typeStats.targets).length > 0) {
                     console.log('');
                     console.log('Targets processed:');
                     for (const [name, count] of Object.entries(typeStats.targets)) {
                        console.log('  ' + name + ': ' + count + 'x');
                     }
                  }
               }
            } else {
               const learnings = memory.loadLearnings();
               if (Object.keys(learnings).length === 0) {
                  console.log('No learnings yet. Process some images first.');
               } else {
                  console.log('AstroPilot Learnings');
                  console.log('====================');
                  for (const [type, learning] of Object.entries(learnings)) {
                     if (type === '_global') continue;
                     console.log('');
                     console.log(type + ' (' + learning.sessionCount + ' sessions)');
                     if (learning.scores) {
                        console.log('  Scores: avg=' + learning.scores.average +
                           ' best=' + learning.scores.best +
                           ' trend=' + learning.scores.trend);
                     }
                     if (learning.bestStretch) {
                        console.log('  Best stretch: ' + learning.bestStretch.method +
                           ' (avg score ' + learning.bestStretch.averageScore + ')');
                     }
                     if (learning.gatePassRate !== undefined) {
                        console.log('  Gate pass rate: ' + learning.gatePassRate + '%');
                     }
                  }
                  if (learnings._global && learnings._global.totalSessions) {
                     console.log('');
                     console.log('Global: ' + learnings._global.totalSessions + ' sessions, avg score ' +
                        learnings._global.averageScore + ', trend ' + learnings._global.trend);
                  }
               }
            }
            break;
         }
         case 'suggest': {
            if (!args[1]) { console.error('Usage: suggest <targetType>'); process.exit(1); }
            const { getProfile } = require('../lib/profiles');
            const currentProfile = getProfile(args[1]);
            const suggestions = memory.suggestAdjustments(args[1], currentProfile);
            if (!suggestions) {
               console.log('Not enough data yet for suggestions on ' + args[1] + '.');
               console.log('Process more images of this type and AstroPilot will learn what works.');
            } else {
               console.log('Suggestions for ' + suggestions.targetType);
               console.log('Based on ' + suggestions.basedOn);
               if (suggestions.bestScore) console.log('Best score achieved: ' + suggestions.bestScore);
               console.log('');
               for (const s of suggestions.suggestions) {
                  console.log('  ' + s.parameter + ': ' + s.current + ' -> ' + s.suggested);
                  console.log('    ' + s.reason);
               }
            }
            break;
         }
         case 'progress': {
            const progression = memory.getSkillProgression();
            if (!progression) {
               console.log('Need at least 2 scored sessions to track progress.');
            } else {
               console.log('Skill Progression');
               console.log('=================');
               console.log('Level: ' + progression.level);
               console.log('Sessions: ' + progression.totalSessions);
               console.log('Current average: ' + progression.currentAverage + '/100');
               if (progression.improvement !== 0) {
                  const dir = progression.improvement > 0 ? '+' : '';
                  console.log('Improvement: ' + dir + progression.improvement + ' points since first sessions');
               }
               console.log('');

               if (progression.windows.length > 1) {
                  console.log('Progress over time:');
                  for (const w of progression.windows) {
                     const bar = '#'.repeat(Math.round(w.average / 5));
                     console.log('  ' + w.from.split('T')[0] + '  avg=' + w.average + '  best=' + w.best + '  ' + bar);
                  }
                  console.log('');
               }

               if (progression.milestones.length > 0) {
                  console.log('Milestones:');
                  for (const m of progression.milestones) {
                     const when = typeof m.achieved === 'string' ? m.achieved.split('T')[0] : 'yes';
                     console.log('  ' + m.name + ' (' + when + ')');
                  }
               }
            }
            break;
         }
         case 'astrobin-desc': {
            if (!args[1]) { console.error('Usage: astrobin-desc <windowId>'); process.exit(1); }
            console.log('Classifying target...');
            const abClassInfo = await classifyTarget(args[1], { plateSolve: false });
            const savedCfg = config.getConfig();
            const desc = astrobin.buildDescription(abClassInfo, null, null, {
               location: savedCfg.location,
               bortle: savedCfg.bortle
            });
            console.log('');
            console.log(desc);
            break;
         }
         case 'astrobin-upload': {
            if (!args[1]) { console.error('Usage: astrobin-upload <imagePath> [--title="Title"] [--wip]'); process.exit(1); }
            const uploadPath = args[1];
            const uploadOpts = { isWip: true };
            for (const arg of args.slice(2)) {
               if (arg.startsWith('--title=')) uploadOpts.title = arg.slice(8).replace(/^"|"$/g, '');
               if (arg === '--publish') uploadOpts.isWip = false;
            }

            // Generate description if we can classify
            let uploadDesc = '';
            try {
               // Try to classify from any open image to get target info
               const images = await bridge.listOpenImages();
               if (images.count > 0) {
                  const abClass = await classifyTarget(images.windows[0].id, { plateSolve: false });
                  uploadDesc = astrobin.buildDescription(abClass, null, null, {});
               }
            } catch {
               // No running PI instance, upload without description
            }

            console.log('Uploading to AstroBin...');
            const uploadResult = await astrobin.uploadToAstroBin(uploadPath, uploadDesc, uploadOpts);
            if (uploadResult.success) {
               console.log('Uploaded successfully!');
               console.log('URL: ' + uploadResult.url);
               if (uploadResult.isWip) console.log('(Uploaded as work-in-progress. Use --publish to publish directly.)');
            } else {
               console.error('Upload failed: ' + uploadResult.error);
               if (uploadResult.detail) console.error('Detail: ' + uploadResult.detail);
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

// AstroPilot Bridge — PixInsight Watcher Script
// ================================================
// Runs inside PixInsight as a long-lived polling loop.
// Watches ~/.astropilot/bridge/commands/ for JSON command files,
// executes them, and writes results to ~/.astropilot/bridge/results/.
//
// Start:  Run this script in PixInsight (Script > Run)
// Stop:   Create a file named "shutdown" in the commands directory,
//         or press the Cancel button in the progress dialog.
//
// Protocol:
//   Command file:  { id, command, params, timestamp }
//   Result file:   { id, status, result|error, timestamp, duration_ms }
//
// PJSR (ECMAScript 5) — no let/const/arrow/template literals.

// ---- Configuration ----

var BRIDGE_BASE = File.homeDirectory + "/.astropilot/bridge";
var COMMANDS_DIR = BRIDGE_BASE + "/commands";
var RESULTS_DIR = BRIDGE_BASE + "/results";
var POLL_INTERVAL_MS = 200;
var VERSION = "0.1.0";

// ---- Directory Setup ----

function ensureDirectory(path) {
   if (!File.directoryExists(path)) {
      File.createDirectory(path, true);
   }
}

// ---- File Helpers ----

function readTextFile(path) {
   var f = new File;
   f.openForReading(path);
   var size = f.size;
   var buf = f.read(DataType_ByteArray, size);
   f.close();
   var text = "";
   for (var i = 0; i < buf.length; i++) {
      text += String.fromCharCode(buf.at(i));
   }
   return text;
}

function writeTextFile(path, text) {
   var f = new File;
   f.createForWriting(path);
   f.outTextLn(text);
   f.close();
}

function deleteFile(path) {
   if (File.exists(path)) {
      File.remove(path);
   }
}

function nowMs() {
   return (new Date()).getTime();
}

// ---- Command Handlers ----

var handlers = {};

handlers.ping = function(params) {
   return {
      status: "ok",
      version: VERSION,
      pixinsight: CoreApplication.versionString || "unknown",
      uptime_ms: nowMs() - startTime
   };
};

handlers.list_open_images = function(params) {
   var windows = ImageWindow.windows;
   var list = [];
   for (var i = 0; i < windows.length; i++) {
      var w = windows[i];
      var img = w.mainView.image;
      list.push({
         id: w.mainView.id,
         width: img.width,
         height: img.height,
         channels: img.numberOfChannels,
         bitsPerSample: img.bitsPerSample,
         isFloat: img.isReal,
         filePath: w.filePath || ""
      });
   }
   return { windows: list, count: list.length };
};

handlers.get_image_statistics = function(params) {
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var img = w.mainView.image;
   var r = new Rect(img.width, img.height);
   var channelNames = ["R", "G", "B"];
   if (img.numberOfChannels === 1) channelNames = ["K"];

   var channels = [];
   for (var c = 0; c < img.numberOfChannels && c < 3; c++) {
      channels.push({
         name: channelNames[c],
         median: img.median(r, c, c),
         mean: img.mean(r, c, c),
         stdDev: img.stdDev(r, c, c),
         minimum: img.minimum(r, c, c),
         maximum: img.maximum(r, c, c)
      });
   }

   var keywords = [];
   var kw = w.keywords;
   for (var i = 0; i < kw.length; i++) {
      keywords.push({
         name: kw[i].name,
         value: kw[i].value,
         comment: kw[i].comment
      });
   }

   return {
      id: targetId,
      width: img.width,
      height: img.height,
      numberOfChannels: img.numberOfChannels,
      bitsPerSample: img.bitsPerSample,
      isFloat: img.isReal,
      channels: channels,
      keywords: keywords
   };
};

handlers.run_process = function(params) {
   var processName = params.process;
   if (!processName) throw new Error("Missing 'process' parameter");

   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   // Build process instance from name and parameters
   var P;
   try {
      P = eval("new " + processName);
   } catch (e) {
      throw new Error("Unknown process: " + processName);
   }

   // Set parameters from params.settings
   var settings = params.settings || {};
   for (var key in settings) {
      if (settings.hasOwnProperty(key)) {
         try {
            P[key] = settings[key];
         } catch (e) {
            throw new Error("Failed to set " + processName + "." + key + ": " + e.message);
         }
      }
   }

   P.executeOn(w.mainView);

   return {
      process: processName,
      target: targetId,
      applied: true
   };
};

// ---- Pipeline Command Handlers ----

handlers.color_balance = function(params) {
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var img = w.mainView.image;
   var r = new Rect(img.width, img.height);

   var medR = img.median(r, 0, 0);
   var medG = img.median(r, 1, 1);
   var medB = img.median(r, 2, 2);
   var stdR = img.stdDev(r, 0, 0);
   var stdG = img.stdDev(r, 1, 1);
   var stdB = img.stdDev(r, 2, 2);

   var before = {
      medians: { R: medR, G: medG, B: medB },
      stdDevs: { R: stdR, G: stdG, B: stdB }
   };

   var refMedian = medG;
   var scaleR = stdG / stdR;
   var scaleB = stdG / stdB;

   var PM = new PixelMath;
   PM.expression = "($T - " + medR.toFixed(8) + ") * " + scaleR.toFixed(8) + " + " + refMedian.toFixed(8);
   PM.expression1 = "$T";
   PM.expression2 = "($T - " + medB.toFixed(8) + ") * " + scaleB.toFixed(8) + " + " + refMedian.toFixed(8);
   PM.useSingleExpression = false;
   PM.generateOutput = true;
   PM.singleThreaded = false;
   PM.optimization = true;
   PM.use64BitWorkingImage = false;
   PM.rescale = false;
   PM.truncate = true;
   PM.truncateLower = 0;
   PM.truncateUpper = 1;
   PM.createNewImage = false;
   PM.executeOn(w.mainView);

   var after = {
      medians: { R: img.median(r, 0, 0), G: img.median(r, 1, 1), B: img.median(r, 2, 2) },
      stdDevs: { R: img.stdDev(r, 0, 0), G: img.stdDev(r, 1, 1), B: img.stdDev(r, 2, 2) }
   };

   return {
      target: targetId,
      scaleFactors: { R: scaleR, B: scaleB },
      before: before,
      after: after
   };
};

handlers.background_fix = function(params) {
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var img = w.mainView.image;
   var r = new Rect(img.width, img.height);

   var minR = img.minimum(r, 0, 0);
   var minG = img.minimum(r, 1, 1);
   var minB = img.minimum(r, 2, 2);

   var PM = new PixelMath;
   PM.expression = "$T - " + minR.toFixed(8);
   PM.expression1 = "$T - " + minG.toFixed(8);
   PM.expression2 = "$T - " + minB.toFixed(8);
   PM.useSingleExpression = false;
   PM.generateOutput = true;
   PM.optimization = true;
   PM.use64BitWorkingImage = false;
   PM.rescale = false;
   PM.truncate = true;
   PM.truncateLower = 0;
   PM.truncateUpper = 1;
   PM.createNewImage = false;
   PM.executeOn(w.mainView);

   return {
      target: targetId,
      floorsRemoved: { R: minR, G: minG, B: minB },
      after: {
         minimums: { R: img.minimum(r, 0, 0), G: img.minimum(r, 1, 1), B: img.minimum(r, 2, 2) },
         medians: { R: img.median(r, 0, 0), G: img.median(r, 1, 1), B: img.median(r, 2, 2) }
      }
   };
};

handlers.dehalo = function(params) {
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");
   var sigma = params.sigma || 150;
   var amount = params.amount || 0.15;

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var img = w.mainView.image;

   // Create blurred clone for large-scale model
   var blurId = "AstroPilot_blur_temp";
   var blurWin = new ImageWindow(img.width, img.height, img.numberOfChannels,
                                  img.bitsPerSample, img.isReal, img.isColor, blurId);
   blurWin.mainView.beginProcess();
   blurWin.mainView.image.assign(img);
   blurWin.mainView.endProcess();

   var conv = new Convolution;
   conv.mode = Convolution.prototype.Parametric;
   conv.sigma = sigma;
   conv.shape = 2.0;
   conv.aspectRatio = 1.0;
   conv.rotationAngle = 0;
   conv.filterSource = "";
   conv.rescaleHighPass = false;
   conv.viewId = "";
   conv.executeOn(blurWin.mainView);

   // Background levels from corner
   var bgR = img.median(new Rect(0, 0, 300, 300), 0, 0);
   var bgG = img.median(new Rect(0, 0, 300, 300), 1, 1);
   var bgB = img.median(new Rect(0, 0, 300, 300), 2, 2);

   var PM = new PixelMath;
   PM.expression = "$T - " + amount.toFixed(4) + " * max(0, " + blurId + " - " + bgR.toFixed(8) + ")";
   PM.expression1 = "$T - " + amount.toFixed(4) + " * max(0, " + blurId + " - " + bgG.toFixed(8) + ")";
   PM.expression2 = "$T - " + amount.toFixed(4) + " * max(0, " + blurId + " - " + bgB.toFixed(8) + ")";
   PM.useSingleExpression = false;
   PM.generateOutput = true;
   PM.optimization = true;
   PM.use64BitWorkingImage = false;
   PM.rescale = false;
   PM.truncate = true;
   PM.truncateLower = 0;
   PM.truncateUpper = 1;
   PM.createNewImage = false;
   PM.executeOn(w.mainView);

   blurWin.forceClose();

   return {
      target: targetId,
      sigma: sigma,
      amount: amount,
      backgroundLevels: { R: bgR, G: bgG, B: bgB }
   };
};

handlers.noise_reduction = function(params) {
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var sigmaL = params.sigmaL || 2.0;
   var sigmaC = params.sigmaC || 3.0;
   var amountL = params.amountL || 0.85;
   var amountC = params.amountC || 1.0;
   var iterationsL = params.iterationsL || 3;
   var iterationsC = params.iterationsC || 3;

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var NR = new ACDNR;
   NR.applyToLightness = true;
   NR.applyToLuminance = true;
   NR.applyToChrominance = true;

   NR.sigmaL = sigmaL;
   NR.shapeL = 0.5;
   NR.amountL = amountL;
   NR.iterationsL = iterationsL;
   NR.prefilterMethodL = 0;
   NR.protectionMethodL = 1;
   NR.minStructSizeL = 5;
   NR.protectDarkSidesL = true;
   NR.protectBrightSidesL = true;
   NR.starProtectionL = true;
   NR.starThresholdL = 0.03;

   NR.sigmaC = sigmaC;
   NR.shapeC = 0.5;
   NR.amountC = amountC;
   NR.iterationsC = iterationsC;
   NR.prefilterMethodC = 0;
   NR.protectionMethodC = 1;
   NR.minStructSizeC = 5;
   NR.protectDarkSidesC = true;
   NR.protectBrightSidesC = true;
   NR.starProtectionC = true;
   NR.starThresholdC = 0.03;

   NR.executeOn(w.mainView);

   return {
      target: targetId,
      luminance: { sigma: sigmaL, amount: amountL, iterations: iterationsL },
      chrominance: { sigma: sigmaC, amount: amountC, iterations: iterationsC }
   };
};

handlers.star_reduction = function(params) {
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var iterations = params.iterations || 2;
   var amount = params.amount || 0.70;
   var structureSize = params.structureSize || 5;

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   // Create star mask
   var SM = new StarMask;
   SM.waveletLayers = 6;
   SM.noiseThreshold = 0.10;
   SM.largeScaleGrowth = 2;
   SM.smallScaleGrowth = 1;
   SM.growthCompensation = 2;
   SM.smoothness = 16;
   SM.mode = 0;
   SM.executeOn(w.mainView);

   // Find the mask window (most recently created, not our target)
   var maskWin = null;
   var windows = ImageWindow.windows;
   for (var i = 0; i < windows.length; i++) {
      if (windows[i].mainView.id !== targetId) {
         maskWin = windows[i];
      }
   }
   if (!maskWin) throw new Error("Star mask not found after StarMask execution");

   var maskId = maskWin.mainView.id;

   // Apply mask
   w.mask = maskWin;
   w.maskVisible = false;
   w.maskInverted = false;

   // Morphological erosion
   var MT = new MorphologicalTransformation;
   MT.operator = 0;
   MT.interlacingDistance = 1;
   MT.numberOfIterations = iterations;
   MT.amount = amount;
   MT.selectionPoint = 0.50;
   MT.structureSize = structureSize;
   MT.executeOn(w.mainView);

   // Cleanup
   w.removeMask();
   maskWin.forceClose();

   return {
      target: targetId,
      iterations: iterations,
      amount: amount,
      structureSize: structureSize,
      maskUsed: maskId
   };
};

handlers.enhance = function(params) {
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var lheRadius = params.lheRadius || 64;
   var lheSlopeLimit = params.lheSlopeLimit || 1.5;
   var lheAmount = params.lheAmount || 0.40;
   var saturationBoost = (params.saturationBoost !== false);
   var sCurve = (params.sCurve !== false);

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var steps = [];

   // Local contrast enhancement
   var LHE = new LocalHistogramEqualization;
   LHE.radius = lheRadius;
   LHE.histogramBins = 0;
   LHE.slopeLimit = lheSlopeLimit;
   LHE.amount = lheAmount;
   LHE.circularKernel = true;
   LHE.executeOn(w.mainView);
   steps.push("LHE (radius=" + lheRadius + ", slope=" + lheSlopeLimit + ", amount=" + lheAmount + ")");

   // Saturation boost - midtones only
   if (saturationBoost) {
      var CT = new CurvesTransformation;
      CT.St = 2;
      CT.S = [
         [0.00000, 0.00000],
         [0.15000, 0.15000],
         [0.40000, 0.55000],
         [0.70000, 0.80000],
         [1.00000, 1.00000]
      ];
      CT.executeOn(w.mainView);
      steps.push("Saturation boost");
   }

   // S-curve contrast
   if (sCurve) {
      var CT2 = new CurvesTransformation;
      CT2.Kt = 2;
      CT2.K = [
         [0.00000, 0.00000],
         [0.02000, 0.00500],
         [0.10000, 0.08000],
         [0.30000, 0.34000],
         [0.60000, 0.64000],
         [0.85000, 0.87000],
         [1.00000, 1.00000]
      ];
      CT2.executeOn(w.mainView);
      steps.push("S-curve contrast");
   }

   return {
      target: targetId,
      stepsApplied: steps
   };
};

handlers.run_script = function(params) {
   var code = params.code;
   if (!code) throw new Error("Missing 'code' parameter");

   // Execute in a function scope to capture a return value.
   // The script can set __result to pass data back.
   var __result = null;
   eval(code);

   return {
      executed: true,
      result: __result
   };
};

// ---- Command Dispatcher ----

function processCommand(filePath) {
   var text = readTextFile(filePath);
   var cmd;
   try {
      cmd = JSON.parse(text);
   } catch (e) {
      console.warningln("AstroPilot: Invalid JSON in " + filePath);
      deleteFile(filePath);
      return;
   }

   var id = cmd.id || "unknown";
   var commandName = cmd.command;
   var params = cmd.params || {};
   var t0 = nowMs();

   console.noteln("AstroPilot: Executing command '" + commandName + "' (id: " + id + ")");

   var response = {
      id: id,
      command: commandName,
      timestamp: t0
   };

   try {
      var handler = handlers[commandName];
      if (!handler) throw new Error("Unknown command: " + commandName);

      var result = handler(params);
      response.status = "ok";
      response.result = result;
   } catch (e) {
      response.status = "error";
      response.error = e.message;
      console.warningln("AstroPilot: Command '" + commandName + "' failed: " + e.message);
   }

   response.duration_ms = nowMs() - t0;

   // Write result file
   var resultPath = RESULTS_DIR + "/" + id + ".json";
   writeTextFile(resultPath, JSON.stringify(response));

   // Remove command file
   deleteFile(filePath);

   if (response.status === "ok") {
      console.noteln("AstroPilot: Command '" + commandName + "' completed in " + response.duration_ms + "ms");
   }
}

// ---- Main Loop ----

var startTime = nowMs();
var running = true;

function checkForCommands() {
   // Check for shutdown sentinel
   var shutdownPath = COMMANDS_DIR + "/shutdown";
   if (File.exists(shutdownPath)) {
      deleteFile(shutdownPath);
      running = false;
      console.noteln("AstroPilot: Shutdown sentinel detected. Stopping watcher.");
      return;
   }

   // Scan for command files
   var files = searchDirectory(COMMANDS_DIR + "/*.json");
   if (files.length === 0) return;

   // Sort by filename to process in order
   files.sort();

   for (var i = 0; i < files.length; i++) {
      processCommand(files[i]);
      processEvents();
   }
}

// ---- Entry Point ----

(function main() {
   console.noteln("");
   console.noteln("============================================");
   console.noteln("  AstroPilot Bridge Watcher v" + VERSION);
   console.noteln("  Commands: " + COMMANDS_DIR);
   console.noteln("  Results:  " + RESULTS_DIR);
   console.noteln("============================================");
   console.noteln("");

   ensureDirectory(BRIDGE_BASE);
   ensureDirectory(COMMANDS_DIR);
   ensureDirectory(RESULTS_DIR);

   // Write a ready sentinel so the client knows the watcher is alive
   writeTextFile(BRIDGE_BASE + "/watcher.pid", JSON.stringify({
      version: VERSION,
      started: (new Date()).toISOString(),
      pid: "pixinsight"
   }));

   console.noteln("AstroPilot: Watcher started. Polling every " + POLL_INTERVAL_MS + "ms.");
   console.noteln("AstroPilot: To stop, create a 'shutdown' file in the commands directory.");
   console.noteln("");

   while (running) {
      try {
         checkForCommands();
      } catch (e) {
         console.warningln("AstroPilot: Poll error: " + e.message);
      }
      processEvents();
      msleep(POLL_INTERVAL_MS);
   }

   // Cleanup
   deleteFile(BRIDGE_BASE + "/watcher.pid");
   console.noteln("AstroPilot: Watcher stopped.");
})();

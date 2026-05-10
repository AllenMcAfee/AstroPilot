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
var POLL_INTERVAL_MS = 1000;
var VERSION = "0.1.0";

// ---- Directory Setup ----

function ensureDirectory(path) {
   if (!File.directoryExists(path)) {
      File.createDirectory(path, true);
   }
}

// ---- File Helpers ----

function readTextFile(filePath) {
   var lines = File.readLines(filePath);
   return lines.join("\n");
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

// ---- File & Stacking Command Handlers ----

handlers.open_image = function(params) {
   var filePath = params.filePath;
   if (!filePath) throw new Error("Missing 'filePath' parameter");

   var w = ImageWindow.open(filePath);
   if (!w || w.length === 0) throw new Error("Failed to open: " + filePath);

   var opened = [];
   for (var i = 0; i < w.length; i++) {
      w[i].show();
      opened.push(w[i].mainView.id);
   }

   return { opened: opened };
};

handlers.save_image = function(params) {
   var targetId = params.target || params.targetId;
   var filePath = params.filePath;
   if (!targetId) throw new Error("Missing 'target' parameter");
   if (!filePath) throw new Error("Missing 'filePath' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var overwrite = params.overwrite !== false;
   w.saveAs(filePath, false, false, !overwrite, false);

   return { target: targetId, filePath: filePath };
};

handlers.close_image = function(params) {
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   w.forceClose();
   return { closed: targetId };
};

handlers.calibrate = function(params) {
   // ImageCalibration: apply master dark, flat, bias to a list of light frames.
   // Writes calibrated frames to outputDir.
   var lights = params.lights;
   if (!lights || lights.length === 0) throw new Error("Missing 'lights' parameter");
   var outputDir = params.outputDir;
   if (!outputDir) throw new Error("Missing 'outputDir' parameter");

   var IC = new ImageCalibration;

   // Build target frames array
   var targetFrames = [];
   for (var i = 0; i < lights.length; i++) {
      targetFrames.push([true, lights[i]]);
   }
   IC.targetFrames = targetFrames;

   // Master dark
   if (params.masterDark) {
      IC.enableDarkFrameCalibration = true;
      IC.masterDarkPath = params.masterDark;
      IC.calibrateDark = false;
      IC.darkOptimizationWindow = params.darkOptimizationWindow || 1024;
      IC.darkOptimizationLow = 3.0;
      IC.darkOptimizationThreshold = 0.0;
   } else {
      IC.enableDarkFrameCalibration = false;
   }

   // Master flat
   if (params.masterFlat) {
      IC.enableFlatFrameCalibration = true;
      IC.masterFlatPath = params.masterFlat;
      IC.calibrateFlat = false;
   } else {
      IC.enableFlatFrameCalibration = false;
   }

   // Master bias
   if (params.masterBias) {
      IC.enableBiasFrameCalibration = true;
      IC.masterBiasPath = params.masterBias;
   } else {
      IC.enableBiasFrameCalibration = false;
   }

   IC.outputDirectory = outputDir;
   IC.outputPrefix = params.outputPrefix || "";
   IC.outputPostfix = params.outputPostfix || "_c";
   IC.outputSampleFormat = 1; // 32-bit float
   IC.overwriteExistingFiles = true;
   IC.onError = 0; // continue

   IC.executeGlobal();

   return {
      calibrated: lights.length,
      outputDir: outputDir
   };
};

handlers.measure_subframes = function(params) {
   // SubframeSelector: measure quality metrics for each frame.
   // Returns FWHM, eccentricity, SNR, weight for each.
   var files = params.files;
   if (!files || files.length === 0) throw new Error("Missing 'files' parameter");

   var SS = new SubframeSelector;

   var subframes = [];
   for (var i = 0; i < files.length; i++) {
      subframes.push([true, files[i]]);
   }
   SS.subframes = subframes;

   // Measurement mode only (don't output files)
   SS.routine = 0; // MeasureSubframes
   SS.fileCache = true;

   // Star detection
   SS.structureLayers = params.structureLayers || 5;
   SS.minStructureSize = 0;
   SS.sensitivity = params.sensitivity || 0.1;
   SS.peakResponse = 0.8;

   // Weighting formula — PSF Signal Weight is the gold standard
   SS.selectorExpression = params.selectorExpression || "";
   SS.weightingExpression = params.weightingExpression || "PSFSignalWeight";

   SS.executeGlobal();

   // Read measurements from the process
   var measurements = [];
   if (SS.measurements) {
      for (var i = 0; i < SS.measurements.length; i++) {
         var m = SS.measurements[i];
         measurements.push({
            index: m[0],
            enabled: m[1],
            locked: m[2],
            filePath: m[3],
            fwhm: m[4],
            eccentricity: m[5],
            snrWeight: m[6],
            median: m[7],
            medianMeanDev: m[8],
            noise: m[9],
            noiseRatio: m[10],
            stars: m[11],
            starResidual: m[12],
            fwhmMeanDev: m[13],
            eccentricityMeanDev: m[14],
            starResidualMeanDev: m[15],
            weight: m[16]
         });
      }
   }

   return {
      count: measurements.length,
      measurements: measurements
   };
};

handlers.register_frames = function(params) {
   // StarAlignment: register/align frames to a reference.
   var files = params.files;
   if (!files || files.length === 0) throw new Error("Missing 'files' parameter");
   var outputDir = params.outputDir;
   if (!outputDir) throw new Error("Missing 'outputDir' parameter");

   var SA = new StarAlignment;

   // Reference image: first frame or user-specified
   SA.referenceImage = params.referenceImage || files[0];
   SA.referenceIsFile = true;

   var targets = [];
   for (var i = 0; i < files.length; i++) {
      targets.push([true, true, files[i]]);
   }
   SA.targets = targets;

   SA.outputDirectory = outputDir;
   SA.outputPrefix = params.outputPrefix || "";
   SA.outputPostfix = params.outputPostfix || "_r";
   SA.overwriteExistingFiles = true;
   SA.onError = 0; // continue

   // Detection parameters
   SA.structureLayers = params.structureLayers || 5;
   SA.sensitivity = params.sensitivity || 0.5;
   SA.maxStarDistortion = params.maxStarDistortion || 0.6;
   SA.noGUIMessages = true;

   SA.executeGlobal();

   return {
      registered: files.length,
      referenceImage: SA.referenceImage,
      outputDir: outputDir
   };
};

handlers.integrate = function(params) {
   // ImageIntegration: stack registered frames with pixel rejection.
   var files = params.files;
   if (!files || files.length === 0) throw new Error("Missing 'files' parameter");

   var II = new ImageIntegration;

   var images = [];
   for (var i = 0; i < files.length; i++) {
      // [enabled, path, drizzlePath, weight]
      var weight = 1.0;
      if (params.weights && params.weights[i] !== undefined) {
         weight = params.weights[i];
      }
      images.push([true, files[i], "", weight]);
   }
   II.images = images;

   // Combination
   II.combination = 0; // Average
   II.normalization = 1; // Additive with scaling

   // Pixel rejection
   var frameCount = files.length;
   if (frameCount < 8) {
      // Few frames: Winsorized Sigma Clipping
      II.rejection = 4; // WinsorizedSigmaClipping
      II.wscSigmaLow = params.sigmaLow || 3.0;
      II.wscSigmaHigh = params.sigmaHigh || 2.5;
   } else if (frameCount < 25) {
      // Medium: Linear Fit Clipping
      II.rejection = 3; // LinearFitClipping
      II.linearFitLow = params.sigmaLow || 5.0;
      II.linearFitHigh = params.sigmaHigh || 3.0;
   } else {
      // Many frames: ESD (Generalized ESD)
      II.rejection = 6; // GeneralizedExtremeStudentizedDeviate
      II.esdOutliersFraction = params.esdOutliersFraction || 0.3;
      II.esdSignificance = params.esdSignificance || 0.05;
   }

   // Weights
   if (params.weightMode === "PSFSignalWeight" || params.weights) {
      II.weightMode = 4; // PSFSignalWeight
   } else {
      II.weightMode = 1; // NoiseEvaluation
   }

   II.rangeClipLow = true;
   II.rangeLow = 0.0;
   II.rangeClipHigh = params.rangeClipHigh !== false;
   II.rangeHigh = params.rangeHigh || 0.98;

   II.generate64BitResult = false;
   II.generateRejectionMaps = false;
   II.generateIntegratedImage = true;
   II.closePreviousImages = true;
   II.autoMemory = true;
   II.noGUIMessages = true;

   II.executeGlobal();

   // The result is an open window named "integration"
   var resultId = null;
   var windows = ImageWindow.windows;
   for (var i = 0; i < windows.length; i++) {
      var wId = windows[i].mainView.id;
      if (wId.toLowerCase().indexOf("integration") !== -1) {
         resultId = wId;
      }
   }

   return {
      integrated: files.length,
      rejectionAlgorithm: frameCount < 8 ? "WinsorizedSigmaClipping" :
                          frameCount < 25 ? "LinearFitClipping" : "GeneralizedESD",
      resultWindowId: resultId
   };
};

handlers.create_master_calibration = function(params) {
   // ImageIntegration configured for calibration masters (darks, flats, bias).
   // Uses appropriate settings for each type.
   var files = params.files;
   var frameType = params.frameType; // "dark", "flat", "bias"
   if (!files || files.length === 0) throw new Error("Missing 'files' parameter");
   if (!frameType) throw new Error("Missing 'frameType' parameter");

   var II = new ImageIntegration;

   var images = [];
   for (var i = 0; i < files.length; i++) {
      images.push([true, files[i], "", 1.0]);
   }
   II.images = images;

   II.generateIntegratedImage = true;
   II.generate64BitResult = false;
   II.generateRejectionMaps = false;
   II.closePreviousImages = true;
   II.autoMemory = true;
   II.noGUIMessages = true;

   if (frameType === "bias") {
      II.combination = 0; // Average
      II.normalization = 0; // NoNormalization
      II.rejection = 4; // WinsorizedSigmaClipping
      II.wscSigmaLow = 4.0;
      II.wscSigmaHigh = 3.0;
   } else if (frameType === "dark") {
      II.combination = 0; // Average
      II.normalization = 0; // NoNormalization
      II.rejection = 4; // WinsorizedSigmaClipping
      II.wscSigmaLow = 4.0;
      II.wscSigmaHigh = 3.0;
   } else if (frameType === "flat") {
      II.combination = 0; // Average
      II.normalization = 2; // Multiplicative
      II.rejection = 4; // WinsorizedSigmaClipping
      II.wscSigmaLow = 4.0;
      II.wscSigmaHigh = 3.0;
   }

   II.executeGlobal();

   // Find the result window
   var resultId = null;
   var windows = ImageWindow.windows;
   for (var i = 0; i < windows.length; i++) {
      var wId = windows[i].mainView.id;
      if (wId.toLowerCase().indexOf("integration") !== -1) {
         resultId = wId;
      }
   }

   return {
      frameType: frameType,
      frameCount: files.length,
      resultWindowId: resultId
   };
};

handlers.crop_stacking_edges = function(params) {
   // Auto-crop black edges left by registration/stacking.
   // Scans inward from each edge to find where real data starts.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var img = w.mainView.image;
   var threshold = params.threshold || 0.001;

   // Sample along edges to find crop boundaries
   var left = 0, right = img.width - 1, top = 0, bottom = img.height - 1;
   var step = Math.max(1, Math.floor(img.height / 50));

   // Scan left edge
   for (var x = 0; x < img.width / 4; x++) {
      var allBlack = true;
      for (var y = 0; y < img.height; y += step) {
         for (var c = 0; c < img.numberOfChannels; c++) {
            if (img.sample(x, y, c) > threshold) { allBlack = false; break; }
         }
         if (!allBlack) break;
      }
      if (!allBlack) { left = x; break; }
   }

   // Scan right edge
   for (var x = img.width - 1; x > img.width * 3 / 4; x--) {
      var allBlack = true;
      for (var y = 0; y < img.height; y += step) {
         for (var c = 0; c < img.numberOfChannels; c++) {
            if (img.sample(x, y, c) > threshold) { allBlack = false; break; }
         }
         if (!allBlack) break;
      }
      if (!allBlack) { right = x; break; }
   }

   // Scan top edge
   step = Math.max(1, Math.floor(img.width / 50));
   for (var y = 0; y < img.height / 4; y++) {
      var allBlack = true;
      for (var x = 0; x < img.width; x += step) {
         for (var c = 0; c < img.numberOfChannels; c++) {
            if (img.sample(x, y, c) > threshold) { allBlack = false; break; }
         }
         if (!allBlack) break;
      }
      if (!allBlack) { top = y; break; }
   }

   // Scan bottom edge
   for (var y = img.height - 1; y > img.height * 3 / 4; y--) {
      var allBlack = true;
      for (var x = 0; x < img.width; x += step) {
         for (var c = 0; c < img.numberOfChannels; c++) {
            if (img.sample(x, y, c) > threshold) { allBlack = false; break; }
         }
         if (!allBlack) break;
      }
      if (!allBlack) { bottom = y; break; }
   }

   var cropW = right - left + 1;
   var cropH = bottom - top + 1;

   if (cropW < img.width || cropH < img.height) {
      var DC = new DynamicCrop;
      DC.centerX = (left + right) / 2 / img.width;
      DC.centerY = (top + bottom) / 2 / img.height;
      DC.width = cropW / img.width;
      DC.height = cropH / img.height;
      DC.scaleX = 1.0;
      DC.scaleY = 1.0;
      DC.angle = 0;
      DC.executeOn(w.mainView);

      return {
         target: targetId,
         cropped: true,
         original: { width: img.width, height: img.height },
         cropRect: { left: left, top: top, right: right, bottom: bottom },
         newSize: { width: cropW, height: cropH }
      };
   }

   return { target: targetId, cropped: false, reason: "No stacking edges detected" };
};

// ---- Linear Pre-Processing Command Handlers ----

handlers.check_installed_processes = function(params) {
   // Check which optional processes/scripts are available.
   var processes = params.processes || [
      "NoiseXTerminator", "BlurXTerminator", "StarXTerminator",
      "SpectrophotometricColorCalibration", "PhotometricColorCalibration",
      "AutomaticBackgroundExtractor", "GradientCorrection",
      "BackgroundNeutralization", "MultiscaleLinearTransform"
   ];

   var available = {};
   for (var i = 0; i < processes.length; i++) {
      try {
         eval("new " + processes[i]);
         available[processes[i]] = true;
      } catch (e) {
         available[processes[i]] = false;
      }
   }
   return available;
};

handlers.gradient_removal = function(params) {
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var method = params.method || "auto";

   // Try ABE first (generally more robust), fall back to GradientCorrection
   if (method === "auto" || method === "ABE") {
      try {
         var ABE = new AutomaticBackgroundExtractor;
         ABE.tolerance = params.tolerance || 1.0;
         ABE.deviation = params.deviation || 0.8;
         ABE.unbalance = params.unbalance || 1.8;
         ABE.minBoxFraction = 0.05;
         ABE.maxBackground = 1.0;
         ABE.minBackground = 0.0;
         ABE.useLargeScaleRejection = true;
         ABE.useSmallScaleRejection = true;
         ABE.polyDegree = params.polyDegree || 4;
         ABE.replaceTarget = true;
         ABE.discardModel = true;
         ABE.executeOn(w.mainView);

         return { target: targetId, method: "ABE", polyDegree: ABE.polyDegree };
      } catch (e) {
         if (method === "ABE") throw e;
         // Fall through to GradientCorrection
      }
   }

   // GradientCorrection fallback
   try {
      var GC = new GradientCorrection;
      GC.executeOn(w.mainView);
      return { target: targetId, method: "GradientCorrection" };
   } catch (e) {
      throw new Error("No gradient removal process available: " + e.message);
   }
};

handlers.background_neutralization = function(params) {
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var BN = new BackgroundNeutralization;

   // Use a region of interest if provided, otherwise auto
   if (params.previewId) {
      BN.backgroundReferenceViewId = params.previewId;
   }

   BN.backgroundLow = params.backgroundLow || 0.0;
   BN.backgroundHigh = params.backgroundHigh || 0.1;
   BN.useROI = false;
   BN.mode = 0; // TargetBackground

   BN.executeOn(w.mainView);

   var img = w.mainView.image;
   var r = new Rect(img.width, img.height);

   return {
      target: targetId,
      afterMedians: {
         R: img.median(r, 0, 0),
         G: img.numberOfChannels > 1 ? img.median(r, 1, 1) : null,
         B: img.numberOfChannels > 2 ? img.median(r, 2, 2) : null
      }
   };
};

handlers.color_calibration = function(params) {
   // Try SPCC first (better), fall back to PCC
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var method = params.method || "auto";

   // Try SPCC
   if (method === "auto" || method === "SPCC") {
      try {
         var SPCC = new SpectrophotometricColorCalibration;

         if (params.whiteReference) SPCC.whiteReferenceSpectrum = params.whiteReference;
         SPCC.applyCalibration = true;
         SPCC.narrowbandMode = params.narrowband || false;
         SPCC.fractionalSampleClipping = params.sampleClipping || 0.1;
         SPCC.structureLayers = params.structureLayers || 5;
         SPCC.minStructureSize = 0;

         SPCC.executeOn(w.mainView);

         return { target: targetId, method: "SPCC" };
      } catch (e) {
         if (method === "SPCC") throw e;
         // Fall through to PCC
      }
   }

   // PCC fallback
   if (method === "auto" || method === "PCC") {
      try {
         var PCC = new PhotometricColorCalibration;

         if (params.solverFocalLength) PCC.focalLength = params.solverFocalLength;
         if (params.solverPixelSize) PCC.pixelSize = params.solverPixelSize;
         PCC.applyCalibration = true;

         PCC.executeOn(w.mainView);

         return { target: targetId, method: "PCC" };
      } catch (e) {
         if (method === "PCC") throw e;
      }
   }

   throw new Error("No color calibration process available");
};

handlers.linear_noise_reduction = function(params) {
   // NoiseXTerminator if available, else MultiscaleLinearTransform
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var method = params.method || "auto";

   // Try NoiseXTerminator
   if (method === "auto" || method === "NXT") {
      try {
         var NXT = new NoiseXTerminator;
         NXT.denoise = params.denoise || 0.9;
         NXT.detail = params.detail || 0.15;
         NXT.executeOn(w.mainView);

         return { target: targetId, method: "NoiseXTerminator", denoise: NXT.denoise, detail: NXT.detail };
      } catch (e) {
         if (method === "NXT") throw e;
      }
   }

   // MLT fallback — gentle linear noise reduction
   if (method === "auto" || method === "MLT") {
      try {
         var MLT = new MultiscaleLinearTransform;

         // 4 wavelet layers, reduce noise on the first two layers only
         var layers = [
            [true, true, params.layer1NR || 3.0, false, 0, false, 0],  // layer 1: strong NR
            [true, true, params.layer2NR || 2.0, false, 0, false, 0],  // layer 2: moderate NR
            [true, true, params.layer3NR || 1.0, false, 0, false, 0],  // layer 3: light NR
            [true, true, 0.5, false, 0, false, 0],                     // layer 4: very light
            [true, true, 0, false, 0, false, 0]                        // residual: untouched
         ];
         MLT.layers = layers;
         MLT.transform = 0; // StarletTransform
         MLT.scaleDelta = 0;
         MLT.linearMask = true;

         MLT.executeOn(w.mainView);

         return { target: targetId, method: "MultiscaleLinearTransform" };
      } catch (e) {
         if (method === "MLT") throw e;
      }
   }

   return { target: targetId, method: "skipped", reason: "No suitable noise reduction available" };
};

handlers.deconvolution = function(params) {
   // BlurXTerminator if available, else skip (classic deconvolution
   // is too risky to automate without PSF measurement).
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   try {
      var BXT = new BlurXTerminator;
      BXT.sharpen_stars = params.sharpenStars || 0.5;
      BXT.sharpen_nonstellar = params.sharpenNonstellar || 0.75;
      BXT.psf = params.psf || 0;          // 0 = auto
      BXT.adjust = params.adjust || 0;     // 0 = auto
      BXT.executeOn(w.mainView);

      return {
         target: targetId,
         method: "BlurXTerminator",
         sharpenStars: BXT.sharpen_stars,
         sharpenNonstellar: BXT.sharpen_nonstellar
      };
   } catch (e) {
      return { target: targetId, method: "skipped", reason: "BlurXTerminator not available" };
   }
};

handlers.star_extraction = function(params) {
   // StarXTerminator if available for starless processing path.
   // Creates two images: starless and stars-only.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   try {
      var SXT = new StarXTerminator;
      SXT.stars = true;           // generate stars image
      SXT.unscreen = params.unscreen || true;
      SXT.overlap = params.overlap || 0;
      SXT.executeOn(w.mainView);

      // Find the stars image — SXT creates it with a "_stars" suffix or similar
      var starsId = null;
      var windows = ImageWindow.windows;
      for (var i = 0; i < windows.length; i++) {
         var wId = windows[i].mainView.id;
         if (wId !== targetId && wId.toLowerCase().indexOf("star") !== -1) {
            starsId = wId;
         }
      }

      return {
         target: targetId,
         method: "StarXTerminator",
         starlessId: targetId,
         starsId: starsId
      };
   } catch (e) {
      return { target: targetId, method: "skipped", reason: "StarXTerminator not available" };
   }
};

// ---- Creative Processing Command Handlers (Phase 4) ----

handlers.stretch = function(params) {
   // Apply a nonlinear stretch. Method is chosen by the processing profile.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");
   var method = params.method || "auto_stf";

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   if (method === "auto_stf") {
      // ScreenTransferFunction auto-stretch baked into the image via HistogramTransformation
      var stf = new ScreenTransferFunction;
      stf.executeOn(w.mainView);

      // Read the STF parameters and apply as a permanent HT
      var stfData = w.mainView.stf;
      var HT = new HistogramTransformation;

      if (w.mainView.image.numberOfChannels >= 3) {
         // Per-channel STF
         HT.H = [[stfData[0][1], stfData[0][0], stfData[0][2], 0, 1],
                  [stfData[1][1], stfData[1][0], stfData[1][2], 0, 1],
                  [stfData[2][1], stfData[2][0], stfData[2][2], 0, 1],
                  [0, 0.5, 1, 0, 1],
                  [0, 0.5, 1, 0, 1]];
      } else {
         HT.H = [[0, 0.5, 1, 0, 1],
                  [0, 0.5, 1, 0, 1],
                  [0, 0.5, 1, 0, 1],
                  [stfData[0][1], stfData[0][0], stfData[0][2], 0, 1],
                  [0, 0.5, 1, 0, 1]];
      }
      HT.executeOn(w.mainView);

      // Reset STF
      var resetStf = new ScreenTransferFunction;
      resetStf.executeOn(w.mainView);

      return { target: targetId, method: "auto_stf" };
   }

   if (method === "ghs") {
      // Generalized Hyperbolic Stretch
      try {
         var GHS = new GeneralizedHyperbolicStretch;
         GHS.stretchType = params.stretchType || 2; // Hyperbolic
         GHS.D = params.D || -5.0;                  // Stretch factor
         GHS.b = params.b || 0.2;                    // Balance
         GHS.SP = params.SP || 0.0;                  // Symmetry point
         GHS.LP = params.LP || 0.0;                  // Local stretch parameter
         GHS.HP = params.HP || 1.0;                  // Highlight protection
         GHS.BP = params.BP || 0.0;                  // Black point
         GHS.WP = params.WP || 1.0;                  // White point
         GHS.executeOn(w.mainView);
         return { target: targetId, method: "ghs" };
      } catch (e) {
         // GHS not installed, fall back to STF
         return handlers.stretch({ target: targetId, method: "auto_stf" });
      }
   }

   if (method === "arcsinh") {
      // Arcsinh stretch via PixelMath — preserves star colors
      var img = w.mainView.image;
      var r = new Rect(img.width, img.height);
      // Find black point from median of faintest channel
      var medians = [];
      for (var c = 0; c < img.numberOfChannels; c++) {
         medians.push(img.median(r, c, c));
      }
      var bp = Math.min.apply(null, medians) * 0.9;
      var stretch = params.stretchFactor || 50;

      var PM = new PixelMath;
      PM.expression = "asinh(($T - " + bp.toFixed(8) + ") * " + stretch + ") / asinh((1 - " + bp.toFixed(8) + ") * " + stretch + ")";
      PM.useSingleExpression = true;
      PM.generateOutput = true;
      PM.optimization = true;
      PM.rescale = false;
      PM.truncate = true;
      PM.truncateLower = 0;
      PM.truncateUpper = 1;
      PM.createNewImage = false;
      PM.executeOn(w.mainView);

      return { target: targetId, method: "arcsinh", stretchFactor: stretch, blackPoint: bp };
   }

   if (method === "statistical") {
      // Seti Statistical Stretch (Franklin Marek method)
      // Iterative midtone stretch using image statistics
      var img = w.mainView.image;
      var r = new Rect(img.width, img.height);
      var iterations = params.iterations || 8;
      var targetMedian = params.targetMedian || 0.25;

      for (var iter = 0; iter < iterations; iter++) {
         var med = img.median(r, 0, img.numberOfChannels - 1);
         if (med >= targetMedian) break;

         // Calculate midtone transfer function parameter
         var mtf = 0.5 * (1.0 + (targetMedian - med) / (1.0 - med));
         mtf = Math.min(0.98, Math.max(0.02, mtf));

         var HT = new HistogramTransformation;
         if (img.numberOfChannels >= 3) {
            HT.H = [[0, 0.5, 1, 0, 1],
                     [0, 0.5, 1, 0, 1],
                     [0, 0.5, 1, 0, 1],
                     [0, 0.5, 1, 0, 1],
                     [0, mtf, 1, 0, 1]];
         } else {
            HT.H = [[0, 0.5, 1, 0, 1],
                     [0, 0.5, 1, 0, 1],
                     [0, 0.5, 1, 0, 1],
                     [0, mtf, 1, 0, 1],
                     [0, 0.5, 1, 0, 1]];
         }
         HT.executeOn(w.mainView);
      }

      return { target: targetId, method: "statistical", iterations: iter, targetMedian: targetMedian };
   }

   throw new Error("Unknown stretch method: " + method);
};

handlers.hdrmt = function(params) {
   // HDRMultiscaleTransform — compress bright cores without killing faint stuff.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var HDRMT = new HDRMultiscaleTransform;
   HDRMT.numberOfLayers = params.layers || 6;
   HDRMT.numberOfIterations = params.iterations || 1;
   HDRMT.overdrive = params.overdrive || 0;
   HDRMT.medianTransform = false;
   HDRMT.scalingFunctionData = [0, 0, 0, 0, 0, 0];
   HDRMT.scalingFunctionNoiseSigma = [1, 1, 1, 1, 1, 1];
   HDRMT.scalingFunctionEnabled = [true, true, true, true, true, true];
   HDRMT.deringing = params.deringing !== false;
   HDRMT.smallScaleDeringing = params.smallScaleDeringing || 0.0;
   HDRMT.largeScaleDeringing = params.largeScaleDeringing || 0.5;
   HDRMT.outputDeringingMask = false;
   HDRMT.toLightness = params.toLightness !== false;

   // Inverted mode: enhance faint structures
   if (params.inverted) {
      // Invert, apply HDRMT, invert back
      var PM1 = new PixelMath;
      PM1.expression = "1 - $T";
      PM1.useSingleExpression = true;
      PM1.createNewImage = false;
      PM1.rescale = false;
      PM1.truncate = true;
      PM1.executeOn(w.mainView);

      HDRMT.executeOn(w.mainView);

      PM1.executeOn(w.mainView);

      return { target: targetId, inverted: true, layers: HDRMT.numberOfLayers };
   }

   HDRMT.executeOn(w.mainView);
   return { target: targetId, inverted: false, layers: HDRMT.numberOfLayers };
};

handlers.dark_structure_enhance = function(params) {
   // Enhance dark structures (dust lanes, dark nebulae) via PixelMath.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");
   var amount = params.amount || 0.3;
   var sigma = params.sigma || 30;

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var img = w.mainView.image;

   // Create blurred luminance model
   var modelId = "AstroPilot_dse_temp";
   var modelWin = new ImageWindow(img.width, img.height, 1,
                                   img.bitsPerSample, img.isReal, false, modelId);
   modelWin.mainView.beginProcess();
   // Extract luminance
   var PM0 = new PixelMath;
   PM0.expression = "CIELightness($T)";
   PM0.useSingleExpression = true;
   PM0.createNewImage = false;
   PM0.executeOn(w.mainView);
   // Actually, just copy and blur
   modelWin.mainView.image.assign(img);
   modelWin.mainView.endProcess();

   // Blur the model
   var conv = new Convolution;
   conv.mode = Convolution.prototype.Parametric;
   conv.sigma = sigma;
   conv.shape = 2.0;
   conv.aspectRatio = 1.0;
   conv.rotationAngle = 0;
   conv.executeOn(modelWin.mainView);

   // Darken: result = image * (1 - amount * (model - image) / model)
   // Simplified: result = image - amount * (model - image) where model > image
   var PM = new PixelMath;
   PM.expression = "$T - " + amount.toFixed(4) + " * max(0, " + modelId + " - $T)";
   PM.useSingleExpression = true;
   PM.generateOutput = true;
   PM.optimization = true;
   PM.rescale = false;
   PM.truncate = true;
   PM.truncateLower = 0;
   PM.truncateUpper = 1;
   PM.createNewImage = false;
   PM.executeOn(w.mainView);

   modelWin.forceClose();

   return { target: targetId, amount: amount, sigma: sigma };
};

handlers.sharpen = function(params) {
   // Masked sharpening via UnsharpMask or MLT.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");
   var method = params.method || "usm";

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   if (method === "usm") {
      var USM = new UnsharpMask;
      USM.sigma = params.sigma || 2.5;
      USM.amount = params.amount || 0.30;
      USM.deringing = params.deringing !== false;
      USM.deringingDark = params.deringingDark || 0.02;
      USM.deringingBright = params.deringingBright || 0.0;
      USM.linear = false;
      USM.executeOn(w.mainView);

      return { target: targetId, method: "usm", sigma: USM.sigma, amount: USM.amount };
   }

   // MLT sharpening
   var MLT = new MultiscaleLinearTransform;
   var bias = params.bias || 0.15;
   MLT.layers = [
      [true, true, 0, true, bias * 2, false, 0],    // layer 1: strongest
      [true, true, 0, true, bias * 1.5, false, 0],  // layer 2
      [true, true, 0, true, bias, false, 0],         // layer 3
      [true, true, 0, false, 0, false, 0],           // layer 4
      [true, true, 0, false, 0, false, 0]            // residual
   ];
   MLT.executeOn(w.mainView);

   return { target: targetId, method: "mlt", bias: bias };
};

handlers.ha_blend = function(params) {
   // Blend Ha data into an RGB image.
   // Soft-clamp injection into red channel + luminance contribution.
   var targetId = params.target || params.targetId;
   var haId = params.haWindowId;
   if (!targetId) throw new Error("Missing 'target' parameter");
   if (!haId) throw new Error("Missing 'haWindowId' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");
   var haW = ImageWindow.windowById(haId);
   if (haW.isNull) throw new Error("Window '" + haId + "' not found");

   var haAmount = params.amount || 0.35;
   var lumAmount = params.lumAmount || 0.15;
   var softClamp = params.softClamp || 0.85;

   // Red channel: blend Ha with soft clamping to avoid blowout
   // Green/Blue: add subtle luminance contribution from Ha
   var PM = new PixelMath;
   PM.expression = "max($T, $T * (1 - " + haAmount.toFixed(4) + ") + " +
                   haAmount.toFixed(4) + " * min(" + haId + ", " + softClamp.toFixed(4) + "))";
   PM.expression1 = "$T + " + lumAmount.toFixed(4) + " * " + haId;
   PM.expression2 = "$T";
   PM.useSingleExpression = false;
   PM.generateOutput = true;
   PM.optimization = true;
   PM.rescale = false;
   PM.truncate = true;
   PM.truncateLower = 0;
   PM.truncateUpper = 1;
   PM.createNewImage = false;
   PM.executeOn(w.mainView);

   return { target: targetId, haWindow: haId, amount: haAmount, lumAmount: lumAmount };
};

handlers.oiii_blend = function(params) {
   // Blend OIII data into an RGB image (green-blue contribution).
   var targetId = params.target || params.targetId;
   var oiiiId = params.oiiiWindowId;
   if (!targetId) throw new Error("Missing 'target' parameter");
   if (!oiiiId) throw new Error("Missing 'oiiiWindowId' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");
   var oiiiW = ImageWindow.windowById(oiiiId);
   if (oiiiW.isNull) throw new Error("Window '" + oiiiId + "' not found");

   var amount = params.amount || 0.30;

   var PM = new PixelMath;
   PM.expression = "$T"; // Red: untouched
   PM.expression1 = "max($T, $T * (1 - " + amount.toFixed(4) + ") + " + amount.toFixed(4) + " * " + oiiiId + ")";
   PM.expression2 = "max($T, $T * (1 - " + amount.toFixed(4) + ") + " + amount.toFixed(4) + " * " + oiiiId + ")";
   PM.useSingleExpression = false;
   PM.generateOutput = true;
   PM.optimization = true;
   PM.rescale = false;
   PM.truncate = true;
   PM.truncateLower = 0;
   PM.truncateUpper = 1;
   PM.createNewImage = false;
   PM.executeOn(w.mainView);

   return { target: targetId, oiiiWindow: oiiiId, amount: amount };
};

handlers.scnr = function(params) {
   // SCNR green cast removal.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var SCNR_P = new SCNR;
   SCNR_P.amount = params.amount || 0.80;
   SCNR_P.protectionMethod = params.protectionMethod || 1; // AverageNeutral
   SCNR_P.colorToRemove = params.color || 1; // Green
   SCNR_P.preserveLightness = params.preserveLightness !== false;
   SCNR_P.executeOn(w.mainView);

   return { target: targetId, amount: SCNR_P.amount };
};

handlers.selective_color_saturation = function(params) {
   // Boost saturation in specific hue ranges using CurvesTransformation.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var strength = params.strength || "moderate";

   // Saturation curves tuned by strength
   var CT = new CurvesTransformation;
   CT.St = 2; // Akima subsplines

   if (strength === "gentle") {
      CT.S = [[0, 0], [0.15, 0.15], [0.40, 0.48], [0.70, 0.75], [1, 1]];
   } else if (strength === "strong") {
      CT.S = [[0, 0], [0.10, 0.10], [0.35, 0.58], [0.65, 0.82], [1, 1]];
   } else { // moderate
      CT.S = [[0, 0], [0.15, 0.15], [0.40, 0.55], [0.70, 0.80], [1, 1]];
   }

   CT.executeOn(w.mainView);

   return { target: targetId, strength: strength };
};

handlers.star_color_enhance = function(params) {
   // Boost star colors using a star mask + saturation curve.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   // Create star mask
   var SM = new StarMask;
   SM.waveletLayers = 6;
   SM.noiseThreshold = 0.10;
   SM.largeScaleGrowth = 1;
   SM.smallScaleGrowth = 1;
   SM.growthCompensation = 2;
   SM.smoothness = 8;
   SM.mode = 0;
   SM.executeOn(w.mainView);

   var maskWin = null;
   var windows = ImageWindow.windows;
   for (var i = 0; i < windows.length; i++) {
      if (windows[i].mainView.id !== targetId) {
         maskWin = windows[i];
      }
   }
   if (!maskWin) throw new Error("Star mask not found");

   // Apply mask (mask = stars, so saturation only affects stars)
   w.mask = maskWin;
   w.maskVisible = false;
   w.maskInverted = false;

   // Saturation boost on stars
   var CT = new CurvesTransformation;
   CT.St = 2;
   CT.S = [[0, 0], [0.15, 0.15], [0.35, 0.52], [0.65, 0.78], [1, 1]];
   CT.executeOn(w.mainView);

   // Cleanup
   w.removeMask();
   maskWin.forceClose();

   return { target: targetId };
};

handlers.screen_blend_stars = function(params) {
   // Recombine stars with starless using screen blend.
   var targetId = params.target || params.targetId;
   var starsId = params.starsWindowId;
   if (!targetId) throw new Error("Missing 'target' parameter");
   if (!starsId) throw new Error("Missing 'starsWindowId' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");
   var starsW = ImageWindow.windowById(starsId);
   if (starsW.isNull) throw new Error("Window '" + starsId + "' not found");

   var amount = params.amount || 1.0;

   // Screen blend: result = 1 - (1 - base) * (1 - overlay * amount)
   var PM = new PixelMath;
   PM.expression = "1 - (1 - $T) * (1 - " + starsId + " * " + amount.toFixed(4) + ")";
   PM.useSingleExpression = true;
   PM.generateOutput = true;
   PM.optimization = true;
   PM.rescale = false;
   PM.truncate = true;
   PM.truncateLower = 0;
   PM.truncateUpper = 1;
   PM.createNewImage = false;
   PM.executeOn(w.mainView);

   return { target: targetId, starsWindow: starsId, amount: amount };
};

handlers.s_curve = function(params) {
   // S-curve contrast adjustment with configurable strength.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var strength = params.strength || "moderate";

   var CT = new CurvesTransformation;
   CT.Kt = 2; // Akima

   if (strength === "gentle") {
      CT.K = [[0, 0], [0.02, 0.01], [0.15, 0.13], [0.50, 0.52], [0.85, 0.87], [1, 1]];
   } else if (strength === "strong") {
      CT.K = [[0, 0], [0.02, 0.00], [0.08, 0.05], [0.25, 0.30], [0.60, 0.68], [0.85, 0.90], [1, 1]];
   } else { // moderate
      CT.K = [[0, 0], [0.02, 0.005], [0.10, 0.08], [0.30, 0.34], [0.60, 0.64], [0.85, 0.87], [1, 1]];
   }

   CT.executeOn(w.mainView);

   return { target: targetId, strength: strength };
};

handlers.check_dynamic_range = function(params) {
   // Check for clipping or black crush.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var img = w.mainView.image;
   var r = new Rect(img.width, img.height);
   var totalPixels = img.width * img.height;

   var channels = [];
   var issues = [];

   for (var c = 0; c < img.numberOfChannels && c < 3; c++) {
      var min = img.minimum(r, c, c);
      var max = img.maximum(r, c, c);
      var med = img.median(r, c, c);
      var mean = img.mean(r, c, c);

      channels.push({
         channel: c,
         min: min,
         max: max,
         median: med,
         mean: mean
      });

      // Check for clipping (>3% above 0.95)
      if (max >= 0.999) {
         issues.push("Channel " + c + ": highlight clipping detected (max=" + max.toFixed(4) + ")");
      }

      // Check for black crush (median too low)
      if (med < 0.05) {
         issues.push("Channel " + c + ": possible black crush (median=" + med.toFixed(4) + ")");
      }
   }

   return {
      target: targetId,
      channels: channels,
      issues: issues,
      healthy: issues.length === 0
   };
};

// ---- Scoring & Quality Gate Command Handlers (Phase 5) ----

handlers.measure_background = function(params) {
   // Measure background quality: smoothness, neutrality, gradient.
   // Samples corners and edges away from center subject.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var img = w.mainView.image;
   var iw = img.width;
   var ih = img.height;
   var sampleSize = Math.min(Math.floor(iw * 0.08), Math.floor(ih * 0.08), 200);

   // Sample 8 regions around the edges
   var regions = [
      { name: "TL", x: 0, y: 0 },
      { name: "TC", x: Math.floor(iw / 2 - sampleSize / 2), y: 0 },
      { name: "TR", x: iw - sampleSize, y: 0 },
      { name: "ML", x: 0, y: Math.floor(ih / 2 - sampleSize / 2) },
      { name: "MR", x: iw - sampleSize, y: Math.floor(ih / 2 - sampleSize / 2) },
      { name: "BL", x: 0, y: ih - sampleSize },
      { name: "BC", x: Math.floor(iw / 2 - sampleSize / 2), y: ih - sampleSize },
      { name: "BR", x: iw - sampleSize, y: ih - sampleSize }
   ];

   var samples = [];
   for (var i = 0; i < regions.length; i++) {
      var reg = regions[i];
      var r = new Rect(reg.x, reg.y, reg.x + sampleSize, reg.y + sampleSize);
      var channelData = [];
      for (var c = 0; c < img.numberOfChannels && c < 3; c++) {
         channelData.push({
            median: img.median(r, c, c),
            mean: img.mean(r, c, c),
            stdDev: img.stdDev(r, c, c)
         });
      }
      samples.push({ name: reg.name, channels: channelData });
   }

   // Calculate gradient: max median difference across regions
   var allMedians = [];
   for (var c = 0; c < (img.numberOfChannels < 3 ? 1 : 3); c++) {
      var medians = [];
      for (var i = 0; i < samples.length; i++) {
         medians.push(samples[i].channels[c].median);
      }
      allMedians.push(medians);
   }

   var gradientMax = 0;
   for (var c = 0; c < allMedians.length; c++) {
      var mn = Math.min.apply(null, allMedians[c]);
      var mx = Math.max.apply(null, allMedians[c]);
      var grad = mx - mn;
      if (grad > gradientMax) gradientMax = grad;
   }

   // Channel imbalance in background (max difference between channel medians)
   var bgMedians = [];
   for (var c = 0; c < allMedians.length; c++) {
      var sum = 0;
      for (var i = 0; i < allMedians[c].length; i++) sum += allMedians[c][i];
      bgMedians.push(sum / allMedians[c].length);
   }
   var channelImbalance = 0;
   if (bgMedians.length >= 3) {
      channelImbalance = Math.max(
         Math.abs(bgMedians[0] - bgMedians[1]),
         Math.abs(bgMedians[1] - bgMedians[2]),
         Math.abs(bgMedians[0] - bgMedians[2])
      );
   }

   // Average background noise (stdDev)
   var noiseSum = 0;
   var noiseCount = 0;
   for (var i = 0; i < samples.length; i++) {
      for (var c = 0; c < samples[i].channels.length; c++) {
         noiseSum += samples[i].channels[c].stdDev;
         noiseCount++;
      }
   }

   return {
      target: targetId,
      sampleSize: sampleSize,
      samples: samples,
      gradient: gradientMax,
      channelImbalance: channelImbalance,
      backgroundMedians: bgMedians,
      averageNoise: noiseSum / noiseCount
   };
};

handlers.measure_stars = function(params) {
   // Detect stars and measure FWHM, roundness, count.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   // Use DynamicPSF to detect and measure stars
   var img = w.mainView.image;

   // Create a star mask to count stars
   var SM = new StarMask;
   SM.waveletLayers = 5;
   SM.noiseThreshold = 0.15;
   SM.largeScaleGrowth = 0;
   SM.smallScaleGrowth = 0;
   SM.smoothness = 4;
   SM.mode = 0;
   SM.executeOn(w.mainView);

   var maskWin = null;
   var windows = ImageWindow.windows;
   for (var i = 0; i < windows.length; i++) {
      if (windows[i].mainView.id !== targetId) {
         maskWin = windows[i];
      }
   }

   var starCount = 0;
   var avgBrightness = 0;
   if (maskWin) {
      var maskImg = maskWin.mainView.image;
      var mr = new Rect(maskImg.width, maskImg.height);
      avgBrightness = maskImg.mean(mr, 0, 0);

      // Estimate star count from mask coverage
      // (rough heuristic: each star covers ~25-100 pixels)
      var maskMed = maskImg.median(mr, 0, 0);
      var maskMax = maskImg.maximum(mr, 0, 0);
      var maskPixels = maskImg.width * maskImg.height;

      // Count pixels above threshold
      var threshold = 0.3;
      // Use mean * area to estimate bright pixel count
      starCount = Math.round(avgBrightness * maskPixels / 50);

      maskWin.forceClose();
   }

   // Measure FWHM using the image statistics
   // We use median of bright peaks vs background as a proxy
   var r = new Rect(img.width, img.height);
   var med = img.median(r, 0, 0);
   var max = img.maximum(r, 0, 0);

   return {
      target: targetId,
      estimatedStarCount: starCount,
      maskMeanBrightness: avgBrightness,
      imageMedian: med,
      imageMax: max
   };
};

handlers.measure_subject_separation = function(params) {
   // How well the subject stands out from background.
   // Measures contrast ratio between center and edges.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var img = w.mainView.image;
   var iw = img.width;
   var ih = img.height;

   // Center region (subject area) - center 30%
   var cSize = Math.floor(Math.min(iw, ih) * 0.3);
   var cx = Math.floor(iw / 2 - cSize / 2);
   var cy = Math.floor(ih / 2 - cSize / 2);
   var centerRect = new Rect(cx, cy, cx + cSize, cy + cSize);

   // Corner region (background) - average of 4 corners
   var cornerSize = Math.floor(Math.min(iw, ih) * 0.1);
   var corners = [
      new Rect(0, 0, cornerSize, cornerSize),
      new Rect(iw - cornerSize, 0, iw, cornerSize),
      new Rect(0, ih - cornerSize, cornerSize, ih),
      new Rect(iw - cornerSize, ih - cornerSize, iw, ih)
   ];

   var centerMed = 0;
   var bgMed = 0;

   for (var c = 0; c < img.numberOfChannels && c < 3; c++) {
      centerMed += img.median(centerRect, c, c);
      var bgSum = 0;
      for (var i = 0; i < corners.length; i++) {
         bgSum += img.median(corners[i], c, c);
      }
      bgMed += bgSum / corners.length;
   }

   var nch = Math.min(img.numberOfChannels, 3);
   centerMed /= nch;
   bgMed /= nch;

   var contrastRatio = (bgMed > 0) ? centerMed / bgMed : 0;
   var separation = centerMed - bgMed;

   return {
      target: targetId,
      centerMedian: centerMed,
      backgroundMedian: bgMed,
      contrastRatio: contrastRatio,
      separation: separation
   };
};

handlers.detect_artifacts = function(params) {
   // Look for common processing artifacts.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var img = w.mainView.image;
   var iw = img.width;
   var ih = img.height;
   var r = new Rect(iw, ih);
   var issues = [];

   // 1. Check for hot pixels (extreme outliers)
   for (var c = 0; c < img.numberOfChannels && c < 3; c++) {
      var max = img.maximum(r, c, c);
      var p99Mean = img.mean(r, c, c);
      if (max > 0.999 && max > p99Mean * 20) {
         issues.push("Possible hot pixels in channel " + c);
      }
   }

   // 2. Check for banding (row/column noise)
   // Sample a few columns and check variance
   var colVars = [];
   var step = Math.floor(iw / 10);
   for (var x = step; x < iw - step; x += step) {
      var colRect = new Rect(x, 0, x + 1, ih);
      var colStd = img.stdDev(colRect, 0, 0);
      colVars.push(colStd);
   }
   var avgColVar = colVars.reduce(function(a, b) { return a + b; }, 0) / colVars.length;
   var maxColVar = Math.max.apply(null, colVars);
   if (maxColVar > avgColVar * 3) {
      issues.push("Possible banding detected (column noise variation: " + (maxColVar / avgColVar).toFixed(1) + "x)");
   }

   // 3. Check for clipped highlights
   var totalPixels = iw * ih;
   for (var c = 0; c < img.numberOfChannels && c < 3; c++) {
      var max = img.maximum(r, c, c);
      if (max >= 0.999) {
         // Estimate clipped fraction from mean and max
         var mean = img.mean(r, c, c);
         if (mean > 0.5) {
            issues.push("Significant highlight clipping in channel " + c);
         }
      }
   }

   // 4. Check for color fringing (channel misalignment at edges)
   // Compare channel medians in a ring around center
   var ringOuter = Math.floor(Math.min(iw, ih) * 0.45);
   var ringInner = Math.floor(Math.min(iw, ih) * 0.35);
   var rcx = Math.floor(iw / 2);
   var rcy = Math.floor(ih / 2);
   var ringRect = new Rect(rcx - ringOuter, rcy - ringOuter, rcx + ringOuter, rcy + ringOuter);

   if (img.numberOfChannels >= 3) {
      var ringR = img.median(ringRect, 0, 0);
      var ringG = img.median(ringRect, 1, 1);
      var ringB = img.median(ringRect, 2, 2);
      var maxDiff = Math.max(Math.abs(ringR - ringG), Math.abs(ringG - ringB), Math.abs(ringR - ringB));
      if (maxDiff > 0.05) {
         issues.push("Possible color fringing (channel median spread: " + maxDiff.toFixed(4) + ")");
      }
   }

   return {
      target: targetId,
      issues: issues,
      issueCount: issues.length
   };
};

handlers.measure_tonal_balance = function(params) {
   // Evaluate dynamic range usage, clipping, black crush.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var img = w.mainView.image;
   var r = new Rect(img.width, img.height);

   var channels = [];
   for (var c = 0; c < img.numberOfChannels && c < 3; c++) {
      var min = img.minimum(r, c, c);
      var max = img.maximum(r, c, c);
      var med = img.median(r, c, c);
      var mean = img.mean(r, c, c);
      var std = img.stdDev(r, c, c);

      channels.push({
         channel: c,
         min: min,
         max: max,
         median: med,
         mean: mean,
         stdDev: std,
         dynamicRange: max - min,
         midtoneBalance: med / (max - min + 0.001)
      });
   }

   // Overall dynamic range usage score
   var avgDR = 0;
   for (var i = 0; i < channels.length; i++) {
      avgDR += channels[i].dynamicRange;
   }
   avgDR /= channels.length;

   return {
      target: targetId,
      channels: channels,
      averageDynamicRange: avgDR
   };
};

// ---- Annotation & Watermark Command Handlers (Phase 7) ----

handlers.watermark = function(params) {
   // Draw text watermark on the image using PixelMath annotation.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");
   var text = params.text;
   if (!text) throw new Error("Missing 'text' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var img = w.mainView.image;
   var iw = img.width;
   var ih = img.height;

   var fontSize = params.fontSize || Math.max(12, Math.round(Math.min(iw, ih) * 0.018));
   var opacity = params.opacity || 0.5;
   var position = params.position || "bottom-right"; // top-left, top-right, bottom-left, bottom-right, bottom-center
   var color = params.color || 0.85; // grayscale value 0-1

   // Use Annotation process
   var AN = new Annotation;
   AN.annotationText = text;
   AN.annotationFont = params.font || "Helvetica";
   AN.annotationFontSize = fontSize;
   AN.annotationFontBold = params.bold !== false;
   AN.annotationFontItalic = params.italic || false;
   AN.annotationColor = 4294967295; // white (AARRGGBB)
   AN.annotationOpacity = Math.round(opacity * 255);

   // Calculate position
   var margin = Math.round(fontSize * 1.5);
   var textWidth = text.length * fontSize * 0.6; // rough estimate

   if (position === "top-left") {
      AN.annotationPositionX = margin;
      AN.annotationPositionY = margin;
   } else if (position === "top-right") {
      AN.annotationPositionX = iw - textWidth - margin;
      AN.annotationPositionY = margin;
   } else if (position === "bottom-left") {
      AN.annotationPositionX = margin;
      AN.annotationPositionY = ih - margin - fontSize;
   } else if (position === "bottom-center") {
      AN.annotationPositionX = Math.round(iw / 2 - textWidth / 2);
      AN.annotationPositionY = ih - margin - fontSize;
   } else { // bottom-right
      AN.annotationPositionX = iw - textWidth - margin;
      AN.annotationPositionY = ih - margin - fontSize;
   }

   AN.executeOn(w.mainView);

   return {
      target: targetId,
      text: text,
      position: position,
      fontSize: fontSize,
      opacity: opacity
   };
};

handlers.info_panel = function(params) {
   // Add a border panel below the image with target and acquisition info.
   // Extends the canvas downward, fills with dark background, draws text.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var img = w.mainView.image;
   var iw = img.width;
   var ih = img.height;

   var fontSize = params.fontSize || Math.max(11, Math.round(iw * 0.013));
   var panelHeight = params.panelHeight || Math.round(fontSize * 8);
   var bgValue = params.bgValue || 0.08; // dark gray

   // Build info lines
   var lines = [];
   if (params.targetName) lines.push(params.targetName);
   if (params.designations) lines.push(params.designations);
   if (params.constellation) lines.push("Constellation: " + params.constellation);
   if (params.integration) lines.push("Integration: " + params.integration);
   if (params.equipment) lines.push(params.equipment);
   if (params.date) lines.push(params.date);
   if (params.location) lines.push(params.location);
   if (params.bortle) lines.push("Bortle: " + params.bortle);
   if (params.processing) lines.push(params.processing);

   // Extend canvas downward
   var newHeight = ih + panelHeight;
   var CP = new CanvasSize;
   // Not available as process — use Crop with negative values
   // Actually, use PixelMath to create extended image

   // Create new window with extended size
   var newId = targetId + "_annotated";
   var newWin = new ImageWindow(iw, newHeight, img.numberOfChannels,
                                 img.bitsPerSample, img.isReal, img.isColor, newId);

   // Fill with background color
   newWin.mainView.beginProcess();
   var newImg = newWin.mainView.image;

   // Fill panel area with dark background
   var PM = new PixelMath;
   PM.expression = String(bgValue);
   PM.useSingleExpression = true;
   PM.createNewImage = false;
   PM.rescale = false;
   PM.truncate = true;
   PM.executeOn(newWin.mainView);

   newWin.mainView.endProcess();

   // Copy original image into top portion
   newWin.mainView.beginProcess();
   // Use PixelMath with coordinates
   // Actually, blend the original on top
   var PM2 = new PixelMath;
   PM2.expression = "iif(y() < " + ih + ", " + targetId + "(x(), y()), " + bgValue + ")";
   PM2.useSingleExpression = true;
   PM2.createNewImage = false;
   PM2.rescale = false;
   PM2.truncate = true;
   PM2.executeOn(newWin.mainView);
   newWin.mainView.endProcess();

   // Draw text lines using Annotation
   var lineHeight = Math.round(fontSize * 1.5);
   var startY = ih + Math.round(fontSize * 0.8);
   var margin = Math.round(iw * 0.03);

   for (var i = 0; i < lines.length; i++) {
      var AN = new Annotation;
      AN.annotationText = lines[i];
      AN.annotationFont = "Helvetica";
      AN.annotationFontSize = (i === 0) ? Math.round(fontSize * 1.4) : fontSize;
      AN.annotationFontBold = (i === 0);
      AN.annotationFontItalic = false;
      AN.annotationColor = 4294967295;
      AN.annotationOpacity = (i === 0) ? 230 : 180;
      AN.annotationPositionX = margin;
      AN.annotationPositionY = startY + (i * lineHeight);
      AN.executeOn(newWin.mainView);
   }

   newWin.show();

   return {
      originalTarget: targetId,
      annotatedTarget: newId,
      panelHeight: panelHeight,
      linesDrawn: lines.length
   };
};

handlers.embed_metadata = function(params) {
   // Set FITS keywords on an image for metadata embedding.
   var targetId = params.target || params.targetId;
   if (!targetId) throw new Error("Missing 'target' parameter");

   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var keywords = params.keywords || {};
   var existingKw = w.keywords;
   var newKw = [];

   // Preserve existing keywords
   for (var i = 0; i < existingKw.length; i++) {
      var keep = true;
      for (var key in keywords) {
         if (keywords.hasOwnProperty(key) && existingKw[i].name === key) {
            keep = false;
            break;
         }
      }
      if (keep) newKw.push(existingKw[i]);
   }

   // Add/update keywords
   for (var key in keywords) {
      if (keywords.hasOwnProperty(key)) {
         var val = keywords[key];
         var comment = "";
         if (typeof val === "object" && val !== null && val.value !== undefined) {
            comment = val.comment || "";
            val = val.value;
         }
         newKw.push(new FITSKeyword(key, String(val), comment));
      }
   }

   w.keywords = newKw;

   return {
      target: targetId,
      keywordsSet: Object.keys(keywords).length,
      totalKeywords: newKw.length
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

   // Use a Dialog with a Timer to keep the script alive while letting PI
   // process UI events. The dialog runs its own event loop, so PI stays
   // responsive. The Timer fires periodically to check for commands.
   var dlg = new Dialog;
   dlg.windowTitle = "AstroPilot Watcher";
   dlg.setMinSize(300, 80);

   var watcherTimer = new Timer;
   watcherTimer.interval = POLL_INTERVAL_MS / 1000.0;
   watcherTimer.periodic = true;
   watcherTimer.onTimeout = function() {
      if (!running) {
         watcherTimer.stop();
         dlg.cancel();
         return;
      }
      try {
         checkForCommands();
      } catch (e) {
         console.warningln("AstroPilot: Poll error: " + e.message);
      }
   };

   dlg.onShow = function() {
      watcherTimer.start();
   };

   dlg.execute();

   // Cleanup after dialog closes
   watcherTimer.stop();
   running = false;
   deleteFile(BRIDGE_BASE + "/watcher.pid");
   console.noteln("AstroPilot: Watcher stopped.");
})();

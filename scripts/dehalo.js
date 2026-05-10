// AstroPilot — Halo Reduction
// Subtracts large-scale diffuse glow around bright extended objects.
// Uses a heavily blurred model subtracted at a configurable amount.
// Preserves fine detail and structure.

var targetId = "Stars1"; // <-- set to your image window ID
var sigma = 150;         // Blur sigma - larger = targets only diffuse outer glow
var amount = 0.15;       // Subtraction amount (0-1) - lower = gentler

try {
   var output = [];
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

   // Heavy Gaussian blur to extract large-scale structure
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

   // Get background levels from corners
   var bgR = img.median(new Rect(0, 0, 300, 300), 0, 0);
   var bgG = img.median(new Rect(0, 0, 300, 300), 1, 1);
   var bgB = img.median(new Rect(0, 0, 300, 300), 2, 2);

   // Subtract: result = image - amount * (blur - background)
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

   output.push("Dehalo applied (sigma=" + sigma + ", amount=" + amount + ")");

   var f = new File;
   f.createForWriting(File.homeDirectory + "/pi_dehalo_output.txt");
   f.outTextLn(output.join("\n"));
   f.close();
} catch(e) {
   var f = new File;
   f.createForWriting(File.homeDirectory + "/pi_dehalo_output.txt");
   f.outTextLn("ERROR: " + e.message);
   f.close();
}

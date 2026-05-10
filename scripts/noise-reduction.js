// AstroPilot — Noise Reduction (ACDNR)
// Applies luminance and chrominance noise reduction.
// Chrominance is more aggressive; luminance preserves detail.

var targetId = "Stars1"; // <-- set to your image window ID

try {
   var output = [];
   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var NR = new ACDNR;
   NR.applyToLightness = true;
   NR.applyToLuminance = true;
   NR.applyToChrominance = true;

   // Luminance - moderate to preserve detail
   NR.sigmaL = 2.0;
   NR.shapeL = 0.5;
   NR.amountL = 0.85;
   NR.iterationsL = 3;
   NR.prefilterMethodL = 0;
   NR.protectionMethodL = 1;    // Multiscale structure protection
   NR.minStructSizeL = 5;
   NR.protectDarkSidesL = true;
   NR.protectBrightSidesL = true;
   NR.starProtectionL = true;
   NR.starThresholdL = 0.03;

   // Chrominance - more aggressive
   NR.sigmaC = 3.0;
   NR.shapeC = 0.5;
   NR.amountC = 1.0;
   NR.iterationsC = 3;
   NR.prefilterMethodC = 0;
   NR.protectionMethodC = 1;
   NR.minStructSizeC = 5;
   NR.protectDarkSidesC = true;
   NR.protectBrightSidesC = true;
   NR.starProtectionC = true;
   NR.starThresholdC = 0.03;

   NR.executeOn(w.mainView);
   output.push("ACDNR noise reduction applied");

   var f = new File;
   f.createForWriting(File.homeDirectory + "/pi_nr_output.txt");
   f.outTextLn(output.join("\n"));
   f.close();
} catch(e) {
   var f = new File;
   f.createForWriting(File.homeDirectory + "/pi_nr_output.txt");
   f.outTextLn("ERROR: " + e.message);
   f.close();
}

// AstroPilot — Star Reduction
// Creates a star mask, then applies morphological erosion to shrink stars.
// Mask protects non-star areas (galaxy, background).

var targetId = "Stars1"; // <-- set to your image window ID

try {
   var output = [];
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

   // Find the mask window
   var maskWin = null;
   var windows = ImageWindow.windows;
   for (var i = 0; i < windows.length; i++) {
      if (windows[i].mainView.id !== targetId) {
         maskWin = windows[i];
      }
   }
   if (!maskWin) throw new Error("Star mask not found");

   // Apply mask
   w.mask = maskWin;
   w.maskVisible = false;
   w.maskInverted = false;

   // Morphological erosion
   var MT = new MorphologicalTransformation;
   MT.operator = 0;           // Erosion
   MT.interlacingDistance = 1;
   MT.numberOfIterations = 2;
   MT.amount = 0.70;
   MT.selectionPoint = 0.50;
   MT.structureSize = 5;

   MT.executeOn(w.mainView);

   // Cleanup
   w.removeMask();
   maskWin.forceClose();
   output.push("Star reduction applied (erosion, 2 iterations, 70% amount)");

   var f = new File;
   f.createForWriting("C:/Users/allen/pi_starreduce_output.txt");
   f.outTextLn(output.join("\n"));
   f.close();
} catch(e) {
   var f = new File;
   f.createForWriting("C:/Users/allen/pi_starreduce_output.txt");
   f.outTextLn("ERROR: " + e.message);
   f.close();
}

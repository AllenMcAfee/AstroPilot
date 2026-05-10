// AstroPilot — Background Floor Fix
// Removes per-channel pedestal so all channels reach true black.
// Preserves all signal above the floor.

var targetId = "Stars1";

try {
   var output = [];
   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   var img = w.mainView.image;
   var r = new Rect(img.width, img.height);

   var minR = img.minimum(r, 0, 0);
   var minG = img.minimum(r, 1, 1);
   var minB = img.minimum(r, 2, 2);

   output.push("Before - Minimums: R=" + minR.toFixed(6) + " G=" + minG.toFixed(6) + " B=" + minB.toFixed(6));

   // Subtract each channel's floor so all reach 0
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

   var newMinR = img.minimum(r, 0, 0);
   var newMinG = img.minimum(r, 1, 1);
   var newMinB = img.minimum(r, 2, 2);
   var newMedR = img.median(r, 0, 0);
   var newMedG = img.median(r, 1, 1);
   var newMedB = img.median(r, 2, 2);

   output.push("After  - Minimums: R=" + newMinR.toFixed(6) + " G=" + newMinG.toFixed(6) + " B=" + newMinB.toFixed(6));
   output.push("After  - Medians:  R=" + newMedR.toFixed(6) + " G=" + newMedG.toFixed(6) + " B=" + newMedB.toFixed(6));
   output.push("Background floor fix applied!");

   var f = new File;
   f.createForWriting(File.homeDirectory + "/pi_bgfix_output.txt");
   f.outTextLn(output.join("\n"));
   f.close();
} catch(e) {
   var f = new File;
   f.createForWriting(File.homeDirectory + "/pi_bgfix_output.txt");
   f.outTextLn("ERROR: " + e.message);
   f.close();
}

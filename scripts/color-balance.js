// AstroPilot — Color Balance
// Neutralizes background and equalizes channel distributions.
// Uses green channel as reference. Preserves all structural detail.
// Target window ID must be set in the targetId variable below.

var targetId = "Stars1"; // <-- set to your image window ID

try {
   var output = [];
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

   output.push("Before - Medians: R=" + medR.toFixed(6) + " G=" + medG.toFixed(6) + " B=" + medB.toFixed(6));
   output.push("Before - StdDevs: R=" + stdR.toFixed(6) + " G=" + stdG.toFixed(6) + " B=" + stdB.toFixed(6));

   var refMedian = medG;
   var scaleR = stdG / stdR;
   var scaleB = stdG / stdB;

   output.push("Scale factors: R=" + scaleR.toFixed(6) + " B=" + scaleB.toFixed(6));

   // Transform: new_ch = (ch - ch_median) * scale + ref_median
   // Matches both background level and color intensity to green channel
   var PM = new PixelMath;
   PM.expression = "($T - " + medR.toFixed(8) + ") * " + scaleR.toFixed(8) + " + " + refMedian.toFixed(8);
   PM.expression1 = "$T";
   PM.expression2 = "($T - " + medB.toFixed(8) + ") * " + scaleB.toFixed(8) + " + " + refMedian.toFixed(8);
   PM.useSingleExpression = false;
   PM.symbols = "";
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

   // Verify
   var newMedR = img.median(r, 0, 0);
   var newMedG = img.median(r, 1, 1);
   var newMedB = img.median(r, 2, 2);
   var newStdR = img.stdDev(r, 0, 0);
   var newStdG = img.stdDev(r, 1, 1);
   var newStdB = img.stdDev(r, 2, 2);

   output.push("");
   output.push("After - Medians: R=" + newMedR.toFixed(6) + " G=" + newMedG.toFixed(6) + " B=" + newMedB.toFixed(6));
   output.push("After - StdDevs: R=" + newStdR.toFixed(6) + " G=" + newStdG.toFixed(6) + " B=" + newStdB.toFixed(6));
   output.push("Color balance applied successfully!");

   var f = new File;
   f.createForWriting(File.homeDirectory + "/pi_colorbalance_output.txt");
   f.outTextLn(output.join("\n"));
   f.close();
} catch(e) {
   var f = new File;
   f.createForWriting(File.homeDirectory + "/pi_colorbalance_output.txt");
   f.outTextLn("ERROR: " + e.message);
   f.close();
}

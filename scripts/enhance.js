// AstroPilot — Enhance (Local Contrast + Saturation + Curves)
// Applies local histogram equalization for dust lane detail,
// saturation boost for spiral arm colors, and an S-curve for contrast.

var targetId = "Stars1"; // <-- set to your image window ID

try {
   var output = [];
   var w = ImageWindow.windowById(targetId);
   if (w.isNull) throw new Error("Window '" + targetId + "' not found");

   // Local contrast enhancement (dust lanes, spiral arms)
   var LHE = new LocalHistogramEqualization;
   LHE.radius = 64;
   LHE.histogramBins = 0;
   LHE.slopeLimit = 1.5;
   LHE.amount = 0.40;
   LHE.circularKernel = true;
   LHE.executeOn(w.mainView);
   output.push("LHE applied (radius=64, slope=1.5, amount=0.40)");

   // Saturation boost - midtones only
   var CT = new CurvesTransformation;
   CT.St = 2;  // Akima subsplines
   CT.S = [
      [0.00000, 0.00000],
      [0.15000, 0.15000],
      [0.40000, 0.55000],
      [0.70000, 0.80000],
      [1.00000, 1.00000]
   ];
   CT.executeOn(w.mainView);
   output.push("Saturation boost applied");

   // S-curve contrast
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
   output.push("S-curve contrast applied");
   output.push("Enhancement complete!");

   var f = new File;
   f.createForWriting("C:/Users/allen/pi_enhance_output.txt");
   f.outTextLn(output.join("\n"));
   f.close();
} catch(e) {
   var f = new File;
   f.createForWriting("C:/Users/allen/pi_enhance_output.txt");
   f.outTextLn("ERROR: " + e.message);
   f.close();
}

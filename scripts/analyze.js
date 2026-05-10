// AstroPilot — Image Analysis
// Gathers per-channel statistics for all open images.
// Output: pi_analyze_output.txt in user home directory

try {
   var output = [];
   var windows = ImageWindow.windows;
   output.push("Available windows: " + windows.length);
   for (var i = 0; i < windows.length; i++) {
      output.push("  [" + i + "] id='" + windows[i].mainView.id + "'");
   }

   for (var wi = 0; wi < windows.length; wi++) {
      var w = windows[wi];
      var img = w.mainView.image;
      var r = new Rect(img.width, img.height);

      output.push("");
      output.push("=== " + w.mainView.id + " ===");
      output.push("Size: " + img.width + "x" + img.height + " " + img.numberOfChannels + "ch " + img.bitsPerSample + "bit " + (img.isReal ? "float" : "int"));

      var ch = ["R", "G", "B"];
      for (var c = 0; c < img.numberOfChannels && c < 3; c++) {
         var med = img.median(r, c, c);
         var mn = img.mean(r, c, c);
         var sd = img.stdDev(r, c, c);
         var lo = img.minimum(r, c, c);
         var hi = img.maximum(r, c, c);
         output.push(ch[c] + ": med=" + med.toFixed(6) + " mean=" + mn.toFixed(6) + " std=" + sd.toFixed(6) + " min=" + lo.toFixed(6) + " max=" + hi.toFixed(6));
      }

      var kw = w.keywords;
      if (kw.length > 0) {
         output.push("Keywords: " + kw.length);
         for (var i = 0; i < kw.length && i < 20; i++) {
            output.push("  " + kw[i].name + "=" + kw[i].value);
         }
      }
   }

   var f = new File;
   f.createForWriting("C:/Users/allen/pi_analyze_output.txt");
   f.outTextLn(output.join("\n"));
   f.close();
} catch(e) {
   var f = new File;
   f.createForWriting("C:/Users/allen/pi_analyze_output.txt");
   f.outTextLn("ERROR: " + e.message);
   f.close();
}

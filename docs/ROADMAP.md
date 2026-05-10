# AstroPilot Roadmap

## Vision

AstroPilot is an AI-powered astrophotography assistant that takes a beginner from raw sub-exposures to award-worthy final images — automatically. It leverages proven workflows from top astrophotographers, adapts processing to the target type, and teaches the user what it did and why at every step.

The project builds on the architecture pioneered by [pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp), adopting its file-based bridge protocol for PixInsight IPC while adding pre-processing (stacking), reporting, watermarking, and an educational layer designed to level up beginners.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                   AstroPilot CLI                  │
│          (Claude Code / Node.js orchestrator)     │
├──────────────┬───────────────┬────────────────────┤
│  Classifier  │  Pipeline     │  Report Generator  │
│  (target ID, │  (phase exec, │  (HTML/PDF output,  │
│   taxonomy)  │   scoring)    │   watermark, meta)  │
├──────────────┴───────────────┴────────────────────┤
│              Bridge Protocol (JSON IPC)            │
│         ~/.pixinsight-mcp/bridge/commands/          │
├───────────────────────────────────────────────────┤
│          PixInsight + PJSR Watcher Script          │
│     (ECMAScript 5, polls commands, returns results)│
└───────────────────────────────────────────────────┘
```

---

## Phase 0 — Foundation (Current State)

**Status: Complete**

What we have today:

- [x] Direct IPC to running PixInsight via `-x` script execution
- [x] Image analysis (per-channel stats, FITS keywords, radial profiles)
- [x] Color balancing (median + stddev matching to reference channel)
- [x] Background floor removal
- [x] Halo reduction (large-scale glow subtraction)
- [x] Noise reduction (ACDNR)
- [x] Star reduction (StarMask + MorphologicalTransformation)
- [x] Enhancement (LHE, saturation curves, S-curve contrast)
- [x] Git repo with modular scripts

---

## Phase 1 — Bridge Protocol Adoption

**Goal: Replace ad-hoc `-x` IPC with the robust file-based bridge from pixinsight-mcp**

This is the single most important architectural upgrade. The bridge enables bidirectional communication, error handling, timeouts, and multi-step workflows without race conditions.

- [ ] Port `pjsr/pixinsight-mcp-watcher.js` to AstroPilot (or depend on it)
- [ ] Implement Node.js bridge client (`bridge/client.js`)
  - JSON command writing to `~/.astropilot/bridge/commands/`
  - Result polling from `~/.astropilot/bridge/results/`
  - 200ms poll interval, 300s default timeout
  - Error handling and retry logic
- [ ] Implement core bridge commands:
  - `list_open_images` — enumerate windows
  - `get_image_statistics` — per-channel stats
  - `run_script` — arbitrary PJSR execution
  - `run_process` — execute a named PI process with parameters
- [ ] Add shutdown sentinel and graceful cleanup
- [ ] Bridge health check / ping command

---

## Phase 2 — Pre-Processing Pipeline (Stacking)

**Goal: Take raw sub-exposures and produce calibrated, stacked masters**

This is where beginners struggle most. AstroPilot should automate the entire WBPP workflow.

### 2a — File Discovery & Classification
- [ ] Scan input directory for FITS/XISF files
- [ ] Read FITS headers to auto-classify: lights, darks, flats, bias, flat-darks
- [ ] Group by filter (L, R, G, B, Ha, OIII, SII)
- [ ] Group by target (RA/DEC clustering or OBJECT keyword)
- [ ] Detect camera, gain, temperature, exposure time
- [ ] Display a summary table for user confirmation

### 2b — Calibration & Stacking
- [ ] Generate master darks, flats, bias (or flat-darks)
- [ ] Drive WBPP via bridge:
  - Calibration with matched darks/flats
  - Cosmetic correction (hot/cold pixel removal)
  - Sub-frame weighting (PSF Signal Weight)
  - Registration (StarAlignment)
  - Pixel rejection (Winsorized Sigma Clipping or ESD)
  - Integration (ImageIntegration)
  - Drizzle integration (optional, for undersampled data)
- [ ] Auto-crop stacking artifacts
- [ ] Quality report: frames accepted/rejected, weights, FWHM distribution

### 2c — Linear Pre-Processing
- [ ] Gradient removal (GradientCorrection or ABE, auto-selected)
- [ ] Background neutralization
- [ ] Photometric Color Calibration (SPCC preferred, PCC fallback)
- [ ] Linear noise reduction (NoiseXTerminator if available, else skip)
- [ ] Deconvolution / BlurXTerminator correction (if available)
- [ ] Star extraction for starless processing path (StarXTerminator if available)

---

## Phase 3 — Target Classification & Adaptive Workflows

**Goal: Automatically identify the target and select the optimal processing strategy**

Inspired by pixinsight-mcp's taxonomy system, but simplified for AstroPilot's scope.

### 3a — Target Classifier
- [ ] Identify target from FITS keywords (OBJECT, RA/DEC)
- [ ] Plate-solve if no coordinates (ImageSolver via bridge)
- [ ] Map to target taxonomy:

| Category | Processing Focus |
|----------|-----------------|
| Spiral Galaxy | Core/arms/IFN separation, dust lanes, Ha in arms |
| Edge-on Galaxy | Dust lane contrast, halo extension |
| Elliptical Galaxy | Smooth gradient preservation, outer halo |
| Galaxy Cluster | Tiny galaxy color diversity, uniform background |
| Emission Nebula | Ha-dominant, multi-zone, filament detail |
| Planetary Nebula | Shell structure, dual narrowband, central star |
| Reflection Nebula | Blue scattered light, subtle gradients |
| Dark Nebula | Silhouette contrast, surrounding field |
| Supernova Remnant | Filamentary detail, OIII/Ha separation |
| Globular Cluster | Core resolution, star color |
| Open Cluster | Star color diversity, field context |
| Mixed Field | Balance competing elements |

### 3b — Workflow Selection
- [ ] Select stretch algorithm by target type:
  - Seti Statistical Stretch for galaxies
  - GHS for nebulae (more shadow control)
  - Arcsinh for star clusters (star color preservation)
- [ ] Set processing profile defaults (saturation limits, NR strength, star policy)
- [ ] Determine channel combination strategy (RGB, LRGB, HaRGB, SHO, HOO)

---

## Phase 4 — Creative Processing Pipeline

**Goal: Automated nonlinear processing that produces competition-quality results**

### 4a — Stretch & Initial Enhancement
- [ ] Apply selected stretch algorithm
- [ ] Star recombination (screen blend) if starless processing
- [ ] Initial color balance post-stretch
- [ ] Background floor cleanup

### 4b — Detail Enhancement
- [ ] Luminance detail via LHE (radius/amount tuned by target type)
- [ ] HDRMultiscaleTransform for core/bright region compression
- [ ] Dark structure enhancement for dust lanes (DarkStructureEnhance or PixelMath)
- [ ] Sharpening via UnsharpMask or MultiscaleLinearTransform (masked)

### 4c — Color Processing
- [ ] Ha integration (red channel + luminance injection, soft-clamped)
- [ ] OIII integration (for planetary nebulae, SNR)
- [ ] SCNR green cast removal
- [ ] Selective color saturation (per hue-range curves)
- [ ] Color palette refinement by target type

### 4d — Star Processing
- [ ] Star color enhancement (masked saturation boost)
- [ ] Star size reduction (morphological, masked)
- [ ] Star halo reduction
- [ ] Screen blend parameter optimization

### 4e — Final Polish
- [ ] S-curve contrast adjustment
- [ ] Background gradient final check and correction
- [ ] Noise evaluation and optional final NR pass
- [ ] Dynamic range check (no clipping, no black crush)

---

## Phase 5 — Scoring & Quality Gates

**Goal: Objectively evaluate the result and catch common problems**

Adapted from pixinsight-mcp's scoring model:

### 5a — Automated Scoring (8 dimensions, 0-100)
- [ ] **Detail Credibility** — sharpness without ringing or artifacts
- [ ] **Background Quality** — smooth, neutral, no gradients
- [ ] **Color Naturalness** — plausible astrophysical colors
- [ ] **Star Integrity** — round, no halos, no bloat, preserved color
- [ ] **Tonal Balance** — good dynamic range usage, no clipping
- [ ] **Subject Separation** — target stands out from background
- [ ] **Artifact Penalty** — ringing, banding, color fringing, hot pixels
- [ ] **Aesthetic Coherence** — overall visual appeal

### 5b — Quality Gates (must pass before finishing)
- [ ] Zero burnt regions (no block >3% pixels above 0.93 luminance)
- [ ] Star FWHM < 6px, minimum 50 detected stars
- [ ] No channel imbalance in background
- [ ] Subject contrast ratio meets target-type minimum
- [ ] No ringing around bright structures

---

## Phase 6 — Processing Report

**Goal: Generate a beautiful, educational report documenting every step**

The report serves dual purposes: (1) teach the user what happened and why, (2) provide a shareable processing log for the community.

### 6a — Report Content
- [ ] **Cover page** — final image thumbnail, target name, date, location
- [ ] **Acquisition summary** — equipment, filters, exposure details, total integration time
- [ ] **Pre-processing section** — calibration details, frame rejection stats, FWHM chart
- [ ] **Target identification** — what the object is, classification, processing strategy chosen
- [ ] **Processing steps** — each step with:
  - What was done (process name, parameters)
  - Why it was done (educational explanation)
  - Before/after statistics
  - Tips for manual adjustment
- [ ] **Quality scores** — radar chart of the 8 scoring dimensions
- [ ] **Color balance history** — chart showing channel convergence over processing
- [ ] **Final image statistics** — per-channel summary
- [ ] **Glossary** — terms explained for beginners (SNR, FWHM, median, etc.)

### 6b — Report Format
- [ ] HTML report with embedded images (primary)
- [ ] PDF export option
- [ ] Markdown summary for AstroBin descriptions
- [ ] JSON machine-readable processing log

### 6c — Educational Layer
- [ ] "Why this step?" explanations tuned by user skill level
- [ ] "What to try next" suggestions for manual refinement
- [ ] Links to relevant tutorials and references
- [ ] Common mistakes and how AstroPilot avoided them

---

## Phase 7 — Image Annotation & Watermark

**Goal: Add professional artist marks and informative metadata to the final image**

### 7a — Watermark / Artist Mark
- [ ] Configurable text overlay (photographer name, date, location)
- [ ] Position options (corner placement, opacity, font size)
- [ ] Optional logo/signature image overlay
- [ ] Subtle enough to not distract, visible enough to credit

### 7b — Info Panel (optional border annotation)
- [ ] Target name and catalog designations (M31, NGC 224, Andromeda Galaxy)
- [ ] Constellation
- [ ] Distance and physical size
- [ ] Total integration time
- [ ] Equipment summary (telescope, camera, mount)
- [ ] Processing summary (one-liner)
- [ ] Date and location of capture
- [ ] Bortle class / SQM if available

### 7c — Metadata Embedding
- [ ] EXIF/FITS keywords in output file:
  - OBJECT, RA, DEC, DATE-OBS
  - TELESCOP, INSTRUME, FILTER
  - EXPTIME (total), NFRAMES
  - AUTHOR, LOCATION
  - SOFTWARE (AstroPilot version)
  - Processing hash (reproducibility)
- [ ] AstroBin-compatible metadata format
- [ ] ICC color profile embedding (sRGB for web)

---

## Phase 8 — Multi-Platform & Distribution

**Goal: Work on Windows, macOS, and Linux; easy installation**

- [ ] Windows support (current platform — already working via MSYS2/bash)
- [ ] macOS support (adapt bridge paths)
- [ ] Linux support
- [ ] npm package for easy installation
- [ ] PixInsight script installer (watcher auto-install)
- [ ] Configuration wizard (first-run setup)
- [ ] Equipment profile management (save/load telescope+camera configs)

---

## Phase 9 — Community & Learning

**Goal: Learn from the community, share results, improve over time**

- [ ] Processing profile sharing (export/import processing recipes)
- [ ] Memory system: learn from each processing session
  - What worked for this target type
  - Parameter ranges that produced good scores
  - Promote learnings across target types
- [ ] AstroBin integration (upload final image + description)
- [ ] Community recipe catalog (curated processing profiles)
- [ ] Skill progression tracking for the user

---

## Influencer Workflows Incorporated

AstroPilot's processing strategies draw from established techniques by top astrophotographers:

| Technique | Source | Used In |
|-----------|--------|---------|
| Seti Statistical Stretch | Franklin Marek | Galaxy stretching |
| GHS (Generalized Hyperbolic Stretch) | Mike Cranfield | Nebula stretching |
| LRGB with LinearFit | Standard PI workflow | Luminance combination |
| Ha soft-clamp injection | pixinsight-mcp | Emission integration |
| Screen blend star recombination | Bill Blanshan / Adam Block | Star restoration |
| Inverted HDRMT | Various | Faint structure lift |
| DarkStructureEnhance | PixInsight script library | Dust lane enhancement |
| PSF Signal Weight stacking | PixInsight WBPP | Frame weighting |
| Bracketed parameter exploration | pixinsight-mcp GIGA | Quality optimization |

---

## Key Differentiators from pixinsight-mcp

| Aspect | pixinsight-mcp | AstroPilot |
|--------|---------------|------------|
| **Pre-processing** | Assumes stacked masters | Full WBPP from raw subs |
| **Platform** | macOS only | Windows-first, cross-platform goal |
| **User level** | Advanced (autonomous agent) | Beginner-friendly with education |
| **Output** | Processed image only | Image + report + watermark + metadata |
| **XTerminator deps** | Required (BXT, NXT, SXT) | Graceful fallback to built-in tools |
| **Bridge** | JSON file IPC (proven) | Same protocol (adopted) |
| **Learning** | Agent memory (internal) | User-facing explanations + tips |
| **Cost** | Claude Max subscription | Claude Code (any tier) |

---

## Success Criteria

An AstroPilot-processed image should:

1. **Score 70+** on all 8 quality dimensions
2. **Pass all quality gates** with zero violations
3. **Be competitive** on AstroBin (Top Pick-worthy for the given data quality)
4. **Teach the user** something new about processing in every report
5. **Run end-to-end** from raw subs to final annotated image with zero user intervention
6. **Gracefully degrade** when optional tools (BXT, NXT, SXT) aren't available
7. **Never destroy data** — all operations are undoable, originals are preserved

# AstroPilot Roadmap

## Vision

AstroPilot is an AI-powered astrophotography assistant that takes a beginner from raw sub-exposures to award-worthy final images — automatically. It leverages proven workflows from top astrophotographers, adapts processing to the target type, and teaches the user what it did and why at every step.

The project builds on the architecture pioneered by [pixinsight-mcp](https://github.com/aescaffre/pixinsight-mcp), adopting its file-based bridge protocol for PixInsight IPC while adding pre-processing (stacking), reporting, watermarking, and an educational layer designed to level up beginners.

---

## Architecture Overview

AstroPilot is organized into three layers:

**CLI & Orchestration** — The command-line interface (`bridge/cli.js`) and Node.js orchestrator coordinate everything. The classifier identifies targets, the pipeline executes processing phases, and the report generator produces output.

**Bridge Protocol** — A file-based JSON IPC layer. The Node.js client writes commands to `~/.astropilot/bridge/commands/` and polls results from `~/.astropilot/bridge/results/`. Atomic file writes prevent partial reads.

**PixInsight & PJSR Watcher** — A long-lived polling script (`bridge/pjsr/watcher.js`) running inside PixInsight. Written in ECMAScript 5 (PJSR limitation). Executes commands and returns results.

---

## Phase 0 — Foundation

**Status: Complete**

What we started with:

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

**Status: Complete**

Replaced ad-hoc `-x` IPC with a robust file-based bridge protocol for bidirectional communication, error handling, timeouts, and multi-step workflows.

- [x] Port watcher script to AstroPilot (`bridge/pjsr/watcher.js`)
- [x] Implement Node.js bridge client (`bridge/client.js`)
  - JSON command writing to `~/.astropilot/bridge/commands/`
  - Result polling from `~/.astropilot/bridge/results/`
  - 200ms poll interval, 300s default timeout
  - Error handling and retry logic
- [x] Implement core bridge commands:
  - `list_open_images` — enumerate windows
  - `get_image_statistics` — per-channel stats
  - `run_script` — arbitrary PJSR execution
  - `run_process` — execute a named PI process with parameters
- [x] Add shutdown sentinel and graceful cleanup
- [x] Bridge health check / ping command

---

## Phase 2 — Pre-Processing Pipeline (Stacking)

**Status: Complete**

Takes raw sub-exposures and produces calibrated, stacked masters — the part where beginners struggle most.

### 2a — File Discovery & Classification
- [x] Scan input directory for FITS/XISF files
- [x] Read FITS headers to auto-classify: lights, darks, flats, bias, flat-darks
- [x] Group by filter (L, R, G, B, Ha, OIII, SII)
- [x] Group by target (RA/DEC clustering or OBJECT keyword)
- [x] Detect camera, gain, temperature, exposure time
- [x] Display a summary table for user confirmation

### 2b — Calibration & Stacking
- [x] Generate master darks, flats, bias (or flat-darks)
- [x] Drive stacking pipeline via bridge:
  - Calibration with matched darks/flats
  - Cosmetic correction (hot/cold pixel removal)
  - Sub-frame weighting (PSF Signal Weight)
  - Registration (StarAlignment)
  - Adaptive pixel rejection (Winsorized Sigma Clipping, Linear Fit Clipping, or Generalized ESD based on frame count)
  - Integration (ImageIntegration)
- [x] Auto-crop stacking artifacts
- [x] Quality report: frames accepted/rejected, weights, FWHM distribution

### 2c — Linear Pre-Processing
- [x] Gradient removal (ABE preferred, GradientCorrection fallback)
- [x] Background neutralization
- [x] Photometric Color Calibration (SPCC preferred, PCC fallback)
- [x] Linear noise reduction (NoiseXTerminator if available, MultiscaleLinearTransform fallback)
- [x] Deconvolution / BlurXTerminator correction (if available, else skipped)
- [x] Star extraction for starless processing path (StarXTerminator if available, else skipped)

---

## Phase 3 — Target Classification & Adaptive Workflows

**Status: Complete**

Automatically identifies the target and selects the optimal processing strategy based on a 77-object catalog covering the most commonly photographed deep-sky targets.

### 3a — Target Classifier
- [x] Identify target from FITS keywords (OBJECT, RA/DEC)
- [x] Plate-solve if no coordinates (ImageSolver via bridge)
- [x] Map to target taxonomy:

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
- [x] Select stretch algorithm by target type:
  - Statistical stretch for galaxies
  - GHS for nebulae (more shadow control)
  - Arcsinh for star clusters (star color preservation)
  - Auto STF as universal fallback
- [x] Set processing profile defaults (saturation limits, NR strength, star policy)
- [x] Determine channel combination strategy (RGB, LRGB, HaRGB, SHO, HOO)

---

## Phase 4 — Creative Processing Pipeline

**Status: Complete**

Automated nonlinear processing that adapts to the target type using per-type processing profiles.

### 4a — Stretch & Initial Enhancement
- [x] Apply selected stretch algorithm (statistical, GHS, arcsinh, or auto STF)
- [x] Star recombination (screen blend) if starless processing
- [x] Initial color balance post-stretch
- [x] Background floor cleanup

### 4b — Detail Enhancement
- [x] Luminance detail via LHE (radius/amount tuned by target type)
- [x] HDRMultiscaleTransform for core/bright region compression
- [x] Dark structure enhancement for dust lanes (PixelMath)
- [x] Sharpening via UnsharpMask (masked)

### 4c — Color Processing
- [x] Ha integration (red channel + luminance injection, soft-clamped)
- [x] OIII integration (for planetary nebulae, SNR)
- [x] SCNR green cast removal
- [x] Selective color saturation (per-channel curves)
- [x] Star color enhancement (masked saturation boost)

### 4d — Star Processing
- [x] Star color enhancement (masked saturation boost)
- [x] Star size reduction (morphological, masked)
- [x] Star halo reduction (dehalo)
- [x] Screen blend parameter optimization

### 4e — Final Polish
- [x] S-curve contrast adjustment
- [x] Channel balance check and correction
- [x] Dynamic range check (no clipping, no black crush)

---

## Phase 5 — Scoring & Quality Gates

**Status: Complete**

Objectively evaluates the result across eight dimensions and catches common problems with five quality gates.

### 5a — Automated Scoring (8 dimensions, 0-100)
- [x] **Detail Credibility** — sharpness without ringing or artifacts
- [x] **Background Quality** — smooth, neutral, no gradients
- [x] **Color Naturalness** — plausible astrophysical colors
- [x] **Star Integrity** — round, no halos, no bloat, preserved color
- [x] **Tonal Balance** — good dynamic range usage, no clipping
- [x] **Subject Separation** — target stands out from background
- [x] **Artifact Penalty** — ringing, banding, color fringing, hot pixels
- [x] **Aesthetic Coherence** — overall visual appeal

### 5b — Quality Gates (must pass before finishing)
- [x] Zero burnt regions (no block >3% pixels above 0.93 luminance)
- [x] Star FWHM < 6px, minimum 50 detected stars
- [x] No channel imbalance in background
- [x] Subject contrast ratio meets target-type minimum
- [x] No ringing around bright structures

---

## Phase 6 — Processing Report

**Status: Complete**

Generates educational reports documenting every processing step — what was done, why it matters, and tips for manual adjustment.

### 6a — Report Content
- [x] **Acquisition summary** — equipment, filters, exposure details, total integration time
- [x] **Target identification** — what the object is, classification, processing strategy chosen
- [x] **Processing steps** — each step with:
  - What was done (process name, parameters)
  - Why it was done (educational explanation)
  - Tips for manual adjustment
- [x] **Quality scores** — score bars for all 8 dimensions plus quality gates
- [x] **Final image statistics** — per-channel summary
- [x] **Glossary** — 27 terms explained for beginners (SNR, FWHM, median, etc.)

### 6b — Report Format
- [x] HTML report with dark theme (self-contained, no external dependencies)
- [x] Markdown summary for AstroBin descriptions
- [x] JSON machine-readable processing log

### 6c — Educational Layer
- [x] "Why this step?" explanations for every processing step
- [x] "What to try next" tips for manual refinement
- [x] Step explanations covering ~20 processing operations

---

## Phase 7 — Image Annotation & Watermark

**Status: Complete**

Adds professional artist marks and informative metadata to the final image.

### 7a — Watermark / Artist Mark
- [x] Configurable text overlay (photographer name, date)
- [x] Position options (corner placement, opacity, font size)
- [x] Bold/italic options
- [x] Subtle enough to not distract, visible enough to credit

### 7b — Info Panel (optional border annotation)
- [x] Target name and catalog designations
- [x] Constellation
- [x] Total integration time
- [x] Equipment summary (telescope, camera)
- [x] Date and location of capture
- [x] Bortle class if available
- [x] Processing summary

### 7c — Metadata Embedding
- [x] FITS keywords in output file:
  - OBJECT, RA, DEC, DATE-OBS
  - TELESCOP, INSTRUME, FILTER
  - EXPTIME (total), NFRAMES
  - AUTHOR, LOCATION
  - SOFTWARE (AstroPilot)
  - Processing hash (SHA-256 for reproducibility)
- [x] Auto-populated from classification and session data

---

## Phase 8 — Multi-Platform & Distribution

**Status: Complete**

Cross-platform support, npm packaging, configuration management, and equipment profiles.

- [x] Windows support (primary development platform)
- [x] macOS support (platform detection, PI app bundle paths, executable lookup)
- [x] Linux support (platform detection, standard PI install paths)
- [x] npm package (`package.json` with bin entry, `npm install -g astropilot`)
- [x] PixInsight script installer (`install-watcher` command copies watcher to PI scripts)
- [x] Configuration wizard (`init` command — detects PI, sets author/location/bortle)
- [x] Equipment profile management (save/load telescope+camera+mount configs)
- [x] Cross-platform path resolution (`lib/platform.js` — PI finder, scripts dir, executable)
- [x] Config persistence (`~/.astropilot/config.json` with dot-path get/set)
- [x] Legacy scripts updated (hardcoded paths replaced with `File.homeDirectory`)

---

## Phase 9 — Community & Learning

**Status: Planned**

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
| Statistical Stretch | Franklin Marek | Galaxy stretching |
| GHS (Generalized Hyperbolic Stretch) | Mike Cranfield | Nebula stretching |
| LRGB with LinearFit | Standard PI workflow | Luminance combination |
| Ha soft-clamp injection | pixinsight-mcp | Emission integration |
| Screen blend star recombination | Bill Blanshan / Adam Block | Star restoration |
| Inverted HDRMT | Various | Faint structure lift |
| DarkStructureEnhance | PixInsight script library | Dust lane enhancement |
| PSF Signal Weight stacking | PixInsight WBPP | Frame weighting |

---

## Key Differentiators from pixinsight-mcp

| Aspect | pixinsight-mcp | AstroPilot |
|--------|---------------|------------|
| **Pre-processing** | Assumes stacked masters | Full stacking from raw subs |
| **Platform** | macOS only | Windows-first, cross-platform goal |
| **User level** | Advanced (autonomous agent) | Beginner-friendly with education |
| **Output** | Processed image only | Image + report + watermark + metadata |
| **XTerminator deps** | Required (BXT, NXT, SXT) | Graceful fallback to built-in tools |
| **Bridge** | JSON file IPC (proven) | Same protocol (adopted) |
| **Learning** | Agent memory (internal) | User-facing explanations + tips |

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

# AstroPilot

AstroPilot is my attempt to take the pain out of astrophotography processing. If you've ever stared at a freshly stacked image in PixInsight and thought "okay, now what?" — this is for you.

It talks to a running PixInsight instance through a JSON bridge protocol, classifies your target, picks a processing strategy, runs the whole pipeline, scores the result, and writes a report explaining what it did and why. The goal is to go from raw sub-exposures to a finished, annotated image with zero hand-holding — while teaching you something along the way.

## What it can do

**Pre-processing** — Scan a directory of FITS/XISF files, auto-classify lights/darks/flats/bias by reading headers, validate calibration frame compatibility (gain, offset, temperature, binning, exposure, camera, and filter matching), create master calibration frames, calibrate, measure subframe quality, register, stack with adaptive pixel rejection, and auto-crop stacking artifacts. Multi-filter sessions are handled automatically.

**Target identification** — Looks up your target from FITS keywords or plate solving, matches it against a 77-object catalog covering the most commonly photographed deep-sky targets, and maps it to one of 12 processing types (spiral galaxy, emission nebula, globular cluster, etc.).

**Adaptive processing** — Each target type has a processing profile that sets the stretch algorithm (statistical for galaxies, GHS for nebulae, arcsinh for clusters), noise reduction aggressiveness, star handling, detail enhancement, and color strategy. The pipeline doesn't use the same settings for M42 as it does for M13.

**Linear pre-processing** — Gradient removal, background neutralization, color calibration (SPCC preferred, PCC fallback), linear noise reduction (NoiseXTerminator preferred, MultiscaleLinearTransform fallback), deconvolution (BlurXTerminator or skip), star extraction (StarXTerminator or skip). Every optional tool has a graceful fallback — the pipeline never fails because a plugin is missing.

**Creative processing** — Four stretch algorithms, HDR multiscale transform for bright cores, dark structure enhancement for dust lanes, Ha and OIII blending with soft clamping, SCNR, selective saturation, star color enhancement, star reduction, screen blend recombination, S-curve contrast, and dynamic range validation.

**Quality scoring** — Eight dimensions scored 0-100 (detail credibility, background quality, color naturalness, star integrity, tonal balance, subject separation, artifact detection, aesthetic coherence) plus five quality gates that must all pass before the image is considered done.

**Reports** — HTML report with a dark theme, score bars, quality gates, every processing step with "what was done / why it matters / tip for manual adjustment" explanations, acquisition summary, and a 27-term glossary. Also generates Markdown (for AstroBin descriptions) and JSON (machine-readable log).

**Annotation** — Watermark with configurable text, position, and opacity. Info panel border with target name, catalog designations, integration time, equipment, date, location, and Bortle class. FITS metadata embedding with a processing hash for reproducibility.

## How the bridge works

AstroPilot uses a file-based bridge to communicate with PixInsight. There are two sides:

**Inside PixInsight** — A watcher script (`bridge/pjsr/watcher.js`) runs as a long-lived polling loop. It watches `~/.astropilot/bridge/commands/` for incoming JSON files, executes them, and writes results to `~/.astropilot/bridge/results/`. You start it once per session from Script > Run.

**Outside PixInsight** — A Node.js client (`bridge/client.js`) writes command files and polls for results. The CLI tool (`bridge/cli.js`) wraps this into a command-line interface. The watcher writes a `watcher.pid` file so the client knows it's alive, and you can stop it by dropping a `shutdown` sentinel into the commands folder.

## Getting started

You need PixInsight 1.9+ and Node.js 16+. Works on Windows, macOS, and Linux.

**Install from npm:**

```bash
npm install -g astropilot
```

**Or clone and link:**

```bash
git clone https://github.com/AllenMcAfee/AstroPilot.git
cd AstroPilot
npm link
```

**First-run setup:**

```bash
# run the setup wizard — detects PixInsight, sets your name, location, etc.
astropilot init

# or install the watcher manually
astropilot install-watcher
```

**Start processing:**

1. Open PixInsight
2. Run the watcher: **Script > Run** and select the installed `AstroPilot/watcher.js`
3. From a terminal:

```bash
# check the watcher is alive
astropilot ping

# see what images are open
astropilot list

# get stats for an image
astropilot stats MyImage
```

You can also run directly without installing globally: `node bridge/cli.js <command>`.

## Common workflows

**Process a single image that's already open in PI:**

```bash
# classify it and see what profile gets selected
node bridge/cli.js classify MyImage

# run the adaptive creative pipeline
node bridge/cli.js creative MyImage

# score the result
node bridge/cli.js score MyImage

# generate a report
node bridge/cli.js report MyImage ./output

# add watermark and info panel
node bridge/cli.js annotate MyImage --author="Your Name"
```

**Stack from raw subs:**

```bash
# scan a directory to see what you have
node bridge/cli.js scan "D:/Astro/2024-01-15_M42"

# stack it (handles calibration, registration, integration)
node bridge/cli.js stack "D:/Astro/2024-01-15_M42"

# then run linear pre-processing on the stacked result
node bridge/cli.js linear integration1

# then creative processing
node bridge/cli.js creative integration1
```

**Run the old-school pipeline (individual steps):**

```bash
node bridge/cli.js color-balance MyImage
node bridge/cli.js background-fix MyImage
node bridge/cli.js dehalo MyImage 150 0.15
node bridge/cli.js noise-reduction MyImage
node bridge/cli.js star-reduction MyImage
node bridge/cli.js enhance MyImage

# or all at once
node bridge/cli.js pipeline MyImage
```

## All CLI commands

**Bridge:**

| Command | What it does |
|---------|-------------|
| `status` | Check if the watcher is running |
| `ping` | Health check with version and uptime |
| `list` | List all open image windows |
| `stats <id>` | Per-channel statistics and FITS keywords |
| `run "<code>"` | Execute arbitrary PJSR code |
| `process <name> <id>` | Run any PixInsight process by name |
| `tools` | Check which optional processes are installed |
| `shutdown` | Stop the watcher |

**Pre-processing:**

| Command | What it does |
|---------|-------------|
| `scan <dir>` | Scan and classify FITS/XISF files |
| `scan <dir> --json` | Same, but output as JSON |
| `validate <dir>` | Check calibration frame compatibility before stacking |
| `stack <dir> [outDir]` | Full stacking pipeline (validates first) |
| `stack <dir> --force` | Stack despite validation errors |

**Processing:**

| Command | What it does |
|---------|-------------|
| `linear <id>` | Linear pre-processing (gradients, color cal, NR) |
| `linear <id> --stars` | Linear pre-processing + star extraction |
| `classify <id>` | Identify target and show processing profile |
| `lookup <name>` | Search the built-in target catalog |
| `creative <id>` | Adaptive creative processing pipeline |
| `creative <id> --ha=<id>` | With Ha blending |
| `pipeline <id>` | Simple fixed processing pipeline |

**Individual steps:**

| Command | What it does |
|---------|-------------|
| `color-balance <id>` | Neutralize background, equalize channels |
| `background-fix <id>` | Remove per-channel floor offsets |
| `dehalo <id> [sigma] [amount]` | Subtract diffuse glow |
| `noise-reduction <id>` | ACDNR noise reduction |
| `star-reduction <id>` | Star mask + morphological erosion |
| `enhance <id>` | LHE + saturation + S-curve |

**Output:**

| Command | What it does |
|---------|-------------|
| `score <id>` | Score image quality (8 dimensions + 5 gates) |
| `report <id> [outDir]` | Generate HTML + Markdown + JSON report |
| `annotate <id>` | Add watermark, info panel, and metadata |

**Setup & Equipment:**

| Command | What it does |
|---------|-------------|
| `init` | First-run setup wizard |
| `config` | Show current configuration |
| `config set <key> <value>` | Change a config value |
| `info` | Show platform and PixInsight install details |
| `install-watcher [piPath]` | Install watcher script to PixInsight |
| `equipment list` | List saved equipment profiles |
| `equipment show <name>` | Show an equipment profile |
| `equipment create <name> [json]` | Create an equipment profile |
| `equipment delete <name>` | Delete an equipment profile |

**Recipes & Learning:**

| Command | What it does |
|---------|-------------|
| `recipe list` | List saved processing recipes |
| `recipe show <name>` | Show a recipe's settings and score |
| `recipe export <name> <file>` | Export a recipe for sharing |
| `recipe import <file>` | Import a recipe from someone else |
| `history` | Show processing session history |
| `learnings [type]` | Show what AstroPilot has learned per target type |
| `suggest <type>` | Get parameter suggestions based on past sessions |
| `progress` | Show skill level, milestones, and improvement |
| `astrobin-desc <id>` | Generate AstroBin-ready image description |
| `astrobin-upload <file>` | Upload an image to AstroBin |

## Using the client library

If you want to build on top of AstroPilot, the client is a CommonJS module:

```javascript
const bridge = require('./bridge/client');

// basics
await bridge.ping();
const images = await bridge.listOpenImages();
const stats = await bridge.getImageStatistics('MyImage');

// pipeline steps
await bridge.colorBalance('MyImage');
await bridge.dehalo('MyImage', { sigma: 200, amount: 0.10 });
await bridge.noiseReduction('MyImage', { sigmaL: 1.5, sigmaC: 4.0 });
await bridge.enhance('MyImage', { lheRadius: 80, saturationBoost: true, sCurve: false });

// higher-level modules
const { classifyTarget } = require('./lib/target-classifier');
const { creativePipeline } = require('./lib/creative-pipeline');
const { scoreImage } = require('./lib/scorer');
const { writeReport } = require('./lib/report');
const { annotateImage } = require('./lib/annotate');
```

## Project structure

```
bridge/
  pjsr/watcher.js    PixInsight-side watcher (PJSR / ECMAScript 5)
  client.js          Node.js bridge client
  cli.js             Command-line interface

lib/
  fits-header.js     FITS header parser (no pixel data loaded)
  xisf-header.js     XISF header parser
  classifier.js      Frame classification (type, filter, target, equipment)
  stacker.js         Stacking orchestrator (calibrate, register, integrate)
  validator.js       Pre-stacking calibration frame validation
  linear-preprocess.js  Linear pre-processing pipeline
  catalog.js         77-object deep-sky target catalog
  profiles.js        12 processing profiles by target type
  target-classifier.js  Target identification and profile selection
  creative-pipeline.js  Adaptive creative processing pipeline
  scorer.js          8-dimension scoring engine and quality gates
  report.js          HTML / Markdown / JSON report generator
  annotate.js        Watermark, info panel, and metadata embedding
  platform.js        Cross-platform support (Windows, macOS, Linux)
  config.js          Configuration management and setup wizard
  equipment.js       Equipment profile management
  recipes.js         Processing recipe export/import/sharing
  memory.js          Session logging, learning engine, skill progression
  astrobin.js        AstroBin description generation and uploads

scripts/             Original standalone PJSR scripts
docs/ROADMAP.md      Full project roadmap
package.json         npm package definition
```

## Optional dependencies

AstroPilot works with or without these — it adapts automatically:

| Tool | Used for | Without it |
|------|----------|-----------|
| NoiseXTerminator | Linear noise reduction | Falls back to MultiscaleLinearTransform |
| BlurXTerminator | Deconvolution | Skipped |
| StarXTerminator | Star extraction for starless processing | Skipped |
| GHS (script) | Nebula stretching | Falls back to STF auto-stretch |
| SPCC | Color calibration | Falls back to PCC |

## What's next

All nine development phases are complete. Future work will focus on refining the learning engine as more sessions accumulate, expanding the target catalog, and community recipe contributions. See `docs/ROADMAP.md` for the full history.

## License

MIT

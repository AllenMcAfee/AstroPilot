# AstroPilot

AstroPilot is my attempt to take the pain out of astrophotography processing. If you've ever stared at a freshly stacked image in PixInsight and thought "okay, now what?" — this is for you.

It talks to a running PixInsight instance through a simple bridge protocol, so you can run processing steps from the command line, chain them into a full pipeline, or eventually let it figure out the right workflow for your target automatically.

The long-term goal is to go from raw sub-exposures to a finished, annotated image with zero hand-holding — while actually explaining what it did and why, so you learn something along the way.

## What it does today

AstroPilot handles the core post-stretch processing steps that come up in almost every session:

- **Color balancing** — matches channel medians and standard deviations to a reference, so your background is neutral and your colors are even
- **Background fix** — subtracts the per-channel floor so everything starts from true black
- **Halo reduction** — builds a blurred model of the large-scale glow and subtracts it, keeping fine detail intact
- **Noise reduction** — ACDNR with separate luminance and chrominance controls, structure protection, and star masking
- **Star reduction** — generates a star mask, then applies morphological erosion to shrink bloated stars
- **Enhancement** — local histogram equalization for dust lanes and structure, a midtone saturation curve, and an S-curve for contrast
- **Image analysis** — per-channel statistics and FITS keyword readout

Every operation goes through PixInsight's undo system, so nothing is destructive.

## How it works

AstroPilot uses a file-based bridge to communicate with PixInsight. There are two sides to it:

**Inside PixInsight** — A watcher script (`bridge/pjsr/watcher.js`) runs as a long-lived polling loop. It watches a commands folder for incoming JSON files, executes them, and writes results back. You start it once per session from Script > Run.

**Outside PixInsight** — A Node.js client (`bridge/client.js`) writes command files and polls for results. The CLI tool (`bridge/cli.js`) wraps this into a simple command-line interface.

The bridge directory lives at `~/.astropilot/bridge/`. Commands go in, results come out. The watcher writes a `watcher.pid` file so the client knows it's alive, and you can stop it by dropping a `shutdown` sentinel file into the commands folder.

## Getting started

You need PixInsight 1.9+ and Node.js.

1. Open PixInsight
2. Run the watcher: **Script > Run** and select `bridge/pjsr/watcher.js`
3. From a terminal, try it out:

```bash
# check the watcher is alive
node bridge/cli.js ping

# see what images are open
node bridge/cli.js list

# get stats for an image
node bridge/cli.js stats MyImage

# run a single step
node bridge/cli.js color-balance MyImage
node bridge/cli.js dehalo MyImage 150 0.15

# run the full recommended pipeline
node bridge/cli.js pipeline MyImage
```

## The pipeline

The `pipeline` command runs through the full recommended processing sequence. It re-balances colors after each major step, which matters more than you'd think — every operation shifts the channel distributions slightly.

1. Analyze the image
2. Color balance
3. Background fix (remove channel floors)
4. Color balance again
5. Halo reduction
6. Color balance again
7. Noise reduction (ACDNR)
8. Color balance again
9. Star reduction
10. Enhancement (LHE, saturation, contrast)

You can also run any step individually if you just need one thing.

## Available commands

**Core:**

| Command | What it does |
|---------|-------------|
| `ping` | Health check — confirms the watcher is running |
| `list` | Lists all open image windows |
| `stats <id>` | Per-channel statistics and FITS keywords |
| `run "<code>"` | Execute arbitrary PJSR code |
| `process <name> <id>` | Run any PixInsight process by name |

**Pipeline steps:**

| Command | What it does |
|---------|-------------|
| `color-balance <id>` | Neutralize background, equalize channels |
| `background-fix <id>` | Remove per-channel floor offsets |
| `dehalo <id> [sigma] [amount]` | Subtract diffuse glow (defaults: sigma=150, amount=0.15) |
| `noise-reduction <id>` | ACDNR with luminance/chrominance separation |
| `star-reduction <id>` | Star mask + morphological erosion |
| `enhance <id>` | LHE + saturation boost + S-curve |
| `pipeline <id>` | All of the above in the recommended order |

## Using the client library

If you want to build on top of AstroPilot, the client is a simple CommonJS module:

```javascript
const bridge = require('./bridge/client');

const stats = await bridge.getImageStatistics('MyImage');
console.log(stats.channels);

await bridge.colorBalance('MyImage');
await bridge.dehalo('MyImage', { sigma: 200, amount: 0.10 });
await bridge.noiseReduction('MyImage', { sigmaL: 1.5, sigmaC: 4.0 });
await bridge.enhance('MyImage', { lheRadius: 80, saturationBoost: true, sCurve: false });
```

All pipeline functions accept an options object to override defaults.

## Project structure

- `bridge/pjsr/watcher.js` — the PixInsight-side watcher (PJSR / ECMAScript 5)
- `bridge/client.js` — Node.js client library
- `bridge/cli.js` — command-line interface
- `scripts/` — the original standalone scripts (still work via `PixInsight.exe -x=`)
- `docs/ROADMAP.md` — where this is all heading

## What's next

The roadmap covers a lot of ground — stacking from raw subs, automatic target identification, adaptive processing strategies, quality scoring, and educational reports. See `docs/ROADMAP.md` for the full plan.

## License

MIT

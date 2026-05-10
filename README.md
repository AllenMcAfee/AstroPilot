# AstroPilot

AI-powered scripting assistant for [PixInsight](https://pixinsight.com/) — automate and streamline your astrophotography processing workflow.

AstroPilot bridges Claude Code and PixInsight's JavaScript runtime via IPC, enabling conversational image processing: describe what you want, and AstroPilot generates and executes the scripts for you.

## Features

- **Color Balancing** — Background neutralization and channel equalization
- **Background Fix** — Per-channel pedestal removal for true black backgrounds
- **Halo Reduction** — Large-scale glow subtraction around bright extended objects
- **Noise Reduction** — ACDNR with luminance/chrominance separation
- **Star Reduction** — Star mask + morphological erosion to shrink stars
- **Enhancement** — Local contrast (dust lanes), saturation boost, S-curve contrast
- **IPC Integration** — Scripts execute directly in your running PixInsight instance
- **Non-Destructive** — All operations land in PixInsight's undo history

## Scripts

| Script | Description |
|--------|-------------|
| `analyze.js` | Per-channel statistics and FITS keyword readout |
| `color-balance.js` | Match channel medians and standard deviations to green reference |
| `background-fix.js` | Remove per-channel minimum floor for true black |
| `dehalo.js` | Subtract large-scale diffuse glow (configurable sigma/amount) |
| `noise-reduction.js` | ACDNR with structure-preserving multiscale protection |
| `star-reduction.js` | StarMask + morphological erosion |
| `enhance.js` | LHE + saturation curve + S-curve contrast |

## Requirements

- PixInsight 1.9+ (Windows)
- Claude Code CLI

## Usage

Scripts are sent to a running PixInsight instance via IPC:

```bash
PixInsight.exe -x="path/to/script.js"
```

Each script has a `targetId` variable at the top — set it to your image window ID before running.

## Recommended Processing Order

1. `analyze.js` — Assess the image
2. `color-balance.js` — Neutralize background and equalize channels
3. `background-fix.js` — Remove channel floor offsets
4. `color-balance.js` — Re-balance after floor fix
5. `dehalo.js` — Reduce extended glow around bright objects
6. `color-balance.js` — Re-balance after dehalo
7. `noise-reduction.js` — ACDNR denoise
8. `color-balance.js` — Re-balance after NR
9. `star-reduction.js` — Shrink stars
10. `enhance.js` — Local contrast, saturation, curves
11. `color-balance.js` — Final balance

## License

MIT

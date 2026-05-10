# AstroPilot

AI-powered scripting assistant for [PixInsight](https://pixinsight.com/) — automate and streamline your astrophotography processing workflow.

AstroPilot bridges Claude Code and PixInsight's JavaScript runtime via IPC, enabling conversational image processing: describe what you want, and AstroPilot generates and executes the scripts for you.

## Features

- **Color Balancing** — Automatic background neutralization and channel equalization
- **IPC Integration** — Scripts execute directly in your running PixInsight instance
- **Non-Destructive** — All operations land in PixInsight's undo history

## Requirements

- PixInsight 1.9+ (Windows)
- Claude Code CLI

## Usage

Scripts are sent to a running PixInsight instance via IPC:

```bash
PixInsight.exe -x="path/to/script.js"
```

## License

MIT

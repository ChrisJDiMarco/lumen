# Lumen

Lumen is a calm, adaptive visual-attention game for macOS and the web. It uses one React/PixiJS experience in a Vite web build and a native Tauri shell.

## Run

```bash
npm install
npm run dev
npm run tauri dev
```

Production builds:

```bash
npm run build
npm run tauri -- build --bundles app
```

Verification:

```bash
npm run verify
npm run e2e
```

The app stores comfort preferences, journey history, and a safe inter-trial checkpoint locally in IndexedDB. It has no account, advertising, analytics, or network telemetry.

Research context and product boundaries are documented in [PRD.md](./PRD.md). Lumen is inspired by research on adaptive visual speed training, but it has not been clinically validated and is not a medical product.

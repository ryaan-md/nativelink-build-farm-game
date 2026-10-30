# NativeLink Build-Farm Game

A 5–8 minute browser game: you are VP of Platform. Enable a shared action cache, then remote execution, then size the worker pool. The board is the protocol — action cache, CAS, scheduler, workers — not a slide deck.

The playable root is `<BuildFarmGame />` in `src/game/BuildFarmGame.tsx`. This repo is a thin Vite shell so the same component can later become a docs.nativelink.com route.

## Run

```bash
npm install
npm run dev
```

Open the printed localhost URL. Desktop viewport.

```bash
npm test        # engine invariants
npm run build   # typecheck + production bundle
```

## What it teaches

- A cache hit never reaches the scheduler.
- Clean builds and unique changes still have to run somewhere.
- The win is parallelism and shared results, not faster single-action latency.
- Identical in-flight actions merge. A platform-property mismatch queues forever.
- The worker writes the `ActionResult`. The scheduler only assigned the work.

## Layout

```
src/game/
  BuildFarmGame.tsx   portable root
  engine/             deterministic tick sim (no React)
  session.ts          upgrades, incidents, SLA, coach
  board/              renderer
```

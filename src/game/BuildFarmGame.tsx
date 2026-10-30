import { useEffect } from 'react'
import { Board } from './board/Board.tsx'
import { Dock } from './board/Dock.tsx'
import { GraphStrip } from './board/GraphStrip.tsx'
import { HUD } from './board/HUD.tsx'
import { ticksPerSecond, useGame } from './store.ts'

export function BuildFarmGame() {
  const snap = useGame((state) => state.snap)
  const tick = useGame((state) => state.tick)
  const begin = useGame((state) => state.begin)

  useEffect(() => {
    let last = performance.now()
    let acc = 0
    let frame = 0
    const loop = (now: number) => {
      const dt = Math.min(100, now - last)
      last = now
      const current = useGame.getState().snap
      if (current.outcome !== 'title') {
        acc += (dt / 1000) * ticksPerSecond() * current.speed
        const n = Math.min(32, Math.floor(acc))
        acc -= n
        if (n > 0) useGame.getState().pump(n)
      }
      frame = window.requestAnimationFrame(loop)
    }
    frame = window.requestAnimationFrame(loop)
    return () => window.cancelAnimationFrame(frame)
  }, [tick])

  return (
    <div className="nl-game relative flex min-h-dvh flex-col bg-nl-bg text-nl-fg" data-theme="dark">
      <HUD snap={snap} />
      <Board farm={snap.farm} hang={snap.hang} />
      <GraphStrip nodes={snap.farm.graph} />
      <Dock snap={snap} />
      {snap.outcome === 'title' ? <TitleCard onBegin={begin} /> : null}
    </div>
  )
}

function TitleCard({ onBegin }: { onBegin: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-nl-bg/80 px-6 backdrop-blur-sm">
      <div className="max-w-lg rounded-xl border border-nl-border bg-nl-surface p-8 shadow-[0_30px_80px_rgb(0_0_0/0.45)]">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-nl-brand">NativeLink</div>
        <h1 className="mt-2 text-3xl tracking-tight">You are VP of Platform.</h1>
        <p className="mt-3 text-[15px] leading-6 text-nl-muted-fg">
          The monorepo is the bottleneck. Friday has a deploy window. The board is a shared cache,
          a scheduler, and a worker pool — not a quiz.
        </p>
        <p className="mt-3 text-[15px] leading-6 text-nl-muted-fg">
          Hit p95 developer wait ≤ 8s and CI wall ≤ 11s before 17:00. The ghost numbers are this
          morning without you.
        </p>
        <button
          type="button"
          onClick={onBegin}
          className="mt-6 rounded-md bg-nl-brand px-4 py-2 text-sm text-nl-brand-fg hover:bg-nl-brand-strong"
        >
          Open Monday
        </button>
      </div>
    </div>
  )
}

import { fmtMin, fmtPct, fmtSec } from '../format.ts'
import type { GameSnapshot } from '../session.ts'

function Cell({
  label,
  value,
  ghost,
  warn,
  ok,
}: {
  label: string
  value: string
  ghost?: string
  warn?: boolean
  ok?: boolean
}) {
  return (
    <div className="min-w-0 border-r border-nl-border px-3 py-2 last:border-r-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-nl-muted">{label}</div>
      <div
        className={`mt-0.5 font-mono text-xl leading-none tabular-nums ${
          warn ? 'text-nl-danger' : ok ? 'text-nl-success' : 'text-nl-fg'
        }`}
      >
        {value}
      </div>
      {ghost ? <div className="mt-1 font-mono text-[10px] text-nl-muted">without you {ghost}</div> : null}
    </div>
  )
}

export function HUD({ snap }: { snap: GameSnapshot }) {
  const { metrics, baseline, week, farm } = snap
  const slaOk = metrics.slaMet
  return (
    <header className="border-b border-nl-border bg-nl-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden>
            <rect width="32" height="32" rx="8" fill="#0A090E" />
            <path
              d="M8 22V10l8 12 8-12v12"
              stroke="#9C7CFF"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />
          </svg>
          <div>
            <div className="text-[15px] font-medium tracking-tight">nativelink</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-nl-muted">
              Build farm
            </div>
          </div>
        </div>

        <div className="flex min-w-[220px] flex-1 flex-col gap-1">
          <div className="flex items-center justify-between font-mono text-[11px] text-nl-muted">
            <span>
              {week.day} {week.clock}
            </span>
            <span>Fri 17:00</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-nl-elevated">
            <div
              className={`h-full rounded-full transition-[width] duration-300 ease-nl ${
                week.friday ? 'bg-nl-danger' : slaOk ? 'bg-nl-success' : 'bg-nl-brand'
              }`}
              style={{ width: `${Math.max(2, week.progress * 100)}%` }}
            />
          </div>
        </div>

        <div className="font-mono text-[11px] text-nl-muted">
          {farm.mode === 'local' ? 'local only' : farm.mode === 'cache' ? 'cache' : 'cache + RE'}
          <span className="mx-2 text-nl-border-strong">·</span>
          {farm.toolchain}
        </div>
      </div>

      <div className="grid grid-cols-3 border-t border-nl-border md:grid-cols-6">
        <Cell
          label="p95 wait"
          value={fmtSec(metrics.p95Dev)}
          ghost={fmtSec(baseline.p95Dev)}
          warn={metrics.p95Dev !== null && metrics.p95Dev > metrics.slaDev}
          ok={metrics.p95Dev !== null && metrics.p95Dev <= metrics.slaDev}
        />
        <Cell
          label="CI wall"
          value={fmtSec(metrics.ciWall)}
          ghost={fmtSec(baseline.ciWall)}
          warn={metrics.ciWall !== null && metrics.ciWall > metrics.slaCi}
          ok={metrics.ciWall !== null && metrics.ciWall <= metrics.slaCi}
        />
        <Cell label="hit rate" value={fmtPct(metrics.hitRate)} ghost="0%" ok={metrics.hitRate > 0.4} />
        <Cell
          label="queue"
          value={String(metrics.queueDepth)}
          warn={snap.hang || metrics.queueDepth > 6}
        />
        <Cell label="wasted CPU" value={fmtMin(metrics.wastedCpuMinutes)} ghost="Mon ×5" />
        <Cell
          label="SLA"
          value={slaOk ? 'held' : `p95≤${metrics.slaDev}s`}
          ghost={`CI≤${metrics.slaCi}s`}
          ok={slaOk}
        />
      </div>
    </header>
  )
}

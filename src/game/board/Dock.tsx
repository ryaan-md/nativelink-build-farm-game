import { useGame } from '../store.ts'
import type { GameSnapshot } from '../session.ts'

export function Dock({ snap }: { snap: GameSnapshot }) {
  const enableCache = useGame((s) => s.enableCache)
  const enableRe = useGame((s) => s.enableRe)
  const addWorker = useGame((s) => s.addWorker)
  const setKeepTinyLocal = useGame((s) => s.setKeepTinyLocal)
  const setActionPlatform = useGame((s) => s.setActionPlatform)
  const setSpeed = useGame((s) => s.setSpeed)

  return (
    <footer className="grid gap-3 border-t border-nl-border bg-nl-surface px-4 py-3 lg:grid-cols-[1fr_1fr_1.1fr]">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-nl-muted">Upgrades</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={snap.upgrades.cache !== 'ready'}
            onClick={enableCache}
            className={btnClass(snap.upgrades.cache)}
          >
            {snap.upgrades.cache === 'on' ? 'Cache on' : 'Shared action cache'}
          </button>
          <button
            type="button"
            disabled={snap.upgrades.re !== 'ready'}
            onClick={enableRe}
            className={btnClass(snap.upgrades.re)}
          >
            {snap.upgrades.re === 'on' ? 'RE on' : 'Remote execution'}
          </button>
          <button
            type="button"
            disabled={snap.upgrades.capacity === 'locked' || snap.farm.workerCount >= 8}
            onClick={addWorker}
            className={btnClass(snap.upgrades.capacity === 'locked' ? 'locked' : 'ready')}
          >
            Add worker ({snap.farm.workerCount})
          </button>
        </div>
        <label className="mt-3 flex items-center gap-2 font-mono text-[11px] text-nl-muted">
          <input
            type="checkbox"
            disabled={snap.farm.mode !== 'cache+re'}
            checked={snap.farm.keepTinyLocal}
            onChange={(event) => setKeepTinyLocal(event.target.checked)}
          />
          Keep 200ms actions local
        </label>
      </div>

      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-nl-muted">Incident</div>
        {snap.incident ? (
          <div className="mt-2">
            <div className="text-sm text-nl-fg">{snap.incident.title}</div>
            <p className="mt-1 max-w-prose text-[13px] leading-5 text-nl-muted-fg">{snap.incident.body}</p>
          </div>
        ) : (
          <p className="mt-2 font-mono text-[11px] text-nl-muted">No open incident.</p>
        )}
        {snap.hang ? (
          <button
            type="button"
            className="mt-2 rounded-md border border-nl-danger/50 px-2 py-1 font-mono text-[11px] text-nl-danger"
            onClick={() => setActionPlatform('linux')}
          >
            Reset actions to OSFamily=linux
          </button>
        ) : snap.farm.mode === 'cache+re' ? (
          <label className="mt-2 flex items-center gap-2 font-mono text-[11px] text-nl-muted">
            Action OSFamily
            <select
              className="rounded border border-nl-border bg-nl-elevated px-1 py-0.5 text-nl-fg"
              value={snap.farm.actionPlatform.OSFamily}
              onChange={(event) => setActionPlatform(event.target.value === 'macos' ? 'macos' : 'linux')}
            >
              <option value="linux">linux</option>
              <option value="macos">macos</option>
            </select>
          </label>
        ) : null}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-nl-muted">Coach</div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setSpeed(1)}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                snap.speed === 1 ? 'bg-nl-brand-soft text-nl-brand' : 'text-nl-muted'
              }`}
            >
              1×
            </button>
            <button
              type="button"
              onClick={() => setSpeed(2)}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                snap.speed === 2 ? 'bg-nl-brand-soft text-nl-brand' : 'text-nl-muted'
              }`}
            >
              2×
            </button>
          </div>
        </div>
        <p className="mt-2 min-h-[3.2em] text-[13px] leading-5 text-nl-fg">
          {snap.coach?.text ??
            (snap.farm.mode === 'local'
              ? 'The board is the protocol. Decisions are yours; assignment is not.'
              : 'A cache hit never reaches the scheduler.')}
        </p>
        {snap.outcome === 'won' ? (
          <p className="mt-2 font-mono text-[11px] text-nl-success">SLA held. The ghost column is the VP argument.</p>
        ) : null}
        {snap.outcome === 'lost' ? (
          <p className="mt-2 font-mono text-[11px] text-nl-danger">Friday 17:00. The window closed.</p>
        ) : null}
      </div>
    </footer>
  )
}

function btnClass(state: 'locked' | 'ready' | 'on'): string {
  if (state === 'on') {
    return 'rounded-md border border-nl-success/40 bg-nl-success-soft px-2.5 py-1.5 font-mono text-[11px] text-nl-success'
  }
  if (state === 'ready') {
    return 'rounded-md bg-nl-brand px-2.5 py-1.5 font-mono text-[11px] text-nl-brand-fg hover:bg-nl-brand-strong'
  }
  return 'rounded-md border border-nl-border px-2.5 py-1.5 font-mono text-[11px] text-nl-muted disabled:opacity-40'
}

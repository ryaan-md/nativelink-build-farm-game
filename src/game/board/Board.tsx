import type { ReactNode } from 'react'
import { hex8 } from '../format.ts'
import type { FarmSnapshot } from '../engine/index.ts'

function Panel({
  title,
  meta,
  children,
  alert,
}: {
  title: string
  meta?: string
  children: ReactNode
  alert?: boolean
}) {
  return (
    <section
      className={`flex min-h-[220px] flex-col border-b border-nl-border bg-nl-surface lg:border-b-0 lg:border-r lg:last:border-r-0 ${
        alert ? 'ring-1 ring-inset ring-nl-danger/70' : ''
      }`}
    >
      <div className="flex items-center justify-between border-b border-nl-border px-3 py-2">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-nl-muted">{title}</h2>
        {meta ? <div className="font-mono text-[10px] text-nl-muted-fg">{meta}</div> : null}
      </div>
      <div className="flex-1 px-3 py-2">{children}</div>
    </section>
  )
}

export function Board({ farm, hang }: { farm: FarmSnapshot; hang: boolean }) {
  return (
    <div className="grid grid-cols-2 overflow-hidden border-b border-nl-border md:grid-cols-5">
      <Clients farm={farm} />
      <ActionCache farm={farm} />
      <CAS farm={farm} />
      <Scheduler farm={farm} hang={hang} />
      <Workers farm={farm} />
    </div>
  )
}

function Clients({ farm }: { farm: FarmSnapshot }) {
  return (
    <Panel title="Clients" meta={`${farm.clients.filter((c) => c.buildId).length} building`}>
      <ul className="space-y-2">
        {farm.clients.map((client) => (
          <li key={client.id} className="flex items-start gap-2">
            <span
              className={`mt-1 size-1.5 shrink-0 rounded-full ${
                client.buildId ? 'bg-nl-brand' : 'bg-nl-border-strong'
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm">{client.name}</span>
                <span className="font-mono text-[10px] text-nl-muted">
                  {client.kind === 'ci' ? `${client.cores} cores` : `${client.cores}c`}
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-nl-elevated">
                <div
                  className="h-full bg-nl-brand transition-[width] duration-200 ease-nl"
                  style={{ width: `${client.buildProgress * 100}%` }}
                />
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-nl-muted">{client.status}</div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function ActionCache({ farm }: { farm: FarmSnapshot }) {
  return (
    <Panel title="Action cache" meta={`${farm.ac.size} entries`}>
      <div className="mb-2 font-mono text-[11px] text-nl-muted">
        digest → ActionResult
        <div>
          {farm.ac.hits} hit · {farm.ac.misses} miss
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {farm.ac.keys.length === 0 ? (
          <span className="font-mono text-[11px] text-nl-muted">empty</span>
        ) : (
          farm.ac.keys.map((key) => {
            const flash = farm.ac.recent.find((item) => item.digest === key)
            return (
              <span
                key={key}
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                  flash?.kind === 'hit'
                    ? 'bg-nl-success-soft text-nl-success'
                    : flash?.kind === 'write'
                      ? 'bg-nl-brand-soft text-nl-brand'
                      : 'bg-nl-elevated text-nl-muted-fg'
                }`}
              >
                {hex8(key)}
              </span>
            )
          })
        )}
      </div>
    </Panel>
  )
}

function CAS({ farm }: { farm: FarmSnapshot }) {
  return (
    <Panel title="CAS" meta={`${farm.cas.blobs} blobs`}>
      <div className="font-mono text-[11px] text-nl-muted">
        content-addressed blobs
        <div>
          +{farm.cas.clientUploads} client · +{farm.cas.workerUploads} worker
        </div>
        <div>{farm.cas.skippedExisting} already present</div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {farm.cas.recent.slice(-10).map((flash) => (
          <span key={flash.id} className="rounded bg-nl-elevated px-1.5 py-0.5 font-mono text-[10px] text-nl-fg">
            {hex8(flash.digest)}
          </span>
        ))}
      </div>
    </Panel>
  )
}

function Scheduler({ farm, hang }: { farm: FarmSnapshot; hang: boolean }) {
  return (
    <Panel
      title="Scheduler"
      meta={farm.scheduler.idle ? 'idle' : `${farm.scheduler.depth} queued`}
      alert={hang}
    >
      <div className="mb-2 font-mono text-[11px] text-nl-muted">
        priority FIFO · in-flight merge
        <div>
          {farm.scheduler.merges} merged · {farm.scheduler.enqueuedTotal} enqueued
        </div>
        {hang ? <div className="mt-1 text-nl-danger">no matching worker</div> : null}
      </div>
      {farm.scheduler.queue.length === 0 ? (
        <div className="font-mono text-[11px] text-nl-muted">
          {farm.mode === 'cache+re' ? 'nothing to assign' : 'hits never reach here'}
        </div>
      ) : (
        <ul className="space-y-1">
          {farm.scheduler.queue.slice(0, 7).map((item) => (
            <li
              key={`${item.digest}-${item.enqueuedTick}`}
              className="flex items-center justify-between gap-2 font-mono text-[10px]"
            >
              <span className={item.matched ? 'text-nl-brand' : hang ? 'text-nl-danger' : 'text-nl-fg'}>
                {item.actionId}
              </span>
              <span className="text-nl-muted">
                {item.waiters.length === 1 ? '1 waiter' : `${item.waiters.length} waiters`}
                {` ${item.platform.OSFamily}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function Workers({ farm }: { farm: FarmSnapshot }) {
  return (
    <Panel title="Workers" meta={`${farm.workers.filter((w) => w.busy).length}/${farm.workerCount} busy`}>
      {farm.mode !== 'cache+re' ? (
        <div className="font-mono text-[11px] text-nl-muted">No remote execution. Misses stay on the client.</div>
      ) : farm.workers.length === 0 ? (
        <div className="font-mono text-[11px] text-nl-muted">No workers advertised.</div>
      ) : (
        <ul className="space-y-2">
          {farm.workers.map((worker) => (
            <li key={worker.id}>
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span>{worker.id}</span>
                <span className="text-nl-muted">{worker.platform.OSFamily}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-nl-elevated">
                <div
                  className="h-full bg-nl-success transition-[width] duration-150 ease-nl"
                  style={{ width: `${worker.progress * 100}%` }}
                />
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-nl-muted">
                {worker.busy
                  ? `${worker.phase} ${worker.actionId ?? ''} ${
                      worker.waiters.length > 1 ? `· ${worker.waiters.length} waiters` : ''
                    }`
                  : 'idle'}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

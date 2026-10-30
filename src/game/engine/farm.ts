import { digestOf } from './hash.ts'
import {
  ACTION_BY_ID,
  ACTIONS,
  CLIENTS,
  DEFAULT_FILES,
  actionDigest,
  inputBlobDigests,
  outputDigestFor,
  stdoutDigestFor,
  TICK_SECONDS,
} from './graph.ts'
import type {
  ActionResult,
  ActionRuntime,
  BuildRecord,
  ClientView,
  FarmOptions,
  FarmSnapshot,
  Flash,
  GraphNodeView,
  Mode,
  OsFamily,
  Platform,
  QueueItemView,
  WorkerView,
  WriteSource,
} from './types.ts'

const HIT_TICKS = 1
const FIND_MISSING_TICKS = 1
const MATERIALIZE_TICKS = 2
const UPLOAD_OUTPUT_TICKS = 2
const WRITE_AC_TICKS = 1
const FLASH_TTL = 24

interface Build {
  id: string
  clientId: string
  startedTick: number
  finishedTick: number | null
  actions: Map<string, ActionRuntime>
  pendingUploads: Map<string, string[]>
}

interface Waiter {
  clientId: string
  buildId: string
}

interface QueueItem {
  digest: string
  actionId: string
  waiters: Waiter[]
  platform: Platform
  enqueuedTick: number
  workerId: string | null
}

interface LocalRun {
  clientId: string
  buildId: string
  actionId: string
  digest: string
  remaining: number
  total: number
  started: boolean
}

interface WorkerState {
  id: string
  platform: Platform
  item: QueueItem | null
  phase: WorkerView['phase']
  remaining: number
  phaseTotal: number
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[idx] ?? 0
}

function emptyAction(actionId: string): ActionRuntime {
  return {
    actionId,
    digest: '',
    status: 'blocked',
    remainingTicks: 0,
    totalTicks: 0,
    hit: false,
    merged: false,
    waiterCount: 1,
    missingUploads: 0,
    outputDigest: null,
  }
}

export function computeP95(values: number[]): number {
  return percentile(values, 0.95)
}

export class Farm {
  tickCount = 0
  mode: Mode
  toolchain: string
  actionPlatform: Platform
  workerPlatform: Platform
  keepTinyLocal: boolean
  desiredWorkers: number

  files: Record<string, string>
  dirtyActions = new Set<string>()

  ac = new Map<string, ActionResult>()
  cas = new Set<string>()
  queue: QueueItem[] = []
  workers: WorkerState[] = []
  builds = new Map<string, Build>()
  finished: BuildRecord[] = []
  pendingByClient = new Map<string, number>()

  acHits = 0
  acMisses = 0
  acWrites = 0
  workerWrites = 0
  clientWrites = 0
  casUploads = 0
  casClientUploads = 0
  casWorkerUploads = 0
  casSkipped = 0
  schedulerEnqueued = 0
  schedulerMerges = 0
  wastedTicks = 0
  executionsByDigest = new Map<string, number>()
  flashes: Flash[] = []
  flashSeq = 0
  buildSeq = 0

  constructor(opts: FarmOptions = {}) {
    this.mode = opts.mode ?? 'local'
    this.toolchain = opts.toolchain ?? 'clang-18'
    this.actionPlatform = { OSFamily: opts.actionPlatform ?? 'linux' }
    this.workerPlatform = { OSFamily: opts.workerPlatform ?? 'linux' }
    this.keepTinyLocal = opts.keepTinyLocal ?? false
    this.desiredWorkers = opts.workerCount ?? 2
    this.files = { ...DEFAULT_FILES, ...(opts.files ?? {}) }
    if (this.mode === 'cache+re') this.ensureWorkers()
  }

  hasWork(): boolean {
    if (this.queue.length > 0) return true
    if (this.workers.some((worker) => worker.item !== null)) return true
    for (const build of this.builds.values()) {
      if (build.finishedTick === null) return true
    }
    return false
  }

  submitBuild(clientId: string): string | null {
    const existing = this.activeBuild(clientId)
    if (existing) {
      this.pendingByClient.set(clientId, (this.pendingByClient.get(clientId) ?? 0) + 1)
      return null
    }
    this.buildSeq += 1
    const id = `b${this.buildSeq}`
    const actions = new Map<string, ActionRuntime>()
    for (const action of ACTIONS) {
      actions.set(action.id, emptyAction(action.id))
    }
    this.builds.set(id, {
      id,
      clientId,
      startedTick: this.tickCount,
      finishedTick: null,
      actions,
      pendingUploads: new Map(),
    })
    return id
  }

  setMode(mode: Mode): void {
    this.mode = mode
    if (mode === 'cache+re') this.ensureWorkers()
  }

  addWorker(): void {
    this.desiredWorkers += 1
    this.ensureWorkers()
  }

  setKeepTinyLocal(value: boolean): void {
    this.keepTinyLocal = value
  }

  setActionPlatform(os: OsFamily): void {
    this.actionPlatform = { OSFamily: os }
    this.markAllDirty()
    for (const item of this.queue) {
      if (item.workerId === null) item.platform = { OSFamily: os }
    }
  }

  setWorkerPlatform(os: OsFamily): void {
    this.workerPlatform = { OSFamily: os }
    for (const worker of this.workers) worker.platform = { OSFamily: os }
  }

  setFile(name: string, content: string): void {
    this.files[name] = content
    this.markDirtyFromFiles(new Set([name]))
  }

  bumpToolchain(next: string): void {
    this.toolchain = next
    this.markAllDirty()
  }

  tick(): void {
    this.tickCount += 1
    this.expireFlashes()
    this.unblockAndStart()
    this.advanceHitsAndUploads()
    this.advanceLocal()
    this.assignWorkers()
    this.advanceWorkers()
    this.finishBuilds()
  }

  snapshot(): FarmSnapshot {
    const clients = CLIENTS.map((client) => this.clientView(client.id))
    const graph = this.graphView()
    const keys = [...this.ac.keys()]
    const hitRate =
      this.acHits + this.acMisses === 0 ? 0 : this.acHits / (this.acHits + this.acMisses)
    const queue = this.queue.map((item) => this.queueView(item))
    const executions: Record<string, number> = {}
    for (const [digest, count] of this.executionsByDigest) executions[digest] = count

    return {
      tick: this.tickCount,
      mode: this.mode,
      toolchain: this.toolchain,
      actionPlatform: this.actionPlatform,
      workerPlatform: this.workerPlatform,
      keepTinyLocal: this.keepTinyLocal,
      workerCount: this.workers.length,
      clients,
      graph,
      ac: {
        size: this.ac.size,
        hits: this.acHits,
        misses: this.acMisses,
        writes: this.acWrites,
        workerWrites: this.workerWrites,
        clientWrites: this.clientWrites,
        hitRate,
        recent: this.flashes.filter((flash) => flash.kind === 'hit' || flash.kind === 'write'),
        keys: keys.slice(-16),
      },
      cas: {
        blobs: this.cas.size,
        uploads: this.casUploads,
        skippedExisting: this.casSkipped,
        clientUploads: this.casClientUploads,
        workerUploads: this.casWorkerUploads,
        recent: this.flashes.filter((flash) => flash.kind === 'upload'),
      },
      scheduler: {
        queue,
        depth: this.queue.filter((item) => item.workerId === null).length,
        inFlight: this.workers.filter((worker) => worker.item !== null).length,
        merges: this.schedulerMerges,
        enqueuedTotal: this.schedulerEnqueued,
        idle: this.queue.length === 0 && this.workers.every((worker) => worker.item === null),
      },
      workers: this.workers.map((worker) => this.workerView(worker)),
      builds: this.records(),
      wastedCpuSeconds: this.wastedTicks * TICK_SECONDS,
      executionsByDigest: executions,
      hasWork: this.hasWork(),
    }
  }

  private ensureWorkers(): void {
    while (this.workers.length < this.desiredWorkers) {
      const n = this.workers.length + 1
      this.workers.push({
        id: `w${n}`,
        platform: { ...this.workerPlatform },
        item: null,
        phase: 'idle',
        remaining: 0,
        phaseTotal: 0,
      })
    }
  }

  private activeBuild(clientId: string): Build | null {
    for (const build of this.builds.values()) {
      if (build.clientId === clientId && build.finishedTick === null) return build
    }
    return null
  }

  private markAllDirty(): void {
    for (const action of ACTIONS) this.dirtyActions.add(action.id)
  }

  private markDirtyFromFiles(files: Set<string>): void {
    for (const action of ACTIONS) {
      if (action.inputFiles.some((name) => files.has(name))) this.dirtyActions.add(action.id)
    }
    let grew = true
    while (grew) {
      grew = false
      for (const action of ACTIONS) {
        if (this.dirtyActions.has(action.id)) continue
        if (action.deps.some((id) => this.dirtyActions.has(id))) {
          this.dirtyActions.add(action.id)
          grew = true
        }
      }
    }
  }

  private depOutputs(build: Build): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [id, runtime] of build.actions) {
      if (runtime.outputDigest) out[id] = runtime.outputDigest
    }
    return out
  }

  private digestFor(build: Build, actionId: string): string {
    const action = ACTION_BY_ID[actionId]
    if (!action) return digestOf('missing', actionId)
    return actionDigest({
      action,
      files: this.files,
      depOutputs: this.depOutputs(build),
      toolchain: this.toolchain,
      osFamily: this.actionPlatform.OSFamily,
    })
  }

  private unblockAndStart(): void {
    for (const build of this.builds.values()) {
      if (build.finishedTick !== null) continue
      for (const action of ACTIONS) {
        const runtime = build.actions.get(action.id)
        if (!runtime || runtime.status !== 'blocked') continue
        const ready = action.deps.every((id) => {
          const dep = build.actions.get(id)
          return dep?.status === 'done'
        })
        if (!ready) continue
        this.startAction(build, runtime)
      }
    }
  }

  private startAction(build: Build, runtime: ActionRuntime): void {
    const action = ACTION_BY_ID[runtime.actionId]
    if (!action) return
    const digest = this.digestFor(build, runtime.actionId)
    runtime.digest = digest
    runtime.totalTicks = action.durationTicks

    if (this.mode !== 'local') {
      const cached = this.ac.get(digest)
      if (cached) {
        this.acHits += 1
        runtime.status = 'hit'
        runtime.hit = true
        runtime.remainingTicks = HIT_TICKS
        runtime.totalTicks = HIT_TICKS
        runtime.outputDigest = cached.outputDigest
        this.flash('hit', digest)
        return
      }
      this.acMisses += 1
      this.flash('miss', digest)
    }

    const runLocal =
      this.mode === 'local' ||
      this.mode === 'cache' ||
      (this.mode === 'cache+re' && this.keepTinyLocal && action.tiny)

    if (runLocal) {
      this.enqueueLocal(build, runtime)
      return
    }

    runtime.status = 'finding_blobs'
    runtime.remainingTicks = FIND_MISSING_TICKS
  }

  private enqueueLocal(build: Build, runtime: ActionRuntime): void {
    const action = ACTION_BY_ID[runtime.actionId]
    if (!action) return
    this.noteExecution(runtime.digest, action.durationTicks)
    runtime.status = 'local_queued'
    runtime.remainingTicks = action.durationTicks
    runtime.totalTicks = action.durationTicks
    const run: LocalRun = {
      clientId: build.clientId,
      buildId: build.id,
      actionId: runtime.actionId,
      digest: runtime.digest,
      remaining: action.durationTicks,
      total: action.durationTicks,
      started: false,
    }
    this.localRuns.push(run)
  }

  localRuns: LocalRun[] = []

  private advanceHitsAndUploads(): void {
    for (const build of this.builds.values()) {
      if (build.finishedTick !== null) continue
      for (const runtime of build.actions.values()) {
        if (runtime.status === 'hit') {
          runtime.remainingTicks -= 1
          if (runtime.remainingTicks <= 0) runtime.status = 'done'
          continue
        }
        if (runtime.status === 'finding_blobs') {
          runtime.remainingTicks -= 1
          if (runtime.remainingTicks > 0) continue
          this.afterFindMissing(build, runtime)
          continue
        }
        if (runtime.status === 'uploading') {
          runtime.remainingTicks -= 1
          if (runtime.remainingTicks > 0) continue
          const blobs = build.pendingUploads.get(runtime.actionId) ?? []
          for (const blob of blobs) this.addCas(blob, 'client')
          build.pendingUploads.delete(runtime.actionId)
          this.executeRemote(build, runtime)
        }
      }
    }
  }

  private afterFindMissing(build: Build, runtime: ActionRuntime): void {
    const action = ACTION_BY_ID[runtime.actionId]
    if (!action) return
    const blobs = inputBlobDigests({
      action,
      files: this.files,
      depOutputs: this.depOutputs(build),
    })
    const missing = blobs.filter((blob) => !this.cas.has(blob))
    this.casSkipped += blobs.length - missing.length
    runtime.missingUploads = missing.length
    if (missing.length === 0) {
      this.executeRemote(build, runtime)
      return
    }
    runtime.status = 'uploading'
    runtime.remainingTicks = missing.length
    runtime.totalTicks = missing.length
    build.pendingUploads.set(runtime.actionId, missing)
  }

  private executeRemote(build: Build, runtime: ActionRuntime): void {
    const existing =
      this.queue.find((item) => item.digest === runtime.digest) ??
      this.workers.find((worker) => worker.item?.digest === runtime.digest)?.item
    if (existing) {
      existing.waiters.push({ clientId: build.clientId, buildId: build.id })
      this.schedulerMerges += 1
      runtime.status = 'scheduled'
      runtime.merged = true
      runtime.waiterCount = existing.waiters.length
      for (const waiter of existing.waiters) {
        const other = this.builds.get(waiter.buildId)?.actions.get(runtime.actionId)
        if (other) other.waiterCount = existing.waiters.length
      }
      this.flash('merge', runtime.digest)
      return
    }
    this.schedulerEnqueued += 1
    this.queue.push({
      digest: runtime.digest,
      actionId: runtime.actionId,
      waiters: [{ clientId: build.clientId, buildId: build.id }],
      platform: { ...this.actionPlatform },
      enqueuedTick: this.tickCount,
      workerId: null,
    })
    runtime.status = 'scheduled'
  }

  private advanceLocal(): void {
    const busy = new Map<string, number>()
    for (const run of this.localRuns) {
      if (run.started) busy.set(run.clientId, (busy.get(run.clientId) ?? 0) + 1)
    }

    for (const run of this.localRuns) {
      if (run.started) continue
      const client = CLIENTS.find((item) => item.id === run.clientId)
      const used = busy.get(run.clientId) ?? 0
      if (used >= (client?.cores ?? 1)) continue
      const runtime = this.builds.get(run.buildId)?.actions.get(run.actionId)
      if (runtime) runtime.status = 'local_running'
      run.started = true
      busy.set(run.clientId, used + 1)
    }

    const still: LocalRun[] = []
    for (const run of this.localRuns) {
      if (!run.started) {
        still.push(run)
        continue
      }
      run.remaining -= 1
      const runtime = this.builds.get(run.buildId)?.actions.get(run.actionId)
      if (runtime) runtime.remainingTicks = run.remaining
      if (run.remaining > 0) {
        still.push(run)
        continue
      }
      this.completeExecution(
        run.buildId,
        run.actionId,
        run.digest,
        this.mode === 'local' ? null : 'client',
      )
    }
    this.localRuns = still
  }

  private assignWorkers(): void {
    if (this.mode !== 'cache+re') return
    const idle = this.workers.filter((worker) => worker.item === null)
    for (const item of this.queue) {
      if (item.workerId !== null) continue
      const idx = idle.findIndex((worker) => this.satisfies(worker.platform, item.platform))
      if (idx === -1) continue
      const worker = idle.splice(idx, 1)[0]
      if (!worker) continue
      item.workerId = worker.id
      worker.item = item
      worker.phase = 'materialize'
      worker.remaining = MATERIALIZE_TICKS
      worker.phaseTotal = MATERIALIZE_TICKS
      const action = ACTION_BY_ID[item.actionId]
      this.noteExecution(item.digest, action?.durationTicks ?? 0)
      for (const waiter of item.waiters) {
        const runtime = this.builds.get(waiter.buildId)?.actions.get(item.actionId)
        if (runtime) runtime.status = 'running_remote'
      }
    }
  }

  private satisfies(worker: Platform, required: Platform): boolean {
    return worker.OSFamily === required.OSFamily
  }

  private advanceWorkers(): void {
    for (const worker of this.workers) {
      if (!worker.item) continue
      worker.remaining -= 1
      if (worker.remaining > 0) continue
      const item = worker.item
      const action = ACTION_BY_ID[item.actionId]
      if (worker.phase === 'materialize') {
        worker.phase = 'run'
        worker.remaining = action?.durationTicks ?? 1
        worker.phaseTotal = worker.remaining
        continue
      }
      if (worker.phase === 'run') {
        worker.phase = 'upload'
        worker.remaining = UPLOAD_OUTPUT_TICKS
        worker.phaseTotal = UPLOAD_OUTPUT_TICKS
        continue
      }
      if (worker.phase === 'upload') {
        const result = this.makeResult(item.digest, item.actionId, 'worker')
        this.addCas(result.outputDigest, 'worker')
        this.addCas(result.stdoutDigest, 'worker')
        worker.phase = 'write_ac'
        worker.remaining = WRITE_AC_TICKS
        worker.phaseTotal = WRITE_AC_TICKS
        worker.item = { ...item }
        ;(worker as WorkerState & { result?: ActionResult }).result = result
        continue
      }
      if (worker.phase === 'write_ac') {
        const result =
          (worker as WorkerState & { result?: ActionResult }).result ??
          this.makeResult(item.digest, item.actionId, 'worker')
        this.writeAc(result, 'worker')
        this.completeWaiters(item, result)
        this.queue = this.queue.filter((queued) => queued !== item && queued.digest !== item.digest)
        worker.item = null
        worker.phase = 'idle'
        worker.remaining = 0
        worker.phaseTotal = 0
        delete (worker as WorkerState & { result?: ActionResult }).result
      }
    }
  }

  private completeWaiters(item: QueueItem, result: ActionResult): void {
    for (const waiter of item.waiters) {
      const build = this.builds.get(waiter.buildId)
      const runtime = build?.actions.get(item.actionId)
      if (!runtime) continue
      runtime.status = 'done'
      runtime.outputDigest = result.outputDigest
      runtime.remainingTicks = 0
      runtime.merged = item.waiters.length > 1
      runtime.waiterCount = item.waiters.length
    }
  }

  private completeExecution(
    buildId: string,
    actionId: string,
    digest: string,
    write: WriteSource | null,
  ): void {
    const build = this.builds.get(buildId)
    const runtime = build?.actions.get(actionId)
    if (!runtime) return
    const result = this.makeResult(digest, actionId, write ?? 'client')
    if (write) {
      this.addCas(result.outputDigest, write === 'worker' ? 'worker' : 'client')
      this.addCas(result.stdoutDigest, write === 'worker' ? 'worker' : 'client')
      this.writeAc(result, write)
    }
    runtime.status = 'done'
    runtime.outputDigest = result.outputDigest
    runtime.remainingTicks = 0
  }

  private makeResult(digest: string, actionId: string, writtenBy: WriteSource): ActionResult {
    const action = ACTION_BY_ID[actionId]
    return {
      actionDigest: digest,
      outputDigest: outputDigestFor(digest, action?.output ?? actionId),
      stdoutDigest: stdoutDigestFor(digest),
      writtenBy,
    }
  }

  private writeAc(result: ActionResult, source: WriteSource): void {
    if (this.ac.has(result.actionDigest)) return
    this.ac.set(result.actionDigest, result)
    this.acWrites += 1
    if (source === 'worker') this.workerWrites += 1
    else this.clientWrites += 1
    this.flash('write', result.actionDigest)
  }

  private addCas(blob: string, source: 'client' | 'worker'): void {
    if (this.cas.has(blob)) {
      this.casSkipped += 1
      return
    }
    this.cas.add(blob)
    this.casUploads += 1
    if (source === 'worker') this.casWorkerUploads += 1
    else this.casClientUploads += 1
    this.flash('upload', blob)
  }

  private noteExecution(digest: string, duration: number): void {
    const prev = this.executionsByDigest.get(digest) ?? 0
    this.executionsByDigest.set(digest, prev + 1)
    if (prev > 0) this.wastedTicks += duration
  }

  private finishBuilds(): void {
    const restart: string[] = []
    for (const build of this.builds.values()) {
      if (build.finishedTick !== null) continue
      let allDone = true
      for (const runtime of build.actions.values()) {
        if (runtime.status !== 'done') {
          allDone = false
          break
        }
      }
      if (!allDone) continue
      build.finishedTick = this.tickCount
      const hits = [...build.actions.values()].filter((item) => item.hit).length
      const merged = [...build.actions.values()].filter((item) => item.merged).length
      this.finished.push({
        id: build.id,
        clientId: build.clientId,
        startedTick: build.startedTick,
        finishedTick: this.tickCount,
        durationSeconds: (this.tickCount - build.startedTick) * TICK_SECONDS,
        hits,
        misses: ACTIONS.length - hits,
        merged,
      })
      restart.push(build.clientId)
    }
    for (const clientId of restart) {
      const pending = this.pendingByClient.get(clientId) ?? 0
      if (pending > 0) {
        this.pendingByClient.set(clientId, pending - 1)
        this.submitBuild(clientId)
      }
    }
  }

  private records(): BuildRecord[] {
    const live: BuildRecord[] = []
    for (const build of this.builds.values()) {
      if (build.finishedTick !== null) continue
      const hits = [...build.actions.values()].filter((item) => item.hit).length
      const merged = [...build.actions.values()].filter((item) => item.merged).length
      live.push({
        id: build.id,
        clientId: build.clientId,
        startedTick: build.startedTick,
        finishedTick: null,
        durationSeconds: null,
        hits,
        misses: [...build.actions.values()].filter((item) => item.status !== 'hit' && item.status !== 'blocked' && item.status !== 'done').length,
        merged,
      })
    }
    return [...this.finished, ...live]
  }

  private clientView(clientId: string): ClientView {
    const def = CLIENTS.find((item) => item.id === clientId)
    const build = this.activeBuild(clientId)
    let done = 0
    let status = 'idle'
    let focus = ''
    if (build) {
      const runtimes = [...build.actions.values()]
      done = runtimes.filter((item) => item.status === 'done' || item.status === 'hit').length
      const active = runtimes.find(
        (item) => item.status !== 'done' && item.status !== 'blocked' && item.status !== 'ready',
      )
      if (active) {
        const label = ACTION_BY_ID[active.actionId]?.label ?? active.actionId
        focus = `${label} ${active.status.replace('_', ' ')}`
      }
      status = `${done}/${ACTIONS.length}`
      if (focus) status = `${status} · ${focus}`
    }
    const last = [...this.finished].reverse().find((item) => item.clientId === clientId)
    const busyCores = this.localRuns.filter(
      (run) => run.clientId === clientId && run.remaining < run.total,
    ).length
    return {
      id: clientId,
      name: def?.name ?? clientId,
      kind: def?.kind ?? 'dev',
      cores: def?.cores ?? 2,
      busyCores,
      buildId: build?.id ?? null,
      buildProgress: build ? done / ACTIONS.length : 0,
      lastDuration: last?.durationSeconds ?? null,
      status,
    }
  }

  private graphView(): GraphNodeView[] {
    const live = [...this.builds.values()].find((build) => build.finishedTick === null)
    const preview = this.previewDigests()
    return ACTIONS.map((action) => {
      const runtime = live?.actions.get(action.id)
      return {
        id: action.id,
        kind: action.kind,
        label: action.label,
        tiny: action.tiny,
        digest: runtime?.digest || preview[action.id] || '',
        status: runtime?.status ?? 'idle',
        hit: runtime?.hit ?? false,
        changed: this.dirtyActions.has(action.id),
      }
    })
  }

  private previewDigests(): Record<string, string> {
    const depOutputs: Record<string, string> = {}
    const digests: Record<string, string> = {}
    for (const action of ACTIONS) {
      const digest = actionDigest({
        action,
        files: this.files,
        depOutputs,
        toolchain: this.toolchain,
        osFamily: this.actionPlatform.OSFamily,
      })
      digests[action.id] = digest
      depOutputs[action.id] = outputDigestFor(digest, action.output)
    }
    return digests
  }

  private queueView(item: QueueItem): QueueItemView {
    return {
      digest: item.digest,
      actionId: item.actionId,
      waiters: item.waiters.map((waiter) => waiter.clientId),
      platform: item.platform,
      enqueuedTick: item.enqueuedTick,
      assignedWorkerId: item.workerId,
      ageTicks: this.tickCount - item.enqueuedTick,
      matched: item.workerId !== null,
    }
  }

  private workerView(worker: WorkerState): WorkerView {
    const progress =
      worker.phaseTotal === 0 ? 0 : 1 - worker.remaining / worker.phaseTotal
    return {
      id: worker.id,
      platform: worker.platform,
      busy: worker.item !== null,
      actionId: worker.item?.actionId ?? null,
      digest: worker.item?.digest ?? null,
      phase: worker.phase,
      progress: Math.min(1, Math.max(0, progress)),
      waiters: worker.item?.waiters.map((waiter) => waiter.clientId) ?? [],
    }
  }

  private flash(kind: Flash['kind'], digest: string): void {
    this.flashSeq += 1
    this.flashes.push({ id: this.flashSeq, digest, kind, tick: this.tickCount })
  }

  private expireFlashes(): void {
    this.flashes = this.flashes.filter((flash) => this.tickCount - flash.tick < FLASH_TTL)
  }
}

export function createFarm(opts?: FarmOptions): Farm {
  return new Farm(opts)
}

export function measureBaseline(): { p95Dev: number; ciWall: number } {
  const farm = createFarm({ mode: 'local' })
  for (const client of CLIENTS) farm.submitBuild(client.id)
  let guard = 0
  while (farm.hasWork() && guard < 20000) {
    farm.tick()
    guard += 1
  }
  const records = farm.snapshot().builds.filter((build) => build.durationSeconds !== null)
  const dev = records
    .filter((build) => CLIENTS.find((client) => client.id === build.clientId)?.kind === 'dev')
    .map((build) => build.durationSeconds ?? 0)
  const ci = records
    .filter((build) => build.clientId === 'ci')
    .map((build) => build.durationSeconds ?? 0)
  return { p95Dev: computeP95(dev), ciWall: ci[0] ?? 0 }
}

export { percentile }

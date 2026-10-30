export type Mode = 'local' | 'cache' | 'cache+re'
export type OsFamily = 'linux' | 'macos'
export type ActionKind = 'compile' | 'link' | 'test'
export type ClientKind = 'dev' | 'ci'
export type WriteSource = 'client' | 'worker'

export interface Platform {
  OSFamily: OsFamily
}

export interface ActionDef {
  id: string
  kind: ActionKind
  label: string
  command: string
  inputFiles: string[]
  deps: string[]
  output: string
  durationTicks: number
  tiny: boolean
}

export interface ClientDef {
  id: string
  name: string
  kind: ClientKind
  cores: number
}

export interface ActionResult {
  actionDigest: string
  outputDigest: string
  stdoutDigest: string
  writtenBy: WriteSource
}

export type ActionStatus =
  | 'blocked'
  | 'ready'
  | 'hit'
  | 'local_queued'
  | 'local_running'
  | 'finding_blobs'
  | 'uploading'
  | 'scheduled'
  | 'running_remote'
  | 'done'

export interface ActionRuntime {
  actionId: string
  digest: string
  status: ActionStatus
  remainingTicks: number
  totalTicks: number
  hit: boolean
  merged: boolean
  waiterCount: number
  missingUploads: number
  outputDigest: string | null
}

export interface BuildRecord {
  id: string
  clientId: string
  startedTick: number
  finishedTick: number | null
  durationSeconds: number | null
  hits: number
  misses: number
  merged: number
}

export interface QueueItemView {
  digest: string
  actionId: string
  waiters: string[]
  platform: Platform
  enqueuedTick: number
  assignedWorkerId: string | null
  ageTicks: number
  matched: boolean
}

export interface WorkerView {
  id: string
  platform: Platform
  busy: boolean
  actionId: string | null
  digest: string | null
  phase: 'idle' | 'materialize' | 'run' | 'upload' | 'write_ac'
  progress: number
  waiters: string[]
}

export interface ClientView {
  id: string
  name: string
  kind: ClientKind
  cores: number
  busyCores: number
  buildId: string | null
  buildProgress: number
  lastDuration: number | null
  status: string
}

export interface GraphNodeView {
  id: string
  kind: ActionKind
  label: string
  tiny: boolean
  digest: string | null
  status: ActionStatus | 'idle'
  hit: boolean
  changed: boolean
}

export interface Flash {
  id: number
  digest: string
  kind: 'hit' | 'miss' | 'write' | 'upload' | 'merge'
  tick: number
}

export interface FarmSnapshot {
  tick: number
  mode: Mode
  toolchain: string
  actionPlatform: Platform
  workerPlatform: Platform
  keepTinyLocal: boolean
  workerCount: number
  clients: ClientView[]
  graph: GraphNodeView[]
  ac: {
    size: number
    hits: number
    misses: number
    writes: number
    workerWrites: number
    clientWrites: number
    hitRate: number
    recent: Flash[]
    keys: string[]
  }
  cas: {
    blobs: number
    uploads: number
    skippedExisting: number
    clientUploads: number
    workerUploads: number
    recent: Flash[]
  }
  scheduler: {
    queue: QueueItemView[]
    depth: number
    inFlight: number
    merges: number
    enqueuedTotal: number
    idle: boolean
  }
  workers: WorkerView[]
  builds: BuildRecord[]
  wastedCpuSeconds: number
  executionsByDigest: Record<string, number>
  hasWork: boolean
}

export interface FarmOptions {
  mode?: Mode
  workerCount?: number
  actionPlatform?: OsFamily
  workerPlatform?: OsFamily
  keepTinyLocal?: boolean
  toolchain?: string
  files?: Record<string, string>
}

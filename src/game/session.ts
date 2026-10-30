import {
  CLIENTS,
  computeP95,
  createFarm,
  measureBaseline,
  SLA_CI_WALL,
  SLA_DEV_P95,
} from './engine/index.ts'
import type { Farm, FarmSnapshot, OsFamily } from './engine/index.ts'

export type Outcome = 'title' | 'playing' | 'won' | 'lost'
export type UpgradeState = 'locked' | 'ready' | 'on'

export interface Incident {
  id: string
  title: string
  body: string
}

export interface CoachLine {
  id: string
  text: string
}

export interface GameSnapshot {
  farm: FarmSnapshot
  week: { day: string; clock: string; progress: number; friday: boolean }
  outcome: Outcome
  baseline: { p95Dev: number; ciWall: number }
  metrics: {
    p95Dev: number | null
    ciWall: number | null
    hitRate: number
    queueDepth: number
    wastedCpuMinutes: number
    slaDev: number
    slaCi: number
    slaMet: boolean
    samplesDev: number
    samplesCi: number
  }
  upgrades: {
    cache: UpgradeState
    re: UpgradeState
    capacity: UpgradeState
  }
  incident: Incident | null
  coach: CoachLine | null
  speed: 1 | 2
  hang: boolean
}

const TICKS_PER_REAL_SEC = 16
const FRIDAY_TICKS = TICKS_PER_REAL_SEC * 60 * 6
const COACH_TTL = TICKS_PER_REAL_SEC * 9
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const

export class GameSession {
  farm: Farm
  baseline: { p95Dev: number; ciWall: number }
  outcome: Outcome = 'title'
  speed: 1 | 2 = 1
  sessionTick = 0
  cache: UpgradeState = 'locked'
  re: UpgradeState = 'locked'
  capacity: UpgradeState = 'locked'
  incident: Incident | null = null
  coach: CoachLine | null = null
  coachUntil = 0
  seenCoach = new Set<string>()
  mondaySubmitted = false
  mondayDone = false
  cacheFillSubmitted = false
  cacheFillDone = false
  hitStormSubmitted = false
  hitStormDone = false
  onelineDone = false
  onelineFinished = false
  mergeFired = false
  toolchainFired = false
  mismatchFired = false
  releaseFired = false
  seenLocalMissAfterCache = false
  seenRemote = false
  seenMerge = false
  lastPeriodic = 0
  rotate = 0
  cacheOnTick: number | null = null

  constructor() {
    this.baseline = measureBaseline()
    this.farm = createFarm({ mode: 'local', workerCount: 2 })
  }

  snapshot(): GameSnapshot {
    const farm = this.farm.snapshot()
    const metrics = this.metrics(farm)
    return {
      farm,
      week: this.week(),
      outcome: this.outcome,
      baseline: this.baseline,
      metrics,
      upgrades: {
        cache: this.cache,
        re: this.re,
        capacity: this.capacity,
      },
      incident: this.incident,
      coach: this.coach,
      speed: this.speed,
      hang: this.isHang(farm),
    }
  }

  begin(): void {
    if (this.outcome !== 'title') return
    this.outcome = 'playing'
    this.speak('open', 'Four laptops. One CI job. Friday is the constraint.')
    this.incident = {
      id: 'monday',
      title: 'Monday · same commit',
      body: 'Alice, Bob, Carol, Dave, and CI all started the same tree. Without a shared cache that is five compiles of the same source.',
    }
  }

  enableCache(): void {
    if (this.cache !== 'ready') return
    this.farm.setMode('cache')
    this.cache = 'on'
    this.cacheOnTick = this.sessionTick
    this.speak('cache', 'A cache hit never reaches the scheduler.')
    this.incident = {
      id: 'cache-on',
      title: 'Shared action cache',
      body: 'Repeated actions become a download. First-time work still runs on the laptop or the CI agent.',
    }
  }

  enableRe(): void {
    if (this.re !== 'ready') return
    this.farm.setMode('cache+re')
    this.re = 'on'
    this.speak('re', 'Misses leave the machine. Hits still skip the scheduler.')
    this.incident = {
      id: 're-on',
      title: 'Remote execution',
      body: 'The scheduler fans misses across workers. The worker writes the ActionResult. The scheduler only assigned the work.',
    }
  }

  addWorker(): void {
    if (this.capacity === 'locked') return
    if (this.farm.workers.length >= 8) return
    this.farm.addWorker()
    if (this.capacity === 'ready') this.capacity = 'on'
  }

  setKeepTinyLocal(value: boolean): void {
    this.farm.setKeepTinyLocal(value)
    if (value) {
      this.speak('tiny', 'A 200ms action does not get faster remotely. The network is the work.')
    }
  }

  setActionPlatform(os: OsFamily): void {
    this.farm.setActionPlatform(os)
    if (os === 'macos' && this.farm.workerPlatform.OSFamily === 'linux') {
      this.speak(
        'mismatch',
        'No worker advertises OSFamily=macos. The scheduler will not error. The action waits.',
      )
      this.incident = {
        id: 'mismatch',
        title: 'Platform property mismatch',
        body: 'Actions ask for macos. Workers advertise linux. Queue depth grows. Nothing fails.',
      }
      if (this.farm.mode === 'cache+re') this.farm.submitBuild('ci')
    }
  }

  setSpeed(speed: 1 | 2): void {
    this.speed = speed
  }

  step(): void {
    if (this.outcome === 'title') return
    this.sessionTick += 1
    this.farm.tick()
    this.observe()
    this.script()
    this.expireCoach()
    this.evaluate()
  }

  tick(): GameSnapshot {
    this.step()
    return this.snapshot()
  }

  private observe(): void {
    if (this.cache === 'on' && !this.seenLocalMissAfterCache) {
      for (const run of this.farm.localRuns) {
        if (run.started) {
          this.seenLocalMissAfterCache = true
          break
        }
      }
    }
    if (this.farm.workerWrites > 0) this.seenRemote = true
    if (this.farm.schedulerMerges > 0) this.seenMerge = true

    if (!this.mondayDone) {
      if (this.farm.finished.length >= 5) {
        this.mondayDone = true
        if (this.cache === 'locked') this.cache = 'ready'
        this.speak(
          'waste',
          'Five executions of one digest. The waste is not latency. It is duplicated work.',
        )
      }
    }

    if (this.cache === 'on' && this.onelineFinished && this.seenLocalMissAfterCache && this.re === 'locked') {
      this.re = 'ready'
    }
    if (this.re === 'on' && this.seenRemote && this.capacity === 'locked') {
      this.capacity = 'ready'
    }
  }

  private script(): void {
    if (this.outcome === 'lost') return
    if (!this.mondaySubmitted && this.sessionTick >= 12) {
      this.mondaySubmitted = true
      for (const client of CLIENTS) this.farm.submitBuild(client.id)
    }

    if (this.cache === 'on' && this.cacheOnTick !== null && !this.cacheFillSubmitted) {
      if (this.sessionTick >= this.cacheOnTick + 16) {
        this.cacheFillSubmitted = true
        this.incident = {
          id: 'cache-fill',
          title: 'CI writes the cache',
          body: 'Monday never uploaded results. The first cache-mode build still misses, then writes the ActionResult.',
        }
        this.farm.submitBuild('ci')
      }
    }

    if (this.cacheFillSubmitted && !this.cacheFillDone) {
      const ci = this.farm.finished.find(
        (build) => build.clientId === 'ci' && this.cacheOnTick !== null && build.startedTick >= this.cacheOnTick,
      )
      if (ci) this.cacheFillDone = true
    }

    if (this.cacheFillDone && !this.hitStormSubmitted && !this.farm.hasWork()) {
      this.hitStormSubmitted = true
      this.incident = {
        id: 'hits',
        title: 'Same tree, second time',
        body: 'The laptops are building the commit CI just cached. Watch the action cache. The scheduler should stay idle.',
      }
      this.speak('hits', 'A cache hit never reaches the scheduler.')
      for (const id of ['alice', 'bob', 'carol', 'dave'] as const) this.farm.submitBuild(id)
    }

    if (this.hitStormSubmitted && !this.hitStormDone) {
      const post = this.farm.finished.filter((build) => {
        if (this.cacheOnTick === null) return false
        return build.startedTick >= this.cacheOnTick && build.clientId !== 'ci' && build.hits > 0
      })
      if (post.length >= 4) this.hitStormDone = true
    }

    if (this.hitStormDone && !this.onelineDone && !this.farm.hasWork()) {
      this.onelineDone = true
      this.farm.setFile('auth.cc', 'int auth(){return 1;}')
      this.incident = {
        id: 'oneline',
        title: 'One-line fix · auth.cc',
        body: 'Only that compile, the link, and the tests that consume it miss. Everything else is a hit.',
      }
      this.farm.submitBuild('alice')
      this.farm.submitBuild('ci')
      this.speak('oneline', 'The miss still has to run somewhere. A cache remembers. It does not execute.')
    }

    if (this.onelineDone && !this.onelineFinished && !this.farm.hasWork()) {
      this.onelineFinished = true
    }

    if (this.re === 'on' && this.onelineFinished && !this.mergeFired && !this.farm.hasWork()) {
      this.mergeFired = true
      this.farm.setFile('net.cc', 'void net(){ /* merge */ }')
      this.incident = {
        id: 'merge',
        title: 'Alice and Bob hit merge',
        body: 'Two Execute calls, one digest. The scheduler merges them. One execution, two waiters.',
      }
      this.farm.submitBuild('alice')
      this.farm.submitBuild('bob')
      this.speak('merge', 'Identical in-flight actions merge. One execution, two waiters.')
    }

    if (this.mergeFired && this.seenMerge && !this.toolchainFired && !this.farm.hasWork()) {
      this.toolchainFired = true
      this.farm.bumpToolchain('clang-19')
      this.incident = {
        id: 'toolchain',
        title: 'Toolchain bump · clang-19',
        body: 'Every action digest changed. The cache is empty for the right reason. It will refill.',
      }
      this.submitAll()
      this.speak('toolchain', 'New toolchain, new digests. There is nothing to invalidate.')
    }

    if (
      this.toolchainFired &&
      !this.mismatchFired &&
      this.re === 'on' &&
      !this.farm.hasWork() &&
      this.farm.finished.some((build) => build.startedTick > 0 && this.farm.toolchain === 'clang-19')
    ) {
      const recovered = this.farm.finished.filter(
        (build) => build.durationSeconds !== null && build.hits > 0,
      )
      if (recovered.length >= 3 && this.sessionTick > 0) {
        this.mismatchFired = true
        this.farm.setActionPlatform('macos')
        this.farm.submitBuild('ci')
        this.incident = {
          id: 'mismatch',
          title: 'CI set OSFamily=macos',
          body: 'Workers still advertise linux. The job is queued. The scheduler will not fail it. This is the classic first-remote-build hang.',
        }
        this.speak(
          'mismatch',
          'No worker advertises OSFamily=macos. The scheduler will not error. The action waits.',
        )
      }
    }

    if (
      this.mismatchFired &&
      this.farm.actionPlatform.OSFamily === 'linux' &&
      !this.releaseFired &&
      !this.farm.hasWork()
    ) {
      this.fireRelease()
    }

    if (
      !this.releaseFired &&
      this.toolchainFired &&
      this.capacity !== 'locked' &&
      this.week().progress > 0.72 &&
      !this.farm.hasWork()
    ) {
      this.fireRelease()
    }

    if (this.outcome === 'playing' && this.sessionTick - this.lastPeriodic > TICKS_PER_REAL_SEC * 18) {
      if (!this.farm.hasWork() && this.farm.actionPlatform.OSFamily === 'linux') {
        this.lastPeriodic = this.sessionTick
        const devs = ['alice', 'bob', 'carol', 'dave'] as const
        const id = devs[this.rotate % devs.length]
        this.rotate += 1
        if (id) this.farm.submitBuild(id)
        this.farm.submitBuild('ci')
      }
    }
  }

  private fireRelease(): void {
    this.releaseFired = true
    this.farm.setFile('base.h', '#pragma once\nstruct Ctx;\n#define VERSION 2\n')
    this.incident = {
      id: 'release',
      title: 'Release cut',
      body: 'VERSION changed. Compiles miss. This is the build that has to fan out, or Friday slips.',
    }
    this.submitAll()
    this.speak('release', 'The win is parallelism and shared results, not faster single-action latency.')
  }

  private submitAll(): void {
    for (const client of CLIENTS) this.farm.submitBuild(client.id)
  }

  private expireCoach(): void {
    if (this.coach && this.sessionTick > this.coachUntil) this.coach = null
  }

  private speak(id: string, text: string): void {
    if (this.seenCoach.has(id)) return
    this.seenCoach.add(id)
    this.coach = { id, text }
    this.coachUntil = this.sessionTick + COACH_TTL
  }

  private week(): GameSnapshot['week'] {
    const progress = Math.min(1, this.sessionTick / FRIDAY_TICKS)
    const minutes = progress * 5 * 8 * 60
    const day = DAYS[Math.min(4, Math.floor(minutes / 480))] ?? 'Fri'
    const inDay = minutes % 480
    const hour = 9 + Math.floor(inDay / 60)
    const minute = Math.floor(inDay % 60)
    return {
      day,
      clock: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      progress,
      friday: progress >= 1,
    }
  }

  private metrics(farm: FarmSnapshot): GameSnapshot['metrics'] {
    const after = this.cacheOnTick ?? Number.POSITIVE_INFINITY
    const finished = farm.builds.filter(
      (build) => build.durationSeconds !== null && build.finishedTick !== null && build.startedTick >= after,
    )
    const dev = finished
      .filter((build) => CLIENTS.find((client) => client.id === build.clientId)?.kind === 'dev')
      .map((build) => build.durationSeconds ?? 0)
    const ci = finished
      .filter((build) => build.clientId === 'ci')
      .map((build) => build.durationSeconds ?? 0)
    const windowDev = dev.slice(-6)
    const windowCi = ci.slice(-3)
    const p95Dev = windowDev.length ? computeP95(windowDev) : null
    const ciWall = windowCi.length ? windowCi[windowCi.length - 1] ?? null : null
    const slaMet =
      p95Dev !== null &&
      ciWall !== null &&
      p95Dev <= SLA_DEV_P95 &&
      ciWall <= SLA_CI_WALL &&
      windowDev.length >= 3 &&
      windowCi.length >= 1
    return {
      p95Dev,
      ciWall,
      hitRate: farm.ac.hitRate,
      queueDepth: farm.scheduler.depth,
      wastedCpuMinutes: farm.wastedCpuSeconds / 60,
      slaDev: SLA_DEV_P95,
      slaCi: SLA_CI_WALL,
      slaMet,
      samplesDev: windowDev.length,
      samplesCi: windowCi.length,
    }
  }

  private isHang(farm: FarmSnapshot): boolean {
    if (farm.mode !== 'cache+re') return false
    return farm.scheduler.queue.some((item) => {
      if (item.matched) return false
      return !farm.workers.some((worker) => worker.platform.OSFamily === item.platform.OSFamily)
    })
  }

  private evaluate(): void {
    if (this.outcome !== 'playing') return
    if (this.isHungNow()) return
    const week = this.week()
    const slaMet = this.slaMetNow()
    const examReady = this.releaseFired || this.mismatchFired
    if (examReady && slaMet && this.cache === 'on') {
      this.outcome = 'won'
      this.speak('win', 'p95 is a download plus the misses you actually had to run.')
      this.incident = {
        id: 'win',
        title: 'SLA held',
        body: 'Developer wait and CI wall time are under the line. The ghost column is Monday morning without a farm.',
      }
      return
    }
    if (week.friday && !slaMet) {
      this.outcome = 'lost'
      this.speak('lose', 'Friday 17:00. The queue is still the product.')
      this.incident = {
        id: 'lose',
        title: 'Friday 17:00',
        body: 'The deploy window closed. Hit rate, worker count, and platform match are the three knobs that were available.',
      }
    }
  }

  private isHungNow(): boolean {
    if (this.farm.mode !== 'cache+re') return false
    return this.farm.queue.some((item) => {
      if (item.workerId !== null) return false
      return !this.farm.workers.some((worker) => worker.platform.OSFamily === item.platform.OSFamily)
    })
  }

  private slaMetNow(): boolean {
    const after = this.cacheOnTick ?? Number.POSITIVE_INFINITY
    const finished = this.farm.finished.filter(
      (build) => build.durationSeconds !== null && build.startedTick >= after,
    )
    const dev = finished
      .filter((build) => CLIENTS.find((client) => client.id === build.clientId)?.kind === 'dev')
      .map((build) => build.durationSeconds ?? 0)
      .slice(-6)
    const ci = finished
      .filter((build) => build.clientId === 'ci')
      .map((build) => build.durationSeconds ?? 0)
      .slice(-3)
    if (dev.length < 3 || ci.length < 1) return false
    const p95Dev = computeP95(dev)
    const ciWall = ci[ci.length - 1] ?? Number.POSITIVE_INFINITY
    return p95Dev <= SLA_DEV_P95 && ciWall <= SLA_CI_WALL
  }
}

export function createSession(): GameSession {
  return new GameSession()
}

export function ticksPerSecond(): number {
  return TICKS_PER_REAL_SEC
}

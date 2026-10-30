import { describe, expect, it } from 'vitest'
import { ACTIONS, actionDigest, DEFAULT_FILES, fileDigest } from './graph.ts'
import { createFarm } from './farm.ts'
import type { Farm } from './farm.ts'

function drain(farm: Farm, max = 8000): number {
  let i = 0
  while (farm.hasWork() && i < max) {
    farm.tick()
    i += 1
  }
  return i
}

describe('content addressing', () => {
  it('changes an action digest when the source file changes, and dependents follow', () => {
    const files = { ...DEFAULT_FILES }
    const compile = ACTIONS.find((action) => action.id === 'auth.o')
    const link = ACTIONS.find((action) => action.id === 'app')
    if (!compile || !link) throw new Error('graph')

    const beforeCompile = actionDigest({
      action: compile,
      files,
      depOutputs: {},
      toolchain: 'clang-18',
      osFamily: 'linux',
    })
    files['auth.cc'] = 'int auth(){return 1;}'
    const afterCompile = actionDigest({
      action: compile,
      files,
      depOutputs: {},
      toolchain: 'clang-18',
      osFamily: 'linux',
    })
    expect(afterCompile).not.toBe(beforeCompile)
    expect(fileDigest('auth.cc', DEFAULT_FILES['auth.cc'] ?? '')).not.toBe(
      fileDigest('auth.cc', files['auth.cc'] ?? ''),
    )

    const beforeLink = actionDigest({
      action: link,
      files,
      depOutputs: { 'auth.o': 'aaa' },
      toolchain: 'clang-18',
      osFamily: 'linux',
    })
    const afterLink = actionDigest({
      action: link,
      files,
      depOutputs: { 'auth.o': 'bbb' },
      toolchain: 'clang-18',
      osFamily: 'linux',
    })
    expect(afterLink).not.toBe(beforeLink)
  })
})

describe('local mode', () => {
  it('never enqueues on the scheduler', () => {
    const farm = createFarm({ mode: 'local' })
    farm.submitBuild('alice')
    drain(farm)
    expect(farm.snapshot().scheduler.enqueuedTotal).toBe(0)
    expect(farm.snapshot().ac.size).toBe(0)
  })
})

describe('action cache hits skip the scheduler', () => {
  it('does not enqueue a digest that already has an ActionResult', () => {
    const farm = createFarm({ mode: 'cache+re', workerCount: 4 })
    farm.submitBuild('alice')
    drain(farm)
    const afterFirst = farm.snapshot()
    expect(afterFirst.scheduler.enqueuedTotal).toBeGreaterThan(0)
    expect(afterFirst.ac.size).toBe(ACTIONS.length)
    expect(afterFirst.ac.workerWrites).toBe(ACTIONS.length)

    const enqueued = afterFirst.scheduler.enqueuedTotal
    farm.submitBuild('bob')
    drain(farm)
    const afterSecond = farm.snapshot()
    expect(afterSecond.scheduler.enqueuedTotal).toBe(enqueued)
    expect(afterSecond.ac.hits).toBe(ACTIONS.length)
    expect(afterSecond.scheduler.idle).toBe(true)
  })
})

describe('FindMissingBlobs', () => {
  it('uploads only missing input blobs after a one-line change', () => {
    const farm = createFarm({ mode: 'cache+re', workerCount: 8 })
    farm.submitBuild('alice')
    drain(farm)
    const coldUploads = farm.snapshot().cas.clientUploads
    expect(coldUploads).toBeGreaterThan(0)

    farm.submitBuild('bob')
    drain(farm)
    expect(farm.snapshot().cas.clientUploads).toBe(coldUploads)

    farm.setFile('auth.cc', 'int auth(){return 1;}')
    farm.submitBuild('alice')
    drain(farm)
    const afterFix = farm.snapshot()
    expect(afterFix.cas.clientUploads).toBe(coldUploads + 1)
    expect(afterFix.ac.hits).toBeGreaterThan(0)
    expect(afterFix.ac.misses).toBeGreaterThan(ACTIONS.length)
  })
})

describe('in-flight merge', () => {
  it('merges identical cacheable actions into one execution', () => {
    const farm = createFarm({ mode: 'cache+re', workerCount: 1 })
    farm.submitBuild('alice')
    farm.submitBuild('bob')
    let sawMerge = false
    let maxWaiters = 0
    for (let i = 0; i < 4000 && farm.hasWork(); i++) {
      farm.tick()
      const snap = farm.snapshot()
      if (snap.scheduler.merges > 0) sawMerge = true
      for (const item of snap.scheduler.queue) {
        maxWaiters = Math.max(maxWaiters, item.waiters.length)
      }
      for (const worker of snap.workers) {
        maxWaiters = Math.max(maxWaiters, worker.waiters.length)
      }
    }
    expect(sawMerge).toBe(true)
    expect(maxWaiters).toBe(2)
    for (const count of Object.values(farm.snapshot().executionsByDigest)) {
      expect(count).toBe(1)
    }
  })
})

describe('platform match', () => {
  it('does not start work when no worker satisfies OSFamily', () => {
    const farm = createFarm({
      mode: 'cache+re',
      workerCount: 4,
      actionPlatform: 'macos',
      workerPlatform: 'linux',
    })
    farm.submitBuild('alice')
    for (let i = 0; i < 80; i++) farm.tick()
    const snap = farm.snapshot()
    expect(snap.scheduler.depth).toBeGreaterThan(0)
    expect(snap.workers.every((worker) => !worker.busy)).toBe(true)
    expect(snap.ac.workerWrites).toBe(0)
    expect(snap.ac.size).toBe(0)
    expect(snap.hasWork).toBe(true)
    expect(snap.builds.some((build) => build.finishedTick !== null)).toBe(false)
    farm.setActionPlatform('linux')
    drain(farm)
    expect(farm.snapshot().builds.some((build) => build.finishedTick !== null)).toBe(true)
  })
})

describe('worker writes the ActionResult', () => {
  it('leaves the AC empty until the worker finishes, then writes from the worker', () => {
    const farm = createFarm({ mode: 'cache+re', workerCount: 2 })
    farm.submitBuild('alice')
    let sawScheduledEmptyAc = false
    let writesWhileQueued = 0
    for (let i = 0; i < 8000 && farm.hasWork(); i++) {
      farm.tick()
      const snap = farm.snapshot()
      if (snap.scheduler.enqueuedTotal > 0 && snap.ac.writes === 0) {
        sawScheduledEmptyAc = true
      }
      if (snap.scheduler.queue.some((item) => !item.matched) && snap.ac.writes > writesWhileQueued) {
        writesWhileQueued = snap.ac.writes
      }
    }
    const done = farm.snapshot()
    expect(sawScheduledEmptyAc).toBe(true)
    expect(done.ac.workerWrites).toBe(ACTIONS.length)
    expect(done.ac.clientWrites).toBe(0)
    expect(done.ac.size).toBe(ACTIONS.length)
  })
})

describe('cache-only clients write the AC after local execution', () => {
  it('fills the AC without touching the scheduler', () => {
    const farm = createFarm({ mode: 'cache' })
    farm.submitBuild('alice')
    drain(farm)
    const snap = farm.snapshot()
    expect(snap.scheduler.enqueuedTotal).toBe(0)
    expect(snap.ac.clientWrites).toBe(ACTIONS.length)
    expect(snap.ac.workerWrites).toBe(0)
    farm.submitBuild('ci')
    drain(farm)
    expect(farm.snapshot().ac.hits).toBe(ACTIONS.length)
  })
})

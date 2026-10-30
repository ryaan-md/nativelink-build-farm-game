import { describe, expect, it } from 'vitest'
import { createSession } from './session.ts'

describe('game session script', () => {
  it('unlocks cache, RE, and capacity in order and can reproduce the hang', () => {
    const session = createSession()
    session.begin()

    let sawMonday = false
    let sawOneline = false
    let sawMerge = false
    let sawToolchain = false
    let hangTicks = 0

    for (let i = 0; i < 12000; i++) {
      session.tick()
      if (session.incident?.id === 'monday') sawMonday = true
      if (session.incident?.id === 'oneline') sawOneline = true
      if (session.incident?.id === 'merge') sawMerge = true
      if (session.incident?.id === 'toolchain') sawToolchain = true
      if (i % 4 !== 0 && session.outcome === 'playing') continue
      const snap = session.snapshot()
      if (snap.hang) hangTicks += 1

      if (snap.upgrades.cache === 'ready') session.enableCache()
      if (snap.upgrades.re === 'ready') session.enableRe()
      if (snap.upgrades.capacity !== 'locked' && snap.farm.workerCount < 6) session.addWorker()
      if (snap.hang && hangTicks >= 2) session.setActionPlatform('linux')
      if (snap.outcome !== 'playing') break
    }

    const end = session.snapshot()
    expect(sawMonday).toBe(true)
    expect(session.cache).toBe('on')
    expect(sawOneline).toBe(true)
    expect(session.re).toBe('on')
    expect(sawMerge).toBe(true)
    expect(session.capacity).not.toBe('locked')
    expect(sawToolchain).toBe(true)
    expect(hangTicks).toBeGreaterThan(0)
    expect(end.farm.mode).toBe('cache+re')
    expect(end.farm.ac.hits).toBeGreaterThan(0)
    expect(end.farm.scheduler.merges).toBeGreaterThan(0)
  }, 15000)
})

import { create } from 'zustand'
import { createSession, ticksPerSecond } from './session.ts'
import type { GameSnapshot } from './session.ts'
import type { OsFamily } from './engine/index.ts'

const session = createSession()

export interface GameStore {
  snap: GameSnapshot
  tick: () => void
  pump: (n: number) => void
  begin: () => void
  enableCache: () => void
  enableRe: () => void
  addWorker: () => void
  setKeepTinyLocal: (value: boolean) => void
  setActionPlatform: (os: OsFamily) => void
  setSpeed: (speed: 1 | 2) => void
}

export const useGame = create<GameStore>((set) => ({
  snap: session.snapshot(),
  tick: () => set({ snap: session.tick() }),
  pump: (n) => {
    for (let i = 0; i < n; i++) session.step()
    set({ snap: session.snapshot() })
  },
  begin: () => {
    session.begin()
    set({ snap: session.snapshot() })
  },
  enableCache: () => {
    session.enableCache()
    set({ snap: session.snapshot() })
  },
  enableRe: () => {
    session.enableRe()
    set({ snap: session.snapshot() })
  },
  addWorker: () => {
    session.addWorker()
    set({ snap: session.snapshot() })
  },
  setKeepTinyLocal: (value) => {
    session.setKeepTinyLocal(value)
    set({ snap: session.snapshot() })
  },
  setActionPlatform: (os) => {
    session.setActionPlatform(os)
    set({ snap: session.snapshot() })
  },
  setSpeed: (speed) => {
    session.setSpeed(speed)
    set({ snap: session.snapshot() })
  },
}))

export { ticksPerSecond }

import type { ActionDef, ClientDef } from './types.ts'
import { digestOf } from './hash.ts'

/** One farm tick is 100ms of build-farm time. */
export const TICK_SECONDS = 0.1

export const SLA_DEV_P95 = 8
export const SLA_CI_WALL = 11

export const DEFAULT_FILES: Record<string, string> = {
  'base.h': '#pragma once\nstruct Ctx;',
  'util.cc': 'void util(){}',
  'auth.cc': 'int auth(){return 0;}',
  'db.cc': 'void db(){}',
  'net.cc': 'void net(){}',
  'api.cc': 'void api(){}',
  'svc.cc': 'void svc(){}',
  'cli.cc': 'int cli(){return 0;}',
  'main.cc': 'int main(){return 0;}',
}

export const ACTIONS: ActionDef[] = [
  {
    id: 'util.o',
    kind: 'compile',
    label: 'util.cc',
    command: 'c++ -c util.cc -o util.o',
    inputFiles: ['util.cc', 'base.h'],
    deps: [],
    output: 'util.o',
    durationTicks: 32,
    tiny: false,
  },
  {
    id: 'auth.o',
    kind: 'compile',
    label: 'auth.cc',
    command: 'c++ -c auth.cc -o auth.o',
    inputFiles: ['auth.cc', 'base.h'],
    deps: [],
    output: 'auth.o',
    durationTicks: 36,
    tiny: false,
  },
  {
    id: 'db.o',
    kind: 'compile',
    label: 'db.cc',
    command: 'c++ -c db.cc -o db.o',
    inputFiles: ['db.cc', 'base.h'],
    deps: [],
    output: 'db.o',
    durationTicks: 40,
    tiny: false,
  },
  {
    id: 'net.o',
    kind: 'compile',
    label: 'net.cc',
    command: 'c++ -c net.cc -o net.o',
    inputFiles: ['net.cc', 'base.h'],
    deps: [],
    output: 'net.o',
    durationTicks: 34,
    tiny: false,
  },
  {
    id: 'api.o',
    kind: 'compile',
    label: 'api.cc',
    command: 'c++ -c api.cc -o api.o',
    inputFiles: ['api.cc', 'base.h'],
    deps: [],
    output: 'api.o',
    durationTicks: 44,
    tiny: false,
  },
  {
    id: 'svc.o',
    kind: 'compile',
    label: 'svc.cc',
    command: 'c++ -c svc.cc -o svc.o',
    inputFiles: ['svc.cc', 'base.h'],
    deps: [],
    output: 'svc.o',
    durationTicks: 38,
    tiny: false,
  },
  {
    id: 'cli.o',
    kind: 'compile',
    label: 'cli.cc',
    command: 'c++ -c cli.cc -o cli.o',
    inputFiles: ['cli.cc', 'base.h'],
    deps: [],
    output: 'cli.o',
    durationTicks: 2,
    tiny: true,
  },
  {
    id: 'main.o',
    kind: 'compile',
    label: 'main.cc',
    command: 'c++ -c main.cc -o main.o',
    inputFiles: ['main.cc', 'base.h'],
    deps: [],
    output: 'main.o',
    durationTicks: 36,
    tiny: false,
  },
  {
    id: 'app',
    kind: 'link',
    label: 'link',
    command: 'c++ -o app *.o',
    inputFiles: [],
    deps: ['util.o', 'auth.o', 'db.o', 'net.o', 'api.o', 'svc.o', 'cli.o', 'main.o'],
    output: 'app',
    durationTicks: 22,
    tiny: false,
  },
  {
    id: 'test_unit',
    kind: 'test',
    label: 'test/unit',
    command: './app --gtest_filter=Unit*',
    inputFiles: [],
    deps: ['app'],
    output: 'test_unit.log',
    durationTicks: 26,
    tiny: false,
  },
  {
    id: 'test_int',
    kind: 'test',
    label: 'test/int',
    command: './app --gtest_filter=Int*',
    inputFiles: [],
    deps: ['app'],
    output: 'test_int.log',
    durationTicks: 32,
    tiny: false,
  },
]

export const CLIENTS: ClientDef[] = [
  { id: 'alice', name: 'Alice', kind: 'dev', cores: 2 },
  { id: 'bob', name: 'Bob', kind: 'dev', cores: 2 },
  { id: 'carol', name: 'Carol', kind: 'dev', cores: 2 },
  { id: 'dave', name: 'Dave', kind: 'dev', cores: 2 },
  { id: 'ci', name: 'CI', kind: 'ci', cores: 4 },
]

export const ACTION_BY_ID: Record<string, ActionDef> = Object.fromEntries(
  ACTIONS.map((action) => [action.id, action]),
)

export function fileDigest(name: string, content: string): string {
  return digestOf('file', name, content)
}

export function outputDigestFor(actionDigest: string, output: string): string {
  return digestOf('out', actionDigest, output)
}

export function stdoutDigestFor(actionDigest: string): string {
  return digestOf('stdout', actionDigest)
}

export function actionDigest(args: {
  action: ActionDef
  files: Record<string, string>
  depOutputs: Record<string, string>
  toolchain: string
  osFamily: string
}): string {
  const fileParts = args.action.inputFiles.map((name) =>
    fileDigest(name, args.files[name] ?? ''),
  )
  const depParts = args.action.deps.map((id) => args.depOutputs[id] ?? 'missing')
  return digestOf(
    'action',
    args.action.command,
    args.toolchain,
    args.osFamily,
    ...fileParts,
    ...depParts,
  )
}

export function inputBlobDigests(args: {
  action: ActionDef
  files: Record<string, string>
  depOutputs: Record<string, string>
}): string[] {
  const blobs: string[] = []
  for (const name of args.action.inputFiles) {
    blobs.push(fileDigest(name, args.files[name] ?? ''))
  }
  for (const id of args.action.deps) {
    const out = args.depOutputs[id]
    if (out) blobs.push(out)
  }
  return blobs
}

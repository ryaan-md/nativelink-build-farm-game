import { hex8, statusTone } from '../format.ts'
import type { GraphNodeView } from '../engine/index.ts'

export function GraphStrip({ nodes }: { nodes: GraphNodeView[] }) {
  const compiles = nodes.filter((node) => node.kind === 'compile')
  const rest = nodes.filter((node) => node.kind !== 'compile')
  return (
    <section className="border-b border-nl-border bg-nl-surface px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-nl-muted">
          Action graph
        </div>
        <div className="font-mono text-[10px] text-nl-muted">
          8 compile · 1 link · 2 test · content-addressed
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {compiles.map((node) => (
          <NodeChip key={node.id} node={node} />
        ))}
        <span className="font-mono text-nl-muted">→</span>
        {rest.map((node) => (
          <NodeChip key={node.id} node={node} />
        ))}
      </div>
    </section>
  )
}

function NodeChip({ node }: { node: GraphNodeView }) {
  const live = node.status !== 'idle' && node.status !== 'blocked'
  return (
    <div
      className={`rounded-md border px-2 py-1 font-mono text-[11px] transition-colors duration-200 ${
        node.hit
          ? 'border-nl-success/40 bg-nl-success-soft text-nl-success'
          : node.changed
            ? 'border-nl-warn/50 bg-nl-warn/10 text-nl-warn'
            : live
              ? 'border-nl-brand/40 bg-nl-brand-soft text-nl-brand'
              : 'border-nl-border bg-nl-elevated text-nl-muted'
      }`}
      title={`${node.id} ${node.digest ?? ''}`}
    >
      <div className="flex items-center gap-1.5">
        <span>{node.label}</span>
        {node.tiny ? <span className="text-[9px] uppercase">200ms</span> : null}
      </div>
      <div className={`text-[9px] ${statusTone(node.status)}`}>
        {node.status === 'idle' ? hex8(node.digest ?? '') : node.status.replaceAll('_', ' ')}
      </div>
    </div>
  )
}

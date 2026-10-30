export function fmtSec(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value < 10) return `${value.toFixed(1)}s`
  return `${value.toFixed(0)}s`
}

export function fmtPct(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function fmtMin(value: number): string {
  if (value < 0.1) return `${Math.round(value * 60)}s`
  return `${value.toFixed(1)}m`
}

export function hex8(digest: string): string {
  return digest.slice(0, 8)
}

export function statusTone(status: string): string {
  if (status === 'hit' || status === 'done') return 'text-nl-success'
  if (status.includes('local')) return 'text-nl-warn'
  if (status.includes('remote') || status === 'running_remote') return 'text-nl-brand'
  if (status === 'scheduled' || status === 'uploading' || status === 'finding_blobs') {
    return 'text-nl-warn'
  }
  return 'text-nl-muted'
}

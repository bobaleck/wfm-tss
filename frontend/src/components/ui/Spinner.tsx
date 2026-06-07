import { clsx } from 'clsx'

export default function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        'border-2 border-slate-200 border-t-brand-600 rounded-full animate-spin',
        className ?? 'w-5 h-5',
      )}
    />
  )
}

export function PageSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <Spinner className="w-8 h-8" />
    </div>
  )
}

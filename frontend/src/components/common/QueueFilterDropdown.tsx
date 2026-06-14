import { useState, useRef, useEffect } from 'react'
import { Filter, Check } from 'lucide-react'

interface Props {
  queues: string[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  label?: string
}

function CheckItem({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-50 group transition-colors"
    >
      <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border-2 transition-all ${
        checked
          ? 'bg-brand-500 border-brand-500'
          : 'border-slate-300 bg-white group-hover:border-brand-400'
      }`}>
        {checked && <Check size={9} className="text-white" strokeWidth={3.5} />}
      </span>
      <span className="text-sm text-slate-700 truncate">{label}</span>
    </button>
  )
}

export default function QueueFilterDropdown({ queues, selected, onChange, label = 'Очереди' }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const isAllSelected = selected.size === 0

  const toggle = (q: string) => {
    const next = new Set(selected)
    if (isAllSelected) {
      // Deselect all-mode → select this one explicitly
      // (checking one queue from "all" means "now filter to only this one"
      // is unintuitive; instead we flip: deselect others)
      queues.forEach((name) => { if (name !== q) next.add(name) })
      // But that's complex. Simple: toggle this queue in selected
      // If was all-selected, clicking one queue means "show only this one"
      onChange(new Set([q]))
      return
    }
    if (next.has(q)) next.delete(q)
    else next.add(q)
    if (next.size === queues.length || next.size === 0) onChange(new Set()) // back to all
    else onChange(next)
  }

  const selectAll = () => { onChange(new Set()); setOpen(false) }

  const buttonLabel = isAllSelected
    ? 'Все очереди'
    : selected.size === 1
      ? [...selected][0].length > 18 ? [...selected][0].slice(0, 18) + '…' : [...selected][0]
      : `${selected.size} из ${queues.length}`

  return (
    <div ref={ref} className="relative">
      {label && <label className="label">{label}</label>}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`btn-secondary whitespace-nowrap gap-2 ${!isAllSelected ? 'border-brand-400 text-brand-700 bg-brand-50' : ''}`}
      >
        <Filter size={14} />
        <span className="max-w-36 truncate">{buttonLabel}</span>
      </button>

      {open && (
        <div className="absolute z-30 top-full mt-1 left-0 bg-white border border-slate-200 rounded-xl shadow-lg w-64">
          <div className="flex items-center justify-between px-3 pt-3 pb-1">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Фильтр по очередям</span>
            <button
              onClick={selectAll}
              className="text-xs text-brand-600 hover:text-brand-800 font-medium hover:underline"
            >
              Выбрать все
            </button>
          </div>
          <div className="px-1 pb-2 space-y-0.5 max-h-64 overflow-y-auto">
            {queues.map((q) => (
              <CheckItem
                key={q}
                label={q}
                checked={isAllSelected || selected.has(q)}
                onChange={() => toggle(q)}
              />
            ))}
          </div>
          <div className="px-3 pb-3 pt-1 border-t border-slate-100">
            <button
              onClick={() => setOpen(false)}
              className="w-full text-xs text-center py-1.5 bg-brand-500 text-white rounded-lg hover:bg-brand-600 font-medium"
            >
              Применить
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

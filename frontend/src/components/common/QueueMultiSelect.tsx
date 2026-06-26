import { useState, useRef, useEffect } from 'react'
import { Check, ChevronDown } from 'lucide-react'

// Выпадающий список очередей с галочками (без ограничения на количество).
// Используется при назначении смены: отмечаем очереди, в которые ставим оператора.
export default function QueueMultiSelect({ options, value, onChange, placeholder = 'Выберите очереди' }: {
  options: string[]
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    if (open) document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const toggle = (q: string) => onChange(value.includes(q) ? value.filter((x) => x !== q) : [...value, q])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`input flex items-center justify-between gap-2 text-left ${open ? 'border-brand-400 ring-1 ring-brand-200' : ''}`}
      >
        <span className={`truncate ${value.length ? 'text-slate-700' : 'text-slate-400'}`}>
          {value.length ? value.join(', ') : placeholder}
        </span>
        <ChevronDown size={15} className={`text-slate-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto p-1">
          {options.length > 0 && (
            <div className="flex items-center justify-between px-2.5 py-1 border-b border-slate-100 mb-1">
              <button type="button"
                onClick={() => options.every((q) => value.includes(q))
                  ? onChange(value.filter((v) => !options.includes(v)))
                  : onChange([...new Set([...value, ...options])])}
                className="text-xs text-brand-600 hover:text-brand-800 font-medium">
                {options.every((q) => value.includes(q)) ? 'Снять все' : 'Выбрать все'}
              </button>
              {value.length > 0 && <span className="text-xs text-slate-400">{value.length} выбрано</span>}
            </div>
          )}
          {options.length === 0 ? (
            <p className="text-xs text-slate-400 px-3 py-2">Нет доступных очередей</p>
          ) : options.map((q) => {
            const on = value.includes(q)
            return (
              <button
                key={q}
                type="button"
                onClick={() => toggle(q)}
                className="flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-50 group transition-colors"
              >
                <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors ${
                  on ? 'bg-brand-500 border-brand-500' : 'border-slate-300 bg-white group-hover:border-brand-400'
                }`}>
                  {on && <Check size={10} className="text-white" strokeWidth={3} />}
                </span>
                <span className="text-sm text-slate-700 truncate">{q}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

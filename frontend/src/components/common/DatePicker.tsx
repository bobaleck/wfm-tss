import { useState, useRef, useEffect, useMemo } from 'react'
import { format, addMonths, startOfMonth, startOfWeek, addDays, isSameMonth, parseISO } from 'date-fns'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const fmt = (d: Date) => format(d, 'yyyy-MM-dd')
const disp = (s: string) => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${d}.${m}.${y}` }

// Современный одиночный выбор даты с календарём-поповером (вместо нативного input[type=date]).
export default function DatePicker({ value, onChange, className, placeholder = 'дата' }: {
  value: string
  onChange: (v: string) => void
  className?: string
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => (value ? startOfMonth(parseISO(value)) : startOfMonth(new Date())))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    if (open) document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  useEffect(() => { if (value) setMonth(startOfMonth(parseISO(value))) }, [value])

  const cells = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [month])

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm w-full transition-colors ${
          open ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
        }`}
      >
        <Calendar size={14} className="text-slate-400 flex-shrink-0" />
        <span className="font-medium">{disp(value) || placeholder}</span>
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 bg-white border border-slate-200 rounded-2xl shadow-xl p-3 w-[280px]">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => setMonth((m) => addMonths(m, -1))} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><ChevronLeft size={16} /></button>
            <span className="text-sm font-semibold text-slate-800">{MONTHS[month.getMonth()]} {month.getFullYear()}</span>
            <button type="button" onClick={() => setMonth((m) => addMonths(m, 1))} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((w) => <div key={w} className="text-center text-[11px] font-medium text-slate-400">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((c) => {
              const ds = fmt(c); const inM = isSameMonth(c, month); const seld = ds === value
              return (
                <button key={ds} type="button" onClick={() => { onChange(ds); setOpen(false) }}
                  className={`h-9 rounded-lg text-sm transition-colors ${
                    seld ? 'bg-brand-600 text-white font-semibold' : inM ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-300 hover:bg-slate-50'
                  }`}>
                  {c.getDate()}
                </button>
              )
            })}
          </div>
          <button type="button" onClick={() => { onChange(fmt(new Date())); setOpen(false) }}
            className="w-full mt-2 text-xs text-brand-600 hover:text-brand-700 font-medium py-1.5 rounded-lg hover:bg-brand-50">
            Сегодня
          </button>
        </div>
      )}
    </div>
  )
}

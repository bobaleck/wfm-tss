import { useState, useRef, useEffect } from 'react'
import { format, subDays, startOfYear, startOfQuarter, endOfQuarter, subQuarters, addYears, subYears } from 'date-fns'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'

interface Props {
  begin: string
  end: string
  onChange: (begin: string, end: string) => void
  className?: string
}

type Mode = 'day' | '3days' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

const fmt = (d: Date) => format(d, 'yyyy-MM-dd')
const disp = (s: string) => {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${d}.${m}.${y}`
}

const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
const QUARTER_MONTHS: Record<number, number[]> = { 1: [0, 1, 2], 2: [3, 4, 5], 3: [6, 7, 8], 4: [9, 10, 11] }

function getQuarterRange(q: number, year: number): [string, string] {
  const start = new Date(year, (q - 1) * 3, 1)
  const end = new Date(year, q * 3, 0)
  return [fmt(start), fmt(end)]
}
function getMonthRange(month: number, year: number): [string, string] {
  const start = new Date(year, month, 1)
  const end = new Date(year, month + 1, 0)
  return [fmt(start), fmt(end)]
}

const QUICK_PRESETS: { label: string; mode: Mode; desc: string }[] = [
  { label: 'Сегодня', mode: 'day', desc: 'Текущий день' },
  { label: '3 дня', mode: '3days', desc: 'Последние 3 дня' },
  { label: 'Неделя', mode: 'week', desc: 'Последние 7 дней' },
  { label: 'Месяц', mode: 'month', desc: 'Выбор месяца' },
  { label: 'Квартал', mode: 'quarter', desc: 'Выбор квартала' },
  { label: 'Год', mode: 'year', desc: 'Весь год' },
  { label: 'Другой', mode: 'custom', desc: 'Произвольный период' },
]

function applyQuickMode(mode: Mode, year: number, month: number, quarter: number): [string, string] | null {
  const now = new Date()
  switch (mode) {
    case 'day': return [fmt(now), fmt(now)]
    case '3days': return [fmt(subDays(now, 2)), fmt(now)]
    case 'week': return [fmt(subDays(now, 6)), fmt(now)]
    case 'month': return getMonthRange(month, year)
    case 'quarter': return getQuarterRange(quarter, year)
    case 'year': return [fmt(startOfYear(new Date(year, 0, 1))), fmt(new Date(year, 11, 31))]
    default: return null
  }
}

export default function DateRangePicker({ begin, end, onChange, className }: Props) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('week')
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth())
  const [quarter, setQuarter] = useState<number>(Math.ceil((new Date().getMonth() + 1) / 3))
  const [customBegin, setCustomBegin] = useState(begin)
  const [customEnd, setCustomEnd] = useState(end)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const apply = (b: string, e: string) => {
    onChange(b, e)
    setOpen(false)
  }

  const handleModeClick = (m: Mode) => {
    setMode(m)
    if (m !== 'custom') {
      const result = applyQuickMode(m, year, month, quarter)
      if (result) apply(result[0], result[1])
    }
  }

  const handleYearChange = (delta: number) => {
    const ny = year + delta
    setYear(ny)
    if (mode === 'month') {
      const result = getMonthRange(month, ny)
      apply(result[0], result[1])
    } else if (mode === 'quarter') {
      const result = getQuarterRange(quarter, ny)
      apply(result[0], result[1])
    } else if (mode === 'year') {
      apply(fmt(new Date(ny, 0, 1)), fmt(new Date(ny, 11, 31)))
    }
  }

  const handleMonthClick = (m: number) => {
    setMonth(m)
    const result = getMonthRange(m, year)
    apply(result[0], result[1])
  }

  const handleQuarterClick = (q: number) => {
    setQuarter(q)
    const result = getQuarterRange(q, year)
    apply(result[0], result[1])
  }

  const periodDisplay = begin === end
    ? disp(begin)
    : `${disp(begin)} — ${disp(end)}`

  return (
    <div className={`relative ${className ?? ''}`} ref={ref}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
            open
              ? 'border-brand-400 bg-brand-50 text-brand-700'
              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
          }`}
        >
          <Calendar size={14} className="text-slate-400 flex-shrink-0" />
          <span className="font-medium">{periodDisplay || 'Выберите период'}</span>
        </button>
      </div>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-2xl shadow-xl flex overflow-hidden min-w-[480px]">
          {/* Left: mode selector */}
          <div className="w-40 bg-slate-50 border-r border-slate-100 p-2 flex flex-col gap-0.5">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide px-2 py-1.5">Период</p>
            {QUICK_PRESETS.map((p) => (
              <button
                key={p.mode}
                type="button"
                onClick={() => handleModeClick(p.mode)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  mode === p.mode
                    ? 'bg-brand-100 text-brand-800 font-medium'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Right: detail selector */}
          <div className="flex-1 p-4">
            {/* Year navigation (for month/quarter/year modes) */}
            {(mode === 'month' || mode === 'quarter' || mode === 'year') && (
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={() => handleYearChange(-1)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm font-semibold text-slate-800">{year}</span>
                <button type="button" onClick={() => handleYearChange(1)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
                  <ChevronRight size={16} />
                </button>
              </div>
            )}

            {mode === 'month' && (
              <div className="grid grid-cols-3 gap-1.5">
                {MONTHS.map((m, i) => (
                  <button key={i} type="button" onClick={() => handleMonthClick(i)}
                    className={`py-1.5 rounded-lg text-sm transition-colors ${
                      month === i && begin === getMonthRange(i, year)[0]
                        ? 'bg-brand-600 text-white font-medium'
                        : 'hover:bg-brand-50 text-slate-700'
                    }`}>
                    {m}
                  </button>
                ))}
              </div>
            )}

            {mode === 'quarter' && (
              <div className="grid grid-cols-2 gap-2">
                {[1, 2, 3, 4].map((q) => {
                  const [b] = getQuarterRange(q, year)
                  const active = begin === b
                  return (
                    <button key={q} type="button" onClick={() => handleQuarterClick(q)}
                      className={`py-3 rounded-xl text-sm font-medium transition-colors ${
                        active ? 'bg-brand-600 text-white' : 'border border-slate-200 hover:border-brand-300 hover:bg-brand-50 text-slate-700'
                      }`}>
                      <div className="font-bold">Q{q}</div>
                      <div className="text-xs opacity-70">
                        {MONTHS[QUARTER_MONTHS[q][0]]}–{MONTHS[QUARTER_MONTHS[q][2]]}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {mode === 'year' && (
              <div className="space-y-2">
                <p className="text-sm text-slate-600">Весь {year} год</p>
                <p className="text-xs text-slate-400">
                  {fmt(new Date(year, 0, 1))} — {fmt(new Date(year, 11, 31))}
                </p>
                <button type="button"
                  onClick={() => apply(fmt(new Date(year, 0, 1)), fmt(new Date(year, 11, 31)))}
                  className="btn-primary text-xs px-3 py-1.5">
                  Выбрать {year}
                </button>
              </div>
            )}

            {(mode === 'day' || mode === '3days' || mode === 'week') && (
              <div className="text-sm text-slate-500 py-2">
                <p className="font-medium text-slate-700 mb-1">
                  {mode === 'day' ? 'Сегодня' : mode === '3days' ? 'Последние 3 дня' : 'Последние 7 дней'}
                </p>
                <p className="text-xs text-slate-400">{disp(begin)} — {disp(end)}</p>
              </div>
            )}

            {mode === 'custom' && (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Произвольный период</p>
                <div>
                  <label className="label">С</label>
                  <input type="date" className="input" value={customBegin}
                    onChange={(e) => setCustomBegin(e.target.value)} />
                </div>
                <div>
                  <label className="label">По</label>
                  <input type="date" className="input" value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)} />
                </div>
                <button type="button" onClick={() => apply(customBegin, customEnd)}
                  className="btn-primary w-full justify-center text-sm">
                  Применить
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

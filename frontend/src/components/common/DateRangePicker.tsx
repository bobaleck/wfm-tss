import { useState, useRef, useEffect } from 'react'
import { format, subDays, startOfYear } from 'date-fns'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'

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
  return [fmt(new Date(year, (q - 1) * 3, 1)), fmt(new Date(year, q * 3, 0))]
}
function getMonthRange(month: number, year: number): [string, string] {
  return [fmt(new Date(year, month, 1)), fmt(new Date(year, month + 1, 0))]
}

const QUICK: { label: string; mode: Mode }[] = [
  { label: 'Вчера', mode: 'day' },
  { label: '3 дня', mode: '3days' },
  { label: 'Неделя', mode: 'week' },
]

const DETAIL: { label: string; mode: Mode }[] = [
  { label: 'Месяц', mode: 'month' },
  { label: 'Квартал', mode: 'quarter' },
  { label: 'Год', mode: 'year' },
  { label: 'Другой', mode: 'custom' },
]

export default function DateRangePicker({ begin, end, onChange, className }: Props) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode | null>(null)
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
    setMode(null)
  }

  const handleQuick = (m: Mode) => {
    const now = new Date()
    if (m === 'day') { const y = fmt(subDays(now, 1)); apply(y, y) }
    else if (m === '3days') apply(fmt(subDays(now, 2)), fmt(now))
    else if (m === 'week') apply(fmt(subDays(now, 6)), fmt(now))
  }

  const handleDetailMode = (m: Mode) => {
    setMode(m)
    // Don't apply — user needs to pick a specific period from the right panel
  }

  const handleMonthClick = (m: number) => {
    setMonth(m)
    apply(...getMonthRange(m, year))
  }

  const handleQuarterClick = (q: number) => {
    setQuarter(q)
    apply(...getQuarterRange(q, year))
  }

  const periodDisplay = begin === end ? disp(begin) : `${disp(begin)} — ${disp(end)}`

  const showRightPanel = mode === 'month' || mode === 'quarter' || mode === 'year' || mode === 'custom'

  return (
    <div className={`relative ${className ?? ''}`} ref={ref}>
      <button
        type="button"
        onClick={() => { const willOpen = !open; setOpen(willOpen); if (willOpen) setMode('month') }}
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
          open
            ? 'border-brand-400 bg-brand-50 text-brand-700'
            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
        }`}
      >
        <Calendar size={14} className="text-slate-400 flex-shrink-0" />
        <span className="font-medium">{periodDisplay || 'Выберите период'}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden min-w-[300px]">
          {/* Top row: quick presets */}
          <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-slate-100 bg-slate-50">
            <span className="text-xs text-slate-400 mr-1">Быстро:</span>
            {QUICK.map((p) => (
              <button
                key={p.mode}
                type="button"
                onClick={() => handleQuick(p.mode)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Bottom: left column + right panel */}
          <div className="flex">
            {/* Left: detail mode buttons */}
            <div className="w-36 border-r border-slate-100 p-2 flex flex-col gap-0.5">
              {DETAIL.map((p) => (
                <button
                  key={p.mode}
                  type="button"
                  onClick={() => handleDetailMode(p.mode)}
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
            {showRightPanel && (
              <div className="flex-1 p-4 min-w-[200px]">
                {/* Year navigation */}
                {(mode === 'month' || mode === 'quarter' || mode === 'year') && (
                  <div className="flex items-center justify-between mb-3">
                    <button type="button" onClick={() => setYear(year - 1)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-sm font-semibold text-slate-800">{year}</span>
                    <button type="button" onClick={() => setYear(year + 1)}
                      className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}

                {mode === 'month' && (
                  <div className="grid grid-cols-3 gap-1.5">
                    {MONTHS.map((m, i) => {
                      const active = begin === getMonthRange(i, year)[0]
                      return (
                        <button key={i} type="button" onClick={() => handleMonthClick(i)}
                          className={`py-1.5 rounded-lg text-sm transition-colors ${
                            active ? 'bg-brand-600 text-white font-medium' : 'hover:bg-brand-50 text-slate-700'
                          }`}>
                          {m}
                        </button>
                      )
                    })}
                  </div>
                )}

                {mode === 'quarter' && (
                  <div className="grid grid-cols-2 gap-2">
                    {[1, 2, 3, 4].map((q) => {
                      const active = begin === getQuarterRange(q, year)[0]
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
                      01.01.{year} — 31.12.{year}
                    </p>
                    <button type="button"
                      onClick={() => apply(fmt(new Date(year, 0, 1)), fmt(new Date(year, 11, 31)))}
                      className="btn-primary text-xs px-3 py-1.5 mt-1">
                      Выбрать {year}
                    </button>
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
            )}
          </div>
        </div>
      )}
    </div>
  )
}

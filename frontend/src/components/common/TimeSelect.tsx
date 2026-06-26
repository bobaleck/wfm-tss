import { Clock } from 'lucide-react'

// Современный выбор времени двумя списками (часы/минуты). В отличие от
// нативного <input type="time"> поддерживает 24:00 — это нужно, чтобы можно
// было ставить смену «до полуночи» (конец смены = 24:00 = начало следующих
// суток). Значение — строка 'HH:MM' (включая '24:00') либо '' (не задано).
const HOURS = ['', ...Array.from({ length: 25 }, (_, i) => String(i).padStart(2, '0'))] // '' + 00..24
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))     // 00,05,..55

export default function TimeSelect({ value, onChange, className }: {
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  const [h, m] = value ? value.split(':') : ['', '']
  const isMidnight = h === '24'

  const setHour = (nh: string) => {
    if (nh === '') { onChange(''); return }
    if (nh === '24') { onChange('24:00'); return } // 24:00 — только ровно полночь
    onChange(`${nh}:${m && m !== '00' ? m : '00'}`)
  }
  const setMin = (nm: string) => onChange(`${h || '00'}:${nm}`)

  return (
    <div className={`inline-flex items-center gap-1.5 ${className ?? ''}`}>
      <Clock size={14} className="text-slate-400 flex-shrink-0" />
      <select
        value={h}
        onChange={(e) => setHour(e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 focus:border-brand-400 focus:ring-1 focus:ring-brand-200 outline-none"
      >
        {HOURS.map((hh) => <option key={hh || 'none'} value={hh}>{hh || '—'}</option>)}
      </select>
      <span className="text-slate-400 font-medium">:</span>
      <select
        value={isMidnight ? '00' : m}
        disabled={isMidnight || h === ''}
        onChange={(e) => setMin(e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-700 focus:border-brand-400 focus:ring-1 focus:ring-brand-200 outline-none disabled:bg-slate-50 disabled:text-slate-400"
      >
        {MINUTES.map((mm) => <option key={mm} value={mm}>{mm}</option>)}
      </select>
    </div>
  )
}

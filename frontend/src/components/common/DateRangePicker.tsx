import { format, subDays, startOfYear, startOfQuarter, subQuarters } from 'date-fns'

interface Props {
  begin: string
  end: string
  onChange: (begin: string, end: string) => void
  className?: string
}

const today = () => format(new Date(), 'yyyy-MM-dd')
const daysAgo = (n: number) => format(subDays(new Date(), n), 'yyyy-MM-dd')

const PRESETS = [
  { label: 'Неделя', get: () => [daysAgo(7), today()] },
  { label: 'Месяц', get: () => [daysAgo(30), today()] },
  {
    label: 'Кв.',
    get: () => {
      const s = startOfQuarter(new Date())
      return [format(s, 'yyyy-MM-dd'), today()]
    },
  },
  {
    label: 'Пр. кв.',
    get: () => {
      const s = startOfQuarter(subQuarters(new Date(), 1))
      const e = startOfQuarter(new Date())
      return [format(s, 'yyyy-MM-dd'), format(subDays(e, 1), 'yyyy-MM-dd')]
    },
  },
  {
    label: 'Год',
    get: () => [format(startOfYear(new Date()), 'yyyy-MM-dd'), today()],
  },
] as const

export default function DateRangePicker({ begin, end, onChange, className }: Props) {
  return (
    <div className={`flex flex-wrap items-end gap-3 ${className ?? ''}`}>
      <div>
        <label className="label">С</label>
        <input
          type="date"
          className="input w-40"
          value={begin}
          onChange={(e) => onChange(e.target.value, end)}
        />
      </div>
      <div>
        <label className="label">По</label>
        <input
          type="date"
          className="input w-40"
          value={end}
          onChange={(e) => onChange(begin, e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-1.5 pb-0.5">
        {PRESETS.map((p) => {
          const [b, e] = p.get()
          const active = begin === b && end === e
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(b, e)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                active
                  ? 'border-brand-400 bg-brand-50 text-brand-700'
                  : 'border-slate-200 text-slate-500 hover:border-brand-300 hover:text-brand-600 hover:bg-brand-50'
              }`}
            >
              {p.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

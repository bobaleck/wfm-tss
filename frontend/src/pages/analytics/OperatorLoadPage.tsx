import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import type { OperatorLoadRow } from '@/types'
import PageHeader from '@/components/common/PageHeader'
import StatCard from '@/components/common/StatCard'
import { PageSpinner } from '@/components/ui/Spinner'
import EmptyState from '@/components/common/EmptyState'
import { AlertCircle, UserCheck, ChevronUp, ChevronDown } from 'lucide-react'
import { format, subDays } from 'date-fns'
import DateRangePicker from '@/components/common/DateRangePicker'

type SortKey = 'employee_name' | 'handled_calls' | 'avg_talk_sec' | 'total_talk_sec' | 'idle_sec' | 'avg_answer_sec' | 'sl_percent'

function truncateName(name: string | null, login: string): string {
  if (!name) return login
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return `${parts[0]} ${parts[1][0]}.`
  return name
}

function SortHeader({ label, sortKey, current, dir, onSort }: {
  label: string
  sortKey: SortKey
  current: SortKey
  dir: 'asc' | 'desc'
  onSort: (k: SortKey) => void
}) {
  const active = current === sortKey
  return (
    <th
      className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-slate-700 group"
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}>
          {active && dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </span>
      </span>
    </th>
  )
}

const RANK_COLORS = [
  'bg-amber-400',   // #1
  'bg-slate-400',   // #2
  'bg-orange-400',  // #3
]
const BAR_COLORS = [
  '#f59e0b', // #1 золото
  '#94a3b8', // #2 серебро
  '#f97316', // #3 бронза
  '#3b82f6', // #4-15 синий
]

function OperatorRankChart({ data }: { data: Array<{ name: string; login: string; handled: number }> }) {
  const max = data[0]?.handled || 1
  return (
    <div className="space-y-2">
      {data.map((row, i) => {
        const pct = Math.round((row.handled / max) * 100)
        const barColor = BAR_COLORS[Math.min(i, BAR_COLORS.length - 1)]
        const rankLabel = i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1)
        return (
          <div key={i} className="flex items-center gap-3 group">
            {/* Rank */}
            <span className="w-8 text-center text-sm font-bold text-slate-400 flex-shrink-0 group-hover:text-slate-600 transition-colors">
              {rankLabel}
            </span>
            {/* Name */}
            <span className="w-40 text-sm text-slate-700 truncate flex-shrink-0" title={row.name}>
              {row.name}
            </span>
            {/* Bar */}
            <div className="flex-1 h-7 bg-slate-100 rounded-md overflow-hidden relative">
              <div
                className="h-full rounded-md transition-all duration-500"
                style={{ width: `${pct}%`, backgroundColor: barColor, opacity: 0.85 }}
              />
              {/* Inline label */}
              <span
                className="absolute inset-y-0 left-2 flex items-center text-xs font-semibold"
                style={{ color: pct > 20 ? '#fff' : '#475569' }}
              >
                {pct > 15 ? `${row.handled} зв.` : ''}
              </span>
            </div>
            {/* Value */}
            <span className="w-16 text-right text-sm font-bold flex-shrink-0" style={{ color: barColor }}>
              {row.handled}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function OperatorLoadPage() {
  const { activeProject } = useProjectStore()
  const [begin, setBegin] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'))
  const [end, setEnd] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('handled_calls')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const { data, isLoading } = useQuery({
    queryKey: ['operator-load', activeProject?.customer_uuid, begin, end],
    queryFn: () =>
      api.get('/analytics/operator-load', {
        params: { partner_uuid: activeProject!.customer_uuid, begin, end },
      }).then((r) => r.data.data as OperatorLoadRow[]),
    enabled: !!activeProject,
  })

  if (!activeProject) return (
    <div><PageHeader title="Нагрузка операторов" />
      <div className="card p-8 flex items-center gap-4 bg-amber-50 border-amber-200">
        <AlertCircle size={20} className="text-amber-500" />
        <p className="text-amber-800">Выберите проект в шапке</p>
      </div>
    </div>
  )

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  const baseFiltered = search
    ? (data || []).filter((r) => (r.employee_name || r.login || '').toLowerCase().includes(search.toLowerCase()))
    : (data || [])

  const filtered = [...baseFiltered].sort((a, b) => {
    const av = (a as any)[sortKey] ?? -Infinity
    const bv = (b as any)[sortKey] ?? -Infinity
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
    return sortDir === 'asc' ? cmp : -cmp
  })

  const chartData = [...(data || [])].sort((a, b) => b.handled_calls - a.handled_calls).slice(0, 10)
    .map((r) => ({ name: truncateName(r.employee_name, r.login), login: r.login, handled: r.handled_calls }))

  const totalHandled = (data || []).reduce((s, r) => s + r.handled_calls, 0)
  const avgSL = (data || []).filter((r) => r.sl_percent != null).length
    ? Math.round((data || []).filter((r) => r.sl_percent != null).reduce((s, r) => s + (r.sl_percent || 0), 0) /
        (data || []).filter((r) => r.sl_percent != null).length)
    : null

  return (
    <div>
      <PageHeader title="Нагрузка операторов" subtitle={`Проект: ${activeProject.customer_name}`} />

      <div className="card p-4 mb-6 flex flex-wrap items-end gap-4">
        <DateRangePicker begin={begin} end={end} onChange={(b, e) => { setBegin(b); setEnd(e) }} />
        <div className="flex-1 min-w-48">
          <label className="label">Поиск оператора</label>
          <input className="input" placeholder="Имя или логин..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <StatCard title="Активных операторов" value={data?.length ?? '—'} color="blue" icon={<UserCheck size={20} />} />
        <StatCard title="Всего обработано" value={totalHandled.toLocaleString()} color="green" />
        <StatCard title="Средний SL" value={avgSL !== null ? `${avgSL}%` : '—'} color="purple" />
      </div>

      {/* Chart top 10 */}
      {chartData.length > 0 && (
        <div className="card p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Топ-10 операторов по звонкам</h2>
              <p className="text-xs text-slate-400 mt-0.5">За выбранный период · доля от лидера</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-400">Лидер</p>
              <p className="text-lg font-bold text-amber-500">{chartData[0]?.handled} зв.</p>
            </div>
          </div>
          <OperatorRankChart data={chartData} />
        </div>
      )}

      <div className="card overflow-hidden">
        {isLoading ? <PageSpinner /> : filtered.length === 0 ? (
          <EmptyState title="Нет данных" icon={<UserCheck size={40} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <SortHeader label="Оператор" sortKey="employee_name" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Логин</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Должность</th>
                  <SortHeader label="Звонков" sortKey="handled_calls" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="АНТ (с)" sortKey="avg_talk_sec" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Общ. время разг." sortKey="total_talk_sec" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Простой (мин)" sortKey="idle_sec" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Ср. ответ (с)" sortKey="avg_answer_sec" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="SL (%)" sortKey="sl_percent" current={sortKey} dir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{row.employee_name || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{row.login}</td>
                    <td className="px-4 py-3 text-slate-600">{row.position || '—'}</td>
                    <td className="px-4 py-3 font-semibold text-brand-600">{row.handled_calls}</td>
                    <td className="px-4 py-3 text-slate-600">{row.avg_talk_sec ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.total_talk_sec ? `${Math.round(row.total_talk_sec / 60)} мин` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {row.idle_sec != null && row.idle_sec > 0 ? (
                        <span className={`font-medium ${row.idle_sec / 60 > 60 ? 'text-amber-600' : 'text-slate-600'}`}>
                          {Math.round(row.idle_sec / 60)} мин
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.avg_answer_sec ?? '—'}</td>
                    <td className="px-4 py-3">
                      {row.sl_percent != null ? (
                        <span className={`font-medium ${row.sl_percent >= 80 ? 'text-green-600' : row.sl_percent >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {row.sl_percent}%
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

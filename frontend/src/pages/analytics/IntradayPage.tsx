import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import type { WorkloadRow, Queue } from '@/types'
import PageHeader from '@/components/common/PageHeader'
import StatCard from '@/components/common/StatCard'
import { PageSpinner } from '@/components/ui/Spinner'
import EmptyState from '@/components/common/EmptyState'
import QueueFilterDropdown from '@/components/common/QueueFilterDropdown'
import { AlertCircle, Clock, ChevronUp, ChevronDown } from 'lucide-react'
import { format, subDays } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)
const DOW_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function getHour(period: string): number { return new Date(period).getHours() }
function getDow(period: string): number { return (new Date(period).getDay() + 6) % 7 }

const HEAT_COLORS = ['#f8fafc', '#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8', '#1e3a8a']
function heatColor(value: number, max: number): string {
  if (max === 0) return HEAT_COLORS[0]
  return HEAT_COLORS[Math.min(HEAT_COLORS.length - 1, Math.floor((value / max) * (HEAT_COLORS.length - 1)))]
}

type SortKey = 'hour' | 'avg' | 'avgHandled' | 'avgLost' | 'lostPct'

function SortTh({ label, sortKey, current, dir, onSort }: {
  label: string; sortKey: SortKey; current: SortKey; dir: 'asc' | 'desc'; onSort: (k: SortKey) => void
}) {
  const active = current === sortKey
  return (
    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-slate-700 group"
      onClick={() => onSort(sortKey)}>
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}>
          {active && dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </span>
      </span>
    </th>
  )
}

export default function IntradayPage() {
  const { activeProject } = useProjectStore()
  const [begin, setBegin] = useState(format(subDays(new Date(), 28), 'yyyy-MM-dd'))
  const [end, setEnd] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [view, setView] = useState<'hour' | 'heatmap'>('hour')
  const [selectedQueues, setSelectedQueues] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('hour')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const handleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(k); setSortDir(k === 'hour' ? 'asc' : 'desc') }
  }

  const { data, isLoading } = useQuery({
    queryKey: ['workload-intraday', activeProject?.customer_uuid, begin, end],
    queryFn: () =>
      api.get('/analytics/workload', {
        params: { partner_uuid: activeProject!.customer_uuid, begin, end, interval: 'hour' },
      }).then((r) => r.data.data as WorkloadRow[]),
    enabled: !!activeProject,
  })

  const { data: queuesData } = useQuery({
    queryKey: ['queues', activeProject?.customer_uuid],
    queryFn: () =>
      api.get('/analytics/queues', { params: { partner_uuid: activeProject!.customer_uuid } })
        .then((r) => r.data.data as Queue[]),
    enabled: !!activeProject,
  })

  const allQueues = useMemo(() => (queuesData || []).map((q) => q.name).sort(), [queuesData])

  const filteredData = useMemo(() => {
    if (!data) return []
    if (selectedQueues.size === 0) return data
    return data.filter((r) => selectedQueues.has(r.queue_name))
  }, [data, selectedQueues])

  if (!activeProject) return (
    <div>
      <PageHeader title="Внутридневная нагрузка" />
      <div className="card p-8 flex items-center gap-4 bg-amber-50 border-amber-200">
        <AlertCircle size={20} className="text-amber-500" />
        <p className="text-amber-800">Выберите проект в шапке</p>
      </div>
    </div>
  )

  const byHour: Record<number, { total: number; handled: number; lost: number; days: number }> = {}
  for (let h = 0; h < 24; h++) byHour[h] = { total: 0, handled: 0, lost: 0, days: 0 }

  const heatmap: Record<number, Record<number, number>> = {}
  for (let d = 0; d < 7; d++) { heatmap[d] = {}; for (let h = 0; h < 24; h++) heatmap[d][h] = 0 }

  const seenDayHours = new Set<string>()
  for (const row of filteredData) {
    if (!row.period_start) continue
    const h = getHour(row.period_start)
    const d = getDow(row.period_start)
    const dayKey = row.period_start.slice(0, 10)
    const dhKey = `${dayKey}-${h}`
    if (!seenDayHours.has(dhKey)) { byHour[h].days++; seenDayHours.add(dhKey) }
    byHour[h].total += row.total || 0
    byHour[h].handled += row.handled || 0
    byHour[h].lost += row.lost || 0
    heatmap[d][h] += row.total || 0
  }

  const baseChartData = HOUR_LABELS.map((label, h) => ({
    hour: label,
    h,
    avg: byHour[h].days > 0 ? Math.round(byHour[h].total / byHour[h].days) : 0,
    avgHandled: byHour[h].days > 0 ? Math.round(byHour[h].handled / byHour[h].days) : 0,
    avgLost: byHour[h].days > 0 ? Math.round(byHour[h].lost / byHour[h].days) : 0,
    lostPct: byHour[h].total > 0 ? Math.round((byHour[h].lost / byHour[h].total) * 100) : 0,
  }))

  const peakHour = baseChartData.reduce((best, row) => row.avg > best.avg ? row : best, baseChartData[0])
  const totalCalls = filteredData.reduce((s, r) => s + (r.total || 0), 0)
  const workingHours = baseChartData.filter((r) => r.avg > 0).length
  const heatMax = Math.max(...Object.values(heatmap).flatMap((h) => Object.values(h)))

  const sortedTableData = useMemo(() => {
    return [...baseChartData].filter((r) => r.avg > 0).sort((a, b) => {
      const av = (a as any)[sortKey] ?? 0
      const bv = (b as any)[sortKey] ?? 0
      const cmp = av - bv
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [baseChartData, sortKey, sortDir])

  return (
    <div>
      <PageHeader title="Внутридневная нагрузка" subtitle={`Проект: ${activeProject.customer_name}`} />

      <div className="card p-4 mb-6 flex flex-wrap items-end gap-4">
        <div><label className="label">С</label><input type="date" className="input w-40" value={begin} onChange={(e) => setBegin(e.target.value)} /></div>
        <div><label className="label">По</label><input type="date" className="input w-40" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        <div>
          <label className="label">Отображение</label>
          <select className="input w-44" value={view} onChange={(e) => setView(e.target.value as any)}>
            <option value="hour">По часам</option>
            <option value="heatmap">Тепловая карта</option>
          </select>
        </div>
        {allQueues.length > 1 && (
          <QueueFilterDropdown queues={allQueues} selected={selectedQueues} onChange={setSelectedQueues} />
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <StatCard title="Всего звонков за период" value={totalCalls.toLocaleString()} color="blue" icon={<Clock size={20} />} />
        <StatCard title="Пик нагрузки" value={peakHour?.hour || '—'} sub={peakHour ? `~${peakHour.avg} зв/час` : undefined} color="purple" />
        <StatCard title="Рабочих часов в сутки" value={workingHours} color="green" />
      </div>

      {isLoading ? <PageSpinner /> : !filteredData.length ? (
        <EmptyState title="Нет данных" />
      ) : (
        <>
          {view === 'hour' ? (
            <div className="card p-6 mb-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-1">Среднее количество звонков по часам</h2>
              <p className="text-xs text-slate-400 mb-4">
                Среднее за выбранный период{selectedQueues.size > 0 ? ` · ${selectedQueues.size} ${selectedQueues.size === 1 ? 'очередь' : 'очереди'}` : ' · все очереди'}
              </p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={baseChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(val, name) => [val, name === 'avgHandled' ? 'Обработано' : name === 'avgLost' ? 'Потеряно' : 'Всего']} />
                  <Legend formatter={(v) => v === 'avgHandled' ? 'Обработано' : 'Потеряно'} />
                  <Bar dataKey="avgHandled" name="avgHandled" fill="#2563eb" stackId="a" radius={[0,0,0,0]} />
                  <Bar dataKey="avgLost" name="avgLost" fill="#ef4444" stackId="a" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="card p-6 mb-6 overflow-x-auto">
              <h2 className="text-sm font-semibold text-slate-800 mb-1">Тепловая карта нагрузки</h2>
              <p className="text-xs text-slate-400 mb-4">День недели × Час (суммарные звонки)</p>
              <div className="min-w-[680px]">
                <div className="flex">
                  <div className="w-10 flex-shrink-0" />
                  {HOUR_LABELS.map((h, i) => (
                    <div key={i} className="flex-1 text-center text-xs text-slate-400 pb-1" style={{ minWidth: '28px', fontSize: '10px' }}>
                      {i % 2 === 0 ? h.slice(0, 2) : ''}
                    </div>
                  ))}
                </div>
                {DOW_LABELS.map((day, d) => (
                  <div key={d} className="flex items-center mb-0.5">
                    <div className="w-10 flex-shrink-0 text-xs text-slate-500 font-medium">{day}</div>
                    {HOUR_LABELS.map((_, h) => {
                      const val = heatmap[d][h]
                      return (
                        <div key={h} title={`${day} ${HOUR_LABELS[h]}: ${val} зв.`}
                          className="flex-1 h-7 rounded-sm mx-0.5"
                          style={{ minWidth: '28px', backgroundColor: heatColor(val, heatMax), border: val > 0 ? '1px solid rgba(0,0,0,0.05)' : undefined }}
                        />
                      )
                    })}
                  </div>
                ))}
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-xs text-slate-400">Мало</span>
                  {HEAT_COLORS.map((c, i) => (
                    <div key={i} className="w-6 h-4 rounded-sm border border-slate-200" style={{ backgroundColor: c }} />
                  ))}
                  <span className="text-xs text-slate-400">Много</span>
                </div>
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Статистика по часам</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <SortTh label="Час" sortKey="hour" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortTh label="Ср. звонков" sortKey="avg" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortTh label="Ср. обработано" sortKey="avgHandled" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortTh label="Ср. потеряно" sortKey="avgLost" current={sortKey} dir={sortDir} onSort={handleSort} />
                    <SortTh label="% потерь" sortKey="lostPct" current={sortKey} dir={sortDir} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedTableData.map((row) => (
                    <tr key={row.hour} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-slate-700 font-medium">{row.hour}</td>
                      <td className="px-4 py-2.5 font-semibold text-brand-600">{row.avg}</td>
                      <td className="px-4 py-2.5 text-green-700">{row.avgHandled}</td>
                      <td className="px-4 py-2.5 text-red-600">{row.avgLost}</td>
                      <td className="px-4 py-2.5">
                        <span className={`font-medium ${row.lostPct <= 10 ? 'text-green-600' : row.lostPct <= 20 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {row.lostPct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

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
import DateRangePicker from '@/components/common/DateRangePicker'
import { AlertCircle, TrendingUp } from 'lucide-react'
import { format, subDays } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, Line, ComposedChart,
} from 'recharts'

export default function WorkloadPage() {
  const { activeProject } = useProjectStore()
  const [begin, setBegin] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'))
  const [end, setEnd] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [interval, setIntervalValue] = useState<'hour' | 'day'>('day')
  const [selectedQueues, setSelectedQueues] = useState<Set<string>>(new Set())

  const { data, isLoading } = useQuery({
    queryKey: ['workload', activeProject?.customer_uuid, begin, end, interval],
    queryFn: () =>
      api.get('/analytics/workload', {
        params: { partner_uuid: activeProject!.customer_uuid, begin, end, interval },
      }).then((r) => r.data.data as WorkloadRow[]),
    enabled: !!activeProject,
  })

  // Fetch all queues for the dropdown (not just those with data in range)
  const { data: queuesData } = useQuery({
    queryKey: ['queues', activeProject?.customer_uuid],
    queryFn: () =>
      api.get('/analytics/queues', { params: { partner_uuid: activeProject!.customer_uuid } })
        .then((r) => r.data.data as Queue[]),
    enabled: !!activeProject,
  })

  const allQueues = useMemo(() => {
    const fromQueues = (queuesData || []).map((q) => q.name).filter(Boolean)
    if (fromQueues.length) return fromQueues.sort()
    const fromData = new Set<string>()
    for (const row of data || []) if (row.queue_name) fromData.add(row.queue_name)
    return [...fromData].sort()
  }, [queuesData, data])

  const filteredData = useMemo(() => {
    if (!data) return []
    if (selectedQueues.size === 0) return data
    return data.filter((r) => selectedQueues.has(r.queue_name))
  }, [data, selectedQueues])

  if (!activeProject) return (
    <div>
      <PageHeader title="Нагрузка" />
      <div className="card p-8 flex items-center gap-4 bg-amber-50 border-amber-200">
        <AlertCircle size={20} className="text-amber-500" />
        <p className="text-amber-800">Выберите проект в шапке</p>
      </div>
    </div>
  )

  // Aggregate by period (sum selected queues)
  const byPeriod: Record<string, { period: string; handled: number; lost: number; total: number; slSum: number; slCount: number; ahtSum: number; ahtCount: number }> = {}
  for (const row of filteredData) {
    const period = interval === 'hour'
      ? row.period_start?.slice(0, 13).replace('T', ' ')
      : row.period_start?.slice(0, 10)
    if (!period) continue
    if (!byPeriod[period]) byPeriod[period] = { period, handled: 0, lost: 0, total: 0, slSum: 0, slCount: 0, ahtSum: 0, ahtCount: 0 }
    byPeriod[period].handled += row.handled || 0
    byPeriod[period].lost += row.lost || 0
    byPeriod[period].total += row.total || 0
    if (row.sl_percent != null) { byPeriod[period].slSum += row.sl_percent; byPeriod[period].slCount++ }
    if (row.avg_talk_sec != null) { byPeriod[period].ahtSum += row.avg_talk_sec; byPeriod[period].ahtCount++ }
  }
  const periodRows = Object.values(byPeriod).sort((a, b) => a.period.localeCompare(b.period))
  const chartData = periodRows.map((r) => ({
    ...r,
    sl: r.slCount > 0 ? Math.round(r.slSum / r.slCount) : null,
    aht: r.ahtCount > 0 ? Math.round(r.ahtSum / r.ahtCount) : null,
    lostPct: r.total > 0 ? Math.round((r.lost / r.total) * 100) : 0,
  }))

  const totalCalls = filteredData.reduce((s, r) => s + (r.total || 0), 0)
  const totalHandled = filteredData.reduce((s, r) => s + (r.handled || 0), 0)
  const totalLost = filteredData.reduce((s, r) => s + (r.lost || 0), 0)
  const slRows = filteredData.filter((r) => r.sl_percent != null)
  const avgSL = slRows.length ? Math.round(slRows.reduce((s, r) => s + (r.sl_percent || 0), 0) / slRows.length) : null
  const ahtRows = filteredData.filter((r) => r.avg_talk_sec != null)
  const avgAHT = ahtRows.length ? Math.round(ahtRows.reduce((s, r) => s + (r.avg_talk_sec || 0), 0) / ahtRows.length) : null

  return (
    <div>
      <PageHeader title="Нагрузка" subtitle={`Проект: ${activeProject.customer_name}`} />

      {/* Filters */}
      <div className="card p-4 mb-6 flex flex-wrap items-end gap-4">
        <DateRangePicker begin={begin} end={end} onChange={(b, e) => { setBegin(b); setEnd(e) }} />
        <div>
          <label className="label">Интервал</label>
          <select className="input w-32" value={interval} onChange={(e) => setIntervalValue(e.target.value as any)}>
            <option value="day">По дням</option>
            <option value="hour">По часам</option>
          </select>
        </div>
        {allQueues.length > 1 && (
          <QueueFilterDropdown queues={allQueues} selected={selectedQueues} onChange={setSelectedQueues} />
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="Всего звонков" value={totalCalls.toLocaleString()} color="blue" icon={<TrendingUp size={20} />} />
        <StatCard title="Обработано" value={totalHandled.toLocaleString()} sub={totalCalls ? `${Math.round(totalHandled/totalCalls*100)}%` : undefined} color="green" />
        <StatCard title="Потеряно" value={totalLost.toLocaleString()} sub={totalCalls ? `${Math.round(totalLost/totalCalls*100)}%` : undefined} color="red" />
        <StatCard title="Ср. SL" value={avgSL !== null ? `${avgSL}%` : '—'} sub={avgAHT !== null ? `АНТ: ${avgAHT} с` : undefined} color="purple" />
      </div>

      {/* Chart */}
      <div className="card p-6 mb-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">Нагрузка по периодам</h2>
        <p className="text-xs text-slate-400 mb-4">
          {selectedQueues.size === 0
            ? 'Суммарно по всем очередям проекта'
            : `Очереди: ${[...selectedQueues].join(', ')}`}
        </p>
        {isLoading ? <PageSpinner /> : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
              <Tooltip
                formatter={(val, name) =>
                  name === 'sl' ? [`${val}%`, 'SL'] :
                  name === 'handled' ? [val, 'Обработано'] :
                  name === 'lost' ? [val, 'Потеряно'] : [val, name]
                }
              />
              <Legend formatter={(v) => v === 'handled' ? 'Обработано' : v === 'lost' ? 'Потеряно' : 'SL %'} />
              <Bar yAxisId="left" dataKey="handled" name="handled" fill="#2563eb" stackId="a" radius={[0,0,0,0]} />
              <Bar yAxisId="left" dataKey="lost" name="lost" fill="#ef4444" stackId="a" radius={[3,3,0,0]} />
              <Line yAxisId="right" type="monotone" dataKey="sl" name="sl" stroke="#8b5cf6" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <EmptyState title="Нет данных" />}
      </div>

      {/* Per-queue breakdown (when specific queues selected) */}
      {selectedQueues.size > 0 && !isLoading && (
        <div className="card overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800">Сравнение выбранных очередей</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {['Очередь', 'Всего звонков', 'Обработано', 'Потеряно', '% потерь', 'Ср. AHT (с)', 'Ср. SL (%)'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...selectedQueues].map((qName) => {
                  const qRows = filteredData.filter((r) => r.queue_name === qName)
                  const total = qRows.reduce((s, r) => s + (r.total || 0), 0)
                  const handled = qRows.reduce((s, r) => s + (r.handled || 0), 0)
                  const lost = qRows.reduce((s, r) => s + (r.lost || 0), 0)
                  const slR = qRows.filter((r) => r.sl_percent != null)
                  const sl = slR.length ? Math.round(slR.reduce((s, r) => s + (r.sl_percent || 0), 0) / slR.length) : null
                  const ahtR = qRows.filter((r) => r.avg_talk_sec != null)
                  const aht = ahtR.length ? Math.round(ahtR.reduce((s, r) => s + (r.avg_talk_sec || 0), 0) / ahtR.length) : null
                  const lostPct = total > 0 ? Math.round(lost / total * 100) : 0
                  return (
                    <tr key={qName} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{qName}</td>
                      <td className="px-4 py-2.5 font-semibold">{total.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-green-700">{handled.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-red-600">{lost.toLocaleString()}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-xs font-medium ${lostPct <= 5 ? 'text-green-600' : lostPct <= 15 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {lostPct}%
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{aht ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        {sl != null ? (
                          <span className={`font-medium ${sl >= 80 ? 'text-green-600' : sl >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                            {sl}%
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Period summary table */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-800">Сводка по периодам</h2>
        </div>
        {isLoading ? <PageSpinner /> : chartData.length === 0 ? (
          <EmptyState title="Нет данных за период" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {['Период', 'Поступило', 'Обработано', '% обр.', 'Потеряно', '% пот.', 'Ср. АНТ (с)', 'SL (%)'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chartData.map((row, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-700 whitespace-nowrap">{row.period}</td>
                    <td className="px-4 py-2.5 font-semibold text-slate-800">{row.total.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-green-700">{row.handled.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs">
                      {row.total > 0 ? `${Math.round(row.handled/row.total*100)}%` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-red-600">{row.lost.toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-medium ${row.lostPct <= 5 ? 'text-green-600' : row.lostPct <= 15 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {row.total > 0 ? `${row.lostPct}%` : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{row.aht ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      {row.sl != null ? (
                        <span className={`font-medium ${row.sl >= 80 ? 'text-green-600' : row.sl >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {row.sl}%
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

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import type { Queue, WorkloadRow } from '@/types'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/common/EmptyState'
import QueueFilterDropdown from '@/components/common/QueueFilterDropdown'
import { PhoneCall, AlertCircle, ChevronUp, ChevronDown } from 'lucide-react'
import { slColor } from '@/utils/sl'
import { format, subDays } from 'date-fns'
import DateRangePicker from '@/components/common/DateRangePicker'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'

const CHANNEL_LABELS: Record<string, string> = {
  VOICE: 'Голос', CHAT: 'Чат', EMAIL: 'Email', VIDEO: 'Видео',
}

// Палитра для линий очередей на графике динамики
const QUEUE_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#0d9488', '#9333ea', '#ca8a04']
const METRIC_LABELS: Record<'total' | 'handled' | 'lost', string> = {
  total: 'Поступило', handled: 'Обработано', lost: 'Потеряно',
}

type QueueSortKey = 'name' | 'channel' | 'target_sl' | 'answer_sec' | 'status'
type PeriodSortKey = 'period' | 'queue_name' | 'total' | 'handled' | 'lost' | 'avg_talk_sec' | 'sl_percent'

function SortTh<K extends string>({
  label, sortKey, current, dir, onSort, className = '',
}: { label: string; sortKey: K; current: K; dir: 'asc' | 'desc'; onSort: (k: K) => void; className?: string }) {
  const active = current === sortKey
  return (
    <th
      className={`text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-slate-700 group ${className}`}
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

export default function QueuesPage() {
  const { activeProject } = useProjectStore()
  const [begin, setBegin] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'))
  const [end, setEnd] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [selectedQueues, setSelectedQueues] = useState<Set<string>>(new Set())
  const [interval, setIntervalValue] = useState<'hour' | 'day'>('day')
  const [metric, setMetric] = useState<'total' | 'handled' | 'lost'>('total')

  const [queueSort, setQueueSort] = useState<QueueSortKey>('name')
  const [queueDir, setQueueDir] = useState<'asc' | 'desc'>('asc')
  const [periodSort, setPeriodSort] = useState<PeriodSortKey>('period')
  const [periodDir, setPeriodDir] = useState<'asc' | 'desc'>('asc')

  const handleQueueSort = (k: QueueSortKey) => {
    if (queueSort === k) setQueueDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setQueueSort(k); setQueueDir('asc') }
  }
  const handlePeriodSort = (k: PeriodSortKey) => {
    if (periodSort === k) setPeriodDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setPeriodSort(k); setPeriodDir('asc') }
  }

  const { data: queues, isLoading: queuesLoading } = useQuery({
    queryKey: ['queues', activeProject?.customer_uuid],
    queryFn: () =>
      api.get('/analytics/queues', { params: { partner_uuid: activeProject!.customer_uuid } })
        .then((r) => r.data.data as Queue[]),
    enabled: !!activeProject,
  })

  const { data: workload, isLoading: workloadLoading, isFetching: workloadFetching } = useQuery({
    queryKey: ['queues-workload', activeProject?.customer_uuid, begin, end, interval],
    queryFn: () =>
      api.get('/analytics/workload', {
        params: { partner_uuid: activeProject!.customer_uuid, begin, end, interval },
      }).then((r) => r.data.data as WorkloadRow[]),
    enabled: !!activeProject,
  })

  const allQueueNames = useMemo(() => (queues || []).map((q) => q.name).sort(), [queues])

  const sortedQueues = useMemo(() => {
    return [...(queues || [])].sort((a, b) => {
      const av = (a as any)[queueSort] ?? ''
      const bv = (b as any)[queueSort] ?? ''
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return queueDir === 'asc' ? cmp : -cmp
    })
  }, [queues, queueSort, queueDir])

  // Очереди для графиков: выбранные фильтром, либо все (если ничего не выбрано).
  const shownQueues = useMemo(
    () => (selectedQueues.size ? allQueueNames.filter((n) => selectedQueues.has(n)) : allQueueNames),
    [selectedQueues, allQueueNames],
  )

  // Динамика по периодам: для каждой выбранной очереди — своя серия + суммарная.
  const timeSeries = useMemo(() => {
    const shown = new Set(shownQueues)
    const byPeriod: Record<string, any> = {}
    for (const r of workload || []) {
      if (!shown.has(r.queue_name)) continue
      const p = (r.period_start || '').slice(0, interval === 'hour' ? 16 : 10).replace('T', ' ')
      if (!p) continue
      if (!byPeriod[p]) byPeriod[p] = { period: p, __total: 0 }
      const v = (r as any)[metric] || 0
      byPeriod[p][r.queue_name] = (byPeriod[p][r.queue_name] || 0) + v
      byPeriod[p].__total += v
    }
    return Object.values(byPeriod).sort((a: any, b: any) => (a.period < b.period ? -1 : 1))
  }, [workload, shownQueues, interval, metric])

  // ВАЖНО: эти хуки должны идти ДО раннего return по !activeProject ниже —
  // иначе при переходе activeProject null→объект меняется число вызванных хуков
  // и React падает с "Rendered more hooks than during the previous render".
  const queueTargetSl = useMemo(() => {
    const map: Record<string, number | null> = {}
    for (const q of queues || []) map[q.name] = q.target_sl ?? null
    return map
  }, [queues])

  const wFiltered = useMemo(() => {
    const base = workload || []
    return selectedQueues.size === 0 ? base : base.filter((r) => selectedQueues.has(r.queue_name))
  }, [workload, selectedQueues])

  const sortedPeriod = useMemo(() => {
    return [...wFiltered].sort((a, b) => {
      const av = (a as any)[periodSort] ?? ''
      const bv = (b as any)[periodSort] ?? ''
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return periodDir === 'asc' ? cmp : -cmp
    })
  }, [wFiltered, periodSort, periodDir])

  if (!activeProject) return (
    <div>
      <PageHeader title="Очереди" />
      <div className="card p-8 flex items-center gap-4 bg-amber-50 border-amber-200">
        <AlertCircle size={20} className="text-amber-500" />
        <p className="text-amber-800">Выберите проект в шапке страницы</p>
      </div>
    </div>
  )

  // ─── Aggregate stats per queue ────────────────────────────────────────────────
  const perQueue: Record<string, { name: string; total: number; handled: number; lost: number; slSum: number; slCount: number }> = {}
  for (const r of workload || []) {
    const q = r.queue_name || '—'
    if (!perQueue[q]) perQueue[q] = { name: q, total: 0, handled: 0, lost: 0, slSum: 0, slCount: 0 }
    perQueue[q].total += r.total || 0
    perQueue[q].handled += r.handled || 0
    perQueue[q].lost += r.lost || 0
    if (r.sl_percent != null) { perQueue[q].slSum += r.sl_percent; perQueue[q].slCount++ }
  }
  const shownSet = new Set(shownQueues)
  const chartData = Object.values(perQueue)
    .filter((d) => shownSet.has(d.name))
    .map((d) => ({ ...d, sl: d.slCount > 0 ? Math.round(d.slSum / d.slCount) : null, target_sl: queueTargetSl[d.name] }))
    .sort((a, b) => b.total - a.total)


  return (
    <div>
      <PageHeader
        title="Очереди"
        subtitle={`Проект: ${activeProject.customer_name} · ${queues?.length ?? '...'} очередей`}
      />

      {/* Список очередей */}
      {queuesLoading ? <PageSpinner /> : !(queues?.length) ? (
        <EmptyState title="Нет активных очередей" icon={<PhoneCall size={40} />} />
      ) : (
        <>
          <div className="card overflow-hidden mb-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <SortTh label="Очередь" sortKey="name" current={queueSort} dir={queueDir} onSort={handleQueueSort} />
                  <SortTh label="Канал" sortKey="channel" current={queueSort} dir={queueDir} onSort={handleQueueSort} />
                  <SortTh label="Целевой SL (%)" sortKey="target_sl" current={queueSort} dir={queueDir} onSort={handleQueueSort} />
                  <SortTh label="Порог ответа (с)" sortKey="answer_sec" current={queueSort} dir={queueDir} onSort={handleQueueSort} />
                  <SortTh label="Статус" sortKey="status" current={queueSort} dir={queueDir} onSort={handleQueueSort} />
                </tr>
              </thead>
              <tbody>
                {sortedQueues.map((q) => (
                  <tr key={q.queue_uuid} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{q.name}</td>
                    <td className="px-4 py-3"><Badge label={CHANNEL_LABELS[q.channel] || q.channel || '—'} color="blue" /></td>
                    <td className="px-4 py-3 text-slate-700">{q.target_sl != null ? `${q.target_sl}%` : '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{q.answer_sec != null ? `${q.answer_sec} с` : '—'}</td>
                    <td className="px-4 py-3"><Badge label={q.status} color="green" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Divider */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-px bg-slate-200" />
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Статистика за период</p>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

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
        {allQueueNames.length > 1 && (
          <QueueFilterDropdown queues={allQueueNames} selected={selectedQueues} onChange={setSelectedQueues} />
        )}
      </div>

      {workloadLoading || workloadFetching ? <PageSpinner /> : !chartData.length ? (
        <EmptyState title="Нет данных за период" icon={<PhoneCall size={40} />} />
      ) : (
        <>
          {/* Динамика по очередям + суммарная линия */}
          <div className="card p-6 mb-6">
            <div className="flex items-start justify-between mb-1 gap-4 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Динамика по очередям</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {METRIC_LABELS[metric]} по каждой {selectedQueues.size > 0 ? 'выбранной ' : ''}очереди и суммарно ·{' '}
                  {interval === 'hour' ? 'по часам' : 'по дням'}
                </p>
              </div>
              <div className="flex rounded-lg overflow-hidden border border-slate-200">
                {(['total', 'handled', 'lost'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMetric(m)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      metric === m ? 'bg-brand-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {METRIC_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={timeSeries} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend formatter={(v) => (v === '__total' ? 'Суммарно' : v)} />
                {shownQueues.map((q, i) => (
                  <Line key={q} type="monotone" dataKey={q} stroke={QUEUE_COLORS[i % QUEUE_COLORS.length]}
                    strokeWidth={1.5} dot={false} connectNulls />
                ))}
                {shownQueues.length > 1 && (
                  <Line type="monotone" dataKey="__total" name="__total" stroke="#0f172a"
                    strokeWidth={2.5} dot={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Queue comparison chart */}
          <div className="card p-6 mb-6">
            <h2 className="text-sm font-semibold text-slate-800 mb-1">Сравнение очередей за период</h2>
            <p className="text-xs text-slate-400 mb-4">Обработанные и потерянные вызовы по каждой очереди</p>
            <ResponsiveContainer width="100%" height={Math.max(180, chartData.length * 38)}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 10 }} />
                <Tooltip
                  formatter={(val, name) => [
                    (val as number).toLocaleString(),
                    name === 'handled' ? 'Обработано' : 'Потеряно',
                  ]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend formatter={(v) => v === 'handled' ? 'Обработано' : 'Потеряно'} />
                <Bar dataKey="handled" name="handled" fill="#2563eb" stackId="a" radius={[0, 0, 0, 0]} />
                <Bar dataKey="lost" name="lost" fill="#ef4444" stackId="a" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>

            <div className="mt-4 flex flex-wrap gap-3">
              {chartData.filter((d) => d.sl !== null).map((d) => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs">
                  <span className="text-slate-500 truncate max-w-32">{d.name}</span>
                  <span className={`font-semibold ${slColor(d.sl, d.target_sl)}`}>
                    SL {d.sl}%{d.target_sl != null ? ` / цель ${d.target_sl}%` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Period table */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">Детализация по периодам</h2>
              {selectedQueues.size > 0 && (
                <span className="text-xs text-brand-600 font-medium">
                  Очередей: {selectedQueues.size}
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <SortTh label="Период" sortKey="period" current={periodSort} dir={periodDir} onSort={handlePeriodSort} />
                    <SortTh label="Очередь" sortKey="queue_name" current={periodSort} dir={periodDir} onSort={handlePeriodSort} />
                    <SortTh label="Поступило" sortKey="total" current={periodSort} dir={periodDir} onSort={handlePeriodSort} />
                    <SortTh label="Обработано" sortKey="handled" current={periodSort} dir={periodDir} onSort={handlePeriodSort} />
                    <SortTh label="Потеряно" sortKey="lost" current={periodSort} dir={periodDir} onSort={handlePeriodSort} />
                    <SortTh label="АНТ (с)" sortKey="avg_talk_sec" current={periodSort} dir={periodDir} onSort={handlePeriodSort} />
                    <SortTh label="SL (%)" sortKey="sl_percent" current={periodSort} dir={periodDir} onSort={handlePeriodSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedPeriod.slice(0, 400).map((row, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-600 whitespace-nowrap">
                        {row.period_start?.slice(0, interval === 'hour' ? 16 : 10).replace('T', ' ')}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{row.queue_name}</td>
                      <td className="px-4 py-2.5 text-slate-700">{row.total}</td>
                      <td className="px-4 py-2.5 text-green-700">{row.handled}</td>
                      <td className="px-4 py-2.5 text-red-600">{row.lost}</td>
                      <td className="px-4 py-2.5 text-slate-600">{row.avg_talk_sec ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        {row.sl_percent != null ? (
                          <span className={`font-medium ${slColor(row.sl_percent, queueTargetSl[row.queue_name])}`}>
                            {row.sl_percent}%
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                  {sortedPeriod.length > 400 && (
                    <tr><td colSpan={7} className="text-center py-3 text-slate-400 text-xs">Показано 400 из {sortedPeriod.length} строк</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

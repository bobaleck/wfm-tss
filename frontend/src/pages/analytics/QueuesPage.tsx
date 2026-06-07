import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import type { Queue, WorkloadRow } from '@/types'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/common/EmptyState'
import { PhoneCall, AlertCircle } from 'lucide-react'
import { format, subDays } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'

const CHANNEL_LABELS: Record<string, string> = {
  VOICE: 'Голос', CHAT: 'Чат', EMAIL: 'Email', VIDEO: 'Видео',
}

export default function QueuesPage() {
  const { activeProject } = useProjectStore()
  const [begin, setBegin] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'))
  const [end, setEnd] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [selectedQueue, setSelectedQueue] = useState('')
  const [interval, setInterval] = useState<'hour' | 'day'>('day')

  const { data: queues, isLoading: queuesLoading } = useQuery({
    queryKey: ['queues', activeProject?.customer_uuid],
    queryFn: () =>
      api.get('/analytics/queues', { params: { partner_uuid: activeProject!.customer_uuid } })
        .then((r) => r.data.data as Queue[]),
    enabled: !!activeProject,
  })

  const { data: workload, isLoading: workloadLoading } = useQuery({
    queryKey: ['queues-workload', activeProject?.customer_uuid, begin, end, interval],
    queryFn: () =>
      api.get('/analytics/workload', {
        params: { partner_uuid: activeProject!.customer_uuid, begin, end, interval },
      }).then((r) => r.data.data as WorkloadRow[]),
    enabled: !!activeProject,
  })

  if (!activeProject) return (
    <div>
      <PageHeader title="Очереди" />
      <div className="card p-8 flex items-center gap-4 bg-amber-50 border-amber-200">
        <AlertCircle size={20} className="text-amber-500" />
        <p className="text-amber-800">Выберите проект в шапке страницы</p>
      </div>
    </div>
  )

  // ─── Агрегаты по очередям для графика ────────────────────────────────────
  const perQueue: Record<string, { name: string; total: number; handled: number; lost: number; slSum: number; slCount: number }> = {}
  for (const r of workload || []) {
    const q = r.queue_name || '—'
    if (!perQueue[q]) perQueue[q] = { name: q, total: 0, handled: 0, lost: 0, slSum: 0, slCount: 0 }
    perQueue[q].total += r.total || 0
    perQueue[q].handled += r.handled || 0
    perQueue[q].lost += r.lost || 0
    if (r.sl_percent != null) { perQueue[q].slSum += r.sl_percent; perQueue[q].slCount++ }
  }
  const chartData = Object.values(perQueue)
    .map((d) => ({ ...d, sl: d.slCount > 0 ? Math.round(d.slSum / d.slCount) : null }))
    .sort((a, b) => b.total - a.total)

  const wQueues = chartData.map((d) => d.name)
  const wFiltered = selectedQueue
    ? (workload || []).filter((r) => r.queue_name === selectedQueue)
    : (workload || [])

  const channels = [...new Set((queues || []).map((q) => q.channel))].filter(Boolean)

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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            {channels.map((ch) => (
              <div key={ch} className="card p-4">
                <p className="text-2xl font-bold text-slate-900">{(queues || []).filter((q) => q.channel === ch).length}</p>
                <p className="text-sm text-slate-500 mt-0.5">{CHANNEL_LABELS[ch] || ch}</p>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden mb-8">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {['Очередь', 'Канал', 'Целевой SL (%)', 'Порог ответа (с)', 'Статус'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {queues!.map((q) => (
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

      {/* Разделитель */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 h-px bg-slate-200" />
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Статистика за период</p>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      {/* Фильтры */}
      <div className="card p-4 mb-6 flex flex-wrap items-end gap-4">
        <div><label className="label">С</label><input type="date" className="input w-40" value={begin} onChange={(e) => setBegin(e.target.value)} /></div>
        <div><label className="label">По</label><input type="date" className="input w-40" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        <div>
          <label className="label">Интервал</label>
          <select className="input w-32" value={interval} onChange={(e) => setInterval(e.target.value as any)}>
            <option value="day">По дням</option>
            <option value="hour">По часам</option>
          </select>
        </div>
        <div>
          <label className="label">Очередь</label>
          <select className="input w-60" value={selectedQueue} onChange={(e) => setSelectedQueue(e.target.value)}>
            <option value="">Все очереди</option>
            {wQueues.map((q) => <option key={q} value={q}>{q}</option>)}
          </select>
        </div>
      </div>

      {workloadLoading ? <PageSpinner /> : !chartData.length ? (
        <EmptyState title="Нет данных за период" icon={<PhoneCall size={40} />} />
      ) : (
        <>
          {/* График: обработано/потеряно по очередям */}
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

            {/* SL по очередям */}
            <div className="mt-4 flex flex-wrap gap-3">
              {chartData.filter((d) => d.sl !== null).map((d) => (
                <div key={d.name} className="flex items-center gap-1.5 text-xs">
                  <span className="text-slate-500 truncate max-w-32">{d.name}</span>
                  <span className={`font-semibold ${d.sl! >= 80 ? 'text-green-600' : d.sl! >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                    SL {d.sl}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Детализация по периодам */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Детализация по периодам</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    {['Период', 'Очередь', 'Поступило', 'Обработано', 'Потеряно', 'АНТ (с)', 'SL (%)'].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {wFiltered.slice(0, 300).map((row, i) => (
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
                          <span className={`font-medium ${row.sl_percent >= 80 ? 'text-green-600' : row.sl_percent >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                            {row.sl_percent}%
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                  {wFiltered.length > 300 && (
                    <tr><td colSpan={7} className="text-center py-3 text-slate-400 text-xs">Показано 300 из {wFiltered.length} строк</td></tr>
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

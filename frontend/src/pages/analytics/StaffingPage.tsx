import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import type { WorkloadRow } from '@/types'
import PageHeader from '@/components/common/PageHeader'
import StatCard from '@/components/common/StatCard'
import { PageSpinner } from '@/components/ui/Spinner'
import EmptyState from '@/components/common/EmptyState'
import { AlertCircle, Users, Info } from 'lucide-react'
import { format, subDays } from 'date-fns'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, ReferenceLine } from 'recharts'

// ─── Erlang C implementation ────────────────────────────────────────────────
function erlangC(N: number, A: number): number {
  if (N <= A) return 1
  let sum = 0
  let term = 1
  for (let k = 1; k <= N - 1; k++) {
    term *= A / k
    sum += term
  }
  const lastTerm = (Math.pow(A, N) / factorial(N)) * (N / (N - A))
  return lastTerm / (sum + 1 + lastTerm)
}

function factorial(n: number): number {
  let result = 1
  for (let i = 2; i <= n; i++) result *= i
  return result
}

function serviceLevel(N: number, A: number, aht: number, targetSec: number): number {
  if (N <= A) return 0
  const ec = erlangC(N, A)
  return 1 - ec * Math.exp(-(N - A) * (targetSec / aht))
}

function requiredAgents(callsPerHour: number, ahtSec: number, targetSl: number, targetSec: number): number {
  if (callsPerHour === 0) return 0
  const A = (callsPerHour / 3600) * ahtSec
  let N = Math.ceil(A) + 1
  while (N < 500) {
    if (serviceLevel(N, A, ahtSec, targetSec) >= targetSl / 100) break
    N++
  }
  return N
}

function getHour(period: string): number {
  return new Date(period).getHours()
}

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)

export default function StaffingPage() {
  const { activeProject } = useProjectStore()
  const [begin, setBegin] = useState(format(subDays(new Date(), 28), 'yyyy-MM-dd'))
  const [end, setEnd] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [targetSl, setTargetSl] = useState(80)
  const [targetSec, setTargetSec] = useState(20)
  const [shrinkage, setShrinkage] = useState(30)

  const { data, isLoading } = useQuery({
    queryKey: ['workload-staffing', activeProject?.customer_uuid, begin, end],
    queryFn: () =>
      api.get('/analytics/workload', {
        params: { partner_uuid: activeProject!.customer_uuid, begin, end, interval: 'hour' },
      }).then((r) => r.data.data as WorkloadRow[]),
    enabled: !!activeProject,
  })

  const staffingData = useMemo(() => {
    if (!data?.length) return []

    const byHour: Record<number, { total: number; ahtSum: number; ahtCount: number; days: number }> = {}
    for (let h = 0; h < 24; h++) byHour[h] = { total: 0, ahtSum: 0, ahtCount: 0, days: 0 }

    const seenDayHours = new Set<string>()
    for (const row of data) {
      if (!row.period_start) continue
      const h = getHour(row.period_start)
      const dayKey = row.period_start.slice(0, 10) + '-' + h
      if (!seenDayHours.has(dayKey)) { byHour[h].days++; seenDayHours.add(dayKey) }
      byHour[h].total += row.total || 0
      if (row.avg_talk_sec) { byHour[h].ahtSum += row.avg_talk_sec; byHour[h].ahtCount++ }
    }

    return HOUR_LABELS.map((label, h) => {
      const d = byHour[h]
      const avgCalls = d.days > 0 ? d.total / d.days : 0
      const avgAht = d.ahtCount > 0 ? d.ahtSum / d.ahtCount : 180
      const needed = requiredAgents(avgCalls, avgAht, targetSl, targetSec)
      const withShrinkage = needed > 0 ? Math.ceil(needed / (1 - shrinkage / 100)) : 0
      return {
        hour: label,
        avgCalls: Math.round(avgCalls),
        avgAht: Math.round(avgAht),
        needed,
        withShrinkage,
      }
    }).filter((r) => r.avgCalls > 0)
  }, [data, targetSl, targetSec, shrinkage])

  const peakNeeded = staffingData.length ? Math.max(...staffingData.map((r) => r.withShrinkage)) : 0
  const peakRow = staffingData.find((r) => r.withShrinkage === peakNeeded)
  const avgNeeded = staffingData.length
    ? Math.round(staffingData.reduce((s, r) => s + r.withShrinkage, 0) / staffingData.length)
    : 0

  if (!activeProject) return (
    <div>
      <PageHeader title="Потребность в операторах" />
      <div className="card p-8 flex items-center gap-4 bg-amber-50 border-amber-200">
        <AlertCircle size={20} className="text-amber-500" />
        <p className="text-amber-800">Выберите проект в шапке</p>
      </div>
    </div>
  )

  return (
    <div>
      <PageHeader title="Потребность в операторах" subtitle={`Проект: ${activeProject.customer_name} · Расчёт по алгоритму Erlang C`} />

      {/* Parameters */}
      <div className="card p-5 mb-6">
        <div className="flex flex-wrap items-end gap-5">
          <div>
            <label className="label">Период (исторические данные)</label>
            <div className="flex items-center gap-2">
              <input type="date" className="input w-40" value={begin} onChange={(e) => setBegin(e.target.value)} />
              <span className="text-slate-400">—</span>
              <input type="date" className="input w-40" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label">Целевой SL (%)</label>
            <input type="number" className="input w-24" min={50} max={99} value={targetSl}
              onChange={(e) => setTargetSl(+e.target.value)} />
          </div>
          <div>
            <label className="label">Порог ответа (сек)</label>
            <input type="number" className="input w-24" min={5} max={120} value={targetSec}
              onChange={(e) => setTargetSec(+e.target.value)} />
          </div>
          <div>
            <label className="label">
              Shrinkage (%) <span className="text-slate-400 font-normal">— отсутствия, обучение</span>
            </label>
            <input type="number" className="input w-24" min={0} max={60} value={shrinkage}
              onChange={(e) => setShrinkage(+e.target.value)} />
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 bg-blue-50 rounded-lg px-3 py-2">
          <Info size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-blue-700">
            Расчёт: по средним звонкам/час и среднему AHT за период → минимум операторов для достижения SL {targetSl}% за {targetSec} сек → делится на (1 − shrinkage/100) для учёта реальной доступности.
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <StatCard title="Пиковая потребность" value={peakNeeded ? `${peakNeeded} чел.` : '—'}
          sub={peakRow ? `в ${peakRow.hour}` : undefined} color="purple" icon={<Users size={20} />} />
        <StatCard title="Средняя потребность" value={avgNeeded ? `${avgNeeded} чел.` : '—'} color="blue" />
        <StatCard title="Параметры SL" value={`${targetSl}% / ${targetSec}с`}
          sub={`Shrinkage: ${shrinkage}%`} color="green" />
      </div>

      {isLoading ? <PageSpinner /> : !staffingData.length ? (
        <EmptyState title="Нет данных" description="Загрузите данные или настройте интеграцию с Naumen" />
      ) : (
        <>
          {/* Chart */}
          <div className="card p-6 mb-6">
            <h2 className="text-sm font-semibold text-slate-800 mb-1">Потребность в операторах по часам</h2>
            <p className="text-xs text-slate-400 mb-4">С учётом shrinkage {shrinkage}%</p>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={staffingData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(val, name) => [
                    val,
                    name === 'withShrinkage' ? 'С учётом shrinkage' :
                    name === 'needed' ? 'Минимум операторов' : 'Ср. звонков/час'
                  ]}
                />
                <Legend formatter={(v) => v === 'withShrinkage' ? 'Требуется (со shrinkage)' : v === 'needed' ? 'Минимум' : 'Ср. звонков/час'} />
                <Line yAxisId="right" type="monotone" dataKey="avgCalls" name="avgCalls" stroke="#94a3b8" strokeDasharray="4 2" dot={false} />
                <Line yAxisId="left" type="monotone" dataKey="needed" name="needed" stroke="#93c5fd" strokeWidth={1.5} dot={false} />
                <Line yAxisId="left" type="monotone" dataKey="withShrinkage" name="withShrinkage" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Table */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Детализация по часам</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    {['Час', 'Ср. звонков', 'Ср. AHT (с)', 'Мин. операторов', `С учётом shrinkage (${shrinkage}%)`].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staffingData.map((row) => (
                    <tr key={row.hour} className={`border-b border-slate-50 hover:bg-slate-50 ${row.withShrinkage === peakNeeded ? 'bg-purple-50' : ''}`}>
                      <td className="px-4 py-2.5 font-mono font-medium text-slate-700">{row.hour}</td>
                      <td className="px-4 py-2.5 text-slate-600">{row.avgCalls}</td>
                      <td className="px-4 py-2.5 text-slate-600">{row.avgAht}</td>
                      <td className="px-4 py-2.5 text-blue-700 font-medium">{row.needed}</td>
                      <td className="px-4 py-2.5">
                        <span className={`font-bold text-base ${row.withShrinkage === peakNeeded ? 'text-purple-700' : 'text-slate-900'}`}>
                          {row.withShrinkage}
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

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import type { WorkloadRow, Queue } from '@/types'
import PageHeader from '@/components/common/PageHeader'
import StatCard from '@/components/common/StatCard'
import { PageSpinner } from '@/components/ui/Spinner'
import EmptyState from '@/components/common/EmptyState'
import QueueFilterDropdown from '@/components/common/QueueFilterDropdown'
import DateRangePicker from '@/components/common/DateRangePicker'
import { AlertCircle, Users, Info, TrendingUp, Loader2, Upload, FileSpreadsheet } from 'lucide-react'
import { format, subDays, addDays } from 'date-fns'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { requiredAgents } from '@/utils/erlang'
function getHour(period: string): number { return new Date(period).getHours() }
function isWeekend(period: string): boolean {
  const d = new Date(period).getDay(); return d === 0 || d === 6
}

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)
type DayFilter = 'all' | 'weekday' | 'weekend'

// ─── Вкладка «От заказчика»: потребность грузится из Excel и хранится в БД ────
interface DemandRow { demand_date: string; hour: number; required: number }

function CustomerDemandView() {
  const { activeProject } = useProjectStore()
  const qc = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [selDate, setSelDate] = useState('')

  const { data: demand } = useQuery({
    queryKey: ['customer-demand', activeProject?.customer_uuid],
    queryFn: () => api.get('/analytics/customer-demand', { params: { partner_uuid: activeProject!.customer_uuid } }).then((r) => r.data.data as DemandRow[]),
    enabled: !!activeProject,
  })

  const dates = useMemo(() => [...new Set((demand || []).map((d) => d.demand_date))].sort(), [demand])
  useEffect(() => { if (dates.length && !dates.includes(selDate)) setSelDate(dates[0]) }, [dates, selDate])

  const { data: actual } = useQuery({
    queryKey: ['actual-by-date', activeProject?.customer_uuid, selDate],
    queryFn: () => api.get('/analytics/actual-operators-by-queue', { params: { partner_uuid: activeProject!.customer_uuid, begin: selDate, end: selDate } }).then((r) => r.data.data as Array<{ hour_num: number; avg_operators: number }>),
    enabled: !!activeProject && !!selDate,
  })
  const actualByHour = useMemo(() => {
    const m: Record<number, number> = {}
    for (const r of actual || []) m[r.hour_num] = r.avg_operators
    return m
  }, [actual])

  const handleUpload = async (file: File) => {
    setUploading(true); setMsg(null)
    try {
      const fd = new FormData(); fd.append('file', file)
      const r = await api.post(`/analytics/customer-demand/upload?partner_uuid=${activeProject!.customer_uuid}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setMsg(`Загружено: ${r.data.days} дней (${r.data.date_from} – ${r.data.date_to}), строк: ${r.data.rows}`)
      qc.invalidateQueries({ queryKey: ['customer-demand'] })
    } catch (e: any) {
      setMsg('Ошибка: ' + (e.response?.data?.detail || e.message))
    } finally { setUploading(false) }
  }

  const rows = HOUR_LABELS.map((label, h) => ({
    hour: label,
    required: (demand || []).find((d) => d.demand_date === selDate && d.hour === h)?.required ?? 0,
    actual: actualByHour[h] ?? null,
  }))
  const peak = rows.reduce((m, r) => Math.max(m, r.required), 0)
  const totalReq = rows.reduce((s, r) => s + r.required, 0)

  return (
    <div>
      <div className="card p-5 mb-6 flex flex-wrap items-center gap-4">
        <label className="btn-primary cursor-pointer">
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Загрузить Excel
          <input type="file" accept=".xlsx,.xls" className="hidden" disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = '' }} />
        </label>
        <button
          type="button"
          className="btn-secondary"
          onClick={async () => {
            const res = await api.get('/analytics/customer-demand/template.xlsx', { responseType: 'blob' })
            const url = URL.createObjectURL(res.data as Blob)
            const a = document.createElement('a')
            a.href = url; a.download = 'Шаблон_потребности.xlsx'; a.click(); URL.revokeObjectURL(url)
          }}
        >
          <FileSpreadsheet size={15} /> Скачать шаблон
        </button>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          Заполните шаблон (даты × часы) и загрузите — потребность сохранится по проекту.
        </div>
        {dates.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <label className="text-sm text-slate-500">Дата:</label>
            <select className="input w-44" value={selDate} onChange={(e) => setSelDate(e.target.value)}>
              {dates.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        )}
      </div>

      {msg && <div className={`card p-3 mb-4 text-sm ${msg.startsWith('Ошибка') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>{msg}</div>}

      {dates.length === 0 ? (
        <EmptyState title="Потребность не загружена" description="Загрузите Excel с потребностью от заказчика" icon={<FileSpreadsheet size={40} />} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <StatCard title="Дата" value={selDate} color="blue" />
            <StatCard title="Пиковая потребность" value={`${peak} чел.`} color="purple" icon={<Users size={20} />} />
            <StatCard title="Сумма за день (чел·ч)" value={totalReq} color="green" />
          </div>

          <div className="card p-6 mb-6">
            <h2 className="text-sm font-semibold text-slate-800 mb-1">Потребность от заказчика по часам</h2>
            <p className="text-xs text-slate-400 mb-4">{selDate} · красная линия — требование заказчика, зелёная — фактические операторы</p>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip formatter={(v, n) => [v, n === 'required' ? 'Требуется (заказчик)' : 'Факт. операторов']} />
                <Legend formatter={(v) => v === 'required' ? 'Требуется (заказчик)' : 'Факт. операторов'} />
                <Line type="monotone" dataKey="required" name="required" stroke="#dc2626" strokeWidth={2.5} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="actual" name="actual" stroke="#16a34a" strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100"><h2 className="text-sm font-semibold text-slate-800">Детализация по часам</h2></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    {['Час', 'Требуется (заказчик)', 'Факт. операторов', 'Отклонение'].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const diff = r.actual != null ? Math.round(r.actual) - r.required : null
                    return (
                      <tr key={r.hour} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-mono text-slate-700">{r.hour}</td>
                        <td className="px-4 py-2.5 font-medium text-red-600">{r.required}</td>
                        <td className="px-4 py-2.5 text-green-700">{r.actual != null ? r.actual : '—'}</td>
                        <td className="px-4 py-2.5">
                          {diff != null ? <span className={`font-medium ${diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>{diff >= 0 ? `+${diff}` : diff}</span> : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function StaffingPage() {
  const { activeProject } = useProjectStore()
  const [mode, setMode] = useState<'calc' | 'customer'>('calc')
  const [begin, setBegin] = useState(format(subDays(new Date(), 28), 'yyyy-MM-dd'))
  const [end, setEnd] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [targetSl, setTargetSl] = useState(80)
  const [targetSec, setTargetSec] = useState(20)
  const [shrinkage, setShrinkage] = useState(30)
  const [dayFilter, setDayFilter] = useState<DayFilter>('all')
  const [selectedQueues, setSelectedQueues] = useState<Set<string>>(new Set())
  const [fromHour, setFromHour] = useState(0)
  const [toHour, setToHour] = useState(24)

  // Параметры прогноза
  const [projWeeks, setProjWeeks] = useState(4)
  const [growthPct, setGrowthPct] = useState('')

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['workload-staffing', activeProject?.customer_uuid, begin, end],
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

  // Фактические операторы по часам — с учётом ВЫБРАННЫХ очередей (union: оператор
  // в нескольких выбранных очередях считается один раз). Без выбора — по всем.
  const queueParam = useMemo(() => [...selectedQueues], [selectedQueues])
  const { data: actualOpsData, isLoading: actualLoading } = useQuery({
    queryKey: ['actual-operators-by-queue', activeProject?.customer_uuid, begin, end, queueParam],
    queryFn: () =>
      api.get('/analytics/actual-operators-by-queue', {
        params: { partner_uuid: activeProject!.customer_uuid, begin, end, queues: queueParam },
        paramsSerializer: { indexes: null },
      }).then((r) => r.data.data as Array<{ hour_num: number; avg_operators: number }>),
    enabled: !!activeProject,
  })

  const actualByHour = useMemo(() => {
    const m: Record<number, number> = {}
    for (const r of actualOpsData || []) m[r.hour_num] = r.avg_operators
    return m
  }, [actualOpsData])

  const staffingData = useMemo(() => {
    if (!data?.length) return []

    const filtered = data.filter((row) => {
      if (selectedQueues.size > 0 && !selectedQueues.has(row.queue_name)) return false
      if (dayFilter === 'weekday') return !isWeekend(row.period_start)
      if (dayFilter === 'weekend') return isWeekend(row.period_start)
      return true
    })

    const byHour: Record<number, { total: number; ahtSum: number; ahtCount: number; days: number }> = {}
    for (let h = 0; h < 24; h++) byHour[h] = { total: 0, ahtSum: 0, ahtCount: 0, days: 0 }
    const seenDayHours = new Set<string>()
    for (const row of filtered) {
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
        actual: actualByHour[h] ?? null,
        _h: h,
      }
    }).filter((r) => (r.avgCalls > 0 || r.actual != null) && r._h >= fromHour && r._h <= Math.min(toHour, 23))
  }, [data, targetSl, targetSec, shrinkage, dayFilter, actualByHour, selectedQueues, fromHour, toHour])

  const growthNum = parseFloat(growthPct) || 0

  // Прогноз на N недель вперёд
  const projectionData = useMemo(() => {
    if (!staffingData.length) return []
    const growth = 1 + growthNum / 100
    const projStart = new Date()
    const projEnd = addDays(projStart, projWeeks * 7)
    const days = Math.round((projEnd.getTime() - projStart.getTime()) / 86400000)

    // Берём только часы которые уже есть в данных
    return staffingData.map((row) => {
      const projCalls = row.avgCalls * growth
      const avgAht = row.avgAht
      const needed = requiredAgents(projCalls, avgAht, targetSl, targetSec)
      const withShrinkage = needed > 0 ? Math.ceil(needed / (1 - shrinkage / 100)) : 0
      return {
        hour: row.hour,
        current: row.withShrinkage,
        projected: withShrinkage,
        projCalls: Math.round(projCalls),
      }
    })
  }, [staffingData, growthPct, projWeeks, targetSl, targetSec, shrinkage])

  const peakNeeded = staffingData.length ? Math.max(...staffingData.map((r) => r.withShrinkage)) : 0
  const peakRow = staffingData.find((r) => r.withShrinkage === peakNeeded)
  const avgNeeded = staffingData.length
    ? Math.round(staffingData.reduce((s, r) => s + r.withShrinkage, 0) / staffingData.length)
    : 0
  const avgActualFiltered = staffingData.filter((r) => r.actual != null)
  const avgActual = avgActualFiltered.length
    ? Math.round(avgActualFiltered.reduce((s, r) => s + (r.actual || 0), 0) / avgActualFiltered.length)
    : null

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
      <PageHeader title="Потребность в операторах" subtitle={`${activeProject.customer_name} · Erlang C`} />

      {/* Подразделы */}
      <div className="flex gap-1 mb-5 border-b border-slate-200">
        {([['calc', 'Расчёт'], ['customer', 'От заказчика']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setMode(id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${mode === id ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'customer' ? <CustomerDemandView /> : (<>

      {/* Parameters */}
      <div className="card p-5 mb-6">
        <div className="flex flex-wrap items-end gap-5">
          <div>
            <label className="label">Исторические данные</label>
            <DateRangePicker begin={begin} end={end} onChange={(b, e) => { setBegin(b); setEnd(e) }} />
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
            <label className="label">Shrinkage (%)</label>
            <input type="number" className="input w-24" min={0} max={60} value={shrinkage}
              onChange={(e) => setShrinkage(+e.target.value)} />
          </div>
          <div>
            <label className="label">Дни</label>
            <div className="flex rounded-lg overflow-hidden border border-slate-200">
              {([['all', 'Все'], ['weekday', 'Будние'], ['weekend', 'Выходные']] as const).map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setDayFilter(v)}
                  className={`px-3 py-2 text-sm font-medium transition-colors ${
                    dayFilter === v ? 'bg-brand-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Часы (с — по)</label>
            <div className="flex items-center gap-1.5">
              <select
                className="input w-24"
                value={fromHour}
                onChange={(e) => setFromHour(+e.target.value)}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                ))}
              </select>
              <span className="text-slate-400 text-sm">—</span>
              <select
                className="input w-24"
                value={toHour}
                onChange={(e) => setToHour(+e.target.value)}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                ))}
                <option value={24}>24:00</option>
              </select>
            </div>
          </div>
          {allQueues.length > 1 && (
            <QueueFilterDropdown queues={allQueues} selected={selectedQueues} onChange={setSelectedQueues} />
          )}
          <div className="flex items-end">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setBegin(format(subDays(new Date(), 28), 'yyyy-MM-dd'))
                setEnd(format(new Date(), 'yyyy-MM-dd'))
                setTargetSl(80)
                setTargetSec(20)
                setShrinkage(30)
                setDayFilter('all')
                setSelectedQueues(new Set())
                setFromHour(0)
                setToHour(24)
                setProjWeeks(4)
                setGrowthPct('')
              }}
            >
              Сбросить фильтры
            </button>
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 bg-blue-50 rounded-lg px-3 py-2">
          <Info size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-blue-700">
            Erlang C: среднее звонков/час × средний AHT за период → минимум операторов для SL {targetSl}%/{targetSec}с → делится на (1−{shrinkage}%) для shrinkage.
            Синяя пунктирная линия — фактическое среднее число операторов в системе.
          </p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="Пиковая потребность" value={peakNeeded ? `${peakNeeded} чел.` : '—'}
          sub={peakRow ? `в ${peakRow.hour}` : undefined} color="purple" icon={<Users size={20} />} />
        <StatCard title="Средняя потребность" value={avgNeeded ? `${avgNeeded} чел.` : '—'} color="blue" />
        {/* Карточка всегда на месте — пока факт считается, крутится колесо «Расчёт…», */}
        {/* чтобы блок не появлялся позже и не сдвигал разметку. */}
        <div className="card p-5">
          <p className="text-sm text-slate-500">Ср. факт. операторов</p>
          {avgActual != null ? (
            <>
              <p className="text-2xl font-bold text-slate-900 mt-1">{avgActual} чел.</p>
              <p className={`text-xs mt-0.5 ${avgActual < avgNeeded ? 'text-red-500' : 'text-green-600'}`}>
                {avgActual < avgNeeded ? '⚠ Нехватка' : '✓ Норма'}
              </p>
            </>
          ) : (isLoading || actualLoading) ? (
            <p className="text-lg font-semibold text-slate-400 mt-2 flex items-center gap-2">
              <Loader2 size={16} className="animate-spin" /> Расчёт…
            </p>
          ) : (
            <p className="text-2xl font-bold text-slate-900 mt-1">—</p>
          )}
        </div>
        <StatCard title="Параметры SL" value={`${targetSl}% / ${targetSec}с`}
          sub={`Shrinkage: ${shrinkage}%`} color="green" />
      </div>

      {isLoading || isFetching ? <PageSpinner /> : !staffingData.length ? (
        <EmptyState title="Нет данных" description="Настройте интеграцию с Naumen" />
      ) : (
        <>
          {/* Chart */}
          <div className="card p-6 mb-6">
            <h2 className="text-sm font-semibold text-slate-800 mb-1">Потребность vs. фактические операторы по часам</h2>
            <p className="text-xs text-slate-400 mb-4">
              {dayFilter === 'weekday' ? 'Только будние дни · ' : dayFilter === 'weekend' ? 'Только выходные · ' : ''}
              С учётом shrinkage {shrinkage}%
            </p>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={staffingData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip formatter={(val, name) => [
                  val,
                  name === 'withShrinkage' ? 'Требуется (со shrinkage)' :
                  name === 'needed' ? 'Минимум' :
                  name === 'actual' ? 'Факт. операторов' : 'Ср. звонков/час'
                ]} />
                <Legend formatter={(v) =>
                  v === 'withShrinkage' ? 'Требуется (со shrinkage)' :
                  v === 'needed' ? 'Минимум' :
                  v === 'actual' ? 'Факт. операторов' : 'Ср. звонков/час'
                } />
                <Line yAxisId="right" type="monotone" dataKey="avgCalls" name="avgCalls" stroke="#94a3b8" strokeDasharray="4 2" dot={false} />
                <Line yAxisId="left" type="monotone" dataKey="needed" name="needed" stroke="#93c5fd" strokeWidth={1.5} dot={false} />
                <Line yAxisId="left" type="monotone" dataKey="withShrinkage" name="withShrinkage" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} />
                {actualOpsData?.length && (
                  <Line yAxisId="left" type="monotone" dataKey="actual" name="actual" stroke="#16a34a" strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Detail table */}
          <div className="card overflow-hidden mb-6">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Детализация по часам</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    {['Час', 'Ср. звонков', 'Ср. AHT (с)', 'Мин. операторов', `С учётом shrinkage (${shrinkage}%)`, 'Факт. операторов', 'Отклонение'].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staffingData.map((row) => {
                    const diff = row.actual != null ? Math.round(row.actual) - row.withShrinkage : null
                    return (
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
                        <td className="px-4 py-2.5 text-green-700">{row.actual != null ? row.actual : '—'}</td>
                        <td className="px-4 py-2.5">
                          {diff != null ? (
                            <span className={`font-medium ${diff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {diff >= 0 ? `+${diff}` : diff}
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

          {/* Forecast section */}
          <div className="card p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={16} className="text-brand-500" />
              <h2 className="text-sm font-semibold text-slate-800">Прогноз потребности</h2>
            </div>
            <div className="flex flex-wrap items-end gap-5 mb-5">
              <div>
                <label className="label">Горизонт прогноза</label>
                <select className="input w-40" value={projWeeks} onChange={(e) => setProjWeeks(+e.target.value)}>
                  {[1, 2, 3, 4, 6, 8].map((w) => (
                    <option key={w} value={w}>{w} {w === 1 ? 'неделя' : w < 5 ? 'недели' : 'недель'}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">
                  Ожидаемый рост нагрузки (%)
                  <span className="text-slate-400 font-normal ml-1">— от базового уровня</span>
                </label>
                <div className="flex items-center gap-2">
                  <input type="number" className="input w-24" min={-50} max={200}
                    placeholder="0"
                    value={growthPct}
                    onChange={(e) => setGrowthPct(e.target.value)} />
                  <span className="text-sm text-slate-500">%</span>
                </div>
              </div>
              {growthNum !== 0 && (
                <div className="text-sm text-slate-500 pb-1">
                  Через {projWeeks} нед: звонков ×{(1 + growthNum / 100).toFixed(2)}
                </div>
              )}
            </div>

            <div className="flex items-start gap-2 bg-amber-50 rounded-lg px-3 py-2 mb-5">
              <Info size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-700">
                Прогноз рассчитывается из исторических средних × коэффициент роста. При росте нагрузки на {growthNum}%{' '}
                потребность в операторах вырастет нелинейно из-за теории очередей.
              </p>
            </div>

            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={projectionData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(val, name) => [val, name === 'projected' ? `Прогноз (×${(1 + growthNum/100).toFixed(2)})` : 'Текущая потребность']} />
                <Legend formatter={(v) => v === 'projected' ? `Прогноз на ${projWeeks} нед. (рост ${growthNum}%)` : 'Текущая потребность'} />
                <Line type="monotone" dataKey="current" name="current" stroke="#93c5fd" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="projected" name="projected" stroke="#dc2626" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    {['Час', 'Текущая потребность', `Прогноз (рост ${growthNum}%)`, 'Разница'].map((h) => (
                      <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {projectionData.map((row) => {
                    const diff = row.projected - row.current
                    return (
                      <tr key={row.hour} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-2 font-mono text-slate-700">{row.hour}</td>
                        <td className="px-4 py-2 text-blue-700 font-medium">{row.current}</td>
                        <td className="px-4 py-2 font-bold text-slate-900">{row.projected}</td>
                        <td className="px-4 py-2">
                          <span className={diff > 0 ? 'text-red-600 font-medium' : diff < 0 ? 'text-green-600' : 'text-slate-400'}>
                            {diff > 0 ? `+${diff}` : diff}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      </>)}
    </div>
  )
}

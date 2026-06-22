import { useState, useMemo, Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import type { OperatorLoadRow } from '@/types'
import PageHeader from '@/components/common/PageHeader'
import StatCard from '@/components/common/StatCard'
import { PageSpinner } from '@/components/ui/Spinner'
import EmptyState from '@/components/common/EmptyState'
import { AlertCircle, UserCheck, ChevronUp, ChevronDown, ChevronRight } from 'lucide-react'
import { format, subDays } from 'date-fns'
import DateRangePicker from '@/components/common/DateRangePicker'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'

interface QLRow {
  queue_name: string; login: string; employee_name: string | null; position: string | null
  handled_calls: number; avg_talk_sec: number | null; total_talk_sec: number | null
  avg_answer_sec: number | null; sl_percent: number | null
}

// Нагрузка операторов в разрезе очередей: очередь → операторы; оператор → его очереди.
function QueueLoadSection({ begin, end }: { begin: string; end: string }) {
  const { activeProject } = useProjectStore()
  const [openQueues, setOpenQueues] = useState<Set<string>>(new Set())
  const [openOp, setOpenOp] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['operator-load-by-queue', activeProject?.customer_uuid, begin, end],
    queryFn: () => api.get('/analytics/operator-load-by-queue', {
      params: { partner_uuid: activeProject!.customer_uuid, begin, end },
    }).then((r) => r.data.data as QLRow[]),
    enabled: !!activeProject,
  })

  const byQueue = useMemo(() => {
    const m: Record<string, QLRow[]> = {}
    for (const r of data || []) (m[r.queue_name] = m[r.queue_name] || []).push(r)
    return m
  }, [data])
  const byOp = useMemo(() => {
    const m: Record<string, QLRow[]> = {}
    for (const r of data || []) (m[r.login] = m[r.login] || []).push(r)
    return m
  }, [data])
  const queues = Object.keys(byQueue).sort()
  const toggleQ = (q: string) => setOpenQueues((p) => { const n = new Set(p); n.has(q) ? n.delete(q) : n.add(q); return n })
  const agg = (rows: QLRow[]) => {
    const handled = rows.reduce((s, r) => s + (r.handled_calls || 0), 0)
    const slRows = rows.filter((r) => r.sl_percent != null)
    const sl = slRows.length ? Math.round(slRows.reduce((s, r) => s + (r.sl_percent || 0), 0) / slRows.length) : null
    return { handled, ops: rows.length, sl }
  }
  const slColor = (sl: number | null) => sl == null ? 'text-slate-400' : sl >= 80 ? 'text-green-600' : sl >= 60 ? 'text-yellow-600' : 'text-red-600'

  if (isLoading) return <div className="card p-6 mt-6"><PageSpinner /></div>
  if (!queues.length) return null

  return (
    <div className="card overflow-hidden mt-6">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-800">Нагрузка по очередям</h2>
        <p className="text-xs text-slate-400 mt-0.5">Нажмите на очередь — увидите операторов; на оператора — его очереди. «Общая» статистика — в таблице выше.</p>
      </div>
      {queues.map((q) => {
        const rows = byQueue[q]; const a = agg(rows); const open = openQueues.has(q)
        return (
          <div key={q}>
            <button onClick={() => toggleQ(q)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 border-b border-slate-50 text-left">
              {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
              <span className="font-medium text-slate-800 flex-1">{q}</span>
              <span className="text-xs text-slate-500">{a.ops} опер.</span>
              <span className="text-xs text-slate-700 font-medium w-20 text-right">{a.handled} зв.</span>
              <span className={`text-xs font-medium w-16 text-right ${slColor(a.sl)}`}>SL {a.sl ?? '—'}%</span>
            </button>
            {open && (
              <div className="bg-slate-50 border-b border-slate-100 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-200 text-xs text-slate-500 uppercase">
                    <th className="text-left px-4 py-2">Оператор</th>
                    <th className="text-left px-4 py-2">Звонков</th>
                    <th className="text-left px-4 py-2">AHT (с)</th>
                    <th className="text-left px-4 py-2">SL</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <Fragment key={r.login}>
                        <tr onClick={() => setOpenOp(openOp === r.login ? null : r.login)} className="border-b border-slate-100 hover:bg-white cursor-pointer">
                          <td className="px-4 py-2 font-medium text-slate-800">{openOp === r.login ? '▾ ' : '▸ '}{r.employee_name || r.login}</td>
                          <td className="px-4 py-2 text-brand-600 font-medium">{r.handled_calls}</td>
                          <td className="px-4 py-2 text-slate-600">{r.avg_talk_sec ?? '—'}</td>
                          <td className="px-4 py-2"><span className={slColor(r.sl_percent)}>{r.sl_percent != null ? `${r.sl_percent}%` : '—'}</span></td>
                        </tr>
                        {openOp === r.login && (
                          <tr className="bg-white border-b border-slate-100"><td colSpan={4} className="px-6 py-3">
                            <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Очереди оператора · {r.employee_name || r.login}</p>
                            <div className="flex flex-wrap gap-2">
                              {(byOp[r.login] || []).map((qr) => (
                                <span key={qr.queue_name} className="text-xs bg-slate-100 rounded-lg px-2.5 py-1 text-slate-700">
                                  {qr.queue_name}: <b>{qr.handled_calls}</b> зв.{qr.sl_percent != null ? ` · SL ${qr.sl_percent}%` : ''}
                                </span>
                              ))}
                            </div>
                          </td></tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

type SortKey = 'employee_name' | 'login' | 'position' | 'handled_calls' | 'avg_talk_sec' | 'total_talk_sec' | 'idle_sec' | 'avg_answer_sec' | 'sl_percent'

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

const BAR_COLORS = ['#f59e0b', '#94a3b8', '#f97316', '#3b82f6']

function barColor(i: number) { return BAR_COLORS[Math.min(i, BAR_COLORS.length - 1)] }

function TopChart({ data }: { data: Array<{ name: string; handled: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} barGap={4} margin={{ top: 4, right: 8, left: -16, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 10, fill: '#64748b' }}
          angle={-35}
          textAnchor="end"
          interval={0}
        />
        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} />
        <Tooltip
          formatter={(v: number) => [`${v} зв.`, 'Звонков']}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="handled" radius={[3, 3, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={barColor(i)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export default function OperatorLoadPage() {
  const { activeProject } = useProjectStore()
  const [begin, setBegin] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'))
  const [end, setEnd] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('handled_calls')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['operator-load', activeProject?.customer_uuid, begin, end],
    queryFn: () =>
      api.get('/analytics/operator-load', {
        params: { partner_uuid: activeProject!.customer_uuid, begin, end },
      }).then((r) => r.data.data as OperatorLoadRow[]),
    enabled: !!activeProject,
  })

  // Разрез по очередям — чтобы в основном топе раскрыть оператора и увидеть доли по очередям
  const [expandedLogin, setExpandedLogin] = useState<string | null>(null)
  const [mainOpen, setMainOpen] = useState(false)
  const { data: byQueueData } = useQuery({
    queryKey: ['operator-load-by-queue', activeProject?.customer_uuid, begin, end],
    queryFn: () =>
      api.get('/analytics/operator-load-by-queue', {
        params: { partner_uuid: activeProject!.customer_uuid, begin, end },
      }).then((r) => r.data.data as QLRow[]),
    enabled: !!activeProject,
  })
  const byOpQueues = useMemo(() => {
    const m: Record<string, QLRow[]> = {}
    for (const r of byQueueData || []) (m[r.login] = m[r.login] || []).push(r)
    return m
  }, [byQueueData])

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
          <h2 className="text-sm font-semibold text-slate-800 mb-1">Топ-10 операторов по звонкам</h2>
          <p className="text-xs text-slate-400 mb-3">За выбранный период</p>
          <TopChart data={chartData} />
        </div>
      )}

      <div className="card overflow-hidden">
        <button onClick={() => setMainOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-50 text-left">
          {mainOpen ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
          <span className="font-semibold text-slate-800 text-sm flex-1">Общая нагрузка</span>
          <span className="text-xs text-slate-400">{(data || []).length} операторов</span>
        </button>
        {mainOpen && (isLoading || isFetching ? <PageSpinner /> : filtered.length === 0 ? (
          <EmptyState title="Нет данных" icon={<UserCheck size={40} />} />
        ) : (
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <SortHeader label="Оператор" sortKey="employee_name" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Логин" sortKey="login" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Должность" sortKey="position" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Звонков" sortKey="handled_calls" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="АНТ (с)" sortKey="avg_talk_sec" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Общ. время разг." sortKey="total_talk_sec" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Простой (мин)" sortKey="idle_sec" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="Ср. ответ (с)" sortKey="avg_answer_sec" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortHeader label="SL (%)" sortKey="sl_percent" current={sortKey} dir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const open = expandedLogin === row.login
                  const qs = byOpQueues[row.login] || []
                  const totalQ = qs.reduce((s, q) => s + (q.handled_calls || 0), 0)
                  return (
                    <Fragment key={i}>
                      <tr onClick={() => setExpandedLogin(open ? null : row.login)}
                        className={`border-b border-slate-50 hover:bg-slate-50 cursor-pointer ${open ? 'bg-slate-50' : ''}`}>
                        <td className="px-4 py-3 font-medium text-slate-900">
                          <span className="text-slate-400 mr-1">{open ? '▾' : '▸'}</span>{row.employee_name || '—'}
                        </td>
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
                      {open && (
                        <tr className="border-b border-slate-100 bg-white">
                          <td colSpan={9} className="px-6 py-3">
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Очереди оператора · доли по звонкам</p>
                            {qs.length === 0 ? (
                              <p className="text-xs text-slate-400">Нет данных по очередям за период</p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {[...qs].sort((a, b) => (b.handled_calls || 0) - (a.handled_calls || 0)).map((q) => {
                                  const pct = totalQ > 0 ? Math.round((q.handled_calls || 0) / totalQ * 100) : 0
                                  return (
                                    <span key={q.queue_name} className="text-xs bg-slate-100 rounded-lg px-2.5 py-1 text-slate-700">
                                      {q.queue_name}: <b>{pct}%</b> ({q.handled_calls} зв.){q.sl_percent != null ? ` · SL ${q.sl_percent}%` : ''}
                                    </span>
                                  )
                                })}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <QueueLoadSection begin={begin} end={end} />
    </div>
  )
}

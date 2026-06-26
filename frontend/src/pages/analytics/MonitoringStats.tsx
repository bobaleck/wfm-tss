import { useState, useMemo, Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import { PageSpinner } from '@/components/ui/Spinner'
import EmptyState from '@/components/common/EmptyState'
import StatCard from '@/components/common/StatCard'
import QueueFilterDropdown from '@/components/common/QueueFilterDropdown'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

const slC = (v: number | null) => v == null ? 'text-slate-400' : v >= 80 ? 'text-green-600' : v >= 60 ? 'text-yellow-600' : 'text-red-600'
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

interface QRow { queue_name: string; total: number; handled: number; lost: number; aht: number | null; sl: number | null }
interface OQRow { queue_name: string; login: string; employee_name: string | null; handled: number; aht: number | null; sl: number | null }

function SortTh({ label, k, sort, dir, onSort }: { label: string; k: string; sort: string; dir: 'asc' | 'desc'; onSort: (k: string) => void }) {
  const active = sort === k
  return (
    <th onClick={() => onSort(k)} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide cursor-pointer select-none hover:text-slate-700 group whitespace-nowrap">
      <span className="inline-flex items-center gap-1">{label}
        <span className={`transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}>
          {active && dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </span>
      </span>
    </th>
  )
}

// «Мониторинг → Статистика»: одна страница — сначала «По очередям», затем «SL операторов».
// Окно — последние N минут (до 24ч) выбирается ползунком.
export default function MonitoringStats({ externalQueues }: { externalQueues?: Set<string> }) {
  const { activeProject } = useProjectStore()
  const [sliderVal, setSliderVal] = useState(1440)
  const [windowMin, setWindowMin] = useState(1440)
  // Фильтр очередей: если передан сверху (из шапки Мониторинга) — используем его,
  // иначе свой локальный (на случай отдельного использования компонента).
  const [internalQueues, setInternalQueues] = useState<Set<string>>(new Set())
  const selectedQueues = externalQueues ?? internalQueues
  const setSelectedQueues = setInternalQueues
  const [qSort, setQSort] = useState<string>('total'); const [qDir, setQDir] = useState<'asc' | 'desc'>('desc')
  const [oSort, setOSort] = useState<string>('handled'); const [oDir, setODir] = useState<'asc' | 'desc'>('desc')
  // Раскрытые строки — наборы, чтобы можно было держать открытыми сразу несколько.
  const [openOps, setOpenOps] = useState<Set<string>>(new Set())
  const [openQueues, setOpenQueues] = useState<Set<string>>(new Set())
  const toggleIn = (key: string, setFn: (fn: (p: Set<string>) => Set<string>) => void) =>
    setFn((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['recent-stats', activeProject?.customer_uuid, windowMin],
    queryFn: () => api.get('/analytics/recent-stats', {
      params: { partner_uuid: activeProject!.customer_uuid, window_min: windowMin },
    }).then((r) => r.data as { by_queue: QRow[]; by_operator_queue: OQRow[] }),
    enabled: !!activeProject,
    refetchInterval: 5 * 60 * 1000,
  })

  const byQueue = data?.by_queue || []
  const byOpQueue = data?.by_operator_queue || []
  const allQueues = useMemo(() => [...new Set(byQueue.map((q) => q.queue_name))].sort(), [byQueue])
  const shownQueues = selectedQueues.size ? byQueue.filter((q) => selectedQueues.has(q.queue_name)) : byQueue
  const shownOpQueue = selectedQueues.size ? byOpQueue.filter((q) => selectedQueues.has(q.queue_name)) : byOpQueue

  const sortedQueues = useMemo(() => {
    const withPct = shownQueues.map((q) => ({ ...q, pct: q.total > 0 ? Math.round(q.handled / q.total * 100) : 0 }))
    return withPct.sort((a, b) => {
      const av = (a as any)[qSort] ?? -1, bv = (b as any)[qSort] ?? -1
      const c = typeof av === 'string' ? String(av).localeCompare(String(bv)) : av - bv
      return qDir === 'asc' ? c : -c
    })
  }, [shownQueues, qSort, qDir])
  const totals = shownQueues.reduce((a, q) => ({ total: a.total + q.total, handled: a.handled + q.handled, lost: a.lost + q.lost }), { total: 0, handled: 0, lost: 0 })
  const totalPct = totals.total > 0 ? Math.round(totals.handled / totals.total * 100) : 0

  // Операторы каждой очереди (для раскрытия строки очереди) — из тех же данных
  // по (оператор, очередь), из которых складывается статистика очереди.
  const opsByQueue = useMemo(() => {
    const m: Record<string, OQRow[]> = {}
    for (const r of shownOpQueue) (m[r.queue_name] = m[r.queue_name] || []).push(r)
    for (const k of Object.keys(m)) m[k].sort((a, b) => (b.handled || 0) - (a.handled || 0))
    return m
  }, [shownOpQueue])

  const operators = useMemo(() => {
    const m: Record<string, { login: string; name: string; handled: number; slSum: number; slCnt: number; ahtSum: number; ahtCnt: number; queues: OQRow[] }> = {}
    for (const r of shownOpQueue) {
      const x = m[r.login] || (m[r.login] = { login: r.login, name: r.employee_name || r.login, handled: 0, slSum: 0, slCnt: 0, ahtSum: 0, ahtCnt: 0, queues: [] })
      x.handled += r.handled || 0
      if (r.sl != null) { x.slSum += r.sl * (r.handled || 0); x.slCnt += r.handled || 0 }
      if (r.aht != null) { x.ahtSum += r.aht * (r.handled || 0); x.ahtCnt += r.handled || 0 }
      x.queues.push(r)
    }
    return Object.values(m).map((x) => ({
      login: x.login, name: x.name, handled: x.handled,
      sl: x.slCnt > 0 ? Math.round(x.slSum / x.slCnt) : null,
      aht: x.ahtCnt > 0 ? Math.round(x.ahtSum / x.ahtCnt) : null,
      queues: x.queues,
    }))
  }, [shownOpQueue])
  const sortedOps = useMemo(() => [...operators].sort((a, b) => {
    const av = oSort === 'employee_name' ? a.name : (a as any)[oSort] ?? -1
    const bv = oSort === 'employee_name' ? b.name : (b as any)[oSort] ?? -1
    const c = typeof av === 'string' ? String(av).localeCompare(String(bv)) : av - bv
    return oDir === 'asc' ? c : -c
  }), [operators, oSort, oDir])

  const handleQSort = (k: string) => { if (qSort === k) setQDir((d) => d === 'asc' ? 'desc' : 'asc'); else { setQSort(k); setQDir('desc') } }
  const handleOSort = (k: string) => { if (oSort === k) setODir((d) => d === 'asc' ? 'desc' : 'asc'); else { setOSort(k); setODir('desc') } }

  if (!activeProject) return null

  return (
    <div>
      {/* Окно времени */}
      <div className="card p-4 mb-6 flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-[260px]">
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-medium text-slate-700">Окно: последние {hhmm(sliderVal)}</label>
            <span className="text-xs text-slate-400">макс. 24:00</span>
          </div>
          <input type="range" min={5} max={1440} step={5} value={sliderVal}
            onChange={(e) => setSliderVal(+e.target.value)}
            onMouseUp={() => setWindowMin(sliderVal)} onTouchEnd={() => setWindowMin(sliderVal)} onKeyUp={() => setWindowMin(sliderVal)}
            style={{ background: `linear-gradient(to right, #2563eb 0%, #2563eb ${((sliderVal - 5) / (1440 - 5)) * 100}%, #e2e8f0 ${((sliderVal - 5) / (1440 - 5)) * 100}%, #e2e8f0 100%)` }}
            className="w-full h-2.5 rounded-full appearance-none cursor-pointer outline-none
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-brand-600 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110
              [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-brand-600 [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:border-solid" />
          <div className="flex justify-between text-[10px] text-slate-400 mt-1 px-0.5">
            <span>00:05</span><span>12:00</span><span>24:00</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {[7, 30, 60, 180, 360, 720, 1440].map((m) => (
              <button key={m} onClick={() => { setSliderVal(m); setWindowMin(m) }}
                className={`text-xs px-2 py-1 rounded ${windowMin === m ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {hhmm(m)}
              </button>
            ))}
          </div>
        </div>
        {externalQueues === undefined && allQueues.length > 1 && <QueueFilterDropdown queues={allQueues} selected={selectedQueues} onChange={setSelectedQueues} align="right" />}
      </div>

      {isLoading || isFetching ? <PageSpinner /> : (!byQueue.length && !byOpQueue.length) ? (
        <EmptyState title="Нет данных за выбранное окно" />
      ) : (
        <>
          {/* ── По очередям ── */}
          <h2 className="text-sm font-semibold text-slate-800 mb-3">По очередям</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <StatCard title="Поступило" value={totals.total.toLocaleString()} color="blue" />
            <StatCard title="Обработано" value={totals.handled.toLocaleString()} color="green" />
            <StatCard title="% обработанных" value={`${totalPct}%`} color="purple" />
            <StatCard title="Потеряно" value={totals.lost.toLocaleString()} color="red" />
          </div>
          {sortedQueues.length > 0 && (
            <div className="card p-6 mb-4">
              <ResponsiveContainer width="100%" height={Math.max(160, sortedQueues.length * 38)}>
                <BarChart data={sortedQueues} layout="vertical" margin={{ left: 8, right: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="queue_name" width={140} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v, n) => [v, n === 'handled' ? 'Обработано' : 'Потеряно']} />
                  <Legend formatter={(v) => v === 'handled' ? 'Обработано' : 'Потеряно'} />
                  <Bar dataKey="handled" name="handled" fill="#2563eb" stackId="a" />
                  <Bar dataKey="lost" name="lost" fill="#ef4444" stackId="a" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="card overflow-hidden mb-8">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 border-b border-slate-100">
                  <SortTh label="Очередь" k="queue_name" sort={qSort} dir={qDir} onSort={handleQSort} />
                  <SortTh label="Поступило" k="total" sort={qSort} dir={qDir} onSort={handleQSort} />
                  <SortTh label="Обработано" k="handled" sort={qSort} dir={qDir} onSort={handleQSort} />
                  <SortTh label="Потеряно" k="lost" sort={qSort} dir={qDir} onSort={handleQSort} />
                  <SortTh label="% обр." k="pct" sort={qSort} dir={qDir} onSort={handleQSort} />
                  <SortTh label="SL" k="sl" sort={qSort} dir={qDir} onSort={handleQSort} />
                  <SortTh label="AHT (с)" k="aht" sort={qSort} dir={qDir} onSort={handleQSort} />
                </tr></thead>
                <tbody>
                  {sortedQueues.map((q) => {
                    const qOpen = openQueues.has(q.queue_name)
                    const qOps = opsByQueue[q.queue_name] || []
                    return (
                    <Fragment key={q.queue_name}>
                    <tr onClick={() => toggleIn(q.queue_name, setOpenQueues)} className={`border-b border-slate-50 hover:bg-slate-50 cursor-pointer ${qOpen ? 'bg-slate-50' : ''}`}>
                      <td className="px-4 py-2.5 font-medium text-slate-900"><span className="text-slate-400 mr-1">{qOpen ? '▾' : '▸'}</span>{q.queue_name}</td>
                      <td className="px-4 py-2.5 text-slate-700">{q.total}</td>
                      <td className="px-4 py-2.5 text-green-700">{q.handled}</td>
                      <td className="px-4 py-2.5 text-red-600">{q.lost}</td>
                      <td className="px-4 py-2.5">{q.pct}%</td>
                      <td className="px-4 py-2.5"><span className={slC(q.sl)}>{q.sl != null ? `${q.sl}%` : '—'}</span></td>
                      <td className="px-4 py-2.5 text-slate-600">{q.aht ?? '—'}</td>
                    </tr>
                    {qOpen && (
                      <tr className="bg-white border-b border-slate-100"><td colSpan={7} className="px-6 py-3">
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Операторы очереди — из них складывается статистика</p>
                        {qOps.length === 0 ? <p className="text-xs text-slate-400">Нет операторов за выбранное окно</p> : (
                          <table className="w-full text-xs">
                            <thead><tr className="text-slate-400">
                              <th className="text-left font-medium py-1">Оператор</th>
                              <th className="text-left font-medium py-1 w-24">Звонков</th>
                              <th className="text-left font-medium py-1 w-24">AHT (с)</th>
                              <th className="text-left font-medium py-1 w-20">SL</th>
                            </tr></thead>
                            <tbody>
                              {qOps.map((op) => (
                                <tr key={op.login} className="border-t border-slate-50">
                                  <td className="py-1.5 text-slate-700">{op.employee_name || op.login}</td>
                                  <td className="py-1.5 text-brand-600 font-medium">{op.handled}</td>
                                  <td className="py-1.5 text-slate-600">{op.aht ?? '—'}</td>
                                  <td className="py-1.5"><span className={slC(op.sl)}>{op.sl != null ? `${op.sl}%` : '—'}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td></tr>
                    )}
                    </Fragment>
                    )
                  })}
                  <tr className="bg-slate-50 font-semibold">
                    <td className="px-4 py-2.5">Суммарно</td>
                    <td className="px-4 py-2.5">{totals.total}</td>
                    <td className="px-4 py-2.5 text-green-700">{totals.handled}</td>
                    <td className="px-4 py-2.5 text-red-600">{totals.lost}</td>
                    <td className="px-4 py-2.5">{totalPct}%</td>
                    <td className="px-4 py-2.5 text-slate-400">—</td>
                    <td className="px-4 py-2.5 text-slate-400">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* ── SL операторов ── */}
          <h2 className="text-sm font-semibold text-slate-800 mb-3">SL операторов</h2>
          {sortedOps.length === 0 ? (
            <EmptyState title="Нет операторов за выбранное окно" />
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 border-b border-slate-100">
                    <SortTh label="Оператор" k="employee_name" sort={oSort} dir={oDir} onSort={handleOSort} />
                    <SortTh label="Звонков" k="handled" sort={oSort} dir={oDir} onSort={handleOSort} />
                    <SortTh label="AHT (с)" k="aht" sort={oSort} dir={oDir} onSort={handleOSort} />
                    <SortTh label="SL" k="sl" sort={oSort} dir={oDir} onSort={handleOSort} />
                  </tr></thead>
                  <tbody>
                    {sortedOps.map((o) => {
                      const open = openOps.has(o.login)
                      return (
                        <Fragment key={o.login}>
                          <tr onClick={() => toggleIn(o.login, setOpenOps)} className={`border-b border-slate-50 hover:bg-slate-50 cursor-pointer ${open ? 'bg-slate-50' : ''}`}>
                            <td className="px-4 py-2.5 font-medium text-slate-900"><span className="text-slate-400 mr-1">{open ? '▾' : '▸'}</span>{o.name}</td>
                            <td className="px-4 py-2.5 text-brand-600 font-medium">{o.handled}</td>
                            <td className="px-4 py-2.5 text-slate-600">{o.aht ?? '—'}</td>
                            <td className="px-4 py-2.5"><span className={slC(o.sl)}>{o.sl != null ? `${o.sl}%` : '—'}</span></td>
                          </tr>
                          {open && (
                            <tr className="bg-white border-b border-slate-100"><td colSpan={4} className="px-6 py-3">
                              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">SL по очередям</p>
                              <div className="flex flex-wrap gap-2">
                                {[...o.queues].sort((a, b) => (b.handled || 0) - (a.handled || 0)).map((q) => (
                                  <span key={q.queue_name} className="text-xs bg-slate-100 rounded-lg px-2.5 py-1 text-slate-700">
                                    {q.queue_name}: <b>{q.handled}</b> зв.{q.sl != null ? ` · SL ${q.sl}%` : ''}
                                  </span>
                                ))}
                              </div>
                            </td></tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

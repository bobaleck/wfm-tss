import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import { PageSpinner } from '@/components/ui/Spinner'
import EmptyState from '@/components/common/EmptyState'
import StatCard from '@/components/common/StatCard'
import { outboundResultLabel } from '@/pages/analytics/outboundShared'
import { ChevronUp, ChevronDown } from 'lucide-react'

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

interface OpRow { login: string; employee_name: string | null; attempts: number; contacts: number; avg_talk_sec: number | null }
interface ResRow { result: string; cnt: number; contacts: number }

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

// «Мониторинг → Статистика» для линии «Исход»: операторы обзвона и результаты
// за окно последних N минут. Окно — ползунок (как у входящей статистики).
// externalQueues — выбранные в фильтре линии/подпроекты: пробрасываем их в
// запрос, чтобы статистика соответствовала выбранным исходящим подпроектам.
export default function OutboundMonitoringStats({ externalQueues }: { externalQueues?: Set<string> }) {
  const { activeProject } = useProjectStore()
  const [sliderVal, setSliderVal] = useState(1440)
  const [windowMin, setWindowMin] = useState(1440)
  const [oSort, setOSort] = useState<string>('attempts'); const [oDir, setODir] = useState<'asc' | 'desc'>('desc')

  const queueList = externalQueues && externalQueues.size > 0 ? [...externalQueues] : undefined
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['recent-stats-outbound', activeProject?.customer_uuid, windowMin, queueList?.join('|')],
    queryFn: () => api.get('/analytics/recent-stats-outbound', {
      params: { partner_uuid: activeProject!.customer_uuid, window_min: windowMin, queues: queueList },
      paramsSerializer: { indexes: null },
    }).then((r) => r.data as { by_operator: OpRow[]; by_result: ResRow[] }),
    enabled: !!activeProject,
    refetchInterval: 5 * 60 * 1000,
  })

  const byOp = data?.by_operator || []
  const byRes = data?.by_result || []
  const totals = byOp.reduce((a, o) => ({ attempts: a.attempts + (o.attempts || 0), contacts: a.contacts + (o.contacts || 0) }), { attempts: 0, contacts: 0 })
  const contactRate = totals.attempts > 0 ? Math.round(totals.contacts / totals.attempts * 100) : 0
  const resTotal = byRes.reduce((a, r) => a + r.cnt, 0)

  const sortedOps = useMemo(() => [...byOp].map((o) => ({ ...o, cr: o.attempts > 0 ? Math.round(o.contacts / o.attempts * 100) : 0 })).sort((a, b) => {
    const av = oSort === 'employee_name' ? (a.employee_name || a.login) : (a as any)[oSort] ?? -1
    const bv = oSort === 'employee_name' ? (b.employee_name || b.login) : (b as any)[oSort] ?? -1
    const c = typeof av === 'string' ? String(av).localeCompare(String(bv)) : av - bv
    return oDir === 'asc' ? c : -c
  }), [byOp, oSort, oDir])
  const handleOSort = (k: string) => { if (oSort === k) setODir((d) => d === 'asc' ? 'desc' : 'asc'); else { setOSort(k); setODir('desc') } }

  if (!activeProject) return null

  return (
    <div>
      {/* Окно времени */}
      <div className="card p-4 mb-6">
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-slate-700">Окно: последние {hhmm(sliderVal)}</label>
          <span className="text-xs text-slate-400">макс. 24:00</span>
        </div>
        <input type="range" min={5} max={1440} step={5} value={sliderVal}
          onChange={(e) => setSliderVal(+e.target.value)}
          onMouseUp={() => setWindowMin(sliderVal)} onTouchEnd={() => setWindowMin(sliderVal)} onKeyUp={() => setWindowMin(sliderVal)}
          style={{ background: `linear-gradient(to right, #2563eb 0%, #2563eb ${((sliderVal - 5) / (1440 - 5)) * 100}%, #e2e8f0 ${((sliderVal - 5) / (1440 - 5)) * 100}%, #e2e8f0 100%)` }}
          className="w-full h-2.5 rounded-full appearance-none cursor-pointer outline-none
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-brand-600 [&::-webkit-slider-thumb]:shadow-md
            [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-brand-600 [&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:border-solid" />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {[7, 30, 60, 180, 360, 720, 1440].map((m) => (
            <button key={m} onClick={() => { setSliderVal(m); setWindowMin(m) }}
              className={`text-xs px-2 py-1 rounded ${windowMin === m ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {hhmm(m)}
            </button>
          ))}
        </div>
      </div>

      {isLoading || isFetching ? <PageSpinner /> : (!byOp.length && !byRes.length) ? (
        <EmptyState title="Нет данных обзвона за выбранное окно" />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <StatCard title="Попыток" value={totals.attempts.toLocaleString()} color="blue" />
            <StatCard title="Разговоров" value={totals.contacts.toLocaleString()} color="green" />
            <StatCard title="Доля разговоров" value={`${contactRate}%`} color="purple" />
            <StatCard title="Операторов" value={byOp.length.toLocaleString()} color="blue" />
          </div>

          <h2 className="text-sm font-semibold text-slate-800 mb-3">Операторы обзвона</h2>
          {sortedOps.length === 0 ? <EmptyState title="Нет операторов за выбранное окно" /> : (
            <div className="card overflow-hidden mb-8">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 border-b border-slate-100">
                    <SortTh label="Оператор" k="employee_name" sort={oSort} dir={oDir} onSort={handleOSort} />
                    <SortTh label="Попыток" k="attempts" sort={oSort} dir={oDir} onSort={handleOSort} />
                    <SortTh label="Контактов" k="contacts" sort={oSort} dir={oDir} onSort={handleOSort} />
                    <SortTh label="Доля разг." k="cr" sort={oSort} dir={oDir} onSort={handleOSort} />
                    <SortTh label="Ср. разговор (с)" k="avg_talk_sec" sort={oSort} dir={oDir} onSort={handleOSort} />
                  </tr></thead>
                  <tbody>
                    {sortedOps.map((o) => (
                      <tr key={o.login} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-slate-900">{o.employee_name || o.login}</td>
                        <td className="px-4 py-2.5 text-brand-600 font-medium">{o.attempts}</td>
                        <td className="px-4 py-2.5 text-green-700">{o.contacts}</td>
                        <td className="px-4 py-2.5">{o.cr}%</td>
                        <td className="px-4 py-2.5 text-slate-600">{o.avg_talk_sec ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <h2 className="text-sm font-semibold text-slate-800 mb-3">Результаты попыток</h2>
          {byRes.length === 0 ? <EmptyState title="Нет результатов за выбранное окно" /> : (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Результат</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">Попыток</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide w-40">Доля</th>
                </tr></thead>
                <tbody>
                  {byRes.map((r) => {
                    const pct = resTotal > 0 ? Math.round(r.cnt / resTotal * 100) : 0
                    return (
                      <tr key={r.result} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-800">{outboundResultLabel(r.result)}</td>
                        <td className="px-4 py-2.5 text-slate-700 font-medium">{r.cnt.toLocaleString()}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden max-w-24">
                              <div className="h-full bg-brand-400 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-xs text-slate-500">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

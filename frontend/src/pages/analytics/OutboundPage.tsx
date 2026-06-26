import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { PhoneOutgoing } from 'lucide-react'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import EmptyState from '@/components/common/EmptyState'
import StatCard from '@/components/common/StatCard'
import DateRangePicker from '@/components/common/DateRangePicker'
import OutboundProjectFilter, { useOutboundProjects, outboundParams, outboundResultLabel, effectiveProjectIds } from '@/pages/analytics/outboundShared'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

interface OutboundTotals {
  attempts: number; cases: number; contacts: number
  contact_rate: number | null; avg_talk_sec: number | null; attempts_per_case: number | null
}
interface ResultRow { result: string; cnt: number }
interface DayRow { day: string; attempts: number; contacts: number }
interface ProjRow { name: string; project_uuid: string; attempts: number; cases: number; contacts: number; contact_rate: number | null }
interface OutboundData { totals: OutboundTotals; by_result: ResultRow[]; by_day: DayRow[]; by_project: ProjRow[] }

const dispD = (s: string) => { const [, m, d] = s.split('-'); return `${d}.${m}` }

// «Аналитика (Исход) → Обзор»: сводка обзвона по проекту + разрез по подпроектам.
export default function OutboundPage() {
  const { activeProject } = useProjectStore()
  const [begin, setBegin] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [end, setEnd] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'))
  const [selProjects, setSelProjects] = useState<Set<string>>(new Set())

  const { data: projects = [] } = useOutboundProjects(activeProject?.customer_uuid)
  const visibleProjects = useMemo(() => projects.filter((p) => !p.hidden), [projects])
  const eff = useMemo(() => effectiveProjectIds(projects, selProjects), [projects, selProjects])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['outbound-summary', activeProject?.customer_uuid, begin, end, eff],
    queryFn: () => api.get('/analytics/outbound-summary', outboundParams(activeProject!.customer_uuid, begin, end, eff)).then((r) => r.data as OutboundData),
    enabled: !!activeProject,
  })

  const totals = data?.totals
  const byResult = data?.by_result || []
  const byProject = data?.by_project || []
  const byDay = useMemo(() => (data?.by_day || []).map((d) => ({ ...d, label: dispD(d.day) })), [data])
  const resultTotal = byResult.reduce((a, r) => a + r.cnt, 0)

  if (!activeProject) return (
    <div>
      <PageHeader title="Аналитика (Исход)" />
      <div className="card p-6 text-sm text-amber-700 bg-amber-50">Выберите проект в шапке</div>
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Обзвон — обзор"
        subtitle={`Аналитика (Исход) · ${activeProject.customer_name}`}
        actions={
          <div className="flex items-center gap-2">
            <OutboundProjectFilter projects={visibleProjects} selected={selProjects} onChange={setSelProjects} />
            <DateRangePicker begin={begin} end={end} align="right" onChange={(b, e) => { setBegin(b); setEnd(e) }} />
          </div>
        }
      />

      {isLoading ? <PageSpinner /> : isError ? (
        <div className="card p-6 text-sm text-amber-700 bg-amber-50">
          Не удалось загрузить данные обзвона. Проверьте, что у проекта есть исходящая линия и подключение к Naumen.
        </div>
      ) : !totals || !totals.attempts ? (
        <EmptyState title="Нет данных обзвона за выбранный период" icon={<PhoneOutgoing size={40} />} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <StatCard title="Попыток дозвона" value={totals.attempts.toLocaleString()} color="blue" />
            <StatCard title="Обращений (карточек)" value={totals.cases.toLocaleString()} color="purple" />
            <StatCard title="Состоявшихся разговоров" value={totals.contacts.toLocaleString()} color="green" />
            <StatCard title="Доля разговоров" value={totals.contact_rate != null ? `${totals.contact_rate}%` : '—'} color="green" />
            <StatCard title="Ср. разговор" value={totals.avg_talk_sec != null ? `${totals.avg_talk_sec} с` : '—'} color="blue" />
            <StatCard title="Попыток на обращение" value={totals.attempts_per_case != null ? String(totals.attempts_per_case) : '—'} color="purple" />
          </div>

          {/* Разрез по подпроектам — «сколько звонили по каждому подпроекту» */}
          <div className="card overflow-hidden mb-6">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">По подпроектам (очередям обзвона)</h2>
            </div>
            {byProject.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400">Нет подпроектов с данными за период</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Подпроект</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">Попыток</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide w-24">Обращений</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">Разговоров</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">Доля разг.</th>
                  </tr></thead>
                  <tbody>
                    {byProject.map((p) => (
                      <tr key={p.project_uuid} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-slate-900">{p.name}</td>
                        <td className="px-4 py-2.5 text-brand-600 font-medium">{p.attempts.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-slate-700">{p.cases.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-green-700">{p.contacts.toLocaleString()}</td>
                        <td className="px-4 py-2.5">{p.contact_rate != null ? `${p.contact_rate}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {byDay.length > 0 && (
            <div className="card p-6 mb-6">
              <h2 className="text-sm font-semibold text-slate-800 mb-3">Динамика по дням</h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={byDay} margin={{ left: 4, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v, n) => [v, n === 'attempts' ? 'Попытки' : 'Контакты']} />
                  <Legend formatter={(v) => v === 'attempts' ? 'Попытки' : 'Контакты'} />
                  <Bar dataKey="attempts" name="attempts" fill="#93c5fd" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="contacts" name="contacts" fill="#22c55e" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Результаты по кейсам (последняя попытка)</h2>
              <p className="text-xs text-slate-400 mt-0.5">1 кейс = 1 итог. Категории «успех / отказ / недозвон» настраиваются отдельно (в разработке).</p>
            </div>
            {byResult.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-400">Нет результатов за период</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Результат</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide w-32">Обращений</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide w-40">Доля</th>
                </tr></thead>
                <tbody>
                  {byResult.map((r) => {
                    const pct = resultTotal > 0 ? Math.round(r.cnt / resultTotal * 100) : 0
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
            )}
          </div>
        </>
      )}
    </div>
  )
}

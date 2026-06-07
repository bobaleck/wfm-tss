import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import type { OperatorLoadRow } from '@/types'
import PageHeader from '@/components/common/PageHeader'
import StatCard from '@/components/common/StatCard'
import { PageSpinner } from '@/components/ui/Spinner'
import EmptyState from '@/components/common/EmptyState'
import { AlertCircle, UserCheck } from 'lucide-react'
import { format, subDays } from 'date-fns'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

export default function OperatorLoadPage() {
  const { activeProject } = useProjectStore()
  const [begin, setBegin] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'))
  const [end, setEnd] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['operator-load', activeProject?.customer_uuid, begin, end],
    queryFn: () =>
      api.get('/analytics/operator-load', {
        params: { partner_uuid: activeProject!.customer_uuid, begin, end },
      }).then((r) => r.data.data as OperatorLoadRow[]),
    enabled: !!activeProject,
  })

  if (!activeProject) return (
    <div><PageHeader title="Нагрузка операторов" />
      <div className="card p-8 flex items-center gap-4 bg-amber-50 border-amber-200">
        <AlertCircle size={20} className="text-amber-500" />
        <p className="text-amber-800">Выберите проект в шапке</p>
      </div>
    </div>
  )

  const filtered = search
    ? (data || []).filter((r) => (r.employee_name || r.login || '').toLowerCase().includes(search.toLowerCase()))
    : (data || [])

  const chartData = [...(data || [])].sort((a, b) => b.handled_calls - a.handled_calls).slice(0, 15)
    .map((r) => ({ name: r.employee_name || r.login, handled: r.handled_calls }))

  const totalHandled = (data || []).reduce((s, r) => s + r.handled_calls, 0)
  const avgSL = (data || []).filter((r) => r.sl_percent != null).length
    ? Math.round((data || []).filter((r) => r.sl_percent != null).reduce((s, r) => s + (r.sl_percent || 0), 0) /
        (data || []).filter((r) => r.sl_percent != null).length)
    : null

  return (
    <div>
      <PageHeader title="Нагрузка операторов" subtitle={`Проект: ${activeProject.customer_name}`} />

      <div className="card p-4 mb-6 flex flex-wrap items-end gap-4">
        <div><label className="label">С</label><input type="date" className="input w-40" value={begin} onChange={(e) => setBegin(e.target.value)} /></div>
        <div><label className="label">По</label><input type="date" className="input w-40" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
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

      {/* Chart top 15 */}
      {chartData.length > 0 && (
        <div className="card p-6 mb-6">
          <h2 className="text-sm font-semibold text-slate-800 mb-4">Топ-15 операторов по звонкам</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="handled" name="Обработано" fill="#2563eb" radius={[0,3,3,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="card overflow-hidden">
        {isLoading ? <PageSpinner /> : filtered.length === 0 ? (
          <EmptyState title="Нет данных" icon={<UserCheck size={40} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  {['Оператор', 'Логин', 'Должность', 'Звонков', 'АНТ (с)', 'Общ. время разг.', 'Простой (мин)', 'Ср. ответ (с)', 'SL (%)'].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{row.employee_name || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{row.login}</td>
                    <td className="px-4 py-3 text-slate-600">{row.position || '—'}</td>
                    <td className="px-4 py-3 font-semibold text-brand-600">{row.handled_calls}</td>
                    <td className="px-4 py-3 text-slate-600">{row.avg_talk_sec ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.total_talk_sec ? `${Math.round(row.total_talk_sec / 60)} мин` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {(row as any).idle_sec != null ? (
                        <span className={`font-medium ${(row as any).idle_sec / 60 > 60 ? 'text-amber-600' : 'text-slate-600'}`}>
                          {Math.round((row as any).idle_sec / 60)} мин
                        </span>
                      ) : '—'}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

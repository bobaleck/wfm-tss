import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { Clock } from 'lucide-react'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import EmptyState from '@/components/common/EmptyState'
import DateRangePicker from '@/components/common/DateRangePicker'
import OutboundProjectFilter, { useOutboundProjects, outboundParams, effectiveProjectIds } from '@/pages/analytics/outboundShared'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'

interface HourRow { hour_num: number; attempts: number; contacts: number }

// «Аналитика (Исход) → Нагрузка»: распределение обзвона по часам суток.
export default function OutboundLoadPage() {
  const { activeProject } = useProjectStore()
  const [begin, setBegin] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [end, setEnd] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'))
  const [selProjects, setSelProjects] = useState<Set<string>>(new Set())

  const { data: projects = [] } = useOutboundProjects(activeProject?.customer_uuid)
  const visibleProjects = useMemo(() => projects.filter((p) => !p.hidden), [projects])
  const eff = useMemo(() => effectiveProjectIds(projects, selProjects), [projects, selProjects])
  const { data, isLoading, isError } = useQuery({
    queryKey: ['outbound-load', activeProject?.customer_uuid, begin, end, eff],
    queryFn: () => api.get('/analytics/outbound-load', outboundParams(activeProject!.customer_uuid, begin, end, eff)).then((r) => r.data.data as HourRow[]),
    enabled: !!activeProject,
  })

  // Полные 24 часа (даже пустые) — ровная шкала.
  const chart = useMemo(() => {
    const map: Record<number, HourRow> = {}
    for (const r of data || []) map[r.hour_num] = r
    return Array.from({ length: 24 }, (_, h) => ({
      label: `${String(h).padStart(2, '0')}:00`,
      attempts: map[h]?.attempts ?? 0,
      contacts: map[h]?.contacts ?? 0,
    }))
  }, [data])
  const hasData = (data || []).some((r) => r.attempts > 0)

  if (!activeProject) return (
    <div><PageHeader title="Обзвон — нагрузка" /><div className="card p-6 text-sm text-amber-700 bg-amber-50">Выберите проект в шапке</div></div>
  )

  return (
    <div>
      <PageHeader
        title="Обзвон — нагрузка по часам"
        subtitle={`Аналитика (Исход) · ${activeProject.customer_name}`}
        actions={
          <div className="flex items-center gap-2">
            <OutboundProjectFilter projects={visibleProjects} selected={selProjects} onChange={setSelProjects} />
            <DateRangePicker begin={begin} end={end} align="right" onChange={(b, e) => { setBegin(b); setEnd(e) }} />
          </div>
        }
      />

      {isLoading ? <PageSpinner /> : isError ? (
        <div className="card p-6 text-sm text-amber-700 bg-amber-50">Не удалось загрузить данные обзвона.</div>
      ) : !hasData ? (
        <EmptyState title="Нет данных обзвона за выбранный период" icon={<Clock size={40} />} />
      ) : (
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Когда звонят — попытки и контакты по часам суток</h2>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={chart} margin={{ left: 4, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-45} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v, n) => [v, n === 'attempts' ? 'Попытки' : 'Контакты']} />
              <Legend formatter={(v) => v === 'attempts' ? 'Попытки' : 'Контакты'} />
              <Bar dataKey="attempts" name="attempts" fill="#93c5fd" radius={[3, 3, 0, 0]} />
              <Bar dataKey="contacts" name="contacts" fill="#22c55e" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

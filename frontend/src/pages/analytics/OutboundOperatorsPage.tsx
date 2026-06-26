import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { Users, ChevronUp, ChevronDown } from 'lucide-react'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import EmptyState from '@/components/common/EmptyState'
import StatCard from '@/components/common/StatCard'
import DateRangePicker from '@/components/common/DateRangePicker'
import OutboundProjectFilter, { useOutboundProjects, outboundParams, effectiveProjectIds } from '@/pages/analytics/outboundShared'

interface OpRow {
  login: string; employee_name: string | null
  attempts: number; contacts: number; contact_rate: number | null
  avg_talk_sec: number | null; cases: number; attempts_per_case: number | null
}

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

// «Аналитика (Исход) → Операторы»: нагрузка операторов на обзвоне за период.
export default function OutboundOperatorsPage() {
  const { activeProject } = useProjectStore()
  const [begin, setBegin] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [end, setEnd] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'))
  const [selProjects, setSelProjects] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState('attempts'); const [dir, setDir] = useState<'asc' | 'desc'>('desc')

  const { data: projects = [] } = useOutboundProjects(activeProject?.customer_uuid)
  const visibleProjects = useMemo(() => projects.filter((p) => !p.hidden), [projects])
  const eff = useMemo(() => effectiveProjectIds(projects, selProjects), [projects, selProjects])
  const { data, isLoading, isError } = useQuery({
    queryKey: ['outbound-operators', activeProject?.customer_uuid, begin, end, eff],
    queryFn: () => api.get('/analytics/outbound-operators', outboundParams(activeProject!.customer_uuid, begin, end, eff)).then((r) => r.data.data as OpRow[]),
    enabled: !!activeProject,
  })

  const rows = data || []
  const totals = rows.reduce((a, o) => ({ attempts: a.attempts + o.attempts, contacts: a.contacts + o.contacts }), { attempts: 0, contacts: 0 })
  const cr = totals.attempts > 0 ? Math.round(totals.contacts / totals.attempts * 100) : 0

  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const av = sort === 'employee_name' ? (a.employee_name || a.login) : (a as any)[sort] ?? -1
    const bv = sort === 'employee_name' ? (b.employee_name || b.login) : (b as any)[sort] ?? -1
    const c = typeof av === 'string' ? String(av).localeCompare(String(bv)) : av - bv
    return dir === 'asc' ? c : -c
  }), [rows, sort, dir])
  const onSort = (k: string) => { if (sort === k) setDir((d) => d === 'asc' ? 'desc' : 'asc'); else { setSort(k); setDir('desc') } }

  if (!activeProject) return (
    <div><PageHeader title="Обзвон — операторы" /><div className="card p-6 text-sm text-amber-700 bg-amber-50">Выберите проект в шапке</div></div>
  )

  return (
    <div>
      <PageHeader
        title="Обзвон — операторы"
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
      ) : rows.length === 0 ? (
        <EmptyState title="Нет операторов обзвона за выбранный период" icon={<Users size={40} />} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <StatCard title="Операторов" value={rows.length.toLocaleString()} color="blue" />
            <StatCard title="Попыток" value={totals.attempts.toLocaleString()} color="purple" />
            <StatCard title="Разговоров" value={totals.contacts.toLocaleString()} color="green" />
            <StatCard title="Доля разговоров" value={`${cr}%`} color="green" />
          </div>

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 border-b border-slate-100">
                  <SortTh label="Оператор" k="employee_name" sort={sort} dir={dir} onSort={onSort} />
                  <SortTh label="Попыток" k="attempts" sort={sort} dir={dir} onSort={onSort} />
                  <SortTh label="Разговоров" k="contacts" sort={sort} dir={dir} onSort={onSort} />
                  <SortTh label="Доля разг." k="contact_rate" sort={sort} dir={dir} onSort={onSort} />
                  <SortTh label="Ср. разговор (с)" k="avg_talk_sec" sort={sort} dir={dir} onSort={onSort} />
                  <SortTh label="Обращений" k="cases" sort={sort} dir={dir} onSort={onSort} />
                  <SortTh label="Попыток/обращ." k="attempts_per_case" sort={sort} dir={dir} onSort={onSort} />
                </tr></thead>
                <tbody>
                  {sorted.map((o) => (
                    <tr key={o.login} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-medium text-slate-900">{o.employee_name || o.login}</td>
                      <td className="px-4 py-2.5 text-brand-600 font-medium">{o.attempts}</td>
                      <td className="px-4 py-2.5 text-green-700">{o.contacts}</td>
                      <td className="px-4 py-2.5">{o.contact_rate != null ? `${o.contact_rate}%` : '—'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{o.avg_talk_sec ?? '—'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{o.cases}</td>
                      <td className="px-4 py-2.5 text-slate-600">{o.attempts_per_case ?? '—'}</td>
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

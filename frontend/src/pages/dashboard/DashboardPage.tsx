import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useProjectStore } from '@/store/project'
import { useAuthStore } from '@/store/auth'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/common/PageHeader'
import StatCard from '@/components/common/StatCard'
import { PageSpinner } from '@/components/ui/Spinner'
import api from '@/api/client'
import { format, subDays } from 'date-fns'
import {
  Users, PhoneCall, TrendingUp, CheckCircle2, AlertCircle, Clock, AlertTriangle,
  UserCheck, Clock4, ArrowRight,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'

export default function DashboardPage() {
  const { activeProject, fetchProjects, projects } = useProjectStore()
  const { user } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => { fetchProjects() }, [])

  const today = new Date()
  const todayStr = format(today, 'yyyy-MM-dd')
  const begin = format(subDays(today, 7), 'yyyy-MM-dd')
  const end = todayStr

  const workloadQuery = useQuery({
    queryKey: ['workload', activeProject?.customer_uuid, begin, end],
    queryFn: () =>
      api.get('/analytics/workload', {
        params: { partner_uuid: activeProject!.customer_uuid, begin, end, interval: 'day' },
      }).then((r) => r.data.data as any[]),
    enabled: !!activeProject,
  })

  const employeesQuery = useQuery({
    queryKey: ['employees-dashboard', activeProject?.customer_uuid],
    queryFn: () =>
      api.get('/employees', {
        params: { project_uuid: activeProject!.customer_uuid, limit: 500 },
      }).then((r) => r.data as any[]),
    enabled: !!activeProject,
  })

  const shiftsQuery = useQuery({
    queryKey: ['shifts-dashboard', todayStr],
    queryFn: () =>
      api.get('/schedules/shifts', { params: { date_from: format(subDays(today, 7), 'yyyy-MM-dd'), date_to: format(subDays(today, -1), 'yyyy-MM-dd') } })
        .then((r) => r.data as any[]),
  })

  const queuesQuery = useQuery({
    queryKey: ['queues-count', activeProject?.customer_uuid],
    queryFn: () =>
      api.get('/analytics/queues', { params: { partner_uuid: activeProject!.customer_uuid } })
        .then((r) => r.data.data as any[]),
    enabled: !!activeProject,
  })

  // ─── Нагрузка ────────────────────────────────────────────────────────────
  const stats = workloadQuery.data || []
  const totalCalls = stats.reduce((s: number, r: any) => s + (r.total || 0), 0)
  const totalHandled = stats.reduce((s: number, r: any) => s + (r.handled || 0), 0)
  const totalLost = stats.reduce((s: number, r: any) => s + (r.lost || 0), 0)
  const slRows = stats.filter((r: any) => r.sl_percent != null)
  const avgSL = slRows.length ? Math.round(slRows.reduce((s: number, r: any) => s + r.sl_percent, 0) / slRows.length) : null

  const byDate: Record<string, { date: string; handled: number; lost: number }> = {}
  for (const row of stats) {
    const date = row.period_start?.slice(0, 10)
    if (!date) continue
    if (!byDate[date]) byDate[date] = { date, handled: 0, lost: 0 }
    byDate[date].handled += row.handled || 0
    byDate[date].lost += row.lost || 0
  }
  const chartData = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))

  // ─── Сотрудники ──────────────────────────────────────────────────────────
  const employees = employeesQuery.data || []
  const empActive = employees.filter((e: any) => e.employment_status === 'active').length
  const empNew = employees.filter((e: any) => e.employment_status === 'new').length
  const empFired = employees.filter((e: any) => e.employment_status === 'fired').length

  // ─── Смены ──────────────────────────────────────────────────────────────
  const allShifts = shiftsQuery.data || []
  const todayShifts = allShifts.filter((s: any) => s.shift_date === todayStr)
  const needsReview = allShifts.filter((s: any) => s.needs_review).length

  // ─── Очереди ─────────────────────────────────────────────────────────────
  const queuesCount = queuesQuery.data?.length ?? null

  return (
    <div>
      <PageHeader
        title={`Сводка${activeProject ? ` — ${activeProject.customer_name}` : ''}`}
        subtitle={`Добро пожаловать, ${user?.full_name || user?.username}!`}
      />

      {!activeProject && (
        <div className="card p-6 mb-6 flex items-center gap-4 bg-amber-50 border-amber-200">
          <AlertCircle size={20} className="text-amber-500 flex-shrink-0" />
          <div>
            <p className="font-medium text-amber-900">Проект не выбран</p>
            <p className="text-sm text-amber-700 mt-0.5">
              Выберите активный проект в шапке. Если проекты не отображаются — настройте интеграцию с Naumen.
            </p>
          </div>
        </div>
      )}

      {needsReview > 0 && (
        <div
          onClick={() => navigate('/worktime/shifts')}
          className="card p-4 mb-6 flex items-center gap-3 bg-amber-50 border-amber-200 cursor-pointer hover:bg-amber-100 transition-colors"
        >
          <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />
          <p className="text-sm font-medium text-amber-800 flex-1">
            {needsReview} {needsReview === 1 ? 'смена требует проверки' : needsReview < 5 ? 'смены требуют проверки' : 'смен требуют проверки'} — расхождение с данными Naumen
          </p>
          <ArrowRight size={14} className="text-amber-500" />
        </div>
      )}

      {/* KPI stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          title="Сотрудников"
          value={activeProject ? empActive : '—'}
          sub={activeProject ? `Новых: ${empNew} · Уволено: ${empFired} · Всего: ${employees.length}` : 'Выберите проект'}
          icon={<Users size={20} />}
          color="blue"
        />
        <StatCard
          title="Звонков за 7 дней"
          value={activeProject ? totalCalls.toLocaleString() : '—'}
          sub={activeProject ? `Обработано: ${totalHandled.toLocaleString()}` : undefined}
          icon={<PhoneCall size={20} />}
          color="purple"
        />
        <StatCard
          title="Потеряно"
          value={activeProject ? totalLost.toLocaleString() : '—'}
          sub={totalCalls ? `${Math.round(totalLost / totalCalls * 100)}% от входящих` : undefined}
          icon={<AlertCircle size={20} />}
          color="red"
        />
        <StatCard
          title="Средний SL"
          value={avgSL !== null ? `${avgSL}%` : '—'}
          sub="за 7 дней"
          icon={<CheckCircle2 size={20} />}
          color="green"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Chart */}
        {activeProject && (
          <div className="card p-6 lg:col-span-2">
            <h2 className="text-sm font-semibold text-slate-800 mb-4">Нагрузка за 7 дней</h2>
            {workloadQuery.isLoading ? (
              <PageSpinner />
            ) : chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="handled" name="Обработано" fill="#2563eb" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="lost" name="Потеряно" fill="#ef4444" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-slate-400 text-center py-8">Нет данных за период</p>
            )}
          </div>
        )}

        {/* Snapshot panel */}
        <div className="space-y-4">
          {/* Today's shifts */}
          <div
            className="card p-5 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => navigate('/worktime/shifts')}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
                <Clock4 size={17} className="text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500">Смены сегодня</p>
                <p className="text-xl font-bold text-slate-900">{todayShifts.length}</p>
              </div>
            </div>
            <div className="flex gap-3 text-xs text-slate-500">
              <span>Запланировано: {todayShifts.filter((s: any) => s.status === 'planned').length}</span>
              <span>Подтверждено: {todayShifts.filter((s: any) => s.status === 'confirmed').length}</span>
            </div>
          </div>

          {/* Employees */}
          {activeProject && (
            <div
              className="card p-5 cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate('/team/employees')}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center">
                  <UserCheck size={17} className="text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Сотрудников</p>
                  <p className="text-xl font-bold text-slate-900">{empActive}</p>
                </div>
              </div>
              <div className="flex gap-3 text-xs">
                <span className="text-blue-600">Новых: {empNew}</span>
                <span className="text-slate-400">Уволено: {empFired}</span>
                <span className="text-slate-500">Всего: {employees.length}</span>
              </div>
            </div>
          )}

          {/* Queues */}
          {activeProject && queuesCount !== null && (
            <div
              className="card p-5 cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate('/analytics/queues')}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center">
                  <PhoneCall size={17} className="text-purple-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Очередей</p>
                  <p className="text-xl font-bold text-slate-900">{queuesCount}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick nav */}
      <div className="card p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-3">Быстрый переход</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Смены', path: '/worktime/shifts', icon: <Clock4 size={15} />, color: 'bg-blue-50 text-blue-700 hover:bg-blue-100' },
            { label: 'Сотрудники', path: '/team/employees', icon: <UserCheck size={15} />, color: 'bg-green-50 text-green-700 hover:bg-green-100' },
            { label: 'Очереди', path: '/analytics/queues', icon: <PhoneCall size={15} />, color: 'bg-purple-50 text-purple-700 hover:bg-purple-100' },
            { label: 'Нагрузка', path: '/analytics/workload', icon: <TrendingUp size={15} />, color: 'bg-orange-50 text-orange-700 hover:bg-orange-100' },
          ].map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${item.color}`}
            >
              {item.icon} {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Projects summary */}
      <div className="card p-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-4">Доступные проекты ({projects.length})</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {projects.slice(0, 9).map((p) => (
            <div
              key={p.customer_uuid}
              className={`p-3 rounded-xl border cursor-pointer transition-all ${
                activeProject?.customer_uuid === p.customer_uuid
                  ? 'border-brand-300 bg-brand-50'
                  : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'
              }`}
            >
              <p className="text-sm font-medium text-slate-800">{p.customer_name}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {p.active_incoming_count} вх · {p.active_outcoming_count} исх
              </p>
            </div>
          ))}
          {projects.length > 9 && (
            <div className="p-3 rounded-xl border border-dashed border-slate-200 flex items-center justify-center">
              <span className="text-sm text-slate-400">+{projects.length - 9} ещё</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

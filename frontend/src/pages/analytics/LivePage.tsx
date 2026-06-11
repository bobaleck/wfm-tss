import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import EmptyState from '@/components/common/EmptyState'
import { AlertCircle, Radio, RefreshCw, Users, UserCheck, Clock, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'

interface CurrentOperator {
  login: string
  employee_name: string | null
  status: string
  entered: string
}

interface ShiftRow {
  employee_id: number
  employee_name: string | null
  naumen_login: string | null
  start_time: string | null
  end_time: string | null
}

const STATUS_LABEL: Record<string, string> = {
  normal: 'В линии',
  ready: 'Готов',
  available: 'Доступен',
  break: 'Пауза',
  lunch: 'Обед',
  training: 'Обучение',
  offline: 'Офлайн',
  unknown: 'Неизвестно',
}

const STATUS_COLOR: Record<string, string> = {
  normal: 'bg-green-100 text-green-700',
  ready: 'bg-emerald-100 text-emerald-700',
  available: 'bg-teal-100 text-teal-700',
  break: 'bg-yellow-100 text-yellow-700',
  lunch: 'bg-orange-100 text-orange-700',
  training: 'bg-blue-100 text-blue-700',
  offline: 'bg-slate-100 text-slate-500',
  unknown: 'bg-slate-100 text-slate-400',
}

function statusLabel(s: string) {
  const key = s.toLowerCase()
  return STATUS_LABEL[key] || s
}
function statusColor(s: string) {
  const key = s.toLowerCase()
  return STATUS_COLOR[key] || 'bg-slate-100 text-slate-400'
}
function isOnline(s: string) {
  const k = s.toLowerCase()
  return k === 'normal' || k === 'ready' || k === 'available'
}
function isPause(s: string) {
  const k = s.toLowerCase()
  return k === 'break' || k === 'lunch' || k === 'training'
}
function minutesAgo(dt: string) {
  const diff = Math.floor((Date.now() - new Date(dt).getTime()) / 60000)
  if (diff < 1) return 'только что'
  if (diff < 60) return `${diff} мин назад`
  return `${Math.floor(diff / 60)}ч ${diff % 60}м назад`
}

export default function LivePage() {
  const { activeProject } = useProjectStore()
  const today = format(new Date(), 'yyyy-MM-dd')
  const currentHour = new Date().getHours()

  const [lastRefreshed, setLastRefreshed] = useState(new Date())

  // Current operator statuses — refetch every 5 minutes
  const { data: currentOps, isLoading: loadingOps, refetch: refetchOps } = useQuery({
    queryKey: ['current-operators', activeProject?.customer_uuid],
    queryFn: () =>
      api.get('/analytics/current-operators', {
        params: { partner_uuid: activeProject!.customer_uuid },
      }).then((r) => {
        setLastRefreshed(new Date())
        return r.data.data as CurrentOperator[]
      }),
    enabled: !!activeProject,
    refetchInterval: 5 * 60 * 1000,
  })

  // Today's planned shifts
  const { data: shiftsData } = useQuery({
    queryKey: ['shifts-today', activeProject?.customer_uuid, today],
    queryFn: () =>
      api.get('/worktime/shifts', {
        params: { project_uuid: activeProject!.customer_uuid, shift_date: today },
      }).then((r) => r.data as ShiftRow[]),
    enabled: !!activeProject,
  })

  // Staffing forecast for today (for current hour comparison)
  const { data: staffingForecast } = useQuery({
    queryKey: ['staffing-forecast-today', activeProject?.customer_uuid],
    queryFn: () =>
      api.get('/analytics/workload', {
        params: {
          partner_uuid: activeProject!.customer_uuid,
          begin: format(new Date(Date.now() - 28 * 86400000), 'yyyy-MM-dd'),
          end: today,
          interval: 'hour',
        },
      }).then((r) => r.data.data),
    enabled: !!activeProject,
  })

  const forecastedNow = useMemo(() => {
    if (!staffingForecast?.length) return null
    const byHour: Record<number, { total: number; count: number }> = {}
    for (const row of staffingForecast) {
      const h = new Date(row.period_start).getHours()
      if (!byHour[h]) byHour[h] = { total: 0, count: 0 }
      byHour[h].total += row.total || 0
      byHour[h].count++
    }
    const h = currentHour
    if (!byHour[h]?.count) return null
    const avgCalls = byHour[h].total / byHour[h].count
    // Simple rough estimate: 1 operator per ~30 calls/hour
    return Math.max(1, Math.round(avgCalls / 30))
  }, [staffingForecast, currentHour])

  const plannedShiftsNow = useMemo(() => {
    if (!shiftsData?.length) return 0
    const now = new Date()
    return (shiftsData as any[]).filter((s) => {
      if (!s.start_time && !s.end_time) return true
      const start = s.start_time ? new Date(`${today}T${s.start_time}`) : null
      const end = s.end_time ? new Date(`${today}T${s.end_time}`) : null
      return (!start || now >= start) && (!end || now <= end)
    }).length
  }, [shiftsData, today])

  const onlineOps = useMemo(() => (currentOps || []).filter((o) => isOnline(o.status)), [currentOps])
  const pauseOps = useMemo(() => (currentOps || []).filter((o) => isPause(o.status)), [currentOps])
  const offlineOps = useMemo(() => (currentOps || []).filter((o) => o.status.toLowerCase() === 'offline'), [currentOps])

  // Operators scheduled but not in the system at all
  const scheduledLogins = useMemo(() => {
    const logins = new Set((shiftsData as any[] || []).map((s: any) => s.naumen_login).filter(Boolean))
    return logins
  }, [shiftsData])

  const absentOps = useMemo(() => {
    if (!shiftsData) return []
    const currentLogins = new Set((currentOps || []).map((o) => o.login))
    return (shiftsData as any[]).filter((s: any) => s.naumen_login && !currentLogins.has(s.naumen_login))
  }, [shiftsData, currentOps])

  const actualOnlineCount = onlineOps.length
  const isUnderstaffed = forecastedNow != null && actualOnlineCount < forecastedNow

  if (!activeProject) return (
    <div>
      <PageHeader title="Онлайн-мониторинг" />
      <div className="card p-8 flex items-center gap-4 bg-amber-50 border-amber-200">
        <AlertCircle size={20} className="text-amber-500" />
        <p className="text-amber-800">Выберите проект в шапке</p>
      </div>
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Онлайн-мониторинг"
        subtitle={activeProject.customer_name}
      />

      {/* Status bar */}
      <div className="flex items-center justify-between mb-5 bg-slate-800 rounded-xl px-5 py-3">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <Radio size={14} className="text-green-400 animate-pulse" />
          <span>Обновление каждые 5 минут · Последнее: {format(lastRefreshed, 'HH:mm:ss')}</span>
        </div>
        <button
          onClick={() => refetchOps()}
          className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white transition-colors"
        >
          <RefreshCw size={13} />
          Обновить сейчас
        </button>
      </div>

      {/* Comparison cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className={`card p-5 ${isUnderstaffed ? 'border-red-300 bg-red-50' : 'border-green-200 bg-green-50'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Прогноз на {currentHour}:00</span>
            {isUnderstaffed && <AlertTriangle size={16} className="text-red-500" />}
          </div>
          <p className="text-3xl font-bold text-slate-900">{forecastedNow ?? '—'}</p>
          <p className="text-xs text-slate-500 mt-1">операторов по прогнозу</p>
        </div>

        <div className="card p-5 border-blue-200 bg-blue-50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Смены сегодня</span>
            <Clock size={16} className="text-blue-400" />
          </div>
          <p className="text-3xl font-bold text-slate-900">{plannedShiftsNow}</p>
          <p className="text-xs text-slate-500 mt-1">запланировано на сейчас</p>
        </div>

        <div className={`card p-5 ${isUnderstaffed ? 'border-red-400 bg-red-100' : 'border-green-300 bg-green-100'}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">В линии сейчас</span>
            <Users size={16} className={isUnderstaffed ? 'text-red-500' : 'text-green-600'} />
          </div>
          <p className={`text-3xl font-bold ${isUnderstaffed ? 'text-red-700' : 'text-green-700'}`}>{actualOnlineCount}</p>
          {forecastedNow != null && (
            <p className={`text-xs font-medium mt-1 ${isUnderstaffed ? 'text-red-600' : 'text-green-600'}`}>
              {isUnderstaffed
                ? `⚠ Нехватка: ${forecastedNow - actualOnlineCount} чел.`
                : `✓ Норма`}
            </p>
          )}
        </div>
      </div>

      {loadingOps ? <PageSpinner /> : !currentOps?.length ? (
        <EmptyState title="Нет данных об операторах" description="Проверьте настройки интеграции с Naumen" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Online operators */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <h2 className="text-sm font-semibold text-slate-800">В линии / активны ({onlineOps.length})</h2>
            </div>
            {onlineOps.length === 0 ? (
              <div className="px-4 py-6 text-center text-slate-400 text-sm">Нет активных операторов</div>
            ) : (
              <div className="divide-y divide-slate-50">
                {onlineOps.map((op) => (
                  <div key={op.login} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{op.employee_name || op.login}</p>
                      <p className="text-xs text-slate-400">{op.login} · {minutesAgo(op.entered)}</p>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor(op.status)}`}>
                      {statusLabel(op.status)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* On pause */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <div className="w-2 h-2 bg-yellow-400 rounded-full" />
              <h2 className="text-sm font-semibold text-slate-800">На паузе ({pauseOps.length})</h2>
            </div>
            {pauseOps.length === 0 ? (
              <div className="px-4 py-6 text-center text-slate-400 text-sm">Никто не на паузе</div>
            ) : (
              <div className="divide-y divide-slate-50">
                {pauseOps.map((op) => (
                  <div key={op.login} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{op.employee_name || op.login}</p>
                      <p className="text-xs text-slate-400">{op.login} · {minutesAgo(op.entered)}</p>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColor(op.status)}`}>
                      {statusLabel(op.status)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Scheduled but absent */}
          {absentOps.length > 0 && (
            <div className="card overflow-hidden border-red-200">
              <div className="px-4 py-3 border-b border-red-100 flex items-center gap-2 bg-red-50">
                <AlertTriangle size={14} className="text-red-500" />
                <h2 className="text-sm font-semibold text-red-700">Запланированы, но не в системе ({absentOps.length})</h2>
              </div>
              <div className="divide-y divide-slate-50">
                {absentOps.map((s: any) => (
                  <div key={s.employee_id || s.naumen_login} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{s.employee_name || s.naumen_login}</p>
                      {s.start_time && s.end_time && (
                        <p className="text-xs text-slate-400">{s.start_time} — {s.end_time}</p>
                      )}
                    </div>
                    <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-red-100 text-red-700">
                      Отсутствует
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Offline but tracked */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <div className="w-2 h-2 bg-slate-400 rounded-full" />
              <h2 className="text-sm font-semibold text-slate-800">Офлайн ({offlineOps.length})</h2>
            </div>
            {offlineOps.length === 0 ? (
              <div className="px-4 py-6 text-center text-slate-400 text-sm">Нет офлайн операторов</div>
            ) : (
              <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
                {offlineOps.map((op) => (
                  <div key={op.login} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-slate-600">{op.employee_name || op.login}</p>
                      <p className="text-xs text-slate-400">{op.login} · {minutesAgo(op.entered)}</p>
                    </div>
                    <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-500">
                      Офлайн
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import EmptyState from '@/components/common/EmptyState'
import { AlertCircle, Radio, RefreshCw, Users, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { requiredAgents } from '@/utils/erlang'

interface CurrentOperator {
  login: string
  employee_name: string | null
  status: string
  entered: string
}

const REFRESH_MS = 5 * 60 * 1000

const STATUS_LABEL: Record<string, string> = {
  normal: 'В линии',
  ready: 'Готов',
  available: 'Доступен',
  ringing: 'Вызов',
  speaking: 'Разговор',
  inservice: 'Обслуживание',
  'ringing#voice': 'Вызов',
  'speaking#voice': 'Разговор',
  break: 'Перерыв',
  lunch: 'Обед',
  training: 'Обучение',
  offline: 'Офлайн',
  logged_out: 'Вышел',
  signedoff: 'Вышел',
  loggedoff: 'Вышел',
}

const STATUS_COLOR: Record<string, string> = {
  normal: 'bg-green-100 text-green-700',
  ready: 'bg-emerald-100 text-emerald-700',
  available: 'bg-teal-100 text-teal-700',
  ringing: 'bg-cyan-100 text-cyan-700',
  speaking: 'bg-blue-100 text-blue-700',
  inservice: 'bg-blue-100 text-blue-700',
  'ringing#voice': 'bg-cyan-100 text-cyan-700',
  'speaking#voice': 'bg-blue-100 text-blue-700',
  break: 'bg-yellow-100 text-yellow-700',
  lunch: 'bg-orange-100 text-orange-700',
  training: 'bg-purple-100 text-purple-700',
  offline: 'bg-slate-100 text-slate-500',
  logged_out: 'bg-slate-100 text-slate-400',
  signedoff: 'bg-slate-100 text-slate-400',
  loggedoff: 'bg-slate-100 text-slate-400',
}

function statusLabel(s: string) { return STATUS_LABEL[s.toLowerCase()] ?? s }
function statusColor(s: string) { return STATUS_COLOR[s.toLowerCase()] ?? 'bg-slate-100 text-slate-400' }

function isOnline(s: string) {
  const k = s.toLowerCase()
  return ['normal', 'ready', 'available', 'ringing', 'speaking', 'inservice',
    'ringing#voice', 'speaking#voice'].includes(k)
}
function isPause(s: string) {
  const k = s.toLowerCase()
  return !isOnline(k) && !['offline', 'logged_out', 'signedoff', 'loggedoff'].includes(k)
}
function isOffline(s: string) {
  const k = s.toLowerCase()
  return ['offline', 'logged_out', 'signedoff', 'loggedoff'].includes(k)
}

// Operators with status older than STALE_H hours are treated as "left" even if status=online
const STALE_H = 12
function isStale(entered: string) {
  return Date.now() - new Date(entered).getTime() > STALE_H * 3600 * 1000
}

function minutesAgo(dt: string) {
  const diff = Math.floor((Date.now() - new Date(dt).getTime()) / 60000)
  if (diff < 1) return 'только что'
  if (diff < 60) return `${diff} мин назад`
  const h = Math.floor(diff / 60)
  const m = diff % 60
  return m > 0 ? `${h}ч ${m}м назад` : `${h}ч назад`
}

function OpRow({ op }: { op: CurrentOperator }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 group">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{op.employee_name || op.login}</p>
        <p className="text-xs text-slate-400">{op.login} · {minutesAgo(op.entered)}</p>
      </div>
      <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ml-2 ${statusColor(op.status)}`}>
        {statusLabel(op.status)}
      </span>
    </div>
  )
}

function Section({
  dot, dotColor, title, count, children, empty,
}: {
  dot: string; dotColor: string; title: string; count: number; children: React.ReactNode; empty: string
}) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
        <h2 className="text-sm font-semibold text-slate-800">{title} ({count})</h2>
      </div>
      {count === 0 ? (
        <div className="px-4 py-6 text-center text-slate-400 text-sm">{empty}</div>
      ) : (
        <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">{children}</div>
      )}
    </div>
  )
}

export default function LivePage() {
  const { activeProject } = useProjectStore()
  const today = format(new Date(), 'yyyy-MM-dd')
  const currentHour = new Date().getHours()
  const [lastRefreshed, setLastRefreshed] = useState(new Date())

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
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
  })

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
    staleTime: 30 * 60 * 1000,
  })

  const forecastedNow = useMemo(() => {
    if (!staffingForecast?.length) return null
    const byHour: Record<number, { calls: number[]; ahts: number[] }> = {}
    for (const row of staffingForecast) {
      const h = new Date(row.period_start).getHours()
      if (!byHour[h]) byHour[h] = { calls: [], ahts: [] }
      byHour[h].calls.push(row.total || 0)
      if (row.avg_talk_sec) byHour[h].ahts.push(row.avg_talk_sec)
    }
    const h = currentHour
    if (!byHour[h]?.calls.length) return null
    const avgCalls = byHour[h].calls.reduce((a, b) => a + b, 0) / byHour[h].calls.length
    const avgAHT = byHour[h].ahts.length
      ? byHour[h].ahts.reduce((a, b) => a + b, 0) / byHour[h].ahts.length
      : 180
    const min = requiredAgents(avgCalls, avgAHT, 80, 20)
    // Apply 30% shrinkage
    return Math.max(1, Math.round(min / (1 - 0.30)))
  }, [staffingForecast, currentHour])

  // Categorize operators
  const onlineOps = useMemo(
    () => (currentOps || []).filter((o) => isOnline(o.status) && !isStale(o.entered)),
    [currentOps],
  )
  const pauseOps = useMemo(
    () => (currentOps || []).filter((o) => isPause(o.status) && !isStale(o.entered)),
    [currentOps],
  )
  // Recent offline = explicit offline status OR stale online/pause (logged off without recording it)
  const recentOfflineOps = useMemo(
    () => (currentOps || []).filter(
      (o) => isOffline(o.status) || (isOnline(o.status) && isStale(o.entered)) || (isPause(o.status) && isStale(o.entered)),
    ),
    [currentOps],
  )

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
      <PageHeader title="Онлайн-мониторинг" subtitle={activeProject.customer_name} />

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
          <RefreshCw size={13} /> Обновить сейчас
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className={`card p-5 ${isUnderstaffed ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Требуется на {String(currentHour).padStart(2, '0')}:00
          </p>
          <p className="text-3xl font-bold text-slate-900">{forecastedNow ?? '—'}</p>
          <p className="text-xs text-slate-500 mt-1">по Erlang C (SL 80% / 20с, shrinkage 30%)</p>
        </div>

        <div className={`card p-5 ${isUnderstaffed ? 'border-red-400 bg-red-100' : 'border-green-300 bg-green-100'}`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">В линии сейчас</p>
            <Users size={16} className={isUnderstaffed ? 'text-red-500' : 'text-green-600'} />
          </div>
          <p className={`text-3xl font-bold ${isUnderstaffed ? 'text-red-700' : 'text-green-700'}`}>{actualOnlineCount}</p>
          {forecastedNow != null && (
            <p className={`text-xs font-medium mt-1 ${isUnderstaffed ? 'text-red-600' : 'text-green-600'}`}>
              {isUnderstaffed
                ? `⚠ Нехватка: ${forecastedNow - actualOnlineCount} чел.`
                : '✓ Норма'}
            </p>
          )}
        </div>

        <div className="card p-5 border-slate-200">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">На паузе</p>
          <p className="text-3xl font-bold text-slate-900">{pauseOps.length}</p>
          <p className="text-xs text-slate-500 mt-1">
            Вышли за 24ч: {recentOfflineOps.length}
          </p>
        </div>
      </div>

      {loadingOps ? <PageSpinner /> : !currentOps?.length ? (
        <EmptyState title="Нет данных об операторах" description="Проверьте настройки интеграции с Naumen" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Section
            dot="w-2 h-2 bg-green-500 animate-pulse"
            dotColor="bg-green-500 animate-pulse"
            title="В линии / активны"
            count={onlineOps.length}
            empty="Нет активных операторов"
          >
            {onlineOps.map((op) => <OpRow key={op.login} op={op} />)}
          </Section>

          <Section
            dot="w-2 h-2 bg-yellow-400"
            dotColor="bg-yellow-400"
            title="На паузе"
            count={pauseOps.length}
            empty="Никто не на паузе"
          >
            {pauseOps.map((op) => <OpRow key={op.login} op={op} />)}
          </Section>

          <Section
            dot="w-2 h-2 bg-slate-400"
            dotColor="bg-slate-400"
            title="Вышли за 24 часа"
            count={recentOfflineOps.length}
            empty="Нет офлайн операторов"
          >
            {recentOfflineOps.map((op) => <OpRow key={op.login} op={op} />)}
          </Section>

          {/* Placeholder for layout symmetry if needed */}
          <div className="card p-5 border-dashed border-slate-200 hidden lg:flex items-center justify-center text-slate-300 text-sm">
            Данные обновляются автоматически каждые 5 минут
          </div>
        </div>
      )}
    </div>
  )
}

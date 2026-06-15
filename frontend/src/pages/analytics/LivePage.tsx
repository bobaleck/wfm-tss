import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import EmptyState from '@/components/common/EmptyState'
import { AlertCircle, Radio, RefreshCw, Users } from 'lucide-react'
import { format } from 'date-fns'
import { requiredAgents } from '@/utils/erlang'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'

interface CurrentOperator {
  login: string
  employee_name: string | null
  status: string
  entered: string
}

const REFRESH_MS = 5 * 60 * 1000
const WINDOW_H = 24   // show operators whose last status is within this window
const STALE_ONLINE_H = 12 // if online status is older than this, treat as "left"

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
  away: 'Отсутствует',
  notavailable: 'Недоступен',
  not_available: 'Недоступен',
  wrapup: 'После звонка',
  'wrapup#voice': 'После звонка',
  acw: 'После звонка',
  busy: 'Занят',
  offline: 'Офлайн',
  logged_out: 'Вышел',
  signedoff: 'Вышел',
  loggedoff: 'Вышел',
  disconnected: 'Отключён',
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
  away: 'bg-amber-100 text-amber-700',
  notavailable: 'bg-red-100 text-red-600',
  not_available: 'bg-red-100 text-red-600',
  wrapup: 'bg-sky-100 text-sky-700',
  'wrapup#voice': 'bg-sky-100 text-sky-700',
  acw: 'bg-sky-100 text-sky-700',
  busy: 'bg-rose-100 text-rose-700',
  offline: 'bg-slate-100 text-slate-500',
  logged_out: 'bg-slate-100 text-slate-400',
  signedoff: 'bg-slate-100 text-slate-400',
  loggedoff: 'bg-slate-100 text-slate-400',
  disconnected: 'bg-slate-100 text-slate-400',
}

const WORK_STATUSES = new Set([
  'normal', 'ready', 'available', 'ringing', 'speaking', 'inservice',
  'ringing#voice', 'speaking#voice',
  'wrapup', 'wrapup#voice', 'acw',
])
const OFFLINE_STATUSES = new Set([
  'offline', 'logged_out', 'signedoff', 'loggedoff', 'disconnected',
  'away', 'notavailable', 'not_available',
])

// Custom* statuses in Naumen CC are always operator-defined pauses (breaks), never work statuses.
function statusLabel(s: string) {
  const k = s.toLowerCase()
  if (STATUS_LABEL[k]) return STATUS_LABEL[k]
  if (k.startsWith('custom')) return `Перерыв (${s})`
  return s
}
function statusColor(s: string) {
  const k = s.toLowerCase()
  if (STATUS_COLOR[k]) return STATUS_COLOR[k]
  if (k.startsWith('custom')) return 'bg-amber-100 text-amber-700'
  return 'bg-slate-100 text-slate-500'
}
function isOnline(s: string) { return WORK_STATUSES.has(s.toLowerCase()) }
function isPause(s: string) { const k = s.toLowerCase(); return !WORK_STATUSES.has(k) && !OFFLINE_STATUSES.has(k) }
function isOffline(s: string) { return OFFLINE_STATUSES.has(s.toLowerCase()) }

function withinWindow(entered: string, hours: number) {
  return Date.now() - new Date(entered).getTime() <= hours * 3600 * 1000
}

function minutesAgo(dt: string) {
  const diff = Math.floor((Date.now() - new Date(dt).getTime()) / 60000)
  if (diff < 1) return 'только что'
  if (diff < 60) return `${diff} мин назад`
  const h = Math.floor(diff / 60)
  const m = diff % 60
  return m > 0 ? `${h}ч ${m}м назад` : `${h}ч назад`
}

function OpRow({ op, labelFn = statusLabel }: { op: CurrentOperator; labelFn?: (s: string) => string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{op.employee_name || op.login}</p>
        <p className="text-xs text-slate-400">{op.login} · {minutesAgo(op.entered)}</p>
      </div>
      <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ml-2 ${statusColor(op.status)}`}>
        {labelFn(op.status)}
      </span>
    </div>
  )
}

function Section({
  dotColor, title, count, children, empty,
}: {
  dotColor: string; title: string; count: number; children: React.ReactNode; empty: string
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

const DONUT_COLORS = ['#16a34a', '#f59e0b', '#94a3b8']
const RADIAN = Math.PI / 180
function DonutLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) {
  if (percent < 0.05) return null
  const r = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600}>
      {Math.round(percent * 100)}%
    </text>
  )
}

export default function LivePage() {
  const { activeProject } = useProjectStore()
  const today = format(new Date(), 'yyyy-MM-dd')
  const currentHour = new Date().getHours()
  const [lastRefreshed, setLastRefreshed] = useState(new Date())

  const { data: statusConfigs } = useQuery({
    queryKey: ['status-configs'],
    queryFn: () => api.get('/status-configs').then((r) => r.data as Array<{ status_name: string; classification: string; label: string | null }>),
    staleTime: 10 * 60 * 1000,
  })

  const customClassMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of statusConfigs || []) m[c.status_name.toLowerCase()] = c.classification
    return m
  }, [statusConfigs])

  const customLabelMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of statusConfigs || []) if (c.label) m[c.status_name.toLowerCase()] = c.label
    return m
  }, [statusConfigs])

  function classifyStatus(s: string): 'work' | 'pause' | 'offline' {
    const k = s.toLowerCase()
    if (WORK_STATUSES.has(k)) return 'work'
    if (OFFLINE_STATUSES.has(k)) return 'offline'
    if (customClassMap[k] === 'work') return 'work'
    if (customClassMap[k] === 'offline') return 'offline'
    return 'pause'
  }

  function statusLabelEx(s: string) {
    const k = s.toLowerCase()
    if (customLabelMap[k]) return customLabelMap[k]
    return statusLabel(s)
  }

  const { data: currentOps, isLoading: loadingOps, refetch: refetchOps } = useQuery({
    queryKey: ['current-operators', activeProject?.customer_uuid],
    queryFn: () =>
      api.get('/analytics/current-operators', {
        params: { partner_uuid: activeProject!.customer_uuid },
      }).then((r) => {
        setLastRefreshed(new Date())
        return r.data.data as CurrentOperator[]
      }),
    enabled: !!activeProject?.customer_uuid,
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
    enabled: !!activeProject?.customer_uuid,
    staleTime: 5 * 60 * 1000,
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
    return Math.max(1, Math.round(min / (1 - 0.30)))
  }, [staffingForecast, currentHour])

  // All operators with status within 24h window
  const recentOps = useMemo(
    () => (currentOps || []).filter((o) => withinWindow(o.entered, WINDOW_H)),
    [currentOps],
  )

  const onlineOps = useMemo(
    () => recentOps.filter((o) => classifyStatus(o.status) === 'work' && withinWindow(o.entered, STALE_ONLINE_H)),
    [recentOps, customClassMap],
  )
  const pauseOps = useMemo(
    () => recentOps.filter((o) => classifyStatus(o.status) === 'pause'),
    [recentOps, customClassMap],
  )
  const offlineOps = useMemo(
    () => recentOps.filter(
      (o) => classifyStatus(o.status) === 'offline' || (classifyStatus(o.status) === 'work' && !withinWindow(o.entered, STALE_ONLINE_H)),
    ),
    [recentOps, customClassMap],
  )

  const actualOnlineCount = onlineOps.length
  const isUnderstaffed = forecastedNow != null && actualOnlineCount < forecastedNow

  const donutData = [
    { name: 'В линии', value: onlineOps.length },
    { name: 'На паузе', value: pauseOps.length },
    { name: 'Вышли', value: offlineOps.length },
  ].filter((d) => d.value > 0)

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
          onClick={() => { setLastRefreshed(new Date()); refetchOps() }}
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
          <p className="text-xs text-slate-500 mt-1">Erlang C · SL 80%/20с · shrinkage 30%</p>
        </div>

        <div className={`card p-5 ${isUnderstaffed ? 'border-red-400 bg-red-100' : 'border-green-300 bg-green-100'}`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">В линии сейчас</p>
            <Users size={16} className={isUnderstaffed ? 'text-red-500' : 'text-green-600'} />
          </div>
          <p className={`text-3xl font-bold ${isUnderstaffed ? 'text-red-700' : 'text-green-700'}`}>{actualOnlineCount}</p>
          {forecastedNow != null && (
            <p className={`text-xs font-medium mt-1 ${isUnderstaffed ? 'text-red-600' : 'text-green-600'}`}>
              {isUnderstaffed ? `⚠ Нехватка: ${forecastedNow - actualOnlineCount} чел.` : '✓ Норма'}
            </p>
          )}
        </div>

        <div className="card p-5 border-slate-200">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">На паузе / Вышли</p>
          <p className="text-3xl font-bold text-slate-900">{pauseOps.length}</p>
          <p className="text-xs text-slate-500 mt-1">Вышли за 24ч: {offlineOps.length}</p>
        </div>
      </div>

      {loadingOps ? <PageSpinner /> : !recentOps.length ? (
        <EmptyState title="Нет данных за последние 24 часа" description="Проверьте настройки интеграции с Naumen" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Section
            dotColor="bg-green-500 animate-pulse"
            title="В линии / активны"
            count={onlineOps.length}
            empty="Нет активных операторов"
          >
            {onlineOps.map((op) => <OpRow key={op.login} op={op} labelFn={statusLabelEx} />)}
          </Section>

          <Section
            dotColor="bg-yellow-400"
            title="На паузе"
            count={pauseOps.length}
            empty="Никто не на паузе"
          >
            {pauseOps.map((op) => <OpRow key={op.login} op={op} labelFn={statusLabelEx} />)}
          </Section>

          <Section
            dotColor="bg-slate-400"
            title="Вышли за 24 часа"
            count={offlineOps.length}
            empty="Нет офлайн операторов"
          >
            {offlineOps.map((op) => <OpRow key={op.login} op={op} labelFn={statusLabelEx} />)}
          </Section>

          {/* Activity donut chart */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-800 mb-1">Активность операторов</h2>
            <p className="text-xs text-slate-400 mb-3">За последние 24 часа · всего {recentOps.length} чел.</p>
            {donutData.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-slate-300 text-sm">Нет данных</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={donutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    dataKey="value"
                    labelLine={false}
                    label={DonutLabel}
                  >
                    {donutData.map((_, index) => (
                      <Cell key={index} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val, name) => [`${val} чел.`, name]} />
                  <Legend
                    formatter={(val, entry: any) => (
                      <span className="text-xs text-slate-700">
                        {val} — {entry.payload?.value} чел.
                      </span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

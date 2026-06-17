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
import { useStatusClassifier } from '@/utils/statusClassification'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import StatusTimeline from '@/components/StatusTimeline'

interface CurrentOperator {
  login: string
  employee_name: string | null
  status: string
  entered: string
}

const REFRESH_MS = 5 * 60 * 1000
const WINDOW_H = 24   // show operators whose last status is within this window
const STALE_ONLINE_H = 12 // if online status is older than this, treat as "left"

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

function elapsedSec(entered: string) {
  return (Date.now() - new Date(entered).getTime()) / 1000
}

function OpRow({ op, labelFn, colorFn, onClick }: { op: CurrentOperator; labelFn: (s: string, d?: number) => string; colorFn: (s: string, d?: number) => string; onClick: () => void }) {
  const dur = elapsedSec(op.entered)
  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50"
      title="Показать историю статусов"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{op.employee_name || op.login}</p>
        <p className="text-xs text-slate-400">{op.login} · с {op.entered.slice(11, 16)}</p>
      </div>
      <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ml-2 ${colorFn(op.status, dur)}`}>
        {labelFn(op.status, dur)}
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

function renderOpList(
  ops: CurrentOperator[],
  labelFn: (s: string, d?: number) => string,
  colorFn: (s: string, d?: number) => string,
  expandedLogins: Set<string>,
  toggleExpanded: (login: string) => void,
  partnerUuid: string | undefined,
) {
  return ops.map((op) => (
    <div key={op.login}>
      <OpRow op={op} labelFn={labelFn} colorFn={colorFn} onClick={() => toggleExpanded(op.login)} />
      {expandedLogins.has(op.login) && (
        <StatusTimeline login={op.login} hours={24} partnerUuid={partnerUuid} employeeName={op.employee_name || op.login} />
      )}
    </div>
  ))
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
  const [expandedLogins, setExpandedLogins] = useState<Set<string>>(new Set())
  const toggleExpanded = (login: string) =>
    setExpandedLogins((prev) => { const n = new Set(prev); n.has(login) ? n.delete(login) : n.add(login); return n })

  const { classify, label: labelEx, color: colorEx } = useStatusClassifier(activeProject?.customer_uuid)

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
    () => recentOps.filter((o) => classify(o.status, elapsedSec(o.entered)) === 'work' && withinWindow(o.entered, STALE_ONLINE_H)),
    [recentOps, classify],
  )
  const pauseOps = useMemo(
    () => recentOps.filter((o) => classify(o.status, elapsedSec(o.entered)) === 'pause'),
    [recentOps, classify],
  )
  const offlineOps = useMemo(
    () => recentOps.filter((o) => {
      const grp = classify(o.status, elapsedSec(o.entered))
      return grp === 'offline' || (grp === 'work' && !withinWindow(o.entered, STALE_ONLINE_H))
    }),
    [recentOps, classify],
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
            {renderOpList(onlineOps, labelEx, colorEx, expandedLogins, toggleExpanded, activeProject.customer_uuid)}
          </Section>

          <Section
            dotColor="bg-yellow-400"
            title="На паузе"
            count={pauseOps.length}
            empty="Никто не на паузе"
          >
            {renderOpList(pauseOps, labelEx, colorEx, expandedLogins, toggleExpanded, activeProject.customer_uuid)}
          </Section>

          <Section
            dotColor="bg-slate-400"
            title="Вышли за 24 часа"
            count={offlineOps.length}
            empty="Нет офлайн операторов"
          >
            {renderOpList(offlineOps, labelEx, colorEx, expandedLogins, toggleExpanded, activeProject.customer_uuid)}
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

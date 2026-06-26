import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import EmptyState from '@/components/common/EmptyState'
import { AlertCircle, Radio, RefreshCw, Users, Search } from 'lucide-react'
import { format } from 'date-fns'
import { requiredAgents } from '@/utils/erlang'
import { useStatusClassifier } from '@/utils/statusClassification'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import StatusTimeline from '@/components/StatusTimeline'
import MonitoringStats from '@/pages/analytics/MonitoringStats'
import OutboundMonitoringStats from '@/pages/analytics/OutboundMonitoringStats'
import QueueFilterDropdown from '@/components/common/QueueFilterDropdown'

interface CurrentOperator {
  login: string
  employee_name: string | null
  status: string
  entered: string
  queues?: string[]
}

const REFRESH_MS = 5 * 1000   // онлайн-данные обновляются автоматически раз в 5 секунд
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
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-sm font-medium text-slate-800 truncate">{op.employee_name || op.login}</p>
          {(op.queues || []).map((q) => (
            <span key={q} className="text-[10px] leading-none px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium whitespace-nowrap">{q}</span>
          ))}
        </div>
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
  const [tab, setTab] = useState<'operators' | 'stats'>('operators')
  const [lastRefreshed, setLastRefreshed] = useState(new Date())
  const [selectedQueues, setSelectedQueues] = useState<Set<string>>(new Set())
  const [opSearch, setOpSearch] = useState('')
  const [expandedLogins, setExpandedLogins] = useState<Set<string>>(new Set())
  const toggleExpanded = (login: string) =>
    setExpandedLogins((prev) => { const n = new Set(prev); n.has(login) ? n.delete(login) : n.add(login); return n })

  // Линия мониторинга: вход / исход. Зависит от линий проекта; если есть обе —
  // показываем переключатель. Очереди и статистика меняются под выбранную линию.
  const hasInbound = activeProject?.has_inbound ?? true
  const hasOutbound = activeProject?.has_outbound ?? false
  const [lineSel, setLineSel] = useState<'in' | 'out'>('in')
  const line: 'in' | 'out' = (lineSel === 'out' && hasOutbound) ? 'out' : (hasInbound ? 'in' : (hasOutbound ? 'out' : 'in'))

  const { classify, label: labelEx, color: colorEx } = useStatusClassifier(activeProject?.customer_uuid)

  const { data: currentOps, isLoading: loadingOps, refetch: refetchOps } = useQuery({
    queryKey: ['current-operators', line, activeProject?.customer_uuid],
    queryFn: () =>
      api.get(line === 'out' ? '/analytics/current-operators-outbound' : '/analytics/current-operators', {
        params: { partner_uuid: activeProject!.customer_uuid },
      }).then((r) => {
        setLastRefreshed(new Date())
        return r.data.data as CurrentOperator[]
      }),
    enabled: !!activeProject?.customer_uuid,
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
  })

  // Сводка обзвона за последний час — для карточек линии «Исход».
  const { data: outRecent } = useQuery({
    queryKey: ['recent-stats-outbound-60', activeProject?.customer_uuid],
    queryFn: () =>
      api.get('/analytics/recent-stats-outbound', {
        params: { partner_uuid: activeProject!.customer_uuid, window_min: 60 },
      }).then((r) => r.data as { by_operator: { attempts: number; contacts: number }[] }),
    enabled: !!activeProject?.customer_uuid && line === 'out',
    // Карточки «за час» — не нужны каждые 5 секунд; реже опрашиваем тяжёлый
    // запрос по detail_outbound_sessions_ms, чтобы не нагружать Naumen.
    refetchInterval: 30 * 1000,
    staleTime: 30 * 1000,
  })
  const outAttempts1h = (outRecent?.by_operator || []).reduce((a, o) => a + (o.attempts || 0), 0)
  const outContacts1h = (outRecent?.by_operator || []).reduce((a, o) => a + (o.contacts || 0), 0)

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

  // Смены на сегодня — для блока «По графику» (кто должен работать сейчас)
  const { data: todayShifts } = useQuery({
    queryKey: ['today-shifts', activeProject?.customer_uuid, today],
    queryFn: () =>
      api.get('/schedules/shifts', { params: { project_uuid: activeProject!.customer_uuid, date_from: today, date_to: today } })
        .then((r) => r.data as any[]),
    enabled: !!activeProject?.customer_uuid,
    refetchInterval: REFRESH_MS,
  })
  const scheduledNow = useMemo(() => {
    const now = Date.now()
    return (todayShifts || []).filter((s: any) =>
      s.start_time && s.end_time &&
      now >= new Date(s.start_time).getTime() && now <= new Date(s.end_time).getTime())
  }, [todayShifts, lastRefreshed])

  // «По графику сейчас» с учётом линии, выбранных очередей и поиска:
  // — смена с заданной линией показывается только на своей линии (без линии — на всех);
  // — при выбранных очередях показываем смены с пересечением (без очереди — во всех);
  // — плюс поиск по сотруднику.
  const scheduledShown = useMemo(() => scheduledNow.filter((s: any) => {
    const slines = s.line ? String(s.line).split(',').map((x: string) => x.trim()).filter(Boolean) : []
    const sq = s.queue_names ? String(s.queue_names).split(',').map((x: string) => x.trim()).filter(Boolean) : []
    if (slines.length && !slines.includes(line)) return false
    if (selectedQueues.size > 0 && sq.length > 0 && !sq.some((q: string) => selectedQueues.has(q))) return false
    const nm = (s.employee_name || `#${s.employee_id}`)
    return !opSearch.trim() || nm.toLowerCase().includes(opSearch.trim().toLowerCase())
  }), [scheduledNow, line, selectedQueues, opSearch])

  // SL за последние сутки (по проекту, взвешенно по числу звонков)
  const { data: dayStats } = useQuery({
    queryKey: ['live-24h-sl', activeProject?.customer_uuid],
    queryFn: () =>
      api.get('/analytics/workload', {
        params: { partner_uuid: activeProject!.customer_uuid, begin: format(new Date(Date.now() - 86400000), 'yyyy-MM-dd'), end: today, interval: 'day' },
      }).then((r) => r.data.data as any[]),
    enabled: !!activeProject?.customer_uuid,
    refetchInterval: REFRESH_MS,
    staleTime: REFRESH_MS,
  })
  const sl24 = useMemo(() => {
    let num = 0, den = 0
    for (const r of (dayStats || [])) {
      if (r.sl_percent == null) continue
      const w = r.total || 0; num += (r.sl_percent || 0) * w; den += w
    }
    return den > 0 ? Math.round(num / den) : null
  }, [dayStats])

  const forecastedNow = useMemo(() => {
    if (!staffingForecast?.length) return null
    // Суммируем звонки по всем очередям в пределах одного (день, час), затем
    // усредняем по дням — ИДЕНТИЧНО разделу «Потребность». Раньше каждая
    // строка-очередь усреднялась отдельно, поэтому при нескольких очередях
    // прогноз делился на их число и сильно занижался (отсюда расхождение
    // «7 в Онлайн против 20 в Потребности»).
    const agg: Record<number, { total: number; ahtSum: number; ahtCount: number; days: Set<string> }> = {}
    for (const row of staffingForecast) {
      if (!row.period_start) continue
      const h = new Date(row.period_start).getHours()
      const dayKey = row.period_start.slice(0, 10)
      if (!agg[h]) agg[h] = { total: 0, ahtSum: 0, ahtCount: 0, days: new Set() }
      agg[h].total += row.total || 0
      agg[h].days.add(dayKey)
      if (row.avg_talk_sec) { agg[h].ahtSum += row.avg_talk_sec; agg[h].ahtCount++ }
    }
    const a = agg[currentHour]
    if (!a || a.days.size === 0) return null
    const avgCalls = a.total / a.days.size
    const avgAHT = a.ahtCount ? a.ahtSum / a.ahtCount : 180
    const min = requiredAgents(avgCalls, avgAHT, 80, 20)
    return Math.max(1, Math.ceil(min / (1 - 0.30)))
  }, [staffingForecast, currentHour])

  // Исходящие подпроекты — чтобы фильтр очередей не пропадал на линии «Исход».
  const { data: outboundProjects } = useQuery({
    queryKey: ['outbound-projects', activeProject?.customer_uuid],
    queryFn: () => api.get('/analytics/outbound-projects', { params: { partner_uuid: activeProject!.customer_uuid } }).then((r) => r.data.data as { name: string; hidden?: boolean }[]),
    enabled: !!activeProject?.customer_uuid && line === 'out',
    staleTime: 10 * 60 * 1000,
  })

  // Очереди для фильтра: на «Вход» — очереди операторов, на «Исход» — исходящие
  // подпроекты (не зависят от наличия онлайн-операторов, поэтому фильтр не пропадает;
  // скрытые подпроекты исключаем).
  const opQueues = useMemo(() => [...new Set((currentOps || []).flatMap((o) => o.queues || []))].sort(), [currentOps])
  const allQueues = useMemo(() => {
    if (line === 'out') {
      const names = new Set<string>()
      for (const p of (outboundProjects || [])) if (!p.hidden && p.name) names.add(p.name)
      for (const q of opQueues) names.add(q)   // подстраховка очередями онлайн-операторов
      return [...names].sort()
    }
    return opQueues
  }, [line, outboundProjects, opQueues])

  // Поиск по сотруднику — общий для всех окон.
  const matchSearch = (name: string) => !opSearch.trim() || name.toLowerCase().includes(opSearch.trim().toLowerCase())

  // All operators with status within 24h window, отфильтрованные по очередям и поиску.
  const recentOps = useMemo(
    () => (currentOps || []).filter((o) =>
      withinWindow(o.entered, WINDOW_H) &&
      (selectedQueues.size === 0 || (o.queues || []).some((q) => selectedQueues.has(q))) &&
      (!opSearch.trim() || (o.employee_name || o.login).toLowerCase().includes(opSearch.trim().toLowerCase()))),
    [currentOps, selectedQueues, opSearch],
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
      <PageHeader title="Мониторинг" />
      <div className="card p-8 flex items-center gap-4 bg-amber-50 border-amber-200">
        <AlertCircle size={20} className="text-amber-500" />
        <p className="text-amber-800">Выберите проект в шапке</p>
      </div>
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Мониторинг"
        subtitle={activeProject.customer_name}
        actions={
          <div className="flex items-center gap-2">
            {hasInbound && hasOutbound && (
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                {([['in', 'Вход'], ['out', 'Исход']] as const).map(([id, lbl]) => (
                  <button key={id} onClick={() => { setLineSel(id); setSelectedQueues(new Set()) }}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${line === id ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                    {lbl}
                  </button>
                ))}
              </div>
            )}
            {(allQueues.length > 1 || (line === 'out' && allQueues.length >= 1)) && (
              <QueueFilterDropdown queues={allQueues} selected={selectedQueues} onChange={setSelectedQueues}
                label="" align="right" allLabel={line === 'out' ? 'Все линии' : 'Все очереди'} title={line === 'out' ? 'Фильтр по линиям' : 'Фильтр по очередям'} />
            )}
          </div>
        }
      />

      {/* Вкладки раздела */}
      <div className="flex gap-1 mb-5 border-b border-slate-200">
        {([['operators', 'Операторы'], ['stats', 'Статистика']] as const).map(([id, l]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === id ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'stats' ? (line === 'out'
        ? <OutboundMonitoringStats externalQueues={selectedQueues} />
        : <MonitoringStats externalQueues={selectedQueues} />) : (<>

      {/* Status bar */}
      <div className="flex items-center justify-between mb-5 bg-slate-800 rounded-xl px-5 py-3">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <Radio size={14} className="text-green-400 animate-pulse" />
          <span>Обновление каждые 5 секунд · Последнее: {format(lastRefreshed, 'HH:mm:ss')}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={opSearch}
              onChange={(e) => setOpSearch(e.target.value)}
              placeholder="Поиск сотрудника…"
              className="pl-7 pr-2 py-1.5 rounded-lg bg-slate-700 text-sm text-slate-100 placeholder-slate-400 border border-slate-600 focus:border-brand-400 outline-none w-48"
            />
          </div>
          <button
            onClick={() => { setLastRefreshed(new Date()); refetchOps() }}
            className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white transition-colors"
          >
            <RefreshCw size={13} /> Обновить сейчас
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {line === 'out' ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="card p-5 border-green-200 bg-green-50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Операторов в линии</p>
              <Users size={16} className="text-green-600" />
            </div>
            <p className="text-3xl font-bold text-green-700">{actualOnlineCount}</p>
            <p className="text-xs text-slate-500 mt-1">Сейчас на обзвоне</p>
          </div>
          <div className="card p-5 border-blue-200 bg-blue-50">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Попыток за час</p>
            <p className="text-3xl font-bold text-blue-700">{outAttempts1h.toLocaleString()}</p>
            <p className="text-xs text-slate-500 mt-1">За последние 60 минут</p>
          </div>
          <div className="card p-5 border-emerald-200 bg-emerald-50">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Контактов за час</p>
            <p className="text-3xl font-bold text-emerald-700">{outContacts1h.toLocaleString()}</p>
            <p className="text-xs text-slate-500 mt-1">Разговор &gt; 10 секунд</p>
          </div>
          <div className="card p-5 border-slate-200">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Contact rate</p>
            <p className="text-3xl font-bold text-slate-900">{outAttempts1h > 0 ? `${Math.round(outContacts1h / outAttempts1h * 100)}%` : '—'}</p>
            <p className="text-xs text-slate-500 mt-1">Контакты / попытки</p>
          </div>
        </div>
      ) : (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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

        <div className="card p-5 border-blue-200 bg-blue-50">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">По графику сейчас</p>
          <p className="text-3xl font-bold text-blue-700">{scheduledShown.length}</p>
          <p className="text-xs text-slate-500 mt-1">Должны работать (активные смены)</p>
        </div>

        <div className="card p-5 border-slate-200">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">На паузе / Вышли</p>
          <p className="text-3xl font-bold text-slate-900">{pauseOps.length}</p>
          <p className="text-xs text-slate-500 mt-1">Вышли за 24ч: {offlineOps.length}</p>
        </div>
      </div>
      )}

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

          {/* По графику — список из активных смен (раздел Смены → Активные).
              Не идёт в статистику: для сравнения «в линии / на паузе / по графику». */}
          <Section
            dotColor="bg-blue-400"
            title="По графику сейчас (активные смены)"
            count={scheduledShown.length}
            empty="Сейчас по графику никто не работает"
          >
            {scheduledShown.map((s: any) => (
              <div key={s.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{s.employee_name || `#${s.employee_id}`}</p>
                  <p className="text-xs text-slate-400">
                    {s.start_time?.slice(11, 16)}–{s.end_time?.slice(11, 16)}
                    {s.lunch_minutes ? ` · обед ${s.lunch_minutes} мин` : ''}
                  </p>
                </div>
                {s.team_name && <span className="text-xs text-slate-400 flex-shrink-0 ml-2">{s.team_name}</span>}
              </div>
            ))}
          </Section>
        </div>
      )}
      </>)}
    </div>
  )
}

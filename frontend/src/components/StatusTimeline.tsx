import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Maximize2 } from 'lucide-react'
import api from '@/api/client'
import type { TimelineEvent } from '@/types'
import { useStatusClassifier, isStaleWrapup, type StatusGroup } from '@/utils/statusClassification'
import Modal from '@/components/ui/Modal'

type FilterGroup = StatusGroup | 'stale'

// Классификация статусов (work/pause/offline) — единая с Онлайн-мониторингом,
// включая индивидуальные настройки проекта (см. useStatusClassifier). 'stale' —
// отдельная виртуальная категория для просроченной постобработки (wrapup/acw
// дольше WRAPUP_STALE_SEC) — фактически это пауза, но отображаем её отдельно,
// т.к. это сигнал проблемы, а не обычный отдых оператора.
const GROUP_CONFIG: Record<FilterGroup, { bg: string; label: string }> = {
  work:    { bg: '#22c55e', label: 'В линии' },
  pause:   { bg: '#f59e0b', label: 'На паузе' },
  offline: { bg: '#94a3b8', label: 'Вышли' },
  stale:   { bg: '#ef4444', label: 'Просрочена пост-обработка' },
}
const ALL_GROUPS: FilterGroup[] = ['work', 'pause', 'offline', 'stale']

function effectiveGroup(evt: TimelineEvent, classify: (s: string, d?: number) => StatusGroup): FilterGroup {
  return isStaleWrapup(evt.status, evt.duration_sec) ? 'stale' : classify(evt.status, evt.duration_sec)
}

function computeGroupTotals(data: TimelineEvent[], classify: (s: string, d?: number) => StatusGroup) {
  const totals: Record<FilterGroup, number> = { work: 0, pause: 0, offline: 0, stale: 0 }
  for (const e of data) totals[effectiveGroup(e, classify)] += e.duration_sec
  return totals
}

// Шаг сетки времени снизу: по умолчанию каждые 3 часа от 00:00 (не по точкам
// данных), при увеличении (зуме) — мельче, чтобы метки оставались читаемыми.
function pickStepMinutes(totalMs: number): number {
  const hours = totalMs / 3600000
  if (hours <= 1.5) return 10
  if (hours <= 4) return 30
  if (hours <= 14) return 60
  return 180
}

function buildTicks(viewStart: Date, viewEnd: Date): { time: Date; pct: number }[] {
  const totalMs = Math.max(1, viewEnd.getTime() - viewStart.getTime())
  const stepMs = pickStepMinutes(totalMs) * 60000
  const first = new Date(Math.floor(viewStart.getTime() / stepMs) * stepMs)
  const ticks: { time: Date; pct: number }[] = []
  for (let t = first.getTime(); t <= viewEnd.getTime(); t += stepMs) {
    if (t < viewStart.getTime()) continue
    ticks.push({ time: new Date(t), pct: ((t - viewStart.getTime()) / totalMs) * 100 })
  }
  return ticks
}

// ─── Сама полоса временной линии (используется и в компактном, и в детальном виде) ──
function TimelineBar({
  data, viewStart, viewEnd, classify, label, visibleGroups, height = 36, onClick, onWheelZoom, onPanTo,
}: {
  data: TimelineEvent[]
  viewStart: Date
  viewEnd: Date
  classify: (s: string, d?: number) => StatusGroup
  label: (s: string, d?: number) => string
  visibleGroups: Set<FilterGroup>
  height?: number
  onClick?: () => void
  onWheelZoom?: (frac: number, deltaY: number) => void
  onPanTo?: (newViewStartMs: number) => void
}) {
  const totalMs = Math.max(1, viewEnd.getTime() - viewStart.getTime())
  const ticks = useMemo(() => buildTicks(viewStart, viewEnd), [viewStart.getTime(), viewEnd.getTime()])

  const dragRef = useRef<{ startX: number; baseStart: number; width: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (!isDragging) return
    const handleMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d || !onPanTo || d.width <= 0) return
      const deltaPx = e.clientX - d.startX
      const deltaMs = -(deltaPx / d.width) * totalMs
      onPanTo(d.baseStart + deltaMs)
    }
    const handleUp = () => setIsDragging(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [isDragging, totalMs, onPanTo])

  const cursorClass = isDragging
    ? 'cursor-grabbing'
    : onPanTo ? 'cursor-grab'
    : onClick ? 'cursor-pointer hover:ring-2 hover:ring-brand-300'
    : onWheelZoom ? 'cursor-zoom-in' : ''

  return (
    <div>
      <div
        className={`relative rounded-lg overflow-hidden mb-1 select-none ${cursorClass}`}
        style={{ background: '#f1f5f9', height }}
        onClick={isDragging ? undefined : onClick}
        onMouseDown={onPanTo ? (e) => {
          dragRef.current = { startX: e.clientX, baseStart: viewStart.getTime(), width: e.currentTarget.getBoundingClientRect().width }
          setIsDragging(true)
        } : undefined}
        onWheel={onWheelZoom ? (e) => {
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          const frac = rect.width > 0 ? Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) : 0.5
          onWheelZoom(frac, e.deltaY)
        } : undefined}
        title={onClick ? 'Нажмите для детального просмотра' : onPanTo ? 'Зажмите и тащите для перемещения, колесо мыши — приближение' : onWheelZoom ? 'Колесо мыши — приближение к точке курсора' : undefined}
      >
        {data.map((evt, i) => {
          const grp = effectiveGroup(evt, classify)
          if (!visibleGroups.has(grp)) return null
          const evtStart = new Date(evt.entered).getTime()
          const evtEnd = evtStart + evt.duration_sec * 1000
          const clampedStart = Math.max(evtStart, viewStart.getTime())
          const clampedEnd = Math.min(evtEnd, viewEnd.getTime())
          if (clampedEnd <= clampedStart) return null
          const left = ((clampedStart - viewStart.getTime()) / totalMs) * 100
          const width = Math.max(0.2, ((clampedEnd - clampedStart) / totalMs) * 100)
          return (
            <div
              key={i}
              title={`${GROUP_CONFIG[grp].label} (${label(evt.status, evt.duration_sec)}): ${evt.entered.slice(11, 16)} · ${Math.round(evt.duration_sec / 60)} мин`}
              style={{
                position: 'absolute',
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: GROUP_CONFIG[grp].bg,
                top: 0,
                bottom: 0,
                borderRight: '1px solid rgba(255,255,255,0.25)',
              }}
            />
          )
        })}
      </div>
      <div className="relative h-4 text-xs text-slate-400 select-none">
        {ticks.map((tk, i) => (
          <span key={i} style={{ position: 'absolute', left: `${tk.pct}%`, transform: 'translateX(-50%)' }}>
            {format2(tk.time)}
          </span>
        ))}
      </div>
    </div>
  )
}

function format2(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Непрерывный зум: ползунок 0..100 — лог. шкала от MIN_SPAN_MIN до полного периода,
// 0 = весь период, 100 = максимальное приближение.
const MIN_SPAN_MIN = 5

function spanFromZoomLevel(z: number, fullMinutes: number): number {
  const maxLog = Math.log(Math.max(fullMinutes, MIN_SPAN_MIN + 1))
  const minLog = Math.log(MIN_SPAN_MIN)
  return Math.exp(maxLog - (z / 100) * (maxLog - minLog))
}
function zoomLevelFromSpan(spanMinutes: number, fullMinutes: number): number {
  const maxLog = Math.log(Math.max(fullMinutes, MIN_SPAN_MIN + 1))
  const minLog = Math.log(MIN_SPAN_MIN)
  const v = Math.log(Math.min(Math.max(spanMinutes, MIN_SPAN_MIN), fullMinutes))
  return ((maxLog - v) / (maxLog - minLog)) * 100
}

// ─── Детальное модальное окно: фильтр по типам статусов + зум/панорама ──────
function TimelineDetailModal({
  data, fullStart, fullEnd, classify, label, employeeLabel, onClose,
}: {
  data: TimelineEvent[]
  fullStart: Date
  fullEnd: Date
  classify: (s: string, d?: number) => StatusGroup
  label: (s: string, d?: number) => string
  employeeLabel: string
  onClose: () => void
}) {
  const [visibleGroups, setVisibleGroups] = useState<Set<FilterGroup>>(new Set(ALL_GROUPS))
  const fullTotalMs = fullEnd.getTime() - fullStart.getTime()
  const fullMinutes = Math.max(MIN_SPAN_MIN, fullTotalMs / 60000)
  const [spanMin, setSpanMin] = useState<number>(fullMinutes)
  const [viewStart, setViewStart] = useState<Date>(fullStart)

  const viewSpanMs = spanMin * 60000
  const viewEnd = new Date(Math.min(fullEnd.getTime(), viewStart.getTime() + viewSpanMs))
  const isFull = spanMin >= fullMinutes - 0.01

  const totals = useMemo(() => computeGroupTotals(data, classify), [data, classify])
  const presentGroups = ALL_GROUPS.filter((g) => totals[g] > 0)

  const toggleGroup = (g: FilterGroup) => {
    setVisibleGroups((prev) => {
      const n = new Set(prev)
      n.has(g) ? n.delete(g) : n.add(g)
      return n
    })
  }

  const clampStart = (ms: number, spanMs: number) =>
    Math.max(fullStart.getTime(), Math.min(ms, fullEnd.getTime() - spanMs))

  // anchorFrac — доля по ширине окна, которая должна остаться под точкой anchorTime
  // (0.5 для ползунка — зум от центра; доля под курсором — для колеса мыши)
  const setZoom = (newSpanMin: number, anchorTime: number, anchorFrac: number) => {
    const clampedSpanMin = Math.min(Math.max(newSpanMin, MIN_SPAN_MIN), fullMinutes)
    const newSpanMs = clampedSpanMin * 60000
    setSpanMin(clampedSpanMin)
    setViewStart(new Date(clampStart(anchorTime - anchorFrac * newSpanMs, newSpanMs)))
  }

  const handleSliderChange = (z: number) => {
    const newSpanMin = spanFromZoomLevel(z, fullMinutes)
    const center = viewStart.getTime() + viewSpanMs / 2
    setZoom(newSpanMin, center, 0.5)
  }

  const handleWheelZoom = (frac: number, deltaY: number) => {
    const cursorTime = viewStart.getTime() + frac * viewSpanMs
    const factor = deltaY > 0 ? 1.25 : 1 / 1.25
    setZoom(spanMin * factor, cursorTime, frac)
  }

  const showAll = () => setZoom(fullMinutes, fullStart.getTime(), 0)

  const pan = (dir: -1 | 1) => {
    setViewStart((prev) => new Date(clampStart(prev.getTime() + dir * viewSpanMs, viewSpanMs)))
  }

  const canPanLeft = viewStart.getTime() > fullStart.getTime()
  const canPanRight = viewStart.getTime() + viewSpanMs < fullEnd.getTime()

  return (
    <Modal open title={`История статусов — ${employeeLabel}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        {/* Зум + панорама */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-[240px]">
            <button
              onClick={showAll}
              className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors whitespace-nowrap ${
                isFull ? 'bg-brand-50 border-brand-400 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              Весь период
            </button>
            <input
              type="range"
              min={0}
              max={100}
              step={0.5}
              value={zoomLevelFromSpan(spanMin, fullMinutes)}
              onChange={(e) => handleSliderChange(Number(e.target.value))}
              className="flex-1 accent-brand-500"
              title="Масштаб временной линии"
            />
          </div>
          {!isFull && (
            <div className="flex items-center gap-1">
              <button onClick={() => pan(-1)} disabled={!canPanLeft} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30">
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs text-slate-400 w-32 text-center">
                {format2(viewStart)}–{format2(viewEnd)}
              </span>
              <button onClick={() => pan(1)} disabled={!canPanRight} className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30">
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
        <p className="text-xs text-slate-400 -mt-2">Зажмите и тащите линию для перемещения · колесо мыши приближает к точке курсора</p>

        <TimelineBar
          data={data}
          viewStart={viewStart}
          viewEnd={viewEnd}
          classify={classify}
          label={label}
          visibleGroups={visibleGroups}
          height={56}
          onWheelZoom={handleWheelZoom}
          onPanTo={isFull ? undefined : (ms) => setViewStart(new Date(clampStart(ms, viewSpanMs)))}
        />

        {/* Легенда-фильтр: клик скрывает/показывает категорию на линии */}
        <div className="flex flex-wrap gap-2">
          {ALL_GROUPS.map((g) => {
            const active = visibleGroups.has(g)
            const present = presentGroups.includes(g)
            return (
              <button
                key={g}
                onClick={() => toggleGroup(g)}
                disabled={!present}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                  active ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-40'
                } ${!present ? 'opacity-25 cursor-default' : 'hover:bg-slate-50'}`}
              >
                <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: GROUP_CONFIG[g].bg }} />
                <span className="font-medium text-slate-700">{GROUP_CONFIG[g].label}</span>
                <span className="text-slate-400">{Math.round(totals[g] / 60)} мин</span>
              </button>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}

// ─── Компактная временная линия (для вставки под строкой сотрудника/сессии) ─
export default function StatusTimeline({
  login, partnerUuid, workDate, hours, employeeName,
}: {
  login: string
  partnerUuid: string | undefined
  workDate?: string
  hours?: number
  employeeName?: string
}) {
  const [showDetail, setShowDetail] = useState(false)
  const { classify, label } = useStatusClassifier(partnerUuid)

  const { data, isLoading } = useQuery({
    queryKey: ['timeline', login, workDate ?? `window-${hours}`],
    queryFn: () =>
      api.get('/analytics/operator-timeline', { params: workDate ? { login, work_date: workDate } : { login, hours } })
         .then((r) => r.data.data as TimelineEvent[]),
    staleTime: hours ? 60 * 1000 : 5 * 60 * 1000,
    refetchInterval: hours ? 60 * 1000 : undefined,
  })

  const { viewStart, viewEnd } = useMemo(() => {
    if (workDate) {
      const s = new Date(`${workDate}T00:00:00`)
      const e = new Date(s.getTime() + 24 * 3600 * 1000)
      return { viewStart: s, viewEnd: e }
    }
    const e = new Date()
    const s = new Date(e.getTime() - (hours ?? 24) * 3600 * 1000)
    return { viewStart: s, viewEnd: e }
  }, [workDate, hours])

  if (isLoading) return <div className="px-4 py-3 text-xs text-slate-400 animate-pulse">Загрузка временной линии…</div>
  if (!data?.length) return <div className="px-4 py-3 text-xs text-slate-400">Нет данных о статусах</div>

  const totals = computeGroupTotals(data, classify)
  const presentGroups = ALL_GROUPS.filter((g) => totals[g] > 0)
  const allVisible = new Set(ALL_GROUPS)

  return (
    <div className="px-4 py-3 bg-white border-t border-slate-100">
      <TimelineBar data={data} viewStart={viewStart} viewEnd={viewEnd} classify={classify} label={label} visibleGroups={allVisible} onClick={() => setShowDetail(true)} />

      <div className="flex flex-wrap items-center gap-4 mt-2">
        {presentGroups.map((g) => (
          <div key={g} className="flex items-center gap-1.5 text-xs text-slate-600">
            <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: GROUP_CONFIG[g].bg }} />
            <span className="font-medium">{GROUP_CONFIG[g].label}</span>
            <span className="text-slate-400">{Math.round(totals[g] / 60)} мин</span>
          </div>
        ))}
        <button onClick={() => setShowDetail(true)} className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium ml-auto">
          <Maximize2 size={12} /> Детально
        </button>
      </div>

      {showDetail && (
        <TimelineDetailModal
          data={data}
          fullStart={viewStart}
          fullEnd={viewEnd}
          classify={classify}
          label={label}
          employeeLabel={employeeName || login}
          onClose={() => setShowDetail(false)}
        />
      )}
    </div>
  )
}

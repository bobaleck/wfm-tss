import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Clock4, Save, CheckCircle, AlertTriangle, Download, RefreshCw, ChevronRight, ChevronLeft, ChevronDown, Activity, Eye, X, Check, CalendarDays, Search } from 'lucide-react'
import api from '@/api/client'
import type { Shift, OperatorSession, Employee, Team } from '@/types'
import { SHIFT_STATUSES } from '@/types'
import { useProjectStore } from '@/store/project'
import { useAuthStore } from '@/store/auth'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/common/EmptyState'
import { format, subDays, addDays, startOfMonth, endOfMonth, startOfWeek, addMonths, isSameMonth } from 'date-fns'
// (startOfMonth/endOfMonth используются и для периода выгрузки Excel)
import StatusTimeline from '@/components/StatusTimeline'
import ShiftAssignModal from '@/components/worktime/ShiftAssignModal'
import DatePicker from '@/components/common/DatePicker'
import DateRangePicker from '@/components/common/DateRangePicker'
import TimeSelect from '@/components/common/TimeSelect'

type ShiftSortKey = 'employee_name' | 'shift_date' | 'start_time' | 'end_time' | 'schedule_name' | 'status' | 'actual_hours_worked'
type SessionSortKey = 'employee_name' | 'first_login' | 'last_logout' | 'normal_sec' | 'non_normal_sec' | 'offline_sec' | 'shift_sec' | 'break_count'

function SortTh({ label, sortKey, current, dir, onSort, className = '' }: {
  label: string; sortKey: string; current: string; dir: 'asc' | 'desc'
  onSort: (k: any) => void; className?: string
}) {
  const active = current === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-slate-700 group ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className={`transition-opacity ${active ? 'opacity-100 text-brand-500' : 'opacity-0 group-hover:opacity-40'}`}>
          {active && dir === 'asc' ? '↑' : '↓'}
        </span>
      </span>
    </th>
  )
}

const STATUS_COLOR: Record<string, any> = {
  planned: 'blue', confirmed: 'green', completed: 'gray', cancelled: 'red',
}

type ViewMode = 'past' | 'active' | 'planned' | 'assign'

const CAL_WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const CAL_MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const dispD = (s: string) => { const [y, m, d] = s.split('-'); return `${d}.${m}.${y}` }

// Покрытие дня в часах = объединение интервалов смен (важны ЧАСЫ, не число операторов).
function dayCoverageHours(dayStr: string, shifts: Shift[]): number {
  const dayStart = new Date(dayStr + 'T00:00:00').getTime()
  const dayEnd = dayStart + 24 * 3600 * 1000
  const iv: [number, number][] = []
  for (const s of shifts) {
    if (!s.start_time || !s.end_time) continue
    const a = Math.max(new Date(s.start_time).getTime(), dayStart)
    const b = Math.min(new Date(s.end_time).getTime(), dayEnd)
    if (b > a) iv.push([a, b])
  }
  if (!iv.length) return 0
  iv.sort((x, y) => x[0] - y[0])
  let total = 0, cs = iv[0][0], ce = iv[0][1]
  for (let i = 1; i < iv.length; i++) {
    const [s, e] = iv[i]
    if (s <= ce) ce = Math.max(ce, e)
    else { total += ce - cs; cs = s; ce = e }
  }
  total += ce - cs
  return total / 3600000
}

// Объединённые интервалы смен дня в ЧАСАХ суток [0..24] (для часовой заливки круга).
function dayCoverageSegments(dayStr: string, shifts: Shift[]): [number, number][] {
  const dayStart = new Date(dayStr + 'T00:00:00').getTime()
  const dayEnd = dayStart + 24 * 3600 * 1000
  const iv: [number, number][] = []
  for (const s of shifts) {
    if (!s.start_time || !s.end_time) continue
    const a = Math.max(new Date(s.start_time).getTime(), dayStart)
    const b = Math.min(new Date(s.end_time).getTime(), dayEnd)
    if (b > a) iv.push([(a - dayStart) / 3600000, (b - dayStart) / 3600000])
  }
  if (!iv.length) return []
  iv.sort((x, y) => x[0] - y[0])
  const merged: [number, number][] = [iv[0]]
  for (let i = 1; i < iv.length; i++) {
    const last = merged[merged.length - 1]
    if (iv[i][0] <= last[1]) last[1] = Math.max(last[1], iv[i][1])
    else merged.push(iv[i])
  }
  return merged
}

// Заливка круга-дня ПО ЧАСАМ суток (а не пропорционально): 00:00 — вверху, далее
// по часовой стрелке (06:00 — справа, 12:00 — внизу, 18:00 — слева). Так смена
// 06:00–18:00 закрашивает нижнюю половину. fill — цвет покрытых часов.
function conicFromSegments(segs: [number, number][], fill = '#22c55e', empty = '#e2e8f0'): string {
  if (!segs.length) return empty
  const stops: string[] = []
  let prev = 0
  for (const [a, b] of segs) {
    const aDeg = (a / 24) * 360, bDeg = (b / 24) * 360
    if (aDeg > prev) stops.push(`${empty} ${prev}deg ${aDeg}deg`)
    stops.push(`${fill} ${aDeg}deg ${bDeg}deg`)
    prev = bDeg
  }
  if (prev < 360) stops.push(`${empty} ${prev}deg 360deg`)
  return `conic-gradient(${stops.join(', ')})`
}

// Линия смены: входящая, если в line есть 'in' ИЛИ линия не задана (по умолчанию
// вход); исходящая — если в line есть 'out'. Смена 'in,out' идёт в обе.
function shiftIsInbound(s: Shift): boolean {
  const l = s.line ? String(s.line) : ''
  return !l || l.includes('in')
}
function shiftIsOutbound(s: Shift): boolean {
  return !!(s.line && String(s.line).includes('out'))
}

// Рабочие минуты смены = плановая длительность минус обед.
function shiftWorkMinutes(s: Shift): number {
  if (!s.start_time || !s.end_time) return 0
  const mins = (new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 60000 - (s.lunch_minutes || 0)
  return Math.max(0, mins)
}
function fmtHoursMinutes(totalMin: number): string {
  const m = Math.round(totalMin)
  const h = Math.floor(m / 60)
  const min = m % 60
  if (h && min) return `${h} ${h % 10 === 1 && h % 100 !== 11 ? 'час' : (h % 10 >= 2 && h % 10 <= 4 && (h % 100 < 10 || h % 100 >= 20)) ? 'часа' : 'часов'} ${min} мин`
  if (h) return `${h} ${h % 10 === 1 && h % 100 !== 11 ? 'час' : (h % 10 >= 2 && h % 10 <= 4 && (h % 100 < 10 || h % 100 >= 20)) ? 'часа' : 'часов'}`
  return `${min} мин`
}

// ─── Вкладка «Проставить смены»: список сотрудников + календарь покрытия ──────
function AssignShiftsView() {
  const { activeProject } = useProjectStore()
  const { user: me } = useAuthStore()
  const [myTeamsOnly, setMyTeamsOnly] = useState(false)
  const [empSearch, setEmpSearch] = useState('')
  const [openTeams, setOpenTeams] = useState<Set<string>>(new Set())
  // Модалка проставления смен: empIds — кому ставим (можно нескольким сразу,
  // в самой модалке состав можно дополнить галочками).
  const [assign, setAssign] = useState<{ empIds: number[]; date: string | null } | null>(null)
  const [viewEmp, setViewEmp] = useState<Employee | null>(null)
  const [calMonth, setCalMonth] = useState(() => startOfMonth(new Date()))
  const [selectedOps, setSelectedOps] = useState<Set<number>>(new Set())
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')

  const { data: employees } = useQuery({
    queryKey: ['employees', activeProject?.customer_uuid],
    queryFn: () => api.get('/employees', { params: { project_uuid: activeProject?.customer_uuid, limit: 1000 } }).then((r) => r.data as Employee[]),
    enabled: !!activeProject,
  })
  const { data: teams } = useQuery({
    queryKey: ['teams', activeProject?.customer_uuid],
    queryFn: () => api.get('/teams', { params: { project_uuid: activeProject?.customer_uuid } }).then((r) => r.data as Team[]),
    enabled: !!activeProject,
  })
  const monthFrom = format(startOfMonth(calMonth), 'yyyy-MM-dd')
  const monthTo = format(endOfMonth(calMonth), 'yyyy-MM-dd')
  const { data: monthShifts } = useQuery({
    queryKey: ['assign-shifts', activeProject?.customer_uuid, monthFrom, monthTo],
    queryFn: () => api.get('/schedules/shifts', { params: { project_uuid: activeProject?.customer_uuid, date_from: monthFrom, date_to: monthTo } }).then((r) => r.data as Shift[]),
    enabled: !!activeProject,
  })
  // Смены за выбранный период (список по датам)
  const hasPeriod = !!periodFrom && !!periodTo
  const { data: periodShifts } = useQuery({
    queryKey: ['assign-period-shifts', activeProject?.customer_uuid, periodFrom, periodTo],
    queryFn: () => api.get('/schedules/shifts', { params: { project_uuid: activeProject?.customer_uuid, date_from: periodFrom, date_to: periodTo } }).then((r) => r.data as Shift[]),
    enabled: !!activeProject && hasPeriod,
  })

  if (!activeProject) return <div className="card p-6 text-sm text-amber-700 bg-amber-50">Выберите проект в шапке</div>

  const isMyTeam = (t: Team) => !!me && (t.leader_user_id === me.id || (t.user_ids || []).includes(me.id))
  const activeEmps = (employees || []).filter((e) => e.employment_status !== 'fired')
  const searchedEmps = empSearch.trim()
    ? activeEmps.filter((e) => (e.full_name || '').toLowerCase().includes(empSearch.trim().toLowerCase()))
    : activeEmps
  const byTeam: Record<number, Employee[]> = {}
  const noTeam: Employee[] = []
  for (const e of searchedEmps) {
    if (e.team_id == null) noTeam.push(e)
    else (byTeam[e.team_id] = byTeam[e.team_id] || []).push(e)
  }
  // Показываем ВСЕ команды проекта (в т.ч. пустые), либо только свои.
  const visibleTeams = (teams || []).filter((t) => (myTeamsOnly ? isMyTeam(t) : true))
  const toggleTeam = (k: string) => setOpenTeams((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })
  const toggleOp = (id: number) => setSelectedOps((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  // «Выбрать всех» по команде — добавляет к уже выбранным, не сбрасывая.
  const selectMany = (ids: number[]) => setSelectedOps((p) => { const n = new Set(p); ids.forEach((id) => n.add(id)); return n })

  // Календарь покрытия — фильтр по выбранным сотрудникам (если выбраны).
  const shownShifts = (monthShifts || []).filter((s) => selectedOps.size === 0 || selectedOps.has(s.employee_id))
  const shiftsByDay: Record<string, Shift[]> = {}
  for (const s of shownShifts) (shiftsByDay[s.shift_date] = shiftsByDay[s.shift_date] || []).push(s)
  const calCells = Array.from({ length: 42 }, (_, i) => addDays(startOfWeek(startOfMonth(calMonth), { weekStartsOn: 1 }), i))
  const empName = (id: number) => activeEmps.find((e) => e.id === id)?.full_name || `#${id}`
  // Единственный выбранный сотрудник — чтобы предложить «Проставить смену» в пустой день
  const onlyOpId = selectedOps.size === 1 ? [...selectedOps][0] : null
  const onlyOp = onlyOpId != null ? activeEmps.find((e) => e.id === onlyOpId) : null

  // Список смен за период — по датам по порядку (с учётом выбранных сотрудников)
  const periodList = (periodShifts || [])
    .filter((s) => selectedOps.size === 0 || selectedOps.has(s.employee_id))
    .sort((a, b) => a.shift_date.localeCompare(b.shift_date) || (a.start_time || '').localeCompare(b.start_time || ''))
  const periodByDate: [string, Shift[]][] = []
  for (const s of periodList) {
    if (!periodByDate.length || periodByDate[periodByDate.length - 1][0] !== s.shift_date) periodByDate.push([s.shift_date, []])
    periodByDate[periodByDate.length - 1][1].push(s)
  }

  const EmpCard = ({ e }: { e: Employee }) => {
    const sel = selectedOps.has(e.id)
    return (
      <div onClick={() => toggleOp(e.id)}
        className={`flex items-center justify-between px-4 py-2.5 border-b border-slate-50 last:border-0 cursor-pointer transition-colors ${sel ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
        <div className="min-w-0 flex items-center gap-2.5">
          <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors ${sel ? 'bg-brand-500 border-brand-500' : 'border-slate-300 bg-white'}`}>
            {sel && <Check size={11} className="text-white" strokeWidth={3} />}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800 truncate">{e.full_name}</p>
            <p className="text-xs text-slate-400 truncate">{e.position || '—'} · приоритетный график: {e.preferred_schedule || '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0" onClick={(ev) => ev.stopPropagation()}>
          <button onClick={() => setAssign({ empIds: selectedOps.size > 0 ? [...new Set([...selectedOps, e.id])] : [e.id], date: null })} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-medium"><Clock4 size={13} /> Поставить смены</button>
          <button onClick={() => setViewEmp(e)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700" title="Просмотреть смены"><Eye size={13} /></button>
        </div>
      </div>
    )
  }

  const dayShifts = selectedDay ? [...(shiftsByDay[selectedDay] || [])].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')) : []
  const dayWorkMin = dayShifts.reduce((t, s) => t + shiftWorkMinutes(s), 0)
  const periodWorkMin = periodList.reduce((t, s) => t + shiftWorkMinutes(s), 0)

  return (
    <div>
      <div className="flex flex-col xl:flex-row gap-6 items-start">
        {/* A: Календарь открытия смен — закреплён, всегда перед глазами.
            xl:z-20 — чтобы выпадашка периода была поверх соседней колонки смен. */}
        <div className="w-full xl:w-[360px] flex-shrink-0 xl:sticky xl:top-4 xl:z-20">
          <div className="card p-5">
            <div className="flex items-center justify-center gap-2 mb-3">
              <CalendarDays size={16} className="text-brand-500" />
              <h2 className="text-sm font-semibold text-slate-800">Календарь покрытия смен</h2>
            </div>

            {/* Период — по центру под заголовком */}
            <div className="flex items-center justify-center gap-2 mb-4">
              <DateRangePicker begin={periodFrom} end={periodTo} align="left"
                onChange={(b, e) => { setPeriodFrom(b); setPeriodTo(e); setSelectedDay(null); if (b) setCalMonth(startOfMonth(new Date(b + 'T00:00:00'))) }} />
              {hasPeriod && (
                <button onClick={() => { setPeriodFrom(''); setPeriodTo('') }} className="text-xs text-slate-400 hover:text-red-500">сброс</button>
              )}
            </div>
            <div className="flex items-center justify-center gap-4 mb-3 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Вход</span>
              <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-pink-500" /> Исход</span>
            </div>

            {/* Навигация по месяцам */}
            <div className="flex items-center justify-between mb-3">
              <button type="button" onClick={() => setCalMonth((m) => addMonths(m, -1))} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><ChevronLeft size={16} /></button>
              <span className="text-sm font-semibold text-slate-800">{CAL_MONTHS[calMonth.getMonth()]} {calMonth.getFullYear()}</span>
              <button type="button" onClick={() => setCalMonth((m) => addMonths(m, 1))} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><ChevronRight size={16} /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 mb-1">
              {CAL_WEEKDAYS.map((w) => <div key={w} className="text-center text-[11px] font-medium text-slate-400">{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {calCells.map((c) => {
                const ds = format(c, 'yyyy-MM-dd')
                const inM = isSameMonth(c, calMonth)
                const dayAll = shiftsByDay[ds] || []
                const inSegs = dayCoverageSegments(ds, dayAll.filter(shiftIsInbound))   // зелёный — вход
                const outSegs = dayCoverageSegments(ds, dayAll.filter(shiftIsOutbound)) // розовый — исход
                const inH = inSegs.reduce((t, [a, b]) => t + (b - a), 0)
                const outH = outSegs.reduce((t, [a, b]) => t + (b - a), 0)
                const isSel = ds === selectedDay
                const inPeriod = hasPeriod && ds >= periodFrom && ds <= periodTo
                return (
                  <button key={ds} type="button"
                    onClick={() => { if (hasPeriod) { setPeriodFrom(''); setPeriodTo('') } setSelectedDay(isSel ? null : ds) }}
                    title={`${dispD(ds)} · вход ${inH.toFixed(1)}ч · исход ${outH.toFixed(1)}ч`}
                    className="flex items-center justify-center cursor-pointer">
                    <div className={`relative w-10 h-10 rounded-full ${(isSel || inPeriod) ? 'ring-2 ring-brand-500 ring-offset-1' : ''}`}
                      style={{ background: conicFromSegments(inSegs, '#22c55e') }}>
                      {/* Внутренний розовый круг — покрытие исходящих смен */}
                      <div className="absolute inset-[4px] rounded-full" style={{ background: conicFromSegments(outSegs, '#ec4899') }}>
                        <div className={`absolute inset-[4px] rounded-full bg-white flex items-center justify-center text-xs font-medium ${inM ? 'text-slate-700' : 'text-slate-300'}`}>
                          {c.getDate()}
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Планка выбранных — ПОД календарём, чтобы выбор сотрудника не «двигал» календарь */}
            {selectedOps.size > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 bg-brand-500/10 border border-brand-200 rounded-lg px-3 py-2">
                <span className="text-xs font-semibold text-brand-700">Выбрано ({selectedOps.size}):</span>
                {[...selectedOps].map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-white/80 border border-brand-200 rounded-md text-xs text-brand-800">
                    {empName(id)}
                    <button onClick={() => toggleOp(id)} className="text-brand-400 hover:text-red-500 p-0.5"><X size={11} /></button>
                  </span>
                ))}
                <button onClick={() => setSelectedOps(new Set())} className="text-xs text-slate-400 hover:text-red-500 ml-1">Сбросить всех</button>
              </div>
            )}
          </div>
        </div>

        {/* B: Список смен (при нажатии на день / период) — тоже закреплён, но
            под календарём по z-оси (xl:z-10), чтобы не перекрывать его выпадашку */}
        <div className="w-full xl:flex-1 min-w-0 card p-5 xl:sticky xl:top-4 xl:self-start xl:z-10">
          {hasPeriod ? (
            <>
              <p className="text-sm font-semibold text-slate-800 mb-2">
                {selectedOps.size > 0 ? 'Смены выбранных' : 'Смены'} за период · {dispD(periodFrom)}–{dispD(periodTo)}
              </p>
              <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                {periodByDate.length === 0 ? <p className="text-sm text-slate-400">За период смен нет</p> :
                  periodByDate.map(([date, list]) => (
                    <div key={date}>
                      <p className="text-xs font-semibold text-slate-400 mb-0.5">{dispD(date)}</p>
                      {list.map((s) => (
                        <div key={s.id} className="flex items-center justify-between text-sm px-3 py-1 rounded-lg hover:bg-slate-50 group">
                          <span className="text-slate-700 truncate">{s.employee_name || empName(s.employee_id)}</span>
                          <span className="flex items-center gap-2 flex-shrink-0 ml-2">
                            <button onClick={() => setAssign({ empIds: [s.employee_id], date: s.shift_date })}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
                              <Pencil size={11} /> Изм.
                            </button>
                            <span className="text-slate-500">{s.start_time?.slice(11, 16)}–{s.end_time?.slice(11, 16)}{s.lunch_minutes ? ` · обед ${s.lunch_minutes}м` : ''}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
              </div>
              <div className="border-t border-slate-100 mt-3 pt-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">Итог рабочих часов:</span>
                <span className="text-sm font-bold text-brand-700">{fmtHoursMinutes(periodWorkMin)}</span>
              </div>
            </>
          ) : selectedDay ? (
            <>
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-sm font-semibold text-slate-800">
                  {selectedOps.size > 0 ? 'Смены выбранных' : 'Смены'} на {dispD(selectedDay)}
                </p>
                {/* Кнопка доступна всегда — можно добавить ещё смену (гибкий график) */}
                <button onClick={() => setAssign({ empIds: [...selectedOps], date: selectedDay })}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-medium flex-shrink-0">
                  <Plus size={13} /> Поставить смену
                </button>
              </div>
              <div className="space-y-1 max-h-[55vh] overflow-y-auto">
                {dayShifts.length === 0 ? (
                  <p className="text-sm text-slate-400">На этот день смен нет — нажмите «Поставить смену».</p>
                ) : dayShifts.map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-sm px-3 py-1.5 rounded-lg hover:bg-slate-50 group">
                    <span className="text-slate-700 truncate flex items-center gap-1.5">
                      {s.employee_name || empName(s.employee_id)}
                      {shiftIsOutbound(s) && <span className="text-[10px] px-1 rounded bg-pink-100 text-pink-600">исход</span>}
                    </span>
                    <span className="flex items-center gap-2 flex-shrink-0 ml-2">
                      <button onClick={() => setAssign({ empIds: [s.employee_id], date: s.shift_date })}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
                        <Pencil size={11} /> Редактировать
                      </button>
                      <span className="text-slate-500">{s.start_time?.slice(11, 16)}–{s.end_time?.slice(11, 16)}{s.lunch_minutes ? ` · обед ${s.lunch_minutes}м` : ''}</span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-100 mt-3 pt-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700">Итог рабочих часов:</span>
                <span className="text-sm font-bold text-brand-700">{fmtHoursMinutes(dayWorkMin)}</span>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400">
              Выберите сотрудников в списке справа (клик по строке) — календарь покажет их покрытие. Нажмите на день или выберите период, чтобы увидеть смены по датам.
            </p>
          )}
        </div>

        {/* C: Команды и сотрудники — равная ширина со списком смен */}
        <div className="w-full xl:flex-1 min-w-0">
          <div className="mb-3 space-y-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} placeholder="Поиск сотрудника…"
                className="input pl-8 py-1.5 text-sm w-full" />
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={myTeamsOnly} onChange={(e) => setMyTeamsOnly(e.target.checked)} />
                <span className="text-sm font-medium text-slate-700">Мои команды</span>
              </label>
              <p className="text-xs text-slate-400">Сотрудников: {activeEmps.length}</p>
            </div>
          </div>

          <div className="space-y-3">
            {visibleTeams.map((t) => {
              const emps = byTeam[t.id] || []
              const open = openTeams.has(`t${t.id}`) || (!!empSearch.trim() && emps.length > 0)
              const teamEmpIds = activeEmps.filter((e) => e.team_id === t.id).map((e) => e.id)
              return (
                <div key={t.id} className="card overflow-hidden">
                  <div className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-50">
                    <button onClick={() => toggleTeam(`t${t.id}`)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                      {open ? <ChevronDown size={15} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={15} className="text-slate-400 flex-shrink-0" />}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800 truncate">{t.name}</span>
                          <Badge label={`${emps.length} чел.`} color="blue" />
                          {isMyTeam(t) && <span className="text-xs text-brand-600 font-medium">моя</span>}
                        </div>
                        {teamEmpIds.length > 0 && (
                          <span onClick={(ev) => { ev.stopPropagation(); selectMany(teamEmpIds) }}
                            className="text-xs text-brand-600 hover:text-brand-700 hover:underline cursor-pointer">Выбрать всех</span>
                        )}
                      </div>
                    </button>
                  </div>
                  {open && (emps.length ? <div>{emps.map((e) => <EmpCard key={e.id} e={e} />)}</div>
                    : <p className="px-4 py-3 text-xs text-slate-400 italic">В команде нет сотрудников</p>)}
                </div>
              )
            })}

            {!myTeamsOnly && noTeam.length > 0 && (() => {
              const noTeamOpen = openTeams.has('none') || !!empSearch.trim()
              const noTeamAllIds = activeEmps.filter((e) => e.team_id == null).map((e) => e.id)
              return (
              <div className="card overflow-hidden">
                <div className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-50">
                  <button onClick={() => toggleTeam('none')} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                    {noTeamOpen ? <ChevronDown size={15} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={15} className="text-slate-400 flex-shrink-0" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800">Без команды</span>
                        <Badge label={`${noTeam.length} чел.`} color="gray" />
                      </div>
                      {noTeamAllIds.length > 0 && (
                        <span onClick={(ev) => { ev.stopPropagation(); selectMany(noTeamAllIds) }}
                          className="text-xs text-brand-600 hover:text-brand-700 hover:underline cursor-pointer">Выбрать всех</span>
                      )}
                    </div>
                  </button>
                </div>
                {noTeamOpen && <div>{noTeam.map((e) => <EmpCard key={e.id} e={e} />)}</div>}
              </div>
              )
            })()}

            {visibleTeams.length === 0 && (myTeamsOnly || noTeam.length === 0) && (
              <EmptyState title={myTeamsOnly ? 'Нет ваших команд' : 'Нет сотрудников'} icon={<Clock4 size={40} />} />
            )}
          </div>
        </div>
      </div>

      {assign && <Modal open size="xl" title="Поставить смены" onClose={() => setAssign(null)}>
        <ShiftAssignModal initialEmpIds={assign.empIds} employees={activeEmps} projectUuid={activeProject.customer_uuid}
          initialDate={assign.date ?? undefined} onClose={() => setAssign(null)} /></Modal>}
      {viewEmp && <Modal open size="xl" title={`Смены (просмотр): ${viewEmp.full_name}`} onClose={() => setViewEmp(null)}><ShiftAssignModal employee={viewEmp} readOnly onEdit={() => { const id = viewEmp.id; setViewEmp(null); setAssign({ empIds: [id], date: null }) }} onClose={() => setViewEmp(null)} /></Modal>}
    </div>
  )
}

// ─── Вспомогательная функция: плановые часы смены ──────────────────────────
function plannedHours(sh: Shift): string {
  if (!sh.start_time || !sh.end_time) return '—'
  try {
    const s = new Date(sh.start_time)
    const e = new Date(sh.end_time)
    const h = (e.getTime() - s.getTime()) / 3600000
    return `${h.toFixed(1)} ч`
  } catch {
    return '—'
  }
}

// ─── CSV-экспорт ────────────────────────────────────────────────────────────
function exportCSV(shifts: Shift[]) {
  const headers = ['ФИО', 'Дата', 'Нач. план', 'Кон. план', 'Плановые ч', 'Нач. факт', 'Кон. факт', 'Отработано ч', 'Статус', 'На проверке', 'Примечание']
  const rows = shifts.map((sh) => [
    sh.employee_name || '',
    sh.shift_date,
    sh.start_time?.slice(11, 16) || '',
    sh.end_time?.slice(11, 16) || '',
    plannedHours(sh),
    (sh as any).actual_start_time?.slice(11, 16) || '',
    (sh as any).actual_end_time?.slice(11, 16) || '',
    (sh as any).actual_hours_worked || '',
    SHIFT_STATUSES[sh.status] || sh.status,
    (sh as any).needs_review ? 'Да' : '',
    sh.notes || '',
  ])
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `shifts_${format(new Date(), 'yyyy-MM-dd')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Модальное окно подтверждения / указания факт. часов ────────────────────
function ConfirmModal({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const qc = useQueryClient()
  // Конец факт. смены в 00:00 следующих суток показываем как 24:00.
  const endToField = (iso?: string | null) => {
    if (!iso) return ''
    const t = iso.slice(11, 16)
    return (t === '00:00' && iso.slice(0, 10) > shift.shift_date) ? '24:00' : t
  }
  const [actualDate, setActualDate] = useState(shift.shift_date)
  const [start, setStart] = useState(endToFieldStart(shift))
  const [end, setEnd] = useState(endToField(shift.actual_end_time || shift.end_time))
  const [hoursWorked, setHoursWorked] = useState(shift.actual_hours_worked || '')
  const [mode, setMode] = useState<'full' | 'custom'>('full')

  const mutation = useMutation({
    mutationFn: (body: any) => api.post(`/schedules/shifts/${shift.id}/confirm`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts'] })
      qc.invalidateQueries({ queryKey: ['assign-shifts'] })
      onClose()
    },
  })

  const handleFull = () => {
    mutation.mutate({ actual_start_time: shift.start_time, actual_end_time: shift.end_time, actual_hours_worked: null })
  }

  const handleCustom = () => {
    const startIso = start ? `${actualDate}T${start}` : null
    let endIso: string | null = null
    if (end) {
      let endTime = end, endDate = actualDate
      if (end === '24:00') { endTime = '00:00'; endDate = format(addDays(new Date(actualDate), 1), 'yyyy-MM-dd') }
      else if (end <= start) { endDate = format(addDays(new Date(actualDate), 1), 'yyyy-MM-dd') }
      endIso = `${endDate}T${endTime}`
    }
    mutation.mutate({ actual_start_time: startIso, actual_end_time: endIso, actual_hours_worked: hoursWorked || null })
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-50 rounded-lg p-3 text-sm">
        <p className="font-medium text-slate-800">{shift.employee_name}</p>
        <p className="text-slate-500 mt-0.5">{dispD(shift.shift_date)} · план: {shift.start_time?.slice(11,16) || '?'}–{shift.end_time?.slice(11,16) || '?'} · {plannedHours(shift)}</p>
        {(shift as any).actual_hours_worked && (
          <p className="text-blue-600 mt-0.5">Данные Naumen: {(shift as any).actual_hours_worked} ч</p>
        )}
      </div>

      <div className="flex gap-2">
        <button onClick={() => setMode('full')} className={`flex-1 py-2 text-sm rounded-lg border font-medium transition-colors ${mode === 'full' ? 'bg-green-50 border-green-400 text-green-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
          Полностью отработана
        </button>
        <button onClick={() => setMode('custom')} className={`flex-1 py-2 text-sm rounded-lg border font-medium transition-colors ${mode === 'custom' ? 'bg-blue-50 border-blue-400 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
          Указать часы
        </button>
      </div>

      {mode === 'custom' && (
        <div className="space-y-3">
          <div><label className="label">Дата</label><DatePicker value={actualDate} onChange={setActualDate} className="w-44" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Факт. начало</label><TimeSelect value={start} onChange={setStart} /></div>
            <div><label className="label">Факт. конец <span className="text-slate-400 font-normal">(24:00 = полночь)</span></label><TimeSelect value={end} onChange={setEnd} /></div>
          </div>
          <div><label className="label">Отработано часов <span className="text-slate-400 font-normal">(если известно)</span></label>
            <input type="number" step="0.5" min="0" max="24" className="input w-32" placeholder="напр. 7.5" value={hoursWorked}
              onChange={(e) => setHoursWorked(e.target.value)} />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className="btn-secondary">Отмена</button>
        <button
          onClick={() => mode === 'full' ? handleFull() : handleCustom()}
          disabled={mutation.isPending}
          className="btn-primary"
        >
          <Check size={15} strokeWidth={2.5} /> Подтвердить
        </button>
      </div>
    </div>
  )
}

// Факт. начало смены в поле HH:MM (из факт. или планового времени).
function endToFieldStart(shift: Shift): string {
  return (shift.actual_start_time || shift.start_time)?.slice(11, 16) || ''
}

// ─── Главная страница смен ──────────────────────────────────────────────────
export default function ShiftsPage() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const { activeProject } = useProjectStore()
  const [view, setView] = useState<ViewMode>('planned')
  const [showForm, setShowForm] = useState(false)
  const [editShift, setEditShift] = useState<Shift | null>(null)
  const [confirmShift, setConfirmShift] = useState<Shift | null>(null)
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(addDays(new Date(), 30), 'yyyy-MM-dd'))
  // Период выгрузки Excel — выбирается отдельно (по умолчанию текущий месяц),
  // чтобы не грузить весь большой диапазон страницы.
  const [showExport, setShowExport] = useState(false)
  const [exportFrom, setExportFrom] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [exportTo, setExportTo] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'))
  const qc = useQueryClient()

  const downloadExcel = async (from: string, to: string) => {
    const res = await api.get('/schedules/shifts/export.xlsx', {
      params: { project_uuid: activeProject?.customer_uuid, date_from: from, date_to: to },
      responseType: 'blob',
    })
    const url = URL.createObjectURL(res.data as Blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `График_${from}_${to}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const { data, isLoading } = useQuery({
    queryKey: ['shifts', activeProject?.customer_uuid, dateFrom, dateTo],
    queryFn: () => api.get('/schedules/shifts', { params: { project_uuid: activeProject?.customer_uuid, date_from: dateFrom, date_to: dateTo } }).then((r) => r.data as Shift[]),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/schedules/shifts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shifts'] }),
  })

  const reconcileMutation = useMutation({
    mutationFn: () => api.post('/schedules/shifts/reconcile'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shifts'] }),
  })

  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ['operator-sessions', activeProject?.customer_uuid, dateFrom, dateTo],
    queryFn: () =>
      api.get('/analytics/operator-sessions', {
        params: { partner_uuid: activeProject!.customer_uuid, begin: dateFrom, end: dateTo },
      }).then((r) => r.data.data as OperatorSession[]),
    enabled: !!activeProject && view === 'past',
  })

  const [shiftSortKey, setShiftSortKey] = useState<ShiftSortKey>('shift_date')
  const [shiftSortDir, setShiftSortDir] = useState<'asc' | 'desc'>('asc')
  const [sessSortKey, setSessSortKey] = useState<SessionSortKey>('first_login')
  const [sessSortDir, setSessSortDir] = useState<'asc' | 'desc'>('asc')
  // Раскрытые строки операторов (для временной линии)
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())

  const handleShiftSort = (key: ShiftSortKey) => {
    if (shiftSortKey === key) setShiftSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setShiftSortKey(key); setShiftSortDir('asc') }
  }
  const handleSessSort = (key: SessionSortKey) => {
    if (sessSortKey === key) setSessSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSessSortKey(key); setSessSortDir('asc') }
  }
  const toggleSession = useCallback((key: string) => {
    setExpandedSessions((prev) => {
      const n = new Set(prev)
      n.has(key) ? n.delete(key) : n.add(key)
      return n
    })
  }, [])

  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set())
  const toggleDate = (date: string) =>
    setExpandedDates((prev) => { const n = new Set(prev); n.has(date) ? n.delete(date) : n.add(date); return n })

  const sessionsByDate = useMemo(() => {
    const groups: Record<string, OperatorSession[]> = {}
    for (const s of sessions || []) {
      if (!groups[s.work_date]) groups[s.work_date] = []
      groups[s.work_date].push(s)
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a))
  }, [sessions])

  const filtered = useMemo(() => {
    if (!data) return []
    const f = data.filter((sh) => {
      if (view === 'past') return sh.shift_date < today
      if (view === 'active') return sh.shift_date === today
      return sh.shift_date > today
    })
    return [...f].sort((a, b) => {
      const av = (a as any)[shiftSortKey] ?? ''
      const bv = (b as any)[shiftSortKey] ?? ''
      const cmp = String(av).localeCompare(String(bv), 'ru')
      return shiftSortDir === 'asc' ? cmp : -cmp
    })
  }, [data, view, today, shiftSortKey, shiftSortDir])

  const needsReview = (data || []).filter((sh) => (sh as any).needs_review).length

  const VIEW_TABS: { id: ViewMode; label: string; count?: number }[] = [
    { id: 'past', label: 'Прошедшие', count: (data || []).filter((s) => s.shift_date < today).length },
    { id: 'active', label: 'Активные', count: (data || []).filter((s) => s.shift_date === today).length },
    { id: 'planned', label: 'Запланированные', count: (data || []).filter((s) => s.shift_date > today).length },
    { id: 'assign', label: 'Поставить смены' },
  ]

  return (
    <div>
      <PageHeader
        title="Смены сотрудников"
        subtitle="Плановые и фактические рабочие смены"
        actions={
          <div className="flex gap-2">
            {needsReview > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-700">
                <AlertTriangle size={14} />
                {needsReview} требует проверки
              </div>
            )}
            <button onClick={() => setShowExport(true)} className="btn-secondary"><Download size={14} /> Excel</button>
            <button onClick={() => reconcileMutation.mutate()} disabled={reconcileMutation.isPending} className="btn-secondary" title="Сверить вчерашние смены с Naumen">
              <RefreshCw size={14} className={reconcileMutation.isPending ? 'animate-spin' : ''} /> Сверить
            </button>
            <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> Назначить смену</button>
          </div>
        }
      />

      {reconcileMutation.data && (
        <div className="card p-3 mb-4 bg-blue-50 border-blue-200 text-sm text-blue-700 flex items-center gap-2">
          <CheckCircle size={14} />
          Сверка завершена: обновлено {(reconcileMutation.data as any).data?.updated}, помечено {(reconcileMutation.data as any).data?.flagged}, пропущено {(reconcileMutation.data as any).data?.skipped}
        </div>
      )}

      {/* Date range */}
      {view !== 'assign' && (
        <div className="card p-4 mb-4 flex gap-4 items-end">
          <div><label className="label">С</label><DatePicker value={dateFrom} onChange={setDateFrom} className="w-40" /></div>
          <div><label className="label">По</label><DatePicker value={dateTo} onChange={setDateTo} className="w-40" /></div>
          <p className="text-sm text-slate-400 pb-1">Всего смен: {data?.length ?? 0}</p>
        </div>
      )}

      {/* View tabs */}
      <div className="flex gap-1 mb-4 border-b border-slate-200">
        {VIEW_TABS.map(({ id, label, count }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              view === id ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
            {count !== undefined && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${view === id ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Проставление смен по календарю */}
      {view === 'assign' && <AssignShiftsView />}

      {/* Table */}
      {view !== 'assign' && (
      <div className="card overflow-hidden">
        {isLoading ? <PageSpinner /> : filtered.length === 0 ? (
          <EmptyState
            title={view === 'planned' ? 'Нет запланированных смен' : view === 'active' ? 'Нет активных смен сегодня' : 'Нет прошедших смен'}
            icon={<Clock4 size={40} />}
            action={view === 'planned' ? <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> Назначить</button> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <SortTh label="Сотрудник" sortKey="employee_name" current={shiftSortKey} dir={shiftSortDir} onSort={handleShiftSort} />
                  <SortTh label="Дата" sortKey="shift_date" current={shiftSortKey} dir={shiftSortDir} onSort={handleShiftSort} />
                  <SortTh label="Нач. план" sortKey="start_time" current={shiftSortKey} dir={shiftSortDir} onSort={handleShiftSort} />
                  <SortTh label="Кон. план" sortKey="end_time" current={shiftSortKey} dir={shiftSortDir} onSort={handleShiftSort} />
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Плановые ч</th>
                  {view === 'past' && <>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Нач. факт</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Кон. факт</th>
                    <SortTh label="Отработано ч" sortKey="actual_hours_worked" current={shiftSortKey} dir={shiftSortDir} onSort={handleShiftSort} />
                  </>}
                  <SortTh label="График" sortKey="schedule_name" current={shiftSortKey} dir={shiftSortDir} onSort={handleShiftSort} />
                  <SortTh label="Статус" sortKey="status" current={shiftSortKey} dir={shiftSortDir} onSort={handleShiftSort} />
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((sh) => {
                  const isReview = sh.needs_review
                  return (
                    <tr key={sh.id} className={`border-b border-slate-50 hover:bg-slate-50 ${isReview ? 'bg-amber-50' : ''}`}>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        <div className="flex items-center gap-2">
                          {sh.employee_name || `#${sh.employee_id}`}
                          {isReview && <span title="Расхождение с Naumen — требует проверки"><AlertTriangle size={13} className="text-amber-500 flex-shrink-0" /></span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{sh.shift_date}</td>
                      <td className="px-4 py-3 text-slate-600">{sh.start_time?.slice(11, 16) || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{sh.end_time?.slice(11, 16) || '—'}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{plannedHours(sh)}</td>
                      {view === 'past' && <>
                        <td className="px-4 py-3 text-blue-700">{sh.actual_start_time?.slice(11, 16) || '—'}</td>
                        <td className="px-4 py-3 text-blue-700">{sh.actual_end_time?.slice(11, 16) || '—'}</td>
                        <td className="px-4 py-3">
                          {sh.actual_hours_worked
                            ? <span className={`font-semibold ${isReview ? 'text-amber-700' : 'text-green-700'}`}>{sh.actual_hours_worked} ч</span>
                            : <span className="text-slate-300">—</span>}
                        </td>
                      </>}
                      <td className="px-4 py-3 text-slate-500">{sh.schedule_name || '—'}</td>
                      <td className="px-4 py-3"><Badge label={SHIFT_STATUSES[sh.status] || sh.status} color={STATUS_COLOR[sh.status] || 'gray'} /></td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end">
                          {view === 'past' && (
                            <button onClick={() => setConfirmShift(sh)} className="p-1.5 hover:bg-green-50 rounded text-slate-400 hover:text-green-600" title="Подтвердить / указать часы">
                              <Check size={14} strokeWidth={2.5} />
                            </button>
                          )}
                          <button onClick={() => setEditShift(sh)} className="p-1.5 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600"><Pencil size={12} /></button>
                          <button onClick={() => confirm('Удалить смену?') && deleteMutation.mutate(sh.id)} className="p-1.5 hover:bg-red-50 rounded text-slate-400 hover:text-red-600"><Trash2 size={12} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* Данные из Naumen — история сессий, только для вкладки "Прошедшие" */}
      {view === 'past' && (
        <>
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-slate-200" />
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">Данные из Naumen</p>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {!activeProject ? (
            <div className="card p-4 text-sm text-amber-700 bg-amber-50">Выберите проект, чтобы загрузить данные из Naumen</div>
          ) : sessionsLoading ? (
            <PageSpinner />
          ) : !sessionsByDate.length ? (
            <div className="card p-6 text-center text-sm text-slate-400">Нет данных из Naumen за выбранный период</div>
          ) : (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-800">История сессий операторов</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Нажмите на дату, чтобы посмотреть детали по операторам</p>
                </div>
                <button
                  onClick={() => setExpandedDates(new Set(sessionsByDate.map(([d]) => d)))}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                >
                  Развернуть все
                </button>
              </div>

              {sessionsByDate.map(([date, rows]) => {
                const isOpen = expandedDates.has(date)
                const firstLogins = rows.filter((r) => r.first_login).map((r) => r.first_login!.slice(11, 16)).sort()
                const lastLogouts = rows.filter((r) => r.last_logout).map((r) => r.last_logout!.slice(11, 16)).sort()
                const sortedRows = [...rows].sort((a, b) => {
                  const av = (a as any)[sessSortKey] ?? ''
                  const bv = (b as any)[sessSortKey] ?? ''
                  const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
                  return sessSortDir === 'asc' ? cmp : -cmp
                })
                return (
                  <div key={date}>
                    <button
                      onClick={() => toggleDate(date)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 border-b border-slate-100 text-left"
                    >
                      {isOpen ? <ChevronDown size={14} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />}
                      <span className="font-semibold text-slate-800 w-28">{date}</span>
                      <span className="text-xs text-slate-500">{rows.length} операторов</span>
                      {firstLogins.length > 0 && (
                        <span className="text-xs text-slate-400 ml-auto mr-2">
                          Первый вход: <span className="text-green-600 font-medium">{firstLogins[0]}</span>
                          {' · '}Последний выход: <span className="text-red-600 font-medium">{lastLogouts[lastLogouts.length - 1] || '—'}</span>
                        </span>
                      )}
                    </button>

                    {isOpen && (
                      <div className="bg-slate-50 border-b border-slate-100 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-slate-200">
                              <th className="w-8 px-2 py-2" />
                              <SortTh label="ФИО" sortKey="employee_name" current={sessSortKey} dir={sessSortDir} onSort={handleSessSort} className="py-2" />
                              <SortTh label="Первый вход" sortKey="first_login" current={sessSortKey} dir={sessSortDir} onSort={handleSessSort} className="py-2" />
                              <SortTh label="Последний выход" sortKey="last_logout" current={sessSortKey} dir={sessSortDir} onSort={handleSessSort} className="py-2" />
                              <SortTh label="В смене (мин)" sortKey="shift_sec" current={sessSortKey} dir={sessSortDir} onSort={handleSessSort} className="py-2" />
                              <SortTh label="В линии (мин)" sortKey="normal_sec" current={sessSortKey} dir={sessSortDir} onSort={handleSessSort} className="py-2" />
                              <SortTh label="На паузе (мин)" sortKey="non_normal_sec" current={sessSortKey} dir={sessSortDir} onSort={handleSessSort} className="py-2" />
                              <SortTh label="Вышли (мин)" sortKey="offline_sec" current={sessSortKey} dir={sessSortDir} onSort={handleSessSort} className="py-2" />
                              <SortTh label="Пауз" sortKey="break_count" current={sessSortKey} dir={sessSortDir} onSort={handleSessSort} className="py-2" />
                            </tr>
                          </thead>
                          <tbody>
                            {sortedRows.map((s, i) => {
                              const sessKey = `${date}-${s.login}`
                              const isExpanded = expandedSessions.has(sessKey)
                              const shiftMin = s.shift_sec != null ? Math.round(s.shift_sec / 60) : null
                              const onlineMin = s.normal_sec != null ? Math.round(s.normal_sec / 60) : null
                              const pauseMin = s.non_normal_sec != null ? Math.round(s.non_normal_sec / 60) : null
                              const offlineMin = s.offline_sec != null ? Math.round(s.offline_sec / 60) : null
                              const busyPct = shiftMin && shiftMin > 0 && onlineMin != null
                                ? Math.min(100, Math.round((onlineMin / shiftMin) * 100))
                                : null
                              return (
                                <>
                                  <tr
                                    key={i}
                                    onClick={() => toggleSession(sessKey)}
                                    className="border-b border-slate-100 hover:bg-white cursor-pointer select-none"
                                  >
                                    <td className="px-2 py-2 text-center text-slate-400">
                                      {isExpanded
                                        ? <ChevronDown size={13} />
                                        : <Activity size={13} className="opacity-40" />}
                                    </td>
                                    <td className="px-4 py-2 font-medium text-slate-900">{s.employee_name || s.login}</td>
                                    <td className="px-4 py-2 text-green-700 font-medium">{s.first_login?.slice(11, 16) || '—'}</td>
                                    <td className="px-4 py-2 text-red-600">{s.last_logout?.slice(11, 16) || '—'}</td>
                                    <td className="px-4 py-2">
                                      {shiftMin != null ? (
                                        <div className="flex items-center gap-2">
                                          <span className="font-semibold text-slate-800">{shiftMin}</span>
                                          {busyPct != null && (
                                            <div className="w-14 h-1.5 bg-slate-200 rounded-full overflow-hidden flex-shrink-0">
                                              <div className="h-full rounded-full bg-brand-400" style={{ width: `${busyPct}%` }} />
                                            </div>
                                          )}
                                        </div>
                                      ) : '—'}
                                    </td>
                                    <td className="px-4 py-2 text-blue-700 font-medium">{onlineMin ?? '—'}</td>
                                    <td className="px-4 py-2 text-amber-600">{pauseMin ?? '—'}</td>
                                    <td className="px-4 py-2 text-slate-500">{offlineMin ?? '—'}</td>
                                    <td className="px-4 py-2 text-slate-500">{s.break_count ?? '—'}</td>
                                  </tr>
                                  {isExpanded && (
                                    <tr key={`${i}-tl`} className="border-b border-slate-100">
                                      <td colSpan={9} className="p-0">
                                        <StatusTimeline login={s.login} workDate={date} partnerUuid={activeProject?.customer_uuid} employeeName={s.employee_name || s.login} />
                                      </td>
                                    </tr>
                                  )}
                                </>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {showForm && <Modal open size="xl" title="Назначить смену" onClose={() => setShowForm(false)}>
        <ShiftAssignModal projectUuid={activeProject?.customer_uuid} onClose={() => setShowForm(false)} /></Modal>}
      {editShift && <Modal open size="xl" title="Смена сотрудника" onClose={() => setEditShift(null)}>
        <ShiftAssignModal employee={{ id: editShift.employee_id, full_name: editShift.employee_name || `#${editShift.employee_id}` }}
          projectUuid={activeProject?.customer_uuid} initialDate={editShift.shift_date} onClose={() => setEditShift(null)} /></Modal>}
      {confirmShift && <Modal open title="Подтверждение смены" onClose={() => setConfirmShift(null)}><ConfirmModal shift={confirmShift} onClose={() => setConfirmShift(null)} /></Modal>}

      {showExport && (
        <Modal open title="Выгрузка графика в Excel" onClose={() => setShowExport(false)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-500">Выберите период, за который выгрузить фактические смены — чтобы не грузить весь большой диапазон.</p>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">С</label><DatePicker value={exportFrom} onChange={setExportFrom} /></div>
              <div><label className="label">По</label><DatePicker value={exportTo} onChange={setExportTo} /></div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {([['Текущий месяц', startOfMonth(new Date()), endOfMonth(new Date())],
                 ['Прошлый месяц', startOfMonth(subDays(startOfMonth(new Date()), 1)), endOfMonth(subDays(startOfMonth(new Date()), 1))],
                 ['Последние 7 дней', subDays(new Date(), 6), new Date()],
                ] as [string, Date, Date][]).map(([lbl, f, t]) => (
                <button key={lbl} type="button" onClick={() => { setExportFrom(format(f, 'yyyy-MM-dd')); setExportTo(format(t, 'yyyy-MM-dd')) }}
                  className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:border-brand-300 hover:bg-brand-50">{lbl}</button>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button onClick={() => setShowExport(false)} className="btn-secondary">Отмена</button>
              <button onClick={async () => { await downloadExcel(exportFrom, exportTo); setShowExport(false) }} className="btn-primary"><Download size={14} /> Скачать Excel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

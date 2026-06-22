import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Clock4, Save, CheckCircle, AlertTriangle, Download, RefreshCw, ChevronRight, ChevronLeft, ChevronDown, Activity, Eye, X, Target, CalendarDays } from 'lucide-react'
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
import StatusTimeline from '@/components/StatusTimeline'
import ShiftAssignModal from '@/components/worktime/ShiftAssignModal'
import DatePicker from '@/components/common/DatePicker'

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

// ─── Вкладка «Проставить смены»: список сотрудников + календарь покрытия ──────
function AssignShiftsView() {
  const { activeProject } = useProjectStore()
  const { user: me } = useAuthStore()
  const [myTeamsOnly, setMyTeamsOnly] = useState(false)
  const [openTeams, setOpenTeams] = useState<Set<string>>(new Set())
  const [assignEmp, setAssignEmp] = useState<Employee | null>(null)
  const [viewEmp, setViewEmp] = useState<Employee | null>(null)
  const [calMonth, setCalMonth] = useState(() => startOfMonth(new Date()))
  const [activeOp, setActiveOp] = useState<Employee | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)

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

  if (!activeProject) return <div className="card p-6 text-sm text-amber-700 bg-amber-50">Выберите проект в шапке</div>

  const isMyTeam = (t: Team) => !!me && (t.leader_user_id === me.id || (t.user_ids || []).includes(me.id))
  const activeEmps = (employees || []).filter((e) => e.employment_status !== 'fired')
  const byTeam: Record<number, Employee[]> = {}
  const noTeam: Employee[] = []
  for (const e of activeEmps) {
    if (e.team_id == null) noTeam.push(e)
    else (byTeam[e.team_id] = byTeam[e.team_id] || []).push(e)
  }
  // «Мои команды» показываем даже без сотрудников (раньше пустая команда пропадала).
  const visibleTeams = (teams || []).filter((t) => (myTeamsOnly ? isMyTeam(t) : (byTeam[t.id]?.length)))
  const toggleTeam = (k: string) => setOpenTeams((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n })

  // Календарь покрытия
  const shownShifts = (monthShifts || []).filter((s) => !activeOp || s.employee_id === activeOp.id)
  const shiftsByDay: Record<string, Shift[]> = {}
  for (const s of shownShifts) (shiftsByDay[s.shift_date] = shiftsByDay[s.shift_date] || []).push(s)
  const calCells = Array.from({ length: 42 }, (_, i) => addDays(startOfWeek(startOfMonth(calMonth), { weekStartsOn: 1 }), i))
  const empName = (id: number) => activeEmps.find((e) => e.id === id)?.full_name || `#${id}`

  const EmpCard = ({ e }: { e: Employee }) => (
    <div className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 border-b border-slate-50 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{e.full_name}</p>
        <p className="text-xs text-slate-400 truncate">{e.position || '—'} · приоритетный график: {e.preferred_schedule || '—'}</p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button onClick={() => { setActiveOp(e); setSelectedDay(null) }} title="Показать смены в календаре"
          className={`p-1.5 rounded-lg text-xs font-medium ${activeOp?.id === e.id ? 'bg-brand-100 text-brand-700' : 'hover:bg-slate-100 text-slate-400 hover:text-brand-600'}`}>
          <Target size={13} />
        </button>
        <button onClick={() => setAssignEmp(e)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-medium"><Clock4 size={13} /> Проставить смены</button>
        <button onClick={() => setViewEmp(e)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700" title="Просмотреть смены"><Eye size={13} /></button>
      </div>
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input type="checkbox" checked={myTeamsOnly} onChange={(e) => setMyTeamsOnly(e.target.checked)} />
          <span className="text-sm font-medium text-slate-700">Мои команды</span>
        </label>
        <p className="text-xs text-slate-400">Сотрудников: {activeEmps.length}</p>
      </div>

      <div className="space-y-3 mb-6">
        {visibleTeams.map((t) => {
          const emps = byTeam[t.id] || []
          const open = openTeams.has(`t${t.id}`)
          return (
            <div key={t.id} className="card overflow-hidden">
              <button onClick={() => toggleTeam(`t${t.id}`)} className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-50 text-left">
                {open ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
                <span className="font-medium text-slate-800">{t.name}</span>
                <Badge label={`${emps.length} чел.`} color="blue" />
                {isMyTeam(t) && <span className="text-xs text-brand-600 font-medium">моя</span>}
              </button>
              {open && (emps.length ? <div>{emps.map((e) => <EmpCard key={e.id} e={e} />)}</div>
                : <p className="px-4 py-3 text-xs text-slate-400 italic">В команде нет сотрудников</p>)}
            </div>
          )
        })}

        {!myTeamsOnly && noTeam.length > 0 && (
          <div className="card overflow-hidden">
            <button onClick={() => toggleTeam('none')} className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-50 text-left">
              {openTeams.has('none') ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
              <span className="font-medium text-slate-800">Без команды</span>
              <Badge label={`${noTeam.length} чел.`} color="gray" />
            </button>
            {openTeams.has('none') && <div>{noTeam.map((e) => <EmpCard key={e.id} e={e} />)}</div>}
          </div>
        )}

        {visibleTeams.length === 0 && (myTeamsOnly || noTeam.length === 0) && (
          <EmptyState title={myTeamsOnly ? 'Нет ваших команд' : 'Нет сотрудников'} icon={<Clock4 size={40} />} />
        )}
      </div>

      {/* Календарь покрытия смен */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <CalendarDays size={16} className="text-brand-500" />
          <h2 className="text-sm font-semibold text-slate-800">Календарь покрытия смен</h2>
          <span className="text-xs text-slate-400">— заливка дня = доля закрытых часов (0–24ч)</span>
        </div>
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Календарь */}
          <div className="lg:w-[360px] flex-shrink-0">
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
                const hours = dayCoverageHours(ds, shiftsByDay[ds] || [])
                const pct = Math.min(1, hours / 24)
                const deg = pct * 360
                const isSel = ds === selectedDay && !activeOp
                return (
                  <button key={ds} type="button"
                    onClick={() => { if (!activeOp) setSelectedDay(isSel ? null : ds) }}
                    title={`${dispD(ds)} · покрыто ${hours.toFixed(1)}ч`}
                    className={`flex items-center justify-center ${activeOp ? 'cursor-default' : 'cursor-pointer'}`}>
                    <div className={`relative w-10 h-10 rounded-full ${isSel ? 'ring-2 ring-brand-500 ring-offset-1' : ''}`}
                      style={{ background: `conic-gradient(#22c55e ${deg}deg, #e2e8f0 ${deg}deg)` }}>
                      <div className={`absolute inset-[3px] rounded-full bg-white flex items-center justify-center text-xs font-medium ${inM ? 'text-slate-700' : 'text-slate-300'}`}>
                        {c.getDate()}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Правая часть: оператор или день */}
          <div className="flex-1 min-w-0 border-l border-slate-100 lg:pl-6">
            {activeOp ? (
              <>
                <div className="flex items-center justify-between bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 mb-3">
                  <span className="text-sm font-medium text-brand-800 truncate">{activeOp.full_name}</span>
                  <button onClick={() => setActiveOp(null)} className="text-brand-400 hover:text-red-500 flex-shrink-0"><X size={15} /></button>
                </div>
                <p className="text-xs text-slate-400 mb-2">Смены за {CAL_MONTHS[calMonth.getMonth()].toLowerCase()}</p>
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {shownShifts.length === 0 ? <p className="text-sm text-slate-400">Нет смен в этом месяце</p> :
                    [...shownShifts].sort((a, b) => a.shift_date.localeCompare(b.shift_date)).map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-sm px-3 py-1.5 rounded-lg hover:bg-slate-50">
                        <span className="text-slate-700">{dispD(s.shift_date)}</span>
                        <span className="text-slate-500">{s.start_time?.slice(11, 16)}–{s.end_time?.slice(11, 16)}{s.lunch_minutes ? ` · обед ${s.lunch_minutes}м` : ''}</span>
                      </div>
                    ))}
                </div>
              </>
            ) : selectedDay ? (
              <>
                <p className="text-sm font-semibold text-slate-800 mb-2">Смены на {dispD(selectedDay)}</p>
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {(shiftsByDay[selectedDay] || []).length === 0 ? <p className="text-sm text-slate-400">На этот день никто не назначен</p> :
                    [...(shiftsByDay[selectedDay] || [])].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || '')).map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-sm px-3 py-1.5 rounded-lg hover:bg-slate-50">
                        <span className="text-slate-700 truncate">{s.employee_name || empName(s.employee_id)}</span>
                        <span className="text-slate-500 flex-shrink-0 ml-2">{s.start_time?.slice(11, 16)}–{s.end_time?.slice(11, 16)}</span>
                      </div>
                    ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-400">
                Нажмите на день — увидите, кто на него назначен. Кнопка <Target size={12} className="inline" /> у сотрудника покажет в календаре только его смены.
              </p>
            )}
          </div>
        </div>
      </div>

      {assignEmp && <Modal open size="xl" title={`Смены: ${assignEmp.full_name}`} onClose={() => setAssignEmp(null)}><ShiftAssignModal employee={assignEmp} onClose={() => setAssignEmp(null)} /></Modal>}
      {viewEmp && <Modal open size="xl" title={`Смены (просмотр): ${viewEmp.full_name}`} onClose={() => setViewEmp(null)}><ShiftAssignModal employee={viewEmp} readOnly onClose={() => setViewEmp(null)} /></Modal>}
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

// ─── Форма создания/редактирования смены ────────────────────────────────────
function ShiftForm({ shift, onClose }: { shift?: Shift | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: employees } = useQuery({ queryKey: ['employees'], queryFn: () => api.get('/employees').then((r) => r.data as any[]) })
  const { data: schedules } = useQuery({ queryKey: ['schedules'], queryFn: () => api.get('/schedules').then((r) => r.data as any[]) })
  const [form, setForm] = useState({
    employee_id: shift?.employee_id ?? '' as any,
    schedule_id: shift?.schedule_id ?? '' as any,
    shift_date: shift?.shift_date ?? format(new Date(), 'yyyy-MM-dd'),
    start_time: shift?.start_time?.slice(0, 16) ?? '',
    end_time: shift?.end_time?.slice(0, 16) ?? '',
    lunch_minutes: (shift?.lunch_minutes ?? '') as any,
    status: shift?.status ?? 'planned',
    notes: shift?.notes ?? '',
  })
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: (d: any) => shift ? api.put(`/schedules/shifts/${shift.id}`, d) : api.post('/schedules/shifts', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shifts'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail || 'Ошибка'),
  })

  // Выбор графика → автоматически проставляем дату+время начала и конца смены
  // (с учётом ночных смен, где конец приходится на следующий день).
  const applySchedule = (schedId: string, date: string) => {
    const sched = schedules?.find((s: any) => String(s.id) === String(schedId))
    setForm((f) => {
      const base: any = { ...f, schedule_id: schedId, shift_date: date }
      if (sched?.work_start && sched?.work_end) {
        const endDate = sched.work_end <= sched.work_start ? format(addDays(new Date(date), 1), 'yyyy-MM-dd') : date
        base.start_time = `${date}T${sched.work_start}`
        base.end_time = `${endDate}T${sched.work_end}`
        if (sched.break_duration != null && (f.lunch_minutes === '' || f.lunch_minutes == null)) base.lunch_minutes = sched.break_duration
      }
      return base
    })
  }

  // Выбор даты → дата автоматически проставляется в начало/конец смены.
  const onDateChange = (date: string) => {
    if (form.schedule_id) { applySchedule(form.schedule_id, date); return }
    setForm((f) => {
      const reDate = (dt: string) => (dt ? `${date}T${dt.slice(11, 16)}` : dt)
      return { ...f, shift_date: date, start_time: reDate(f.start_time), end_time: reDate(f.end_time) }
    })
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); mutation.mutate({ ...form, employee_id: +form.employee_id, schedule_id: form.schedule_id || null, lunch_minutes: form.lunch_minutes === '' ? null : +form.lunch_minutes }) }} className="space-y-4">
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      <div><label className="label">Сотрудник *</label>
        <select className="input" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} required>
          <option value="">— выберите —</option>
          {employees?.map((e: any) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className="label">Дата смены *</label><DatePicker value={form.shift_date} onChange={onDateChange} /></div>
        <div><label className="label">График</label>
          <select className="input" value={form.schedule_id} onChange={(e) => applySchedule(e.target.value, form.shift_date)}>
            <option value="">— без шаблона —</option>
            {schedules?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div><label className="label">Начало смены</label><input type="datetime-local" className="input" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
        <div><label className="label">Конец смены</label><input type="datetime-local" className="input" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className="label">Обед (мин) <span className="text-slate-400 font-normal">— пусто = без обеда</span></label>
          <input type="number" min={0} max={180} step={5} className="input" placeholder="0" value={form.lunch_minutes}
            onChange={(e) => setForm({ ...form, lunch_minutes: e.target.value })} /></div>
        <div><label className="label">Статус</label>
          <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {Object.entries(SHIFT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <div><label className="label">Примечание</label><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Отмена</button>
        <button type="submit" className="btn-primary" disabled={mutation.isPending}><Save size={14} /> Сохранить</button>
      </div>
    </form>
  )
}

// ─── Модальное окно подтверждения / указания факт. часов ────────────────────
function ConfirmModal({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    actual_start_time: shift.actual_start_time || shift.start_time?.slice(0, 16) || '',
    actual_end_time: shift.actual_end_time || shift.end_time?.slice(0, 16) || '',
    actual_hours_worked: shift.actual_hours_worked || '',
  })
  const [mode, setMode] = useState<'full' | 'custom'>('full')

  const mutation = useMutation({
    mutationFn: (body: any) => api.post(`/schedules/shifts/${shift.id}/confirm`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shifts'] }); onClose() },
  })

  const handleFull = () => {
    mutation.mutate({
      actual_start_time: shift.start_time,
      actual_end_time: shift.end_time,
      actual_hours_worked: null,
    })
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-50 rounded-lg p-3 text-sm">
        <p className="font-medium text-slate-800">{shift.employee_name}</p>
        <p className="text-slate-500 mt-0.5">{shift.shift_date} · план: {shift.start_time?.slice(11,16) || '?'}–{shift.end_time?.slice(11,16) || '?'} · {plannedHours(shift)}</p>
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
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Факт. начало</label><input type="datetime-local" className="input" value={form.actual_start_time} onChange={(e) => setForm({ ...form, actual_start_time: e.target.value })} /></div>
            <div><label className="label">Факт. конец</label><input type="datetime-local" className="input" value={form.actual_end_time} onChange={(e) => setForm({ ...form, actual_end_time: e.target.value })} /></div>
          </div>
          <div><label className="label">Отработано часов (если известно)</label>
            <input type="number" step="0.5" min="0" max="24" className="input w-32" placeholder="напр. 7.5" value={form.actual_hours_worked}
              onChange={(e) => setForm({ ...form, actual_hours_worked: e.target.value })} />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onClose} className="btn-secondary">Отмена</button>
        <button
          onClick={() => mode === 'full' ? handleFull() : mutation.mutate(form)}
          disabled={mutation.isPending}
          className="btn-primary"
        >
          <CheckCircle size={14} /> Подтвердить
        </button>
      </div>
    </div>
  )
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
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['shifts', dateFrom, dateTo],
    queryFn: () => api.get('/schedules/shifts', { params: { date_from: dateFrom, date_to: dateTo } }).then((r) => r.data as Shift[]),
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
    { id: 'assign', label: 'Проставить смены' },
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
            <button
              onClick={async () => {
                const res = await api.get('/schedules/shifts/export.xlsx', {
                  params: { project_uuid: activeProject?.customer_uuid, date_from: dateFrom, date_to: dateTo },
                  responseType: 'blob',
                })
                const url = URL.createObjectURL(res.data as Blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `График_${dateFrom}_${dateTo}.xlsx`
                a.click()
                URL.revokeObjectURL(url)
              }}
              className="btn-secondary"
            ><Download size={14} /> Excel</button>
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
                              <CheckCircle size={13} />
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

      {showForm && <Modal open title="Назначить смену" onClose={() => setShowForm(false)}><ShiftForm onClose={() => setShowForm(false)} /></Modal>}
      {editShift && <Modal open title="Редактировать смену" onClose={() => setEditShift(null)}><ShiftForm shift={editShift} onClose={() => setEditShift(null)} /></Modal>}
      {confirmShift && <Modal open title="Подтверждение смены" onClose={() => setConfirmShift(null)}><ConfirmModal shift={confirmShift} onClose={() => setConfirmShift(null)} /></Modal>}
    </div>
  )
}

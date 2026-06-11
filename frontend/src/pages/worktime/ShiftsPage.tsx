import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Clock4, Save, CheckCircle, AlertTriangle, Download, RefreshCw, ChevronRight, ChevronDown, Activity } from 'lucide-react'
import api from '@/api/client'
import type { Shift, OperatorSession, TimelineEvent } from '@/types'
import { SHIFT_STATUSES } from '@/types'
import { useProjectStore } from '@/store/project'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/common/EmptyState'
import { format, subDays, addDays } from 'date-fns'

type ShiftSortKey = 'employee_name' | 'shift_date' | 'start_time' | 'end_time' | 'schedule_name' | 'status' | 'actual_hours_worked'
type SessionSortKey = 'employee_name' | 'first_login' | 'last_logout' | 'normal_sec' | 'non_normal_sec' | 'shift_sec' | 'break_count'

// ─── Цвета статусов для временной линии ─────────────────────────────────────
const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  normal:    { bg: '#22c55e', text: '#fff', label: 'В линии' },
  available: { bg: '#4ade80', text: '#fff', label: 'Доступен' },
  offline:   { bg: '#94a3b8', text: '#fff', label: 'Не в сети' },
  not_ready: { bg: '#f97316', text: '#fff', label: 'Не готов' },
  lunch:     { bg: '#f59e0b', text: '#fff', label: 'Обед' },
  break:     { bg: '#fbbf24', text: '#fff', label: 'Перерыв' },
  training:  { bg: '#a78bfa', text: '#fff', label: 'Обучение' },
  meeting:   { bg: '#60a5fa', text: '#fff', label: 'Совещание' },
}
function statusColor(status: string) {
  return STATUS_COLORS[status] ?? { bg: '#cbd5e1', text: '#334155', label: status }
}

// ─── Временная линия статусов ────────────────────────────────────────────────
function StatusTimeline({ login, workDate, dbOverrides }: { login: string; workDate: string; dbOverrides?: any }) {
  const { data, isLoading } = useQuery({
    queryKey: ['timeline', login, workDate],
    queryFn: () =>
      api.get('/analytics/operator-timeline', { params: { login, work_date: workDate } })
         .then((r) => r.data.data as TimelineEvent[]),
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) return <div className="px-4 py-3 text-xs text-slate-400 animate-pulse">Загрузка временной линии…</div>
  if (!data?.length) return <div className="px-4 py-3 text-xs text-slate-400">Нет данных о статусах</div>

  // Определяем диапазон дня для отрисовки
  const firstEntered = new Date(data[0].entered)
  const lastEntered = new Date(data[data.length - 1].entered)
  const dayStart = new Date(firstEntered)
  dayStart.setHours(firstEntered.getHours(), 0, 0, 0)
  const dayEnd = new Date(lastEntered)
  dayEnd.setHours(Math.min(lastEntered.getHours() + 2, 23), 59, 59, 999)
  const totalMs = dayEnd.getTime() - dayStart.getTime()

  const legendStatuses = Array.from(new Set(data.map((e) => e.status)))

  return (
    <div className="px-4 py-3 bg-white border-t border-slate-100">
      {/* Временная линия */}
      <div className="relative h-9 rounded-md overflow-hidden flex mb-2" style={{ background: '#f1f5f9' }}>
        {data.map((evt, i) => {
          const start = (new Date(evt.entered).getTime() - dayStart.getTime()) / totalMs * 100
          const dur = Math.max(0.3, (evt.duration_sec * 1000) / totalMs * 100)
          const { bg, label } = statusColor(evt.status)
          return (
            <div
              key={i}
              title={`${label}: ${evt.entered.slice(11, 16)} (${Math.round(evt.duration_sec / 60)} мин)`}
              style={{
                position: 'absolute',
                left: `${start}%`,
                width: `${dur}%`,
                backgroundColor: bg,
                top: 0,
                bottom: 0,
                borderRight: '1px solid rgba(255,255,255,0.3)',
              }}
            />
          )
        })}
      </div>

      {/* Метки времени */}
      <div className="relative h-4 mb-2 text-xs text-slate-400 select-none">
        {data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 8)) === 0).map((evt, i) => {
          const left = (new Date(evt.entered).getTime() - dayStart.getTime()) / totalMs * 100
          return (
            <span key={i} style={{ position: 'absolute', left: `${left}%`, transform: 'translateX(-50%)' }}>
              {evt.entered.slice(11, 16)}
            </span>
          )
        })}
      </div>

      {/* Легенда */}
      <div className="flex flex-wrap gap-3">
        {legendStatuses.map((s) => {
          const { bg, label } = statusColor(s)
          const totalSec = data.filter((e) => e.status === s).reduce((acc, e) => acc + e.duration_sec, 0)
          return (
            <div key={s} className="flex items-center gap-1.5 text-xs text-slate-600">
              <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: bg }} />
              <span>{label}</span>
              <span className="text-slate-400">{Math.round(totalSec / 60)} мин</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

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

type ViewMode = 'past' | 'active' | 'planned'

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
    status: shift?.status ?? 'planned',
    notes: shift?.notes ?? '',
  })
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: (d: any) => shift ? api.put(`/schedules/shifts/${shift.id}`, d) : api.post('/schedules/shifts', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shifts'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail || 'Ошибка'),
  })
  return (
    <form onSubmit={(e) => { e.preventDefault(); mutation.mutate({ ...form, employee_id: +form.employee_id, schedule_id: form.schedule_id || null }) }} className="space-y-4">
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      <div><label className="label">Сотрудник *</label>
        <select className="input" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} required>
          <option value="">— выберите —</option>
          {employees?.map((e: any) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className="label">Дата смены *</label><input type="date" className="input" value={form.shift_date} onChange={(e) => setForm({ ...form, shift_date: e.target.value })} required /></div>
        <div><label className="label">График</label>
          <select className="input" value={form.schedule_id} onChange={(e) => setForm({ ...form, schedule_id: e.target.value })}>
            <option value="">— без шаблона —</option>
            {schedules?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div><label className="label">Начало смены</label><input type="datetime-local" className="input" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
        <div><label className="label">Конец смены</label><input type="datetime-local" className="input" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
      </div>
      <div><label className="label">Статус</label>
        <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          {Object.entries(SHIFT_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
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
            <button onClick={() => exportCSV(filtered)} className="btn-secondary"><Download size={14} /> Excel</button>
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
      <div className="card p-4 mb-4 flex gap-4 items-end">
        <div><label className="label">С</label><input type="date" className="input w-40" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></div>
        <div><label className="label">По</label><input type="date" className="input w-40" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></div>
        <p className="text-sm text-slate-400 pb-1">Всего смен: {data?.length ?? 0}</p>
      </div>

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

      {/* Table */}
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
                              <SortTh label="Паузы (мин)" sortKey="non_normal_sec" current={sessSortKey} dir={sessSortDir} onSort={handleSessSort} className="py-2" />
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
                                    <td className="px-4 py-2 text-slate-500">{s.break_count ?? '—'}</td>
                                  </tr>
                                  {isExpanded && (
                                    <tr key={`${i}-tl`} className="border-b border-slate-100">
                                      <td colSpan={8} className="p-0">
                                        <StatusTimeline login={s.login} workDate={date} />
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

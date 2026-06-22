import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  format, addMonths, startOfMonth, endOfMonth, startOfWeek, addDays, isSameMonth, parseISO,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Save, Trash2, Loader2, CalendarDays } from 'lucide-react'
import api from '@/api/client'
import type { Shift, Schedule } from '@/types'

interface DayEntry { id?: number; start: string; end: string; lunch: string; schedule_id: string }

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const fmt = (d: Date) => format(d, 'yyyy-MM-dd')
const dispDate = (s: string) => { const [y, m, d] = s.split('-'); return `${d}.${m}.${y}` }

function emptyEntry(): DayEntry { return { start: '', end: '', lunch: '', schedule_id: '' } }

// Интерактивное проставление смен сотруднику: слева календарь, справа — поля
// смены для выбранного дня. Сохранение создаёт/обновляет смены в разделе «Смены».
export default function ShiftAssignModal({ employee, readOnly, onClose }: {
  employee: { id: number; full_name: string }
  readOnly?: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState<string>(fmt(new Date()))
  const [days, setDays] = useState<Record<string, DayEntry>>({})
  const [toDelete, setToDelete] = useState<Set<number>>(new Set())
  const [initialized, setInitialized] = useState(false)
  const [saving, setSaving] = useState(false)

  const { data: schedules } = useQuery({
    queryKey: ['schedules'],
    queryFn: () => api.get('/schedules').then((r) => r.data as Schedule[]),
  })

  const rangeFrom = fmt(addMonths(startOfMonth(new Date()), -3))
  const rangeTo = fmt(addMonths(endOfMonth(new Date()), 6))
  const { data: existing } = useQuery({
    queryKey: ['emp-shifts', employee.id],
    queryFn: () => api.get('/schedules/shifts', {
      params: { employee_id: employee.id, date_from: rangeFrom, date_to: rangeTo },
    }).then((r) => r.data as Shift[]),
  })

  useEffect(() => {
    if (existing && !initialized) {
      const map: Record<string, DayEntry> = {}
      for (const sh of existing) {
        map[sh.shift_date] = {
          id: sh.id,
          start: sh.start_time?.slice(11, 16) ?? '',
          end: sh.end_time?.slice(11, 16) ?? '',
          lunch: sh.lunch_minutes != null ? String(sh.lunch_minutes) : '',
          schedule_id: sh.schedule_id != null ? String(sh.schedule_id) : '',
        }
      }
      setDays(map)
      setInitialized(true)
    }
  }, [existing, initialized])

  const cells = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [month])

  const entry = days[selected]
  const filledCount = Object.values(days).filter((e) => e.start && e.end).length

  const patchEntry = (patch: Partial<DayEntry>) =>
    setDays((d) => ({ ...d, [selected]: { ...(d[selected] ?? emptyEntry()), ...patch } }))

  const applySchedule = (schedId: string) => {
    const sched = schedules?.find((s) => String(s.id) === schedId)
    setDays((d) => {
      const cur = d[selected] ?? emptyEntry()
      const next: DayEntry = { ...cur, schedule_id: schedId }
      if (sched?.work_start && sched?.work_end) {
        next.start = sched.work_start
        next.end = sched.work_end
        if (sched.break_duration != null) next.lunch = String(sched.break_duration)
      }
      return { ...d, [selected]: next }
    })
  }

  const removeDay = () => {
    setDays((d) => {
      const e = d[selected]
      if (e?.id) setToDelete((s) => new Set(s).add(e.id!))
      const n = { ...d }; delete n[selected]; return n
    })
  }

  const save = async () => {
    setSaving(true)
    try {
      for (const id of toDelete) await api.delete(`/schedules/shifts/${id}`)
      for (const [date, e] of Object.entries(days)) {
        if (!e.start || !e.end) continue
        const endDate = e.end <= e.start ? fmt(addDays(parseISO(date), 1)) : date
        const body: any = {
          start_time: `${date}T${e.start}`,
          end_time: `${endDate}T${e.end}`,
          lunch_minutes: e.lunch === '' ? null : +e.lunch,
          schedule_id: e.schedule_id || null,
          status: 'planned',
        }
        if (e.id) await api.put(`/schedules/shifts/${e.id}`, { ...body, shift_date: date })
        else await api.post('/schedules/shifts', { ...body, employee_id: employee.id, shift_date: date })
      }
      qc.invalidateQueries({ queryKey: ['shifts'] })
      qc.invalidateQueries({ queryKey: ['emp-shifts', employee.id] })
      onClose()
    } finally { setSaving(false) }
  }

  return (
    <div>
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Календарь */}
        <div className="lg:w-[320px] flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={() => setMonth((m) => addMonths(m, -1))}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><ChevronLeft size={16} /></button>
            <span className="text-sm font-semibold text-slate-800">{MONTHS[month.getMonth()]} {month.getFullYear()}</span>
            <button type="button" onClick={() => setMonth((m) => addMonths(m, 1))}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((w) => <div key={w} className="text-center text-[11px] font-medium text-slate-400">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((c) => {
              const ds = fmt(c)
              const inMonth = isSameMonth(c, month)
              const e = days[ds]
              const hasShift = !!(e && e.start && e.end)
              const isSel = ds === selected
              return (
                <button
                  key={ds}
                  type="button"
                  onClick={() => setSelected(ds)}
                  className={`relative h-10 rounded-lg text-sm transition-colors flex items-center justify-center
                    ${isSel ? 'bg-brand-600 text-white font-semibold'
                      : inMonth ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-300 hover:bg-slate-50'}`}
                >
                  {c.getDate()}
                  {hasShift && (
                    <span className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${isSel ? 'bg-white' : 'bg-emerald-500'}`} />
                  )}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-slate-400 mt-3">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5 align-middle" />
            Дни со сменой · заполнено: {filledCount}
          </p>
        </div>

        {/* Форма дня */}
        <div className="flex-1 min-w-0 border-l border-slate-100 lg:pl-6">
          <div className="flex items-center gap-2 mb-4">
            <CalendarDays size={16} className="text-brand-500" />
            <h3 className="text-sm font-semibold text-slate-800">{dispDate(selected)}</h3>
            {entry?.start && entry?.end && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">смена назначена</span>
            )}
          </div>

          {readOnly ? (
            entry?.start && entry?.end ? (
              <div className="space-y-2 text-sm">
                <div className="flex gap-2"><span className="text-slate-400 w-24">Время:</span><span className="text-slate-800 font-medium">{entry.start}–{entry.end}</span></div>
                <div className="flex gap-2"><span className="text-slate-400 w-24">Обед:</span><span className="text-slate-800">{entry.lunch ? `${entry.lunch} мин` : 'без обеда'}</span></div>
                {entry.schedule_id && (
                  <div className="flex gap-2"><span className="text-slate-400 w-24">График:</span>
                    <span className="text-slate-800">{schedules?.find((s) => String(s.id) === entry.schedule_id)?.name ?? '—'}</span></div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-400">На этот день смена не назначена.</p>
            )
          ) : (
            <div className="space-y-4">
              <div>
                <label className="label">График <span className="text-slate-400 font-normal">(подставит время)</span></label>
                <select className="input" value={entry?.schedule_id ?? ''} onChange={(e) => applySchedule(e.target.value)}>
                  <option value="">— вручную —</option>
                  {schedules?.map((s) => <option key={s.id} value={s.id}>{s.name}{s.work_start ? ` · ${s.work_start}–${s.work_end}` : ''}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Начало</label>
                  <input type="time" className="input" value={entry?.start ?? ''} onChange={(e) => patchEntry({ start: e.target.value })} /></div>
                <div><label className="label">Конец</label>
                  <input type="time" className="input" value={entry?.end ?? ''} onChange={(e) => patchEntry({ end: e.target.value })} /></div>
              </div>
              <div>
                <label className="label">Обед (мин) <span className="text-slate-400 font-normal">— пусто = без обеда</span></label>
                <input type="number" min={0} max={180} step={5} className="input w-40" placeholder="0"
                  value={entry?.lunch ?? ''} onChange={(e) => patchEntry({ lunch: e.target.value })} />
              </div>
              {entry?.start && entry?.end && entry.end <= entry.start && (
                <p className="text-xs text-amber-600">Конец раньше начала — смена считается ночной (заканчивается на следующий день).</p>
              )}
              {entry && (
                <button type="button" onClick={removeDay} className="inline-flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700">
                  <Trash2 size={13} /> Убрать смену на этот день
                </button>
              )}
              <p className="text-xs text-slate-400 pt-1">
                Выберите день в календаре слева, заполните время — и так по каждому дню. Затем «Сохранить».
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-5 mt-5 border-t border-slate-100">
        <button type="button" onClick={onClose} className="btn-secondary">{readOnly ? 'Закрыть' : 'Отмена'}</button>
        {!readOnly && (
          <button type="button" onClick={save} disabled={saving} className="btn-primary">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Сохранить ({filledCount})
          </button>
        )}
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  format, addMonths, startOfMonth, endOfMonth, startOfWeek, addDays, isSameMonth, parseISO,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Save, Trash2, Loader2, CalendarDays, Users, Pencil, Search, Check, Plus } from 'lucide-react'
import api from '@/api/client'
import type { Shift, Schedule } from '@/types'
import TimeSelect from '@/components/common/TimeSelect'
import QueueMultiSelect from '@/components/common/QueueMultiSelect'

type LineId = 'in' | 'out'
interface DayEntry { start: string; end: string; lunch: string; schedule_id: string; queues: string[]; line: LineId[] }
interface EmpRef { id: number; full_name: string }

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const LINE_LABEL: Record<LineId, string> = { in: 'Вход', out: 'Исход' }
const fmt = (d: Date) => format(d, 'yyyy-MM-dd')
const dispDate = (s: string) => { const [y, m, d] = s.split('-'); return `${d}.${m}.${y}` }

function emptyEntry(): DayEntry { return { start: '', end: '', lunch: '', schedule_id: '', queues: [], line: [] } }
function parseLine(v?: string | null): LineId[] {
  if (!v) return []
  return String(v).split(',').map((x) => x.trim()).filter((x): x is LineId => x === 'in' || x === 'out')
}
function shiftToEntry(sh: Shift): DayEntry {
  return {
    start: sh.start_time?.slice(11, 16) ?? '',
    end: (sh.end_time && sh.end_time.slice(11, 16) === '00:00' && sh.end_time.slice(0, 10) > sh.shift_date) ? '24:00' : (sh.end_time?.slice(11, 16) ?? ''),
    lunch: sh.lunch_minutes != null ? String(sh.lunch_minutes) : '',
    schedule_id: sh.schedule_id != null ? String(sh.schedule_id) : '',
    queues: (sh as any).queue_names ? String((sh as any).queue_names).split(',').map((x: string) => x.trim()).filter(Boolean) : [],
    line: parseLine((sh as any).line),
  }
}

// Проставление смен: сверху выбор сотрудников (можно нескольких — одинаковые
// смены назначатся всем), слева календарь, справа — СПИСОК смен дня (гибкий
// график: можно несколько смен в один день).
export default function ShiftAssignModal({ employee, initialEmpIds, employees, projectUuid, readOnly, initialDate, onClose, onEdit }: {
  employee?: EmpRef | null
  initialEmpIds?: number[]
  employees?: EmpRef[]
  projectUuid?: string
  readOnly?: boolean
  initialDate?: string
  onClose: () => void
  onEdit?: () => void
}) {
  const qc = useQueryClient()
  const [primaryEmpId] = useState<number | null>(() => {
    if (readOnly) return employee?.id ?? null
    if (initialEmpIds && initialEmpIds.length) return initialEmpIds.length === 1 ? initialEmpIds[0] : null
    return employee?.id ?? null
  })
  const [empIds, setEmpIds] = useState<Set<number>>(() => {
    if (readOnly) return new Set(employee ? [employee.id] : [])
    if (initialEmpIds && initialEmpIds.length) return new Set(initialEmpIds)
    return new Set(employee ? [employee.id] : [])
  })
  const [empSearch, setEmpSearch] = useState('')
  const [month, setMonth] = useState(() => startOfMonth(initialDate ? parseISO(initialDate) : new Date()))
  const [selected, setSelected] = useState<string>(initialDate || fmt(new Date()))
  // Список смен на каждый день (несколько смен в день — гибкий график).
  const [days, setDays] = useState<Record<string, DayEntry[]>>({})
  // Какие даты пользователь изменил — только их перезаписываем при сохранении
  // (чтобы при добавлении сотрудников не затереть их смены на нетронутых днях).
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [initialized, setInitialized] = useState(false)
  const [saving, setSaving] = useState(false)

  const { data: schedules } = useQuery({
    queryKey: ['schedules'],
    queryFn: () => api.get('/schedules').then((r) => r.data as Schedule[]),
  })

  const { data: fetchedEmps } = useQuery({
    queryKey: ['employees', projectUuid],
    queryFn: () => api.get('/employees', { params: { project_uuid: projectUuid, limit: 1000 } }).then((r) => r.data as EmpRef[]),
    enabled: !readOnly && !employees && !!projectUuid,
  })
  const empList: EmpRef[] = (employees && employees.length ? employees : fetchedEmps) || (employee ? [employee] : [])

  const { data: inboundQ } = useQuery({
    queryKey: ['queues', projectUuid],
    queryFn: () => api.get('/analytics/queues', { params: { partner_uuid: projectUuid } }).then((r) => r.data.data as any[]),
    enabled: !readOnly && !!projectUuid,
  })
  const { data: outboundP } = useQuery({
    queryKey: ['outbound-projects', projectUuid],
    queryFn: () => api.get('/analytics/outbound-projects', { params: { partner_uuid: projectUuid } }).then((r) => r.data.data as any[]),
    enabled: !readOnly && !!projectUuid,
  })
  const nameToLines = useMemo(() => {
    const m = new Map<string, Set<LineId>>()
    const add = (name: string, sIn: boolean, sOut: boolean) => {
      if (!name) return
      const s = m.get(name) ?? new Set<LineId>()
      if (sIn) s.add('in')
      if (sOut) s.add('out')
      m.set(name, s)
    }
    for (const q of (inboundQ || [])) { if (q.hidden) continue; add(q.name, q.show_in ?? true, q.show_out ?? false) }
    for (const p of (outboundP || [])) { if (p.hidden) continue; add(p.name, p.show_in ?? false, p.show_out ?? true) }
    const obj: Record<string, LineId[]> = {}
    for (const [name, s] of m) obj[name] = [...s]
    return obj
  }, [inboundQ, outboundP])
  const qNames = useMemo(() => Object.keys(nameToLines).sort(), [nameToLines])
  const allowedByLine = (name: string, line: LineId[]) => {
    if (line.length === 0) return true
    const ls = nameToLines[name] || []
    if (ls.length === 0) return true
    return line.some((l) => ls.includes(l))
  }
  const visibleQueuesFor = (line: LineId[]) => qNames.filter((name) => allowedByLine(name, line))

  const rangeFrom = fmt(addMonths(startOfMonth(new Date()), -3))
  const rangeTo = fmt(addMonths(endOfMonth(new Date()), 6))
  const { data: rangeShifts } = useQuery({
    queryKey: ['assign-range-shifts', projectUuid, rangeFrom, rangeTo, primaryEmpId, readOnly],
    queryFn: () => api.get('/schedules/shifts', {
      params: readOnly && primaryEmpId != null
        ? { employee_id: primaryEmpId, date_from: rangeFrom, date_to: rangeTo }
        : { project_uuid: projectUuid, date_from: rangeFrom, date_to: rangeTo },
    }).then((r) => r.data as Shift[]),
    enabled: (readOnly && primaryEmpId != null) || (!readOnly && !!projectUuid),
  })
  // существующие смены по (сотрудник, дата) — все (для удаления при перезаписи).
  const existingByEmpDate = useMemo(() => {
    const m = new Map<number, Map<string, Shift[]>>()
    for (const s of (rangeShifts || [])) {
      if (!m.has(s.employee_id)) m.set(s.employee_id, new Map())
      const dm = m.get(s.employee_id)!
      if (!dm.has(s.shift_date)) dm.set(s.shift_date, [])
      dm.get(s.shift_date)!.push(s)
    }
    return m
  }, [rangeShifts])

  // Загрузка шаблона из первичного сотрудника (один раз) — список смен по дням.
  useEffect(() => {
    if (rangeShifts && !initialized) {
      const map: Record<string, DayEntry[]> = {}
      if (primaryEmpId != null) {
        for (const sh of rangeShifts.filter((s) => s.employee_id === primaryEmpId)) {
          (map[sh.shift_date] = map[sh.shift_date] || []).push(shiftToEntry(sh))
        }
      }
      setDays(map)
      setInitialized(true)
    }
  }, [rangeShifts, initialized, primaryEmpId])

  const cells = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [month])

  const entries = days[selected] || []
  const filledCount = Object.values(days).reduce((n, list) => n + list.filter((e) => e.start && e.end).length, 0)
  const markDirty = (date: string) => setDirty((s) => s.has(date) ? s : new Set(s).add(date))

  const setEntry = (i: number, patch: Partial<DayEntry>) => {
    setDays((d) => {
      const list = [...(d[selected] || [])]
      list[i] = { ...(list[i] || emptyEntry()), ...patch }
      return { ...d, [selected]: list }
    })
    markDirty(selected)
  }
  const addEntry = () => { setDays((d) => ({ ...d, [selected]: [...(d[selected] || []), emptyEntry()] })); markDirty(selected) }
  const removeEntry = (i: number) => { setDays((d) => ({ ...d, [selected]: (d[selected] || []).filter((_, idx) => idx !== i) })); markDirty(selected) }

  // Конец раньше начала → ночная смена: текущая запись до 24:00 + новая запись на
  // следующий день 00:00..end.
  const onEndChange = (i: number, v: string) => {
    setDays((d) => {
      const list = [...(d[selected] || [])]
      const cur = list[i] || emptyEntry()
      if (v && v !== '24:00' && cur.start && v <= cur.start) {
        list[i] = { ...cur, end: '24:00' }
        const next = fmt(addDays(parseISO(selected), 1))
        const nextList = [...(d[next] || []), { ...emptyEntry(), start: '00:00', end: v, queues: cur.queues, line: cur.line }]
        markDirty(next)
        return { ...d, [selected]: list, [next]: nextList }
      }
      list[i] = { ...cur, end: v }
      return { ...d, [selected]: list }
    })
    markDirty(selected)
  }

  const applySchedule = (i: number, schedId: string) => {
    const sched = schedules?.find((s) => String(s.id) === schedId)
    const patch: Partial<DayEntry> = { schedule_id: schedId }
    if (sched?.work_start && sched?.work_end) {
      patch.start = sched.work_start
      patch.end = sched.work_end
      if (sched.break_duration != null) patch.lunch = String(sched.break_duration)
    }
    setEntry(i, patch)
  }

  const onQueuesChange = (i: number, next: string[]) => {
    const cur = entries[i] || emptyEntry()
    let line = cur.line
    if (line.length === 0 && next.length) {
      const ls = new Set<LineId>()
      for (const n of next) for (const l of (nameToLines[n] || [])) ls.add(l)
      line = [...ls]
    }
    setEntry(i, { queues: next, line })
  }
  const toggleLine = (i: number, l: LineId) => {
    const cur = entries[i] || emptyEntry()
    const has = cur.line.includes(l)
    const line = has ? cur.line.filter((x) => x !== l) : [...cur.line, l]
    const queues = cur.queues.filter((n) => allowedByLine(n, line))
    setEntry(i, { line, queues })
  }

  const toggleEmp = (id: number) => setEmpIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const shownEmps = empSearch.trim()
    ? empList.filter((e) => (e.full_name || '').toLowerCase().includes(empSearch.trim().toLowerCase()))
    : empList

  const entryBody = (date: string, e: DayEntry) => {
    let endTime = e.end, endDate = date
    if (e.end === '24:00') { endTime = '00:00'; endDate = fmt(addDays(parseISO(date), 1)) }
    else if (e.end <= e.start) { endDate = fmt(addDays(parseISO(date), 1)) }
    return {
      start_time: `${date}T${e.start}`,
      end_time: `${endDate}T${endTime}`,
      lunch_minutes: e.lunch === '' ? null : +e.lunch,
      schedule_id: e.schedule_id || null,
      queue_names: e.queues.length ? e.queues.join(', ') : null,
      line: e.line.length ? e.line.join(',') : null,
      status: 'planned',
    }
  }

  const save = async () => {
    if (empIds.size === 0) return
    setSaving(true)
    try {
      const ids = [...empIds]
      // Перезаписываем только изменённые даты: у каждого выбранного сотрудника
      // удаляем его смены этой даты и создаём смены из шаблона.
      for (const date of dirty) {
        const filled = (days[date] || []).filter((e) => e.start && e.end)
        for (const eid of ids) {
          for (const sh of (existingByEmpDate.get(eid)?.get(date) || [])) {
            await api.delete(`/schedules/shifts/${sh.id}`)
          }
          for (const e of filled) {
            await api.post('/schedules/shifts', { ...entryBody(date, e), employee_id: eid, shift_date: date })
          }
        }
      }
      qc.invalidateQueries({ queryKey: ['shifts'] })
      qc.invalidateQueries({ queryKey: ['emp-shifts'] })
      qc.invalidateQueries({ queryKey: ['assign-shifts'] })
      qc.invalidateQueries({ queryKey: ['assign-period-shifts'] })
      qc.invalidateQueries({ queryKey: ['assign-range-shifts'] })
      qc.invalidateQueries({ queryKey: ['today-shifts'] })
      onClose()
    } finally { setSaving(false) }
  }

  return (
    <div>
      {!readOnly && (
        <div className="mb-5">
          <label className="label flex items-center gap-1.5"><Users size={13} className="text-brand-500" /> Кому ставим смены ({empIds.size})</label>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} placeholder="Поиск сотрудника…" className="input pl-8 py-1.5 text-sm" />
          </div>
          <div className="max-h-44 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-50">
            {shownEmps.length === 0 ? <p className="text-xs text-slate-400 px-3 py-2">Никого не найдено</p> :
              shownEmps.map((e) => {
                const on = empIds.has(e.id)
                return (
                  <button key={e.id} type="button" onClick={() => toggleEmp(e.id)}
                    className={`flex items-center gap-2.5 w-full text-left px-3 py-1.5 transition-colors ${on ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                    <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border-2 ${on ? 'bg-brand-500 border-brand-500' : 'border-slate-300 bg-white'}`}>
                      {on && <Check size={10} className="text-white" strokeWidth={3} />}
                    </span>
                    <span className="text-sm text-slate-700 truncate">{e.full_name}</span>
                  </button>
                )
              })}
          </div>
          {empIds.size > 1 && <p className="text-xs text-amber-600 mt-1.5">Одинаковые смены будут назначены всем {empIds.size} выбранным сотрудникам.</p>}
        </div>
      )}

      {empIds.size === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">Отметьте сотрудников выше, чтобы поставить смены.</p>
      ) : (
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Календарь */}
        <div className="lg:w-[300px] flex-shrink-0">
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
              const cnt = (days[ds] || []).filter((e) => e.start && e.end).length
              const isSel = ds === selected
              return (
                <button key={ds} type="button" onClick={() => setSelected(ds)}
                  className={`relative h-10 rounded-lg text-sm transition-colors flex items-center justify-center
                    ${isSel ? 'bg-brand-600 text-white font-semibold'
                      : inMonth ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-300 hover:bg-slate-50'}`}>
                  {c.getDate()}
                  {cnt > 0 && <span className={`absolute bottom-1 text-[8px] font-bold leading-none ${isSel ? 'text-white' : 'text-emerald-500'}`}>{cnt > 1 ? `●${cnt}` : '●'}</span>}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-slate-400 mt-3">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1.5 align-middle" />
            Дни со сменой · смен всего: {filledCount}
          </p>
        </div>

        {/* Смены выбранного дня */}
        <div className="flex-1 min-w-0 border-l border-slate-100 lg:pl-6">
          <div className="flex items-center gap-2 mb-4">
            <CalendarDays size={16} className="text-brand-500" />
            <h3 className="text-sm font-semibold text-slate-800">{dispDate(selected)}</h3>
            {entries.filter((e) => e.start && e.end).length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">смен: {entries.filter((e) => e.start && e.end).length}</span>
            )}
          </div>

          {readOnly ? (
            entries.filter((e) => e.start && e.end).length ? (
              <div className="space-y-3">
                {entries.filter((e) => e.start && e.end).map((e, i) => (
                  <div key={i} className="text-sm space-y-1 border border-slate-100 rounded-lg p-3">
                    <div className="flex gap-2"><span className="text-slate-400 w-20">Время:</span><span className="text-slate-800 font-medium">{e.start}–{e.end}</span></div>
                    <div className="flex gap-2"><span className="text-slate-400 w-20">Обед:</span><span className="text-slate-800">{e.lunch ? `${e.lunch} мин` : 'без обеда'}</span></div>
                    <div className="flex gap-2"><span className="text-slate-400 w-20">Линия:</span><span className="text-slate-800">{e.line.length ? e.line.map((l) => LINE_LABEL[l]).join(', ') : '—'}</span></div>
                    <div className="flex gap-2"><span className="text-slate-400 w-20">Очередь:</span><span className="text-slate-800">{e.queues.length ? e.queues.join(', ') : '—'}</span></div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-slate-400">На этот день смена не назначена.</p>
          ) : (
            <div className="space-y-4">
              {entries.length === 0 && <p className="text-sm text-slate-400">Смен нет. Добавьте смену на этот день.</p>}
              {entries.map((e, i) => (
                <div key={i} className="relative border border-slate-200 rounded-xl p-3 space-y-3">
                  {entries.length > 1 && <span className="absolute -top-2 left-3 bg-white px-1.5 text-[11px] font-semibold text-slate-400">Смена {i + 1}</span>}
                  <button type="button" onClick={() => removeEntry(i)} className="absolute top-2 right-2 p-1 text-slate-300 hover:text-red-500" title="Убрать эту смену"><Trash2 size={13} /></button>
                  <div>
                    <label className="label">График <span className="text-slate-400 font-normal">(подставит время)</span></label>
                    <select className="input" value={e.schedule_id} onChange={(ev) => applySchedule(i, ev.target.value)}>
                      <option value="">— вручную —</option>
                      {schedules?.map((s) => <option key={s.id} value={s.id}>{s.name}{s.work_start ? ` · ${s.work_start}–${s.work_end}` : ''}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="label">Начало</label><TimeSelect value={e.start} onChange={(v) => setEntry(i, { start: v })} /></div>
                    <div><label className="label">Конец <span className="text-slate-400 font-normal">(24:00 = полночь)</span></label><TimeSelect value={e.end} onChange={(v) => onEndChange(i, v)} /></div>
                  </div>
                  <div className="flex items-end gap-4 flex-wrap">
                    <div>
                      <label className="label">Обед (мин)</label>
                      <input type="number" min={0} max={180} step={5} className="input w-28" placeholder="0" value={e.lunch} onChange={(ev) => setEntry(i, { lunch: ev.target.value })} />
                    </div>
                    <div>
                      <label className="label">Линия</label>
                      <div className="flex items-center gap-3 h-[42px]">
                        {(['in', 'out'] as LineId[]).map((l) => (
                          <label key={l} className="flex items-center gap-1.5 text-sm cursor-pointer">
                            <input type="checkbox" checked={e.line.includes(l)} onChange={() => toggleLine(i, l)} /> {LINE_LABEL[l]}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  {qNames.length > 0 && (
                    <div>
                      <label className="label">Очередь <span className="text-slate-400 font-normal">(необязательно)</span></label>
                      <QueueMultiSelect options={visibleQueuesFor(e.line)} value={e.queues} onChange={(v) => onQueuesChange(i, v)} />
                    </div>
                  )}
                </div>
              ))}
              <button type="button" onClick={addEntry} className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-700 font-medium">
                <Plus size={14} /> Добавить смену в этот день
              </button>
              <p className="text-xs text-slate-400">
                Можно несколько смен в один день (гибкий график). Линия/очередь необязательны — оператор может быть «в резерве».
              </p>
            </div>
          )}
        </div>
      </div>
      )}

      <div className="flex justify-end gap-2 pt-5 mt-5 border-t border-slate-100">
        <button type="button" onClick={onClose} className="btn-secondary">{readOnly ? 'Закрыть' : 'Отмена'}</button>
        {readOnly && onEdit && (
          <button type="button" onClick={onEdit} className="btn-primary"><Pencil size={14} /> Редактировать</button>
        )}
        {!readOnly && (
          <button type="button" onClick={save} disabled={saving || empIds.size === 0} className="btn-primary">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Сохранить ({filledCount})
          </button>
        )}
      </div>
    </div>
  )
}

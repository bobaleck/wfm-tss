import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Calendar, Save } from 'lucide-react'
import api from '@/api/client'
import type { Schedule } from '@/types'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import Modal from '@/components/ui/Modal'
import EmptyState from '@/components/common/EmptyState'

const DAYS = [
  { key: '1', label: 'Пн' }, { key: '2', label: 'Вт' }, { key: '3', label: 'Ср' },
  { key: '4', label: 'Чт' }, { key: '5', label: 'Пт' }, { key: '6', label: 'Сб' },
  { key: '7', label: 'Вс' },
]

function DaysBadges({ days }: { days: string }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {DAYS.map((d) => (
        <span key={d.key} className={`text-xs px-1.5 py-0.5 rounded font-medium
          ${days.includes(d.key) ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-300'}`}>
          {d.label}
        </span>
      ))}
    </div>
  )
}

function ScheduleForm({ schedule, onClose }: { schedule?: Schedule | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: schedule?.name ?? '',
    work_start: schedule?.work_start ?? '09:00',
    work_end: schedule?.work_end ?? '18:00',
    break_duration: schedule?.break_duration ?? 60,
    days_of_week: schedule?.days_of_week ?? '12345',
    is_floating: schedule?.is_floating ?? false,
    floating_days: schedule?.floating_days ?? 2,
    lunch_start: schedule?.lunch_start ?? '',
    lunch_end: schedule?.lunch_end ?? '',
    description: schedule?.description ?? '',
  })
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: (d: any) => schedule ? api.put(`/schedules/${schedule.id}`, d) : api.post('/schedules', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['schedules'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail || 'Ошибка'),
  })

  const toggleDay = (d: string) => {
    const curr = form.days_of_week
    setForm({ ...form, days_of_week: curr.includes(d) ? curr.replace(d, '') : (curr + d).split('').sort().join('') })
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); mutation.mutate({ ...form, floating_days: form.is_floating ? form.floating_days : null }) }} className="space-y-4">
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      <div><label className="label">Название *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="напр. 2/2 день" /></div>

      {/* Тип графика */}
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <input type="checkbox" checked={form.is_floating} onChange={(e) => setForm({ ...form, is_floating: e.target.checked })} />
        <span className="text-sm font-medium text-slate-700">Плавающий график</span>
        <span className="text-xs text-slate-400">(2/2, 3/3, 7/7 — дни недели не фиксированы)</span>
      </label>

      {form.is_floating ? (
        <div>
          <label className="label">Количество рабочих дней подряд</label>
          <input type="number" min={1} max={31} className="input w-32" value={form.floating_days}
            onChange={(e) => setForm({ ...form, floating_days: +e.target.value })} />
          <p className="text-xs text-slate-400 mt-1">Напр. 2 — для графика 2/2, 7 — для 7/7. Дни недели для таких графиков не задаются.</p>
        </div>
      ) : (
        <div>
          <label className="label">Рабочие дни</label>
          <div className="flex gap-2 mt-1">
            {DAYS.map((d) => (
              <button type="button" key={d.key} onClick={() => toggleDay(d.key)}
                className={`w-10 h-8 rounded text-xs font-medium transition-colors
                  ${form.days_of_week.includes(d.key) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <div><label className="label">Начало</label><input type="time" className="input" value={form.work_start} onChange={(e) => setForm({ ...form, work_start: e.target.value })} /></div>
        <div><label className="label">Конец</label><input type="time" className="input" value={form.work_end} onChange={(e) => setForm({ ...form, work_end: e.target.value })} /></div>
        <div><label className="label">Перерыв (мин)</label><input type="number" className="input" min={0} max={120} value={form.break_duration} onChange={(e) => setForm({ ...form, break_duration: +e.target.value })} /></div>
      </div>

      {/* Обед */}
      <div className="grid grid-cols-2 gap-4">
        <div><label className="label">Обед с <span className="text-slate-400 font-normal">(необязательно)</span></label>
          <input type="time" className="input" value={form.lunch_start} onChange={(e) => setForm({ ...form, lunch_start: e.target.value })} /></div>
        <div><label className="label">Обед до</label>
          <input type="time" className="input" value={form.lunch_end} onChange={(e) => setForm({ ...form, lunch_end: e.target.value })} /></div>
      </div>

      <div><label className="label">Описание</label><textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Отмена</button>
        <button type="submit" className="btn-primary" disabled={mutation.isPending}><Save size={14} /> Сохранить</button>
      </div>
    </form>
  )
}

export default function SchedulesPage() {
  const [showForm, setShowForm] = useState(false)
  const [editSchedule, setEditSchedule] = useState<Schedule | null>(null)
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['schedules'], queryFn: () => api.get('/schedules').then((r) => r.data as Schedule[]) })
  const deleteMutation = useMutation({ mutationFn: (id: number) => api.delete(`/schedules/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['schedules'] }) })

  return (
    <div>
      <PageHeader title="Графики работы" subtitle="Шаблоны рабочих графиков для назначения смен"
        actions={<button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> Добавить</button>} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? <PageSpinner /> : !data?.length ? (
          <div className="col-span-3"><EmptyState title="Нет графиков" icon={<Calendar size={40} />}
            action={<button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> Добавить</button>} /></div>
        ) : data.map((s) => (
          <div key={s.id} className="card p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center"><Calendar size={18} className="text-blue-600" /></div>
              <div className="flex gap-1">
                <button onClick={() => setEditSchedule(s)} className="p-1.5 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600"><Pencil size={14} /></button>
                <button onClick={() => confirm(`Удалить "${s.name}"?`) && deleteMutation.mutate(s.id)} className="p-1.5 hover:bg-red-50 rounded text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            </div>
            <h3 className="font-semibold text-slate-900">{s.name}</h3>
            <p className="text-sm text-slate-500 mt-1">
              {s.work_start} – {s.work_end} · перерыв {s.break_duration} мин
              {s.lunch_start && s.lunch_end ? ` · обед ${s.lunch_start}–${s.lunch_end}` : ''}
            </p>
            <div className="mt-3">
              {s.is_floating ? (
                <span className="text-xs px-2 py-1 rounded-md bg-amber-100 text-amber-700 font-medium">
                  Плавающий · {s.floating_days ?? '?'} раб. дн. подряд
                </span>
              ) : (
                <DaysBadges days={s.days_of_week} />
              )}
            </div>
            {s.description && <p className="text-xs text-slate-400 mt-2">{s.description}</p>}
          </div>
        ))}
      </div>
      {showForm && <Modal open title="Новый график" onClose={() => setShowForm(false)}><ScheduleForm onClose={() => setShowForm(false)} /></Modal>}
      {editSchedule && <Modal open title="Редактировать график" onClose={() => setEditSchedule(null)}><ScheduleForm schedule={editSchedule} onClose={() => setEditSchedule(null)} /></Modal>}
    </div>
  )
}

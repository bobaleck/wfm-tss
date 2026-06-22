import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, CalendarOff, Check, X, Save } from 'lucide-react'
import api from '@/api/client'
import type { Absence } from '@/types'
import { ABSENCE_TYPES } from '@/types'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/common/EmptyState'
import DatePicker from '@/components/common/DatePicker'
import { format, subDays } from 'date-fns'

function AbsenceForm({ absence, onClose }: { absence?: Absence | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: employees } = useQuery({ queryKey: ['employees'], queryFn: () => api.get('/employees').then((r) => r.data as any[]) })
  const [form, setForm] = useState({
    employee_id: absence?.employee_id ?? '' as any,
    absence_type: absence?.absence_type ?? 'vacation',
    start_date: absence?.start_date ?? format(new Date(), 'yyyy-MM-dd'),
    end_date: absence?.end_date ?? format(new Date(), 'yyyy-MM-dd'),
    approved: absence?.approved ?? false,
    notes: absence?.notes ?? '',
  })
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: (d: any) => absence ? api.put(`/schedules/absences/${absence.id}`, d) : api.post('/schedules/absences', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['absences'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail || 'Ошибка'),
  })
  return (
    <form onSubmit={(e) => { e.preventDefault(); mutation.mutate({ ...form, employee_id: +form.employee_id }) }} className="space-y-4">
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      <div><label className="label">Сотрудник *</label>
        <select className="input" value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} required>
          <option value="">— выберите —</option>
          {employees?.map((e: any) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
      </div>
      <div><label className="label">Тип</label>
        <select className="input" value={form.absence_type} onChange={(e) => setForm({ ...form, absence_type: e.target.value })}>
          {Object.entries(ABSENCE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><label className="label">С</label><DatePicker value={form.start_date} onChange={(v) => setForm({ ...form, start_date: v })} /></div>
        <div><label className="label">По</label><DatePicker value={form.end_date} onChange={(v) => setForm({ ...form, end_date: v })} /></div>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="approved" checked={form.approved} onChange={(e) => setForm({ ...form, approved: e.target.checked })} />
        <label htmlFor="approved" className="text-sm text-slate-700">Согласовано</label>
      </div>
      <div><label className="label">Примечание</label><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Отмена</button>
        <button type="submit" className="btn-primary" disabled={mutation.isPending}><Save size={14} /> Сохранить</button>
      </div>
    </form>
  )
}

export default function AbsencesPage() {
  const [showForm, setShowForm] = useState(false)
  const [editAbsence, setEditAbsence] = useState<Absence | null>(null)
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['absences', dateFrom, dateTo],
    queryFn: () => api.get('/schedules/absences', { params: { date_from: dateFrom, date_to: dateTo } }).then((r) => r.data as Absence[]),
  })
  const deleteMutation = useMutation({ mutationFn: (id: number) => api.delete(`/schedules/absences/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['absences'] }) })

  return (
    <div>
      <PageHeader title="Отсутствия" subtitle="Отпуска, больничные и прочие отсутствия"
        actions={<button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> Добавить</button>} />
      <div className="card p-4 mb-4 flex gap-4">
        <div><label className="label">С</label><DatePicker value={dateFrom} onChange={setDateFrom} className="w-40" /></div>
        <div><label className="label">По</label><DatePicker value={dateTo} onChange={setDateTo} className="w-40" /></div>
      </div>
      <div className="card overflow-hidden">
        {isLoading ? <PageSpinner /> : !data?.length ? (
          <EmptyState title="Нет отсутствий" icon={<CalendarOff size={40} />} action={<button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> Добавить</button>} />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-100">
              {['Сотрудник', 'Тип', 'Дата начала', 'Дата окончания', 'Статус', 'Примечание', ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr></thead>
            <tbody>{data.map((ab) => (
              <tr key={ab.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">{ab.employee_name || `#${ab.employee_id}`}</td>
                <td className="px-4 py-3"><Badge label={ABSENCE_TYPES[ab.absence_type] || ab.absence_type} color="purple" /></td>
                <td className="px-4 py-3 text-slate-600">{ab.start_date}</td>
                <td className="px-4 py-3 text-slate-600">{ab.end_date}</td>
                <td className="px-4 py-3">{ab.approved ? <Badge label="Согласовано" color="green" /> : <Badge label="На согласовании" color="yellow" />}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{ab.notes || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => setEditAbsence(ab)} className="p-1.5 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600"><Pencil size={12} /></button>
                    <button onClick={() => confirm('Удалить?') && deleteMutation.mutate(ab.id)} className="p-1.5 hover:bg-red-50 rounded text-slate-400 hover:text-red-600"><Trash2 size={12} /></button>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {showForm && <Modal open title="Новое отсутствие" onClose={() => setShowForm(false)}><AbsenceForm onClose={() => setShowForm(false)} /></Modal>}
      {editAbsence && <Modal open title="Редактировать отсутствие" onClose={() => setEditAbsence(null)}><AbsenceForm absence={editAbsence} onClose={() => setEditAbsence(null)} /></Modal>}
    </div>
  )
}

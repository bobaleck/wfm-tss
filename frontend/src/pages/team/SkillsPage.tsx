import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Star, Save, Sparkles, UserCheck, X } from 'lucide-react'
import api from '@/api/client'
import type { Skill, Employee } from '@/types'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import Modal from '@/components/ui/Modal'
import EmptyState from '@/components/common/EmptyState'

function SkillForm({ skill, onClose }: { skill?: Skill | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: skill?.name ?? '', code: skill?.code ?? '', description: skill?.description ?? '' })
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: (d: any) => skill ? api.put(`/skills/${skill.id}`, d) : api.post('/skills', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['skills'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail || 'Ошибка'),
  })
  return (
    <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(form) }} className="space-y-4">
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      <div><label className="label">Название навыка *</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
      <div><label className="label">Код</label><input className="input" value={form.code} placeholder="например: CHAT" onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
      <div><label className="label">Описание</label><textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Отмена</button>
        <button type="submit" className="btn-primary" disabled={mutation.isPending}><Save size={14} /> Сохранить</button>
      </div>
    </form>
  )
}

// ─── Модальное окно управления сотрудниками навыка ───────────────────────────
function SkillMembersModal({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const qc = useQueryClient()
  const [addId, setAddId] = useState<number | ''>('')

  const { data: allEmployees, isLoading } = useQuery({
    queryKey: ['employees-all-skills'],
    queryFn: () => api.get('/employees', { params: { limit: 500 } }).then((r) => r.data as Employee[]),
  })

  const withSkill = (allEmployees || []).filter((e) => e.skills.some((s) => s.skill_id === skill.id))
  const withoutSkill = (allEmployees || []).filter((e) => !e.skills.some((s) => s.skill_id === skill.id) && e.employment_status !== 'fired')

  const addMutation = useMutation({
    mutationFn: async (empId: number) => {
      const emp = allEmployees?.find((e) => e.id === empId)
      const ids = [...(emp?.skills.map((s) => s.skill_id) || []), skill.id]
      return api.put(`/employees/${empId}`, { skill_ids: ids })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees-all-skills', 'employees', 'skills'] })
      setAddId('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: async (empId: number) => {
      const emp = allEmployees?.find((e) => e.id === empId)
      const ids = (emp?.skills || []).filter((s) => s.skill_id !== skill.id).map((s) => s.skill_id)
      return api.put(`/employees/${empId}`, { skill_ids: ids })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees-all-skills', 'employees', 'skills'] }),
  })

  return (
    <div className="space-y-4">
      {/* Текущие сотрудники */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Сотрудники с навыком ({withSkill.length})
        </p>
        {isLoading ? (
          <PageSpinner />
        ) : withSkill.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">Нет назначенных сотрудников</p>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {withSkill.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-slate-50">
                <div>
                  <p className="text-sm font-medium text-slate-800">{e.full_name}</p>
                  <p className="text-xs text-slate-400">{e.position || '—'} · {e.team_name || 'Без команды'}</p>
                </div>
                <button
                  onClick={() => removeMutation.mutate(e.id)}
                  disabled={removeMutation.isPending}
                  className="p-1.5 hover:bg-red-50 rounded text-slate-400 hover:text-red-600"
                  title="Убрать навык"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Добавить сотрудника */}
      {withoutSkill.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Добавить сотрудника</p>
          <div className="flex gap-2">
            <select className="input flex-1" value={addId} onChange={(e) => setAddId(e.target.value ? +e.target.value : '')}>
              <option value="">— выберите сотрудника —</option>
              {withoutSkill.map((e) => (
                <option key={e.id} value={e.id}>{e.full_name}{e.team_name ? ` · ${e.team_name}` : ''}</option>
              ))}
            </select>
            <button
              onClick={() => addId !== '' && addMutation.mutate(+addId)}
              disabled={addId === '' || addMutation.isPending}
              className="btn-primary"
            >
              <UserCheck size={14} /> Добавить
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button onClick={onClose} className="btn-secondary">Закрыть</button>
      </div>
    </div>
  )
}

export default function SkillsPage() {
  const [showForm, setShowForm] = useState(false)
  const [editSkill, setEditSkill] = useState<Skill | null>(null)
  const [manageSkill, setManageSkill] = useState<Skill | null>(null)
  const [seedMsg, setSeedMsg] = useState<string | null>(null)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['skills'],
    queryFn: () => api.get('/skills').then((r) => r.data as Skill[]),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/skills/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills'] }),
  })

  const seedMutation = useMutation({
    mutationFn: () => api.post('/skills/seed').then((r) => r.data),
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ['skills'] }); setSeedMsg(`Добавлено стандартных навыков: ${d.added}`) },
    onError: (e: any) => setSeedMsg(`Ошибка: ${e.response?.data?.detail || e.message}`),
  })

  return (
    <div>
      {seedMsg && (
        <div className={`card p-3 mb-4 text-sm ${seedMsg.startsWith('Ошибка') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {seedMsg}
        </div>
      )}
      <PageHeader
        title="Навыки"
        subtitle="Навыки определяют, куда можно назначить оператора"
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
              <Sparkles size={15} /> Стандартные навыки
            </button>
            <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> Добавить</button>
          </div>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? <PageSpinner /> : data?.length === 0 ? (
          <div className="col-span-3">
            <EmptyState title="Нет навыков" icon={<Star size={40} />}
              action={<button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> Добавить</button>} />
          </div>
        ) : data?.map((skill) => (
          <div key={skill.id} className="card p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <Star size={18} className="text-purple-600" />
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setEditSkill(skill)} className="p-1.5 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600"><Pencil size={14} /></button>
                <button onClick={() => confirm(`Удалить навык "${skill.name}"?`) && deleteMutation.mutate(skill.id)}
                  className="p-1.5 hover:bg-red-50 rounded text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            </div>
            <h3 className="font-semibold text-slate-900">{skill.name}</h3>
            {skill.code && <p className="text-xs text-slate-400 mt-0.5">Код: {skill.code}</p>}
            {skill.description && <p className="text-sm text-slate-500 mt-2">{skill.description}</p>}
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-400">{skill.employee_count} сотрудников</span>
              <button
                onClick={() => setManageSkill(skill)}
                className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 font-medium"
              >
                <UserCheck size={12} /> Управлять
              </button>
            </div>
          </div>
        ))}
      </div>

      {showForm && <Modal open title="Новый навык" onClose={() => setShowForm(false)}><SkillForm onClose={() => setShowForm(false)} /></Modal>}
      {editSkill && <Modal open title="Редактировать навык" onClose={() => setEditSkill(null)}><SkillForm skill={editSkill} onClose={() => setEditSkill(null)} /></Modal>}
      {manageSkill && (
        <Modal open title={`Сотрудники — ${manageSkill.name}`} onClose={() => setManageSkill(null)}>
          <SkillMembersModal skill={manageSkill} onClose={() => setManageSkill(null)} />
        </Modal>
      )}
    </div>
  )
}

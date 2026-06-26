import { Fragment, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, ChevronRight, ChevronDown, UsersRound, Save, User, UserPlus, X, Clock4, Eye } from 'lucide-react'
import api from '@/api/client'
import type { Team, Employee } from '@/types'
import { TEAM_TYPE_LABELS } from '@/types'
import { useProjectStore } from '@/store/project'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/common/EmptyState'
import EmployeeDetailPanel from '@/components/team/EmployeeDetailPanel'
import ShiftAssignModal from '@/components/worktime/ShiftAssignModal'

function TeamForm({ team, teams, projectUuid, onClose }: { team?: Team | null; teams: Team[]; projectUuid?: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: team?.name ?? '',
    team_type: team?.team_type ?? 'group',
    parent_id: team?.parent_id ?? '' as any,
    leader_user_id: team?.leader_user_id ?? '' as any,
    user_ids: (team?.user_ids ?? []) as number[],
    description: team?.description ?? '',
  })
  const [error, setError] = useState('')
  const toggleUser = (id: number) =>
    setForm((f) => ({ ...f, user_ids: f.user_ids.includes(id) ? f.user_ids.filter((x) => x !== id) : [...f.user_ids, id] }))

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data as { id: number; full_name: string | null; username: string }[]),
  })

  const mutation = useMutation({
    mutationFn: (data: any) =>
      team ? api.put(`/teams/${team.id}`, data) : api.post('/teams', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teams'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail || 'Ошибка'),
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const payload: any = { ...form, parent_id: form.parent_id || null, leader_user_id: form.leader_user_id || null, user_ids: form.user_ids }
        if (!team) payload.project_uuid = projectUuid
        mutation.mutate(payload)
      }}
      className="space-y-5"
    >
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>}

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Основное</p>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="label">Название *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Группа продаж" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Тип</label>
              <select className="input" value={form.team_type} onChange={(e) => setForm({ ...form, team_type: e.target.value as any })}>
                <option value="group">Группа операторов</option>
                <option value="department">Отдел</option>
                <option value="division">Управление</option>
              </select>
            </div>
            <div>
              <label className="label">Входит в структуру</label>
              <select className="input" value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
                <option value="">— корневая —</option>
                {teams.filter((t) => t.id !== team?.id).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Руководитель <span className="text-slate-400 font-normal">(пользователь системы)</span></label>
            <select className="input" value={form.leader_user_id} onChange={(e) => setForm({ ...form, leader_user_id: e.target.value })}>
              <option value="">— не назначен —</option>
              {users?.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name || u.username}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Отображать у пользователей <span className="text-slate-400 font-normal">(можно нескольких)</span></label>
            <div className="border border-slate-200 rounded-lg max-h-40 overflow-y-auto divide-y divide-slate-50">
              {(users || []).length === 0 ? (
                <p className="text-xs text-slate-400 px-3 py-2">Нет пользователей</p>
              ) : users!.map((u) => (
                <label key={u.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-slate-50 text-sm">
                  <input type="checkbox" checked={form.user_ids.includes(u.id)} onChange={() => toggleUser(u.id)} />
                  <span className="text-slate-700">{u.full_name || u.username}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-1">Команда видна всем, но это влияет на фильтр «Мои команды».</p>
          </div>
          <div>
            <label className="label">Описание</label>
            <textarea className="input" rows={2} value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Краткое описание команды..." />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary">Отмена</button>
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          <Save size={14} /> {mutation.isPending ? 'Сохраняем...' : 'Сохранить'}
        </button>
      </div>
    </form>
  )
}

function AddMemberModal({ team, onClose }: { team: Team; onClose: () => void }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [adding, setAdding] = useState(false)

  const { data: employees } = useQuery({
    queryKey: ['employees-all'],
    queryFn: () => api.get('/employees', { params: { limit: 500 } }).then((r) => r.data as Employee[]),
  })

  const mutation = useMutation({
    mutationFn: (empId: number) => api.put(`/employees/${empId}`, { team_id: team.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] })
      qc.invalidateQueries({ queryKey: ['employees-all'] })
    },
  })

  const available = (employees || []).filter((e) => e.employment_status !== 'fired')
  const filtered = search
    ? available.filter((e) => (e.full_name || e.naumen_login || '').toLowerCase().includes(search.toLowerCase()))
    : available

  const toggle = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleAdd = async () => {
    setAdding(true)
    try {
      for (const id of selectedIds) {
        await mutation.mutateAsync(id)
      }
    } finally {
      setAdding(false)
    }
    onClose()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
        <div>
          <p className="text-sm font-semibold text-slate-800">{team.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">{team.employee_count} сотрудников в команде</p>
        </div>
      </div>
      <div className="relative">
        <input
          className="input pl-9"
          placeholder="Поиск по имени или логину..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">🔍</span>
      </div>
      <div className="border border-slate-200 rounded-xl overflow-hidden overflow-y-auto max-h-72">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">Нет сотрудников</p>
        ) : (
          filtered.map((emp) => (
            <label
              key={emp.id}
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-slate-100 last:border-0 transition-colors ${
                selectedIds.has(emp.id) ? 'bg-brand-50' : 'hover:bg-slate-50'
              }`}
            >
              <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                selectedIds.has(emp.id) ? 'bg-brand-600 border-brand-600' : 'border-slate-300'
              }`} onClick={() => toggle(emp.id)}>
                {selectedIds.has(emp.id) && (
                  <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                    <path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{emp.full_name}</p>
                {emp.team_name && <p className="text-xs text-slate-400 truncate">Текущая команда: {emp.team_name}</p>}
              </div>
              {emp.employment_status === 'new' && (
                <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full flex-shrink-0">Новый</span>
              )}
            </label>
          ))
        )}
      </div>
      {selectedIds.size > 0 && (
        <p className="text-xs text-brand-700 bg-brand-50 px-3 py-1.5 rounded-lg">Выбрано: {selectedIds.size}</p>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="btn-secondary">Отмена</button>
        <button onClick={handleAdd} disabled={selectedIds.size === 0 || adding} className="btn-primary">
          <UserPlus size={14} /> Добавить{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
        </button>
      </div>
    </div>
  )
}

function TeamNode({ team, allTeams, allEmployees, level, onEdit, onDelete, onAddMember, onAssignShifts, onViewShifts }: {
  team: Team
  allTeams: Team[]
  allEmployees: Employee[]
  level: number
  onEdit: (t: Team) => void
  onDelete: (t: Team) => void
  onAddMember: (t: Team) => void
  onAssignShifts: (e: Employee) => void
  onViewShifts: (e: Employee) => void
}) {
  const qc = useQueryClient()
  const [childrenOpen, setChildrenOpen] = useState(level === 0)
  const [membersOpen, setMembersOpen] = useState(false)
  const [expandedEmpId, setExpandedEmpId] = useState<number | null>(null)

  const children = allTeams.filter((t) => t.parent_id === team.id)
  const members = allEmployees.filter((e) => e.team_id === team.id)
  const typeLabel = TEAM_TYPE_LABELS[team.team_type] ?? team.team_type

  const removeMember = useMutation({
    mutationFn: (empId: number) => api.put(`/employees/${empId}`, { team_id: null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] })
      qc.invalidateQueries({ queryKey: ['employees-all'] })
    },
  })

  return (
    <div>
      {/* Строка команды */}
      <div
        className={`flex items-center gap-2 py-2.5 hover:bg-slate-50 group border-b border-slate-50 cursor-pointer select-none ${membersOpen ? 'bg-brand-50/40' : ''}`}
        style={{ paddingLeft: `${16 + level * 24}px`, paddingRight: '16px' }}
        onClick={() => setMembersOpen((v) => !v)}
      >
        {/* Chevron дочерних команд */}
        <button
          onClick={(e) => { e.stopPropagation(); setChildrenOpen((v) => !v) }}
          className="w-5 h-5 flex items-center justify-center text-slate-400 flex-shrink-0"
        >
          {children.length > 0
            ? (childrenOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)
            : <span className="w-1 h-1 rounded-full bg-slate-300 block" />}
        </button>

        {/* Chevron участников + название */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {membersOpen
            ? <ChevronDown size={13} className="text-brand-500 flex-shrink-0" />
            : <ChevronRight size={13} className="text-slate-300 flex-shrink-0" />}
          <span className="text-sm font-medium text-slate-900">{team.name}</span>
          <span className="text-xs text-slate-400">{typeLabel}</span>
          {team.leader_user_name && (
            <span className="text-xs text-slate-500 inline-flex items-center gap-1">
              <User size={11} /> {team.leader_user_name}
            </span>
          )}
        </div>

        <Badge label={`${team.employee_count} чел.`} color="blue" />

        <button
          onClick={(e) => { e.stopPropagation(); onAddMember(team) }}
          className="flex items-center gap-1 px-2 py-1 text-xs text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg font-medium transition-colors ml-2"
          title="Добавить сотрудника в команду"
        >
          <UserPlus size={11} /> Добавить
        </button>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={(e) => { e.stopPropagation(); onEdit(team) }} className="p-1.5 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600"><Pencil size={12} /></button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(team) }} className="p-1.5 hover:bg-red-50 rounded text-slate-400 hover:text-red-600"><Trash2 size={12} /></button>
        </div>
      </div>

      {/* Список участников */}
      {membersOpen && (
        <div
          className="border-b border-slate-200 bg-slate-50"
          style={{ paddingLeft: `${40 + level * 24}px` }}
        >
          {members.length === 0 ? (
            <p className="px-4 py-3 text-xs text-slate-400 italic">
              Участников нет — нажмите «Добавить», чтобы добавить сотрудника
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="w-6" />
                  <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">ФИО</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Должность</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Логин Naumen</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.map((emp) => {
                  const empOpen = expandedEmpId === emp.id
                  return (
                    <Fragment key={emp.id}>
                      <tr
                        className={`border-b border-slate-100 hover:bg-white cursor-pointer ${empOpen ? 'bg-white' : ''}`}
                        onClick={() => setExpandedEmpId(empOpen ? null : emp.id)}
                      >
                        <td className="pl-4 text-slate-400">
                          {empOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </td>
                        <td className="px-4 py-2 font-medium text-slate-900">{emp.full_name}</td>
                        <td className="px-4 py-2 text-slate-500 text-xs">{emp.position || '—'}</td>
                        <td className="px-4 py-2 text-slate-400 font-mono text-xs">{emp.naumen_login || '—'}</td>
                        <td className="px-4 py-2 text-xs">
                          {emp.employment_status === 'active' && <span className="text-green-600">Работает</span>}
                          {emp.employment_status === 'new' && <span className="text-blue-600">Новый</span>}
                          {emp.employment_status === 'fired' && <span className="text-slate-400">Уволен</span>}
                        </td>
                        <td className="px-4 py-2 text-right pr-4 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => onAssignShifts(emp)}
                              className="p-1 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600 transition-colors"
                              title="Поставить смены"
                            >
                              <Clock4 size={13} />
                            </button>
                            <button
                              onClick={() => onViewShifts(emp)}
                              className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700 transition-colors"
                              title="Просмотреть смены"
                            >
                              <Eye size={13} />
                            </button>
                            <button
                              onClick={() => removeMember.mutate(emp.id)}
                              disabled={removeMember.isPending}
                              className="p-1 hover:bg-red-50 rounded text-slate-300 hover:text-red-500 transition-colors"
                              title="Убрать из команды"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {empOpen && (
                        <tr className="border-b border-slate-100 bg-white">
                          <td colSpan={6} className="px-6 py-4">
                            <EmployeeDetailPanel emp={emp} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Дочерние команды */}
      {childrenOpen && children.map((c) => (
        <TeamNode
          key={c.id}
          team={c}
          allTeams={allTeams}
          allEmployees={allEmployees}
          level={level + 1}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddMember={onAddMember}
          onAssignShifts={onAssignShifts}
          onViewShifts={onViewShifts}
        />
      ))}
    </div>
  )
}

export default function TeamsPage() {
  const [showForm, setShowForm] = useState(false)
  const [editTeam, setEditTeam] = useState<Team | null>(null)
  const [addMemberTeam, setAddMemberTeam] = useState<Team | null>(null)
  const [shiftEmp, setShiftEmp] = useState<Employee | null>(null)
  const [viewShiftsEmp, setViewShiftsEmp] = useState<Employee | null>(null)
  const qc = useQueryClient()
  const { activeProject } = useProjectStore()

  const { data, isLoading } = useQuery({
    queryKey: ['teams', activeProject?.customer_uuid],
    queryFn: () =>
      api.get('/teams', { params: { project_uuid: activeProject?.customer_uuid } })
        .then((r) => r.data as Team[]),
    enabled: !!activeProject,
  })

  const { data: allEmployees = [] } = useQuery({
    queryKey: ['employees-all'],
    queryFn: () => api.get('/employees', { params: { limit: 500 } }).then((r) => r.data as Employee[]),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/teams/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams'] }),
  })

  const allTeams = data || []
  const roots = allTeams.filter((t) => !t.parent_id)

  return (
    <div>
      <PageHeader
        title="Команды"
        subtitle="Нажмите на строку команды, чтобы увидеть состав"
        actions={
          <button className="btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={16} /> Добавить команду
          </button>
        }
      />

      <div className="card overflow-hidden">
        {isLoading ? <PageSpinner /> : roots.length === 0 ? (
          <EmptyState title="Нет команд" icon={<UsersRound size={40} />}
            action={<button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> Создать команду</button>} />
        ) : (
          <div>
            <div className="flex bg-slate-50 border-b border-slate-100 px-4 py-2.5">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex-1">Название / Руководитель</span>
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide mr-20">Состав</span>
            </div>
            {roots.map((t) => (
              <TeamNode
                key={t.id}
                team={t}
                allTeams={allTeams}
                allEmployees={allEmployees}
                level={0}
                onEdit={setEditTeam}
                onDelete={(t) => confirm(`Удалить команду "${t.name}"?`) && deleteMutation.mutate(t.id)}
                onAddMember={setAddMemberTeam}
                onAssignShifts={setShiftEmp}
                onViewShifts={setViewShiftsEmp}
              />
            ))}
          </div>
        )}
      </div>

      {activeProject && (
        <p className="text-xs text-slate-400 mt-4">Проект: {activeProject.customer_name}</p>
      )}

      {showForm && <Modal open title="Новая команда" onClose={() => setShowForm(false)}><TeamForm teams={allTeams} projectUuid={activeProject?.customer_uuid} onClose={() => setShowForm(false)} /></Modal>}
      {editTeam && <Modal open title="Редактировать команду" onClose={() => setEditTeam(null)}><TeamForm team={editTeam} teams={allTeams} projectUuid={activeProject?.customer_uuid} onClose={() => setEditTeam(null)} /></Modal>}
      {addMemberTeam && <Modal open title={`Добавить сотрудника — ${addMemberTeam.name}`} onClose={() => setAddMemberTeam(null)}><AddMemberModal team={addMemberTeam} onClose={() => setAddMemberTeam(null)} /></Modal>}
      {shiftEmp && <Modal open size="xl" title={`Смены: ${shiftEmp.full_name}`} onClose={() => setShiftEmp(null)}><ShiftAssignModal employee={shiftEmp} projectUuid={activeProject?.customer_uuid} onClose={() => setShiftEmp(null)} /></Modal>}
      {viewShiftsEmp && <Modal open size="xl" title={`Смены (просмотр): ${viewShiftsEmp.full_name}`} onClose={() => setViewShiftsEmp(null)}><ShiftAssignModal employee={viewShiftsEmp} readOnly onEdit={() => { const e = viewShiftsEmp; setViewShiftsEmp(null); setShiftEmp(e) }} onClose={() => setViewShiftsEmp(null)} /></Modal>}
    </div>
  )
}

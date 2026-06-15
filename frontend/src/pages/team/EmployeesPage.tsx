import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Search, Pencil, Trash2, UserCheck, Save, RefreshCw, Loader2,
  ChevronDown, ChevronRight, X, Clock4, Eye, EyeOff,
} from 'lucide-react'
import api from '@/api/client'
import type { Employee, Skill } from '@/types'
import { EMPLOYMENT_STATUS_LABELS } from '@/types'
import { useProjectStore } from '@/store/project'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/common/EmptyState'
import { format } from 'date-fns'

const STATUS_COLORS: Record<string, 'green' | 'blue' | 'gray'> = {
  active: 'green', new: 'blue', fired: 'gray',
}

// ─── Форма сотрудника ────────────────────────────────────────────────────────
function EmployeeForm({ employee, onClose }: { employee?: Employee | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { activeProject } = useProjectStore()
  const [form, setForm] = useState({
    full_name: employee?.full_name ?? '',
    preferred_schedule: employee?.preferred_schedule ?? '',
    employment_status: employee?.employment_status ?? 'new',
    project_uuid: employee?.project_uuid ?? activeProject?.customer_uuid ?? '',
    team_id: employee?.team_id ?? '' as any,
    position: employee?.position ?? '',
    naumen_login: employee?.naumen_login ?? '',
    phone: employee?.phone ?? '',
    email: employee?.email ?? '',
    is_active: employee?.is_active ?? true,
  })
  const [error, setError] = useState('')

  const { data: teams } = useQuery({
    queryKey: ['teams'],
    queryFn: () => api.get('/teams').then((r) => r.data as any[]),
  })

  const { data: schedules } = useQuery({
    queryKey: ['schedules'],
    queryFn: () => api.get('/schedules').then((r) => r.data as any[]),
  })

  const mutation = useMutation({
    mutationFn: (data: any) =>
      employee ? api.put(`/employees/${employee.id}`, data) : api.post('/employees', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail || 'Ошибка'),
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        mutation.mutate({ ...form, team_id: form.team_id || null, preferred_schedule: form.preferred_schedule || null })
      }}
      className="space-y-5"
    >
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>}

      {/* Личные данные */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Личные данные</p>
        </div>
        <div className="p-4 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">ФИО *</label>
            <input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required placeholder="Иванов Иван Иванович" />
          </div>
          <div>
            <label className="label">Должность</label>
            <input className="input" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} placeholder="Оператор" />
          </div>
          <div>
            <label className="label">Статус занятости</label>
            <select className="input" value={form.employment_status} onChange={(e) => setForm({ ...form, employment_status: e.target.value as any })}>
              <option value="new">Новый</option>
              <option value="active">Работает</option>
              <option value="fired">Уволен</option>
            </select>
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="ivan@example.com" />
          </div>
          <div>
            <label className="label">Телефон</label>
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+7 999 000-00-00" />
          </div>
        </div>
      </div>

      {/* Рабочие параметры */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Рабочие параметры</p>
        </div>
        <div className="p-4 grid grid-cols-2 gap-4">
          <div>
            <label className="label">Команда</label>
            <select className="input" value={form.team_id} onChange={(e) => setForm({ ...form, team_id: e.target.value })}>
              <option value="">— не выбрана —</option>
              {teams?.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Приоритетный график</label>
            <select className="input" value={form.preferred_schedule} onChange={(e) => setForm({ ...form, preferred_schedule: e.target.value })}>
              <option value="">— не указан —</option>
              {(schedules || []).map((s: any) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Логин Naumen</label>
            <input className="input font-mono" value={form.naumen_login} onChange={(e) => setForm({ ...form, naumen_login: e.target.value })} placeholder="ivanov_i" />
          </div>
          <div className="flex items-end pb-0.5">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <div
                onClick={() => setForm({ ...form, is_active: !form.is_active })}
                className={`w-10 h-5 rounded-full transition-colors cursor-pointer flex-shrink-0 ${form.is_active ? 'bg-green-500' : 'bg-slate-300'}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full shadow mt-0.5 transition-transform ${form.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-sm text-slate-700">Активен в системе</span>
            </label>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-secondary">Отмена</button>
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          <Save size={14} /> {mutation.isPending ? 'Сохраняем...' : 'Сохранить'}
        </button>
      </div>
    </form>
  )
}

// ─── Быстрая постановка смены ────────────────────────────────────────────────
function QuickShiftModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    shift_date: format(new Date(), 'yyyy-MM-dd'),
    start_time: '',
    end_time: '',
    status: 'planned',
    notes: '',
  })
  const [error, setError] = useState('')

  const { data: schedules } = useQuery({
    queryKey: ['schedules'],
    queryFn: () => api.get('/schedules').then((r) => r.data as any[]),
  })

  const mutation = useMutation({
    mutationFn: (d: any) => api.post('/schedules/shifts', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shifts'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail || 'Ошибка'),
  })

  return (
    <form onSubmit={(e) => { e.preventDefault(); mutation.mutate({ ...form, employee_id: employee.id, start_time: form.start_time || null, end_time: form.end_time || null }) }} className="space-y-4">
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      <div className="bg-slate-50 rounded-lg p-3 text-sm">
        <p className="font-medium text-slate-800">{employee.full_name}</p>
        <p className="text-slate-500 text-xs mt-0.5">{employee.position || 'Должность не указана'} · {employee.team_name || 'Без команды'}</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2"><label className="label">Дата смены *</label><input type="date" className="input" value={form.shift_date} onChange={(e) => setForm({ ...form, shift_date: e.target.value })} required /></div>
        <div><label className="label">Начало</label><input type="datetime-local" className="input" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></div>
        <div><label className="label">Конец</label><input type="datetime-local" className="input" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></div>
        <div><label className="label">Статус</label>
          <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="planned">Запланирована</option><option value="confirmed">Подтверждена</option>
          </select>
        </div>
        <div><label className="label">График</label>
          <select className="input" onChange={(e) => {
            const s = schedules?.find((sc: any) => String(sc.id) === e.target.value)
            if (s) {
              const base = form.shift_date + 'T'
              setForm({ ...form, start_time: s.work_start ? base + s.work_start : '', end_time: s.work_end ? base + s.work_end : '' })
            }
          }}>
            <option value="">— выбрать шаблон —</option>
            {schedules?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <div><label className="label">Примечание</label><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-secondary">Отмена</button>
        <button type="submit" className="btn-primary" disabled={mutation.isPending}><Clock4 size={14} /> Назначить смену</button>
      </div>
    </form>
  )
}

// ─── Строка сотрудника с раскрытием ─────────────────────────────────────────
function EmployeeRow({
  emp,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onShift,
  allSkills,
}: {
  emp: Employee
  expanded: boolean
  onToggle: () => void
  onEdit: (e: Employee) => void
  onDelete: (e: Employee) => void
  onShift: (e: Employee) => void
  allSkills: Skill[]
}) {
  const qc = useQueryClient()
  const [addSkillId, setAddSkillId] = useState<number | ''>('')

  const addSkillMutation = useMutation({
    mutationFn: (skillId: number) =>
      api.put(`/employees/${emp.id}`, { skill_ids: [...emp.skills.map((s) => s.skill_id), skillId] }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); setAddSkillId('') },
  })

  const removeSkillMutation = useMutation({
    mutationFn: (skillId: number) =>
      api.put(`/employees/${emp.id}`, { skill_ids: emp.skills.filter((s) => s.skill_id !== skillId).map((s) => s.skill_id) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  })

  const availableSkills = allSkills.filter((s) => !emp.skills.some((es) => es.skill_id === s.id))

  return (
    <>
      <tr
        className={`border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer ${expanded ? 'bg-slate-50' : ''}`}
        onClick={onToggle}
      >
        <td className="px-4 py-3 text-slate-400 w-6">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </td>
        <td className="px-4 py-3 font-medium text-slate-900">{emp.full_name}</td>
        <td className="px-4 py-3">
          <Badge label={EMPLOYMENT_STATUS_LABELS[emp.employment_status] ?? emp.employment_status} color={STATUS_COLORS[emp.employment_status] ?? 'gray'} />
        </td>
        <td className="px-4 py-3 text-slate-600">{emp.team_name || '—'}</td>
        <td className="px-4 py-3 text-slate-600">{emp.position || '—'}</td>
        <td className="px-4 py-3 text-slate-500">{emp.preferred_schedule || '—'}</td>
        <td className="px-4 py-3 text-slate-400 font-mono text-xs">{emp.naumen_login || '—'}</td>
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1 justify-end">
            <button onClick={() => onShift(emp)} className="p-1.5 hover:bg-blue-50 rounded-lg text-slate-400 hover:text-blue-600" title="Поставить смену"><Clock4 size={13} /></button>
            <button onClick={() => onEdit(emp)} className="p-1.5 hover:bg-blue-50 rounded-lg text-slate-400 hover:text-blue-600" title="Редактировать"><Pencil size={13} /></button>
            <button onClick={() => onDelete(emp)} className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-600" title="Удалить"><Trash2 size={13} /></button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-100">
          <td colSpan={8} className="px-6 py-4 bg-slate-50">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {/* Контактная информация */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Контакты</p>
                <div className="space-y-1 text-sm">
                  {[['Email', emp.email], ['Телефон', emp.phone], ['Логин Naumen', emp.naumen_login]].map(([label, val]) => (
                    <div key={label} className="flex gap-2">
                      <span className="text-slate-400 w-28 flex-shrink-0">{label}:</span>
                      <span className="text-slate-700 font-mono text-xs">{val || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Навыки */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Навыки</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {emp.skills.length === 0 && <span className="text-xs text-slate-400">Навыки не назначены</span>}
                  {emp.skills.map((s) => (
                    <span key={s.skill_id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs">
                      {s.skill_name}
                      <button onClick={() => removeSkillMutation.mutate(s.skill_id)} className="hover:text-red-600 ml-0.5">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
                {availableSkills.length > 0 && (
                  <div className="flex gap-2">
                    <select
                      className="input text-xs py-1 h-7 flex-1"
                      value={addSkillId}
                      onChange={(e) => setAddSkillId(e.target.value ? +e.target.value : '')}
                    >
                      <option value="">+ добавить навык...</option>
                      {availableSkills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    {addSkillId !== '' && (
                      <button
                        onClick={() => addSkillMutation.mutate(+addSkillId)}
                        disabled={addSkillMutation.isPending}
                        className="px-2 py-1 bg-purple-600 text-white text-xs rounded-lg hover:bg-purple-700"
                      >
                        ОК
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Быстрые действия */}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Действия</p>
                <div className="flex flex-col gap-2">
                  <button onClick={() => onShift(emp)} className="flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-medium transition-colors">
                    <Clock4 size={13} /> Поставить смену
                  </button>
                  <button onClick={() => onEdit(emp)} className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors">
                    <Pencil size={13} /> Редактировать карточку
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

type EmpSortKey = 'full_name' | 'employment_status' | 'team_name' | 'position' | 'preferred_schedule' | 'naumen_login'

// ─── Главная страница сотрудников ────────────────────────────────────────────
export default function EmployeesPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [hideFired, setHideFired] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null)
  const [shiftEmployee, setShiftEmployee] = useState<Employee | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<EmpSortKey>('full_name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const qc = useQueryClient()
  const { activeProject } = useProjectStore()

  const { data, isLoading } = useQuery({
    queryKey: ['employees', activeProject?.customer_uuid, search, statusFilter],
    queryFn: () =>
      api.get('/employees', {
        params: {
          project_uuid: activeProject?.customer_uuid || undefined,
          search: search || undefined,
          employment_status: statusFilter || undefined,
          limit: 300,
        },
      }).then((r) => r.data as Employee[]),
  })

  const { data: allSkills } = useQuery({
    queryKey: ['skills'],
    queryFn: () => api.get('/skills').then((r) => r.data as Skill[]),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/employees/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  })

  const [bulkActivating, setBulkActivating] = useState(false)
  const handleBulkActivate = async (ids: number[]) => {
    setBulkActivating(true)
    try {
      for (const id of ids) {
        await api.put(`/employees/${id}`, { employment_status: 'active' })
      }
      qc.invalidateQueries({ queryKey: ['employees'] })
    } finally {
      setBulkActivating(false)
    }
  }

  const handleSync = async () => {
    if (!activeProject) return
    setSyncing(true); setSyncResult(null)
    try {
      const res = await api.post('/employees/sync-naumen', null, {
        params: { project_uuid: activeProject.customer_uuid },
      })
      const { added, fired_auto, deleted_stale, total_from_naumen, active_in_30d } = res.data
      setSyncResult(
        `Из Naumen получено: ${total_from_naumen}, активны за 30 дней: ${active_in_30d}. ` +
        `Добавлено: ${added}. Помечено уволенными: ${fired_auto}. ` +
        `Удалено (неактивны 6+ мес.): ${deleted_stale ?? 0}.`
      )
      qc.invalidateQueries({ queryKey: ['employees'] })
    } catch (e: any) {
      setSyncResult(`Ошибка: ${e.response?.data?.detail || e.message}`)
    } finally { setSyncing(false) }
  }

  const handleSort = (key: EmpSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const displayData = [...(data || []).filter((emp) => !hideFired || emp.employment_status !== 'fired')]
    .sort((a, b) => {
      const av = (a as any)[sortKey] ?? ''
      const bv = (b as any)[sortKey] ?? ''
      const cmp = String(av).localeCompare(String(bv), 'ru')
      return sortDir === 'asc' ? cmp : -cmp
    })

  const newEmployees = displayData.filter((e) => e.employment_status === 'new')

  return (
    <div>
      <PageHeader
        title="Сотрудники"
        subtitle={`Всего: ${displayData.length}${hideFired && (data || []).some(e => e.employment_status === 'fired') ? ` (скрыто уволенных: ${(data || []).filter(e => e.employment_status === 'fired').length})` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            {activeProject && (
              <button className="btn-secondary" onClick={handleSync} disabled={syncing} title="Синхронизировать с Naumen">
                {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                {syncing ? 'Синхронизируем...' : 'Синхронизировать'}
              </button>
            )}
            <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> Добавить</button>
          </div>
        }
      />

      {syncResult && (
        <div className={`card p-3 mb-4 text-sm ${syncResult.startsWith('Ошибка') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {syncResult}
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Поиск по имени..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <label className="label">Статус</label>
          <select className="input w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Все</option><option value="new">Новые</option><option value="active">Работают</option><option value="fired">Уволены</option>
          </select>
        </div>
        <button
          onClick={() => setHideFired(!hideFired)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${hideFired ? 'border-slate-200 bg-slate-100 text-slate-600' : 'border-red-200 bg-red-50 text-red-600'}`}
        >
          {hideFired ? <EyeOff size={14} /> : <Eye size={14} />}
          {hideFired ? 'Уволенные скрыты' : 'Показать всех'}
        </button>
        {newEmployees.length > 0 && (
          <button
            onClick={() => {
              if (confirm(`Активировать всех новых сотрудников? (${newEmployees.length} чел.)`)) {
                handleBulkActivate(newEmployees.map((e) => e.id))
              }
            }}
            disabled={bulkActivating}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
          >
            {bulkActivating ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
            Активировать новых ({newEmployees.length})
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <PageSpinner />
        ) : !displayData.length ? (
          <EmptyState
            title="Нет сотрудников"
            description="Добавьте вручную или синхронизируйте с Naumen"
            icon={<UserCheck size={40} />}
            action={<button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> Добавить</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="w-6 px-4 py-3" />
                  {([
                    { label: 'ФИО', key: 'full_name' },
                    { label: 'Статус', key: 'employment_status' },
                    { label: 'Команда', key: 'team_name' },
                    { label: 'Должность', key: 'position' },
                    { label: 'График', key: 'preferred_schedule' },
                    { label: 'Naumen', key: 'naumen_login' },
                  ] as { label: string; key: EmpSortKey }[]).map(({ label, key }) => (
                    <th
                      key={key}
                      onClick={() => handleSort(key)}
                      className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-slate-700 group"
                    >
                      <span className="inline-flex items-center gap-1">
                        {label}
                        <span className={`transition-opacity ${sortKey === key ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}>
                          {sortKey === key && sortDir === 'asc' ? <ChevronDown size={12} /> : <ChevronDown size={12} className="rotate-180" />}
                        </span>
                      </span>
                    </th>
                  ))}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {displayData.map((emp) => (
                  <EmployeeRow
                    key={emp.id}
                    emp={emp}
                    expanded={expandedId === emp.id}
                    onToggle={() => setExpandedId(expandedId === emp.id ? null : emp.id)}
                    onEdit={setEditEmployee}
                    onDelete={(e) => confirm(`Удалить сотрудника ${e.full_name}?`) && deleteMutation.mutate(e.id)}
                    onShift={setShiftEmployee}
                    allSkills={allSkills || []}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && <Modal open title="Новый сотрудник" onClose={() => setShowForm(false)}><EmployeeForm onClose={() => setShowForm(false)} /></Modal>}
      {editEmployee && <Modal open title="Редактировать сотрудника" onClose={() => setEditEmployee(null)}><EmployeeForm employee={editEmployee} onClose={() => setEditEmployee(null)} /></Modal>}
      {shiftEmployee && <Modal open title={`Смена — ${shiftEmployee.full_name}`} onClose={() => setShiftEmployee(null)}><QuickShiftModal employee={shiftEmployee} onClose={() => setShiftEmployee(null)} /></Modal>}
    </div>
  )
}

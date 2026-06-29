import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Search, Pencil, Trash2, UserCheck, Save, RefreshCw, Loader2,
  ChevronDown, ChevronRight, X, Clock4, AlertCircle, Award, Filter, Eye,
} from 'lucide-react'
import ShiftAssignModal from '@/components/worktime/ShiftAssignModal'
import api from '@/api/client'
import type { Employee, Skill } from '@/types'
import { EMPLOYMENT_STATUS_LABELS } from '@/types'
import { useProjectStore } from '@/store/project'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/common/EmptyState'
import QueueFilterDropdown from '@/components/common/QueueFilterDropdown'
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
  })
  const [error, setError] = useState('')

  const { data: teams } = useQuery({
    queryKey: ['teams', activeProject?.customer_uuid],
    queryFn: () => api.get('/teams', { params: { project_uuid: activeProject?.customer_uuid } }).then((r) => r.data as any[]),
  })

  const { data: schedules } = useQuery({
    queryKey: ['schedules', activeProject?.customer_uuid],
    queryFn: () => api.get('/schedules', { params: { project_uuid: activeProject?.customer_uuid } }).then((r) => r.data as any[]),
  })

  const mutation = useMutation({
    mutationFn: (data: any) => {
      if (employee) {
        // Never change project_uuid when editing existing employee
        const { project_uuid, ...rest } = data
        return api.put(`/employees/${employee.id}`, rest)
      }
      return api.post('/employees', data)
    },
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

// ─── Навыки сотрудника (модалка по кнопке "Навыки") ─────────────────────────
function SkillsModal({ employee, allSkills, onClose }: { employee: Employee; allSkills: Skill[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [addSkillId, setAddSkillId] = useState<number | ''>('')
  const [skillError, setSkillError] = useState<string | null>(null)

  const addSkillMutation = useMutation({
    mutationFn: (skillId: number) =>
      api.put(`/employees/${employee.id}`, { skill_ids: [...employee.skills.map((s) => s.skill_id), skillId] }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); setAddSkillId(''); setSkillError(null) },
    onError: (e: any) => setSkillError(e.response?.data?.detail || 'Ошибка при добавлении навыка'),
  })

  const removeSkillMutation = useMutation({
    mutationFn: (skillId: number) =>
      api.put(`/employees/${employee.id}`, { skill_ids: employee.skills.filter((s) => s.skill_id !== skillId).map((s) => s.skill_id) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); setSkillError(null) },
    onError: (e: any) => setSkillError(e.response?.data?.detail || 'Ошибка при удалении навыка'),
  })

  const availableSkills = allSkills.filter((s) => !employee.skills.some((es) => es.skill_id === s.id))

  return (
    <div>
      <p className="text-sm font-medium text-slate-800 mb-3">{employee.full_name}</p>
      {skillError && <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1 mb-2">{skillError}</p>}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {employee.skills.length === 0 && <span className="text-xs text-slate-400">Навыки не назначены</span>}
        {employee.skills.map((s) => (
          <span key={s.skill_id} className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs">
            {s.skill_name}
            <button onClick={() => removeSkillMutation.mutate(s.skill_id)} className="hover:text-red-600 ml-0.5">
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      {availableSkills.length > 0 && (
        <div className="flex gap-2">
          <select
            className="input text-sm flex-1"
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
              className="px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              {addSkillMutation.isPending ? '...' : 'ОК'}
            </button>
          )}
        </div>
      )}
      <div className="flex justify-end pt-4">
        <button onClick={onClose} className="btn-secondary">Закрыть</button>
      </div>
    </div>
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
  onViewShifts,
  onSkills,
  selected,
  onSelectToggle,
}: {
  emp: Employee
  expanded: boolean
  onToggle: () => void
  onEdit: (e: Employee) => void
  onDelete: (e: Employee) => void
  onShift: (e: Employee) => void
  onViewShifts: (e: Employee) => void
  onSkills: (e: Employee) => void
  selected: boolean
  onSelectToggle: () => void
}) {
  const qc = useQueryClient()
  const statusMutation = useMutation({
    mutationFn: (employment_status: string) => api.put(`/employees/${emp.id}`, { employment_status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees'] }),
  })

  return (
    <>
      <tr
        className={`border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer ${expanded ? 'bg-slate-50' : ''}`}
        onClick={onToggle}
      >
        <td className="px-4 py-3 w-6" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selected} onChange={onSelectToggle} className="rounded border-slate-300" />
        </td>
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
            <button onClick={() => onSkills(emp)} className="p-1.5 hover:bg-purple-50 rounded-lg text-slate-400 hover:text-purple-600" title="Навыки"><Award size={13} /></button>
            <button onClick={() => onShift(emp)} className="p-1.5 hover:bg-blue-50 rounded-lg text-slate-400 hover:text-blue-600" title="Поставить смены"><Clock4 size={13} /></button>
            <button onClick={() => onViewShifts(emp)} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700" title="Просмотреть смены"><Eye size={13} /></button>
            <button onClick={() => onEdit(emp)} className="p-1.5 hover:bg-blue-50 rounded-lg text-slate-400 hover:text-blue-600" title="Редактировать"><Pencil size={13} /></button>
            <button onClick={() => onDelete(emp)} className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-600" title="Удалить"><Trash2 size={13} /></button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-slate-100">
          <td colSpan={9} className="px-6 py-4 bg-slate-50">
            <div className="flex flex-wrap gap-10">
              {/* Контактная информация */}
              <div className="min-w-[220px]">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Контакты</p>
                <div className="space-y-1.5 text-sm">
                  {[['Email', emp.email], ['Телефон', emp.phone], ['Naumen', emp.naumen_login]].map(([label, val]) => (
                    <div key={label} className="flex gap-2 items-start">
                      <span className="text-slate-400 text-xs w-16 flex-shrink-0 mt-0.5">{label}:</span>
                      <span className="text-slate-700 font-mono text-xs break-all">{val || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Навыки */}
              <div className="min-w-[200px]">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Навыки</p>
                {emp.skills.length === 0 ? (
                  <p className="text-xs text-slate-400">Навыки не назначены</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 max-w-[260px]">
                    {emp.skills.map((s) => (
                      <span key={s.skill_id} className="badge-purple">{s.skill_name}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Статус занятости */}
              <div className="min-w-[180px]">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Статус занятости</p>
                <select
                  className="input text-sm"
                  value={emp.employment_status}
                  disabled={statusMutation.isPending}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => { e.stopPropagation(); statusMutation.mutate(e.target.value) }}
                >
                  <option value="new">Новый</option>
                  <option value="active">Работает</option>
                  <option value="fired">Уволен</option>
                </select>
              </div>

              {/* Быстрые действия — две колонки по два действия */}
              <div className="min-w-[300px]">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 text-center">Действия</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); onSkills(emp) }}
                      className="flex items-center gap-2 px-3 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-xs font-medium transition-colors"
                    >
                      <Award size={13} /> Навыки
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onEdit(emp) }}
                      className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors"
                    >
                      <Pencil size={13} /> Редактировать
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); onShift(emp) }}
                      className="flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-medium transition-colors"
                    >
                      <Clock4 size={13} /> Поставить смены
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onViewShifts(emp) }}
                      className="flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors"
                    >
                      <Eye size={13} /> Просмотреть смены
                    </button>
                  </div>
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

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'new', label: 'Новые' },
  { value: 'active', label: 'Работают' },
  { value: 'fired', label: 'Уволены' },
]

// ─── Главная страница сотрудников ────────────────────────────────────────────
export default function EmployeesPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(['new', 'active']))
  const [showForm, setShowForm] = useState(false)
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null)
  const [shiftEmployee, setShiftEmployee] = useState<Employee | null>(null)
  const [viewShiftsEmployee, setViewShiftsEmployee] = useState<Employee | null>(null)
  const [skillsEmployee, setSkillsEmployee] = useState<Employee | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<EmpSortKey>('full_name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [skillFilter, setSkillFilter] = useState<Set<number>>(new Set())
  const [skillFilterOpen, setSkillFilterOpen] = useState(false)
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkApplying, setBulkApplying] = useState(false)
  const skillFilterRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const { activeProject } = useProjectStore()

  useEffect(() => {
    if (!skillFilterOpen) return
    const handler = (e: MouseEvent) => {
      if (skillFilterRef.current && !skillFilterRef.current.contains(e.target as Node)) setSkillFilterOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [skillFilterOpen])

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['employees', activeProject?.customer_uuid, search],
    queryFn: () =>
      api.get('/employees', {
        params: {
          project_uuid: activeProject?.customer_uuid || undefined,
          search: search || undefined,
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

  const handleBulkStatusApply = async (ids: number[]) => {
    if (!bulkStatus || !ids.length) return
    setBulkApplying(true)
    try {
      for (const id of ids) {
        await api.put(`/employees/${id}`, { employment_status: bulkStatus })
      }
      qc.invalidateQueries({ queryKey: ['employees'] })
      setSelectedIds(new Set())
      setBulkStatus('')
    } finally {
      setBulkApplying(false)
    }
  }

  const handleSync = async () => {
    if (!activeProject) return
    const projectUuid = activeProject.customer_uuid
    setSyncing(true); setSyncResult(null)
    try {
      // Для крупного проекта (300+ операторов) синхронизация в Naumen может идти
      // несколько минут — backend запускает её в фоне и сразу отвечает, а мы
      // опрашиваем статус. Так не нужен длинный HTTP-таймаут и не держится поток.
      await api.post('/employees/sync-naumen', null, { params: { project_uuid: projectUuid } })

      while (true) {
        await new Promise((r) => setTimeout(r, 3000))
        const { data: job } = await api.get('/employees/sync-naumen/status', { params: { project_uuid: projectUuid } })
        if (job.status === 'done') {
          const { added, reactivated, fired_auto, deleted_stale, total_from_naumen, active_in_30d } = job.result
          setSyncResult(
            `Из Naumen получено: ${total_from_naumen}, активны за 30 дней: ${active_in_30d}. ` +
            `Добавлено: ${added}. Реактивировано: ${reactivated ?? 0}. Помечено уволенными: ${fired_auto}. ` +
            `Удалено (неактивны 3+ мес.): ${deleted_stale ?? 0}.`
          )
          qc.invalidateQueries({ queryKey: ['employees'] })
          break
        }
        if (job.status === 'error') {
          setSyncResult(`Ошибка: ${job.error}`)
          break
        }
        // status === 'running' — продолжаем опрос
      }
    } catch (e: any) {
      setSyncResult(`Ошибка: ${e.response?.data?.detail || e.message}`)
    } finally { setSyncing(false) }
  }

  const handleSort = (key: EmpSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const displayData = [...(data || []).filter((emp) => {
      if (statusFilter.size > 0 && !statusFilter.has(emp.employment_status)) return false
      if (skillFilter.size > 0) {
        const empSkillIds = new Set(emp.skills.map((s) => s.skill_id))
        for (const sid of skillFilter) if (!empSkillIds.has(sid)) return false
      }
      return true
    })]
    .sort((a, b) => {
      const av = (a as any)[sortKey] ?? ''
      const bv = (b as any)[sortKey] ?? ''
      const cmp = String(av).localeCompare(String(bv), 'ru')
      return sortDir === 'asc' ? cmp : -cmp
    })

  // Считаем новых от полного набора, а не от отфильтрованного вида — чтобы
  // кнопка «Активировать новых» всегда показывала реальное число и не «прыгала».
  const newEmployees = (data || []).filter((e) => e.employment_status === 'new')

  return (
    <div>
      <PageHeader
        title="Сотрудники"
        subtitle={`Всего: ${displayData.length}`}
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
        <QueueFilterDropdown
          queues={STATUS_OPTIONS.map((o) => o.value)}
          selected={statusFilter}
          onChange={setStatusFilter}
          label="Статус"
          allLabel="Все статусы"
          title="Фильтр по статусу"
          buttonWidthClass="w-44"
          itemLabel={(v) => STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v}
        />
        <div className="relative" ref={skillFilterRef}>
          <button
            onClick={() => setSkillFilterOpen((v) => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${skillFilter.size > 0 ? 'border-purple-200 bg-purple-50 text-purple-700' : 'border-slate-200 bg-white text-slate-600'}`}
          >
            <Filter size={14} />
            Навыки{skillFilter.size > 0 ? ` (${skillFilter.size})` : ''}
          </button>
          {skillFilterOpen && (
            <div className="absolute z-10 top-full mt-1 left-0 w-56 bg-white border border-slate-200 rounded-lg shadow-lg p-2 max-h-72 overflow-y-auto">
              {(allSkills || []).length === 0 && <p className="text-xs text-slate-400 px-2 py-1">Нет навыков</p>}
              {(allSkills || []).map((s) => (
                <label key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={skillFilter.has(s.id)}
                    onChange={() =>
                      setSkillFilter((prev) => {
                        const n = new Set(prev)
                        n.has(s.id) ? n.delete(s.id) : n.add(s.id)
                        return n
                      })
                    }
                    className="rounded border-slate-300"
                  />
                  {s.name}
                </label>
              ))}
              {skillFilter.size > 0 && (
                <button onClick={() => setSkillFilter(new Set())} className="w-full text-left text-xs text-slate-400 hover:text-slate-600 px-2 py-1.5 mt-1 border-t border-slate-100">
                  Очистить
                </button>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => {
            if (newEmployees.length === 0) return
            if (confirm(`Активировать всех новых сотрудников? (${newEmployees.length} чел.)`)) {
              handleBulkActivate(newEmployees.map((e) => e.id))
            }
          }}
          disabled={bulkActivating || newEmployees.length === 0}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-green-50"
        >
          {bulkActivating ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
          Активировать новых ({newEmployees.length})
        </button>
      </div>

      {selectedIds.size > 0 && (
        <div className="card p-3 mb-4 flex items-center gap-3 bg-brand-50 border-brand-100">
          <span className="text-sm font-medium text-slate-700">Выбрано: {selectedIds.size}</span>
          <select className="input w-44" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
            <option value="">Сменить статус...</option>
            <option value="new">Новый</option>
            <option value="active">Работает</option>
            <option value="fired">Уволен</option>
          </select>
          <button
            className="btn-secondary"
            disabled={!bulkStatus || bulkApplying}
            onClick={() => handleBulkStatusApply(displayData.filter((e) => selectedIds.has(e.id)).map((e) => e.id))}
          >
            {bulkApplying ? <Loader2 size={14} className="animate-spin" /> : null}
            Применить
          </button>
          <button className="text-sm text-slate-400 hover:text-slate-600" onClick={() => setSelectedIds(new Set())}>
            Отменить выбор
          </button>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <PageSpinner />
        ) : isError ? (
          <div className="p-8 flex items-center gap-4 bg-red-50">
            <AlertCircle size={20} className="text-red-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-red-800 font-medium">Не удалось загрузить список сотрудников</p>
              <p className="text-red-600 text-sm mt-0.5">{(error as any)?.response?.data?.detail || (error as any)?.message || 'Неизвестная ошибка'}</p>
            </div>
            <button className="btn-secondary" onClick={() => refetch()}><RefreshCw size={14} /> Повторить</button>
          </div>
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
                  <th className="w-6 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={displayData.length > 0 && displayData.every((e) => selectedIds.has(e.id))}
                      onChange={() =>
                        setSelectedIds((prev) => {
                          const allSelected = displayData.length > 0 && displayData.every((e) => prev.has(e.id))
                          if (allSelected) return new Set()
                          return new Set(displayData.map((e) => e.id))
                        })
                      }
                      className="rounded border-slate-300"
                    />
                  </th>
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
                    onViewShifts={setViewShiftsEmployee}
                    onSkills={setSkillsEmployee}
                    selected={selectedIds.has(emp.id)}
                    onSelectToggle={() =>
                      setSelectedIds((prev) => {
                        const n = new Set(prev)
                        n.has(emp.id) ? n.delete(emp.id) : n.add(emp.id)
                        return n
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && <Modal open title="Новый сотрудник" onClose={() => setShowForm(false)}><EmployeeForm onClose={() => setShowForm(false)} /></Modal>}
      {editEmployee && <Modal open title="Редактировать сотрудника" onClose={() => setEditEmployee(null)}><EmployeeForm employee={editEmployee} onClose={() => setEditEmployee(null)} /></Modal>}
      {shiftEmployee && <Modal open size="xl" title={`Смены: ${shiftEmployee.full_name}`} onClose={() => setShiftEmployee(null)}><ShiftAssignModal employee={shiftEmployee} projectUuid={activeProject?.customer_uuid} onClose={() => setShiftEmployee(null)} /></Modal>}
      {viewShiftsEmployee && <Modal open size="xl" title={`Смены (просмотр): ${viewShiftsEmployee.full_name}`} onClose={() => setViewShiftsEmployee(null)}><ShiftAssignModal employee={viewShiftsEmployee} readOnly onEdit={() => { const e = viewShiftsEmployee; setViewShiftsEmployee(null); setShiftEmployee(e) }} onClose={() => setViewShiftsEmployee(null)} /></Modal>}
      {skillsEmployee && (
        <Modal open title="Навыки сотрудника" onClose={() => setSkillsEmployee(null)}>
          <SkillsModal
            employee={(data || []).find((e) => e.id === skillsEmployee.id) || skillsEmployee}
            allSkills={allSkills || []}
            onClose={() => setSkillsEmployee(null)}
          />
        </Modal>
      )}
    </div>
  )
}

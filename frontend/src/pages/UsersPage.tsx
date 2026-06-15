import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, UserCog, Save, FolderOpen, X, ShieldCheck } from 'lucide-react'
import api from '@/api/client'
import type { User } from '@/types'
import { ROLE_LABELS } from '@/types'
import { useAuthStore } from '@/store/auth'
import { useProjectStore } from '@/store/project'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/common/EmptyState'

const ROLE_COLORS: Record<string, any> = {
  admin: 'red', project_manager: 'blue', analyst: 'purple',
  hr: 'green', customer: 'orange', viewer: 'gray',
}

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: 'Полный доступ ко всем функциям',
  project_manager: 'Доступ только к назначенным проектам',
  analyst: 'Просмотр аналитики по всем проектам',
  hr: 'HR-функции: сотрудники, смены, отчёты',
  customer: 'Ограниченный просмотр аналитики своих проектов',
  viewer: 'Только чтение: дашборд и аналитика',
}

const PROJECT_SCOPED_ROLES = new Set(['project_manager', 'customer'])

function ProjectAssignPanel({ userId, readOnly }: { userId: number; readOnly?: boolean }) {
  const qc = useQueryClient()
  const { projects } = useProjectStore()

  const { data: assigned = [], isLoading } = useQuery({
    queryKey: ['user-projects', userId],
    queryFn: () => api.get(`/users/${userId}/projects`).then((r) => r.data as { project_uuid: string }[]),
  })

  const assignMutation = useMutation({
    mutationFn: (project_uuid: string) => api.post(`/users/${userId}/projects`, { project_uuid }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-projects', userId] }),
  })
  const removeMutation = useMutation({
    mutationFn: (project_uuid: string) => api.delete(`/users/${userId}/projects/${project_uuid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-projects', userId] }),
  })

  const assignedSet = new Set(assigned.map((a) => a.project_uuid))
  const unassigned = projects.filter((p) => !assignedSet.has(p.customer_uuid))

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center gap-2">
        <FolderOpen size={14} className="text-slate-500" />
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Доступные проекты</p>
      </div>
      <div className="p-4">
        {isLoading ? (
          <p className="text-xs text-slate-400">Загрузка...</p>
        ) : (
          <>
            {assigned.length === 0 ? (
              <p className="text-xs text-slate-400 italic mb-3">Проекты не назначены — доступ закрыт</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {assigned.map((a) => {
                  const p = projects.find((pp) => pp.customer_uuid === a.project_uuid)
                  return (
                    <span key={a.project_uuid} className="inline-flex items-center gap-1.5 pl-2.5 pr-1 py-1 bg-brand-50 border border-brand-200 rounded-lg text-xs font-medium text-brand-800">
                      {p?.customer_name ?? a.project_uuid}
                      {!readOnly && (
                        <button onClick={() => removeMutation.mutate(a.project_uuid)}
                          className="text-brand-400 hover:text-red-500 transition-colors p-0.5 rounded">
                          <X size={11} />
                        </button>
                      )}
                    </span>
                  )
                })}
              </div>
            )}
            {!readOnly && unassigned.length > 0 && (
              <div>
                <p className="text-xs text-slate-400 mb-1.5">Добавить:</p>
                <div className="flex flex-wrap gap-1.5">
                  {unassigned.map((p) => (
                    <button key={p.customer_uuid} onClick={() => assignMutation.mutate(p.customer_uuid)}
                      className="text-xs bg-white border border-slate-200 hover:border-brand-300 hover:bg-brand-50 text-slate-600 hover:text-brand-700 px-2.5 py-1 rounded-lg transition-colors">
                      + {p.customer_name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function UserForm({ user, onClose }: { user?: User | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [savedUserId, setSavedUserId] = useState<number | null>(null)
  const [form, setForm] = useState({
    username: user?.username ?? '',
    email: user?.email ?? '',
    full_name: user?.full_name ?? '',
    role: user?.role ?? 'viewer',
    password: '',
    is_active: user?.is_active ?? true,
  })
  const [error, setError] = useState('')

  const effectiveUserId = user?.id ?? savedUserId

  const mutation = useMutation({
    mutationFn: (d: any) => user ? api.put(`/users/${user.id}`, d) : api.post('/users', d),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['users'] })
      if (!user) {
        setSavedUserId(res.data.id)
      } else {
        onClose()
      }
    },
    onError: (e: any) => setError(e.response?.data?.detail || 'Ошибка'),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const data: any = { ...form }
    if (!data.password) delete data.password
    mutation.mutate(data)
  }

  const isProjectScoped = PROJECT_SCOPED_ROLES.has(form.role)

  // If user was just created, show project assignment before closing
  if (savedUserId && !user) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
          <ShieldCheck size={18} className="text-green-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-800">Пользователь создан</p>
            <p className="text-xs text-green-600 mt-0.5">Назначьте проекты для роли «{ROLE_LABELS[form.role]}»</p>
          </div>
        </div>
        {isProjectScoped && <ProjectAssignPanel userId={savedUserId} />}
        <div className="flex justify-end">
          <button onClick={onClose} className="btn-primary">Готово</button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>}

      {/* Основные данные */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Данные аккаунта</p>
        </div>
        <div className="p-4 grid grid-cols-2 gap-4">
          <div>
            <label className="label">Логин *</label>
            <input className="input" value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required disabled={!!user} placeholder="login123" />
          </div>
          <div>
            <label className="label">Email *</label>
            <input className="input" type="email" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required placeholder="user@example.com" />
          </div>
          <div className="col-span-2">
            <label className="label">Полное имя</label>
            <input className="input" value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              placeholder="Иванов Иван Иванович" />
          </div>
          <div>
            <label className="label">{user ? 'Новый пароль' : 'Пароль *'}</label>
            <input className="input" type="password" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required={!user} placeholder={user ? 'Оставьте пустым' : '••••••••'} />
          </div>
          <div className="flex items-end pb-0.5">
            <label className="flex items-center gap-2.5 cursor-pointer group">
              <div
                onClick={() => setForm({ ...form, is_active: !form.is_active })}
                className={`w-10 h-5 rounded-full transition-colors cursor-pointer flex-shrink-0 ${form.is_active ? 'bg-green-500' : 'bg-slate-300'}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full shadow mt-0.5 transition-transform ${form.is_active ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-sm text-slate-700">Активен</span>
            </label>
          </div>
        </div>
      </div>

      {/* Роль */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Роль и права</p>
        </div>
        <div className="p-4 space-y-3">
          {Object.entries(ROLE_LABELS).map(([role, label]) => (
            <label key={role} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
              form.role === role
                ? 'border-brand-300 bg-brand-50'
                : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'
            }`}>
              <input type="radio" name="role" value={role} checked={form.role === role}
                onChange={() => setForm({ ...form, role: role as any })}
                className="mt-0.5 accent-brand-600" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">{label}</span>
                  <Badge label={label} color={ROLE_COLORS[role]} />
                  {PROJECT_SCOPED_ROLES.has(role) && (
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <FolderOpen size={10} /> только свои проекты
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{ROLE_DESCRIPTIONS[role]}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Project assignment for existing project-scoped users */}
      {effectiveUserId && isProjectScoped && (
        <ProjectAssignPanel userId={effectiveUserId} />
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-secondary">Отмена</button>
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          <Save size={14} /> {mutation.isPending ? 'Сохраняем...' : 'Сохранить'}
        </button>
      </div>
    </form>
  )
}

export default function UsersPage() {
  const [showForm, setShowForm] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const { user: me } = useAuthStore()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data as User[]),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  return (
    <div>
      <PageHeader
        title="Пользователи"
        subtitle="Управление доступом к WFM-платформе"
        actions={
          me?.role === 'admin'
            ? <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> Добавить</button>
            : undefined
        }
      />

      <div className="card overflow-hidden">
        {isLoading ? <PageSpinner /> : !data?.length ? (
          <EmptyState title="Нет пользователей" icon={<UserCog size={40} />} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                {['Логин', 'Имя', 'Email', 'Роль', 'Статус', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{u.username}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{u.full_name || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{u.email}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Badge label={ROLE_LABELS[u.role] || u.role} color={ROLE_COLORS[u.role]} />
                      {PROJECT_SCOPED_ROLES.has(u.role) && <FolderOpen size={12} className="text-slate-400" />}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge label={u.is_active ? 'Активен' : 'Отключён'} color={u.is_active ? 'green' : 'gray'} />
                  </td>
                  <td className="px-4 py-3">
                    {me?.role === 'admin' && (
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => setEditUser(u)}
                          className="p-1.5 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600">
                          <Pencil size={12} />
                        </button>
                        {u.id !== me?.id && (
                          <button
                            onClick={() => confirm('Удалить пользователя?') && deleteMutation.mutate(u.id)}
                            className="p-1.5 hover:bg-red-50 rounded text-slate-400 hover:text-red-600">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <Modal open title="Новый пользователь" onClose={() => setShowForm(false)} size="lg">
          <UserForm onClose={() => setShowForm(false)} />
        </Modal>
      )}
      {editUser && (
        <Modal open title="Редактировать пользователя" onClose={() => setEditUser(null)} size="lg">
          <UserForm user={editUser} onClose={() => setEditUser(null)} />
        </Modal>
      )}
    </div>
  )
}

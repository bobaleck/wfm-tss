import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, UserCog, Save } from 'lucide-react'
import api from '@/api/client'
import type { User } from '@/types'
import { ROLE_LABELS } from '@/types'
import { useAuthStore } from '@/store/auth'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/common/EmptyState'

const ROLE_COLORS: Record<string, any> = { admin: 'red', manager: 'blue', analyst: 'purple', viewer: 'gray' }

function UserForm({ user, onClose }: { user?: User | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    username: user?.username ?? '', email: user?.email ?? '',
    full_name: user?.full_name ?? '', role: user?.role ?? 'viewer',
    password: '', is_active: user?.is_active ?? true,
  })
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: (d: any) => user ? api.put(`/users/${user.id}`, d) : api.post('/users', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail || 'Ошибка'),
  })
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const data: any = { ...form }
    if (!data.password) delete data.password
    mutation.mutate(data)
  }
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-4">
        <div><label className="label">Логин *</label><input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required disabled={!!user} /></div>
        <div><label className="label">Email *</label><input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
        <div className="col-span-2"><label className="label">Полное имя</label><input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
        <div>
          <label className="label">Роль</label>
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as any })}>
            {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{user ? 'Новый пароль' : 'Пароль *'}</label>
          <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!user} placeholder={user ? 'Оставьте пустым' : ''} />
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <input type="checkbox" id="ua" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          <label htmlFor="ua" className="text-sm text-slate-700">Активен</label>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Отмена</button>
        <button type="submit" className="btn-primary" disabled={mutation.isPending}><Save size={14} /> Сохранить</button>
      </div>
    </form>
  )
}

export default function UsersPage() {
  const [showForm, setShowForm] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const { user: me } = useAuthStore()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users').then((r) => r.data as User[]) })
  const deleteMutation = useMutation({ mutationFn: (id: number) => api.delete(`/users/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }) })
  return (
    <div>
      <PageHeader title="Пользователи" subtitle="Управление доступом к WFM-платформе"
        actions={me?.role === 'admin' ? <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> Добавить</button> : undefined} />
      <div className="card overflow-hidden">
        {isLoading ? <PageSpinner /> : !data?.length ? (
          <EmptyState title="Нет пользователей" icon={<UserCog size={40} />} />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-100">
              {['Логин', 'Имя', 'Email', 'Роль', 'Статус', ''].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr></thead>
            <tbody>{data.map((u) => (
              <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs text-slate-700">{u.username}</td>
                <td className="px-4 py-3 font-medium text-slate-900">{u.full_name || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3"><Badge label={ROLE_LABELS[u.role] || u.role} color={ROLE_COLORS[u.role]} /></td>
                <td className="px-4 py-3"><Badge label={u.is_active ? 'Активен' : 'Отключён'} color={u.is_active ? 'green' : 'gray'} /></td>
                <td className="px-4 py-3">
                  {me?.role === 'admin' && (
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setEditUser(u)} className="p-1.5 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600"><Pencil size={12} /></button>
                      {u.id !== me?.id && <button onClick={() => confirm('Удалить?') && deleteMutation.mutate(u.id)} className="p-1.5 hover:bg-red-50 rounded text-slate-400 hover:text-red-600"><Trash2 size={12} /></button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {showForm && <Modal open title="Новый пользователь" onClose={() => setShowForm(false)}><UserForm onClose={() => setShowForm(false)} /></Modal>}
      {editUser && <Modal open title="Редактировать пользователя" onClose={() => setEditUser(null)}><UserForm user={editUser} onClose={() => setEditUser(null)} /></Modal>}
    </div>
  )
}

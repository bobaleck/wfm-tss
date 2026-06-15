import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth'
import { useNavigate } from 'react-router-dom'
import api from '@/api/client'
import PageHeader from '@/components/common/PageHeader'
import { Save, Eye, EyeOff, Shield, Users, Plug, ScrollText, LogOut, Trash2, Plus } from 'lucide-react'

type Tab = 'profile' | 'statuses'

interface StatusConfig {
  id: number
  status_name: string
  classification: 'work' | 'pause' | 'offline'
  label: string | null
}

const CLASS_LABELS: Record<string, string> = {
  work: 'В линии',
  pause: 'На паузе',
  offline: 'Вышли',
}
const CLASS_COLORS: Record<string, string> = {
  work: 'text-green-700 bg-green-50 border-green-200',
  pause: 'text-amber-700 bg-amber-50 border-amber-200',
  offline: 'text-slate-600 bg-slate-50 border-slate-200',
}

function StatusConfigTab() {
  const qc = useQueryClient()
  const [newName, setNewName] = useState('')
  const [newClass, setNewClass] = useState<'work' | 'pause' | 'offline'>('pause')
  const [newLabel, setNewLabel] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [editClass, setEditClass] = useState<'work' | 'pause' | 'offline'>('pause')
  const [editLabel, setEditLabel] = useState('')
  const [addErr, setAddErr] = useState('')

  const { data: configs, isLoading } = useQuery({
    queryKey: ['status-configs'],
    queryFn: () => api.get('/status-configs').then((r) => r.data as StatusConfig[]),
  })

  const upsertMut = useMutation({
    mutationFn: ({ name, classification, label }: { name: string; classification: string; label: string }) =>
      api.put(`/status-configs/${encodeURIComponent(name)}`, { classification, label: label || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['status-configs'] }); setEditId(null) },
  })

  const deleteMut = useMutation({
    mutationFn: (name: string) => api.delete(`/status-configs/${encodeURIComponent(name)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['status-configs'] }),
  })

  const handleAdd = () => {
    const name = newName.trim()
    if (!name) { setAddErr('Введите название статуса'); return }
    setAddErr('')
    upsertMut.mutate({ name, classification: newClass, label: newLabel.trim() }, {
      onSuccess: () => { setNewName(''); setNewLabel('') },
    })
  }

  const startEdit = (cfg: StatusConfig) => {
    setEditId(cfg.id)
    setEditClass(cfg.classification)
    setEditLabel(cfg.label || '')
  }

  const saveEdit = (cfg: StatusConfig) => {
    upsertMut.mutate({ name: cfg.status_name, classification: editClass, label: editLabel.trim() })
  }

  return (
    <div className="space-y-6">
      {/* Reference */}
      <div className="card p-5">
        <h3 className="font-semibold text-slate-900 mb-1">Стандартные статусы</h3>
        <p className="text-xs text-slate-400 mb-3">Встроенная классификация, не требует настройки</p>
        <div className="space-y-1 text-xs">
          {[
            ['В линии', 'normal, ready, available, ringing, speaking, inservice, ringing#voice, speaking#voice, wrapup, wrapup#voice, acw'],
            ['На паузе', 'break, lunch, training, busy'],
            ['Вышли', 'offline, logged_out, signedoff, loggedoff, disconnected, away, notavailable, not_available'],
          ].map(([cls, list]) => (
            <div key={cls} className="flex gap-2 items-start">
              <span className="w-20 flex-shrink-0 font-medium text-slate-600">{cls}:</span>
              <span className="text-slate-400 font-mono">{list}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Custom configs */}
      <div className="card p-5">
        <h3 className="font-semibold text-slate-900 mb-1">Пользовательские статусы</h3>
        <p className="text-xs text-slate-400 mb-4">
          Укажите как классифицировать нестандартные статусы (например, Custom1, Custom2 и т.д.).
          Это влияет на Live-мониторинг и историю смен.
        </p>

        {/* Add new */}
        <div className="border border-slate-200 rounded-xl p-4 mb-4 bg-slate-50">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Добавить статус</p>
          {addErr && <p className="text-xs text-red-600 mb-2">{addErr}</p>}
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-36">
              <label className="label">Статус Naumen</label>
              <input className="input font-mono" placeholder="Custom1" value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()} />
            </div>
            <div className="w-36">
              <label className="label">Считать как</label>
              <select className="input" value={newClass}
                onChange={(e) => setNewClass(e.target.value as any)}>
                <option value="work">В линии</option>
                <option value="pause">На паузе</option>
                <option value="offline">Вышли</option>
              </select>
            </div>
            <div className="flex-1 min-w-32">
              <label className="label">Метка (необязательно)</label>
              <input className="input" placeholder="Перерыв тип 1" value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)} />
            </div>
            <button type="button" onClick={handleAdd} disabled={upsertMut.isPending}
              className="btn-primary gap-1.5 mb-0.5">
              <Plus size={14} /> Добавить
            </button>
          </div>
        </div>

        {/* List */}
        {isLoading ? (
          <p className="text-sm text-slate-400 py-4 text-center">Загрузка...</p>
        ) : !configs?.length ? (
          <p className="text-sm text-slate-400 py-6 text-center">Нет настроенных статусов.<br/>Все нераспознанные статусы считаются «На паузе».</p>
        ) : (
          <div className="space-y-2">
            {configs.map((cfg) => (
              <div key={cfg.id} className="flex items-center gap-3 p-3 bg-white border border-slate-100 rounded-xl">
                <span className="font-mono text-sm text-slate-800 w-28 flex-shrink-0">{cfg.status_name}</span>

                {editId === cfg.id ? (
                  <>
                    <select className="input w-32" value={editClass}
                      onChange={(e) => setEditClass(e.target.value as any)}>
                      <option value="work">В линии</option>
                      <option value="pause">На паузе</option>
                      <option value="offline">Вышли</option>
                    </select>
                    <input className="input flex-1" placeholder="Метка (необязательно)" value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)} />
                    <button type="button" onClick={() => saveEdit(cfg)} disabled={upsertMut.isPending}
                      className="btn-primary text-xs px-3 py-1.5">Сохранить</button>
                    <button type="button" onClick={() => setEditId(null)}
                      className="btn-secondary text-xs px-3 py-1.5">Отмена</button>
                  </>
                ) : (
                  <>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${CLASS_COLORS[cfg.classification]}`}>
                      {CLASS_LABELS[cfg.classification]}
                    </span>
                    {cfg.label && <span className="text-sm text-slate-500 flex-1 truncate">{cfg.label}</span>}
                    <div className="ml-auto flex gap-1">
                      <button type="button" onClick={() => startEdit(cfg)}
                        className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 text-xs">
                        Изменить
                      </button>
                      <button type="button" onClick={() => deleteMut.mutate(cfg.status_name)}
                        className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-600">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const { user, fetchMe, logout } = useAuthStore()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('profile')

  // ─── Профиль ──────────────────────────────────────────────────────────────
  const [profile, setProfile] = useState({
    full_name: user?.full_name || '',
    email: user?.email || '',
  })
  const [password, setPassword] = useState({ current: '', next: '', confirm: '' })
  const [showPass, setShowPass] = useState(false)
  const [profileMsg, setProfileMsg] = useState('')
  const [profileErr, setProfileErr] = useState('')
  const [passMsg, setPassMsg] = useState('')
  const [passErr, setPassErr] = useState('')

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileMsg(''); setProfileErr('')
    try {
      await api.put(`/users/${user!.id}`, { full_name: profile.full_name, email: profile.email })
      await fetchMe()
      setProfileMsg('Профиль обновлён')
    } catch (e: any) { setProfileErr(e.response?.data?.detail || 'Ошибка') }
  }

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPassMsg(''); setPassErr('')
    if (!password.next) { setPassErr('Введите новый пароль'); return }
    if (password.next !== password.confirm) { setPassErr('Пароли не совпадают'); return }
    try {
      await api.put(`/users/${user!.id}`, { password: password.next })
      await fetchMe()
      setPassMsg('Пароль изменён')
      setPassword({ current: '', next: '', confirm: '' })
    } catch (e: any) { setPassErr(e.response?.data?.detail || 'Ошибка') }
  }

  const handleLogout = () => { logout(); navigate('/login', { replace: true }) }

  const isAdmin = user?.role === 'admin'

  const TABS: { key: Tab; label: string }[] = [
    { key: 'profile', label: 'Профиль' },
    { key: 'statuses', label: 'Статусы' },
  ]

  return (
    <div>
      <PageHeader title="Настройки" subtitle="Профиль и параметры учётной записи" />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.key
                ? 'border-brand-500 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'statuses' && <StatusConfigTab />}

      {tab === 'profile' && (
        <div className="max-w-2xl space-y-6">
          {/* Профиль */}
          <form onSubmit={saveProfile} className="card p-6 space-y-4">
            <h2 className="font-semibold text-slate-900">Мой профиль</h2>
            {profileMsg && <div className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">{profileMsg}</div>}
            {profileErr && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{profileErr}</div>}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Логин</label>
                <input className="input bg-slate-50" value={user?.username} disabled />
              </div>
              <div>
                <label className="label">Роль</label>
                <input className="input bg-slate-50" value={user?.role} disabled />
              </div>
              <div className="col-span-2">
                <label className="label">Полное имя</label>
                <input className="input" value={profile.full_name} onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className="label">Email</label>
                <input className="input" type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
              </div>
            </div>
            <button type="submit" className="btn-primary"><Save size={15} /> Сохранить профиль</button>
          </form>

          {/* Смена пароля */}
          <form onSubmit={savePassword} className="card p-6 space-y-4">
            <h2 className="font-semibold text-slate-900">Смена пароля</h2>
            {passMsg && <div className="text-sm text-green-600 bg-green-50 rounded-lg px-3 py-2">{passMsg}</div>}
            {passErr && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{passErr}</div>}
            <div>
              <label className="label">Новый пароль</label>
              <div className="relative">
                <input
                  className="input pr-10"
                  type={showPass ? 'text' : 'password'}
                  value={password.next}
                  onChange={(e) => setPassword({ ...password, next: e.target.value })}
                  placeholder="Минимум 6 символов"
                />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            {password.next && (
              <div>
                <label className="label">Подтверждение</label>
                <input className="input" type="password" value={password.confirm} onChange={(e) => setPassword({ ...password, confirm: e.target.value })} />
              </div>
            )}
            <button type="submit" className="btn-primary" disabled={!password.next}><Shield size={15} /> Изменить пароль</button>
          </form>

          {/* Ссылки для администратора */}
          {isAdmin && (
            <div className="card p-6 space-y-3">
              <h2 className="font-semibold text-slate-900">Администрирование</h2>
              <p className="text-sm text-slate-500">Разделы, доступные только администратору системы</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Пользователи', icon: <Users size={15} />, path: '/users', desc: 'Управление учётными записями и ролями' },
                  { label: 'Интеграции', icon: <Plug size={15} />, path: '/integrations', desc: 'Подключение к Naumen PostgreSQL и API' },
                  { label: 'Журнал событий', icon: <ScrollText size={15} />, path: '/journal', desc: 'Лог действий пользователей в системе' },
                ].map((item) => (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    className="flex gap-3 p-3 rounded-xl border border-slate-200 hover:border-brand-300 hover:bg-brand-50 text-left transition-colors group"
                  >
                    <span className="text-slate-400 group-hover:text-brand-600 mt-0.5">{item.icon}</span>
                    <div>
                      <p className="text-sm font-medium text-slate-800 group-hover:text-brand-700">{item.label}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{item.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Выход */}
          <div className="card p-6">
            <h2 className="font-semibold text-slate-900 mb-2">Сессия</h2>
            <p className="text-sm text-slate-500 mb-4">
              Вы вошли как <span className="font-medium text-slate-700">{user?.username}</span> · роль: {user?.role}
            </p>
            <button onClick={handleLogout} className="flex items-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-sm font-medium transition-colors">
              <LogOut size={15} /> Выйти из системы
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

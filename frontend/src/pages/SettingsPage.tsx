import { useState } from 'react'
import { useAuthStore } from '@/store/auth'
import { useNavigate } from 'react-router-dom'
import api from '@/api/client'
import PageHeader from '@/components/common/PageHeader'
import { Save, Eye, EyeOff, Shield, Users, Plug, ScrollText, LogOut } from 'lucide-react'

export default function SettingsPage() {
  const { user, fetchMe, logout } = useAuthStore()
  const navigate = useNavigate()

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

  return (
    <div>
      <PageHeader title="Настройки" subtitle="Профиль и параметры учётной записи" />

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
    </div>
  )
}

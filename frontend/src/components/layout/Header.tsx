import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, ChevronDown, User } from 'lucide-react'
import { useAuthStore } from '@/store/auth'
import { useProjectStore } from '@/store/project'
import { ROLE_LABELS } from '@/types'

export default function Header() {
  const { user, logout } = useAuthStore()
  const { activeProject, projects, fetchProjects, setActiveProject } = useProjectStore()
  const navigate = useNavigate()
  const [dropdownOpen, setDropdownOpen] = useState(false)

  useEffect(() => {
    fetchProjects()
  }, [])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 flex-shrink-0">
      {/* Project selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">Проект:</span>
        {projects.length > 0 ? (
          <div className="relative">
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 hover:text-brand-600 transition-colors"
            >
              {activeProject?.customer_name ?? 'Выберите проект'}
              <ChevronDown size={14} className={`transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {dropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
                <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 min-w-[220px] py-1 max-h-72 overflow-y-auto">
                  {projects.map((p) => (
                    <button
                      key={p.customer_uuid}
                      onClick={() => { setActiveProject(p); setDropdownOpen(false) }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 transition-colors
                        ${activeProject?.customer_uuid === p.customer_uuid ? 'text-brand-600 font-medium bg-brand-50' : 'text-slate-700'}`}
                    >
                      <p className="font-medium">{p.customer_name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {p.active_incoming_count} вх / {p.active_outcoming_count} исх
                      </p>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <span className="text-sm text-slate-400 italic">Интеграция не настроена</span>
        )}
      </div>

      {/* User menu */}
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="text-sm font-medium text-slate-800">{user?.full_name || user?.username}</p>
          <p className="text-xs text-slate-400">{user?.role ? ROLE_LABELS[user.role] : ''}</p>
        </div>
        <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center">
          <User size={16} className="text-brand-600" />
        </div>
        <button
          onClick={handleLogout}
          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
          title="Выйти"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  )
}

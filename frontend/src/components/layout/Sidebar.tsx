import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  LayoutDashboard, Users, UsersRound, Star, BarChart3, TrendingUp,
  UserCheck, Calendar, CalendarOff, Clock4, FileBarChart2, Settings2,
  UserCog, ScrollText, Plug, Info, BookOpen, ChevronDown, ChevronRight,
  PhoneCall, Clock, UsersIcon, Radio, FolderOpen,
} from 'lucide-react'

interface NavItem {
  label: string
  icon: React.ReactNode
  to?: string
  children?: NavItem[]
}

const nav: NavItem[] = [
  { label: 'Сводка', icon: <LayoutDashboard size={18} />, to: '/dashboard' },
  {
    label: 'Команда',
    icon: <Users size={18} />,
    children: [
      { label: 'Сотрудники', icon: <UserCheck size={16} />, to: '/team/employees' },
      { label: 'Команды',    icon: <UsersRound size={16} />, to: '/team/teams' },
      { label: 'Навыки',     icon: <Star size={16} />,      to: '/team/skills' },
    ],
  },
  {
    label: 'Аналитика',
    icon: <BarChart3 size={18} />,
    children: [
      { label: 'Очереди',           icon: <PhoneCall size={16} />,    to: '/analytics/queues' },
      { label: 'Нагрузка',          icon: <TrendingUp size={16} />,   to: '/analytics/workload' },
      { label: 'Нагр. операторов',  icon: <UserCheck size={16} />,    to: '/analytics/operator-load' },
      { label: 'Внутридневная',     icon: <Clock size={16} />,         to: '/analytics/intraday' },
      { label: 'Потребность',       icon: <UsersIcon size={16} />,     to: '/analytics/staffing' },
      { label: 'Онлайн',            icon: <Radio size={16} />,         to: '/analytics/live' },
    ],
  },
  {
    label: 'Рабочее время',
    icon: <Clock4 size={18} />,
    children: [
      { label: 'Графики',    icon: <Calendar size={16} />,    to: '/worktime/schedules' },
      { label: 'Отсутствия', icon: <CalendarOff size={16} />, to: '/worktime/absences' },
      { label: 'Смены',      icon: <Clock4 size={16} />,      to: '/worktime/shifts' },
    ],
  },
]

const bottom: NavItem[] = [
  { label: 'Отчёты',        icon: <FileBarChart2 size={18} />, to: '/reports' },
  {
    label: 'Настройки',
    icon: <Settings2 size={18} />,
    children: [
      { label: 'Общие',    icon: <Settings2 size={16} />,    to: '/settings' },
      { label: 'Проекты',  icon: <FolderOpen size={16} />,   to: '/settings/projects' },
    ],
  },
  { label: 'Пользователи',  icon: <UserCog size={18} />,      to: '/users' },
  { label: 'Журнал',        icon: <ScrollText size={18} />,   to: '/journal' },
  { label: 'Интеграции',    icon: <Plug size={18} />,         to: '/integrations' },
  { label: 'О системе',     icon: <Info size={18} />,         to: '/about' },
  { label: 'Документация',  icon: <BookOpen size={18} />,     to: '/docs' },
]

function pathMatches(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(to + '/')
}

function NavSection({ item }: { item: NavItem }) {
  const location = useLocation()
  const isChildActive = item.children?.some((c) => c.to && pathMatches(location.pathname, c.to))
  const [open, setOpen] = useState(isChildActive ?? false)

  if (item.to) {
    return (
      <NavLink
        to={item.to}
        end
        className={({ isActive }) =>
          clsx('sidebar-item', isActive && 'active')
        }
      >
        <span className="flex-shrink-0">{item.icon}</span>
        <span>{item.label}</span>
      </NavLink>
    )
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={clsx('sidebar-item w-full', isChildActive && 'text-white')}
      >
        <span className="flex-shrink-0">{item.icon}</span>
        <span className="flex-1 text-left">{item.label}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l border-white/10 pl-3">
          {item.children?.map((child) => (
            <NavLink
              key={child.to}
              to={child.to!}
              end
              className={({ isActive }) =>
                clsx('sidebar-item text-xs', isActive && 'active')
              }
            >
              <span className="flex-shrink-0">{child.icon}</span>
              <span>{child.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Sidebar() {
  return (
    <aside className="flex flex-col w-60 min-h-screen bg-sidebar-bg border-r border-white/5">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-white/5">
        <img src="/favicon.svg" alt="" className="h-8 w-auto flex-shrink-0" />
        <div>
          <p className="text-white text-sm font-semibold leading-none">WFM</p>
          <p className="text-sidebar-text text-xs mt-0.5">Телесейлз-Сервис</p>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {nav.map((item) => (
          <NavSection key={item.label} item={item} />
        ))}
      </nav>

      {/* Bottom nav */}
      <div className="p-3 border-t border-white/5 space-y-0.5">
        {bottom.map((item) => (
          <NavSection key={item.label} item={item} />
        ))}
      </div>
    </aside>
  )
}

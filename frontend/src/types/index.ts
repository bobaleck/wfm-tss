export interface User {
  id: number
  username: string
  email: string
  full_name: string | null
  role: 'admin' | 'manager' | 'analyst' | 'viewer'
  active_project_uuid: string | null
  is_active: boolean
  is_superuser: boolean
  created_at: string
}

export interface Project {
  customer_uuid: string
  customer_name: string
  customer_type: string
  active_projects_count: number
  active_incoming_count: number
  active_outcoming_count: number
  responsible_manager?: string
}

export type EmploymentStatus = 'new' | 'active' | 'fired'
export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  new: 'Новый',
  active: 'Работает',
  fired: 'Уволен',
}
export const SCHEDULE_OPTIONS = ['2/2', '5/2', '7/7', 'Гибкий'] as const
export type PreferredSchedule = typeof SCHEDULE_OPTIONS[number]

export interface Employee {
  id: number
  full_name: string
  preferred_schedule: string | null
  employment_status: EmploymentStatus
  project_uuid: string | null
  team_id: number | null
  team_name: string | null
  position: string | null
  naumen_login: string | null
  employee_uuid: string | null
  phone: string | null
  email: string | null
  is_active: boolean
  created_at: string
  skills: EmployeeSkill[]
}

export interface EmployeeSkill {
  skill_id: number
  skill_name: string
  level: number
}

export type TeamType = 'group' | 'department' | 'division'
export const TEAM_TYPE_LABELS: Record<TeamType, string> = {
  group: 'Группа операторов',
  department: 'Отдел',
  division: 'Управление',
}

export interface Team {
  id: number
  name: string
  project_uuid: string | null
  parent_id: number | null
  parent_name: string | null
  team_type: TeamType
  leader_id: number | null
  leader_name: string | null
  description: string | null
  created_at: string
  employee_count: number
  children?: Team[]
}

export interface Skill {
  id: number
  name: string
  code: string | null
  description: string | null
  project_uuid: string | null
  created_at: string
  employee_count: number
}

export interface Schedule {
  id: number
  name: string
  project_uuid: string | null
  schedule_type: string
  work_start: string | null
  work_end: string | null
  break_duration: number
  days_of_week: string
  description: string | null
  created_at: string
}

export interface Shift {
  id: number
  employee_id: number
  employee_name: string | null
  schedule_id: number | null
  schedule_name: string | null
  shift_date: string
  start_time: string | null
  end_time: string | null
  status: string
  notes: string | null
  actual_start_time: string | null
  actual_end_time: string | null
  actual_hours_worked: string | null
  needs_review: boolean
  reconciled_at: string | null
  created_at: string
}

export interface Absence {
  id: number
  employee_id: number
  employee_name: string | null
  absence_type: string
  start_date: string
  end_date: string
  approved: boolean
  notes: string | null
  created_at: string
}

export interface Queue {
  queue_uuid: string
  name: string
  channel: string
  target_sl: number | null
  answer_sec: number | null
  status: string
}

export interface WorkloadRow {
  period_start: string
  queue_name: string
  total: number
  handled: number
  lost: number
  avg_talk_sec: number | null
  sl_percent: number | null
}

export interface OperatorSession {
  login: string
  employee_name: string | null
  work_date: string
  first_login: string | null
  last_logout: string | null
  total_sec: number | null
  normal_sec: number | null
  non_normal_sec: number | null
  break_count: number | null
  statuses_seen: string | null
}

export interface OperatorLoadRow {
  login: string
  employee_name: string | null
  position: string | null
  handled_calls: number
  avg_talk_sec: number | null
  total_talk_sec: number | null
  avg_answer_sec: number | null
  sl_percent: number | null
}

export interface IntegrationSettings {
  db_host: string | null
  db_name: string | null
  db_user: string | null
  db_port: number | null
  api_base_url: string | null
  api_username: string | null
  has_password: boolean
  has_api_key: boolean
  is_active: boolean
}

export type UserRole = 'admin' | 'manager' | 'analyst' | 'viewer'
export const ROLE_LABELS: Record<UserRole, string> = {
  admin:   'Администратор',
  manager: 'Менеджер',
  analyst: 'Аналитик',
  viewer:  'Читатель',
}

export const ABSENCE_TYPES: Record<string, string> = {
  vacation: 'Отпуск',
  sick:     'Больничный',
  personal: 'Личные обстоятельства',
  training: 'Обучение',
  other:    'Другое',
}

export const SHIFT_STATUSES: Record<string, string> = {
  planned:   'Запланирована',
  confirmed: 'Подтверждена',
  completed: 'Завершена',
  cancelled: 'Отменена',
}

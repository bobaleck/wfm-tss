import type { Employee } from '@/types'
import { EMPLOYMENT_STATUS_LABELS } from '@/types'
import Badge from '@/components/ui/Badge'

const STATUS_COLORS: Record<string, 'green' | 'blue' | 'gray'> = {
  active: 'green', new: 'blue', fired: 'gray',
}

// Информационная панель сотрудника — то же содержимое, что раскрывается в
// разделе «Сотрудники», но без интерактивных действий. Используется в
// «Командах» при раскрытии участника.
export default function EmployeeDetailPanel({ emp }: { emp: Employee }) {
  return (
    <div className="flex flex-wrap gap-10">
      {/* Сводка */}
      <div className="min-w-[200px]">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Сотрудник</p>
        <div className="text-sm space-y-1.5">
          <p className="font-medium text-slate-900">{emp.full_name}</p>
          <Badge
            label={EMPLOYMENT_STATUS_LABELS[emp.employment_status] ?? emp.employment_status}
            color={STATUS_COLORS[emp.employment_status] ?? 'gray'}
          />
          <div className="text-xs text-slate-500 space-y-0.5 pt-1">
            <p>Должность: <span className="text-slate-700">{emp.position || '—'}</span></p>
            <p>Команда: <span className="text-slate-700">{emp.team_name || '—'}</span></p>
            <p>График: <span className="text-slate-700">{emp.preferred_schedule || '—'}</span></p>
          </div>
        </div>
      </div>

      {/* Контакты */}
      <div className="min-w-[220px]">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Контакты</p>
        <div className="space-y-1.5 text-sm">
          {([['Email', emp.email], ['Телефон', emp.phone], ['Naumen', emp.naumen_login]] as const).map(([label, val]) => (
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
    </div>
  )
}

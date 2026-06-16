import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, RefreshCw, Save, Tag } from 'lucide-react'
import api from '@/api/client'
import { useProjectStore } from '@/store/project'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import { STANDARD_LABEL, type StatusGroup } from '@/utils/statusClassification'

const GROUP_LABEL: Record<StatusGroup, string> = { work: 'В линии', pause: 'На паузе', offline: 'Вышли' }
const GROUP_BADGE: Record<StatusGroup, string> = {
  work: 'bg-green-100 text-green-700',
  pause: 'bg-amber-100 text-amber-700',
  offline: 'bg-slate-100 text-slate-500',
}

interface DiscoveredStatus {
  status_name: string
  is_standard: boolean
  standard_group: StatusGroup | null
  classification: StatusGroup | null
  label: string | null
}

export default function StatusesPage() {
  const { activeProject } = useProjectStore()
  const qc = useQueryClient()
  const [edits, setEdits] = useState<Record<string, { label: string; classification: StatusGroup }>>({})

  const { data: discovered, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['status-discover', activeProject?.customer_uuid],
    queryFn: () =>
      api.get(`/status-configs/${activeProject!.customer_uuid}/discover`)
        .then((r) => r.data.data as DiscoveredStatus[]),
    enabled: !!activeProject,
  })

  const standardList = useMemo(() => (discovered || []).filter((d) => d.is_standard), [discovered])
  const customList = useMemo(() => (discovered || []).filter((d) => !d.is_standard), [discovered])

  const saveMutation = useMutation({
    mutationFn: (item: { status_name: string; classification: StatusGroup; label: string | null }) =>
      api.put(`/status-configs/${activeProject!.customer_uuid}/${encodeURIComponent(item.status_name)}`, {
        classification: item.classification,
        label: item.label,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['status-discover', activeProject?.customer_uuid] }),
  })

  if (!activeProject) return (
    <div>
      <PageHeader title="Статусы" />
      <div className="card p-8 flex items-center gap-4 bg-amber-50 border-amber-200">
        <AlertCircle size={20} className="text-amber-500" />
        <p className="text-amber-800">Выберите проект в шапке страницы</p>
      </div>
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Статусы"
        subtitle={`Проект: ${activeProject.customer_name}`}
        actions={
          <button className="btn-secondary" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} /> Обновить из Naumen
          </button>
        }
      />

      {isLoading ? <PageSpinner /> : (
        <>
          <div className="card overflow-hidden mb-6">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Стандартные статусы</h2>
              <p className="text-xs text-slate-400 mt-0.5">Классификация задана системой и одинакова для всех проектов</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Статус (Naumen)</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Отображается как</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Классификация</th>
                </tr>
              </thead>
              <tbody>
                {standardList.map((s) => (
                  <tr key={s.status_name} className="border-b border-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{s.status_name}</td>
                    <td className="px-4 py-2.5 text-slate-700">{STANDARD_LABEL[s.status_name.toLowerCase()] || s.status_name}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${GROUP_BADGE[s.standard_group!]}`}>
                        {GROUP_LABEL[s.standard_group!]}
                      </span>
                    </td>
                  </tr>
                ))}
                {!standardList.length && (
                  <tr><td colSpan={3} className="px-4 py-4 text-center text-slate-400 text-xs">Стандартные статусы не встречались в данных проекта</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Нестандартные статусы (Custom)</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Используются только в проекте «{activeProject.customer_name}» — настройте наименование и классификацию индивидуально.
                Для другого проекта эти же статусы можно настроить иначе.
              </p>
            </div>
            {!customList.length ? (
              <div className="px-4 py-6 text-center text-slate-400 text-sm">В данных проекта не найдено нестандартных статусов</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Статус (Naumen)</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Наименование</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">К чему относить</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {customList.map((s) => {
                    const edit = edits[s.status_name] ?? { label: s.label ?? '', classification: s.classification ?? 'pause' }
                    const dirty = edits[s.status_name] !== undefined
                    return (
                      <tr key={s.status_name} className="border-b border-slate-50">
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                          <span className="inline-flex items-center gap-1.5">
                            <Tag size={12} className="text-amber-500 flex-shrink-0" />
                            {s.status_name}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <input
                            className="input w-48"
                            placeholder="напр. Технический перерыв"
                            value={edit.label}
                            onChange={(e) => setEdits((p) => ({ ...p, [s.status_name]: { ...edit, label: e.target.value } }))}
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <select
                            className="input w-36"
                            value={edit.classification}
                            onChange={(e) => setEdits((p) => ({ ...p, [s.status_name]: { ...edit, classification: e.target.value as StatusGroup } }))}
                          >
                            <option value="work">В линии</option>
                            <option value="pause">На паузе</option>
                            <option value="offline">Вышли</option>
                          </select>
                        </td>
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            className="btn-primary text-xs px-3 py-1.5"
                            disabled={!dirty || saveMutation.isPending}
                            onClick={() => {
                              saveMutation.mutate({ status_name: s.status_name, classification: edit.classification, label: edit.label || null })
                              setEdits((p) => { const n = { ...p }; delete n[s.status_name]; return n })
                            }}
                          >
                            <Save size={12} /> Сохранить
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, Loader2, Download, CheckCircle2, XCircle, Edit2, Save, X,
  FolderPlus, RefreshCw,
} from 'lucide-react'
import api from '@/api/client'
import type { Project } from '@/types'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import { useProjectStore } from '@/store/project'

interface EditingState {
  uuid: string
  customer_name: string
  responsible_manager: string
  target_sl: string
}

export default function ProjectSettingsPage() {
  const qc = useQueryClient()
  const refreshProjectStore = useProjectStore((s) => s.fetchProjects)

  const [showManualForm, setShowManualForm] = useState(false)
  const [manualForm, setManualForm] = useState({
    customer_name: '',
    customer_type: 'inbound',
    responsible_manager: '',
    target_sl: '',
  })

  const [availableProjects, setAvailableProjects] = useState<Project[]>([])
  const [loadingAvailable, setLoadingAvailable] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditingState | null>(null)

  const { data: trackedProjects = [], isLoading } = useQuery({
    queryKey: ['tracked-projects'],
    queryFn: () => api.get('/integrations/tracked-projects').then((r) => r.data as Project[]),
  })

  const addMutation = useMutation({
    mutationFn: (p: any) => api.post('/integrations/tracked-projects', p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tracked-projects'] }); refreshProjectStore() },
  })

  const updateMutation = useMutation({
    mutationFn: ({ uuid, data }: { uuid: string; data: any }) =>
      api.put(`/integrations/tracked-projects/${uuid}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tracked-projects'] }); setEditing(null) },
  })

  const removeMutation = useMutation({
    mutationFn: (uuid: string) => api.delete(`/integrations/tracked-projects/${uuid}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tracked-projects'] }); refreshProjectStore() },
  })

  const isTracked = (uuid: string) => trackedProjects.some((p) => p.customer_uuid === uuid)

  const handleLoadAvailable = async () => {
    setLoadingAvailable(true)
    setLoadError(null)
    try {
      const res = await api.get('/integrations/projects/available')
      setAvailableProjects(res.data.data || [])
    } catch (e: any) {
      setLoadError(e.response?.data?.detail || 'Ошибка загрузки проектов из Naumen')
    } finally {
      setLoadingAvailable(false)
    }
  }

  const handleAddManual = (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualForm.customer_name.trim()) return
    addMutation.mutate({
      customer_uuid: '',
      customer_name: manualForm.customer_name.trim(),
      customer_type: manualForm.customer_type,
      responsible_manager: manualForm.responsible_manager.trim() || null,
      target_sl: manualForm.target_sl ? parseInt(manualForm.target_sl) : null,
      is_manual: true,
    }, {
      onSuccess: () => {
        setManualForm({ customer_name: '', customer_type: 'inbound', responsible_manager: '', target_sl: '' })
        setShowManualForm(false)
      },
    })
  }

  const startEdit = (p: Project) => {
    setEditing({
      uuid: p.customer_uuid,
      customer_name: p.customer_name,
      responsible_manager: p.responsible_manager || '',
      target_sl: p.target_sl != null ? String(p.target_sl) : '',
    })
  }

  const saveEdit = () => {
    if (!editing) return
    updateMutation.mutate({
      uuid: editing.uuid,
      data: {
        customer_name: editing.customer_name,
        responsible_manager: editing.responsible_manager || null,
        target_sl: editing.target_sl ? parseInt(editing.target_sl) : null,
      },
    })
  }

  // Excel template download (blank CSV stub)
  const handleDownloadTemplate = (type: string) => {
    const header = type === 'workload'
      ? 'period_start,queue_name,total,handled,lost,avg_talk_sec,sl_percent\n'
      : 'login,employee_name,work_date,first_login,last_logout,total_sec,normal_sec\n'
    const blob = new Blob([header], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `wfm_template_${type}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) return <PageSpinner />

  return (
    <div>
      <PageHeader
        title="Проекты"
        subtitle="Управление проектами, целевые SL и шаблоны"
      />

      <div className="max-w-3xl space-y-6">

        {/* Tracked projects list */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-slate-900">Активные проекты</h2>
              <p className="text-sm text-slate-500 mt-0.5">Проекты в системе WFM — {trackedProjects.length} шт.</p>
            </div>
            <button onClick={() => setShowManualForm(!showManualForm)} className="btn-primary">
              <FolderPlus size={15} /> Добавить вручную
            </button>
          </div>

          {/* Manual project form */}
          {showManualForm && (
            <form onSubmit={handleAddManual} className="mb-5 p-4 bg-brand-50 border border-brand-200 rounded-xl space-y-3">
              <h3 className="text-sm font-semibold text-brand-800">Новый проект (вручную)</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Название проекта *</label>
                  <input className="input" required value={manualForm.customer_name}
                    onChange={(e) => setManualForm({ ...manualForm, customer_name: e.target.value })}
                    placeholder="Входящие 2024" />
                </div>
                <div>
                  <label className="label">Тип</label>
                  <select className="input" value={manualForm.customer_type}
                    onChange={(e) => setManualForm({ ...manualForm, customer_type: e.target.value })}>
                    <option value="inbound">Входящий</option>
                    <option value="outbound">Исходящий</option>
                    <option value="blended">Смешанный</option>
                  </select>
                </div>
                <div>
                  <label className="label">Ответственный менеджер</label>
                  <input className="input" value={manualForm.responsible_manager}
                    onChange={(e) => setManualForm({ ...manualForm, responsible_manager: e.target.value })}
                    placeholder="Иванов И.И." />
                </div>
                <div>
                  <label className="label">
                    Целевой SL (%)
                    <span className="text-slate-400 font-normal ml-1">— для отчётов</span>
                  </label>
                  <input className="input" type="number" min={0} max={100} value={manualForm.target_sl}
                    onChange={(e) => setManualForm({ ...manualForm, target_sl: e.target.value })}
                    placeholder="80" />
                </div>
              </div>
              <p className="text-xs text-brand-700">
                Для ручных проектов на страницах аналитики появится кнопка загрузки данных через Excel.
              </p>
              <div className="flex gap-2">
                <button type="submit" className="btn-primary" disabled={addMutation.isPending}>
                  {addMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Создать проект
                </button>
                <button type="button" className="btn-secondary" onClick={() => setShowManualForm(false)}>
                  <X size={14} /> Отмена
                </button>
              </div>
            </form>
          )}

          {trackedProjects.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">Нет добавленных проектов</div>
          ) : (
            <div className="space-y-2">
              {trackedProjects.map((p) => (
                <div key={p.customer_uuid} className={`rounded-xl border px-4 py-3 ${p.is_manual ? 'bg-purple-50 border-purple-200' : 'bg-slate-50 border-slate-200'}`}>
                  {editing?.uuid === p.customer_uuid ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <input className="input col-span-1" value={editing.customer_name}
                          onChange={(e) => setEditing({ ...editing, customer_name: e.target.value })} />
                        <input className="input" placeholder="Менеджер" value={editing.responsible_manager}
                          onChange={(e) => setEditing({ ...editing, responsible_manager: e.target.value })} />
                        <div className="flex items-center gap-1">
                          <input className="input w-20" type="number" placeholder="SL%" value={editing.target_sl}
                            onChange={(e) => setEditing({ ...editing, target_sl: e.target.value })} />
                          <span className="text-xs text-slate-400">%</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={saveEdit} className="btn-primary" disabled={updateMutation.isPending}>
                          <Save size={13} /> Сохранить
                        </button>
                        <button onClick={() => setEditing(null)} className="btn-secondary">
                          <X size={13} /> Отмена
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-800">{p.customer_name}</p>
                          {p.is_manual && (
                            <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">Ручной</span>
                          )}
                          {p.target_sl != null && (
                            <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">SL: {p.target_sl}%</span>
                          )}
                        </div>
                        {p.responsible_manager && (
                          <p className="text-xs text-slate-400 mt-0.5">{p.responsible_manager}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => startEdit(p)} className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors" title="Редактировать">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => removeMutation.mutate(p.customer_uuid)} disabled={removeMutation.isPending}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Удалить">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add from Naumen */}
        <div className="card p-6">
          <h2 className="font-semibold text-slate-900 mb-1">Добавить из Naumen</h2>
          <p className="text-sm text-slate-500 mb-4">
            Загрузите список проектов из Naumen Contact Center и добавьте нужные в WFM
          </p>

          <button onClick={handleLoadAvailable} disabled={loadingAvailable} className="btn-secondary">
            {loadingAvailable ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            {loadingAvailable ? 'Загружаем...' : 'Загрузить из Naumen'}
          </button>

          {loadError && (
            <div className="flex items-center gap-3 p-4 rounded-xl border bg-red-50 border-red-200 mt-4">
              <XCircle size={18} className="text-red-600 flex-shrink-0" />
              <p className="text-sm font-medium text-red-800">{loadError}</p>
            </div>
          )}

          {availableProjects.length > 0 && (
            <div className="mt-5 space-y-2 max-h-80 overflow-y-auto pr-1">
              {availableProjects.map((p) => {
                const tracked = isTracked(p.customer_uuid)
                return (
                  <div key={p.customer_uuid}
                    className={`flex items-center justify-between rounded-lg px-4 py-2.5 border ${
                      tracked ? 'bg-slate-50 border-slate-200 opacity-60' : 'bg-white border-slate-200 hover:border-brand-300 hover:bg-brand-50 transition-colors'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{p.customer_name}</p>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">
                        {p.customer_type}{p.responsible_manager ? ` · ${p.responsible_manager}` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => !tracked && addMutation.mutate({
                        customer_uuid: p.customer_uuid,
                        customer_name: p.customer_name,
                        customer_type: p.customer_type,
                        responsible_manager: p.responsible_manager,
                      })}
                      disabled={tracked || addMutation.isPending}
                      className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex-shrink-0 ml-3 ${
                        tracked ? 'text-green-600 bg-green-50 cursor-default' : 'text-brand-600 bg-brand-50 hover:bg-brand-100 border border-brand-200'
                      }`}
                    >
                      {tracked ? <><CheckCircle2 size={13} /> Добавлен</> : <><Plus size={13} /> Добавить</>}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Excel templates */}
        <div className="card p-6">
          <h2 className="font-semibold text-slate-900 mb-1">Шаблоны Excel</h2>
          <p className="text-sm text-slate-500 mb-4">
            Шаблоны для загрузки данных в ручные проекты (нагрузка, смены операторов)
          </p>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => handleDownloadTemplate('workload')} className="btn-secondary">
              <Download size={15} /> Шаблон нагрузки (.csv)
            </button>
            <button onClick={() => handleDownloadTemplate('sessions')} className="btn-secondary">
              <Download size={15} /> Шаблон смен (.csv)
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-3">
            Загруженные файлы будут доступны в разделах «Нагрузка» и «Смены» для выбранного ручного проекта.
            Функция загрузки будет добавлена в следующей версии.
          </p>
        </div>

      </div>
    </div>
  )
}

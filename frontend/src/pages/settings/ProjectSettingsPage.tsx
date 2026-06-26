import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Trash2, Loader2, Download, CheckCircle2, XCircle, Edit2, Save, X,
  FolderPlus, RefreshCw, ChevronDown, ChevronRight, PhoneCall,
} from 'lucide-react'
import api from '@/api/client'
import type { Project, Queue } from '@/types'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import { useProjectStore } from '@/store/project'

interface QueueSetting {
  queue_name: string; target_sl: number | null; answer_sec: number | null
  wrapup_sec?: number | null; show_in?: boolean; show_out?: boolean; hidden?: boolean
}
interface EditingState {
  uuid: string; customer_name: string; responsible_manager: string; target_sl: string
  has_inbound: boolean; has_outbound: boolean
}

// ─── Per-queue settings panel ─────────────────────────────────────────────────
function QueueSettingsPanel({ project }: { project: Project }) {
  const qc = useQueryClient()
  const isManual = project.is_manual
  const [newQueue, setNewQueue] = useState('')
  const [localEdits, setLocalEdits] = useState<Record<string, { target_sl: string; answer_sec: string; wrapup_sec: string }>>({})
  const [naumenQueues, setNaumenQueues] = useState<string[]>([])
  const [loadingNaumen, setLoadingNaumen] = useState(false)
  const [saved, setSaved] = useState(false)

  const { data: allSettings = [], refetch } = useQuery({
    queryKey: ['queue-settings', project.customer_uuid],
    queryFn: () =>
      api.get(`/queue-settings/${project.customer_uuid}`).then((r) => r.data as QueueSetting[]),
  })
  // Исключаем служебные строки исходящих подпроектов (ключ "out:<uuid>") — они
  // не входящие очереди, ими управляет отдельная панель ниже.
  const settings = allSettings.filter((s) => !s.queue_name.startsWith('out:'))

  const saveMutation = useMutation({
    mutationFn: (items: QueueSetting[]) =>
      api.put(`/queue-settings/${project.customer_uuid}`, items),
    onSuccess: () => { refetch(); setLocalEdits({}); setSaved(true); setTimeout(() => setSaved(false), 2000) },
  })

  const deleteMutation = useMutation({
    mutationFn: (queueName: string) =>
      api.delete(`/queue-settings/${project.customer_uuid}/${encodeURIComponent(queueName)}`),
    onSuccess: () => { refetch(); qc.invalidateQueries({ queryKey: ['queues', project.customer_uuid] }) },
  })

  const loadNaumenQueues = async () => {
    setLoadingNaumen(true)
    try {
      const res = await api.get('/analytics/queues', { params: { partner_uuid: project.customer_uuid } })
      const names = (res.data.data as Queue[]).map((q) => q.name)
      setNaumenQueues(names)
      // Pre-fill settings for queues not yet configured
      const existingNames = new Set(settings.map((s) => s.queue_name))
      const toAdd = names.filter((n) => !existingNames.has(n))
      if (toAdd.length) {
        await api.put(`/queue-settings/${project.customer_uuid}`, toAdd.map((n) => ({
          queue_name: n, target_sl: null, answer_sec: null,
        })))
        refetch()
      }
    } catch {
      // ignore
    } finally {
      setLoadingNaumen(false)
    }
  }

  const addManualQueue = () => {
    if (!newQueue.trim()) return
    api.put(`/queue-settings/${project.customer_uuid}`, [
      { queue_name: newQueue.trim(), target_sl: null, answer_sec: null }
    ]).then(() => { refetch(); setNewQueue('') })
  }

  const getEdit = (qName: string) => localEdits[qName] || {
    target_sl: settings.find((s) => s.queue_name === qName)?.target_sl?.toString() ?? '',
    answer_sec: settings.find((s) => s.queue_name === qName)?.answer_sec?.toString() ?? '',
    wrapup_sec: settings.find((s) => s.queue_name === qName)?.wrapup_sec?.toString() ?? '',
  }

  const setEdit = (qName: string, field: 'target_sl' | 'answer_sec' | 'wrapup_sec', val: string) => {
    setLocalEdits((prev) => ({ ...prev, [qName]: { ...getEdit(qName), [field]: val } }))
  }

  const saveAll = () => {
    const items = settings.map((s) => {
      const e = localEdits[s.queue_name]
      return {
        ...s,
        target_sl: e?.target_sl !== undefined ? (e.target_sl ? parseInt(e.target_sl) : null) : s.target_sl,
        answer_sec: e?.answer_sec !== undefined ? (e.answer_sec ? parseInt(e.answer_sec) : null) : s.answer_sec,
        wrapup_sec: e?.wrapup_sec !== undefined ? (e.wrapup_sec ? parseInt(e.wrapup_sec) : null) : s.wrapup_sec,
      }
    })
    saveMutation.mutate(items)
  }

  // Переключение «Вход / Исход / Не отображать» — сохраняем сразу для очереди.
  // «Скрыть» взаимоисключающе с Вход/Исход: включаем «Скрыть» → снимаем Вход и
  // Исход; включаем Вход или Исход → снимаем «Скрыть». Берём самую свежую строку
  // настроек (на случай быстрых кликов), чтобы не сохранить устаревшие значения.
  const toggleFlag = (s: QueueSetting, field: 'show_in' | 'show_out' | 'hidden') => {
    const latest = settings.find((x) => x.queue_name === s.queue_name) || s
    const cur = field === 'show_in' ? (latest.show_in ?? true) : field === 'show_out' ? (latest.show_out ?? false) : (latest.hidden ?? false)
    const next = !cur
    const patch: Partial<QueueSetting> = field === 'hidden'
      ? (next ? { hidden: true, show_in: false, show_out: false } : { hidden: false })
      : (next ? { [field]: true, hidden: false } : { [field]: false })
    saveMutation.mutate([{ ...latest, ...patch }])
  }

  const hasEdits = Object.keys(localEdits).length > 0

  return (
    <div className="mt-3 pt-3 border-t border-slate-200">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5">
          <PhoneCall size={12} /> Настройки очередей
        </p>
        <div className="flex items-center gap-2">
          {!isManual && (
            <button onClick={loadNaumenQueues} disabled={loadingNaumen} className="text-xs text-brand-600 hover:text-brand-800 flex items-center gap-1">
              {loadingNaumen ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              {loadingNaumen ? 'Загрузка...' : 'Синхронизировать из Naumen'}
            </button>
          )}
          {hasEdits && (
            <button onClick={saveAll} disabled={saveMutation.isPending}
              className="text-xs text-white bg-brand-500 hover:bg-brand-600 px-2.5 py-1 rounded-lg flex items-center gap-1">
              <Save size={11} /> Сохранить
            </button>
          )}
          {saved && <span className="text-xs text-green-600">✓ Сохранено</span>}
        </div>
      </div>

      {settings.length === 0 ? (
        <p className="text-xs text-slate-400 italic mb-3">
          {isManual ? 'Добавьте очереди вручную ниже.' : 'Нажмите "Синхронизировать из Naumen" чтобы загрузить очереди.'}
        </p>
      ) : (
        <div className="space-y-1.5 mb-3 overflow-x-auto">
          <div className="grid grid-cols-[1fr_64px_64px_64px_40px_40px_52px_28px] gap-1.5 px-2 mb-1 min-w-[560px]">
            <span className="text-xs text-slate-400 font-medium">Очередь</span>
            <span className="text-xs text-slate-400 font-medium text-center">SL %</span>
            <span className="text-xs text-slate-400 font-medium text-center">Ответ с</span>
            <span className="text-xs text-slate-400 font-medium text-center">ПВО с</span>
            <span className="text-xs text-slate-400 font-medium text-center">Вход</span>
            <span className="text-xs text-slate-400 font-medium text-center">Исход</span>
            <span className="text-xs text-slate-400 font-medium text-center">Скрыть</span>
            <span />
          </div>
          {settings.map((s) => {
            const e = getEdit(s.queue_name)
            const isDirty = localEdits[s.queue_name] !== undefined
            const sIn = s.show_in ?? true, sOut = s.show_out ?? false, sHid = s.hidden ?? false
            return (
              <div key={s.queue_name} className={`grid grid-cols-[1fr_64px_64px_64px_40px_40px_52px_28px] gap-1.5 items-center px-2 py-1 rounded-lg min-w-[560px] ${isDirty ? 'bg-brand-50' : sHid ? 'opacity-50 hover:opacity-100' : 'hover:bg-slate-50'}`}>
                <span className="text-xs text-slate-700 truncate" title={s.queue_name}>{s.queue_name}</span>
                <input type="number" className="input text-xs text-center py-1 px-1" placeholder="—" min={0} max={100}
                  value={e.target_sl} onChange={(v) => setEdit(s.queue_name, 'target_sl', v.target.value)} />
                <input type="number" className="input text-xs text-center py-1 px-1" placeholder="—" min={0} max={300}
                  value={e.answer_sec} onChange={(v) => setEdit(s.queue_name, 'answer_sec', v.target.value)} />
                <input type="number" className="input text-xs text-center py-1 px-1" placeholder="—" min={0} max={600}
                  value={e.wrapup_sec} onChange={(v) => setEdit(s.queue_name, 'wrapup_sec', v.target.value)} />
                <div className="flex justify-center"><input type="checkbox" checked={sIn} onChange={() => toggleFlag(s, 'show_in')} title="Показывать во «Вход»" /></div>
                <div className="flex justify-center"><input type="checkbox" checked={sOut} onChange={() => toggleFlag(s, 'show_out')} title="Показывать в «Исход»" /></div>
                <div className="flex justify-center"><input type="checkbox" checked={sHid} onChange={() => toggleFlag(s, 'hidden')} title="Не отображать" /></div>
                <button onClick={() => deleteMutation.mutate(s.queue_name)}
                  className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors">
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Add manual queue */}
      {isManual && (
        <div className="flex items-center gap-2">
          <input className="input text-xs flex-1" placeholder="Название очереди" value={newQueue}
            onChange={(e) => setNewQueue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addManualQueue()} />
          <button onClick={addManualQueue} className="btn-secondary py-1.5 text-xs" disabled={!newQueue.trim()}>
            <Plus size={12} /> Добавить
          </button>
        </div>
      )}

      <p className="text-xs text-slate-400 mt-2">
        SL %, время ответа и ПВО (постобработка, сек) перекрывают данные Naumen; пустые = из Naumen.
        Галочки «Вход / Исход» определяют, в каком разделе аналитики показывать очередь, «Скрыть» — убрать из отображения.
      </p>
    </div>
  )
}

// ─── Исходящие линии (подпроекты обзвона) проекта ─────────────────────────────
interface OutProjRow { project_uuid: string; name: string; status?: string; show_in?: boolean; show_out?: boolean; hidden?: boolean }
function OutboundProjectsPanel({ project }: { project: Project }) {
  const qc = useQueryClient()
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['outbound-projects', project.customer_uuid],
    queryFn: () => api.get('/analytics/outbound-projects', { params: { partner_uuid: project.customer_uuid } })
      .then((r) => r.data.data as OutProjRow[]),
  })
  // Настройки подпроекта — в queue_settings c ключом "out:<uuid>". «Скрыть»
  // взаимоисключающе с Вход/Исход (как у входящих очередей).
  const save = useMutation({
    mutationFn: (body: any[]) => api.put(`/queue-settings/${project.customer_uuid}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['outbound-projects', project.customer_uuid] }),
  })
  const toggle = (p: OutProjRow, field: 'show_in' | 'show_out' | 'hidden') => {
    const sIn = p.show_in ?? false, sOut = p.show_out ?? true, sHid = p.hidden ?? false
    const cur = field === 'show_in' ? sIn : field === 'show_out' ? sOut : sHid
    const next = !cur
    const base = { queue_name: `out:${p.project_uuid}`, show_in: sIn, show_out: sOut, hidden: sHid }
    const patch = field === 'hidden'
      ? (next ? { hidden: true, show_in: false, show_out: false } : { hidden: false })
      : (next ? { [field]: true, hidden: false } : { [field]: false })
    save.mutate([{ ...base, ...patch }])
  }
  return (
    <div className="mt-3 pt-3 border-t border-slate-200">
      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-1.5 mb-2">
        <PhoneCall size={12} /> Исходящие линии
      </p>
      {isLoading ? <p className="text-xs text-slate-400">Загрузка…</p>
        : projects.length === 0 ? (
          <p className="text-xs text-slate-400 italic">Нет исходящих подпроектов в Naumen (или нет подключения). Раздел «Аналитика (Исход)» всё равно доступен.</p>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_40px_40px_52px] gap-1.5 px-2 mb-0.5">
              <span className="text-xs text-slate-400 font-medium">Линия</span>
              <span className="text-xs text-slate-400 font-medium text-center">Вход</span>
              <span className="text-xs text-slate-400 font-medium text-center">Исход</span>
              <span className="text-xs text-slate-400 font-medium text-center">Скрыть</span>
            </div>
            {projects.map((p) => {
              const sIn = p.show_in ?? false, sOut = p.show_out ?? true, sHid = p.hidden ?? false
              return (
                <div key={p.project_uuid} className={`grid grid-cols-[1fr_40px_40px_52px] gap-1.5 items-center px-2 py-1 rounded-lg text-xs ${sHid ? 'opacity-50 hover:opacity-100' : 'hover:bg-slate-50'}`}>
                  <span className="text-slate-700 truncate" title={p.name}>{p.name}{p.status ? ` · ${p.status}` : ''}</span>
                  <div className="flex justify-center"><input type="checkbox" checked={sIn} onChange={() => toggle(p, 'show_in')} title="Показывать во «Вход»" /></div>
                  <div className="flex justify-center"><input type="checkbox" checked={sOut} onChange={() => toggle(p, 'show_out')} title="Показывать в «Исход»" /></div>
                  <div className="flex justify-center"><input type="checkbox" checked={sHid} onChange={() => toggle(p, 'hidden')} title="Не отображать" /></div>
                </div>
              )
            })}
          </div>
        )}
      <p className="text-xs text-slate-400 mt-2">Список берётся из Naumen. «Вход/Исход» — где показывать линию, «Скрыть» — убрать из фильтров и сводок.</p>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ProjectSettingsPage() {
  const qc = useQueryClient()
  const refreshProjectStore = useProjectStore((s) => s.fetchProjects)

  const [showManualForm, setShowManualForm] = useState(false)
  const [manualForm, setManualForm] = useState({
    customer_name: '', responsible_manager: '', target_sl: '', has_inbound: true, has_outbound: false,
  })
  const [availableProjects, setAvailableProjects] = useState<Project[]>([])
  const [loadingAvailable, setLoadingAvailable] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditingState | null>(null)
  const [expandedQueue, setExpandedQueue] = useState<string | null>(null)

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tracked-projects'] })
      refreshProjectStore()  // подхватить новые линии в активном проекте → разделы аналитики
      setEditing(null)
    },
  })

  const removeMutation = useMutation({
    mutationFn: (uuid: string) => api.delete(`/integrations/tracked-projects/${uuid}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tracked-projects'] }); refreshProjectStore() },
  })

  const isTracked = (uuid: string) => trackedProjects.some((p) => p.customer_uuid === uuid)

  const handleLoadAvailable = async () => {
    setLoadingAvailable(true); setLoadError(null)
    try {
      const res = await api.get('/integrations/projects/available')
      setAvailableProjects(res.data.data || [])
    } catch (e: any) {
      setLoadError(e.response?.data?.detail || 'Ошибка загрузки')
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
      responsible_manager: manualForm.responsible_manager.trim() || null,
      target_sl: manualForm.target_sl ? parseInt(manualForm.target_sl) : null,
      is_manual: true,
      has_inbound: manualForm.has_inbound,
      has_outbound: manualForm.has_outbound,
    }, {
      onSuccess: () => {
        setManualForm({ customer_name: '', responsible_manager: '', target_sl: '', has_inbound: true, has_outbound: false })
        setShowManualForm(false)
      },
    })
  }

  const startEdit = (p: Project) => setEditing({
    uuid: p.customer_uuid, customer_name: p.customer_name,
    responsible_manager: p.responsible_manager || '', target_sl: p.target_sl != null ? String(p.target_sl) : '',
    has_inbound: p.has_inbound ?? true, has_outbound: p.has_outbound ?? false,
  })

  const saveEdit = () => {
    if (!editing) return
    updateMutation.mutate({
      uuid: editing.uuid,
      data: {
        customer_name: editing.customer_name,
        responsible_manager: editing.responsible_manager || null,
        target_sl: editing.target_sl ? parseInt(editing.target_sl) : null,
        has_inbound: editing.has_inbound,
        has_outbound: editing.has_outbound,
      },
    })
  }

  const handleDownloadTemplate = (type: string) => {
    const header = type === 'workload'
      ? 'period_start,queue_name,total,handled,lost,avg_talk_sec,sl_percent\n'
      : 'login,employee_name,work_date,first_login,last_logout,total_sec,normal_sec\n'
    const blob = new Blob([header], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `wfm_template_${type}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) return <PageSpinner />

  return (
    <div>
      <PageHeader title="Проекты" subtitle="Управление проектами, очередями и целевыми SL" />

      <div className="max-w-3xl space-y-6">

        {/* Tracked projects */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-slate-900">Активные проекты</h2>
              <p className="text-sm text-slate-500 mt-0.5">{trackedProjects.length} проектов в системе WFM</p>
            </div>
            <button onClick={() => setShowManualForm(!showManualForm)} className="btn-primary">
              <FolderPlus size={15} /> Добавить вручную
            </button>
          </div>

          {showManualForm && (
            <form onSubmit={handleAddManual} className="mb-5 p-4 bg-brand-50 border border-brand-200 rounded-xl space-y-3">
              <h3 className="text-sm font-semibold text-brand-800">Новый проект (вручную)</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="label">Название *</label>
                  <input className="input" required value={manualForm.customer_name}
                    onChange={(e) => setManualForm({ ...manualForm, customer_name: e.target.value })}
                    placeholder="Входящие 2024" />
                </div>
                <div>
                  <label className="label">Менеджер</label>
                  <input className="input" value={manualForm.responsible_manager}
                    onChange={(e) => setManualForm({ ...manualForm, responsible_manager: e.target.value })}
                    placeholder="Иванов И.И." />
                </div>
                <div>
                  <label className="label">SL% по умолчанию</label>
                  <input className="input" type="number" min={0} max={100} value={manualForm.target_sl}
                    onChange={(e) => setManualForm({ ...manualForm, target_sl: e.target.value })} placeholder="80" />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs font-medium text-slate-600">Линии:</span>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={manualForm.has_inbound} onChange={(e) => setManualForm({ ...manualForm, has_inbound: e.target.checked })} />
                  Входящая линия
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={manualForm.has_outbound} onChange={(e) => setManualForm({ ...manualForm, has_outbound: e.target.checked })} />
                  Исходящая линия
                </label>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn-primary" disabled={addMutation.isPending}>
                  {addMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Создать
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
                <div key={p.customer_uuid}
                  className={`rounded-xl border ${p.is_manual ? 'bg-purple-50 border-purple-200' : 'bg-slate-50 border-slate-200'}`}>
                  {/* Project header row */}
                  {editing?.uuid === p.customer_uuid ? (
                    <div className="px-4 py-3 space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <input className="input" value={editing.customer_name}
                          onChange={(e) => setEditing({ ...editing, customer_name: e.target.value })} />
                        <input className="input" placeholder="Менеджер" value={editing.responsible_manager}
                          onChange={(e) => setEditing({ ...editing, responsible_manager: e.target.value })} />
                        <div className="flex items-center gap-1">
                          <input className="input w-20" type="number" placeholder="SL%" value={editing.target_sl}
                            onChange={(e) => setEditing({ ...editing, target_sl: e.target.value })} />
                          <span className="text-xs text-slate-400">%</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-xs font-medium text-slate-500">Линии проекта:</span>
                        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                          <input type="checkbox" checked={editing.has_inbound} onChange={(e) => setEditing({ ...editing, has_inbound: e.target.checked })} />
                          Входящая линия
                        </label>
                        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                          <input type="checkbox" checked={editing.has_outbound} onChange={(e) => setEditing({ ...editing, has_outbound: e.target.checked })} />
                          Исходящая линия
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={saveEdit} className="btn-primary" disabled={updateMutation.isPending}>
                          <Save size={13} /> Сохранить
                        </button>
                        <button onClick={() => setEditing(null)} className="btn-secondary"><X size={13} /> Отмена</button>
                      </div>
                    </div>
                  ) : (
                    <div className="px-4 py-3 flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-slate-800">{p.customer_name}</p>
                          {p.is_manual && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">Ручной</span>}
                          {p.target_sl != null && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">SL: {p.target_sl}%</span>}
                          {(p.has_inbound ?? true) && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">Вход</span>}
                          {(p.has_outbound ?? false) && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Исход</span>}
                        </div>
                        {p.responsible_manager && <p className="text-xs text-slate-400 mt-0.5">{p.responsible_manager}</p>}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-3">
                        <button
                          onClick={() => setExpandedQueue(expandedQueue === p.customer_uuid ? null : p.customer_uuid)}
                          className={`p-1.5 rounded-lg transition-colors text-xs flex items-center gap-1 ${
                            expandedQueue === p.customer_uuid
                              ? 'text-brand-600 bg-brand-50'
                              : 'text-slate-400 hover:text-brand-600 hover:bg-brand-50'
                          }`}
                          title="Настройки очередей"
                        >
                          <PhoneCall size={13} />
                          {expandedQueue === p.customer_uuid ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </button>
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
                  {/* Queue settings panel */}
                  {expandedQueue === p.customer_uuid && (
                    <div className="px-4 pb-4">
                      <QueueSettingsPanel project={p} />
                      {(p.has_outbound ?? false) && <OutboundProjectsPanel project={p} />}
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
          <p className="text-sm text-slate-500 mb-4">Загрузите и выберите проекты из Naumen Contact Center</p>
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
                    }`}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{p.customer_name}</p>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">
                        {p.customer_type}{p.responsible_manager ? ` · ${p.responsible_manager}` : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => !tracked && addMutation.mutate({
                        customer_uuid: p.customer_uuid, customer_name: p.customer_name,
                        customer_type: p.customer_type, responsible_manager: p.responsible_manager,
                      })}
                      disabled={tracked || addMutation.isPending}
                      className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex-shrink-0 ml-3 ${
                        tracked ? 'text-green-600 bg-green-50 cursor-default' : 'text-brand-600 bg-brand-50 hover:bg-brand-100 border border-brand-200'
                      }`}>
                      {tracked ? <><CheckCircle2 size={13} /> Добавлен</> : <><Plus size={13} /> Добавить</>}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Templates */}
        <div className="card p-6">
          <h2 className="font-semibold text-slate-900 mb-1">Шаблоны Excel</h2>
          <p className="text-sm text-slate-500 mb-4">Шаблоны для ручных проектов</p>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => handleDownloadTemplate('workload')} className="btn-secondary">
              <Download size={15} /> Нагрузка (.csv)
            </button>
            <button onClick={() => handleDownloadTemplate('sessions')} className="btn-secondary">
              <Download size={15} /> Смены операторов (.csv)
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

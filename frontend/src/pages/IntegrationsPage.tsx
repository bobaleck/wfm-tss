import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Save, TestTube2, CheckCircle2, XCircle, Eye, EyeOff,
  Download, Plus, Trash2, Loader2,
} from 'lucide-react'
import api from '@/api/client'
import type { IntegrationSettings, Project } from '@/types'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import { useProjectStore } from '@/store/project'

export default function IntegrationsPage() {
  const qc = useQueryClient()
  const refreshProjectStore = useProjectStore((s) => s.fetchProjects)

  const [showPass, setShowPass] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [testApiResult, setTestApiResult] = useState<{ ok: boolean; message: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['integration-settings'],
    queryFn: () => api.get('/integrations').then((r) => r.data as IntegrationSettings),
  })

  const [dbForm, setDbForm] = useState({
    db_host: '', db_name: 'nccrep', db_user: 'readonly', db_password: '', db_port: 5432,
  })
  const [apiForm, setApiForm] = useState({
    api_base_url: '', api_username: '', api_key: '',
  })

  useEffect(() => {
    if (data) {
      setDbForm((f) => ({
        ...f,
        db_host: data.db_host || '',
        db_name: data.db_name || 'nccrep',
        db_user: data.db_user || 'readonly',
        db_port: data.db_port || 5432,
      }))
      setApiForm((f) => ({
        ...f,
        api_base_url: data.api_base_url || '',
        api_username: data.api_username || '',
      }))
    }
  }, [data])

  const saveDbMutation = useMutation({
    mutationFn: (d: any) => api.put('/integrations', d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integration-settings'] }),
  })

  const saveApiMutation = useMutation({
    mutationFn: (d: any) => api.put('/integrations', d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integration-settings'] }),
  })

  const testMutation = useMutation({
    mutationFn: () => api.post('/integrations/test').then((r) => r.data),
    onSuccess: (result) => setTestResult(result),
    onError: (e: any) => setTestResult({ ok: false, message: e.response?.data?.detail || 'Ошибка' }),
  })

  const testApiMutation = useMutation({
    mutationFn: () => api.post('/integrations/test-api').then((r) => r.data),
    onSuccess: (result) => setTestApiResult(result),
    onError: (e: any) => setTestApiResult({ ok: false, message: e.response?.data?.detail || 'Ошибка' }),
  })

  // Available projects loaded from NCC on demand
  const [availableProjects, setAvailableProjects] = useState<Project[]>([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Tracked projects stored in WFM DB
  const { data: trackedProjects = [], refetch: refetchTracked } = useQuery({
    queryKey: ['tracked-projects'],
    queryFn: () => api.get('/integrations/tracked-projects').then((r) => r.data as Project[]),
  })

  const addProjectMutation = useMutation({
    mutationFn: (p: Project) =>
      api.post('/integrations/tracked-projects', {
        customer_uuid: p.customer_uuid,
        customer_name: p.customer_name,
        customer_type: p.customer_type,
        responsible_manager: p.responsible_manager,
      }),
    onSuccess: () => { refetchTracked(); refreshProjectStore() },
  })

  const removeProjectMutation = useMutation({
    mutationFn: (uuid: string) => api.delete(`/integrations/tracked-projects/${uuid}`),
    onSuccess: () => { refetchTracked(); refreshProjectStore() },
  })

  const handleLoadProjects = async () => {
    setLoadingProjects(true)
    setLoadError(null)
    try {
      const res = await api.get('/integrations/projects/available')
      setAvailableProjects(res.data.data || [])
    } catch (e: any) {
      setLoadError(e.response?.data?.detail || 'Ошибка при загрузке проектов')
    } finally {
      setLoadingProjects(false)
    }
  }

  const isTracked = (uuid: string) => trackedProjects.some((p) => p.customer_uuid === uuid)

  const handleSaveDb = (e: React.FormEvent) => {
    e.preventDefault()
    const payload: any = { ...dbForm }
    if (!dbForm.db_password) delete payload.db_password
    saveDbMutation.mutate(payload)
  }

  const handleSaveApi = (e: React.FormEvent) => {
    e.preventDefault()
    const payload: any = { ...apiForm }
    if (!apiForm.api_key) delete payload.api_key
    saveApiMutation.mutate(payload)
  }

  if (isLoading) return <PageSpinner />

  return (
    <div>
      <PageHeader
        title="Интеграции"
        subtitle="Подключение к Naumen Contact Center"
      />

      <div className="max-w-2xl space-y-6">

        {/* PostgreSQL */}
        <form onSubmit={handleSaveDb}>
          <div className="card p-6">
            <h2 className="font-semibold text-slate-900 mb-1">База данных Naumen (PostgreSQL)</h2>
            <p className="text-sm text-slate-500 mb-5">Read-only подключение к отчётной базе nccrep</p>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="label">Хост</label>
                  <input className="input" placeholder="telesales-service.nau.team" value={dbForm.db_host}
                    onChange={(e) => setDbForm({ ...dbForm, db_host: e.target.value })} />
                </div>
                <div>
                  <label className="label">Порт</label>
                  <input className="input" type="number" value={dbForm.db_port}
                    onChange={(e) => setDbForm({ ...dbForm, db_port: +e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">База данных</label>
                  <input className="input" value={dbForm.db_name}
                    onChange={(e) => setDbForm({ ...dbForm, db_name: e.target.value })} />
                </div>
                <div>
                  <label className="label">Пользователь</label>
                  <input className="input" value={dbForm.db_user}
                    onChange={(e) => setDbForm({ ...dbForm, db_user: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label">
                  Пароль {data?.has_password && <span className="text-green-600 text-xs ml-1">✓ сохранён</span>}
                </label>
                <div className="relative">
                  <input
                    className="input pr-10"
                    type={showPass ? 'text' : 'password'}
                    placeholder={data?.has_password ? '••••••••' : 'Введите пароль'}
                    value={dbForm.db_password}
                    onChange={(e) => setDbForm({ ...dbForm, db_password: e.target.value })}
                  />
                  <button type="button" onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <p className="text-xs text-slate-400 mt-1">Оставьте пустым, чтобы не менять сохранённый пароль</p>
              </div>
            </div>

            {testResult && (
              <div className={`flex items-center gap-3 p-4 rounded-xl border mt-4 ${testResult.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                {testResult.ok
                  ? <CheckCircle2 size={18} className="text-green-600 flex-shrink-0" />
                  : <XCircle size={18} className="text-red-600 flex-shrink-0" />}
                <p className={`text-sm font-medium ${testResult.ok ? 'text-green-800' : 'text-red-800'}`}>
                  {testResult.message}
                </p>
              </div>
            )}

            <div className="flex items-center gap-3 mt-5">
              <button type="submit" className="btn-primary" disabled={saveDbMutation.isPending}>
                <Save size={15} /> {saveDbMutation.isPending ? 'Сохраняем...' : 'Сохранить'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setTestResult(null); testMutation.mutate() }}
                disabled={testMutation.isPending}
              >
                <TestTube2 size={15} />
                {testMutation.isPending ? 'Проверяем...' : 'Проверить соединение'}
              </button>
            </div>
            {saveDbMutation.isSuccess && (
              <p className="text-sm text-green-600 mt-2">✓ Настройки БД сохранены</p>
            )}
          </div>
        </form>

        {/* REST API */}
        <form onSubmit={handleSaveApi}>
          <div className="card p-6">
            <h2 className="font-semibold text-slate-900 mb-1">Naumen REST API v2</h2>
            <p className="text-sm text-slate-500 mb-5">Для получения данных через API</p>
            <div className="space-y-4">
              <div>
                <label className="label">Базовый URL</label>
                <input className="input" placeholder="https://host:port/api/v2" value={apiForm.api_base_url}
                  onChange={(e) => setApiForm({ ...apiForm, api_base_url: e.target.value })} />
              </div>
              <div>
                <label className="label">Пользователь API</label>
                <input className="input" placeholder="shaiderman.k" value={apiForm.api_username}
                  onChange={(e) => setApiForm({ ...apiForm, api_username: e.target.value })} />
              </div>
              <div>
                <label className="label">
                  API ключ {data?.has_api_key && <span className="text-green-600 text-xs ml-1">✓ сохранён</span>}
                </label>
                <div className="relative">
                  <input
                    className="input pr-10"
                    type={showKey ? 'text' : 'password'}
                    placeholder={data?.has_api_key ? '••••••••' : 'X-API-Key токен'}
                    value={apiForm.api_key}
                    onChange={(e) => setApiForm({ ...apiForm, api_key: e.target.value })}
                  />
                  <button type="button" onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            </div>
            {testApiResult && (
              <div className={`flex items-center gap-3 p-4 rounded-xl border mt-4 ${testApiResult.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                {testApiResult.ok
                  ? <CheckCircle2 size={18} className="text-green-600 flex-shrink-0" />
                  : <XCircle size={18} className="text-red-600 flex-shrink-0" />}
                <p className={`text-sm font-medium ${testApiResult.ok ? 'text-green-800' : 'text-red-800'}`}>
                  {testApiResult.message}
                </p>
              </div>
            )}

            <div className="flex items-center gap-3 mt-5">
              <button type="submit" className="btn-primary" disabled={saveApiMutation.isPending}>
                <Save size={15} /> {saveApiMutation.isPending ? 'Сохраняем...' : 'Сохранить'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setTestApiResult(null); testApiMutation.mutate() }}
                disabled={testApiMutation.isPending}
              >
                <TestTube2 size={15} />
                {testApiMutation.isPending ? 'Проверяем...' : 'Проверить API'}
              </button>
            </div>
            {saveApiMutation.isSuccess && (
              <p className="text-sm text-green-600 mt-2">✓ Настройки API сохранены</p>
            )}
          </div>
        </form>

        {/* Project Management */}
        <div className="card p-6">
          <h2 className="font-semibold text-slate-900 mb-1">Управление проектами</h2>
          <p className="text-sm text-slate-500 mb-5">
            Загрузите список проектов из Naumen и добавьте нужные в систему WFM
          </p>

          {/* Tracked (added) projects */}
          {trackedProjects.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-slate-700 mb-3">
                Добавленные проекты ({trackedProjects.length})
              </h3>
              <div className="space-y-2">
                {trackedProjects.map((p) => (
                  <div key={p.customer_uuid}
                    className="flex items-center justify-between bg-brand-50 border border-brand-200 rounded-lg px-4 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{p.customer_name}</p>
                      {p.responsible_manager && (
                        <p className="text-xs text-slate-400 mt-0.5">{p.responsible_manager}</p>
                      )}
                    </div>
                    <button
                      onClick={() => removeProjectMutation.mutate(p.customer_uuid)}
                      disabled={removeProjectMutation.isPending}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                      title="Удалить из системы"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Load button */}
          <button
            type="button"
            onClick={handleLoadProjects}
            disabled={loadingProjects}
            className="btn-secondary"
          >
            {loadingProjects ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            {loadingProjects ? 'Загружаем...' : 'Загрузить проекты'}
          </button>

          {loadError && (
            <div className="flex items-center gap-3 p-4 rounded-xl border bg-red-50 border-red-200 mt-4">
              <XCircle size={18} className="text-red-600 flex-shrink-0" />
              <p className="text-sm font-medium text-red-800">{loadError}</p>
            </div>
          )}

          {/* Available projects list */}
          {availableProjects.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-medium text-slate-700 mb-3">
                Доступные проекты ({availableProjects.length})
              </h3>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {availableProjects.map((p) => {
                  const tracked = isTracked(p.customer_uuid)
                  return (
                    <div
                      key={p.customer_uuid}
                      className={`flex items-center justify-between rounded-lg px-4 py-2.5 border ${
                        tracked
                          ? 'bg-slate-50 border-slate-200 opacity-60'
                          : 'bg-white border-slate-200 hover:border-brand-300 hover:bg-brand-50 transition-colors'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{p.customer_name}</p>
                        <p className="text-xs text-slate-400 mt-0.5 truncate">
                          {p.customer_type}
                          {p.responsible_manager ? ` · ${p.responsible_manager}` : ''}
                        </p>
                      </div>
                      <button
                        onClick={() => !tracked && addProjectMutation.mutate(p)}
                        disabled={tracked || addProjectMutation.isPending}
                        className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex-shrink-0 ml-3 ${
                          tracked
                            ? 'text-green-600 bg-green-50 cursor-default'
                            : 'text-brand-600 bg-brand-50 hover:bg-brand-100 border border-brand-200'
                        }`}
                      >
                        {tracked ? (
                          <><CheckCircle2 size={13} /> Добавлен</>
                        ) : (
                          <><Plus size={13} /> Добавить</>
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

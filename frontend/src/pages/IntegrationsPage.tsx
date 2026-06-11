import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Save, TestTube2, CheckCircle2, XCircle, Eye, EyeOff,
} from 'lucide-react'
import api from '@/api/client'
import type { IntegrationSettings } from '@/types'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'

export default function IntegrationsPage() {
  const qc = useQueryClient() // still needed for mutation invalidation

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

        <div className="card p-4 bg-blue-50 border-blue-200">
          <p className="text-sm text-blue-800">
            Управление проектами перенесено в раздел{' '}
            <a href="/settings/projects" className="font-semibold underline hover:text-blue-600">
              Настройки → Проекты
            </a>
          </p>
        </div>

      </div>
    </div>
  )
}

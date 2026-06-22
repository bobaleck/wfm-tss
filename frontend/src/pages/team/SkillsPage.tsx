import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Pencil, Trash2, Save, UserCheck, X, Upload,
  Star, PhoneOutgoing, PhoneIncoming, PhoneCall, MessageCircle, Mail,
  ShoppingCart, ShieldCheck, HeartHandshake, Headset, ClipboardList,
  AlertTriangle, Megaphone, BadgeCheck, Database, ListChecks, Award,
  Target, ThumbsUp, Snowflake, Wrench, TrendingUp, Briefcase,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import api from '@/api/client'
import type { Skill, Employee } from '@/types'
import PageHeader from '@/components/common/PageHeader'
import { PageSpinner } from '@/components/ui/Spinner'
import Modal from '@/components/ui/Modal'
import EmptyState from '@/components/common/EmptyState'

// ─── Реестр иконок навыков ───────────────────────────────────────────────────
const ICON_REGISTRY: Record<string, LucideIcon> = {
  PhoneOutgoing, PhoneIncoming, PhoneCall, MessageCircle, Mail, ShoppingCart,
  ShieldCheck, HeartHandshake, Headset, ClipboardList, AlertTriangle, Megaphone,
  BadgeCheck, Database, ListChecks, Snowflake, Wrench, TrendingUp, Target,
  ThumbsUp, Award, Briefcase, Star,
}
const PICKER_ICONS = Object.keys(ICON_REGISTRY)

// Иконка по умолчанию для стандартных кодов навыков
const CODE_ICON: Record<string, string> = {
  OUTBOUND: 'PhoneOutgoing',
  INBOUND: 'PhoneIncoming',
  COLD_CALL: 'Snowflake',
  CHAT: 'MessageCircle',
  EMAIL: 'Mail',
  CROSS_SELL: 'ShoppingCart',
  OBJECTIONS: 'ShieldCheck',
  RETENTION: 'HeartHandshake',
  TECH_SUPPORT: 'Headset',
  ORDERS: 'ClipboardList',
  COMPLAINTS: 'AlertTriangle',
  TELEMARKETING: 'Megaphone',
  VERIFICATION: 'BadgeCheck',
  CRM: 'Database',
  SURVEYS: 'ListChecks',
}

function resolveIconKey(icon: string | null | undefined, code: string | null | undefined): string | null {
  if (icon && !icon.startsWith('data:') && ICON_REGISTRY[icon]) return icon
  if (code && CODE_ICON[code.toUpperCase()]) return CODE_ICON[code.toUpperCase()]
  return null
}

function SkillIcon({ icon, code, size = 18, className = '' }: {
  icon?: string | null; code?: string | null; size?: number; className?: string
}) {
  if (icon && icon.startsWith('data:')) {
    return <img src={icon} alt="" className={`object-contain rounded ${className}`} style={{ width: size, height: size }} />
  }
  const key = resolveIconKey(icon, code)
  const Cmp = key ? ICON_REGISTRY[key] : Star
  return <Cmp size={size} className={className} />
}

// Загруженную картинку ужимаем до 64×64 PNG, чтобы не раздувать БД.
function fileToIconDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const s = 64
        const canvas = document.createElement('canvas')
        canvas.width = s; canvas.height = s
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(reader.result as string); return }
        const scale = Math.min(s / img.width, s / img.height)
        const w = img.width * scale, h = img.height * scale
        ctx.drawImage(img, (s - w) / 2, (s - h) / 2, w, h)
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = reject
      img.src = reader.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function SkillForm({ skill, onClose }: { skill?: Skill | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: skill?.name ?? '',
    code: skill?.code ?? '',
    description: skill?.description ?? '',
    icon: skill?.icon ?? '',
  })
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: (d: any) => skill ? api.put(`/skills/${skill.id}`, d) : api.post('/skills', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['skills'] }); onClose() },
    onError: (e: any) => setError(e.response?.data?.detail || 'Ошибка'),
  })

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const url = await fileToIconDataUrl(file)
      setForm((f) => ({ ...f, icon: url }))
    } catch {
      setError('Не удалось загрузить изображение')
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); mutation.mutate({ ...form, icon: form.icon || null }) }} className="space-y-5">
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Параметры навыка</p>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="label">Название *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Продажи входящие" />
          </div>
          <div>
            <label className="label">Код <span className="text-slate-400 font-normal">(краткое обозначение)</span></label>
            <input className="input font-mono" value={form.code} placeholder="SALES_IN" onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </div>

          {/* Иконка */}
          <div>
            <label className="label">Иконка</label>
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center flex-shrink-0 text-purple-600 overflow-hidden">
                <SkillIcon icon={form.icon || null} code={form.code || null} size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="grid grid-cols-8 gap-1.5">
                  {PICKER_ICONS.map((key) => {
                    const Cmp = ICON_REGISTRY[key]
                    const active = form.icon === key
                    return (
                      <button
                        key={key}
                        type="button"
                        title={key}
                        onClick={() => setForm({ ...form, icon: key })}
                        className={`h-8 rounded-lg flex items-center justify-center border transition-colors ${
                          active ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        <Cmp size={15} />
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-brand-700 cursor-pointer">
                    <Upload size={13} /> Загрузить свою
                    <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
                  </label>
                  {form.icon && (
                    <button type="button" onClick={() => setForm({ ...form, icon: '' })} className="text-xs text-slate-400 hover:text-red-500">
                      Сбросить
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="label">Описание</label>
            <textarea className="input" rows={2} value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Краткое описание навыка..." />
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-secondary">Отмена</button>
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          <Save size={14} /> {mutation.isPending ? 'Сохраняем...' : 'Сохранить'}
        </button>
      </div>
    </form>
  )
}

// ─── Модальное окно управления сотрудниками навыка ───────────────────────────
function SkillMembersModal({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const qc = useQueryClient()
  const [addId, setAddId] = useState<number | ''>('')

  const { data: allEmployees, isLoading } = useQuery({
    queryKey: ['employees-all-skills'],
    queryFn: () => api.get('/employees', { params: { limit: 500 } }).then((r) => r.data as Employee[]),
  })

  const withSkill = (allEmployees || []).filter((e) => e.skills.some((s) => s.skill_id === skill.id))
  const withoutSkill = (allEmployees || []).filter((e) => !e.skills.some((s) => s.skill_id === skill.id) && e.employment_status !== 'fired')

  const addMutation = useMutation({
    mutationFn: async (empId: number) => {
      const emp = allEmployees?.find((e) => e.id === empId)
      const ids = [...(emp?.skills.map((s) => s.skill_id) || []), skill.id]
      return api.put(`/employees/${empId}`, { skill_ids: ids })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees-all-skills', 'employees', 'skills'] })
      setAddId('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: async (empId: number) => {
      const emp = allEmployees?.find((e) => e.id === empId)
      const ids = (emp?.skills || []).filter((s) => s.skill_id !== skill.id).map((s) => s.skill_id)
      return api.put(`/employees/${empId}`, { skill_ids: ids })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employees-all-skills', 'employees', 'skills'] }),
  })

  return (
    <div className="space-y-4">
      {/* Текущие сотрудники */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Сотрудники с навыком ({withSkill.length})
        </p>
        {isLoading ? (
          <PageSpinner />
        ) : withSkill.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">Нет назначенных сотрудников</p>
        ) : (
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {withSkill.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-slate-50">
                <div>
                  <p className="text-sm font-medium text-slate-800">{e.full_name}</p>
                  <p className="text-xs text-slate-400">{e.position || '—'} · {e.team_name || 'Без команды'}</p>
                </div>
                <button
                  onClick={() => removeMutation.mutate(e.id)}
                  disabled={removeMutation.isPending}
                  className="p-1.5 hover:bg-red-50 rounded text-slate-400 hover:text-red-600"
                  title="Убрать навык"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Добавить сотрудника */}
      {withoutSkill.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Добавить сотрудника</p>
          <div className="flex gap-2">
            <select className="input flex-1" value={addId} onChange={(e) => setAddId(e.target.value ? +e.target.value : '')}>
              <option value="">— выберите сотрудника —</option>
              {withoutSkill.map((e) => (
                <option key={e.id} value={e.id}>{e.full_name}{e.team_name ? ` · ${e.team_name}` : ''}</option>
              ))}
            </select>
            <button
              onClick={() => addId !== '' && addMutation.mutate(+addId)}
              disabled={addId === '' || addMutation.isPending}
              className="btn-primary"
            >
              <UserCheck size={14} /> Добавить
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button onClick={onClose} className="btn-secondary">Закрыть</button>
      </div>
    </div>
  )
}

export default function SkillsPage() {
  const [showForm, setShowForm] = useState(false)
  const [editSkill, setEditSkill] = useState<Skill | null>(null)
  const [manageSkill, setManageSkill] = useState<Skill | null>(null)
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['skills'],
    queryFn: () => api.get('/skills').then((r) => r.data as Skill[]),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/skills/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['skills'] }),
  })

  return (
    <div>
      <PageHeader
        title="Навыки"
        subtitle="Навыки определяют, куда можно назначить оператора"
        actions={
          <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={16} /> Добавить</button>
        }
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {isLoading ? <PageSpinner /> : data?.length === 0 ? (
          <div className="col-span-full">
            <EmptyState title="Нет навыков" icon={<Star size={40} />}
              action={<button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> Добавить</button>} />
          </div>
        ) : data?.map((skill) => (
          <div key={skill.id} className="card p-4 flex flex-col">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0 text-purple-600 overflow-hidden">
                <SkillIcon icon={skill.icon} code={skill.code} size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-slate-900 text-sm truncate">{skill.name}</h3>
                {skill.code && <p className="text-[11px] text-slate-400 truncate font-mono">{skill.code}</p>}
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button onClick={() => setEditSkill(skill)} className="p-1 hover:bg-blue-50 rounded text-slate-400 hover:text-blue-600"><Pencil size={13} /></button>
                <button onClick={() => confirm(`Удалить навык "${skill.name}"?`) && deleteMutation.mutate(skill.id)}
                  className="p-1 hover:bg-red-50 rounded text-slate-400 hover:text-red-600"><Trash2 size={13} /></button>
              </div>
            </div>
            {skill.description && <p className="text-xs text-slate-500 mt-2 line-clamp-2">{skill.description}</p>}
            <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-400">{skill.employee_count} сотр.</span>
              <button
                onClick={() => setManageSkill(skill)}
                className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium"
              >
                <UserCheck size={12} /> Управлять
              </button>
            </div>
          </div>
        ))}
      </div>

      {showForm && <Modal open title="Новый навык" onClose={() => setShowForm(false)}><SkillForm onClose={() => setShowForm(false)} /></Modal>}
      {editSkill && <Modal open title="Редактировать навык" onClose={() => setEditSkill(null)}><SkillForm skill={editSkill} onClose={() => setEditSkill(null)} /></Modal>}
      {manageSkill && (
        <Modal open title={`Сотрудники — ${manageSkill.name}`} onClose={() => setManageSkill(null)}>
          <SkillMembersModal skill={manageSkill} onClose={() => setManageSkill(null)} />
        </Modal>
      )}
    </div>
  )
}

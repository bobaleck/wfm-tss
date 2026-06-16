import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/api/client'

export type StatusGroup = 'work' | 'pause' | 'offline'

export interface StatusConfigItem {
  status_name: string
  classification: StatusGroup
  label?: string | null
}

// Единая классификация статусов Naumen — используется и в Онлайн-мониторинге,
// и в истории смен, чтобы оба представления считали одинаково.
// Должна совпадать с backend/app/services/status_classification.py.
export const STANDARD_LABEL: Record<string, string> = {
  normal: 'В линии',
  ready: 'Готов',
  available: 'Доступен',
  online: 'В линии',
  ringing: 'Вызов',
  speaking: 'Разговор',
  inservice: 'Обслуживание',
  'ringing#voice': 'Вызов',
  'speaking#voice': 'Разговор',
  wrapup: 'После звонка',
  'wrapup#voice': 'После звонка',
  acw: 'После звонка',
  break: 'Перерыв',
  lunch: 'Обед',
  training: 'Обучение',
  meeting: 'Совещание',
  not_ready: 'Не готов',
  dnd: 'Не беспокоить',
  busy: 'Занят',
  away: 'Отсутствует',
  notavailable: 'Недоступен',
  not_available: 'Недоступен',
  offline: 'Офлайн',
  logged_out: 'Вышел',
  signedoff: 'Вышел',
  loggedoff: 'Вышел',
  disconnected: 'Отключён',
}

export const STANDARD_COLOR: Record<string, string> = {
  normal: 'bg-green-100 text-green-700',
  ready: 'bg-emerald-100 text-emerald-700',
  available: 'bg-teal-100 text-teal-700',
  online: 'bg-green-100 text-green-700',
  ringing: 'bg-cyan-100 text-cyan-700',
  speaking: 'bg-blue-100 text-blue-700',
  inservice: 'bg-blue-100 text-blue-700',
  'ringing#voice': 'bg-cyan-100 text-cyan-700',
  'speaking#voice': 'bg-blue-100 text-blue-700',
  wrapup: 'bg-sky-100 text-sky-700',
  'wrapup#voice': 'bg-sky-100 text-sky-700',
  acw: 'bg-sky-100 text-sky-700',
  break: 'bg-yellow-100 text-yellow-700',
  lunch: 'bg-orange-100 text-orange-700',
  training: 'bg-purple-100 text-purple-700',
  meeting: 'bg-purple-100 text-purple-700',
  not_ready: 'bg-red-100 text-red-600',
  dnd: 'bg-rose-100 text-rose-700',
  busy: 'bg-rose-100 text-rose-700',
  away: 'bg-amber-100 text-amber-700',
  notavailable: 'bg-red-100 text-red-600',
  not_available: 'bg-red-100 text-red-600',
  offline: 'bg-slate-100 text-slate-500',
  logged_out: 'bg-slate-100 text-slate-400',
  signedoff: 'bg-slate-100 text-slate-400',
  loggedoff: 'bg-slate-100 text-slate-400',
  disconnected: 'bg-slate-100 text-slate-400',
}

export const STANDARD_WORK = new Set([
  'normal', 'ready', 'available', 'online', 'ringing', 'ringing#voice',
  'speaking', 'speaking#voice', 'inservice', 'wrapup', 'wrapup#voice', 'acw',
])
export const STANDARD_PAUSE = new Set([
  'break', 'lunch', 'training', 'meeting', 'not_ready', 'dnd', 'busy',
])
export const STANDARD_OFFLINE = new Set([
  'offline', 'logged_out', 'signedoff', 'loggedoff', 'disconnected',
  'away', 'notavailable', 'not_available',
])

// Если оператор дольше WRAPUP_STALE_SEC сидит в статусе "После звонка" —
// считаем это паузой (а не работой) и подсвечиваем красным. Та же логика
// применяется на backend для агрегатов (см. status_classification.py).
export const WRAPUP_STATUSES = new Set(['wrapup', 'wrapup#voice', 'acw'])
export const WRAPUP_STALE_SEC = 600

export function isStaleWrapup(status: string, durationSec?: number): boolean {
  if (durationSec == null) return false
  return WRAPUP_STATUSES.has(status.toLowerCase()) && durationSec > WRAPUP_STALE_SEC
}

export function isStandardStatus(status: string): boolean {
  const k = status.toLowerCase()
  return STANDARD_WORK.has(k) || STANDARD_PAUSE.has(k) || STANDARD_OFFLINE.has(k)
}

export function standardGroup(status: string): StatusGroup | null {
  const k = status.toLowerCase()
  if (STANDARD_WORK.has(k)) return 'work'
  if (STANDARD_OFFLINE.has(k)) return 'offline'
  if (STANDARD_PAUSE.has(k)) return 'pause'
  return null
}

export interface StatusClassifier {
  classify: (status: string, durationSec?: number) => StatusGroup
  label: (status: string, durationSec?: number) => string
  color: (status: string, durationSec?: number) => string
}

export function buildClassifier(configs: StatusConfigItem[] | undefined): StatusClassifier {
  const classMap: Record<string, StatusGroup> = {}
  const labelMap: Record<string, string> = {}
  for (const c of configs || []) {
    classMap[c.status_name.toLowerCase()] = c.classification
    if (c.label) labelMap[c.status_name.toLowerCase()] = c.label
  }

  function classify(status: string, durationSec?: number): StatusGroup {
    const k = status.toLowerCase()
    if (isStaleWrapup(k, durationSec)) return 'pause'
    const std = standardGroup(k)
    if (std) return std
    return classMap[k] || 'pause'
  }

  function label(status: string, durationSec?: number): string {
    const k = status.toLowerCase()
    const base = labelMap[k] || STANDARD_LABEL[k] || (k.startsWith('custom') ? `Перерыв (${status})` : status)
    return isStaleWrapup(k, durationSec) ? `${base} (просрочено)` : base
  }

  function color(status: string, durationSec?: number): string {
    const k = status.toLowerCase()
    if (isStaleWrapup(k, durationSec)) return 'bg-red-100 text-red-700 ring-1 ring-red-300'
    if (STANDARD_COLOR[k]) return STANDARD_COLOR[k]
    if (k.startsWith('custom')) return 'bg-amber-100 text-amber-700'
    return 'bg-slate-100 text-slate-500'
  }

  return { classify, label, color }
}

// Хук для использования в страницах: подгружает индивидуальные настройки
// статусов проекта и возвращает готовый классификатор (work/pause/offline).
export function useStatusClassifier(partnerUuid: string | undefined): StatusClassifier {
  const { data } = useQuery({
    queryKey: ['status-configs', partnerUuid],
    queryFn: () => api.get(`/status-configs/${partnerUuid}`).then((r) => r.data as StatusConfigItem[]),
    enabled: !!partnerUuid,
    staleTime: 5 * 60 * 1000,
  })
  return useMemo(() => buildClassifier(data), [data])
}

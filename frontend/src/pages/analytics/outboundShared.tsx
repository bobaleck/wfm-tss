import { useQuery } from '@tanstack/react-query'
import api from '@/api/client'
import QueueFilterDropdown from '@/components/common/QueueFilterDropdown'

export interface OutProject { project_uuid: string; name: string; channel?: string; status?: string; hidden?: boolean }

// Перевод кодов результата обзвона (attempt_result) в человеческие названия.
// Системные/транслитерированные коды переводим по словарю; уже русские —
// оставляем как есть; неизвестные — «очеловечиваем» (подчёркивания → пробелы).
const OUTCOME_RU: Record<string, string> = {
  vopros_reshen: 'Вопрос решён', perezvon: 'Перезвон', callback: 'Перезвон',
  otkaz: 'Отказ', otkaz_na_privetstvii: 'Отказ на приветствии',
  uspeh: 'Успех', uspeshnyi: 'Успех', uspeshnyi_lid: 'Успешный лид', success: 'Успех',
  nedozvon: 'Недозвон', dozvon: 'Дозвон', dubl: 'Дубль',
  net_interesa: 'Нет интереса', not_interested: 'Нет интереса',
  ne_dozvonilis: 'Не дозвонились', avtootvetchik: 'Автоответчик', amd: 'Автоответчик',
  zanyato: 'Занято', busy: 'Занято', no_answer: 'Нет ответа',
  rejected: 'Сброшен', cancel: 'Отменён', wrong_number: 'Неверный номер',
  unknown_error: 'Ошибка связи', error: 'Ошибка', refused: 'Отказ',
}

export function outboundResultLabel(code: string | null | undefined): string {
  if (!code || code === '—') return '—'
  const key = String(code).toLowerCase().trim()
  if (OUTCOME_RU[key]) return OUTCOME_RU[key]
  if (/[а-яё]/i.test(code)) return code               // уже на русском
  const h = String(code).replace(/[_-]+/g, ' ').trim() // очеловечиваем код
  return h.charAt(0).toUpperCase() + h.slice(1)
}

// Список исходящих подпроектов («очередей» обзвона) партнёра.
export function useOutboundProjects(partnerUuid?: string) {
  return useQuery({
    queryKey: ['outbound-projects', partnerUuid],
    queryFn: () => api.get('/analytics/outbound-projects', { params: { partner_uuid: partnerUuid } }).then((r) => r.data.data as OutProject[]),
    enabled: !!partnerUuid,
    staleTime: 10 * 60 * 1000,
  })
}

// Параметры запроса с фильтром по подпроектам (project_ids). Сериализуем массив
// как repeat (без индексов), чтобы FastAPI прочитал list[str].
export function outboundParams(partnerUuid: string | undefined, begin: string, end: string, projectIds: string[]) {
  return {
    params: { partner_uuid: partnerUuid, begin, end, project_ids: projectIds },
    paramsSerializer: { indexes: null as null },
  }
}

// Видимые подпроекты (без скрытых) и эффективный набор id для запроса:
// если ничего не выбрано — берём все видимые (когда есть скрытые, иначе пусто =
// без фильтра, быстрее); если выбраны — берём выбранные.
export function effectiveProjectIds(projects: OutProject[], selected: Set<string>): string[] {
  if (selected.size > 0) return [...selected]
  const anyHidden = projects.some((p) => p.hidden)
  if (!anyHidden) return []
  const visible = projects.filter((p) => !p.hidden).map((p) => p.project_uuid)
  return visible.length ? visible : ['__none__']   // все скрыты → пустой результат
}

// Фильтр по исходящим подпроектам (значения — uuid, подписи — названия).
export default function OutboundProjectFilter({ projects, selected, onChange }: {
  projects: OutProject[]; selected: Set<string>; onChange: (s: Set<string>) => void
}) {
  if (projects.length <= 1) return null
  const nameByUuid: Record<string, string> = {}
  for (const p of projects) nameByUuid[p.project_uuid] = p.name
  return (
    <QueueFilterDropdown
      queues={projects.map((p) => p.project_uuid)}
      selected={selected}
      onChange={onChange}
      label=""
      align="right"
      allLabel="Все подпроекты"
      title="Фильтр по подпроектам"
      itemLabel={(v) => nameByUuid[v] || v}
    />
  )
}

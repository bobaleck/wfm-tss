import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useProjectStore } from '@/store/project'
import api from '@/api/client'
import PageHeader from '@/components/common/PageHeader'
import { AlertCircle, Download, Loader2 } from 'lucide-react'
import { format, subDays } from 'date-fns'

function csvBlob(headers: string[], rows: (string | number | null | undefined)[][]): Blob {
  const lines = [headers, ...rows].map((r) =>
    r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')
  )
  return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

interface ReportCardProps {
  title: string
  desc: string
  icon: string
  projectRequired?: boolean
  onGenerate: (begin: string, end: string) => Promise<void>
  generating: boolean
  defaultBegin?: string
  defaultEnd?: string
}

function ReportCard({ title, desc, icon, projectRequired, onGenerate, generating, defaultBegin, defaultEnd }: ReportCardProps) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [begin, setBegin] = useState(defaultBegin || format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [end, setEnd] = useState(defaultEnd || today)
  const { activeProject } = useProjectStore()

  const disabled = generating || (projectRequired && !activeProject)

  return (
    <div className="card p-5 flex flex-col gap-4">
      <div>
        <div className="text-3xl mb-2">{icon}</div>
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-500 mt-1">{desc}</p>
        {projectRequired && !activeProject && (
          <p className="text-xs text-amber-600 mt-1 flex items-center gap-1"><AlertCircle size={11} /> Выберите проект</p>
        )}
      </div>
      <div className="flex gap-2 items-end flex-wrap mt-auto">
        <div><label className="label">С</label><input type="date" className="input w-36" value={begin} onChange={(e) => setBegin(e.target.value)} /></div>
        <div><label className="label">По</label><input type="date" className="input w-36" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        <button
          onClick={() => onGenerate(begin, end)}
          disabled={disabled}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {generating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Выгрузить CSV
        </button>
      </div>
    </div>
  )
}

export default function ReportsPage() {
  const { activeProject } = useProjectStore()
  const [loadingReport, setLoadingReport] = useState<string | null>(null)

  const run = (key: string, fn: (b: string, e: string) => Promise<void>) => async (begin: string, end: string) => {
    setLoadingReport(key)
    try { await fn(begin, end) }
    catch (e: any) { alert(`Ошибка: ${(e as any).message || 'не удалось получить данные'}`) }
    finally { setLoadingReport(null) }
  }

  const genWorkload = async (begin: string, end: string) => {
    const r = await api.get('/analytics/workload', { params: { partner_uuid: activeProject!.customer_uuid, begin, end, interval: 'day' } })
    const rows = (r.data.data as any[]).map((d) => [d.period_start?.slice(0, 10), d.queue_name, d.total, d.handled, d.lost, d.avg_talk_sec ?? '', d.sl_percent ?? ''])
    download(csvBlob(['Дата', 'Очередь', 'Поступило', 'Обработано', 'Потеряно', 'АНТ (с)', 'SL (%)'], rows), `workload_${begin}_${end}.csv`)
  }

  const genOperatorLoad = async (begin: string, end: string) => {
    const r = await api.get('/analytics/operator-load', { params: { partner_uuid: activeProject!.customer_uuid, begin, end } })
    const rows = (r.data.data as any[]).map((d) => [d.login, d.employee_name ?? '', d.position ?? '', d.handled_calls, d.avg_talk_sec ?? '', d.total_talk_sec ?? '', d.avg_answer_sec ?? '', d.sl_percent ?? '', d.idle_sec != null ? Math.round(d.idle_sec / 60) : ''])
    download(csvBlob(['Логин', 'ФИО', 'Должность', 'Звонков', 'АНТ (с)', 'Всего разговоров (с)', 'Ср. ответ (с)', 'SL (%)', 'Простой (мин)'], rows), `operator_load_${begin}_${end}.csv`)
  }

  const genStatusSummary = async (begin: string, end: string) => {
    const r = await api.get('/analytics/status-summary', { params: { partner_uuid: activeProject!.customer_uuid, begin, end } })
    const rows = (r.data.data as any[]).map((d) => [d.login, d.employee_name ?? '', d.status ?? '', d.total_sec != null ? Math.round(d.total_sec / 60) : '', d.share_pct ?? ''])
    download(csvBlob(['Логин', 'ФИО', 'Статус', 'Минут', 'Доля (%)'], rows), `status_summary_${begin}_${end}.csv`)
  }

  const genShifts = async (begin: string, end: string) => {
    const r = await api.get('/schedules/shifts', { params: { date_from: begin, date_to: end } })
    const statuses: Record<string, string> = { planned: 'Запланирована', confirmed: 'Подтверждена', completed: 'Завершена', cancelled: 'Отменена' }
    const rows = (r.data as any[]).map((s) => [
      s.employee_name ?? '', s.shift_date, s.start_time?.slice(11, 16) ?? '', s.end_time?.slice(11, 16) ?? '',
      s.actual_start_time?.slice(11, 16) ?? '', s.actual_end_time?.slice(11, 16) ?? '', s.actual_hours_worked ?? '',
      statuses[s.status] || s.status, s.needs_review ? 'Да' : 'Нет', s.schedule_name ?? '', s.notes ?? '',
    ])
    download(csvBlob(['ФИО', 'Дата', 'Нач. план', 'Кон. план', 'Нач. факт', 'Кон. факт', 'Отработано ч', 'Статус', 'Расхождение', 'График', 'Примечание'], rows), `shifts_${begin}_${end}.csv`)
  }

  const genAbsences = async (begin: string, end: string) => {
    const r = await api.get('/schedules/absences', { params: { date_from: begin, date_to: end } })
    const types: Record<string, string> = { vacation: 'Отпуск', sick: 'Больничный', personal: 'Личные', training: 'Обучение', other: 'Другое' }
    const rows = (r.data as any[]).map((a: any) => [
      a.employee_name ?? '', types[a.absence_type] || a.absence_type, a.start_date, a.end_date, a.approved ? 'Да' : 'Нет', a.notes ?? '',
    ])
    download(csvBlob(['ФИО', 'Тип', 'Начало', 'Конец', 'Согласовано', 'Примечание'], rows), `absences_${begin}_${end}.csv`)
  }

  const genNaumenSessions = async (begin: string, end: string) => {
    const r = await api.get('/analytics/operator-sessions', { params: { partner_uuid: activeProject!.customer_uuid, begin, end } })
    const rows = (r.data.data as any[]).map((s: any) => [
      s.employee_name ?? s.login, s.login, s.work_date,
      s.first_login?.slice(11, 16) ?? '', s.last_logout?.slice(11, 16) ?? '',
      s.normal_sec != null ? Math.round(s.normal_sec / 60) : '',
      s.non_normal_sec != null ? Math.round(s.non_normal_sec / 60) : '',
      s.break_count ?? '', s.statuses_seen ?? '',
    ])
    download(csvBlob(['ФИО', 'Логин', 'Дата', 'Первый вход', 'Последний выход', 'В линии (мин)', 'Паузы (мин)', 'Кол-во пауз', 'Статусы'], rows), `naumen_sessions_${begin}_${end}.csv`)
  }

  return (
    <div>
      <PageHeader title="Отчёты" subtitle="Формирование и выгрузка отчётов в CSV" />

      {!activeProject && (
        <div className="card p-4 mb-6 flex items-center gap-3 bg-amber-50 border-amber-200">
          <AlertCircle size={18} className="text-amber-500" />
          <p className="text-sm text-amber-800">Для отчётов с данными Naumen (нагрузка, операторы, сессии) необходимо выбрать проект в шапке</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <ReportCard
          title="Нагрузка по очередям"
          desc="Входящие звонки по каждой очереди за период: всего, обработано, потеряно, АНТ, SL"
          icon="📞"
          projectRequired
          generating={loadingReport === 'workload'}
          onGenerate={run('workload', genWorkload)}
        />
        <ReportCard
          title="Производительность операторов"
          desc="Обработка звонков, АНТ, SL, простой по каждому оператору"
          icon="👤"
          projectRequired
          generating={loadingReport === 'operator'}
          onGenerate={run('operator', genOperatorLoad)}
        />
        <ReportCard
          title="Статусы операторов"
          desc="Время (в минутах) в каждом статусе Naumen за период"
          icon="🕐"
          projectRequired
          generating={loadingReport === 'status'}
          onGenerate={run('status', genStatusSummary)}
        />
        <ReportCard
          title="Сессии из Naumen"
          desc="Первый вход, последний выход, время в линии и на паузах по каждому оператору"
          icon="📋"
          projectRequired
          generating={loadingReport === 'sessions'}
          onGenerate={run('sessions', genNaumenSessions)}
        />
        <ReportCard
          title="Смены сотрудников"
          desc="Плановые и фактические смены: часы работы, расхождения с Naumen"
          icon="📅"
          generating={loadingReport === 'shifts'}
          onGenerate={run('shifts', genShifts)}
        />
        <ReportCard
          title="Отсутствия"
          desc="Отпуска, больничные и прочие отсутствия с типом и статусом согласования"
          icon="🗓️"
          generating={loadingReport === 'absences'}
          onGenerate={run('absences', genAbsences)}
        />
      </div>
    </div>
  )
}

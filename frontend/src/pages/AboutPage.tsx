import PageHeader from '@/components/common/PageHeader'

export default function AboutPage() {
  return (
    <div>
      <PageHeader title="О системе" />
      <div className="max-w-2xl space-y-6">
        <div className="card p-8 text-center">
          <div className="flex items-center justify-center mb-5">
            <img src="/favicon.svg" alt="Логотип" className="h-14 w-auto" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">WFM Платформа</h1>
          <p className="text-slate-500 mt-1">Телесейлз-Сервис</p>
          <div className="mt-4 inline-flex items-center gap-2 bg-slate-100 rounded-full px-4 py-1.5">
            <span className="text-xs font-medium text-slate-600">Версия 1.0.0</span>
          </div>
        </div>
        <div className="card p-6">
          <h2 className="font-semibold text-slate-900 mb-4">О платформе</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <p>WFM (Workforce Management) платформа разработана для компании <strong>Телесейлз-Сервис</strong> — управления персоналом, планирования рабочего времени и аналитики операционной деятельности контакт-центра.</p>
            <p>Система интегрирована с <strong>Naumen Contact Center (NCC)</strong> — данные о проектах, очередях, нагрузке и операторах синхронизируются в реальном времени через PostgreSQL-базу и REST API.</p>
          </div>
        </div>
        <div className="card p-6">
          <h2 className="font-semibold text-slate-900 mb-4">Функциональность</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['Управление командой', 'Сотрудники, команды, навыки'],
              ['Аналитика Naumen', 'Очереди, нагрузка, SL, операторы'],
              ['Рабочее время', 'Графики, смены, отсутствия'],
              ['Интеграция NCC', 'PostgreSQL + REST API v2'],
              ['Ролевая модель', 'admin, manager, analyst, viewer'],
              ['Мультипроект', 'Выбор активного проекта/заказчика'],
            ].map(([title, desc]) => (
              <div key={title} className="flex gap-2">
                <span className="text-brand-500 mt-0.5">✓</span>
                <div>
                  <p className="font-medium text-slate-800">{title}</p>
                  <p className="text-slate-500 text-xs">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

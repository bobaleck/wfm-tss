import { useAuthStore } from '@/store/auth'
import PageHeader from '@/components/common/PageHeader'

interface Section { title: string; items: string[]; roles: string[] }

const sections: Section[] = [
  {
    title: '1. Первый запуск',
    roles: ['admin'],
    items: [
      'Установите Python 3.11+ и Node.js 18+',
      'В папке backend скопируйте .env.example → .env и заполните данные Naumen',
      'Запустите backend: pip install -r requirements.txt && python run.py',
      'Запустите frontend: npm install && npm run dev',
      'Откройте http://localhost:5173, войдите как admin / admin123',
    ],
  },
  {
    title: '2. Настройка интеграции',
    roles: ['admin'],
    items: [
      'Перейдите в раздел «Интеграции»',
      'Введите хост, имя базы, пользователя и пароль Naumen PostgreSQL',
      'Нажмите «Проверить соединение» — должно появиться «Соединение успешно»',
      'Сохраните настройки — проекты и очереди загрузятся автоматически',
    ],
  },
  {
    title: '3. Работа с командой',
    roles: ['admin', 'manager'],
    items: [
      'Нажмите «Синхронизировать» на странице Сотрудников, чтобы подтянуть список из Naumen',
      'Новые сотрудники появятся со статусом «Новый» — переведите в «Работает» при необходимости',
      'Сотрудники, не выходившие в линию более 30 дней, автоматически получают статус «Уволен»',
      'Создайте команды (Управление → Отдел → Группа) и добавьте сотрудников',
      'Назначьте навыки операторам — они показывают, к каким каналам допущен оператор',
    ],
  },
  {
    title: '4. Аналитика',
    roles: ['admin', 'manager', 'analyst'],
    items: [
      'Выберите активный проект в шапке страницы',
      'Раздел «Очереди» — список очередей с SL-параметрами и детализация нагрузки за период',
      'Раздел «Нагрузка» — динамика звонков по дням/часам с графиком',
      'Раздел «Нагрузка операторов» — показатели каждого оператора (звонки, АНТ, SL, простой)',
      'Раздел «Смены → Данные из Naumen» — история входов/выходов/пауз операторов по датам',
    ],
  },
  {
    title: '5. Рабочее время',
    roles: ['admin', 'manager'],
    items: [
      'Создайте шаблоны графиков в разделе «Графики» (Рабочее время)',
      'Назначайте смены сотрудникам в разделе «Смены»',
      'Нажмите «Сверить» для сверки вчерашних смен с Naumen — факт. часы подтянутся автоматически',
      'Смены с расхождением >1ч отмечаются иконкой ⚠ — подтвердите их вручную',
      'Фиксируйте отсутствия (отпуска, больничные) в разделе «Отсутствия»',
      'Выгружайте смены в CSV через кнопку «Excel» для обработки в таблицах',
    ],
  },
  {
    title: '6. Просмотр данных',
    roles: ['viewer'],
    items: [
      'Выберите проект в шапке страницы — без этого данные не отображаются',
      'В разделе «Сводка» вы видите ключевые показатели по проекту за последние 7 дней',
      'В разделе «Аналитика» доступна статистика очередей и операторов',
      'Для запроса изменений (смены, отсутствия) обратитесь к менеджеру',
    ],
  },
  {
    title: '7. Безопасность',
    roles: ['admin'],
    items: [
      'Смените пароль admin в разделе «Настройки» после первого входа',
      'Создайте пользователей с минимально необходимыми правами (manager/analyst/viewer)',
      'Пароли от Naumen хранятся зашифрованными, никогда не передаются в браузер',
      'Все SQL-запросы к Naumen — только read-only',
    ],
  },
]

export default function DocsPage() {
  const { user } = useAuthStore()
  const role = user?.role || 'viewer'

  const visible = sections.filter((s) => s.roles.includes(role))

  return (
    <div>
      <PageHeader
        title="Документация"
        subtitle={`Руководство пользователя · роль: ${role}`}
      />
      <div className="max-w-3xl space-y-4">
        {visible.map((s) => (
          <div key={s.title} className="card p-6">
            <h2 className="font-semibold text-slate-900 mb-3">{s.title}</h2>
            <ol className="space-y-2">
              {s.items.map((item, i) => (
                <li key={i} className="flex gap-3 text-sm text-slate-600">
                  <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  {item}
                </li>
              ))}
            </ol>
          </div>
        ))}
        {visible.length === 0 && (
          <div className="card p-8 text-center text-slate-400">
            Документация для вашей роли ещё не добавлена. Обратитесь к администратору.
          </div>
        )}
      </div>
    </div>
  )
}

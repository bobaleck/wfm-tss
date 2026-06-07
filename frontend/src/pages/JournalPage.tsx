import PageHeader from '@/components/common/PageHeader'
import EmptyState from '@/components/common/EmptyState'
import { ScrollText } from 'lucide-react'

export default function JournalPage() {
  return (
    <div>
      <PageHeader title="Журнал действий" subtitle="История изменений в системе" />
      <div className="card">
        <EmptyState
          title="Журнал пуст"
          description="Здесь будут отображаться все действия пользователей: создание, редактирование и удаление данных"
          icon={<ScrollText size={40} />}
        />
      </div>
    </div>
  )
}

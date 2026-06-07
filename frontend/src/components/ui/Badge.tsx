import { clsx } from 'clsx'

type Color = 'blue' | 'green' | 'red' | 'yellow' | 'gray' | 'purple'

const map: Record<Color, string> = {
  blue:   'badge-blue',
  green:  'badge-green',
  red:    'badge-red',
  yellow: 'badge-yellow',
  gray:   'badge-gray',
  purple: 'badge-purple',
}

export default function Badge({ label, color = 'gray' }: { label: string; color?: Color }) {
  return <span className={clsx(map[color])}>{label}</span>
}

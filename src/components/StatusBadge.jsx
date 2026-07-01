const STYLES = {
  pending: 'bg-amber-100 text-amber-800',
  paid: 'bg-[#d6ede6] text-[#1b2d4f]',
  overdue: 'bg-red-100 text-red-800',
}

export default function StatusBadge({ status }) {
  const style = STYLES[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${style}`}>
      {status}
    </span>
  )
}

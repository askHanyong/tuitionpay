import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { buildPaymentNoticeMessage, formatSGD } from '../lib/paymentNotice'

export default function Payments() {
  const { user } = useAuth()
  const [cycles, setCycles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [copiedId, setCopiedId] = useState(null)

  const load = async () => {
    const { data, error } = await supabase
      .from('payment_cycles')
      .select('*, students(name, guardian_name, guardian_contact)')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    setCycles(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    const initialLoad = async () => {
      const { data, error } = await supabase
        .from('payment_cycles')
        .select('*, students(name, guardian_name, guardian_contact)')
        .order('created_at', { ascending: false })
      if (error) setError(error.message)
      setCycles(data ?? [])
      setLoading(false)
    }
    initialLoad()
  }, [])

  const handleCopy = async (cycle) => {
    const message = buildPaymentNoticeMessage({
      studentName: cycle.students?.name,
      amountDue: cycle.amount_due,
      periodStart: cycle.period_start,
      periodEnd: cycle.period_end,
      tutorName: user?.user_metadata?.full_name,
    })
    await navigator.clipboard.writeText(message)
    setCopiedId(cycle.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleMarkPaid = async (id) => {
    setError(null)
    const { error } = await supabase
      .from('payment_cycles')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    await load()
  }

  const pending = cycles.filter((c) => c.status === 'pending')
  const settled = cycles.filter((c) => c.status !== 'pending')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">Payments</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-6 py-8">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <section>
          <h2 className="mb-3 text-base font-semibold text-gray-900">
            Payment notices due {pending.length > 0 && `(${pending.length})`}
          </h2>
          {loading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : pending.length === 0 ? (
            <p className="text-sm text-gray-500">
              No payments due. A notice appears here automatically once a student
              accumulates 4 lessons.
            </p>
          ) : (
            <ul className="space-y-3">
              {pending.map((c) => (
                <li
                  key={c.id}
                  className="rounded-md border border-amber-200 bg-amber-50 p-4"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium text-gray-900">{c.students?.name}</span>
                    <span className="font-semibold text-gray-900">
                      {formatSGD(c.amount_due)}
                    </span>
                  </div>
                  <p className="mb-3 text-sm text-gray-600">
                    {c.period_start} to {c.period_end}
                    {c.students?.guardian_contact && ` · Contact: ${c.students.guardian_contact}`}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleCopy(c)}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                    >
                      {copiedId === c.id ? 'Copied!' : 'Copy payment notice'}
                    </button>
                    <button
                      onClick={() => handleMarkPaid(c.id)}
                      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    >
                      Mark as paid
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-gray-900">History</h2>
          {loading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : settled.length === 0 ? (
            <p className="text-sm text-gray-500">No settled payment cycles yet.</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Student</th>
                    <th className="px-4 py-2 font-medium">Period</th>
                    <th className="px-4 py-2 font-medium">Amount</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {settled.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-3 text-gray-900">{c.students?.name}</td>
                      <td className="px-4 py-3 text-gray-700">
                        {c.period_start} – {c.period_end}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{formatSGD(c.amount_due)}</td>
                      <td className="px-4 py-3 capitalize text-gray-700">{c.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

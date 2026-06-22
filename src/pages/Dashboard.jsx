import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

export default function Dashboard() {
  const { user, signOut } = useAuth()
  const [students, setStudents] = useState([])
  const [paymentCycles, setPaymentCycles] = useState([])
  const [loading, setLoading] = useState(true)
  const pendingCount = paymentCycles.filter((c) => c.status === 'pending').length

  useEffect(() => {
    const load = async () => {
      const [{ data: studentsData }, { data: cyclesData }] = await Promise.all([
        supabase.from('students').select('*').order('created_at', { ascending: false }),
        supabase
          .from('payment_cycles')
          .select('*, students(name)')
          .order('period_end', { ascending: false }),
      ])
      setStudents(studentsData ?? [])
      setPaymentCycles(cyclesData ?? [])
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-gray-900">TuitionPay Dashboard</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{user?.email}</span>
          <button
            onClick={signOut}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-8 px-6 py-8">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Students</h2>
            <Link to="/students" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
              Manage students →
            </Link>
          </div>
          {loading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : students.length === 0 ? (
            <p className="text-sm text-gray-500">No students yet.</p>
          ) : (
            <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
              {students.map((s) => (
                <li key={s.id} className="px-4 py-3 text-sm text-gray-700">
                  {s.name}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Lessons</h2>
            <Link to="/lessons" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
              Log a lesson →
            </Link>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">Payment Cycles</h2>
            <Link to="/payments" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
              {pendingCount > 0 ? `${pendingCount} notice${pendingCount > 1 ? 's' : ''} due →` : 'View payments →'}
            </Link>
          </div>
          {loading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : paymentCycles.length === 0 ? (
            <p className="text-sm text-gray-500">No payment cycles yet.</p>
          ) : (
            <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
              {paymentCycles.map((c) => (
                <li key={c.id} className="flex justify-between px-4 py-3 text-sm text-gray-700">
                  <span>{c.students?.name}</span>
                  <span>${c.amount_due} - {c.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

const emptyForm = { name: '', subject: '', hourly_rate: '', lesson_duration_hours: '' }

export default function Students() {
  const { user } = useAuth()
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const loadStudents = async () => {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    setStudents(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) setError(error.message)
      setStudents(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const resetForm = () => {
    setForm(emptyForm)
    setEditingId(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const payload = {
      name: form.name.trim(),
      subject: form.subject.trim() || null,
      hourly_rate: form.hourly_rate === '' ? null : Number(form.hourly_rate),
      lesson_duration_hours:
        form.lesson_duration_hours === '' ? null : Number(form.lesson_duration_hours),
    }

    try {
      if (editingId) {
        const { error } = await supabase
          .from('students')
          .update(payload)
          .eq('id', editingId)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('students')
          .insert({ ...payload, tutor_id: user.id })
        if (error) throw error
      }
      resetForm()
      await loadStudents()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = (student) => {
    setEditingId(student.id)
    setForm({
      name: student.name ?? '',
      subject: student.subject ?? '',
      hourly_rate: student.hourly_rate ?? '',
      lesson_duration_hours: student.lesson_duration_hours ?? '',
    })
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this student? This cannot be undone.')) return
    setError(null)
    const { error } = await supabase.from('students').delete().eq('id', id)
    if (error) {
      setError(error.message)
      return
    }
    if (editingId === id) resetForm()
    await loadStudents()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
            ← Dashboard
          </Link>
          <h1 className="text-lg font-semibold text-gray-900">Students</h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-6 py-8">
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-md border border-gray-200 bg-white p-5"
        >
          <h2 className="text-base font-semibold text-gray-900">
            {editingId ? 'Edit student' : 'Add a student'}
          </h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Subject</label>
              <input
                type="text"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Hourly rate (SGD)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.hourly_rate}
                onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Lesson duration (hours)
              </label>
              <input
                type="number"
                min="0"
                step="0.25"
                value={form.lesson_duration_hours}
                onChange={(e) => setForm({ ...form, lesson_duration_hours: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : editingId ? 'Save changes' : 'Add student'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <section>
          <h2 className="mb-3 text-base font-semibold text-gray-900">Your students</h2>
          {loading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : students.length === 0 ? (
            <p className="text-sm text-gray-500">No students yet.</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Subject</th>
                    <th className="px-4 py-2 font-medium">Rate (SGD/hr)</th>
                    <th className="px-4 py-2 font-medium">Duration (hrs)</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {students.map((s) => (
                    <tr key={s.id}>
                      <td className="px-4 py-3 text-gray-900">{s.name}</td>
                      <td className="px-4 py-3 text-gray-700">{s.subject || '—'}</td>
                      <td className="px-4 py-3 text-gray-700">
                        {s.hourly_rate != null ? `$${s.hourly_rate}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{s.lesson_duration_hours ?? '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleEdit(s)}
                          className="mr-3 font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(s.id)}
                          className="font-medium text-red-600 hover:text-red-700"
                        >
                          Delete
                        </button>
                      </td>
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

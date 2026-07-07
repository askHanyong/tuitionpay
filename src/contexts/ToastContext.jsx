import { createContext, useCallback, useContext, useState } from 'react'

const ToastContext = createContext(null)

const DURATION = { celebrate: 2500, success: 3000, error: 3000 }

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const showToast = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, message, type, entering: true }])
    // Remove entering flag after animation completes (~300ms)
    setTimeout(() => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, entering: false } : t)),
      )
    }, 300)
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, DURATION[type] ?? 3000)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              transition: 'opacity 280ms ease, transform 280ms ease',
              opacity: t.entering ? 0 : 1,
              transform: t.entering ? 'translateY(-10px)' : 'translateY(0)',
            }}
            className={`pointer-events-auto flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${
              t.type === 'celebrate'
                ? 'bg-[#1b2d4f] text-white'
                : t.type === 'error'
                  ? 'bg-red-600 text-white'
                  : 'bg-[#1b2d4f] text-white'
            }`}
          >
            {t.type === 'celebrate' && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  backgroundColor: '#5ecfaa',
                  flexShrink: 0,
                }}
              >
                <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                  <path
                    d="M1 4.5L4 7.5L10 1"
                    stroke="white"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            )}
            {t.type === 'error' && <span>⚠️</span>}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

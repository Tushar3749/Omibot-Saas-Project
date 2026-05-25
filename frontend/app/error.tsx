'use client'
import { useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
         style={{ backgroundColor: '#F9F9F9' }}>
      <div className="bg-white rounded-lg p-8 max-w-md w-full text-center"
           style={{ border: '1px solid #E0E0E0', boxShadow: '0 4px 8px rgba(0,0,0,0.06)' }}>
        <div className="w-14 h-14 rounded flex items-center justify-center mx-auto mb-4"
             style={{ backgroundColor: '#FFEBEE' }}>
          <AlertTriangle size={24} style={{ color: '#C62828' }} />
        </div>
        <h1 className="text-lg font-bold mb-2" style={{ color: '#282A35' }}>কিছু একটা ভুল হয়েছে</h1>
        <p className="text-sm mb-6" style={{ color: '#757575' }}>
          {error.message || 'An unexpected error occurred. Please try again.'}
        </p>
        <button onClick={reset} className="btn-primary gap-2 mx-auto">
          <RefreshCw size={15} />
          আবার চেষ্টা করুন
        </button>
      </div>
    </div>
  )
}

import Link from 'next/link'
import { Home, SearchX } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4"
         style={{ backgroundColor: '#F9F9F9' }}>
      <div className="bg-white rounded-lg p-8 max-w-md w-full text-center"
           style={{ border: '1px solid #E0E0E0', boxShadow: '0 4px 8px rgba(0,0,0,0.06)' }}>
        <div className="w-14 h-14 rounded flex items-center justify-center mx-auto mb-4"
             style={{ backgroundColor: '#F5F5F5' }}>
          <SearchX size={24} style={{ color: '#9E9E9E' }} />
        </div>
        <p className="text-5xl font-bold mb-2" style={{ color: '#E0E0E0' }}>404</p>
        <h1 className="text-lg font-bold mb-2" style={{ color: '#282A35' }}>পেজটি পাওয়া যায়নি</h1>
        <p className="text-sm mb-6" style={{ color: '#757575' }}>
          আপনি যে page খুঁজছেন সেটি সরানো হয়েছে বা কখনো ছিল না।
        </p>
        <Link href="/dashboard" className="btn-primary gap-2 inline-flex">
          <Home size={15} />
          Dashboard-এ ফিরে যান
        </Link>
      </div>
    </div>
  )
}

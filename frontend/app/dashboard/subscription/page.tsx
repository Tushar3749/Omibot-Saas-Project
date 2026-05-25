'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { paymentAPI } from '@/lib/api'
import { getStoredTenant, formatBDT, formatDate } from '@/lib/utils'
import { Check, CreditCard, Clock, Zap, X, AlertTriangle } from 'lucide-react'

const PLANS = [
  {
    id: 'starter', name: 'Starter', price: 2999,
    description: 'Small businesses starting with AI chatbots',
    features: [
      'Facebook Messenger',
      '৫,০০০ messages/মাস',
      '৫০০ products',
      '৩ মাস history',
      'Basic analytics',
      'Email support',
    ],
  },
  {
    id: 'pro', name: 'Pro', price: 5999, popular: true,
    description: 'Growing businesses that need more power',
    features: [
      'Messenger + Instagram DM',
      'Unlimited messages',
      'Unlimited products',
      '১ বছর history',
      'Full analytics',
      'Manual takeover',
      'Priority support',
    ],
  },
  {
    id: 'enterprise', name: 'Enterprise', price: 9999,
    description: 'Large operations with advanced requirements',
    features: [
      'সব channels',
      'Unlimited সব কিছু',
      'Unlimited history',
      'Custom analytics',
      'Manual takeover',
      '99.5% SLA uptime',
      'Dedicated manager',
    ],
  },
]

function ExpiredBanner() {
  const params  = useSearchParams()
  const expired = params.get('expired') === 'true'
  if (!expired) return null
  return (
    <div className="flex items-start gap-3 p-4 rounded mb-2"
         style={{ backgroundColor: '#FFEBEE', border: '1px solid #EF9A9A' }}>
      <AlertTriangle size={18} style={{ color: '#C62828', flexShrink: 0, marginTop: 1 }} />
      <div>
        <p className="text-sm font-semibold" style={{ color: '#C62828' }}>Subscription মেয়াদোত্তীর্ণ</p>
        <p className="text-xs mt-0.5" style={{ color: '#E53935' }}>
          আপনার plan-এর মেয়াদ শেষ হয়ে গেছে। Dashboard ব্যবহার করতে নিচের একটি plan নির্বাচন করুন।
        </p>
      </div>
    </div>
  )
}

export default function SubscriptionPage() {
  const tenant    = getStoredTenant()
  const [loading, setLoading]         = useState(false)
  const [history, setHistory]         = useState<Record<string, unknown>[]>([])
  const [payForm, setPayForm]         = useState({ plan: '', name: '', phone: '' })
  const [showPayForm, setShowPayForm] = useState(false)

  useEffect(() => {
    paymentAPI.history().then(setHistory).catch(() => {})
  }, [])

  async function initiate(plan: string) {
    if (!payForm.name || !payForm.phone) { toast.error('নাম ও phone নম্বর দিন'); return }
    setLoading(true)
    try {
      const res = await paymentAPI.initiate({ plan, customer_name: payForm.name, customer_phone: payForm.phone })
      if (res.payment_url) window.location.href = res.payment_url
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Payment শুরু করা যায়নি')
    } finally { setLoading(false) }
  }

  return (
    <div className="space-y-7 max-w-5xl">

      <Suspense fallback={null}>
        <ExpiredBanner />
      </Suspense>

      <div>
        <h1 className="page-title">Subscription</h1>
        <p className="page-subtitle">আপনার plan manage করুন</p>
      </div>

      {/* Current plan banner */}
      <div className="card p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded flex items-center justify-center"
               style={{ backgroundColor: '#E8F5E9' }}>
            <Zap size={18} style={{ color: '#04AA6D' }} />
          </div>
          <div>
            <p className="text-xs" style={{ color: '#9E9E9E' }}>Current plan</p>
            <p className="font-bold capitalize text-lg" style={{ color: '#282A35' }}>{String(tenant?.plan)}</p>
          </div>
        </div>
        {tenant?.plan_expires_at && (
          <div className="flex items-center gap-2 px-3.5 py-2 rounded text-sm"
               style={{ backgroundColor: '#FFF8E1', border: '1px solid #FFE082', color: '#F57F17' }}>
            <Clock size={14} />
            <span>Expires {formatDate(String(tenant.plan_expires_at))}</span>
          </div>
        )}
      </div>

      {/* Plans grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {PLANS.map(plan => {
          const isCurrent = tenant?.plan === plan.id
          return (
            <div
              key={plan.id}
              className="card p-6 relative flex flex-col transition-shadow hover:shadow-md"
              style={plan.popular ? { borderColor: '#04AA6D', boxShadow: '0 0 0 2px rgba(4,170,109,0.15)' } : {}}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="badge text-white px-3 py-1 shadow-sm text-xs"
                        style={{ backgroundColor: '#04AA6D' }}>
                    সবচেয়ে জনপ্রিয়
                  </span>
                </div>
              )}

              <div className="mb-5">
                <h3 className="font-bold text-lg mb-1" style={{ color: '#282A35' }}>{plan.name}</h3>
                <p className="text-sm" style={{ color: '#757575' }}>{plan.description}</p>
              </div>

              <div className="mb-5">
                <span className="text-3xl font-bold" style={{ color: '#282A35' }}>{formatBDT(plan.price)}</span>
                <span className="text-sm" style={{ color: '#9E9E9E' }}>/মাস</span>
              </div>

              <ul className="space-y-2.5 mb-6 flex-1">
                {plan.features.map(f => (
                  <li key={f} className="flex items-center gap-2.5 text-sm">
                    <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                         style={{ backgroundColor: '#E8F5E9' }}>
                      <Check size={10} style={{ color: '#04AA6D' }} />
                    </div>
                    <span style={{ color: '#424242' }}>{f}</span>
                  </li>
                ))}
              </ul>

              {isCurrent ? (
                <div className="w-full py-2.5 text-center rounded text-sm font-medium"
                     style={{ backgroundColor: '#F5F5F5', color: '#757575' }}>
                  ✓ Current Plan
                </div>
              ) : (
                <button
                  onClick={() => { setPayForm(f => ({ ...f, plan: plan.id })); setShowPayForm(true) }}
                  className="btn-primary w-full py-2.5"
                >
                  এই Plan নিন →
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Payment history */}
      {history.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3.5 border-b flex items-center gap-2"
               style={{ borderColor: '#E0E0E0' }}>
            <CreditCard size={16} style={{ color: '#9E9E9E' }} />
            <h2 className="font-semibold" style={{ color: '#282A35' }}>Payment History</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: '#F9F9F9', borderBottom: '1px solid #E0E0E0' }}>
                <tr>
                  {['Transaction ID', 'Plan', 'Amount', 'Status', 'Date'].map(h => (
                    <th key={h} className="th">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((t) => (
                  <tr key={String(t.transaction_id)} className="border-b transition-colors"
                      style={{ borderColor: '#F5F5F5' }}
                      onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.backgroundColor = '#FAFAFA'}
                      onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'transparent'}>
                    <td className="td font-mono text-xs" style={{ color: '#9E9E9E' }}>{String(t.tran_id)}</td>
                    <td className="td capitalize font-medium">{String(t.plan)}</td>
                    <td className="td font-bold" style={{ color: '#282A35' }}>{formatBDT(t.amount as number)}</td>
                    <td className="td">
                      <span className="badge border text-xs"
                            style={
                              t.status === 'completed'
                                ? { backgroundColor: '#E8F5E9', color: '#2E7D32', borderColor: '#A5D6A7' }
                                : t.status === 'pending'
                                ? { backgroundColor: '#FFF8E1', color: '#F57F17', borderColor: '#FFE082' }
                                : { backgroundColor: '#FFEBEE', color: '#C62828', borderColor: '#EF9A9A' }
                            }>
                        {String(t.status)}
                      </span>
                    </td>
                    <td className="td" style={{ color: '#9E9E9E' }}>{formatDate(String(t.created_at))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Payment modal */}
      {showPayForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-md shadow-lg animate-slide-up">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b"
                 style={{ borderColor: '#E0E0E0' }}>
              <h3 className="font-bold" style={{ color: '#282A35' }}>Payment তথ্য দিন</h3>
              <button onClick={() => setShowPayForm(false)} className="btn-ghost p-1.5">
                <X size={17} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>
                  আপনার নাম <span className="text-red-500">*</span>
                </label>
                <input className="input" placeholder="পূর্ণ নাম"
                  value={payForm.name} onChange={e => setPayForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>
                  Phone নম্বর <span className="text-red-500">*</span>
                </label>
                <input className="input" placeholder="017XXXXXXXX"
                  value={payForm.phone} onChange={e => setPayForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="p-3.5 rounded flex items-start gap-2.5 text-sm"
                   style={{ backgroundColor: '#E8F5E9', border: '1px solid #C8E6C9', color: '#2E7D32' }}>
                <CreditCard size={16} className="flex-shrink-0 mt-0.5" />
                <span>SSLCommerz gateway-তে redirect হবে। bKash, Nagad, Card সব accept হয়।</span>
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowPayForm(false)} className="btn-secondary flex-1">বাতিল</button>
                <button onClick={() => initiate(payForm.plan)} disabled={loading} className="btn-primary flex-1">
                  {loading ? <><span className="spinner h-4 w-4" /> শুরু হচ্ছে...</> : 'Payment করুন →'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

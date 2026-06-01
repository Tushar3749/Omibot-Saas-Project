'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { configAPI, productsAPI } from '@/lib/api'
import { getStoredTenant } from '@/lib/utils'
import { Bot, Package, FileText, Facebook, MessageSquare, CheckCircle, ArrowRight, ArrowLeft } from 'lucide-react'

const STEPS = [
  { id: 1, title: 'AI Personality',    icon: Bot,           desc: 'Bot-এর নাম ও ভাষা সেট করুন' },
  { id: 2, title: 'System Prompt',     icon: FileText,      desc: 'AI কীভাবে কথা বলবে' },
  { id: 3, title: 'First Product',     icon: Package,       desc: 'একটি পণ্য যোগ করুন' },
  { id: 4, title: 'Facebook Connect',  icon: Facebook,      desc: 'Page সংযুক্ত করুন' },
  { id: 5, title: 'Test Chat',         icon: MessageSquare, desc: 'AI পরীক্ষা করুন' },
  { id: 6, title: 'All Done!',         icon: CheckCircle,   desc: 'Bot এখন live' },
]

export default function OnboardingPage() {
  const router = useRouter()
  const tenant = getStoredTenant()
  const [step, setStep]     = useState(1)
  const [saving, setSaving] = useState(false)

  const [aiConfig, setAIConfig] = useState({
    bot_name: 'Riya',
    language: 'bangla',
    system_prompt: `আমি ${tenant?.business_name || 'আপনার ব্যবসা'}-এর AI assistant। আমি customer-দের সাথে সুন্দরভাবে কথা বলি।`,
  })

  const [product, setProduct] = useState({ sku: '', name: '', mrp: '', description: '' })
  const [testMsg, setTestMsg] = useState('')
  const [testReply, setTestReply] = useState('')

  async function saveAIConfig() {
    setSaving(true)
    try {
      await configAPI.update(aiConfig)
      toast.success('AI config সংরক্ষিত!')
      setStep(s => s + 1)
    } catch { toast.error('সমস্যা হয়েছে, আবার চেষ্টা করুন') }
    finally { setSaving(false) }
  }

  async function saveProduct() {
    if (!product.sku || !product.name || !product.mrp) {
      toast.error('SKU, পণ্যের নাম ও MRP দিন')
      return
    }
    setSaving(true)
    try {
      const data: Record<string, unknown> = {
        sku: product.sku.trim(),
        name: product.name,
        mrp: parseFloat(product.mrp),
      }
      if (product.description) data.extra_fields = { description: product.description }
      await productsAPI.create(data)
      toast.success('পণ্য যোগ হয়েছে!')
      setStep(s => s + 1)
    } catch { toast.error('সমস্যা হয়েছে') }
    finally { setSaving(false) }
  }

  const currentStep = STEPS[step - 1]

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4"
         style={{ backgroundColor: '#F9F9F9' }}>
      <div className="w-full max-w-xl">

        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 rounded flex items-center justify-center"
               style={{ backgroundColor: '#04AA6D' }}>
            <Bot size={15} className="text-white" />
          </div>
          <span className="font-bold" style={{ color: '#282A35' }}>OmniBot Setup</span>
        </div>

        {/* Step progress dots */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <div className={`flex items-center justify-center rounded-full transition-all duration-300 text-xs font-bold ${
                step > s.id
                  ? 'w-7 h-7 text-white'
                  : step === s.id
                  ? 'w-7 h-7 text-white ring-4'
                  : 'w-6 h-6 text-gray-400'
              }`}
                style={
                  step > s.id
                    ? { backgroundColor: '#04AA6D' }
                    : step === s.id
                    ? { backgroundColor: '#04AA6D', boxShadow: '0 0 0 4px rgba(4,170,109,0.15)' }
                    : { backgroundColor: '#E0E0E0' }
                }>
                {step > s.id ? <CheckCircle size={14} /> : s.id}
              </div>
              {s.id < STEPS.length && (
                <div className="h-0.5 w-6 rounded-full transition-colors duration-300"
                     style={{ backgroundColor: step > s.id ? '#04AA6D' : '#E0E0E0' }} />
              )}
            </div>
          ))}
        </div>

        {/* Step card */}
        <div className="card p-7 animate-fade-in">
          {/* Step header */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0"
                 style={{ backgroundColor: '#E8F5E9' }}>
              <currentStep.icon size={20} style={{ color: '#04AA6D' }} />
            </div>
            <div>
              <h2 className="font-bold" style={{ color: '#282A35' }}>{currentStep.title}</h2>
              <p className="text-sm" style={{ color: '#757575' }}>{currentStep.desc}</p>
            </div>
            <div className="ml-auto">
              <span className="text-xs px-2 py-1 rounded-full"
                    style={{ backgroundColor: '#F5F5F5', color: '#757575' }}>
                {step} / {STEPS.length}
              </span>
            </div>
          </div>

          {/* ── Step 1 ─────────────────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>Chatbot-এর নাম</label>
                  <input className="input" placeholder="Riya, Mita, Asha…"
                    value={aiConfig.bot_name}
                    onChange={e => setAIConfig(c => ({ ...c, bot_name: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>ভাষা</label>
                  <select className="input" value={aiConfig.language}
                    onChange={e => setAIConfig(c => ({ ...c, language: e.target.value }))}>
                    <option value="bangla">বাংলা</option>
                    <option value="english">English</option>
                    <option value="banglish">Banglish</option>
                  </select>
                </div>
              </div>
              <button onClick={saveAIConfig} disabled={saving} className="btn-primary w-full py-2.5">
                {saving ? <><span className="spinner h-4 w-4" /> সংরক্ষণ...</> : <>পরবর্তী <ArrowRight size={15} /></>}
              </button>
            </div>
          )}

          {/* ── Step 2 ─────────────────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>AI-এর আচরণ নির্দেশিকা</label>
                <p className="text-xs mb-2" style={{ color: '#9E9E9E' }}>AI কীভাবে কথা বলবে তা এখানে লিখুন। Security protection স্বয়ংক্রিয়ভাবে যোগ হবে।</p>
                <textarea className="input h-36 resize-none font-mono text-xs leading-relaxed"
                  placeholder="আমি আপনার ব্যবসার AI assistant..."
                  value={aiConfig.system_prompt}
                  onChange={e => setAIConfig(c => ({ ...c, system_prompt: e.target.value }))} />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(s => s - 1)} className="btn-secondary flex-1">
                  <ArrowLeft size={15} /> পিছনে
                </button>
                <button onClick={saveAIConfig} disabled={saving} className="btn-primary flex-1">
                  {saving ? <><span className="spinner h-4 w-4" /> সংরক্ষণ...</> : <>পরবর্তী <ArrowRight size={15} /></>}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3 ─────────────────────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>SKU <span className="text-red-500">*</span></label>
                  <input className="input font-mono text-sm" placeholder="SKU001"
                    value={product.sku} onChange={e => setProduct(p => ({ ...p, sku: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>পণ্যের নাম <span className="text-red-500">*</span></label>
                  <input className="input" placeholder="কালো জর্জেট শাড়ি"
                    value={product.name} onChange={e => setProduct(p => ({ ...p, name: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>MRP (৳) <span className="text-red-500">*</span></label>
                <input type="number" className="input" placeholder="1500"
                  value={product.mrp} onChange={e => setProduct(p => ({ ...p, mrp: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: '#282A35' }}>বিবরণ (optional)</label>
                <textarea className="input h-20 resize-none" placeholder="পণ্যের বিস্তারিত বিবরণ"
                  value={product.description} onChange={e => setProduct(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(s => s - 1)} className="btn-secondary flex-1">
                  <ArrowLeft size={15} /> পিছনে
                </button>
                <button onClick={saveProduct} disabled={saving} className="btn-primary flex-1">
                  {saving ? <><span className="spinner h-4 w-4" /> যোগ হচ্ছে...</> : <>পণ্য যোগ করুন <ArrowRight size={15} /></>}
                </button>
              </div>
              <button onClick={() => setStep(s => s + 1)}
                      className="w-full text-sm text-center transition-colors"
                      style={{ color: '#9E9E9E' }}>
                এড়িয়ে যান →
              </button>
            </div>
          )}

          {/* ── Step 4 ─────────────────────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="p-4 rounded" style={{ backgroundColor: '#E8F5E9', border: '1px solid #C8E6C9' }}>
                <p className="text-sm font-medium mb-3" style={{ color: '#1B5E20' }}>এক-ক্লিকে Facebook Page connect করুন:</p>
                <ol className="space-y-1.5 text-sm list-decimal list-inside" style={{ color: '#388E3C' }}>
                  <li>নিচের button-এ click করুন</li>
                  <li>Facebook-এ login করুন</li>
                  <li>আপনার page select করুন</li>
                  <li>Permission দিন → Done! ✅</li>
                </ol>
              </div>
              <a href={`${process.env.NEXT_PUBLIC_API_URL}/api/channels/facebook/oauth-url`}
                className="btn-primary w-full py-3 text-center flex items-center justify-center gap-2">
                <Facebook size={17} /> Facebook Page Connect করুন
              </a>
              <div className="flex gap-3">
                <button onClick={() => setStep(s => s - 1)} className="btn-secondary flex-1">
                  <ArrowLeft size={15} /> পিছনে
                </button>
                <button onClick={() => setStep(s => s + 1)} className="btn-secondary flex-1">
                  পরে করব →
                </button>
              </div>
            </div>
          )}

          {/* ── Step 5 ─────────────────────────────────────────────────────── */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="min-h-32 rounded p-4"
                   style={{ backgroundColor: '#F9F9F9', border: '1px solid #E0E0E0' }}>
                {testReply ? (
                  <div className="space-y-3">
                    <div className="flex justify-end">
                      <div className="bg-white px-3 py-2 text-sm max-w-xs shadow-sm rounded"
                           style={{ border: '1px solid #E0E0E0', color: '#282A35' }}>
                        {testMsg}
                      </div>
                    </div>
                    <div className="flex justify-start">
                      <div className="px-3 py-2 text-sm text-white max-w-xs rounded"
                           style={{ backgroundColor: '#04AA6D' }}>
                        {testReply}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-center mt-8" style={{ color: '#9E9E9E' }}>
                    আপনার AI-এর সাথে কথা বলুন...
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <input className="input flex-1" placeholder="যেমন: তোমার কাছে কি শাড়ি আছে?"
                  value={testMsg} onChange={e => setTestMsg(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && testMsg.trim()) {
                      setTestReply('AI reply আসছে...')
                      setTimeout(() => setTestReply('হ্যাঁ! আমাদের কাছে সুন্দর collection আছে। আপনি কি ধরনের শাড়ি খুঁজছেন? 😊'), 1500)
                    }
                  }} />
                <button className="btn-primary px-4" onClick={() => {
                  if (!testMsg.trim()) return
                  setTestReply('আসছে...')
                  setTimeout(() => setTestReply('হ্যাঁ! আমাদের কাছে সুন্দর collection আছে। কী ধরনের শাড়ি খুঁজছেন? 😊'), 1500)
                }}>পাঠান</button>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(s => s - 1)} className="btn-secondary flex-1">
                  <ArrowLeft size={15} /> পিছনে
                </button>
                <button onClick={() => setStep(6)} className="btn-primary flex-1">
                  পরবর্তী <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 6 ─────────────────────────────────────────────────────── */}
          {step === 6 && (
            <div className="text-center space-y-6">
              <div className="flex justify-center">
                <div className="w-20 h-20 rounded-full flex items-center justify-center"
                     style={{ backgroundColor: '#E8F5E9', border: '4px solid #C8E6C9' }}>
                  <CheckCircle size={36} style={{ color: '#04AA6D' }} />
                </div>
              </div>
              <div>
                <h3 className="text-xl font-bold" style={{ color: '#282A35' }}>OmniBot এখন Ready! 🎉</h3>
                <p className="text-sm mt-2 leading-relaxed" style={{ color: '#757575' }}>
                  আপনার AI chatbot এখন Facebook Messenger-এ customer-দের সাথে কথা বলতে পারবে।
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'AI মডেল', value: 'Gemini 2.5' },
                  { label: 'ভাষা', value: aiConfig.language === 'bangla' ? 'বাংলা' : aiConfig.language },
                  { label: 'Trial', value: '১৪ দিন' },
                ].map(item => (
                  <div key={item.label} className="p-3 rounded" style={{ backgroundColor: '#F9F9F9', border: '1px solid #E0E0E0' }}>
                    <p className="text-xs" style={{ color: '#9E9E9E' }}>{item.label}</p>
                    <p className="font-semibold text-sm mt-0.5" style={{ color: '#282A35' }}>{item.value}</p>
                  </div>
                ))}
              </div>
              <button onClick={() => router.push('/dashboard')} className="btn-primary w-full py-3 text-base">
                Dashboard-এ যান <ArrowRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

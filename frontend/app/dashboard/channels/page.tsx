'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { channelsAPI } from '@/lib/api'
import type { ConnectedPage } from '@/types'
import { Facebook, Instagram, Link2, Unlink, CheckCircle, ExternalLink, Radio } from 'lucide-react'

export default function ChannelsPage() {
  const [pages, setPages]       = useState<ConnectedPage[]>([])
  const [loading, setLoading]   = useState(true)
  const [oauthUrl, setOauthUrl] = useState('')

  useEffect(() => {
    loadPages()
    channelsAPI.oauthUrl().then(d => setOauthUrl(d.oauth_url)).catch(() => {})
  }, [])

  async function loadPages() {
    try { setPages(await channelsAPI.list()) }
    catch { toast.error('Channels লোড হয়নি') }
    finally { setLoading(false) }
  }

  async function disconnect(pageId: string) {
    if (!confirm('এই page disconnect করবেন?')) return
    try {
      await channelsAPI.disconnect(pageId)
      toast.success('Page disconnected')
      loadPages()
    } catch { toast.error('Disconnect ব্যর্থ') }
  }

  return (
    <div className="max-w-2xl space-y-5">

      <div>
        <h1 className="page-title">Channels</h1>
        <p className="page-subtitle">আপনার social media channels connect করুন</p>
      </div>

      {/* ── Facebook ──────────────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded flex items-center justify-center flex-shrink-0"
               style={{ backgroundColor: '#1877F2' }}>
            <Facebook size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="font-semibold" style={{ color: '#282A35' }}>Facebook Messenger</h2>
              <span className="badge text-xs" style={{ backgroundColor: '#E8F5E9', color: '#2E7D32', border: '1px solid #A5D6A7' }}>
                Available
              </span>
            </div>
            <p className="text-sm mb-4" style={{ color: '#757575' }}>
              আপনার Facebook Business Page connect করুন। Bot স্বয়ংক্রিয়ভাবে Messenger-এ customer-দের সাথে কথা বলবে।
            </p>
            {oauthUrl ? (
              <a href={oauthUrl} className="btn-primary gap-2 text-sm">
                <Facebook size={15} />
                One-Click Facebook Connect
                <ExternalLink size={13} />
              </a>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 rounded text-sm"
                   style={{ backgroundColor: '#FFF8E1', border: '1px solid #FFE082', color: '#F57F17' }}>
                ⚠️ FACEBOOK_APP_ID .env-তে সেট করুন
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Instagram ─────────────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded flex items-center justify-center flex-shrink-0"
               style={{ background: 'linear-gradient(135deg, #833AB4, #E1306C, #F77737)' }}>
            <Instagram size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="font-semibold" style={{ color: '#282A35' }}>Instagram DM</h2>
              <span className="badge text-xs" style={{ backgroundColor: '#E8F5E9', color: '#04AA6D', border: '1px solid #A5D6A7' }}>
                Pro+
              </span>
            </div>
            <p className="text-sm mb-3" style={{ color: '#757575' }}>
              Instagram Professional Account connect করুন। Facebook Page connect করলে linked Instagram account-ও automatically detect হয়।
            </p>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded text-sm"
                 style={{ backgroundColor: '#F9F9F9', border: '1px solid #E0E0E0', color: '#757575' }}>
              💡 Facebook Page connect করলে linked Instagram-ও connect হয়ে যায় (Pro plan)
            </div>
          </div>
        </div>
      </div>

      {/* ── Connected pages ───────────────────────────────────────────────── */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3.5 border-b flex items-center justify-between"
             style={{ borderColor: '#E0E0E0' }}>
          <h2 className="font-semibold" style={{ color: '#282A35' }}>Connected Pages</h2>
          <span className="text-xs" style={{ color: '#9E9E9E' }}>{pages.length} connected</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="spinner h-6 w-6" />
          </div>
        ) : pages.length === 0 ? (
          <div className="empty-state py-10">
            <div className="w-12 h-12 rounded flex items-center justify-center"
                 style={{ backgroundColor: '#F5F5F5' }}>
              <Link2 size={20} style={{ color: '#9E9E9E' }} />
            </div>
            <p className="text-sm font-medium" style={{ color: '#757575' }}>কোনো page connect করা নেই</p>
            <p className="text-xs" style={{ color: '#9E9E9E' }}>উপরের button দিয়ে Facebook Page connect করুন</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: '#F5F5F5' }}>
            {pages.map(page => (
              <div key={page.page_id} className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded flex items-center justify-center flex-shrink-0"
                       style={{ backgroundColor: page.platform === 'facebook' ? '#E3F2FD' : '#FCE4EC' }}>
                    {page.platform === 'facebook'
                      ? <Facebook size={17} style={{ color: '#1877F2' }} />
                      : <Instagram size={17} style={{ color: '#E1306C' }} />
                    }
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate" style={{ color: '#282A35' }}>{page.page_name}</p>
                    <p className="text-xs flex items-center gap-1.5 mt-0.5" style={{ color: '#9E9E9E' }}>
                      <span className="capitalize">{page.platform}</span>
                      <span>·</span>
                      <span className="font-mono">{page.page_id}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {page.is_active ? (
                    <span className="flex items-center gap-1.5 badge border"
                          style={{ backgroundColor: '#E8F5E9', color: '#2E7D32', borderColor: '#A5D6A7' }}>
                      <CheckCircle size={11} /> Active
                    </span>
                  ) : (
                    <span className="badge border"
                          style={{ backgroundColor: '#FFEBEE', color: '#B71C1C', borderColor: '#EF9A9A' }}>
                      Inactive
                    </span>
                  )}
                  <button
                    onClick={() => disconnect(page.page_id)}
                    className="btn-ghost p-2 hover:text-red-600"
                    title="Disconnect"
                  >
                    <Unlink size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Coming soon ───────────────────────────────────────────────────── */}
      <div className="card p-5" style={{ borderStyle: 'dashed', backgroundColor: '#FAFAFA' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded flex items-center justify-center flex-shrink-0"
               style={{ backgroundColor: '#E8F5E9' }}>
            <Radio size={18} style={{ color: '#04AA6D' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium" style={{ color: '#424242' }}>WhatsApp Business API</p>
            <p className="text-sm" style={{ color: '#9E9E9E' }}>v2.0 release-এ আসছে — 2026 Q4</p>
          </div>
          <span className="badge" style={{ backgroundColor: '#F5F5F5', color: '#757575', border: '1px solid #E0E0E0' }}>
            Coming Soon
          </span>
        </div>
      </div>
    </div>
  )
}

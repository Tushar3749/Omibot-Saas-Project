'use client'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { conversationsAPI } from '@/lib/api'
import type { Conversation, Message } from '@/types'
import { formatDateTime } from '@/lib/utils'
import { MessageSquare, Zap, ZapOff, User, Bot, Briefcase } from 'lucide-react'

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected,      setSelected]      = useState<Conversation | null>(null)
  const [messages,      setMessages]      = useState<Message[]>([])
  const [loading,       setLoading]       = useState(true)
  const [msgLoading,    setMsgLoading]    = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { loadConversations() }, [])
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function loadConversations() {
    try { setConversations(await conversationsAPI.list()) }
    catch { toast.error('Conversations লোড হয়নি') }
    finally { setLoading(false) }
  }

  async function openConversation(conv: Conversation) {
    setSelected(conv)
    setMsgLoading(true)
    try { setMessages(await conversationsAPI.messages(conv.conversation_id)) }
    catch { toast.error('Messages লোড হয়নি') }
    finally { setMsgLoading(false) }
  }

  async function toggleAI(conv: Conversation) {
    const newVal = !conv.is_ai_active
    try {
      await conversationsAPI.toggleAI(conv.conversation_id, newVal)
      toast.success(newVal ? 'AI চালু হয়েছে' : 'AI বন্ধ হয়েছে')
      setConversations(cs => cs.map(c =>
        c.conversation_id === conv.conversation_id ? { ...c, is_ai_active: newVal } : c
      ))
      if (selected?.conversation_id === conv.conversation_id) {
        setSelected(s => s ? { ...s, is_ai_active: newVal } : s)
      }
    } catch { toast.error('AI toggle ব্যর্থ') }
  }

  const ROLE_ICON: Record<string, React.ReactNode> = {
    customer: <User size={12} />,
    bot:      <Bot  size={12} />,
    owner:    <Briefcase size={12} />,
  }
  const ROLE_LABEL: Record<string, string> = {
    customer: 'Customer',
    bot:      'AI Bot',
    owner:    'You',
  }

  return (
    <div className="h-[calc(100vh-3.5rem-2.5rem)] flex gap-4">

      {/* ── Left: conversation list ──────────────────────────────────────── */}
      <div className="w-72 flex-shrink-0 card flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2 flex-shrink-0"
             style={{ borderColor: '#E0E0E0' }}>
          <MessageSquare size={16} style={{ color: '#9E9E9E' }} />
          <h2 className="font-semibold text-sm" style={{ color: '#282A35' }}>Conversations</h2>
          <span className="text-xs ml-auto" style={{ color: '#9E9E9E' }}>{conversations.length}</span>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="spinner h-6 w-6" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="empty-state py-10">
            <MessageSquare size={28} style={{ color: '#BDBDBD' }} />
            <p className="text-sm" style={{ color: '#9E9E9E' }}>কোনো conversation নেই</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto divide-y" style={{ borderColor: '#F5F5F5' }}>
            {conversations.map(conv => (
              <button
                key={conv.conversation_id}
                onClick={() => openConversation(conv)}
                className="w-full px-4 py-3 text-left transition-colors"
                style={selected?.conversation_id === conv.conversation_id
                  ? { backgroundColor: '#E8F5E9' }
                  : { backgroundColor: 'transparent' }
                }
                onMouseEnter={e => {
                  if (selected?.conversation_id !== conv.conversation_id)
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F9F9F9'
                }}
                onMouseLeave={e => {
                  if (selected?.conversation_id !== conv.conversation_id)
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
                }}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium truncate" style={{ color: '#282A35' }}>
                    {conv.customer_platform_id}
                  </p>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full ml-1 flex-shrink-0 flex items-center gap-1"
                    style={conv.is_ai_active
                      ? { backgroundColor: '#E8F5E9', color: '#2E7D32' }
                      : { backgroundColor: '#F5F5F5', color: '#9E9E9E' }
                    }
                  >
                    {conv.is_ai_active ? <Zap size={9} /> : <ZapOff size={9} />}
                    AI
                  </span>
                </div>
                <p className="text-xs truncate" style={{ color: '#9E9E9E' }}>
                  {formatDateTime(conv.updated_at)}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Right: message thread ───────────────────────────────────────── */}
      <div className="flex-1 card flex flex-col overflow-hidden min-w-0">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <div className="w-14 h-14 rounded flex items-center justify-center"
                 style={{ backgroundColor: '#F5F5F5' }}>
              <MessageSquare size={24} style={{ color: '#BDBDBD' }} />
            </div>
            <p className="text-sm" style={{ color: '#9E9E9E' }}>একটি conversation select করুন</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-5 py-3 border-b flex items-center justify-between gap-4 flex-shrink-0"
                 style={{ borderColor: '#E0E0E0' }}>
              <div>
                <p className="font-semibold text-sm" style={{ color: '#282A35' }}>
                  {selected.customer_platform_id}
                </p>
                <p className="text-xs capitalize" style={{ color: '#9E9E9E' }}>{selected.platform}</p>
              </div>
              <button
                onClick={() => toggleAI(selected)}
                className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors"
                style={selected.is_ai_active
                  ? { backgroundColor: '#E8F5E9', color: '#2E7D32', border: '1px solid #A5D6A7' }
                  : { backgroundColor: '#F5F5F5', color: '#757575', border: '1px solid #E0E0E0' }
                }
              >
                {selected.is_ai_active ? <><Zap size={12} /> AI চালু</> : <><ZapOff size={12} /> AI বন্ধ</>}
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4"
                 style={{ backgroundColor: '#F9F9F9' }}>
              {msgLoading ? (
                <div className="flex justify-center py-10">
                  <div className="spinner h-6 w-6" />
                </div>
              ) : messages.length === 0 ? (
                <p className="text-center text-sm" style={{ color: '#9E9E9E' }}>কোনো message নেই</p>
              ) : (
                messages.map(msg => (
                  <div key={msg.message_id}
                       className={`flex flex-col gap-1 ${msg.role !== 'customer' ? 'items-end' : 'items-start'}`}>
                    <div className={`flex items-center gap-1.5 text-xs mb-0.5 ${msg.role !== 'customer' ? 'flex-row-reverse' : ''}`}
                         style={{ color: '#9E9E9E' }}>
                      {ROLE_ICON[msg.role]}
                      <span>{ROLE_LABEL[msg.role] || msg.role}</span>
                    </div>
                    <div className={`max-w-[68%] flex flex-col gap-1 ${msg.role !== 'customer' ? 'items-end' : 'items-start'}`}>
                      <div className="px-3.5 py-2.5 rounded text-sm leading-relaxed"
                           style={
                             msg.role === 'customer'
                               ? { backgroundColor: '#FFFFFF', border: '1px solid #E0E0E0', color: '#282A35' }
                               : msg.role === 'owner'
                               ? { backgroundColor: '#282A35', color: '#FFFFFF' }
                               : { backgroundColor: '#04AA6D', color: '#FFFFFF' }
                           }>
                        {msg.content}
                      </div>
                      <span className="text-xs" style={{ color: '#BDBDBD' }}>
                        {formatDateTime(msg.created_at)}
                      </span>
                    </div>
                  </div>
                ))
              )}
              <div ref={bottomRef} />
            </div>

            {/* Context bar */}
            <div className="px-5 py-2.5 border-t text-xs flex items-center gap-4"
                 style={{ borderColor: '#E0E0E0', backgroundColor: '#FAFAFA', color: '#9E9E9E' }}>
              <span>{messages.length} messages</span>
              <span>·</span>
              <span className="capitalize">{selected.platform}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

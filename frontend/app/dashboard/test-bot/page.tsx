'use client'
import { useState, useRef, useEffect } from 'react'
import toast from 'react-hot-toast'
import { testBotAPI } from '@/lib/api'
import { FlaskConical, Send, Bot, User, Loader2, RotateCcw } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface ChatMessage {
  role: 'user' | 'bot'
  text: string
  ts: Date
}

// ─── Chat bubble ──────────────────────────────────────────────────────────────
function Bubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ backgroundColor: isUser ? '#04AA6D' : '#282A35' }}
      >
        {isUser
          ? <User size={13} className="text-white" />
          : <Bot  size={13} className="text-white" />}
      </div>

      {/* Bubble */}
      <div
        className="max-w-[75%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap"
        style={isUser
          ? { backgroundColor: '#04AA6D', color: '#fff', borderBottomRightRadius: 4 }
          : { backgroundColor: '#fff', color: '#282A35', border: '1px solid #E0E0E0', borderBottomLeftRadius: 4 }}
      >
        {msg.text}
      </div>
    </div>
  )
}

// ─── Typing indicator ─────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex gap-2.5">
      <div className="w-7 h-7 rounded-full flex items-center justify-center"
           style={{ backgroundColor: '#282A35' }}>
        <Bot size={13} className="text-white" />
      </div>
      <div className="px-4 py-3 rounded-2xl bg-white border border-gray-200"
           style={{ borderBottomLeftRadius: 4 }}>
        <div className="flex gap-1 items-center">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function TestBotPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput]       = useState('')
  const [typing, setTyping]     = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLInputElement>(null)

  // Scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typing])

  // ── Send message ──────────────────────────────────────────────────────────
  async function send() {
    const text = input.trim()
    if (!text || typing) return
    setInput('')

    const userMsg: ChatMessage = { role: 'user', text, ts: new Date() }
    setMessages(prev => [...prev, userMsg])
    setTyping(true)

    try {
      const res = await testBotAPI.chat(text)
      const botMsg: ChatMessage = { role: 'bot', text: res.reply, ts: new Date() }
      setMessages(prev => [...prev, botMsg])
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      const errMsg: ChatMessage = {
        role: 'bot',
        text: detail || 'দুঃখিত, AI সার্ভিস সাময়িকভাবে অনুপলব্ধ। একটু পরে আবার চেষ্টা করুন।',
        ts: new Date(),
      }
      setMessages(prev => [...prev, errMsg])
      toast.error('AI response ব্যর্থ হয়েছে')
    } finally {
      setTyping(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function clearChat() {
    if (messages.length === 0) return
    if (!confirm('পুরো কথোপকথন মুছে ফেলবেন?')) return
    setMessages([])
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] max-w-2xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <FlaskConical size={22} style={{ color: '#04AA6D' }} />
            Test Bot
          </h1>
          <p className="page-subtitle">আপনার নিজের বটের সাথে কথা বলুন এবং পরীক্ষা করুন</p>
        </div>
        <button
          onClick={clearChat}
          disabled={messages.length === 0}
          className="btn-secondary gap-1.5 text-sm"
        >
          <RotateCcw size={13} /> রিসেট
        </button>
      </div>

      {/* Chat window */}
      <div
        className="flex-1 rounded-xl overflow-y-auto p-4 space-y-4"
        style={{ backgroundColor: '#F4F6F8', border: '1px solid #E0E0E0' }}
      >
        {/* Welcome state */}
        {messages.length === 0 && !typing && (
          <div className="h-full flex flex-col items-center justify-center text-center py-10 gap-3">
            <div className="w-16 h-16 rounded-full flex items-center justify-center"
                 style={{ backgroundColor: '#282A35' }}>
              <Bot size={32} className="text-white" />
            </div>
            <div>
              <p className="font-semibold" style={{ color: '#282A35' }}>আপনার বট প্রস্তুত!</p>
              <p className="text-sm mt-1" style={{ color: '#9E9E9E' }}>
                একটি বার্তা পাঠান — বট আপনার AI settings অনুযায়ী উত্তর দেবে
              </p>
            </div>
            {/* Quick prompts */}
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {[
                'আপনাদের পণ্যের দাম কত?',
                'কি কি পণ্য আছে?',
                'রিটার্ন পলিসি কি?',
                'ছাড় পাওয়া যাবে?',
              ].map(q => (
                <button
                  key={q}
                  onClick={() => { setInput(q); inputRef.current?.focus() }}
                  className="text-xs px-3 py-1.5 rounded-full border transition-colors hover:border-green-400"
                  style={{ borderColor: '#E0E0E0', color: '#616161', backgroundColor: '#fff' }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg, i) => (
          <Bubble key={i} msg={msg} />
        ))}

        {/* Typing */}
        {typing && <TypingIndicator />}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div
        className="mt-3 flex gap-2 p-2 rounded-xl"
        style={{ backgroundColor: '#fff', border: '1px solid #E0E0E0' }}
      >
        <input
          ref={inputRef}
          type="text"
          className="flex-1 px-3 py-2 text-sm outline-none bg-transparent"
          style={{ color: '#282A35' }}
          placeholder="বার্তা লিখুন... (Enter পাঠাতে)"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={typing}
          autoFocus
        />
        <button
          onClick={send}
          disabled={!input.trim() || typing}
          className="w-9 h-9 rounded-lg flex items-center justify-center transition-all flex-shrink-0"
          style={{
            backgroundColor: !input.trim() || typing ? '#E0E0E0' : '#04AA6D',
            color: !input.trim() || typing ? '#9E9E9E' : '#fff',
          }}
        >
          {typing
            ? <Loader2 size={15} className="animate-spin" />
            : <Send size={15} />}
        </button>
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-center mt-2" style={{ color: '#BDBDBD' }}>
        এটি পরীক্ষামূলক — গ্রাহকের কথোপকথনে এটি প্রভাব ফেলবে না
      </p>
    </div>
  )
}

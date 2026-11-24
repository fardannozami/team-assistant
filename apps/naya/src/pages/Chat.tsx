import { useEffect, useRef, useState, type FormEvent } from 'react'
import { apiFetch } from '../api.ts'

// Chat with a Hermes agent through Naya's server (POST /api/agents/:id/chat, an SSE stream of
// delta, tool, done and error events). The conversation lives in this tab only (sessionStorage).

interface Message { role: 'user' | 'assistant'; content: string }
const MAX_KEPT = 40

const storageKey = (agent: string) => `naya.chat.${agent}`
function stored(agent: string): Message[] {
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(storageKey(agent)) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is Message => (item?.role === 'user' || item?.role === 'assistant') && typeof item.content === 'string') : []
  } catch {
    return []
  }
}
function store(agent: string, messages: Message[]) {
  try { window.sessionStorage.setItem(storageKey(agent), JSON.stringify(messages.slice(-MAX_KEPT))) } catch { /* private mode: not kept */ }
}

/** Reads `event:`/`data:` blocks from the response stream. */
async function readEvents(body: ReadableStream<Uint8Array>, onEvent: (event: string, data: Record<string, unknown>) => void) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    let end: number
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const event = /^event: (.+)$/m.exec(block)?.[1] ?? 'message'
      const data = /^data: (.+)$/m.exec(block)?.[1]
      if (!data) continue
      try { onEvent(event, JSON.parse(data) as Record<string, unknown>) } catch { /* skip */ }
    }
  }
}

export function AgentChat({ agent, intro }: { agent: string; intro?: string }) {
  const [messages, setMessages] = useState<Message[]>(() => stored(agent))
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [tool, setTool] = useState<string>()
  const [error, setError] = useState<string>()
  const log = useRef<HTMLDivElement>(null)
  const abort = useRef<AbortController | undefined>(undefined)
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }) }, [messages, tool])
  useEffect(() => () => abort.current?.abort(), [])

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    const history: Message[] = [...messages, { role: 'user', content: text }]
    setMessages([...history, { role: 'assistant', content: '' }])
    setDraft('')
    setBusy(true)
    setError(undefined)
    let answer = ''
    const controller = new AbortController()
    abort.current = controller
    try {
      const response = await apiFetch(`/api/agents/${encodeURIComponent(agent)}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      })
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => undefined) as { error?: string; locked?: unknown } | undefined
        throw new Error(data?.error ?? `Server Naya menjawab HTTP ${response.status}.`)
      }
      await readEvents(response.body, (name, data) => {
        if (name === 'delta' && typeof data.text === 'string') {
          answer += data.text
          setTool(undefined)
          setMessages([...history, { role: 'assistant', content: answer }])
        } else if (name === 'tool' && typeof data.label === 'string') setTool(data.label)
        else if (name === 'error' && typeof data.error === 'string') setError(data.error)
      })
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Chat gagal.')
    } finally {
      const final: Message[] = answer ? [...history, { role: 'assistant', content: answer }] : history
      setMessages(final)
      store(agent, final)
      setTool(undefined)
      setBusy(false)
    }
  }

  return <div className="chat">
    <div className="chat-log" ref={log} aria-live="polite">
      {messages.length === 0 && <p className="muted">{intro ?? `Tulis pesan untuk ${agent}. Agent bisa memakai tool-nya (riset web, data daily lewat MCP, dan lainnya), jadi jawaban bisa butuh waktu.`}</p>}
      {messages.map((message, index) => message.content || message.role === 'user' ? <div key={index} className={`chat-message ${message.role}`}>{message.content}</div> : null)}
      {busy && <p className="chat-tool">{tool ? `⚙ ${tool}` : `${agent} sedang berpikir…`}</p>}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <form className="chat-input" onSubmit={send}>
      <label className="field-label" htmlFor={`chat-${agent}`}>Pesan untuk {agent}</label>
      <textarea id={`chat-${agent}`} value={draft} maxLength={8000} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} placeholder="Enter untuk kirim, Shift+Enter untuk baris baru"/>
      <div className="review-actions">
        {busy ? <button type="button" className="secondary-button" onClick={() => abort.current?.abort()}>Hentikan</button> : <button type="submit" className="primary-button" disabled={!draft.trim()}>Kirim</button>}
        {messages.length > 0 && !busy && <button type="button" className="secondary-button" onClick={() => { setMessages([]); store(agent, []) }}>Percakapan baru</button>}
      </div>
    </form>
  </div>
}

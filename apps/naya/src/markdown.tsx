import { useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { splitEmail } from './email.ts'

// Agents write their results and comments in Markdown. Rendered here as a document, never as
// HTML: raw HTML in the text stays text, and unsafe link targets are dropped by react-markdown.
// Code blocks get a copy button; an ```email block (claude-worker's follow-up template) shows as
// an email with its subject and body to copy separately, ready to paste into the PM's own mail.

type HastNode = { type: string; value?: string; tagName?: string; properties?: { className?: unknown }; children?: HastNode[] }

const textOf = (node: HastNode | undefined): string => !node ? '' : node.type === 'text' ? node.value ?? '' : (node.children ?? []).map(textOf).join('')

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1_500)
    } catch {
      setCopied(false)
    }
  }
  return <button type="button" className="chip chip-button md-copy" onClick={() => void copy()} aria-live="polite">{copied ? '✓ Tersalin' : label}</button>
}

function EmailTemplate({ text }: { text: string }) {
  const { subject, body } = splitEmail(text)
  return <div className="md-email" role="group" aria-label="Template email">
    <div className="md-email-head">
      <span className="eyebrow">✉ TEMPLATE EMAIL</span>
      <span className="md-email-actions">{subject && <CopyButton text={subject} label="Salin subjek"/>}<CopyButton text={body} label="Salin isi email"/></span>
    </div>
    {subject && <p className="md-email-subject"><span>Subjek</span>{subject}</p>}
    <pre className="md-email-body">{body}</pre>
  </div>
}

function CodeBlock({ node, children }: { node?: HastNode; children?: ReactNode }) {
  const code = node?.children?.find((child) => child.tagName === 'code')
  const classes = code?.properties?.className
  const language = Array.isArray(classes) ? classes.map(String).find((name) => name.startsWith('language-'))?.slice(9) : undefined
  const text = textOf(code).replace(/\n$/, '')
  if (language === 'email') return <EmailTemplate text={text}/>
  return <div className="md-code"><CopyButton text={text} label="Salin"/><pre>{children}</pre></div>
}

const components: Components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  // Wide tables scroll inside the dialog instead of stretching it.
  table: ({ children }) => <div className="md-table"><table>{children}</table></div>,
  pre: ({ node, children }: { children?: ReactNode } & ExtraProps) => <CodeBlock node={node as HastNode | undefined}>{children}</CodeBlock>,
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return <div className={`md ${className}`.trim()}><ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown></div>
}

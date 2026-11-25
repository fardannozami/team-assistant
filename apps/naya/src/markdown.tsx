import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Agents write their results and comments in Markdown. Rendered here as a document, never as
// HTML: raw HTML in the text stays text, and unsafe link targets are dropped by react-markdown.

const components: Components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  // Wide tables scroll inside the dialog instead of stretching it.
  table: ({ children }) => <div className="md-table"><table>{children}</table></div>,
}

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return <div className={`md ${className}`.trim()}><ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown></div>
}

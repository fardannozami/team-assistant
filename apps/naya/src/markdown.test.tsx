import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from './markdown.tsx'

describe('agent markdown', () => {
  it('renders an agent result as a document', () => {
    const html = renderToStaticMarkup(<Markdown text={'# Riset\n\n**Tugas induk:** t_1 · `file.md`\n\n> 1. Penting\n\n| A | B |\n|---|---|\n| 1 | 2 |'}/>)
    expect(html).toContain('<h1>Riset</h1>')
    expect(html).toContain('<strong>Tugas induk:</strong>')
    expect(html).toContain('<code>file.md</code>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<div class="md-table"><table>')
  })

  it('keeps raw HTML and script links inert', () => {
    const html = renderToStaticMarkup(<Markdown text={'<img src=x onerror=alert(1)> [klik](javascript:alert(1)) [ok](https://digdaya.co)'}/>)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('<a href="https://digdaya.co" target="_blank" rel="noopener noreferrer">ok</a>')
  })
})

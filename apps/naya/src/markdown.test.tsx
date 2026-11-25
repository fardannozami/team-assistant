import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from './markdown.tsx'
import { splitEmail } from './email.ts'

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

describe('follow-up email template', () => {
  it('shows an ```email block as an email with its subject and body to copy', () => {
    const html = renderToStaticMarkup(<Markdown text={'Hasil.\n\n```email\nSubjek: Proposal aplikasi kasir\n\nHalo Pak Budi,\n\nTerima kasih.\n```\n\n```sql\nselect 1;\n```'}/>)
    expect(html).toContain('aria-label="Template email"')
    expect(html).toContain('Proposal aplikasi kasir')
    expect(html).toContain('Salin subjek')
    expect(html).toContain('Salin isi email')
    expect(html).toContain('Halo Pak Budi,')
    // Other code keeps its block, with a plain copy button.
    expect(html).toContain('<div class="md-code"><button')
  })

  it('splits the subject line from the body', () => {
    expect(splitEmail('Subjek: Halo\n\nIsi\nbaris 2\n')).toEqual({ subject: 'Halo', body: 'Isi\nbaris 2' })
    expect(splitEmail('Subject: Hi\nBody')).toEqual({ subject: 'Hi', body: 'Body' })
    expect(splitEmail('Tanpa subjek')).toEqual({ subject: '', body: 'Tanpa subjek' })
  })
})

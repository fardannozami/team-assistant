import { useEffect, useRef, useState } from 'react'
import { formatTime } from './format.ts'
import { Agents } from './pages/Agents.tsx'
import { Calendar } from './pages/Calendar.tsx'
import { Office } from './pages/Office.tsx'
import { Settings } from './pages/Settings.tsx'
import { Usage } from './pages/Usage.tsx'
import { TaskBoard } from './pages/TaskBoard.tsx'
import { LOCKED_EVENT, loadMe, MeContext, type Me } from './access.ts'
import { consumeAuthRedirect, DAILY_URL, setToken } from './api.ts'
import { LoginScreen } from './LockScreen.tsx'
import { RefreshContext, usePolling } from './polling.ts'
import { usePreferences } from './preferences.ts'
import { HOME, navigation, pageFromHash, pageLabel, pageSlug, type Page } from './routes.ts'
import type { DashboardSnapshot } from './types.ts'

function currentPage(): Page {
  return typeof window === 'undefined' ? HOME : pageFromHash(window.location.hash)
}

function Shell({ onRefresh, me, onSignedOut }: { onRefresh: () => void; me: Me; onSignedOut: () => void }) {
  const [page, setPage] = useState<Page>(currentPage)
  const { theme, toggleTheme } = usePreferences()
  // The navigation is a drawer over the page, closed by default, like a game's menu.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const drawer = useRef<HTMLElement>(null)
  const dashboard = usePolling<DashboardSnapshot>('/api/dashboard', 15_000)
  const data = dashboard.status === 'ready' ? dashboard.data : null

  useEffect(() => {
    const onHashChange = () => setPage(currentPage())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  useEffect(() => { document.title = `${pageLabel(page)} · Naya` }, [page])
  useEffect(() => {
    if (menuOpen) drawer.current?.querySelector<HTMLElement>('nav a[aria-current="page"], nav a')?.focus()
  }, [menuOpen])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menuOpen) { closeMenu(); return }
      if (event.key.toLowerCase() !== 'm' || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      if (document.querySelector('[role="dialog"]')) return
      event.preventDefault()
      if (menuOpen) closeMenu(); else setMenuOpen(true)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  const closeMenu = () => {
    setMenuOpen(false)
    menuButton.current?.focus()
  }

  const navigate = (next: Page) => {
    window.location.hash = `/${pageSlug(next)}`
    setPage(next)
    setMenuOpen(false)
    window.scrollTo?.({ top: 0 })
  }
  const syncLabel = data ? `SINKRON ${formatTime(data.fetchedAt)}${dashboard.status === 'ready' && dashboard.stale ? ' · LAMA' : ''}` : dashboard.status === 'failed' ? 'API TIDAK TERSEDIA' : 'MENGHUBUNGKAN...'
  const [accountOpen, setAccountOpen] = useState(false)
  const signOut = () => {
    setToken(null)
    onSignedOut()
  }

  const alerts = (data && data.commands.failed > 0 ? 1 : 0)
  const content = page === 'Agents' ? <Agents runtime={data?.runtime ?? null} pending={dashboard.status === 'pending'}/> : page === 'Office' ? <Office dashboard={data} dashboardPending={dashboard.status === 'pending'} onNavigate={navigate}/> : page === 'Usage' ? <Usage/>: page === 'Task Board' ? <TaskBoard/> : page === 'Calendar' ? <Calendar/> : <Settings/>

  return <div className={`app${page === 'Office' ? ' app-office' : ''}`}>
    {menuOpen && <div className="drawer-backdrop" onClick={closeMenu} aria-hidden="true"/>}
    <aside id="app-sidebar" className="drawer" ref={drawer} hidden={!menuOpen} aria-label="Menu">
      <div className="drawer-head"><a className="brand" href="#/office" onClick={(event) => { event.preventDefault(); navigate(HOME) }}>NAYA<span>DIGDAYA AI STUDIO</span></a><button type="button" className="icon-button" onClick={closeMenu} aria-label="Tutup menu" title="Tutup menu (Esc)">✕</button></div>
      <nav aria-label="Main">{navigation.map((item) => <a href={`#/${pageSlug(item)}`} className={page === item ? 'active' : ''} aria-current={page === item ? 'page' : undefined} key={item} onClick={(event) => { event.preventDefault(); navigate(item) }}>{pageLabel(item)}</a>)}<a href={DAILY_URL} target="_blank" rel="noopener">daily ↗</a></nav>
      <div className="sidebar-note"><span className="dot"/> {me.user.name.toUpperCase()} · {(me.user.role ?? 'TANPA PERAN').toUpperCase()}</div>
      <small className="drawer-hint">Tekan M untuk membuka atau menutup menu</small>
    </aside>
    <main><header><span className="header-title"><button type="button" ref={menuButton} className="icon-button menu-button" onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))} aria-controls="app-sidebar" aria-expanded={menuOpen} aria-label={menuOpen ? 'Tutup menu' : 'Buka menu'} title="Menu (M)">☰{alerts > 0 && <span className="menu-alert" aria-label={`${alerts} peringatan di menu`}/>}</button><span>NAYA / {pageLabel(page).toUpperCase()}</span></span><span className="header-actions"><span className={`sync-label${dashboard.status === 'failed' ? ' text-bad' : ''}`}>{syncLabel}</span><button type="button" className="icon-button theme-toggle" onClick={toggleTheme} aria-label={`Ganti ke mode ${theme === 'dark' ? 'terang' : 'gelap'}`} title={`Ganti ke mode ${theme === 'dark' ? 'terang' : 'gelap'}`}>{theme === 'dark' ? '☀' : '☾'}</button><button type="button" className="refresh-button" onClick={onRefresh} aria-label="Muat ulang semua sumber">↻ MUAT ULANG</button>
        <span className="account"><button type="button" className="refresh-button account-button" aria-expanded={accountOpen} aria-haspopup="menu" onClick={() => setAccountOpen(!accountOpen)} title={me.user.email}>{me.user.name}<small>{me.user.role ?? 'Tanpa peran'}</small></button>
          {accountOpen && <span className="account-menu" role="menu"><a role="menuitem" href={DAILY_URL} target="_blank" rel="noopener">Buka daily ↗</a><button type="button" role="menuitem" onClick={signOut}>Keluar</button></span>}</span></span></header>
      {!me.hermes && <section className="notice" role="alert"><strong>Hermes belum terhubung.</strong> API daily belum diberi HERMES_BRIDGE_URL dan BRIDGE_TOKEN, jadi kantor dan papan tugas kosong.</section>}
      {content}
    </main></div>
}

export function App() {
  const [tick, setTick] = useState(0)
  // undefined while checking; null when signed out.
  const [me, setMe] = useState<Me | null | undefined>()
  const [authError, setAuthError] = useState<string>()
  useEffect(() => {
    let active = true
    // An unreachable API keeps the current state; the pages show it as unavailable.
    const check = () => void loadMe().then((next) => { if (active && next !== undefined) setMe(next); else if (active) setMe((current) => current ?? null) })
    // First take the token (or one-time link) daily put in the address after sign-in.
    void consumeAuthRedirect().then((error) => { if (active) { setAuthError(error); check() } })
    window.addEventListener(LOCKED_EVENT, check)
    return () => { active = false; window.removeEventListener(LOCKED_EVENT, check) }
  }, [])
  if (me === undefined) return <main className="lock-screen" aria-busy="true"/>
  if (me === null) return <LoginScreen error={authError}/>
  return <MeContext.Provider value={me}><RefreshContext.Provider value={tick}><Shell me={me} onSignedOut={() => setMe(null)} onRefresh={() => setTick((value) => value + 1)}/></RefreshContext.Provider></MeContext.Provider>
}

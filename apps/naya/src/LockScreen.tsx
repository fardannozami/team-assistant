import { useEffect } from 'react'
import { AUTH_ERRORS } from './access.ts'
import { googleLoginUrl } from './api.ts'

/** Shown instead of the app until the person signs in with their daily account. */
export function LoginScreen({ error }: { error?: string }) {
  useEffect(() => { document.title = 'Masuk · Naya' }, [])
  const message = error ? AUTH_ERRORS[error] ?? 'Masuk gagal. Coba lagi.' : undefined
  return <main className="lock-screen">
    <section className="lock-card" aria-labelledby="login-title">
      <p className="brand">NAYA<span>DIGDAYA AI STUDIO</span></p>
      <h1 id="login-title">Selamat datang di Naya</h1>
      <p className="muted">Kantor tim AI PT Digdaya Inovasi Gemilang. Masuk dengan akun daily Anda; peran Anda di daily menentukan apa yang bisa Anda lakukan di sini.</p>
      {message && <p className="form-error" role="alert">{message}</p>}
      <a className="primary-button" href={googleLoginUrl()}>Masuk dengan Google</a>
      <p className="small-note">Sudah masuk di daily? Klik <b>Naya ↗</b> di sana. Di HP, ketik <code>NAYA</code> ke bot WhatsApp daily untuk mendapat link masuk.</p>
    </section>
  </main>
}

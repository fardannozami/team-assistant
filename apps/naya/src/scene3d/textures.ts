import * as THREE from 'three'
import digdayaLogo from '../assets/digdaya-logo.svg?raw'

// Procedural canvas textures, so the 3D office ships without image or model files.
// Each texture is created once and cached.

const cache = new Map<string, THREE.Texture>()

function canvasTexture(key: string, width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.Texture {
  const cached = cache.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx) draw(ctx)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(...repeat)
  }
  cache.set(key, texture)
  return texture
}

/** Deterministic pseudo-random numbers so textures look the same on every load. */
function random(seed: number) {
  let value = seed
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

/** Warm parquet planks (like the reference office floor). */
export function woodFloor(repeat: [number, number]) {
  return canvasTexture(`wood-${repeat.join('x')}`, 512, 512, (ctx) => {
    const rand = random(7)
    const tones = ['#b98355', '#a9744a', '#c48f5f', '#b07b4f', '#9f6c43']
    const plankH = 64
    for (let row = 0; row < 512 / plankH; row += 1) {
      let x = row % 2 === 0 ? 0 : -96
      while (x < 512) {
        const width = 128 + Math.floor(rand() * 96)
        ctx.fillStyle = tones[Math.floor(rand() * tones.length)]
        ctx.fillRect(x, row * plankH, width, plankH)
        ctx.strokeStyle = 'rgba(60,35,20,0.18)'
        for (let grain = 0; grain < 5; grain += 1) {
          const y = row * plankH + 8 + rand() * (plankH - 16)
          ctx.beginPath(); ctx.moveTo(x + 4, y); ctx.bezierCurveTo(x + width / 3, y + 3, x + (2 * width) / 3, y - 3, x + width - 4, y); ctx.stroke()
        }
        ctx.fillStyle = 'rgba(50,28,15,0.55)'
        ctx.fillRect(x, row * plankH, 2, plankH)
        x += width
      }
      ctx.fillStyle = 'rgba(50,28,15,0.5)'
      ctx.fillRect(0, row * plankH, 512, 2)
    }
  }, repeat)
}

/** Light ceramic tiles for the pantry. */
export function tileFloor(repeat: [number, number]) {
  return canvasTexture(`tile-${repeat.join('x')}`, 256, 256, (ctx) => {
    ctx.fillStyle = '#e9e4da'; ctx.fillRect(0, 0, 256, 256)
    ctx.fillStyle = '#d6cfc2'
    for (let i = 0; i <= 256; i += 64) { ctx.fillRect(i - 1, 0, 2, 256); ctx.fillRect(0, i - 1, 256, 2) }
  }, repeat)
}

export function carpet(color: string, repeat: [number, number]) {
  return canvasTexture(`carpet-${color}-${repeat.join('x')}`, 128, 128, (ctx) => {
    const rand = random(11)
    ctx.fillStyle = color; ctx.fillRect(0, 0, 128, 128)
    for (let i = 0; i < 900; i += 1) { ctx.fillStyle = `rgba(0,0,0,${rand() * 0.08})`; ctx.fillRect(rand() * 128, rand() * 128, 1, 1) }
  }, repeat)
}

export function grass(repeat: [number, number]) {
  return canvasTexture(`grass-${repeat.join('x')}`, 256, 256, (ctx) => {
    const rand = random(3)
    ctx.fillStyle = '#5d8f4e'; ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 2600; i += 1) {
      const shade = 70 + Math.floor(rand() * 60)
      ctx.fillStyle = `rgb(${shade - 25},${shade + 55},${shade - 30})`
      ctx.fillRect(rand() * 256, rand() * 256, 2, 3)
    }
  }, repeat)
}

export function asphalt(repeat: [number, number]) {
  return canvasTexture(`asphalt-${repeat.join('x')}`, 256, 256, (ctx) => {
    const rand = random(5)
    ctx.fillStyle = '#3d4044'; ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 3000; i += 1) { const g = 50 + Math.floor(rand() * 40); ctx.fillStyle = `rgb(${g},${g},${g + 4})`; ctx.fillRect(rand() * 256, rand() * 256, 1.5, 1.5) }
    ctx.fillStyle = '#e8dfa0'
    ctx.fillRect(0, 124, 110, 8); ctx.fillRect(146, 124, 110, 8)
  }, repeat)
}

export function pavingStones(repeat: [number, number]) {
  return canvasTexture(`paving-${repeat.join('x')}`, 256, 256, (ctx) => {
    ctx.fillStyle = '#b8b2a6'; ctx.fillRect(0, 0, 256, 256)
    ctx.fillStyle = '#a19b8f'
    for (let y = 0; y < 256; y += 32) {
      ctx.fillRect(0, y, 256, 2)
      for (let x = (y / 32) % 2 === 0 ? 0 : 32; x < 256; x += 64) ctx.fillRect(x, y, 2, 32)
    }
  }, repeat)
}

/** Painted street-food sign: bold text on a coloured board. */
export function signTexture(text: string, background: string, foreground: string, subtitle?: string) {
  return canvasTexture(`sign-${text}-${background}-${subtitle ?? ''}`, 512, 160, (ctx) => {
    ctx.fillStyle = background; ctx.fillRect(0, 0, 512, 160)
    ctx.strokeStyle = foreground; ctx.lineWidth = 8; ctx.strokeRect(10, 10, 492, 140)
    ctx.fillStyle = foreground
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.font = 'bold 76px Georgia, "Times New Roman", serif'
    ctx.fillText(text, 256, subtitle ? 66 : 82)
    if (subtitle) { ctx.font = 'bold 30px Arial, sans-serif'; ctx.fillText(subtitle, 256, 124) }
  })
}

/** The Indonesian flag: red over white. */
export function merahPutih() {
  return canvasTexture('merah-putih', 96, 64, (ctx) => {
    ctx.fillStyle = '#ce1126'; ctx.fillRect(0, 0, 96, 32)
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 32, 96, 32)
  })
}

export function screenTexture(active: boolean) {
  return canvasTexture(`screen-${active}`, 128, 80, (ctx) => {
    ctx.fillStyle = active ? '#15313a' : '#0d1112'; ctx.fillRect(0, 0, 128, 80)
    if (!active) return
    const rand = random(13)
    for (let line = 0; line < 9; line += 1) {
      ctx.fillStyle = ['#7ee0c3', '#f2c58a', '#a9d4ff', '#e7e7e7'][line % 4]
      ctx.fillRect(8 + (line % 3) * 6, 8 + line * 7.5, 30 + rand() * 70, 3)
    }
  })
}

/** A retro game on the arcade screens: a grid of bricks, a paddle and a ball. */
export function arcadeScreen() {
  return canvasTexture('arcade-screen', 128, 100, (ctx) => {
    ctx.fillStyle = '#0b1026'; ctx.fillRect(0, 0, 128, 100)
    const colors = ['#e63946', '#f4a261', '#f4d35e', '#2a9d8f', '#3a86ff']
    colors.forEach((color, row) => { ctx.fillStyle = color; for (let col = 0; col < 8; col += 1) ctx.fillRect(6 + col * 15, 10 + row * 7, 13, 5) })
    ctx.fillStyle = '#ffffff'; ctx.fillRect(52, 88, 26, 4); ctx.fillRect(70, 64, 4, 4)
  })
}


/** The logo's viewBox. */
const LOGO_WIDTH = 163
const LOGO_HEIGHT = 44

/** Digdaya's blue, as in the blueprint. */
export const DIGDAYA_BLUE = '#1f4fd8'

/**
 * A sign face with Digdaya's logo (src/assets/digdaya-logo.svg, drawn in `currentColor`) and an
 * optional line below. `dark` is white on blue, for signs that light up at night. The logo is an
 * image, so it is drawn when it has loaded and the texture refreshes then.
 */
export function digdayaSign(subtitle = '', dark = false) {
  const key = `digdaya-${subtitle}-${dark}`
  const fresh = !cache.has(key)
  const fg = dark ? '#ffffff' : DIGDAYA_BLUE
  const texture = canvasTexture(key, 1024, 256, (ctx) => {
    ctx.fillStyle = dark ? DIGDAYA_BLUE : '#f7f5ef'
    ctx.fillRect(0, 0, 1024, 256)
    if (subtitle) {
      ctx.fillStyle = fg
      ctx.globalAlpha = 0.85
      ctx.font = '600 40px system-ui, "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(subtitle, 512, 214, 960)
      ctx.globalAlpha = 1
    }
  })
  if (fresh && typeof Image !== 'undefined') {
    const image = new Image()
    image.onload = () => {
      const ctx = (texture.image as HTMLCanvasElement).getContext('2d')
      if (!ctx) return
      // The logo is 163×44: as large as fits above the subtitle, centred.
      const height = subtitle ? 140 : 190
      const width = (height * LOGO_WIDTH) / LOGO_HEIGHT
      ctx.drawImage(image, (1024 - width) / 2, subtitle ? 28 : (256 - height) / 2, width, height)
      texture.needsUpdate = true
    }
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(digdayaLogo.replaceAll('currentColor', fg))}`
  }
  return texture
}

/** A plain text plate, e.g. "POS SATPAM" or the doormat's "SELAMAT DATANG". */
export function textPlate(text: string, background: string, color: string, width = 512, height = 128) {
  return canvasTexture(`plate-${text}-${background}-${color}-${width}x${height}`, width, height, (ctx) => {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = color
    ctx.font = `800 ${Math.round(height * 0.5)}px system-ui, "Segoe UI", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, width / 2, height / 2 + 2, width - 24)
  })
}

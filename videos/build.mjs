// Builds one walkthrough video: node build.mjs <role>
//
// For each scene in scenes/<role>.mjs it
//   1. turns the narration into speech (edge-tts, a free neural voice),
//   2. drives the real app in a browser while recording the screen,
//   3. holds each scene open for as long as its narration lasts,
// then lays the speech over the recording with ffmpeg and writes out/<role>.mp4.
//
// The app and API must already be running (see README.md). Nothing here saves
// or sends anything: scenes only look, type into fields and open dialogs.
import { chromium } from 'playwright'
import ffmpegPath from 'ffmpeg-static'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { synth, writeWav } from './music.mjs'

const role = process.argv[2]
if (!role) throw new Error('usage: node build.mjs <role>')

const BASE = process.env.APP_URL ?? 'http://localhost:5173'
const VOICE = process.env.VOICE ?? 'en-GB-SoniaNeural'
const SIZE = { width: 1280, height: 720 }
const work = join('work', role)
const out = 'out'
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
mkdirSync(out, { recursive: true })

const { meta, scenes } = await import(`./scenes/${role}.mjs`)

const firstLine = (error) => String(error.message).split(/\r?\n/)[0]

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${cmd} failed:\n${r.stderr}`)
  return r
}

/** Length of an audio file in seconds, read from ffmpeg's own banner. */
function seconds(file) {
  const r = spawnSync(ffmpegPath, ['-i', file], { encoding: 'utf8' })
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(r.stderr)
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

// 1. Speech
const audio = scenes.map((scene, i) => {
  const file = join(work, `s${String(i).padStart(2, '0')}.mp3`)
  run('python', ['-m', 'edge_tts', '--voice', VOICE, '--rate=-5%', '--text', scene.say, '--write-media', file])
  return { file, length: seconds(file) }
})

// 2. Recording. A fake cursor and a caption bar are drawn into the page itself,
// because the browser's real cursor is not part of a screen recording.
const overlay = () => {
  if (document.getElementById('v-cursor')) return
  const style = document.createElement('style')
  style.textContent = `
    #v-cursor{position:fixed;z-index:2147483647;width:22px;height:22px;border-radius:50%;
      background:rgba(255,193,7,.9);border:2px solid #0b3b8f;pointer-events:none;
      transform:translate(-50%,-50%);transition:transform .12s;left:-50px;top:-50px}
    #v-cursor.down{transform:translate(-50%,-50%) scale(.7)}
    #v-caption{position:fixed;z-index:2147483646;left:50%;bottom:28px;transform:translateX(-50%);
      max-width:78%;background:rgba(8,38,87,.94);color:#fff;font:600 21px/1.4 system-ui,sans-serif;
      padding:12px 22px;border-radius:14px;text-align:center;pointer-events:none}
    #v-caption:empty{display:none}`
  document.head.append(style)
  const cursor = document.createElement('div')
  cursor.id = 'v-cursor'
  const caption = document.createElement('div')
  caption.id = 'v-caption'
  document.body.append(cursor, caption)
  try { caption.textContent = sessionStorage.getItem('v-caption') || '' } catch {}
  addEventListener('mousemove', (e) => {
    cursor.style.left = e.clientX + 'px'
    cursor.style.top = e.clientY + 'px'
  })
  addEventListener('mousedown', () => cursor.classList.add('down'))
  addEventListener('mouseup', () => cursor.classList.remove('down'))
}

const browser = await chromium.launch({ channel: 'msedge' })
const context = await browser.newContext({
  viewport: SIZE,
  deviceScaleFactor: 1,
})
const page = await context.newPage()

// Recording: the browser's own screencast hands over a JPEG whenever the page
// changes. (Playwright's built-in recorder needs a separate ffmpeg download,
// which this works without.) Each frame is stamped with the moment it arrived.
const frames = []
const framesDir = join(work, 'frames')
mkdirSync(framesDir)
const cdp = await context.newCDPSession(page)
cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
  const file = join(framesDir, `f${String(frames.length).padStart(6, '0')}.jpg`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  frames.push({ file, at: Date.now() })
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
})
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: SIZE.width, maxHeight: SIZE.height })
// The init script runs before <body> exists, so wait for it.
await page.addInitScript(`(${overlay.toString()})`.replace(/^\((.*)\)$/s, '(() => { const run = $1; if (document.body) run(); else addEventListener("DOMContentLoaded", run) })()'))
// Dismiss the one-time storage notice so it never covers a scene.
await page.addInitScript(() => {
  try {
    localStorage.setItem('jdc.storageNoticeSeen', '1')
    localStorage.setItem('jdc.learn.collapsed', '1')
  } catch {}
})

// Time zero is the first frame, so the narration lines up with the picture.
await page.goto(BASE)
while (!frames.length) await page.waitForTimeout(50)
const t0 = frames[0].at
const starts = []

/** What scenes get to use, so they read like a script rather than like Playwright. */
const tools = {
  page,
  go: async (path) => {
    await page.goto(BASE + path)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.locator('svg.animate-spin').first().waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(900)
    await tools.dismiss()
  },
  /**
   * Close whatever popup is covering the page: announcements, the site notice,
   * the WhatsApp channel invite, a seasonal greeting, the guided tour. They
   * appear on a timer after load, so look a few times rather than once.
   */
  dismiss: async () => {
    const names = /^(noted|got it.*|okay|ok|close|skip.*|maybe later|not now|dismiss|no thanks|done)$/i
    for (let round = 0; round < 4; round++) {
      let closed = false
      for (const root of [page.locator('[role=dialog]'), page.locator('body')]) {
        const button = root.getByRole('button', { name: names }).first()
        if (await button.isVisible().catch(() => false)) {
          await button.click({ timeout: 2000 }).catch(() => {})
          closed = true
          await page.waitForTimeout(500)
          break
        }
      }
      if (!closed) {
        await page.waitForTimeout(600)
        if (!(await page.locator('[role=dialog]').first().isVisible().catch(() => false))) break
      }
    }
  },
  /** Move the visible cursor to something, then click it. */
  click: async (target) => {
    const el = typeof target === 'string' ? page.locator(target).first() : target
    await el.scrollIntoViewIfNeeded()
    const box = await el.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 })
    await page.waitForTimeout(350)
    await el.click()
    await page.waitForTimeout(500)
  },
  point: async (target) => {
    const el = typeof target === 'string' ? page.locator(target).first() : target
    await el.scrollIntoViewIfNeeded()
    const box = await el.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 30 })
  },
  type: async (target, text) => {
    await tools.click(target)
    await page.keyboard.type(text, { delay: 90 })
  },
  wait: (ms) => page.waitForTimeout(ms),
}

try {
  if (meta.login) {
    await meta.login(tools, BASE)
    await tools.dismiss()
  }
  for (const [i, scene] of scenes.entries()) {
    await page.evaluate((text) => {
      try { sessionStorage.setItem('v-caption', text) } catch {}
      const c = document.getElementById('v-caption')
      if (c) c.textContent = text
    }, '').catch(() => {})
    // Get the page on screen BEFORE the voice starts, so the narration never
    // describes something that has not appeared yet.
    if (scene.open) await scene.open(tools).catch((e) => console.warn(`scene ${i + 1} open: ${firstLine(e)}`))
    await page.evaluate((text) => {
      try { sessionStorage.setItem('v-caption', text) } catch {}
      const c = document.getElementById('v-caption')
      if (c) c.textContent = text
    }, scene.caption ?? '').catch(() => {})
    // Get the page on screen BEFORE the voice starts, so the narration never
    // describes something that has not appeared yet.
    await page.waitForTimeout(600)
    starts.push((Date.now() - t0) / 1000)
    // The actions run while the voice speaks; the scene lasts until both are done.
    await Promise.all([
      Promise.resolve(scene.do?.(tools)).catch((e) => console.warn(`scene ${i + 1} "${scene.caption}": ${firstLine(e)}`)),
      page.waitForTimeout((audio[i].length + 0.8) * 1000),
    ])
  }
} finally {
  await page.waitForTimeout(500)
  await cdp.send('Page.stopScreencast').catch(() => {})
  var endAt = Date.now()
  await context.close()
  await browser.close()
}

// 3. Frames become a 25 fps video: each JPEG is shown until the next arrives.
const unix = (file) => resolve(file).split(String.fromCharCode(92)).join('/')
const cutAt = t0 + starts[0] * 1000
// Sample the recording on an exact 25 fps clock: at every 40 ms tick, show the
// latest frame that had arrived. Bursts of frames during an animation are
// dropped rather than each being given screen time, which would stretch the
// video and push it behind the narration.
const TICK = 40
const ticks = Math.floor((endAt - cutAt) / TICK)
const runs = []
let cursor = Math.max(0, frames.findLastIndex((f) => f.at <= cutAt))
for (let n = 0; n < ticks; n++) {
  const time = cutAt + n * TICK
  while (cursor + 1 < frames.length && frames[cursor + 1].at <= time) cursor++
  const last = runs.at(-1)
  if (last && last.frame === cursor) last.ticks++
  else runs.push({ frame: cursor, ticks: 1 })
}
const NL = String.fromCharCode(10)
const entry = (r) => `file '${unix(frames[r.frame].file)}'${NL}duration ${((r.ticks * TICK) / 1000).toFixed(3)}`
const lastFrame = frames[runs.at(-1).frame]
writeFileSync(
  join(work, 'frames.txt'),
  runs.map(entry).join(NL) + NL + `file '${unix(lastFrame.file)}'` + NL,
)
run(ffmpegPath, [
  '-y', '-f', 'concat', '-safe', '0', '-i', join(work, 'frames.txt'),
  '-vf', 'fps=25,format=yuv420p', '-c:v', 'libx264', '-crf', '22', join(work, 'screen.mp4'),
])

// 4. Music: an upbeat track synthesised in music.mjs (no samples, no licensing),
// looped under the whole video.
const music = join('work', 'music.wav')
writeWav(music, synth(Number(process.env.BPM) || 124))

// 5. Mix: each clip is delayed to its scene's start, the music sits underneath
// and dips whenever the voice is speaking.
const inputs = audio.flatMap((a) => ['-i', a.file])
const delays = audio.map((_, i) => `[${i + 1}:a]adelay=${Math.round((starts[i] - starts[0]) * 1000)}:all=1[a${i}]`)
const musicIn = audio.length + 1
const videoLength = ((endAt - t0) / 1000 - starts[0]).toFixed(2)
const mix = [
  ...delays,
  `${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length}:normalize=0,asplit[voice1][voice2]`,
  `[${musicIn}:a]volume=0.5,afade=t=in:d=1.5,afade=t=out:st=${Math.max(0, videoLength - 4)}:d=4[bed]`,
  `[bed][voice1]sidechaincompress=threshold=0.015:ratio=12:attack=20:release=500[ducked]`,
  `[ducked][voice2]amix=inputs=2:normalize=0[aout]`,
].join(';')
const target = join(out, `${role}.mp4`)
run(ffmpegPath, [
  '-y', '-i', join(work, 'screen.mp4'), ...inputs, '-stream_loop', '-1', '-i', music,
  '-filter_complex', mix,
  '-map', '0:v', '-map', '[aout]',
  '-c:v', 'copy', '-c:a', 'aac', '-t', videoLength, target,
])
writeFileSync(join(out, `${role}.script.txt`), scenes.map((s, i) => `[${i + 1}] ${s.say}`).join('\n\n'))
console.log('narration starts (s into video): ' + starts.map((x) => (x - starts[0]).toFixed(1)).join(', '))
console.log(`done: ${target}`)

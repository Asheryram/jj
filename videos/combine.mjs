// Joins the admin chapters into one video: node combine.mjs
//
// Each chapter fades out and the next fades in (half a second each), and the
// result carries chapter markers, so a player's chapter menu lists the
// parts. The chapter files in out/ are only read, never changed.
import ffmpegPath from 'ffmpeg-static'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SETS = {
  admin: [
    'admin-1-start',
    'admin-2-catalogue',
    'admin-3-orders',
    'admin-4-money-out',
    'admin-5-finance',
    'admin-6-people',
    'admin-7-shops',
    'admin-8-settings',
  ],
  agent: ['agent-1-start', 'agent-2-sell', 'agent-3-shop', 'agent-4-money', 'agent-5-help'],
}
const set = process.argv[2] ?? 'admin'
const CHAPTERS = SETS[set]
if (!CHAPTERS) throw new Error('usage: node combine.mjs <' + Object.keys(SETS).join('|') + '>')
const FADE = 0.5
const target = join('out', `${set}-complete.mp4`)

function seconds(file) {
  const r = spawnSync(ffmpegPath, ['-i', file], { encoding: 'utf8' })
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(r.stderr)
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

const items = []
for (const name of CHAPTERS) {
  const file = join('out', `${name}.mp4`)
  const { meta } = await import(`./scenes/${name}.mjs`)
  items.push({ name, file, title: meta.title, length: seconds(file) })
}

// Chapter markers, in milliseconds.
let at = 0
const lines = [';FFMETADATA1', `title=JKBK Data Hub: the complete ${set} guide`]
for (const item of items) {
  const start = Math.round(at * 1000)
  at += item.length
  lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${start}`, `END=${Math.round(at * 1000)}`, `title=${item.title}`)
}
const metaFile = join('work', `${set}-complete.ffmetadata`)
writeFileSync(metaFile, lines.join('\n') + '\n')

const inputs = items.flatMap((item) => ['-i', item.file])
const parts = items.map((item, i) => {
  const out = Math.max(0, item.length - FADE)
  return (
    `[${i}:v]fade=t=in:st=0:d=${FADE},fade=t=out:st=${out.toFixed(2)}:d=${FADE}[v${i}];` +
    `[${i}:a]afade=t=in:st=0:d=${FADE},afade=t=out:st=${out.toFixed(2)}:d=${FADE}[a${i}]`
  )
})
const joined = items.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${items.length}:v=1:a=1[v][a]`
const graph = `${parts.join(';')};${joined}`

const result = spawnSync(
  ffmpegPath,
  [
    '-y', ...inputs, '-i', metaFile,
    '-filter_complex', graph,
    '-map', '[v]', '-map', '[a]', '-map_metadata', String(items.length), '-map_chapters', String(items.length),
    '-c:v', 'libx264', '-crf', '23', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', target,
  ],
  { encoding: 'utf8' },
)
if (result.status !== 0) throw new Error(result.stderr.split(/\r?\n/).slice(-15).join('\n'))

const minutes = (at / 60).toFixed(1)
console.log(`wrote ${target} (${minutes} minutes, ${items.length} chapters)`)
for (const item of items) console.log(`  ${item.title}`)

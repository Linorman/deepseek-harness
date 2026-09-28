import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { scanZstdFrames, decompressZstdFrame } from '../../../packages/session/session-persistence-jsonl/src/zstd.ts'
const root = '.tmp/failed-rp-738eTl/.clocky/sessions'
for (const file of await readdir(root, { recursive: true })) {
  if (!file.includes('reviewer') || !file.endsWith('.zstd')) continue
  const content = await readFile(join(root, file))
  const decoded = Buffer.concat(await Promise.all(scanZstdFrames(content).frames.map(frame => decompressZstdFrame(content.subarray(frame.start, frame.end)))))
  for (const line of decoded.toString().trim().split('\n')) {
    const record = JSON.parse(line)
    if (['turn/end','tool/call','tool/result','team/channel-view'].includes(record.type)) console.log(JSON.stringify(record))
    if (record.type === 'user/message') console.log(JSON.stringify(record.data.content).slice(0,2500))
  }
}

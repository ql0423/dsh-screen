// Minimal PNG encoder (no dependencies). Encodes 8-bit RGB or RGBA scanlines.
import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'latin1')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crcBuf])
}

/**
 * @param {{width:number,height:number,data:Buffer,channels:3|4}} image
 * @returns {Buffer} PNG bytes
 */
export function encodePng({ width, height, data, channels = 3 }) {
  const expected = width * height * channels
  if (data.length < expected) throw new Error(`pixel buffer too small: ${data.length} < ${expected}`)

  // Filter byte 0 (None) per scanline keeps this simple and still compresses well on flat UI pixels.
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    data.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = channels === 4 ? 6 : 2 // color type: 6 = RGBA, 2 = RGB
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Box-filter downsample so screenshots stay inside a sane pixel budget. */
export function downscale({ width, height, data, channels = 3 }, maxWidth, maxHeight) {
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  if (scale >= 1) return { width, height, data, channels }
  const outW = Math.max(1, Math.round(width * scale))
  const outH = Math.max(1, Math.round(height * scale))
  const out = Buffer.alloc(outW * outH * channels)
  const sx = width / outW
  const sy = height / outH
  for (let y = 0; y < outH; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy))
    for (let x = 0; x < outW; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx))
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * width + xx) * channels
          r += data[i]; g += data[i + 1]; b += data[i + 2]
          if (channels === 4) a += data[i + 3]
          n++
        }
      }
      const o = (y * outW + x) * channels
      out[o] = Math.round(r / n)
      out[o + 1] = Math.round(g / n)
      out[o + 2] = Math.round(b / n)
      if (channels === 4) out[o + 3] = Math.round(a / n)
    }
  }
  return { width: outW, height: outH, data: out, channels }
}
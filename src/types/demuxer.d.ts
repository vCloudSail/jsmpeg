import MP2 from '@/modules/decoder/mp2'
import MP2WASM from '@/modules/decoder/mp2-wasm'
import MPEG1 from '@/modules/decoder/mpeg1'
import MPEG1WASM from '@/modules/decoder/mpeg1-wasm'

export interface PesPacket {
  destination: MPEG1 | MPEG1WASM | MP2 | MP2WASM
  currentLength: number
  totalLength: number
  pts: number
  buffers: BitBuffer
}

import BitBuffer from '../buffer'
import MP2 from '../decoder/mp2'
import MP2WASM from '../decoder/mp2-wasm'
import MPEG1 from '../decoder/mpeg1'
import MPEG1WASM from '../decoder/mpeg1-wasm'

export default class TS {
  /**
   * @type {BitBuffer}
   * */
  bits
  /**
   * @type {{[key:string]: import('@/types/demuxer').PesPacket}}
   */
  pesPacketInfo
  /**
   * @type {{ [key:string]: string }}
   */
  pidsToStreamIds
  /**
   * 开始时间
   * @type {number}
   */
  startTime
  /**
   * 当前时间
   * @type {number}
   */
  currentTime
  /**
   * @type {boolean}
   */
  guessVideoFrameEnd

  constructor(options) {
    this.bits = null
    this.leftoverBytes = null

    this.guessVideoFrameEnd = true
    this.pidsToStreamIds = {}

    this.pesPacketInfo = {}
    this.startTime = 0
    this.currentTime = 0
  }

  connect(streamId, destination) {
    this.pesPacketInfo[streamId] = {
      destination: destination,
      currentLength: 0,
      totalLength: 0,
      pts: 0,
      buffers: []
    }
  }

  write(buffer) {
    if (this.leftoverBytes) {
      let totalLength = buffer.byteLength + this.leftoverBytes.byteLength
      this.bits = new BitBuffer(totalLength)
      this.bits.write([this.leftoverBytes, buffer])
    } else {
      this.bits = new BitBuffer(buffer)
    }

    while (this.bits.has(188 << 3) && this.parsePacket()) {}

    let leftoverCount = this.bits.byteLength - (this.bits.index >> 3)
    this.leftoverBytes = leftoverCount > 0 ? this.bits.bytes.subarray(this.bits.index >> 3) : null
  }

  parsePacket() {
    // Check if we're in sync with packet boundaries; attempt to resync if not.
    if (this.bits.read(8) !== 0x47) {
      if (!this.resync()) {
        // Couldn't resync; maybe next time...
        return false
      }
    }

    let end = (this.bits.index >> 3) + 187
    let transportError = this.bits.read(1),
      payloadStart = this.bits.read(1),
      transportPriority = this.bits.read(1),
      pid = this.bits.read(13),
      transportScrambling = this.bits.read(2),
      adaptationField = this.bits.read(2),
      continuityCounter = this.bits.read(4)

    // If this is the start of a new payload; signal the end of the previous
    // frame, if we didn't do so already.
    let streamId = this.pidsToStreamIds[pid]
    if (payloadStart && streamId) {
      let pi = this.pesPacketInfo[streamId]
      if (pi && pi.currentLength) {
        this.packetComplete(pi)
      }
    }

    // Extract current payload
    if (adaptationField & 0x1) {
      if (adaptationField & 0x2) {
        let adaptationFieldLength = this.bits.read(8)
        this.bits.skip(adaptationFieldLength << 3)
      }

      if (payloadStart && this.bits.nextBytesAreStartCode()) {
        this.bits.skip(24)
        streamId = this.bits.read(8)
        this.pidsToStreamIds[pid] = streamId

        let packetLength = this.bits.read(16)
        this.bits.skip(8)
        let ptsDtsFlag = this.bits.read(2)
        this.bits.skip(6)
        let headerLength = this.bits.read(8)
        let payloadBeginIndex = this.bits.index + (headerLength << 3)

        let pi = this.pesPacketInfo[streamId]
        if (pi) {
          let pts = 0
          if (ptsDtsFlag & 0x2) {
            // The Presentation Timestamp is encoded as 33(!) bit
            // integer, but has a "marker bit" inserted at weird places
            // in between, making the whole thing 5 bytes in size.
            // You can't make this shit up...
            this.bits.skip(4)
            let p32_30 = this.bits.read(3)
            this.bits.skip(1)
            let p29_15 = this.bits.read(15)
            this.bits.skip(1)
            let p14_0 = this.bits.read(15)
            this.bits.skip(1)

            // Can't use bit shifts here; we need 33 bits of precision,
            // so we're using JavaScript's double number type. Also
            // divide by the 90khz clock to get the pts in seconds.
            pts = (p32_30 * 1073741824 + p29_15 * 32768 + p14_0) / 90000
            this.currentTime = pts
            if (this.startTime === -1) {
              this.startTime = pts
            }
          }

          let payloadLength = packetLength ? packetLength - headerLength - 3 : 0
          this.packetStart(pi, pts, payloadLength)
        }

        // Skip the rest of the header without parsing it
        this.bits.index = payloadBeginIndex
      }

      if (streamId) {
        // Attempt to detect if the PES packet is complete. For Audio (and
        // other) packets, we received a total packet length with the PES
        // header, so we can check the current length.

        // For Video packets, we have to guess the end by detecting if this
        // TS packet was padded - there's no good reason to pad a TS packet
        // in between, but it might just fit exactly. If this fails, we can
        // only wait for the next PES header for that stream.

        let pi = this.pesPacketInfo[streamId]
        if (pi) {
          let start = this.bits.index >> 3
          let complete = this.packetAddData(pi, start, end)

          let hasPadding = !payloadStart && adaptationField & 0x2
          if (complete || (this.guessVideoFrameEnd && hasPadding)) {
            this.packetComplete(pi)
          }
        }
      }
    }

    this.bits.index = end << 3
    return true
  }

  resync() {
    // Check if we have enough data to attempt a resync. We need 5 full packets.
    if (!this.bits.has((188 * 6) << 3)) {
      return false
    }

    let byteIndex = this.bits.index >> 3

    // Look for the first sync token in the first 187 bytes
    for (let i = 0; i < 187; i++) {
      if (this.bits.bytes[byteIndex + i] === 0x47) {
        // Look for 4 more sync tokens, each 188 bytes appart
        let foundSync = true
        for (let j = 1; j < 5; j++) {
          if (this.bits.bytes[byteIndex + i + 188 * j] !== 0x47) {
            foundSync = false
            break
          }
        }

        if (foundSync) {
          this.bits.index = (byteIndex + i + 1) << 3
          return true
        }
      }
    }

    // In theory, we shouldn't arrive here. If we do, we had enough data but
    // still didn't find sync - this can only happen if we were fed garbage
    // data. Check your source!
    // console.warn('JSMpeg: Possible garbage data. Skipping.')
    this.bits.skip(187 << 3)
    return false
  }

  packetStart(pi, pts, payloadLength) {
    pi.totalLength = payloadLength
    pi.currentLength = 0
    pi.pts = pts
  }

  packetAddData(pi, start, end) {
    pi.buffers.push(this.bits.bytes.subarray(start, end))
    pi.currentLength += end - start

    let complete = pi.totalLength !== 0 && pi.currentLength >= pi.totalLength
    return complete
  }

  /**
   *
   * @param {import('@/types/demuxer').PesPacket} pi
   */
  packetComplete(pi) {
    // 在这里将视频/音频流写入了对应的解码器
    pi.destination.write(pi.pts, pi.buffers)
    pi.totalLength = 0
    pi.currentLength = 0
    pi.buffers = []
  }

  static STREAM = {
    PACK_HEADER: 0xba,
    SYSTEM_HEADER: 0xbb,
    PROGRAM_MAP: 0xbc,
    PRIVATE_1: 0xbd,
    PADDING: 0xbe,
    PRIVATE_2: 0xbf,
    AUDIO_1: 0xc0,
    VIDEO_1: 0xe0,
    DIRECTORY: 0xff
  }
}

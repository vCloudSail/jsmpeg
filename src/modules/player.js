import Renderer from './renderer'
import { Base64ToArrayBuffer, download, Now } from '../utils'
import AudioOutput from './audio-output'
import Decoder from './decoder'
import Demuxer from './demuxer'
import Source from './source'
import WASM from './wasm-module'
import AjaxSource from './source/ajax'
import AjaxProgressiveSource from './source/ajax-progressive'
import WSSource from './source/websocket'
import BitBuffer from './buffer'
import Recorder from './recorder'
// import WASM_BINARY_INLINED from '../wasm/jsmpeg.wasm.base64?raw'
import WASM_BINARY_INLINED from '../wasm'
import { EventBus } from '../utils/event-bus'
import { merge } from 'lodash-es'

/**
 * @returns {import('@/types/player').PlayerOptions}
 */
const defaultOptions = () => ({
  autoplay: true,
  udio: true,
  video: true,
  poster: null,
  pauseWhenHidden: true,
  disableGl: false,
  disableWebAssembly: false,
  preserveDrawingBuffer: true,
  progressive: true,
  throttled: true,
  chunkSize: 1024 * 1024,
  decodeFirstFrame: true,
  maxAudioLag: 0.25,
  videoBufferSize: 10 * 1024 * 1024,
  audioBufferSize: 128 * 1024
})

// import WASM
// The build process may append `JSMpeg.WASM_BINARY_INLINED = base64data;`
// to the minified source.
// If this property is present, jsmpeg will use the inlined binary data
// instead of trying to load a jsmpeg.wasm file via Ajax.

/**
 * @class {import('../jsmpeg').JSMpegPlayer}
 * @author cloudsail
 */
export default class Player {
  /**
   * @type {import('../types/player').PlayerOptions}
   */
  options
  /** @type {WSSource|AjaxSource|AjaxProgressiveSource} */
  source = null
  /** @type {HTMLCanvasElement} */
  canvas = null
  /** @type {HTMLElement} */
  contianer = null
  /**
   * 播放器状态
   * @type {'playing'|'stoped'|'paused'|'in-background'}
   */
  // status = 'stoped'
  /**
   * 录制器
   * @type {import('./recorder').default}
   */
  recorder = null
  /** 播放器状态 */
  store = {
    canvasAngle: 0,
    /** 表示播放器处于后台（不可见状态） */
    isBackground: false
  }

  get isRecording() {
    return !!this.recorder?.running
  }
  /** 录制持续时间 */
  get recordingDuration() {
    return this.recorder?.duration
  }
  /** 是否处于暂停状态 */
  paused = false
  /** 是否循环播放 */
  loop = false
  /** 是否正在播放 */
  isPlaying = false
  /** @type {number} */
  currentTime
  /** @type {number} */
  volume
  get delay() {
    if (!this.demuxer.currentTime || !this.startTime) {
      return -1
    }
    return this.demuxer.currentTime - (Now() - this.startTime)
  }
  /**
   *
   * @param {string} url
   * @param {import('../types').PlayerOptions} options
   */
  constructor(url, options = {}) {
    Object.defineProperty(this, 'currentTime', {
      get: this.getCurrentTime,
      set: this.setCurrentTime
    })
    Object.defineProperty(this, 'volume', {
      get: this.getVolume,
      set: this.setVolume
    })
    this.init(url, options)
  }
  /**
   *
   * @param {string} url
   * @param {import('../types/player').PlayerOptions} options
   */
  init(url, options = defaultOptions) {
    this.options = merge(defaultOptions(), options)
    this.options.eventBus = this.eventBus = new EventBus()

    this.initCanvas()
    this.initSource(url)

    this.loop = this.options.loop !== false
    this.autoplay = !!this.options.autoplay || this.options.streaming

    this.demuxer = new Demuxer.TS(options)
    this.source.connect(this.demuxer)

    if (this.options.disableWebAssembly !== true && WASM.IsSupported()) {
      this.wasmModule = WASM.GetModule()
      this.options.wasmModule = this.wasmModule
    }

    this.initVideo()
    this.initAudio()

    this.paused = true
    this.unpauseOnShow = false

    if (this.options.pauseWhenHidden !== false) {
      document.addEventListener('visibilitychange', this.onVisibilityChange, { passive: true })
    }

    // 如果有WebAssembly支持，请等到模块编译完成后再加载源代码。否则，解码器将不知道如何处理源数据。
    if (this.wasmModule) {
      if (this.wasmModule.ready) {
        this.startLoading()
      } else if (WASM_BINARY_INLINED) {
        const wasmBuffer = Base64ToArrayBuffer(WASM_BINARY_INLINED)
        this.wasmModule.loadFromBuffer(wasmBuffer, this.startLoading.bind(this))
      } else {
        this.wasmModule.loadFromFile('jsmpeg.wasm', this.startLoading.bind(this))
      }
    } else {
      this.startLoading()
    }
    this.renderer.clear()
  }

  initCanvas() {
    const options = this.options

    if (!(options.canvas instanceof HTMLCanvasElement)) {
      options.canvas = document.createElement('canvas')
    }
    this.canvas = options.canvas

    if (typeof options.contianer === 'string') {
      options.contianer = document.querySelector(options.contianer)
    } else if (!options.contianer && this.canvas.parentElement) {
      options.contianer = this.canvas.parentElement
    }

    if (!(options.contianer instanceof HTMLElement)) {
      throw new Error('[Player] 找不到容器元素')
    }
    this.contianer = options.contianer
    if (!this.contianer.contains(this.canvas)) {
      this.contianer.appendChild(this.canvas)
    }
  }
  initSource(url = null) {
    const options = this.options
    this.url = url
    if (options.source) {
      this.source = new options.source(url, options)
      options.streaming = !!this.source.streaming
    } else if (url.match(/^wss?:\/\//)) {
      this.source = new Source.WebSocket(url, {
        ...options,
        onSourceEstablished: this.handleSourceEstablished.bind(this),
        onSourceClosedCallback: this.handleSourceClosed.bind(this),
        onSourceStreamInterrupt: this.handleSourceStreamInterrupt.bind(this),
        onSourceConnected: this.handleSourceConnected.bind(this)
      })
      options.streaming = true
    } else if (options.progressive !== false) {
      this.source = new Source.AjaxProgressive(url, options)
      options.streaming = false
    } else {
      this.source = new Source.Ajax(url, options)
      options.streaming = false
    }

    if (this.source.destination == null && this.demuxer) {
      this.source.connect(this.demuxer)
    }
  }
  initVideo() {
    const options = this.options

    if (options.video !== false) {
      this.video = this.wasmModule ? new Decoder.MPEG1VideoWASM(options) : new Decoder.MPEG1Video(options)
      this.video.player = this

      this.renderer =
        options.disableGl !== true && Renderer.WebGL.IsSupported()
          ? new Renderer.WebGL(options)
          : new Renderer.Canvas2D(options)

      this.demuxer.connect(Demuxer.TS.STREAM.VIDEO_1, this.video)
      this.video.connect(this.renderer)
    }
  }
  initAudio() {
    const options = this.options

    if (options.audio !== false && AudioOutput.WebAudio.IsSupported()) {
      this.audio = this.wasmModule ? new Decoder.MP2AudioWASM(options) : new Decoder.MP2Audio(options)
      this.audioOut = new AudioOutput.WebAudio(options)
      this.demuxer.connect(Demuxer.TS.STREAM.AUDIO_1, this.audio)
      this.audio.connect(this.audioOut)
    }
  }

  /**
   * 设置source的url
   * @param {*} url
   */
  setUrl(url = '') {
    if (this.isPlaying) this.stop(true)

    if (this.source instanceof WSSource) {
      this.source.changeUrl(url)
    } else {
      this.source.url = url
      if (!!url && !this.store.isBackground) {
        this.play()
      }
    }
  }

  /**
   * 设置选项
   * @param {keyof import('../types').PlayerOptions} name
   * @param {any} value
   */
  setOption(name, value) {
    console.log('setOption: ', name, value)
    if (typeof value === undefined) return

    switch (name) {
      case 'pauseWhenHidden':
        if (this.options.pauseWhenHidden === value) {
          return
        }

        if (value !== false) {
          document.addEventListener('visibilitychange', this.onVisibilityChange, { passive: true })
        } else {
          document.removeEventListener('visibilitychange', this.onVisibilityChange)
        }
        this.options.pauseWhenHidden = value

        break
    }
  }

  /** 设置进入前台 */
  intoFront() {
    this.store.isBackground = false
    if (this.paused) {
      this.play()
    }
  }

  /** 设置进入后台 */
  intoBackground() {
    this.store.isBackground = true
    if (this.options.pauseWhenHidden !== false) {
      this.pause()
    }
  }
  /**
   * 旋转画布
   * @param {number} angle 角度
   * @param {boolean} append 是否为追加角度
   * @returns
   */
  rotate(angle, append = false) {
    if (!this.canvas || typeof angle !== 'number') return

    const canvas = this.canvas

    angle = append ? this.store.canvasAngle + angle : angle
    angle = angle >= 360 ? angle - 360 : angle <= -360 ? angle + 360 : angle

    if ((Math.abs(angle) / 90) % 2 === 1) {
      // 如果是90整数倍，表示为垂直状态
      const containerBound = this.contianer.getBoundingClientRect(),
        canvasBound = canvas.getBoundingClientRect()

      if (canvas.width > canvas.height) {
        // 宽>高，取容器高度作为canvas最大宽度
        canvas.style.width = containerBound.height + 'px'
      } else {
        // 宽<=高，取容器宽度作为canvas最大高度
        canvas.style.height = containerBound.width + 'px'
      }
    } else {
      canvas.style.width = null
      canvas.style.height = null
    }
    canvas.style.transform = `rotate(${angle}deg)`

    this.store.canvasAngle = angle
  }
  /**
   * 截图
   * @author cloudsail
   * @param {string} name 图片文件名称
   * @param {'png'|'jpg'} type 图片类型
   * @param {number} quality 图片质量，可以控制输出图片大小，仅jpg有效(png无效)
   */
  snapshot(name = 'jsmpeg', type = 'png', quality) {
    if (!this.isPlaying) {
      console.warn('[JSMpegPlayer] 播放器没有播放源，无法截屏')
      return
    }

    if (this.canvas) {
      if (!/^jpg|png$/.test(type)) {
        type = 'png'
      }

      const mime = 'image/' + type,
        url = this.canvas.toDataURL(mime, quality)

      download(url.replace(mime, 'image/octet-stream'), `${name}_snapshot_${Date.now()}.png`, mime)
    }
  }

  /**
   * 视频录制
   * @author cloudsail
   * @param {string} fileName 录制文件名称
   * @param {'auto'|'canvas'} [mode='auto'] 录制模式
   */
  startRecording(fileName = 'JSMpeg', mode = 'auto') {
    if (!this.isPlaying) {
      console.warn('[JSMpegPlayer] 播放器未处于播放状态，无法录屏')
      return
    }
    if (this.recorder?.running) {
      console.warn('[JSMpegPlayer] 已处于录制状态，请勿重复录制')
      if (this.recorder.paused) {
        this.recorder.continue()
      }
      return
    }

    try {
      this.recorder = new Recorder({
        fileName,
        canvas: this.canvas,
        mode,
        source: this.source,
        eventBus: this.eventBus
      })
      this.recorder.start()
      return true
    } catch (error) {
      console.error(error)
      return false
    }
  }

  /** 停止录制 */
  stopRecording() {
    if (!this.recorder?.running) return false

    this.recorder.stop()
    this.recorder.save()
    this.recorder = null
    return true
  }

  clearPlayer() {
    this.renderer.clear()

    if (this.video.hasSequenceHeader) {
      let bufferSize = this.options.videoBufferSize ?? 512 * 1024
      let bufferMode = this.options.streaming ? BitBuffer.MODE.EVICT : BitBuffer.MODE.EXPAND
      this.video.bits = new BitBuffer(bufferSize, bufferMode)
      // this.demuxer.write(new BitBuffer(bufferSize, bufferMode))
    }
  }

  // reload() {}

  // #region 事件

  /**
   * @template {keyof import("../types/event").JSMpegEventMap} T
   * @param {T} type
   * @param {import("../types/event").JSMpegEventMap[T]} callback
   * @param {AddEventListenerOptions|boolean} options
   */
  on(type, callback, options) {
    this.eventBus.on(type, callback, options)
  }
  /**
   * @template {keyof import("../types/event").JSMpegEventMap} T
   * @param {T} type
   * @param {import("../types/event").JSMpegEventMap[T]} callback
   * @param {AddEventListenerOptions|boolean} options
   */
  once(type, callback, options = {}) {
    this.eventBus.once(type, callback, options)
  }
  /**
   * @template {keyof import("../types/event").JSMpegEventMap} T
   * @param {T} type
   * @param {import("../types/event").JSMpegEventMap[T]} callback
   */
  off(type, callback) {
    this.eventBus.off(type, callback)
  }
  /**
   * @template {keyof import("../types/event").JSMpegEventMap} T
   * @param {T} type
   * @param {any} data
   */
  emit(type, data) {
    this.eventBus.emit(type, data)
  }
  // #endregion

  // #region 原生方法
  /**
   * 显示Loading（貌似无效果）
   */
  startLoading() {
    this.source?.start()
    if (this.autoplay) {
      this.play()
    }
  }

  /**
   * 获取当前音量
   * @returns
   */
  getVolume() {
    return this.audioOut ? this.audioOut.volume : 0
  }

  /**
   * 设置当前音量
   * @param {number} volume
   */
  setVolume(volume) {
    if (this.audioOut) {
      this.audioOut.volume = volume
    }
  }
  /**
   * 播放
   * @author cloudsail
   * @returns
   */
  play() {
    if (this.animationId) {
      return
    }

    // else if (this.store.isBackground) {
    //   this.wantsToPlay = true
    //   this.animationId = requestAnimationFrame(this.update.bind(this))
    //   return
    // }

    this.animationId = requestAnimationFrame(this.update.bind(this))
    this.wantsToPlay = true
    this.paused = false
    if (this.source.isPaused) {
      this.source.continue()
    }
    if (this.recorder?.running) {
      this.recorder.continue()
    }
  }

  /**
   * 暂停播放
   * @author cloudsail
   * @returns
   */
  pause() {
    if (this.paused) {
      return
    }

    cancelAnimationFrame(this.animationId)
    this.animationId = null

    this.source?.pause()
    this.wantsToPlay = false
    this.isPlaying = false
    this.paused = true

    if (this.audio && this.audio.canPlay) {
      // Seek to the currentTime again - audio may already be enqueued a bit
      // further, so we have to rewind it.
      this.audioOut.stop()
      this.seek(this.currentTime)
    }

    this.options?.onPause?.(this)
    this.emit('pause', this)

    if (this.recorder?.running) {
      this.recorder.pause()
    }
  }

  stop(clear = true) {
    this.pause()
    this.seek(0)
    if (this.video && this.options.decodeFirstFrame !== false) {
      this.video.decode()
    }

    if (clear) {
      this.clearPlayer()
    }
  }

  /**
   * 停止播放，断开源连接并清理WebGL和WebAudio状态。该播放器不能再使用。
   *
   * 如果是由player创建了canvas元素，则将其从文档中移除。
   */
  destroy() {
    document.removeEventListener('visibilitychange', this.onVisibilityChange)

    this.pause()
    this.eventBus.offAll()
    this.source.destroy()
    this.video && this.video.destroy()
    this.renderer && this.renderer.destroy()
    this.audio && this.audio.destroy()
    this.audioOut && this.audioOut.destroy()
    this.recorder && this.recorder.destroy()
    this.canvas?.remove()
    this.canvas = null
    this.options.canvas = null
  }

  seek(time) {
    let startOffset = this.audio && this.audio.canPlay ? this.audio.startTime : this.video.startTime

    if (this.video) {
      this.video.seek(time + startOffset)
    }
    if (this.audio) {
      this.audio.seek(time + startOffset)
    }

    this.startTime = Now() - time
  }

  getCurrentTime() {
    return this.video.currentTime - this.video.startTime
    // return this.audio && this.audio.canPlay ? this.audio.currentTime - this.audio.startTime : this.video.currentTime - this.video.startTime
  }

  setCurrentTime(time) {
    this.seek(time)
  }

  update() {
    this.animationId = requestAnimationFrame(this.update.bind(this))

    if (!this.source.established) {
      if (this.renderer) {
        this.renderer.clear()
        // this.renderer.renderProgress(this.source.progress)
      }
      return
    }

    if (!this.isPlaying) {
      this.isPlaying = true
      this.startTime = Now() - this.currentTime

      this.options?.onPlay?.(this)
      this.emit('play', this)
    }
    try {
      if (this.options.streaming) {
        this.updateForStreaming()
      } else {
        this.updateForStaticFile()
      }
    } catch (error) {
      if (error.message?.includes('memory access out of bounds')) {
        console.error('内存溢出，尝试重新加载')
        this.destroy()
        setTimeout(() => this.init(this.url, this.options), 3000)
      } else {
        console.error(error)
      }
    }
    this.options.onUpdate?.()
  }

  updateForStreaming() {
    // 当流到达时，立即解码所有已经缓冲的，以减少播放延迟。

    if (this.video) {
      // console.log('update')
      this.video.decode()
    }

    if (this.audio) {
      let decoded = false
      do {
        // 如果已经有很多音频流排队，禁用输出并跟上编码。
        if (this.audioOut.enqueuedTime > this.maxAudioLag) {
          console.warn('检查到音画不同步，禁用输出并等待同步')
          this.audioOut.resetEnqueuedTime()
          this.audioOut.enabled = false
        }
        decoded = this.audio.decode()
      } while (decoded)

      this.audioOut.enabled = true
    }
  }

  nextFrame() {
    if (this.source.established && this.video) {
      return this.video.decode()
    }
    return false
  }

  updateForStaticFile() {
    let notEnoughData = false,
      headroom = 0

    // If we have an audio track, we always try to sync the video to the audio.
    // Gaps and discontinuities are far more percetable in audio than in video.

    if (this.audio && this.audio.canPlay) {
      // Do we have to decode and enqueue some more audio data?
      while (!notEnoughData && this.audio.decodedTime - this.audio.currentTime < 0.25) {
        notEnoughData = !this.audio.decode()
      }

      // Sync video to audio
      if (this.video && this.video.currentTime < this.audio.currentTime) {
        notEnoughData = !this.video.decode()
      }

      headroom = this.demuxer.currentTime - this.audio.currentTime
    } else if (this.video) {
      // Video only - sync it to player's wallclock
      let targetTime = Now() - this.startTime + this.video.startTime,
        lateTime = targetTime - this.video.currentTime,
        frameTime = 1 / this.video.frameRate

      if (this.video && lateTime > 0) {
        // If the video is too far behind (>2 frames), simply reset the
        // target time to the next frame instead of trying to catch up.
        if (lateTime > frameTime * 2) {
          this.startTime += lateTime
        }

        notEnoughData = !this.video.decode()
      }

      headroom = this.demuxer.currentTime - targetTime
    }

    // Notify the source of the playhead headroom, so it can decide whether to
    // continue loading further data.
    this.source.continue(headroom)

    if (notEnoughData && this.source.completed) {
      // If we failed to decode and the source is complete, it means we reached
      // the end of our data. We may want to loop.
      if (this.loop) {
        this.seek(0)
      } else {
        this.pause()
        this.options?.onEnded?.(this)
        this.emit('ended', this)
      }
    } else if (notEnoughData) {
      // If there's not enough data and the source is not completed, we have
      // just stalled.
      this.options?.onStalled?.(this)
      this.emit('stalled', this)
    }
  }
  // #endregion

  // #region 事件处理
  handleSourceConnected() {
    // if (this.isRecording) {
    //   this.recorder.pause()
    // }

    this.options.onSourceConnected?.(this)
  }
  handleSourceEstablished() {
    if (this.store.isBackground) {
      this.source.pause()
    } else if (this.paused) {
      this.play()
    }
    this.options.onSourceEstablished?.(this)
  }
  handleSourceStreamInterrupt() {
    if (this.options.onSourceStreamInterrupt) {
      this.options.onSourceStreamInterrupt(this)
    }
  }
  handleSourceClosed() {
    this.pause()
    if (this.isRecording) {
      this.recorder.pause()
    }

    if (this.options.onSourceClosed) {
      this.options.onSourceClosed(this)
    }
  }

  onVisibilityChange = (ev) => {
    if (!this.options.pauseWhenHidden) {
      this.play()
      return
    }

    if (document.visibilityState === 'hidden') {
      this.unpauseOnShow = this.wantsToPlay
      this.intoBackground()
    } else if (this.unpauseOnShow) {
      this.intoFront()
    }
  }
  // #endregion

  /** wasm模块编译压缩后的字符串 */
  // static WASM_BINARY_INLINED = WASM_BINARY_INLINED
}

'use strict'
import TS from '../demuxer/ts'
import { Now, getCalculationRateFn } from '../../utils'

const defaultOptions = {
  // 表示多久没收到视频流
  streamInterruptTimeout: 5000,
  maxReconnectCount: 10
}
export default class WSSource {
  /**
   * 传输速率(KB/s)
   */
  kBps
  timer = {
    heartbeat: null,
    streamInterrupt: null
  }
  reconnectInterval
  /** 是否需要自动尝试重连，reconnectInterval需要大于0 */
  shouldAttemptReconnect
  progress = 0
  reconnectTimeoutId = 0
  reconnectCount = 0
  callbacks = { connect: [], data: [] }
  streaming = true
  completed = false
  established = false
  isPaused = false
  isStreamInterrupt = false
  /** @type {TS} */
  destination
  /** @type {WebSocket} */
  socket
  /** @type {string} */
  url
  /** @type {import('../../utils/event-bus').EventBus} */
  eventBus
  onEstablishedCallback
  onCompletedCallback
  onClosedCallback
  onStreamInterruptCallback
  onConnectedCallback
  onStreamTimeoutFirstReceiveCallback
  /**
   *
   * @param {string} url
   * @param {import('../../types').PlayerOptions} options
   */
  constructor(url, options) {
    this.url = url
    this.options = options

    this.reconnectInterval = typeof options.reconnectInterval === 'number' ? options.reconnectInterval : 5
    this.shouldAttemptReconnect = !!this.reconnectInterval

    this.eventBus = options.eventBus
    this.onEstablishedCallback = options.onSourceEstablished
    this.onCompletedCallback = options.onSourceCompleted // Never used
    this.onClosedCallback = options.onSourceClosed
    this.onConnectedCallback = options.onSourceConnected
    this.onStreamInterruptCallback = options.onSourceStreamInterrupt
    this.onStreamContinueCallback = options.onSourceStreamContinue

    this.calcRate = getCalculationRateFn((rate) => {
      this.kBps = Math.round(rate / 1024)
      this.eventBus.emit('performance-kBps', this.kBps)
      console.log('传输速率', (this.kBps / 1024).toFixed(2) + 'MB/s')
    })
  }

  connect(destination) {
    this.destination = destination
  }

  changeUrl(url = '') {
    clearTimeout(this.timer.streamInterrupt)

    if (typeof url === 'string' && url !== '') {
      if (this.url !== url) {
        this.destroy()
        this.url = url
        this.start()
      }
    } else {
      this.destroy()
      this.url = ''
    }
  }

  /** 重新加载 */
  reload() {
    this.destroy()
    this.start()
  }

  /** 销毁 */
  destroy() {
    clearTimeout(this.reconnectTimeoutId)
    this.reconnectTimeoutId = 0
    this.shouldAttemptReconnect = false
    this.socket?.close()
    if (this.socket) {
      this.socket.onmessage = null
      this.socket.onopen = null
      this.socket.onerror = null
      this.socket.onclose = null
      this.socket.onmessage = null
      this.socket = null
    }
  }

  /** 启动连接 */
  start() {
    this.reconnectTimeoutId = 0
    this.reconnectCount = 0
    this.shouldAttemptReconnect = !!this.reconnectInterval
    this.progress = 0
    this.established = false
    this.isPaused = false

    this.wsConnect()
  }

  /** 连接服务端 */
  wsConnect() {
    if (!this.url) return
    // 连java的websocket时，第二个参数要么传值，要么不传值，不能传null，否则会一直出现连接失败的问题
    try {
      if (this.options.protocols) {
        this.socket = new WebSocket(this.url, this.options.protocols)
      } else {
        this.socket = new WebSocket(this.url)
      }
      this.socket.binaryType = 'arraybuffer'
      this.socket.onmessage = this.onMessage.bind(this)
      this.socket.onopen = this.onOpen.bind(this)
      this.socket.onerror = this.onError.bind(this)
      this.socket.onclose = this.onClose.bind(this)
    } catch (error) {
      console.error('websocket connect error: ', error)
    }
  }

  pause() {
    if (!this.isPaused) {
      clearTimeout(this.timer.streamInterrupt)
      this.isPaused = true
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.onmessage = null
      }
    }
    //  if (this.reconnectTimeoutId) {
    //   clearTimeout(this.reconnectTimeoutId)
    //   this.reconnectTimeoutId = null
    // }
  }

  continue() {
    // Nothing to do here
    if (this.isPaused) {
      this.isPaused = false
      if (this.socket == null) {
        this.start()
      } else if (this.socket?.readyState === WebSocket.OPEN) {
        this.reconnectCount = 0
        this.socket.onmessage = this.onMessage.bind(this)
        this.startStreamTimeoutTimer()
      } else if (this.socket?.readyState === WebSocket.CLOSED) {
        this.wsConnect()
      }
    }
  }

  onOpen() {
    this.progress = 1
    this.reconnectTimeoutId = 0
    this.reconnectCount = 0
    this.isOpened = true
    this.isPaused = false

    if (this.onConnectedCallback) {
      this.onConnectedCallback(this)
      this.eventBus?.emit('source-connected', this)
    }
    this.startStreamTimeoutTimer()
  }

  onError(err) {
    // console.error(err)
  }

  onClose() {
    this.established = false

    clearTimeout(this.reconnectTimeoutId)
    let reconnectFn = this.wsConnect.bind(this)

    if (this.progress >= 1) {
      if (!this.isStreamInterrupt) {
        clearTimeout(this.timer.streamInterrupt)
        this.eventBus?.emit('source-interrupt', this)
      }

      // progress>=1，表示已经建立连接后的断开
      // 这时可能是由于部分异常导致的断联，需要重新启动
      this.progress = 0
      this.onClosedCallback?.(this)
      this.eventBus?.emit('source-closed', this)

      reconnectFn = this.start.bind(this)
      return
    }

    if (!this.isPaused && this.shouldAttemptReconnect && this.reconnectCount < defaultOptions.maxReconnectCount) {
      // 最多重连10次
      this.reconnectTimeoutId = setTimeout(reconnectFn, this.reconnectInterval * 1000)
      this.reconnectCount += 1
      console.log('websocket 重连次数： ', this.reconnectCount)
    }
  }

  /**
   *
   * @param {MessageEvent} ev
   */
  onMessage(ev) {
    // delayCalculator.start()
    this.calcRate?.(ev.data?.byteLength)

    this.startStreamTimeoutTimer()
    try {
      if (!this.established) {
        this.established = true
        this.isStreamInterrupt = false
        this.onEstablishedCallback?.(this)
        this.eventBus?.emit('source-established', this)
        console.log(ev)
      } else if (this.isStreamInterrupt) {
        this.isStreamInterrupt = false
        this.onStreamContinueCallback?.(this)
        this.eventBus?.emit('source-continue', this)
      }
    } catch (error) {}

    try {
      if (this.destination) {
        this.destination.write(ev.data)
      }
    } catch (error) {
      if (error.message?.indexOf('memory access out of bounds') > -1) {
        this.reload()
      } else {
        console.error(error)
      }
    }

    if (this.recorder) {
      try {
        this.recorder.write?.(ev.data)
      } catch (error) {
        this.recorder = null
      }
    }
  }

  startStreamTimeoutTimer() {
    if (this.timer.streamInterrupt) {
      clearTimeout(this.timer.streamInterrupt)
    }

    this.timer.streamInterrupt = setTimeout(() => {
      console.warn('[JSMpeg]: 等待视频流超时')
      this.timer.streamInterrupt = null
      this.isStreamInterrupt = true
      this.eventBus?.emit('source-interrupt', this)
      if (this.onStreamInterruptCallback) {
        this.onStreamInterruptCallback()
      }
    }, defaultOptions.streamInterruptTimeout)
  }
}

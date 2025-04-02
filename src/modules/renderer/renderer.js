import { getCalculationRateFn } from '../../utils'

export default class Renderer {
  /** @type {HTMLCanvasElement} */
  canvas
  /** @type {import('../../utils/event-bus').EventBus} */
  eventBus
  /** @type {boolean} */
  ownsCanvasElement
  /** @type {boolean} */
  enabled = false
  /** @type {number} */
  fps = 0
  /**
   *
   * @param {import('../../types/player').PlayerOptions} options
   */
  constructor(options) {
    if (options.canvas) {
      this.canvas = options.canvas
      this.ownsCanvasElement = false
    } else {
      this.canvas = document.createElement('canvas')
      this.ownsCanvasElement = true
    }

    this.width = this.canvas.width
    this.height = this.canvas.height
    this.enabled = true
    this.eventBus = options.eventBus

    this.calcRate = getCalculationRateFn((rate) => {
      this.fps = Math.round(rate)
      this.eventBus.emit('performance-fps', this.fps)
      console.log('帧率', this.fps)
    })
    // this.canvas.addEventListener('', (ev) => {
    //   console.log(ev)
    // })
  }

  destroy(removeCanvas = true) {
    if (this.ownsCanvasElement && removeCanvas) {
      this.canvas.remove()
    }
    // Nothing to do here
  }

  clear() {}

  resize(width, height) {
    this.width = width | 0
    this.height = height | 0

    this.canvas.width = this.width
    this.canvas.height = this.height
  }

  renderProgress(progress) {}

  render() {}

  onRender() {
    this.calcRate(1)
  }
}

/*! jsmpeg v1.0 | (c) Dominic Szablewski | MIT license */

import AudioOutput from './audio-output'
import BitBuffer from './buffer'
import Decoder from './decoder'
import Demuxer from './demuxer'
import Player from './player'
import Renderer from './renderer'
import Source from './source'
import VideoElement from './video-element'
/**
 * This sets up the JSMpeg "Namespace". The object is empty apart from the Now()
 * utility function and the automatic CreateVideoElements() after DOMReady.
 */
export default class JSMpeg {
  /**
   * The Player sets up the connections between source, demuxer, decoders,
   * renderer and audio output. It ties everything together, is responsible
   * of scheduling decoding and provides some convenience methods for
   * external users.*/
  static Player = Player

  /**
   * A Video Element wraps the Player, shows HTML controls to start/pause
   * the video and handles Audio unlocking on iOS. VideoElements can be
   * created directly in HTML using the <div class="jsmpeg"/> tag.
   */
  static VideoElement = VideoElement

  /**
   * The BitBuffer wraps a Uint8Array and allows reading an arbitrary number
   * of bits at a time. On writing, the BitBuffer either expands its
   * internal buffer (for static files) or deletes old data (for streaming).
   */
  static BitBuffer = BitBuffer

  /**
   * A Source provides raw data from HTTP, a WebSocket connection or any
   * other mean. Sources must support the following API:
   *   .connect(destinationNode)
   *   .write(buffer)
   *   .start() - start reading
   *   .resume(headroom) - continue reading; headroom to play pos in seconds
   *   .established - boolean, true after connection is established
   *   .completed - boolean, true if the source is completely loaded
   *   .progress - float 0-1
   */
  static Source = Source

  /**
   * A Demuxer may sit between a Source and a Decoder. It separates the
   * incoming raw data into Video, Audio and other Streams. API:
   *   .connect(streamId, destinationNode)
   *   .write(buffer)
   *   .currentTime – float, in seconds
   *   .startTime - float, in seconds
   */
  static Demuxer = Demuxer

  /**
   *   A Decoder accepts an incoming Stream of raw Audio or Video data, buffers
   * it and upon `.decode()` decodes a single frame of data. Video decoders
   * call `destinationNode.render(Y, Cr, CB)` with the decoded pixel data;
   * Audio decoders call `destinationNode.play(left, right)` with the decoded
   * PCM data. API:
   *   .connect(destinationNode)
   *   .write(pts, buffer)
   *   .decode()
   *   .seek(time)
   *   .currentTime - float, in seconds
   *   .startTime - float, in seconds
   */
  static Decoder = Decoder

  /**
   * A Renderer accepts raw YCrCb data in 3 separate buffers via the render()
   * method. Renderers typically convert the data into the RGBA color space
   * and draw it on a Canvas, but other output - such as writing PNGs - would
   * be conceivable. API:
   *   .render(y, cr, cb) - pixel data as Uint8Arrays
   *   .enabled - wether the renderer does anything upon receiving data*/
  static Renderer = Renderer

  /**
   * Audio Outputs accept raw Stero PCM data in 2 separate buffers via the
   * play() method. Outputs typically play the audio on the user's device.
   * API:
   *   .play(sampleRate, left, right) - rate in herz; PCM data as Uint8Arrays
   *   .stop()
   *   .enqueuedTime - float, in seconds
   *   .enabled - wether the output does anything upon receiving data
   */
  static AudioOutput = AudioOutput

  static CreateVideoElements() {
    let elements = document.querySelectorAll('.jsmpeg')
    for (let i = 0; i < elements.length; i++) {
      new VideoElement(elements[i])
    }
  }
}

/**
 * Automatically create players for all found <div class="jsmpeg"/> elements.
 * if (document.readyState === 'complete') {
 * 	JSMpeg.CreateVideoElements();
 * }
 * else {
 * 	document.addEventListener('DOMContentLoaded', JSMpeg.CreateVideoElements);
 * }
 */

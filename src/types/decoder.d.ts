import WebAudioOut from "@/modules/audio-output/webaudio";
import CanvasRenderer from "@/modules/renderer/canvas2d";
import WebGLRenderer from "@/modules/renderer/webgl";

export type DecoderDestination = WebGLRenderer | CanvasRenderer | WebAudioOut

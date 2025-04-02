# JSMpeg – 基于JavaScript的 MPEG1视频 & MP2音频 解码器 

JSMpeg是一个用JavaScript编写的视频播放器。它由一个MPEG-TS分离器、MPEG1视频和MP2音频解码器、WebGL和Canvas2D渲染器和WebAudio声音输出组成。JSMpeg可以通过Ajax加载静态视频，并通过WebSockets实现低延迟流媒体（约50ms）。

JSMpeg可以在iPhone 5S上以30fps的速度解码720p视频，可以在任何现代浏览器中运行（Chrome, Firefox, Safari, Edge），并且压缩后只有20kb。

这是一个简单的使用示例:
```html
<script src="jsmpeg.min.js"></script>
<div class="jsmpeg" data-url="video.ts"></div>
```

更多的信息和Demo请查看这里: [jsmpeg.com](http://jsmpeg.com/)

## 前言
- 本库基于[jsmpeg.js](https://github.com/phoboslab/jsmpeg)二次开发，从[jsmpeg-player](https://github.com/vCloudSail/jsmpeg-player)项目抽离
- 未实现wasm模块的编译，目前是将已编译压缩的wasm嵌入代码中
- README尚未完成编写

## Usage

JSMpeg视频播放器可以在HTML中使用容器的CSS类`jsmpeg`创建:

```html
<div class="jsmpeg" data-url="<url>"></div>
```

或者直接调用JavaScript中的 `JSMpeg.Player()` 构造函数:

```javascript
let player = new JSMpeg.Player(url [, options]);
```

注意，使用HTML元素(内部`JSMpeg.VideoElement`)在`JSMpeg.Player`之上提供了一些功能。即SVG暂停/播放按钮以及在iOS设备上“解锁”音频的能力。

`url`参数接受一个指向MPEG .ts文件或WebSocket服务器(ws://…)的url。

`options`参数支持以下属性:

| 名称                  | 类型              | 说明                                                                                                                                   |
| --------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| canvas                | HTMLCanvasElement | 用于视频渲染的HTML Canvas元素。如果没有给出，渲染器将创建自己的Canvas元素。                                                            |
| loop                  | boolean           | 是否循环播放视频(仅静态文件)，默认=true                                                                                                |
| autoplay              | boolean           | 是否立即开始播放（仅限静态文件），默认=false                                                                                           |
| audio                 | boolean           | 是否解码音频，默认=true                                                                                                                |
| video                 | boolean           | 是否解码视频，默认=true                                                                                                                |
| poster                | string            | 预览图像的URL，用来在视频播放之前作为海报显示。                                                                                        |
| pauseWhenHidden       | boolean           | 当页面处于非活动状态时是否暂停播放，默认=true（请注意，浏览器通常会在非活动选项卡中限制 JS）                                           |
| disableGl             | boolean           | 是否禁用WebGL，始终使用Canvas2D渲染器，默认=false                                                                                      |
| disableWebAssembly    | boolean           | 是否禁用WebAssembly并始终使用JavaScript解码器，默认=false(不建议设置为true)                                                            |
| preserveDrawingBuffer | boolean           | WebGL上下文是否创建必要的“截图”                                                                                                        |
| progressive           | boolean           | 是否以块的形式加载数据(仅静态文件)。当启用时，回放可以在完整加载源之前开始。                                                           |
| throttled             | boolean           | 当不需要回放时是否推迟加载块。默认=progressive                                                                                         |
| chunkSize             | number            | 使用时，以字节为单位加载的块大小。默认(1 mb)1024*1024                                                                                  |
| decodeFirstFrame      | boolean           | 是否解码并显示视频的第一帧，一般用于设置画布大小以及使用初始帧作为"poster"图像。当使用自动播放或流媒体资源时，此参数不受影响。默认true |
| maxAudioLag           | number            | 流媒体时，以秒为单位的最大排队音频长度（可以理解为能接受的最大音画不同步时间）。                                                       |
| videoBufferSize       | number            | 流媒体时，视频解码缓冲区的字节大小。默认的512 * 1024 (512 kb)。对于非常高的比特率，可能需要增加此值。                                  |
| audioBufferSize       | number            | 流媒体时，音频解码缓冲区的字节大小。默认的128 * 1024 (128 kb)。对于非常高的比特率，可能需要增加此值。                                  |




除了 `canvas` 之外的所有选项都可以通过 `data-` 属性与HTML元素一起使用. 

例如，在JavaScript中指定循环和自动播放:

```javascript
var player = new JSMpeg.Player('video.ts' {loop: true, autoplay: true});
```

或者在HTML中这样使用
```html
<div class="jsmpeg" data-url="video.ts" 
	data-loop="true" data-autoplay="true"></div>
```

注意，当在HTML使用 `data-` 数据属性时，`camelCased(小驼峰)` 选项必须用连字符连接.

例如， `decodeFirstFrame: true` 变成了 `data-decode-first-frame="true"`.

## 属性 & Props
- `.paused` – read only, wether playback is paused
- `.volume` – 获取或设置音频音量(0-1)

## 接口 & API
- `.play()` – 开始播放
- `.pause()` – 暂停播放
- `.stop()` – 停止播放，下一次播放将重新开始
- `.nextFrame()` – 提前播放一个视频帧(不能解码音频). 成功返回 `true` , 当没有足够的数据时返回`false` .
- `.currentTime` – get or set the current playback position in seconds
- `.destroy()` – stops playback, disconnects the source and cleans up WebGL and WebAudio state. The player can not be used afterwards. If the player created the canvas element it is removed from the document.

###  事件 & Emits：

| 名称 | 原生回调名称 | 参数 | 说明 |
| ---- | ------------ | ---- | ---- |
| **原生事件**       |                         | -                        | -                                                                                                |
| video-decode       | [onVideoDecode]()       | decoder, elapsedTime            | 视频帧解码事件，当成功解码视频帧时触发                                                           |
| audio-decode       | [onAudioDecode]()       | decoder, elapsedTime            | 音频帧解码事件，当成功解码音频帧时触发                                                           |
| play               | [onPlay]()              | player                   | 播放开始事件                                                                                     |
| pause              | [onPause]()             | player                   | 播放暂停事件                                                                                     |
| ended              | [onEnded]()             | player                   | 播放结束事件                                                                                     |
| stalled            | [onStalled]()           | player                   | 播放停滞事件，当没有足够的数据播放一帧时触发                                                     |
| source-established | [onSourceEstablished]() | source                   | 源通道建立事件，当source第一次收到数据包时触发                                                   |
| source-completed   | [onSourceCompleted]()   | source                   | 源播放完成事件，当source收到所有数据时触发（即最后一个数据包）                                   |
| **扩展事件**       |                         | -                        | -                                                                                                |
| source-connected   | -                       | -                        | 源连接事件（仅websocket），当source(websocket)连接上服务端时触发                                 |
| source-interrupt   | -                       | -                        | 源传输中断事件（仅websocket），当source(websocket)超过一定时间（5s）没有收到流时触发             |
| source-continue    | -                       | -                        | 源传输恢复/继续事件（仅websocket），当onSourceStreamInterrupt触发后websocket第一次接收到流时触发 |
| source-closed      | -                       | -                        | 源关闭事件（仅websocket），当websocket关闭后触发                                                 |
| resolution-decode  | -                       | decoder, {width, height} | 分辨率解码事件，当获取到视频分辨率时触发发                                                       |



## 关于性能

虽然JSMpeg可以在iPhone 5S上以30fps的速度处理720p的视频，但请记住，MPEG1不如现代编解码器高效。MPEG1需要相当大的带宽来播放高清视频。720p在2 mbit /s(即250kb/s)时开始看起来还不错。此外，比特率越高，JavaScript解码它所做的工作就越多。

这对于静态文件来说应该不是问题，或者如果你只在本地WiFi上传输。如果你不需要支持移动设备，1080p 10mbit/s就可以了(如果你的编码器能跟上的话)。对于其他一切，我建议您使用540p (960x540)，最大2Mbit/s。

下面是多个分辨率和特性的性能比较。在你的目标设备上测试一下，看看你能做些什么。

https://jsmpeg.com/perf.html


## 通过WebSockets流式传输

通过WebSocketsJSMpeg流式传输可以连接到发送二进制MPEG-TS数据的WebSocket服务器。在流式传输时，JSMpeg会尽量降低延迟——它会立即解码所有内容，同时忽略视频和音频的时间戳。为了保持一切同步(和低延迟)，音频数据应该在视频帧之间非常频繁地交错(ffmpeg中的' -muxdelay ')。

一种独立的、缓冲的流模式是可以想象的，在这种模式下，JSMpeg预加载几秒钟的数据，并以精确的时间和音频/视频同步呈现所有内容，但目前还没有实现。

视频和音频的内部缓冲区相当小(分别为512kb和128kb)， JSMpeg将丢弃旧的(甚至未播放的)数据，为新到达的数据腾出空间，而不会有太多模糊。当出现网络拥塞时，这可能会引入解码伪影，但可以确保延迟保持在最低限度。如果需要，您可以通过选项增加' videoBufferSize '和' audioBufferSize '。

JSMpeg附带了一个用Node.js编写的小WebSocket“中继”。该服务器通过HTTP接受MPEG-TS源，并通过WebSocket将其提供给所有连接的浏览器。传入的HTTP流可以使用[ffmpeg](https://ffmpeg.org/)、[gstreamer](https://gstreamer.freedesktop.org/)或其他方式生成。

源和WebSocket中继之间的分离是必要的，因为ffmpeg不使用WebSocket协议。然而，这种分离也允许你在公共服务器上安装WebSocket中继并在互联网上共享你的流(通常路由器中的NAT会阻止公共互联网连接到你的本地网络)。

简而言之，它是这样工作的:

1. 运行websocket-relay.js
2. 运行ffmpeg，将输出发送到中继的HTTP端口
3. 将浏览器中的JSMpeg连接到中继的Websocket端口


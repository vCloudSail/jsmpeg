// Use the websocket-relay to serve a raw MPEG-TS over WebSockets. You can use
// ffmpeg to feed the relay. ffmpeg -> websocket-relay -> browser
// Example:
// node websocket-relay yoursecret 8081 8082
// ffmpeg -i <some input> -f mpegts http://localhost:8081/yoursecret

const fs = require('fs'),
  http = require('http'),
  WebSocket = require('ws')

if (process.argv.length < 3) {
  console.log(
    'Usage: \n' +
      'node websocket-relay.js <secret> [<stream-port> <websocket-port>]'
  )
  process.exit()
}

let STREAM_SECRET = process.argv[2] || 'jsmpeg',
  STREAM_PORT = process.argv[3] || 8081,
  WEBSOCKET_PORT = process.argv[4] || 8082,
  RECORD_STREAM = false

// Websocket Server
let socketServer = new WebSocket.Server({
  port: WEBSOCKET_PORT,
  perMessageDeflate: false
})
socketServer.connectionCount = 0
socketServer.on('connection', function (socket, upgradeReq) {
  socketServer.connectionCount++
  console.log(
    'Websocket客户端接入: ',
    (upgradeReq || socket.upgradeReq).socket.remoteAddress,
    (upgradeReq || socket.upgradeReq).headers['user-agent'],
    '(' + socketServer.connectionCount + ' total)\n'
  )
  socket.on('close', function (code, message) {
    socketServer.connectionCount--
    console.log(
      'Websocket客户端断开 (' + socketServer.connectionCount + ' total)\n'
    )
  })
})
socketServer.broadcast = function (data) {
  socketServer.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  })
}

// HTTP Server to accept incomming MPEG-TS Stream from ffmpeg
let streamServer = http.createServer(function (request, response) {
  let params = request.url.substr(1).split('/')

  if (params[0] !== STREAM_SECRET) {
    console.log(
      '推流端连接失败: ' +
        request.socket.remoteAddress +
        ':' +
        request.socket.remotePort +
        ' - wrong secret.\n'
    )
    response.end()
  }

  response.connection.setTimeout(0)
  console.log(
    '推流端接入(ffmpeg): ' +
      request.socket.remoteAddress +
      ':' +
      request.socket.remotePort +
      '\n'
  )
  request.on('data', function (data) {
    socketServer.broadcast(data)
    if (request.socket.recording) {
      request.socket.recording.write(data)
    }
  })
  request.on('end', function () {
    console.log('close')
    if (request.socket.recording) {
      request.socket.recording.close()
    }
  })

  // Record the stream to a local file?
  if (RECORD_STREAM) {
    let path = 'recordings/' + Date.now() + '.ts'
    request.socket.recording = fs.createWriteStream(path)
  }
})
// Keep the socket open for streaming
streamServer.headersTimeout = 0
streamServer.listen(STREAM_PORT)

console.log(
  `Http Server(ffmpeg 推流地址): http://127.0.0.1:${STREAM_PORT}/${STREAM_SECRET}\n`
)
console.log(
  `WebSocket Server(jsmpeg客户端连接地址): ws://127.0.0.1:${WEBSOCKET_PORT}\n`
)

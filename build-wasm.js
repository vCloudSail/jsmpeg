/** 
Build the .wasm Module first

Since we're compiling a side module here, so that we can load it without the
runtime cruft, we have to explicitly compile in support for malloc and
friends.
Note memcpy, memmove and memset are explicitly exported, otherwise they will
be eliminated by the SIDE_MODULE=2 setting - not sure why that happens.

This NEEDS to be compiled with emscripten 1.38.47. Newer versions mess with
malloc and friends and need some more glue code for side modules that I 
haven't quite worked out yet. If you have any idea how to build a SIDE_MODULE
(or STANDALONE_WASM - as seems to be the new deal) with support for malloc,
please let me know or file a PR.

To install the correct version, issue the following in your emsdk directory:
./emsdk install 1.38.47
./emsdk activate 1.38.47
source ./emsdk_env.sh

The $EMSCRIPTEN_LIB var needs to point to the correct directory within the sdk
that has emmalloc.cpp. This is usually $EMSDK/fastcomp/emscripten/system/lib
but it might differ per system. I don't know.
There used to be an $EMSCRIPTEN var set by the emsdk_env script that pointed
to the correct directory, but this seems to have gone now.

In conclusion, emscripten encapsulates everything that I hate about native 
development :/
*/

/**
 * 注意以下几点
 * 1. emsdk安装并激活1.38.47版本
 * 2. 在操作系统中正确的配置环境变量EMSDK
 * 3. 如果报错```llc executable not found at```，参考：https://cloud.tencent.com/developer/news/900632
 */

const { execSync, exec } = require('child_process')

// 部分系统路径可能是$EMSDK/fastcomp/emscripten/system/lib
if (!process.env['EMSDK']) {
  throw new Error('请正确配置环境变量EMSDK')
}

const EMSCRIPTEN_LIB = (process.env['EMSDK'] || '') + '/emscripten/system/lib'

const exportedFunctions = [
  '_memcpy',
  '_memmove',
  '_memset',
  '_mpeg1_decoder_create',
  '_mpeg1_decoder_destroy',
  '_mpeg1_decoder_get_write_ptr',
  '_mpeg1_decoder_get_index',
  '_mpeg1_decoder_set_index',
  '_mpeg1_decoder_did_write',
  '_mpeg1_decoder_has_sequence_header',
  '_mpeg1_decoder_get_frame_rate',
  '_mpeg1_decoder_get_coded_size',
  '_mpeg1_decoder_get_width',
  '_mpeg1_decoder_get_height',
  '_mpeg1_decoder_get_y_ptr',
  '_mpeg1_decoder_get_cr_ptr',
  '_mpeg1_decoder_get_cb_ptr',
  '_mpeg1_decoder_decode',
  '_mp2_decoder_create',
  '_mp2_decoder_destroy',
  '_mp2_decoder_get_write_ptr',
  '_mp2_decoder_get_index',
  '_mp2_decoder_set_index',
  '_mp2_decoder_did_write',
  '_mp2_decoder_get_left_channel_ptr',
  '_mp2_decoder_get_right_channel_ptr',
  '_mp2_decoder_get_sample_rate',
  '_mp2_decoder_decode'
]

// exec('call "./src/wasm/build.sh"', (err) => console.error(err))
// return
// exec('rm -rf src/wasm/jsmpeg.wasm')

exec(
  `emcc \
  src/wasm/mpeg1.c \
  src/wasm/mp2.c \
  src/wasm/buffer.c \
  ${EMSCRIPTEN_LIB}/emmalloc.cpp \
  ${EMSCRIPTEN_LIB}/libc/musl/src/string/memcpy.c \
  ${EMSCRIPTEN_LIB}/libc/musl/src/string/memmove.c \
  ${EMSCRIPTEN_LIB}/libc/musl/src/string/memset.c \
  -s WASM=1 \
  -s SIDE_MODULE=2 \
  -s TOTAL_STACK=5242880 \
  -s USE_PTHREADS=0 \
  -s LEGALIZE_JS_FFI=0 \
  -s NO_FILESYSTEM=1 \
  -s DEFAULT_LIBRARY_FUNCS_TO_INCLUDE="[]" \
  -s EXPORTED_FUNCTIONS="['${exportedFunctions.join("','")}']" \
  -O3 \
  -o src/wasm/jsmpeg.wasm \
`,
  (err, stdout) => {
    if (err) {
      console.error(err)
    } else {
      console.log(stdout)
    }
  }
)


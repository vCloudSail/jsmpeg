import { defineConfig, loadEnv, splitVendorChunkPlugin } from 'vite'
import path from 'node:path'

import viteRequireTransform from 'vite-plugin-require-transform'

import rollupCommonjs from '@rollup/plugin-commonjs'
import { visualizer as rollupVisualizer } from 'rollup-plugin-visualizer'

import pkg from './package.json'

const resolve = (_path) => {
  return path.resolve(__dirname, _path)
  // return fileURLToPath(new URL(path, import.meta.url))
}

const libName = 'jsmpeg'

export default defineConfig(({ mode, ssrBuild, command }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    resolve: {
      alias: [
        {
          find: '@', // 别名
          replacement: resolve('src') // 别名对应地址
        }
      ]
    },
    plugins: [
      rollupCommonjs(),
      // viteRequireTransform({
      //   fileRegex: /.js$|.jsx$|.ts$|.tsx$/
      // }),

      // 打包分析插件建议放到最后
      rollupVisualizer({
        emitFile: false,
        filename: 'report.html', //分析图生成的文件名
        open: false //如果存在本地服务端口，将在打包后自动展示
      })
    ],
    build: {
      lib: {
        entry: './src/main.js',
        name: libName,
        formats: ['cjs', 'es', 'iife'],
        fileName: 'index'
      }
      // rollupOptions: {
      //   output: {
      //     dir: path.dirname(pkg.module),
      //     format: "es",
      //     name: pkg.name,
      //     exports: 'named',
      //     preserveModules: true, // 保留模块结构
      //     preserveModulesRoot: 'src' // 将保留的模块放在根级别的此路径下
      //   }
      // }
    }
  }
})

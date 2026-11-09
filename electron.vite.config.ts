import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { builtinModules } from 'module'
import { viteCommonjs } from '@originjs/vite-plugin-commonjs'
import { execFileSync } from 'child_process'

function resolveSourceCommit(): string {
  if (/^[0-9a-f]{40}$/.test(process.env.XENADMIN_SOURCE_COMMIT || '')) {
    return process.env.XENADMIN_SOURCE_COMMIT as string
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return '74d04556e74afc61ce4c71f3a5cc530d5af377a6'
  }
}

const buildIdentity = {
  __XENADMIN_SOURCE_COMMIT__: JSON.stringify(resolveSourceCommit()),
}

export default defineConfig({
  main: {
    define: buildIdentity,
    plugins: [externalizeDepsPlugin({ exclude: ['fast-xml-parser', 'nodemailer', 'ws', 'xmlrpc'] })],
    build: {
      rollupOptions: {
        external: ['electron', 'bufferutil', 'utf-8-validate', ...builtinModules.map(m => `node:${m}`), ...builtinModules]
      }
    }
  },
  preload: {
    define: buildIdentity,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['electron', ...builtinModules.map(m => `node:${m}`), ...builtinModules]
      }
    }
  },
  renderer: {
    define: buildIdentity,
    resolve: {
      extensions: ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.json'],
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), viteCommonjs()],
    build: {
      target: 'esnext',
      commonjsOptions: {
        transformMixedEsModules: true,
        requireReturnsDefault: true,
      },
    },
    optimizeDeps: {
      include: ['@novnc/novnc'],
      esbuildOptions: {
        target: 'esnext',
      },
    },
  }
})

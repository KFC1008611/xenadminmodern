const { chromium } = require('/Users/whs/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const assert = require('node:assert/strict')
const output = join(__dirname, 'evidence')
mkdirSync(output, { recursive: true })

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
  const checks = []
  try {
    for (const [width, height] of [[1024, 768], [1280, 800], [1440, 900], [1920, 1080]]) {
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport: { width, height } })
        await context.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
        await context.addInitScript((value) => localStorage.setItem('xenadmin:theme', value), theme)
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', (error) => errors.push(error.message))
        await page.goto('http://127.0.0.1:4178/tests/visual/frontend-theme.html#/vms')
        await page.getByRole('checkbox', { name: 'Select ubuntu-web-01', exact: true }).check()
        await page.getByRole('checkbox', { name: 'Select dev-api', exact: true }).check()
        await page.getByRole('textbox', { name: 'Filter items' }).fill('ubuntu')
        await page.getByText('其中 1 台不在当前列表').waitFor()
        assert.equal(await page.getByRole('button', { name: /强制停止|迁移虚拟机|创建快照|删除虚拟机/ }).count(), 0)
        await page.getByRole('button', { name: '正常关闭', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: '确认批量正常关闭' })
        await dialog.waitFor()
        assert.match(await dialog.innerText(), /生产资源池 · ubuntu-web-01/)
        assert.match(await dialog.innerText(), /研发资源池 · dev-api/)
        assert.match(await dialog.innerText(), /不会自动强制断电/)
        const bounds = await dialog.boundingBox()
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height)
        if (width === 1024) await page.screenshot({ path: join(output, theme + '-confirmation-1024.png') })
        await dialog.getByRole('button', { name: '取消', exact: true }).click()

        // These are isolated browser fixtures, never the Electron IPC transport.
        await page.evaluate(async () => {
          // Reuse the exact module URL loaded by App, including Vite's HMR timestamp.
          const storeUrl = performance.getEntriesByType('resource').find((entry) => new URL(entry.name).pathname === '/src/renderer/src/store/batch.store.ts')?.name
          if (!storeUrl) throw new Error('App did not load the batch store')
          const { useBatchStore } = await import(storeUrl)
          const target = { connectionId: 'prod', vmRef: 'OpaqueRef:vm', vmName: '正常业务 VM', intent: { vmUuid: 'vm', poolUuid: 'pool-uuid-prod', epoch: 1 } }
          const make = (id, type, status, failed) => ({
            id, type, targets: [{ ...target, vmRef: 'OpaqueRef:' + id, vmName: id === 'failed' ? '需要重试的 VM' : id }], status,
            progress: { total: 1, completed: failed ? 1 : 0, failed: failed ? 1 : 0 }, createdAt: 1,
            items: [{ ...target, vmRef: 'OpaqueRef:' + id, vmName: id === 'failed' ? '需要重试的 VM' : id, id: id + '-item', taskId: id, status: failed ? 'failed' : 'running', retryCount: 0 }],
          })
          const tasks = [make('进行中的任务一', 'start', 'running', false), make('进行中的任务二', 'reboot', 'running', false), make('failed', 'stop', 'completed', true), make('legacy', 'snapshot', 'completed', true)]
          window.__batchCalls = []
          window.xapi.batch = {
            list: async () => tasks.map(({ items, ...task }) => structuredClone(task)),
            getStatus: async (id) => structuredClone(tasks.find((task) => task.id === id)),
            cancel: async (id) => { window.__batchCalls.push({ cancel: id }); tasks.find((task) => task.id === id).status = 'cancel-requested' },
            retry: async (id, confirmation) => { window.__batchCalls.push({ retry: id, confirmation }); const task = tasks.find((task) => task.id === id); task.status = 'running'; task.progress = { total: 1, completed: 0, failed: 0 }; task.items[0].status = 'pending' },
          }
          useBatchStore.setState({ selectedVms: [] })
          await useBatchStore.getState().refreshTasks()
        })
        await page.getByRole('region', { name: '批量任务进度' }).waitFor()
        await page.getByRole('button', { name: '外观', exact: true }).click()
        await page.getByRole('menuitemradio', { name: theme === 'dark' ? '浅色' : '深色' }).click()
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme === 'dark' ? 'light' : 'dark')
        await page.getByRole('button', { name: '外观', exact: true }).click()
        await page.getByRole('menuitemradio', { name: theme === 'dark' ? '深色' : '浅色' }).click()
        await page.getByRole('link', { name: /查看全部批量任务/ }).click()
        await page.getByRole('heading', { name: '批量任务', exact: true }).waitFor()
        assert.equal(await page.getByRole('button', { name: '停止后续操作', exact: true }).count(), 2)
        assert.equal(await page.getByRole('button', { name: '重试明确失败项', exact: true }).count(), 1)
        assert.equal(await page.getByText('创建快照（历史）', { exact: true }).count(), 1)
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        await page.screenshot({ path: join(output, theme + '-tasks-' + width + '.png') })
        await page.getByRole('button', { name: '停止后续操作', exact: true }).nth(1).click()
        await page.waitForFunction(() => window.__batchCalls.some((call) => call.cancel === '进行中的任务二'))
        await page.getByRole('button', { name: '重试明确失败项', exact: true }).click()
        const retry = page.getByRole('dialog', { name: '确认重试正常关闭' })
        await retry.waitFor()
        assert.match(await retry.innerText(), /需要重试的 VM/)
        assert.equal(await page.evaluate(() => window.__batchCalls.filter((call) => call.retry).length), 0)
        await retry.getByRole('button', { name: '确认', exact: true }).click()
        await page.getByText('3 个进行中 · 1 条历史记录', { exact: true }).waitFor()
        assert.equal(await page.evaluate(() => window.__batchCalls.filter((call) => call.retry).length), 1)
        assert.deepEqual(errors, [])
        checks.push({ width, height, theme, hiddenTargetsReviewed: true, noPageOverflow: true, allTasksVisible: true, cancelById: true, retryReviewed: true, appearanceWithProgressPanel: true, pageErrors: errors })
        await context.close()
        process.stdout.write(JSON.stringify(checks.at(-1)) + '\n')
      }
    }
    writeFileSync(join(output, 'browser-checks.json'), JSON.stringify(checks, null, 2) + '\n')
  } finally { await browser.close() }
})().catch((error) => { process.stderr.write(error.stack + '\n'); process.exitCode = 1 })

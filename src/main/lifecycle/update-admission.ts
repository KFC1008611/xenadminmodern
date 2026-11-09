let activeRequests = 0
let installing = false

export function enterApplicationRequest(channel: string): () => void {
  if (channel.startsWith('updates:')) return () => {}
  if (installing) throw new Error('正在准备安装更新，请等待应用重启')
  activeRequests++
  return () => { activeRequests-- }
}

export function beginUpdateInstallation(): void {
  if (installing) throw new Error('正在安装更新')
  if (activeRequests > 0) throw new Error('应用正在处理请求，请稍后安装更新')
  installing = true
}

export function endUpdateInstallation(): void { installing = false }

export function isUpdateInstalling(): boolean { return installing }

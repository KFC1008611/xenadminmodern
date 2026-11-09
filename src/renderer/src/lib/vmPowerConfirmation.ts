/** Impact text shared by the VM list and detail page. Starting/unpausing is immediate. */
export function vmPowerConfirmation(operation: string, vmName: string, poolName: string) {
  const impact: Record<string, string> = {
    关闭: '将请求客户机正常关机，虚拟机提供的服务会停止。',
    重启: '将请求客户机重新启动，虚拟机提供的服务会暂时中断。',
    强制关闭: '将立即断电，未保存的数据可能丢失。请仅在无法正常关机时使用。',
    暂停: '将暂停虚拟机的运行，客户机中的程序和网络服务会停止响应，直到继续运行。',
    挂起: '将把虚拟机的内存状态保存到存储并停止运行，客户机服务会中断。之后可通过“从挂起恢复”继续运行。',
  }
  if (!impact[operation]) return null
  return {
    title: `确认${operation}虚拟机`,
    message: `资源池：${poolName}\n虚拟机：${vmName}\n\n${impact[operation]}`,
    confirmLabel: operation,
    variant: operation === '强制关闭' ? 'danger' as const : 'warning' as const,
  }
}

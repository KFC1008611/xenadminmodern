/**
 * XAPI error normalization.
 *
 * XAPI returns application failures as a successful XML-RPC response with:
 *   { Status: "Failure", ErrorDescription: [code, ...params] }
 * Transport failures instead come from Node/http/tls/xmlrpc as Error objects.
 */

export interface NormalizedXapiErrorDetails {
  code: string
  params: string[]
  kind: 'xapi' | 'transport' | 'client'
  retryHost?: string
  originalMessage?: string
  method?: string
  durationMs?: number
}

export class NormalizedXapiError extends Error {
  code: string
  params: string[]
  details: NormalizedXapiErrorDetails
  faultString: string

  constructor(message: string, details: NormalizedXapiErrorDetails) {
    super(message)
    this.name = 'XapiError'
    this.code = details.code
    this.params = details.params
    this.details = details
    this.faultString = message
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

export function isXapiFailureEnvelope(value: unknown): value is { ErrorDescription: unknown[] } {
  return !!value
    && typeof value === 'object'
    && (value as any).Status === 'Failure'
    && Array.isArray((value as any).ErrorDescription)
    && (value as any).ErrorDescription.length > 0
}

export function isXapiSuccessEnvelope(value: unknown): value is { Value: unknown } {
  return !!value
    && typeof value === 'object'
    && (value as any).Status === 'Success'
    && Object.prototype.hasOwnProperty.call(value, 'Value')
}

export function createXapiContractMismatchError(): NormalizedXapiError {
  return new NormalizedXapiError(
    'XAPI 返回了无法识别的响应格式，无法确认请求结果。',
    {
      code: 'XAPI_CONTRACT_MISMATCH',
      params: [],
      kind: 'client',
    },
  )
}

export function getXapiRetryHost(code: string, params: string[]): string | undefined {
  if (code !== 'HOST_IS_SLAVE') return undefined
  return params.find((param) => param && param !== 'OpaqueRef:NULL')
}

export function describeXapiFailure(code: string, params: string[]): string {
  switch (code) {
    case 'SESSION_AUTHENTICATION_FAILED':
      return '用户名或密码不正确，XAPI 拒绝创建登录会话。'
    case 'HOST_IS_SLAVE': {
      const master = getXapiRetryHost(code, params)
      return master
        ? `当前主机是资源池从节点。XAPI 要求连接到 master，请改用 ${master} 登录。`
        : '当前主机是资源池从节点。XAPI 要求连接到资源池 master。'
    }
    case 'SESSION_INVALID':
      return 'XAPI 会话已失效，请重新登录服务器。'
    case 'SESSION_NOT_REGISTERED':
      return 'XAPI 会话未注册或已过期，请重新登录服务器。'
    case 'RBAC_PERMISSION_DENIED':
    case 'PERMISSION_DENIED':
      return '当前账号没有执行此操作所需的 XAPI 权限。'
    case 'VBD_NOT_EMPTY':
      return '虚拟光驱中已有介质，请先弹出当前 ISO。'
    case 'VBD_IS_EMPTY':
      return '虚拟光驱当前没有挂载介质。'
    case 'VBD_NOT_REMOVABLE_MEDIA':
      return '该 VBD 不是可移除介质，无法挂载或弹出 ISO。'
    case 'VM_BAD_POWER_STATE':
      return params.length > 0
        ? `虚拟机当前电源状态不支持此操作：${params.join(' / ')}`
        : '虚拟机当前电源状态不支持此操作。'
    case 'MESSAGE_METHOD_UNKNOWN':
      return '服务器不支持当前 XAPI 方法，可能是版本不兼容。'
    case 'MESSAGE_PARAMETER_COUNT_MISMATCH':
    case 'MESSAGE_PARAMETER_TYPE_ERROR':
      return '发送给 XAPI 的参数不符合服务器要求，请检查客户端版本。'
    case 'INTERNAL_ERROR':
      return params.length > 0
        ? `XAPI 服务器内部错误：${params.join(' / ')}`
        : 'XAPI 服务器内部错误。'
    default:
      return params.length > 0 ? `${code}: ${params.join(', ')}` : code
  }
}

export function createXapiFailureError(errorDescription: unknown): NormalizedXapiError {
  const [rawCode, ...rawParams] = asStringArray(errorDescription)
  const code = rawCode || 'UNKNOWN_ERROR'
  const params = rawParams
  const retryHost = getXapiRetryHost(code, params)

  return new NormalizedXapiError(describeXapiFailure(code, params), {
    code,
    params,
    kind: 'xapi',
    ...(retryHost ? { retryHost } : {}),
  })
}

export function describeTransportError(err: any): NormalizedXapiError {
  const code = typeof err?.code === 'string' ? err.code : 'TRANSPORT_ERROR'
  const originalMessage = err?.message ? String(err.message) : String(err)

  let message: string
  switch (code) {
    case 'ENOTFOUND':
      message = '找不到服务器地址。请检查主机名及 DNS 设置。'
      break
    case 'EAI_AGAIN':
      message = '服务器地址解析暂时失败。请检查 DNS 或稍后重试。'
      break
    case 'EHOSTUNREACH':
    case 'EHOSTDOWN':
      message = '服务器不可达，连接未建立。请检查服务器是否开机、管理地址、网线、VLAN 和路由。'
      break
    case 'ENETUNREACH':
      message = '当前网络无法到达服务器，连接未建立。请检查本机网络、路由及 VPN。'
      break
    case 'EACCES':
    case 'EPERM':
      message = '系统拒绝了网络访问。请检查防火墙或安全软件是否允许本应用联网。'
      break
    case 'EADDRNOTAVAIL':
      message = '本机网络地址不可用。请检查网卡、IP 配置及 VPN。'
      break
    case 'ECONNREFUSED':
      message = '目标端口拒绝连接。请检查端口设置及服务器的 XAPI 服务。'
      break
    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
      message = '连接服务器超时。请检查网络、防火墙及服务器负载。'
      break
    case 'ECONNRESET':
    case 'EPIPE':
      message = '与服务器的连接已中断。请检查网络及 XAPI 服务状态。'
      break
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      message = '服务器使用自签名证书，证书验证未通过。确认服务器可信后，可勾选“允许自签名证书”。'
      break
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
    case 'CERT_UNTRUSTED':
      message = '服务器证书的信任链验证失败。请检查服务器证书链及本机信任的 CA。'
      break
    case 'CERT_HAS_EXPIRED':
      message = '服务器证书已过期。请更新证书，并检查本机日期和时间。'
      break
    case 'CERT_NOT_YET_VALID':
      message = '服务器证书尚未生效。请检查证书有效期及本机日期和时间。'
      break
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      message = '服务器证书与连接地址不匹配。请使用证书对应的主机名，或更新证书。'
      break
    case 'EPROTO':
    case 'ERR_SSL_WRONG_VERSION_NUMBER':
    case 'ERR_SSL_UNSUPPORTED_PROTOCOL':
      message = '无法建立安全连接。请确认协议和端口匹配，并检查服务器 TLS 配置。'
      break
    case 'HPE_INVALID_CONSTANT':
    case 'HPE_INVALID_VERSION':
    case 'HPE_INVALID_HEADER_TOKEN':
      message = '服务器返回的内容不符合 HTTP 协议。请确认主机地址、协议和端口指向 XAPI 服务。'
      break
    default:
      message = '与服务器通信失败。请检查主机地址、协议和端口；仍失败时查看应用日志。'
      break
  }

  if (process.platform === 'darwin' && ['EHOSTUNREACH', 'EHOSTDOWN', 'ENETUNREACH', 'EACCES', 'EPERM'].includes(code)) {
    message += '请同时在“系统设置 → 隐私与安全性 → 本地网络”中允许本应用访问，然后重启应用。'
  }

  return new NormalizedXapiError(`${message}（${code}）`, {
    code,
    params: [],
    kind: 'transport',
    originalMessage,
  })
}

export function normalizeUnknownError(err: any): NormalizedXapiError {
  if (err instanceof NormalizedXapiError) return err

  if (typeof err?.code === 'string') {
    const params = asStringArray(err?.params)
    return new NormalizedXapiError(err?.message || describeXapiFailure(err.code, params), {
      code: err.code,
      params,
      kind: 'xapi',
      originalMessage: err?.message ? String(err.message) : undefined,
    })
  }

  const message = err?.faultString || err?.message || String(err)
  return new NormalizedXapiError(message, {
    code: 'UNKNOWN_ERROR',
    params: [],
    kind: 'client',
    originalMessage: message,
  })
}

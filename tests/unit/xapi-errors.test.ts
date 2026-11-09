import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeTransportError } from '../../src/main/xapi/errors'

afterEach(() => vi.unstubAllGlobals())

describe('XAPI transport error guidance', () => {
  it.each([
    [['ENOTFOUND'], '主机名及 DNS'],
    [['EAI_AGAIN'], '解析暂时失败'],
    [['EHOSTUNREACH', 'EHOSTDOWN'], '服务器不可达，连接未建立'],
    [['ENETUNREACH'], '本机网络、路由及 VPN'],
    [['EACCES', 'EPERM'], '系统拒绝了网络访问'],
    [['EADDRNOTAVAIL'], '网卡、IP 配置'],
    [['ECONNREFUSED'], '目标端口拒绝连接'],
    [['ETIMEDOUT', 'ESOCKETTIMEDOUT'], '网络、防火墙及服务器负载'],
    [['ECONNRESET', 'EPIPE'], '连接已中断'],
    [['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'], '确认服务器可信后'],
    [['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_UNTRUSTED'], '服务器证书链及本机信任的 CA'],
    [['CERT_HAS_EXPIRED'], '更新证书，并检查本机日期和时间'],
    [['CERT_NOT_YET_VALID'], '证书有效期及本机日期和时间'],
    [['ERR_TLS_CERT_ALTNAME_INVALID'], '使用证书对应的主机名'],
    [['EPROTO', 'ERR_SSL_WRONG_VERSION_NUMBER', 'ERR_SSL_UNSUPPORTED_PROTOCOL'], '协议和端口匹配'],
    [['HPE_INVALID_CONSTANT', 'HPE_INVALID_VERSION', 'HPE_INVALID_HEADER_TOKEN'], '指向 XAPI 服务'],
  ] as const)('explains %j with an actionable cause', (codes, guidance) => {
    for (const code of codes) {
      const originalMessage = `socket failure at 192.0.2.1:443: ${code}`
      const error = describeTransportError({ code, message: originalMessage })
      expect(error.message).toContain(guidance)
      expect(error.message).toContain(`（${code}）`)
      expect(error.message).not.toContain('192.0.2.1')
      expect(error).toMatchObject({ code, details: { code, kind: 'transport', originalMessage } })
      if (!code.includes('SELF_SIGNED')) expect(error.message).not.toContain('允许自签名证书')
    }
  })

  it.each(['darwin', 'win32', 'linux'])('only suggests macOS network permissions on %s', (platform) => {
    vi.stubGlobal('process', { ...process, platform })
    for (const code of ['EHOSTUNREACH', 'EHOSTDOWN', 'ENETUNREACH', 'EACCES', 'EPERM']) {
      const { message } = describeTransportError({ code })
      expect(message.includes('系统设置 → 隐私与安全性 → 本地网络')).toBe(platform === 'darwin')
    }
    expect(describeTransportError({ code: 'ECONNREFUSED' }).message).not.toContain('本地网络')
  })

  it('gives unknown transport failures a Chinese fallback while retaining diagnostics', () => {
    for (const code of ['ERR_NEW_TRANSPORT', undefined]) {
      const error = describeTransportError({ code, message: 'unexpected raw response with a credential' })
      expect(error.message).toContain('与服务器通信失败。请检查主机地址、协议和端口')
      expect(error.message).not.toContain('credential')
      expect(error.code).toBe(code || 'TRANSPORT_ERROR')
      expect(error.details.originalMessage).toBe('unexpected raw response with a credential')
    }
  })
})

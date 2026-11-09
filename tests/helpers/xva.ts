import { createHash } from 'node:crypto'
export function tarEntry(name: string, data: Buffer | string): Buffer {
  data = Buffer.from(data)
  const header = Buffer.alloc(512)
  header.write(name)
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124)
  header.write('0', 156)
  header.write('ustar\0', 257)
  header.fill(32, 148, 156)
  header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')}\0 `, 148)
  return Buffer.concat([header, data, Buffer.alloc(Math.ceil(data.length / 512) * 512 - data.length)])
}
export function xva(xml = '<appliance><vm><label>VM</label></vm></appliance>', entries: Buffer[] = []): Buffer {
  return Buffer.concat([tarEntry('ova.xml', xml), ...entries, Buffer.alloc(1024)])
}
export function diskChunk(id: string, index: number, data: Buffer): Buffer[] {
  const name = `${id}/${String(index).padStart(8, '0')}`
  return [tarEntry(name, data), tarEntry(`${name}.checksum`, createHash('sha1').update(data).digest('hex'))]
}
export function xmlRpc(value: unknown): string {
  let body: string
  if (Array.isArray(value)) body = `<array><data>${value.map(xmlRpc).join('')}</data></array>`
  else if (typeof value === 'object' && value !== null) body = `<struct>${Object.entries(value).map(([k, v]) => `<member><name>${k}</name>${xmlRpc(v)}</member>`).join('')}</struct>`
  else if (typeof value === 'boolean') body = `<boolean>${value ? 1 : 0}</boolean>`
  else body = `<string>${String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</string>`
  return `<value>${body}</value>`
}

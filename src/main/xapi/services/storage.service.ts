/**
 * Storage service — wraps XAPI SR.*, VDI.* methods.
 * All functions accept connectionId as the first parameter for multi-connection support.
 */
import { connectionManager } from '../connection-manager'

export interface SrRecord {
  ref: string
  uuid: string
  name_label: string
  name_description: string
  type: string
  physical_size: number
  physical_utilisation: number
  virtual_allocation: number
  VDIs: string[]
  PBDs: string[]
  shared: boolean
}

export interface VdiRecord {
  ref: string
  uuid: string
  name_label: string
  virtual_size: number
  physical_utilisation: number
  type: string
  SR: string
  VBDs: string[]
  read_only: boolean
}

export interface ConnectedSrRecord extends SrRecord {
  connectionId: string
  poolName: string
}

export interface ConnectedVdiRecord extends VdiRecord {
  connectionId: string
  poolName: string
}

function getClient(connectionId: string) {
  const client = connectionManager.getClient(connectionId)
  if (!client) {
    throw new Error(`No connection found for connectionId: ${connectionId}`)
  }
  return client
}

function getPoolName(connectionId: string): string {
  return connectionManager.getConnectionInfo(connectionId)?.poolName ?? connectionId
}

export async function getAllSrs(connectionId: string): Promise<ConnectedSrRecord[]> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)
  const allRecords: Record<string, any> = await client.callWithSession('SR.get_all_records', [])
  const records = Object.entries(allRecords).map(([ref, record]) => ({ ref, ...record, connectionId, poolName }) as ConnectedSrRecord)
  // Exclude internal udev and iso SRs from the management view
  return records.filter(sr => sr.type !== 'udev' && sr.type !== 'iso')
}

export async function getAllVdis(connectionId: string, srRef: string): Promise<ConnectedVdiRecord[]> {
  const client = getClient(connectionId)
  const poolName = getPoolName(connectionId)
  const refs: string[] = await client.callWithSession('SR.get_VDIs', [srRef])
  const records = await Promise.all(
    refs.map(async (ref) => {
      const record = await client.callWithSession('VDI.get_record', [ref])
      return { ref, ...record, connectionId, poolName } as ConnectedVdiRecord
    })
  )
  return records
}

export async function createVdi(
  connectionId: string,
  srRef: string,
  name: string,
  sizeBytes: number
): Promise<string> {
  const client = getClient(connectionId)
  return await client.callWithSession('VDI.create', [{
    name_label: name,
    name_description: '',
    SR: srRef,
    virtual_size: String(sizeBytes),
    type: 'user',
    sharable: false,
    read_only: false,
    other_config: {},
    xenstore_data: {},
    sm_config: {},
    tags: []
  }])
}

export async function destroyVdi(connectionId: string, vdiRef: string): Promise<void> {
  const client = getClient(connectionId)
  await client.callWithSession('VDI.destroy', [vdiRef])
}

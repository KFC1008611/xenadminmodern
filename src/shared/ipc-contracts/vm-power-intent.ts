import type { VmPowerIntent } from '../types/xapi'
import { requireExactKeys, requireNonBlankString, requireNonNegativeNumber, requirePlainObject } from './runtime-schema'

export function parseVmPowerIntent(value: unknown): VmPowerIntent {
  const intent = requirePlainObject(value, 'VM power intent')
  requireExactKeys(intent, ['vmUuid'], ['poolUuid', 'epoch'], 'VM power intent')
  return {
    vmUuid: requireNonBlankString(intent.vmUuid, 'VM power intent UUID'),
    ...(intent.poolUuid === undefined ? {} : { poolUuid: requireNonBlankString(intent.poolUuid, 'VM power intent pool UUID') }),
    ...(intent.epoch === undefined ? {} : { epoch: requireNonNegativeNumber(intent.epoch, 'VM power intent connection epoch') }),
  }
}

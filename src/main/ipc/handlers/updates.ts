import { handleContract } from './utils'
import * as Updates from '../../../shared/ipc-contracts/updates'
import { getUpdateService } from '../../updates/update-service'

export function registerUpdateHandlers(): void {
  handleContract(Updates.updateGetStateContract, () => getUpdateService().getState())
  handleContract(Updates.updateSetEnabledContract, (enabled) => getUpdateService().setEnabled(enabled))
  handleContract(Updates.updateCheckContract, () => getUpdateService().check())
  handleContract(Updates.updateDownloadContract, () => getUpdateService().download())
  handleContract(Updates.updateInstallContract, () => getUpdateService().requestInstall())
}

import {
  alertHistoryAcknowledgeContract,
  alertHistoryGetCountContract,
  alertHistoryListContract,
  alertNotifyConfigGetContract,
  alertNotifyConfigSaveContract,
  alertNotifyHistoryContract,
  alertNotifySendContract,
  alertNotifyTestContract,
  alertRulesCreateContract,
  alertRulesDeleteContract,
  alertRulesEvaluateContract,
  alertRulesListContract,
  alertRulesUpdateContract,
  alertTriggeredContract,
  alertsDismissAllContract,
  alertsDismissContract,
  alertsGetAllContract,
  metricsGetCollectionErrorContract,
  metricsGetHistoryContract,
  metricsGetRangeContract,
  metricsGetStatsContract,
  metricsGetVmHistoryContract,
  metricsStartCollectionContract,
  metricsStopCollectionContract,
} from '../shared/ipc-contracts/observability'
import {
  bindIpcContractAlias,
  createIpcContractInvoker,
  createIpcContractSubscriber,
  type IpcInvokeTransport,
  type IpcPushTransport,
} from './ipc-contract-client'

export function createObservabilityApi(
  transport: IpcInvokeTransport & IpcPushTransport,
) {
  const startCollection = createIpcContractInvoker(metricsStartCollectionContract, transport)
  const getAlerts = createIpcContractInvoker(alertsGetAllContract, transport)
  const dismissAllAlerts = createIpcContractInvoker(alertsDismissAllContract, transport)
  const listAlertHistory = createIpcContractInvoker(alertHistoryListContract, transport)
  const getNotificationHistory = createIpcContractInvoker(
    alertNotifyHistoryContract,
    transport,
  )
  const startCollectionWithOptionalOptions = bindIpcContractAlias(
    startCollection,
    (connectionId: string, options?: Parameters<typeof startCollection>[1]) => (
      startCollection(connectionId, options)
    ),
  )
  const getAlertsWithOptionalFilters = bindIpcContractAlias(
    getAlerts,
    (connectionId: string, filters?: Parameters<typeof getAlerts>[1]) => (
      getAlerts(connectionId, filters)
    ),
  )
  const dismissAllAlertsWithOptionalFilters = bindIpcContractAlias(
    dismissAllAlerts,
    (connectionId: string, filters?: Parameters<typeof dismissAllAlerts>[1]) => (
      dismissAllAlerts(connectionId, filters)
    ),
  )
  const listAlertHistoryWithOptionalFilters = bindIpcContractAlias(
    listAlertHistory,
    (filters?: Parameters<typeof listAlertHistory>[0]) => listAlertHistory(filters),
  )
  const getNotificationHistoryWithOptionalFilters = bindIpcContractAlias(
    getNotificationHistory,
    (filters?: Parameters<typeof getNotificationHistory>[0]) => getNotificationHistory(filters),
  )

  return {
    metrics: {
      startCollection: startCollectionWithOptionalOptions,
      stopCollection: createIpcContractInvoker(metricsStopCollectionContract, transport),
      getHistory: createIpcContractInvoker(metricsGetHistoryContract, transport),
      getRange: createIpcContractInvoker(metricsGetRangeContract, transport),
      getStats: createIpcContractInvoker(metricsGetStatsContract, transport),
      getVmHistory: createIpcContractInvoker(metricsGetVmHistoryContract, transport),
      getCollectionError: createIpcContractInvoker(
        metricsGetCollectionErrorContract,
        transport,
      ),
    },
    alerts: {
      getAll: getAlertsWithOptionalFilters,
      dismiss: createIpcContractInvoker(alertsDismissContract, transport),
      dismissAll: dismissAllAlertsWithOptionalFilters,
    },
    alertRules: {
      list: createIpcContractInvoker(alertRulesListContract, transport),
      create: createIpcContractInvoker(alertRulesCreateContract, transport),
      update: createIpcContractInvoker(alertRulesUpdateContract, transport),
      delete: createIpcContractInvoker(alertRulesDeleteContract, transport),
      evaluate: createIpcContractInvoker(alertRulesEvaluateContract, transport),
    },
    alertHistory: {
      list: listAlertHistoryWithOptionalFilters,
      acknowledge: createIpcContractInvoker(alertHistoryAcknowledgeContract, transport),
      getCount: createIpcContractInvoker(alertHistoryGetCountContract, transport),
    },
    alertNotify: {
      getConfig: createIpcContractInvoker(alertNotifyConfigGetContract, transport),
      saveConfig: createIpcContractInvoker(alertNotifyConfigSaveContract, transport),
      test: createIpcContractInvoker(alertNotifyTestContract, transport),
      getHistory: getNotificationHistoryWithOptionalFilters,
      send: createIpcContractInvoker(alertNotifySendContract, transport),
    },
    onAlertTriggered: createIpcContractSubscriber(alertTriggeredContract, transport),
  }
}

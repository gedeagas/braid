import { app } from 'electron'
import { logger } from '../../lib/logger'
import { MOBILE_PROTOCOL_VERSION } from './protocol'
import { getMobileMachineName } from './instanceName'

/* eslint-disable @typescript-eslint/no-explicit-any */
let bonjour: any = null
let publishedService: any = null
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Start advertising the mobile server on the local network via mDNS/DNS-SD.
 * Service type: _braid._tcp
 */
export function advertise(port: number, instanceId: string): void {
  stop() // ensure clean state

  try {
    // Dynamic import to avoid issues in environments without multicast support
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BonjourMod = require('bonjour-service')
    const Bonjour = BonjourMod.Bonjour ?? BonjourMod.default ?? BonjourMod
    bonjour = new Bonjour()

    const machineName = getMobileMachineName()
    publishedService = bonjour.publish({
      name: `Braid - ${machineName}`,
      type: 'braid',
      port,
      txt: {
        instanceId,
        protocolVersion: String(MOBILE_PROTOCOL_VERSION),
        machineName,
        appVersion: app.getVersion(),
      },
    })

    logger.info(`[MobileDiscovery] Advertising _braid._tcp on port ${port}`)
  } catch (err) {
    logger.error('[MobileDiscovery] Failed to start Bonjour advertisement:', err)
  }
}

/** Stop advertising and tear down mDNS resources. */
export function stop(): void {
  try {
    if (publishedService) {
      publishedService.stop()
      publishedService = null
    }
    if (bonjour) {
      bonjour.destroy()
      bonjour = null
    }
  } catch {
    // Swallow - shutting down
  }
}

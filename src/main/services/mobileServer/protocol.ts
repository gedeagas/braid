import { MOBILE_PROTOCOL_VERSION, MIN_COMPATIBLE_MOBILE_VERSION, MOBILE_CAPABILITIES } from '../../../shared/mobile-protocol'

export { MOBILE_PROTOCOL_VERSION, MIN_COMPATIBLE_MOBILE_VERSION, MOBILE_CAPABILITIES }

/** Check if a mobile client's protocol version is compatible with this server. */
export function isCompatible(clientVersion: number): boolean {
  return clientVersion >= MIN_COMPATIBLE_MOBILE_VERSION && clientVersion <= MOBILE_PROTOCOL_VERSION
}

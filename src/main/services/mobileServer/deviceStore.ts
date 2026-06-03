import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import crypto from 'crypto'
import type { MobilePairingTransport, TrustedDevice } from './types'

const DATA_DIR = join(homedir(), 'Braid')
const DEVICES_PATH = join(DATA_DIR, 'devices.json')

class DeviceStore {
  private devices: TrustedDevice[] | null = null

  load(): TrustedDevice[] {
    if (this.devices) return this.devices
    try {
      if (!existsSync(DEVICES_PATH)) {
        this.devices = []
        return this.devices
      }
      const raw = readFileSync(DEVICES_PATH, 'utf-8')
      this.devices = JSON.parse(raw) as TrustedDevice[]
      return this.devices
    } catch {
      this.devices = []
      return this.devices
    }
  }

  save(devices: TrustedDevice[]): void {
    this.devices = devices
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(DEVICES_PATH, JSON.stringify(devices, null, 2), 'utf-8')
  }

  addDevice(name: string, publicKey: string): TrustedDevice {
    const devices = this.load()
    const device: TrustedDevice = {
      id: crypto.randomUUID(),
      name,
      publicKey,
      token: crypto.randomBytes(32).toString('hex'),
      pairedAt: Date.now(),
      lastSeenAt: Date.now(),
    }
    devices.push(device)
    this.save(devices)
    return device
  }

  removeDevice(deviceId: string): void {
    const devices = this.load().filter((d) => d.id !== deviceId)
    this.save(devices)
  }

  getByToken(token: string): TrustedDevice | null {
    return this.load().find((d) => d.token === token) ?? null
  }

  getById(deviceId: string): TrustedDevice | null {
    return this.load().find((d) => d.id === deviceId) ?? null
  }

  updateLastSeen(deviceId: string): void {
    const devices = this.load()
    const device = devices.find((d) => d.id === deviceId)
    if (device) {
      device.lastSeenAt = Date.now()
      this.save(devices)
    }
  }

  /** Store (or refresh) a device's Expo push token so the desktop can alert it
   *  while it is backgrounded. No-op if the device is unknown. */
  setPushToken(deviceId: string, token: string, platform?: 'ios' | 'android'): void {
    const devices = this.load()
    const device = devices.find((d) => d.id === deviceId)
    if (!device) return
    device.pushToken = token
    device.pushPlatform = platform
    device.pushTokenUpdatedAt = Date.now()
    this.save(devices)
  }

  /** Drop a device's push token (user disabled notifications, or the token went
   *  stale / DeviceNotRegistered). No-op if unknown or already absent. */
  clearPushToken(deviceId: string): void {
    const devices = this.load()
    const device = devices.find((d) => d.id === deviceId)
    if (!device || device.pushToken === undefined) return
    delete device.pushToken
    delete device.pushPlatform
    this.save(devices)
  }

  /** Create a one-time pairing token (not yet associated with a device). */
  createPairingToken(transport: MobilePairingTransport = 'lan'): string {
    const token = crypto.randomBytes(32).toString('hex')
    // Store a placeholder device that will be filled in during handshake
    const devices = this.load()
    const placeholder: TrustedDevice = {
      id: crypto.randomUUID(),
      name: '',
      publicKey: '',
      token,
      pairedAt: Date.now(),
      lastSeenAt: 0,
      pairingTransport: transport,
    }
    devices.push(placeholder)
    this.save(devices)
    return token
  }

  /** Finalize a pairing: fill in the device's name and public key, consume the token. */
  finalizePairing(token: string, name: string, publicKey: string): TrustedDevice | null {
    const devices = this.load()
    const device = devices.find((d) => d.token === token && d.publicKey === '')
    if (!device) return null
    device.name = name
    device.publicKey = publicKey
    device.lastSeenAt = Date.now()
    // Regenerate token so the pairing token is consumed (one-time use)
    device.token = crypto.randomBytes(32).toString('hex')
    this.save(devices)
    return device
  }

  /** Invalidate the in-memory cache (useful for testing). */
  invalidateCache(): void {
    this.devices = null
  }
}

export const deviceStore = new DeviceStore()

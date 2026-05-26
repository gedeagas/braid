import { describe, it, expect, beforeEach, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { deviceStore } from '../deviceStore'

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

vi.mock('os', () => ({
  homedir: () => '/mock/home',
}))

const mockedExistsSync = vi.mocked(existsSync)
const mockedReadFileSync = vi.mocked(readFileSync)
const mockedWriteFileSync = vi.mocked(writeFileSync)

beforeEach(() => {
  vi.clearAllMocks()
  deviceStore.invalidateCache()
})

describe('DeviceStore', () => {
  describe('load', () => {
    it('returns empty array when file does not exist', () => {
      mockedExistsSync.mockReturnValue(false)
      expect(deviceStore.load()).toEqual([])
    })

    it('parses existing devices file', () => {
      const devices = [{ id: '1', name: 'Test', publicKey: 'pk', token: 'tk', pairedAt: 1000, lastSeenAt: 2000 }]
      mockedExistsSync.mockReturnValue(true)
      mockedReadFileSync.mockReturnValue(JSON.stringify(devices))
      expect(deviceStore.load()).toEqual(devices)
    })

    it('returns empty array on corrupted file', () => {
      mockedExistsSync.mockReturnValue(true)
      mockedReadFileSync.mockReturnValue('not-json')
      expect(deviceStore.load()).toEqual([])
    })

    it('caches loaded data', () => {
      mockedExistsSync.mockReturnValue(false)
      deviceStore.load()
      deviceStore.load()
      expect(mockedExistsSync).toHaveBeenCalledTimes(1)
    })
  })

  describe('save', () => {
    it('writes JSON to disk', () => {
      const devices = [{ id: '1', name: 'Test', publicKey: 'pk', token: 'tk', pairedAt: 1000, lastSeenAt: 2000 }]
      deviceStore.save(devices as never)
      expect(mockedWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('devices.json'),
        JSON.stringify(devices, null, 2),
        'utf-8'
      )
    })
  })

  describe('addDevice', () => {
    it('creates a device with generated id and token', () => {
      mockedExistsSync.mockReturnValue(false)
      const device = deviceStore.addDevice('iPhone', 'base64-pk')
      expect(device.name).toBe('iPhone')
      expect(device.publicKey).toBe('base64-pk')
      expect(device.id).toBeTruthy()
      expect(device.token).toBeTruthy()
      expect(device.token.length).toBe(64) // 32 bytes hex
      expect(device.pairedAt).toBeGreaterThan(0)
    })
  })

  describe('removeDevice', () => {
    it('removes a device by id', () => {
      mockedExistsSync.mockReturnValue(false)
      const device = deviceStore.addDevice('iPhone', 'pk')
      deviceStore.removeDevice(device.id)
      expect(deviceStore.getById(device.id)).toBeNull()
    })
  })

  describe('getByToken', () => {
    it('finds device by token', () => {
      mockedExistsSync.mockReturnValue(false)
      const device = deviceStore.addDevice('iPhone', 'pk')
      expect(deviceStore.getByToken(device.token)?.id).toBe(device.id)
    })

    it('returns null for unknown token', () => {
      mockedExistsSync.mockReturnValue(false)
      expect(deviceStore.getByToken('nonexistent')).toBeNull()
    })
  })

  describe('createPairingToken / finalizePairing', () => {
    it('creates a placeholder and finalizes it', () => {
      mockedExistsSync.mockReturnValue(false)
      const token = deviceStore.createPairingToken()
      expect(token.length).toBe(64)

      const device = deviceStore.finalizePairing(token, 'iPad', 'ipad-pk')
      expect(device).not.toBeNull()
      expect(device!.name).toBe('iPad')
      expect(device!.publicKey).toBe('ipad-pk')
      // Token should be regenerated (one-time use)
      expect(device!.token).not.toBe(token)
    })

    it('returns null for already-finalized token', () => {
      mockedExistsSync.mockReturnValue(false)
      const token = deviceStore.createPairingToken()
      deviceStore.finalizePairing(token, 'iPad', 'pk')
      // Second attempt should fail
      expect(deviceStore.finalizePairing(token, 'iPad2', 'pk2')).toBeNull()
    })
  })

  describe('updateLastSeen', () => {
    it('updates lastSeenAt timestamp', () => {
      mockedExistsSync.mockReturnValue(false)
      const device = deviceStore.addDevice('iPhone', 'pk')
      const originalLastSeen = device.lastSeenAt

      // Small delay to ensure timestamp differs
      deviceStore.updateLastSeen(device.id)
      const updated = deviceStore.getById(device.id)
      expect(updated!.lastSeenAt).toBeGreaterThanOrEqual(originalLastSeen)
    })
  })
})

const { execSync } = require('child_process')
const path = require('path')

/**
 * VMP-sign the local Electron.app so Widevine DRM works in dev mode.
 * Runs as part of `postinstall`. Requires: pip3 install castlabs-evs
 */
const distDir = path.join(__dirname, '../node_modules/electron/dist')

try {
  execSync(`python3 -m castlabs_evs.vmp sign-pkg "${distDir}"`, { stdio: 'inherit' })
  console.log('[VMP] Dev Electron signed for Widevine.')
} catch {
  console.warn('[VMP] Dev signing skipped — run `pip3 install castlabs-evs` and `python3 -m castlabs_evs.account login` to enable Widevine in dev mode.')
}

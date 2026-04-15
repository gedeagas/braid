/**
 * Patches the local Electron.app bundle so that dev mode shows
 * the correct app name ("Braid") and icon in the macOS Dock.
 *
 * Runs as part of `postinstall`.
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ELECTRON_APP = path.join(
  __dirname,
  '../node_modules/electron/dist/Electron.app'
)
const PLIST_PATH = path.join(ELECTRON_APP, 'Contents/Info.plist')
const ICON_SRC = path.join(__dirname, '../build/icon.png')
const ICNS_DEST = path.join(ELECTRON_APP, 'Contents/Resources/electron.icns')

// --- Patch Info.plist ---
if (fs.existsSync(PLIST_PATH)) {
  let plist = fs.readFileSync(PLIST_PATH, 'utf8')
  plist = plist
    .replace(
      /<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/,
      '<key>CFBundleDisplayName</key>\n\t<string>Braid</string>'
    )
    .replace(
      /<key>CFBundleName<\/key>\s*<string>[^<]*<\/string>/,
      '<key>CFBundleName</key>\n\t<string>Braid</string>'
    )
  // Insert new keys into the top-level <dict>, not a nested one.
  // The plist has nested dicts (e.g. ElectronAsarIntegrity), so we must
  // target the final </dict> before </plist>, not the first </dict>.
  function insertTopLevel(xml, entry) {
    const marker = '</dict>\n</plist>'
    return xml.replace(marker, `${entry}\n${marker}`)
  }

  // Add camera/mic usage descriptions and continuity camera support for Google Meet etc.
  const plistEntries = [
    { key: 'NSCameraUsageDescription', value: 'Braid needs camera access for video calls in embedded web apps like Google Meet.' },
    { key: 'NSMicrophoneUsageDescription', value: 'Braid needs microphone access for calls in embedded web apps like Google Meet.' },
  ]
  for (const { key, value } of plistEntries) {
    if (!plist.includes(`<key>${key}</key>`)) {
      plist = insertTopLevel(plist, `\t<key>${key}</key>\n\t<string>${value}</string>`)
    }
  }
  if (!plist.includes('<key>NSCameraUseContinuityCameraDeviceType</key>')) {
    plist = insertTopLevel(plist, '\t<key>NSCameraUseContinuityCameraDeviceType</key>\n\t<true/>')
  }

  // Add CFBundleIconName for macOS 26+ Liquid Glass icon
  if (!plist.includes('<key>CFBundleIconName</key>')) {
    plist = insertTopLevel(plist, '\t<key>CFBundleIconName</key>\n\t<string>Braid</string>')
  }

  fs.writeFileSync(PLIST_PATH, plist)
  console.log('✓ Patched Electron Info.plist (app name → Braid, camera/mic permissions)')
}

// --- Convert icon.png → .icns and replace Electron's default icon ---
if (fs.existsSync(ICON_SRC) && process.platform === 'darwin') {
  try {
    const iconsetDir = path.join(__dirname, '../build/icon.iconset')
    fs.mkdirSync(iconsetDir, { recursive: true })

    const sizes = [16, 32, 64, 128, 256, 512, 1024]
    for (const size of sizes) {
      execSync(
        `sips -z ${size} ${size} "${ICON_SRC}" --out "${path.join(iconsetDir, `icon_${size}x${size}.png`)}"`,
        { stdio: 'ignore' }
      )
      if (size <= 512) {
        const retinaSize = size * 2
        execSync(
          `sips -z ${retinaSize} ${retinaSize} "${ICON_SRC}" --out "${path.join(iconsetDir, `icon_${size}x${size}@2x.png`)}"`,
          { stdio: 'ignore' }
        )
      }
    }

    execSync(`iconutil -c icns "${iconsetDir}" -o "${ICNS_DEST}"`, {
      stdio: 'ignore'
    })
    fs.rmSync(iconsetDir, { recursive: true, force: true })
    console.log('✓ Replaced Electron icon with Braid icon')
  } catch (err) {
    console.warn('⚠ Could not convert icon to .icns:', err.message)
  }
}

// --- Copy Assets.car for macOS 26+ Liquid Glass icon in dev mode ---
const ASSETS_CAR_SRC = path.join(__dirname, '../build/Assets.car')
const ASSETS_CAR_DEST = path.join(ELECTRON_APP, 'Contents/Resources/Assets.car')
if (fs.existsSync(ASSETS_CAR_SRC) && fs.existsSync(ELECTRON_APP)) {
  fs.copyFileSync(ASSETS_CAR_SRC, ASSETS_CAR_DEST)
  console.log('✓ Copied Assets.car for Liquid Glass icon (dev mode)')
}

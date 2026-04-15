#!/usr/bin/env node

/**
 * Generates a macOS Tahoe Liquid Glass icon from build/icon.png.
 *
 * Creates a `.icon` package (the new layered icon format introduced in macOS 26)
 * and compiles it to an `Assets.car` asset catalog using Xcode's `actool`.
 *
 * The resulting Assets.car is placed in build/ and later copied into the app
 * bundle by package.js. On macOS 26+, the OS reads CFBundleIconName from
 * Info.plist and loads the icon from Assets.car, giving it the Liquid Glass
 * treatment. Pre-Tahoe systems fall back to CFBundleIconFile (icon.icns).
 *
 * Requirements:
 *   - macOS with Xcode 26+ installed (for actool)
 *   - build/icon.png (1024x1024 source icon)
 *
 * Usage:
 *   node scripts/generate-icon.js
 *
 * Output:
 *   build/Braid.icon/   - .icon package (intermediate)
 *   build/Assets.car     - compiled asset catalog (ship this)
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const BUILD_DIR = path.join(ROOT, 'build')
const ICON_PNG = path.join(BUILD_DIR, 'icon.png')
const ICON_NAME = 'Braid'
const ICON_PACKAGE = path.join(BUILD_DIR, `${ICON_NAME}.icon`)
const ASSETS_DIR = path.join(ICON_PACKAGE, 'Assets')

// ---------------------------------------------------------------------------
// Preflight checks
// ---------------------------------------------------------------------------

if (process.platform !== 'darwin') {
  console.log('[generate-icon] Skipping - not on macOS')
  process.exit(0)
}

if (!fs.existsSync(ICON_PNG)) {
  console.error(`[generate-icon] Source icon not found: ${ICON_PNG}`)
  process.exit(1)
}

try {
  execSync('xcrun --find actool', { stdio: 'ignore' })
} catch {
  console.log('[generate-icon] Skipping - actool not found (install Xcode 26+)')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 1. Create .icon package
// ---------------------------------------------------------------------------

console.log(`[generate-icon] Creating ${ICON_NAME}.icon package...`)

// Clean previous output
if (fs.existsSync(ICON_PACKAGE)) {
  fs.rmSync(ICON_PACKAGE, { recursive: true, force: true })
}

fs.mkdirSync(ASSETS_DIR, { recursive: true })

// Copy source PNG as the foreground layer
fs.copyFileSync(ICON_PNG, path.join(ASSETS_DIR, 'foreground.png'))

// Write icon.json with proper Liquid Glass structure.
//
// The icon needs a top-level `fill` (canvas background behind all groups)
// and at least one group with Liquid Glass properties (translucency, shadow)
// for macOS 26 to render it as a proper Liquid Glass icon instead of
// putting it in "icon jail".
//
// Groups are ordered front-to-back: groups[0] is the top-most layer.
// The foreground group has specular enabled for the glass highlight effect.
//
// Replace this entire .icon package with an Icon Composer export
// for proper multi-layer Liquid Glass effects (separate background/foreground
// artwork, dark mode variants, tinted appearance, etc.).
const iconJson = {
  fill: {
    // Braid's dark navy background color from the SVG icon
    solid: 'srgb:0.02353,0.09020,0.03529,1.00000',
  },
  groups: [
    {
      // Foreground: the icon artwork rendered on top of the fill
      layers: [
        {
          fill: 'automatic',
          hidden: false,
          'image-name': 'foreground.png',
          name: 'foreground',
        },
      ],
      shadow: {
        kind: 'neutral',
        opacity: 0.5,
      },
      specular: true,
      translucency: {
        enabled: false,
        value: 0,
      },
    },
  ],
  'supported-platforms': {
    squares: 'shared',
  },
}

fs.writeFileSync(path.join(ICON_PACKAGE, 'icon.json'), JSON.stringify(iconJson, null, 2) + '\n')

console.log(`[generate-icon] Created ${ICON_NAME}.icon (fill + foreground group with specular)`)

// ---------------------------------------------------------------------------
// 2. Compile to Assets.car via actool
// ---------------------------------------------------------------------------

console.log('[generate-icon] Compiling with actool...')

// --enable-icon-stack-fallback-generation=disabled prevents actool from
// auto-generating an .icns that would overwrite our hand-crafted one.
const actoolArgs = [
  `"${ICON_PACKAGE}"`,
  `--compile "${BUILD_DIR}"`,
  '--output-format human-readable-text',
  '--notices --warnings --errors',
  '--output-partial-info-plist /dev/null',
  `--app-icon ${ICON_NAME}`,
  '--include-all-app-icons',
  '--enable-on-demand-resources NO',
  '--enable-icon-stack-fallback-generation=disabled',
  '--development-region en',
  '--target-device mac',
  '--minimum-deployment-target 14.0',
  '--platform macosx',
]

try {
  const output = execSync(`xcrun actool ${actoolArgs.join(' ')}`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  // actool prints compilation results to stdout
  const lines = output.split('\n').filter(Boolean)
  for (const line of lines) {
    if (line.includes('Assets.car') || line.includes('.icns')) {
      console.log(`[generate-icon]   ${line.trim()}`)
    }
  }
} catch (err) {
  console.error('[generate-icon] actool failed:')
  if (err.stderr) console.error(err.stderr)
  if (err.stdout) console.error(err.stdout)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 3. Clean up actool's auto-generated .icns (we keep our own icon.icns)
// ---------------------------------------------------------------------------

const generatedIcns = path.join(BUILD_DIR, `${ICON_NAME}.icns`)
if (fs.existsSync(generatedIcns)) {
  fs.unlinkSync(generatedIcns)
  console.log(`[generate-icon] Removed actool-generated ${ICON_NAME}.icns (keeping icon.icns)`)
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

const carPath = path.join(BUILD_DIR, 'Assets.car')
if (fs.existsSync(carPath)) {
  const mb = (fs.statSync(carPath).size / 1024 / 1024).toFixed(1)
  console.log(`[generate-icon] Done: ${carPath} (${mb}MB)`)
} else {
  console.error('[generate-icon] Assets.car was not created - check actool output above')
  process.exit(1)
}

---
sidebar_position: 1
title: Mobile Development
---

# Mobile Development

Braid can stream an iOS Simulator or Android Emulator directly into the right panel, so you see your app running alongside your code and chat. You interact with the device through gestures, text input, and hardware buttons without leaving Braid. Claude can also control the device programmatically through MCP tools.

## Prerequisites

Mobile development features require **mobilecli**, a command-line tool that bridges Braid to simulator and emulator devices.

```bash
# Install mobilecli (check your team's internal docs for the install method)
which mobilecli  # verify it's on your PATH
```

You also need the platform toolchains:

| Platform | Requirement |
|----------|-------------|
| **iOS** | Xcode with Simulator installed (`xcrun simctl` must be available) |
| **Android** | Android SDK with emulator and platform-tools (`adb` must be available) |

Braid auto-detects which platforms are available and shows only the relevant devices.

## Open the Simulator tab

Click the **Simulator** tab in the right panel. Braid checks for mobilecli and shows available devices. If mobilecli is not installed, you see a prompt with installation instructions.

## Boot a device

Select a device from the device picker dropdown in the toolbar. Click the **Boot** button to start it. Braid polls the device status and shows it as "online" once it is ready. iOS simulators typically boot in a few seconds, while Android emulators can take longer.

## Stream the device screen

Once the device is online, Braid starts an MJPEG stream and renders it inside the panel wrapped in a device mockup frame. The stream resolution automatically scales to match your display, keeping the feed sharp without wasting bandwidth.

The native Simulator or Emulator window is hidden automatically so it does not clutter your screen alongside Braid.

## Interact with the device

### Touch gestures

Click anywhere on the streamed device screen to **tap** at that location. Braid translates your click coordinates from the display size to the device's logical point dimensions.

Click and drag to **swipe**. The gesture is sent as a sequence of pointer movements matching your drag path.

### Text input

When a text field is focused on the device, type on your keyboard and the text is forwarded. This works for both iOS and Android.

### Hardware buttons

The device toolbar provides buttons for common hardware actions:

| Button | Action |
|--------|--------|
| **Home** | Press the home button |
| **Back** | Press back (Android) |
| **Volume Up/Down** | Adjust volume |
| **Power** | Press the power button |
| **App Switch** | Open the app switcher |

### Orientation

Toggle between portrait and landscape using the orientation control in the toolbar. The stream adjusts automatically.

## Framework-specific controls

Braid detects whether your project uses React Native or Flutter and shows framework-specific controls.

### React Native

- **Reload** - Triggers a Metro bundler fast refresh, reloading your JavaScript without restarting the app.
- **Dev Menu** - Opens the React Native developer menu on the device.

### Flutter

- **Hot Reload** - Sends SIGUSR1 to the Flutter process, preserving widget state.
- **Hot Restart** - Sends SIGUSR2 to the Flutter process, resetting all state.
- **DevTools** - Opens Flutter DevTools in your browser.

## Claude's mobile MCP tools

When you have a device connected, Claude has access to 15+ MCP tools for interacting with it programmatically. This enables AI-driven mobile testing - Claude can navigate your app, tap buttons, enter text, and verify screen content.

### Device management

| Tool | Description |
|------|-------------|
| `mobile_list_devices` | List all available devices with their status |
| `mobile_use_device` | Set the active device for subsequent commands |
| `mobile_boot_device` | Boot a simulator or emulator |

### Screen and elements

| Tool | Description |
|------|-------------|
| `mobile_take_screenshot` | Capture the current screen as an image |
| `mobile_get_screen_size` | Get screen dimensions in logical points |
| `mobile_list_elements` | List all UI elements from the accessibility tree with coordinates |

### Touch interaction

| Tool | Description |
|------|-------------|
| `mobile_tap_element` | Find and tap a UI element by text, label, or accessibility identifier |
| `mobile_tap` | Tap at raw (x, y) coordinates (fallback for non-interactive areas) |
| `mobile_long_press` | Long press at coordinates with configurable duration |
| `mobile_swipe` | Swipe from start to end coordinates |

### Input and controls

| Tool | Description |
|------|-------------|
| `mobile_type_text` | Type text into the focused input field, optionally pressing Enter |
| `mobile_press_button` | Press HOME, BACK, VOLUME_UP, VOLUME_DOWN, POWER, APP_SWITCH, or ENTER |
| `mobile_get_orientation` | Get current device orientation |
| `mobile_set_orientation` | Set orientation to portrait or landscape |

### Framework debug

| Tool | Description |
|------|-------------|
| `mobile_reload_app` | Hot reload (React Native fast refresh or Flutter hot reload) |
| `mobile_open_dev_menu` | Open the React Native developer menu |
| `mobile_hot_restart` | Full Flutter hot restart (resets state) |
| `mobile_open_devtools` | Open framework DevTools in the browser |

:::tip
The most reliable way for Claude to interact with your app is through `mobile_tap_element`, which uses the accessibility tree to find elements by their text or label. This is more accurate than tapping raw coordinates from a screenshot. Claude should call `mobile_list_elements` first to see what is on screen, then tap the target element by name.
:::

## Example workflow

1. Boot your simulator and start your React Native or Flutter app.
2. Tell Claude: "Test the login flow. Enter 'test@example.com' as the email and 'password123' as the password, then tap Sign In."
3. Claude uses `mobile_list_elements` to find the email field, `mobile_tap_element` to focus it, `mobile_type_text` to enter the email, and repeats for the password field.
4. Claude takes a screenshot to verify the result and reports back.

:::note
Mobile MCP tools require an active device connection. If no device is booted, Claude's tool calls will fail with an error message asking you to boot a device first.
:::

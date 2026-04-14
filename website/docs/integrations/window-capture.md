---
sidebar_position: 4
title: Window Capture
---

# Window Capture

Window Capture lets you stream any open simulator or emulator window into a Braid tab. You see the device output directly in the right panel, and you can click on the stream to send taps to the captured window.

## macOS permissions

Window Capture requires **Screen Recording** permission on macOS. When you first open the Window Capture tab, Braid checks the permission status:

- **Granted** - You see available window sources immediately.
- **Not granted** - Braid shows a prompt and opens the macOS System Settings privacy pane. Grant access to Braid, then return to the app.

:::note
After granting Screen Recording permission, you may need to restart Braid for the change to take effect. macOS caches permission state per process.
:::

## Open the Window Capture tab

Click the **Window Capture** tab in the right panel. Braid scans for open windows that match known emulator and simulator patterns:

- **iOS Simulator** - Windows titled "iPhone ...", "iPad ...", or containing "Simulator"
- **Android Emulator** - Windows titled "Android Emulator", "emulator-...", or "Pixel ... API ..."

Each detected window shows a thumbnail preview so you can identify which device it is.

## Select and stream a source

Click a window thumbnail to start streaming. The video feed appears in the panel at a resolution matched to your display. The source window continues running in the background.

## Tap forwarding

Click anywhere on the streamed video to send a mouse click to the original window at the corresponding position. Braid uses CoreGraphics events to translate your click from the stream coordinates to the window's absolute screen position.

Tap forwarding requires **Accessibility** permission on macOS. If not granted, Braid prompts you to enable it in System Settings.

:::tip
Window Capture is useful when you want to see an emulator alongside your code without the simulator window taking up screen space. The stream stays in the right panel while you work in the center panel.
:::

## Use cases

- **Testing UI changes** - See your app update live in the panel as Claude edits code and triggers hot reload.
- **Debugging layout** - Keep the device visible while inspecting component trees or reading logs.
- **Demo preparation** - Record your workflow with the device visible alongside the code.

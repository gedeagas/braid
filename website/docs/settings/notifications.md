---
sidebar_position: 5
title: Notifications
---

# Notifications

Open Settings with **Cmd+,** and select the **Notifications** tab to control desktop notifications and in-app toasts.

## Desktop notifications

Desktop notifications appear in the macOS Notification Center when the Braid window is not focused. You can toggle each event type independently.

| Option | Description | Default |
|---|---|---|
| **On task complete** | Notify when Claude finishes a session turn. | On |
| **On error** | Notify when a session encounters an error. | On |
| **On user input needed** | Notify when Claude is waiting for your response (e.g., `AskUserQuestion` or `ExitPlanMode` prompts). | On |
| **Sound** | Play a sound with desktop notifications. | Off |

## In-app toasts

Toasts are brief overlay messages that appear inside the Braid window. They confirm actions like saving files, copying text, or completing operations.

| Option | Description | Values |
|---|---|---|
| **Enable toasts** | Toggle all in-app toast messages on or off. | On, Off |
| **Size** | Control the size of toast popups. | Small, Medium, Large |
| **Position** | Set where toasts appear on screen. | Bottom Left, Bottom Right, Top Center |

## Notification sounds

When the **Sound** toggle is enabled, Braid plays a custom synthesized tone for each notification event. These sounds are generated in real time using the **Web Audio API** — they are not system sounds or pre-recorded files.

Each event type has a distinct tone:

| Event | Sound character |
|-------|----------------|
| **Task complete** | Uplifting harmonic chord with soft attack |
| **Error** | Lower-pitched alert tone |
| **User input needed** | Gentle attention-getting melody |

The sounds use layered harmonics with an exponential decay, so they feel organic and non-intrusive. Volume follows your system audio level.

## Tips

- Desktop notifications require macOS notification permissions for Braid. If you do not see notifications, check **System Settings > Notifications > Braid**.
- The "on user input needed" notification is especially useful when you start a long task and switch to another app. You get alerted as soon as Claude needs your attention.
- Toast position and size changes apply immediately. No restart required.
- Notification sounds are synthesized locally and play instantly — they do not depend on any external audio files.

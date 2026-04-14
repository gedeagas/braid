---
sidebar_position: 9
title: Apps
---

# Apps

Braid supports embedding custom web applications in an overlay panel. You can add URLs for dashboards, internal tools, or documentation that you frequently reference while coding.

## Add a web app

1. Open **Settings > Apps**.
2. Enter a **name** for the app (e.g., "Storybook", "Admin Dashboard").
3. Enter the **URL** (e.g., `http://localhost:6006`).
4. Click **Add**.

The app appears in the app dock in the sidebar.

## Open an app

Click an app in the dock to open it in an overlay panel in the center area. The web app loads in an embedded webview. You can switch between apps and your chat sessions freely.

## Toggle visibility

You can show or hide individual apps from the dock without removing them. This keeps your sidebar clean when you have apps you only use occasionally.

## Remove an app

Go to **Settings > Apps** and click the remove button next to the app you want to delete.

:::tip
Embedded apps are useful for keeping local development servers visible alongside your code. Add your Storybook, Swagger UI, or admin panel so you can reference them without switching to a browser tab.
:::

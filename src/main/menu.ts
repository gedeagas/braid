import { Menu, BrowserWindow, app } from 'electron'

function sendAction(win: BrowserWindow, action: string): void {
  win.webContents.send('menu:action', action)
}

export function createAppMenu(mainWindow: BrowserWindow): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              {
                label: `About ${app.name}`,
                click: () => sendAction(mainWindow, 'openAbout')
              },
              { type: 'separator' as const },
              {
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                click: () => sendAction(mainWindow, 'openSettings')
              },
              {
                label: 'Keyboard Shortcuts',
                accelerator: 'CmdOrCtrl+/',
                click: () => sendAction(mainWindow, 'openShortcuts')
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),

    // Edit
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendAction(mainWindow, 'saveFile')
        }
      ]
    },

    // View
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Left Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => sendAction(mainWindow, 'toggleSidebar')
        },
        {
          label: 'Toggle Right Panel',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => sendAction(mainWindow, 'toggleRightPanel')
        },
        {
          label: 'Mission Control',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => sendAction(mainWindow, 'toggleMissionControl')
        },
        { type: 'separator' },
        {
          label: 'Toggle Terminal',
          accelerator: 'CmdOrCtrl+E',
          click: () => sendAction(mainWindow, 'toggleTerminal')
        },
        {
          label: 'Focus Chat Input',
          accelerator: 'CmdOrCtrl+L',
          click: () => sendAction(mainWindow, 'focusChat')
        },
        { type: 'separator' },
        {
          label: 'Quick Open',
          accelerator: 'CmdOrCtrl+P',
          click: () => sendAction(mainWindow, 'quickOpen')
        },
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+K',
          click: () => sendAction(mainWindow, 'openCommandPalette')
        },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => sendAction(mainWindow, 'zoomIn')
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => sendAction(mainWindow, 'zoomOut')
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: () => sendAction(mainWindow, 'zoomReset')
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        ...(!app.isPackaged ? [{
          label: 'Toggle Developer Tools',
          accelerator: 'CmdOrCtrl+Option+I',
          click: () => mainWindow.webContents.toggleDevTools()
        }] : [])
      ]
    },

    // Tab
    {
      label: 'Tab',
      submenu: [
        {
          label: 'New Chat Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => sendAction(mainWindow, 'newChatTab')
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => sendAction(mainWindow, 'closeCurrentTab')
        },
        { type: 'separator' },
        {
          label: 'Previous Tab',
          accelerator: 'CmdOrCtrl+Shift+[',
          click: () => sendAction(mainWindow, 'previousTab')
        },
        {
          label: 'Next Tab',
          accelerator: 'CmdOrCtrl+Shift+]',
          click: () => sendAction(mainWindow, 'nextTab')
        },
        { type: 'separator' },
        ...Array.from({ length: 9 }, (_, i) => ({
          label: `Tab ${i + 1}${i === 8 ? ' (Last)' : ''}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          click: () => sendAction(mainWindow, `goToTab${i + 1}`),
          visible: false,
        })),
      ]
    },

    // Window
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [])
      ]
    },

    // Help
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: isMac ? undefined : 'CmdOrCtrl+/',
          click: () => sendAction(mainWindow, 'openShortcuts')
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

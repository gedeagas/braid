/**
 * Built-in LSP server configurations.
 * Extracted from lsp.ts to keep the service file focused on protocol logic.
 */

import type { LspServerConfig } from './lsp'

export const BUILTIN_SERVERS: LspServerConfig[] = [
  {
    id: 'typescript',
    label: 'TypeScript / JavaScript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    extensions: ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'],
    detectFiles: ['tsconfig.json', 'package.json'],
    languageId: 'typescript',
    builtin: true,
    installCandidates: [
      { type: 'command', prereq: 'npm',  command: ['npm',  'install', '-g', 'typescript', 'typescript-language-server'], label: 'npm'  },
      { type: 'command', prereq: 'pnpm', command: ['pnpm', 'install', '-g', 'typescript', 'typescript-language-server'], label: 'pnpm' },
      { type: 'command', prereq: 'yarn', command: ['yarn', 'global',  'add', 'typescript', 'typescript-language-server'], label: 'yarn' },
    ],
    installHint: 'npm install -g typescript typescript-language-server',
  },
  {
    id: 'rust',
    label: 'Rust',
    command: 'rust-analyzer',
    args: [],
    extensions: ['rs'],
    detectFiles: ['Cargo.toml'],
    languageId: 'rust',
    builtin: true,
    installCandidates: [
      { type: 'command', prereq: 'rustup', command: ['rustup', 'component', 'add', 'rust-analyzer'], label: 'rustup'  },
      { type: 'command', prereq: 'brew',   command: ['brew', 'install', 'rust-analyzer'],            label: 'Homebrew' },
      {
        type: 'download',
        urls: {
          'darwin-arm64': 'https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-aarch64-apple-darwin.gz',
          'darwin-x64':   'https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-x86_64-apple-darwin.gz',
        },
        decompress: 'gz',
        label: 'GitHub Releases',
      },
    ],
    installHint: 'rustup component add rust-analyzer',
  },
  {
    id: 'go',
    label: 'Go',
    command: 'gopls',
    args: [],
    extensions: ['go'],
    detectFiles: ['go.mod'],
    languageId: 'go',
    builtin: true,
    installCandidates: [
      { type: 'command', prereq: 'go', command: ['go', 'install', 'golang.org/x/tools/gopls@latest'], label: 'go install' },
    ],
    installHint: 'Requires Go — install at go.dev/dl, then: go install golang.org/x/tools/gopls@latest',
  },
  {
    id: 'python',
    label: 'Python (Pyright)',
    command: 'pyright-langserver',
    args: ['--stdio'],
    extensions: ['py', 'pyi'],
    detectFiles: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt'],
    languageId: 'python',
    builtin: true,
    installCandidates: [
      { type: 'command', prereq: 'npm',  command: ['npm',  'install', '-g', 'pyright'], label: 'npm'  },
      { type: 'command', prereq: 'pnpm', command: ['pnpm', 'install', '-g', 'pyright'], label: 'pnpm' },
      { type: 'command', prereq: 'pip',  command: ['pip',  'install', 'pyright'],        label: 'pip'  },
      { type: 'command', prereq: 'pip3', command: ['pip3', 'install', 'pyright'],        label: 'pip3' },
    ],
    installHint: 'npm install -g pyright',
  },
  {
    id: 'swift',
    label: 'Swift',
    command: 'sourcekit-lsp',
    args: [],
    extensions: ['swift'],
    detectFiles: ['Package.swift'],
    languageId: 'swift',
    builtin: true,
    installCandidates: [
      { type: 'command', prereq: 'xcode-select', command: ['xcode-select', '--install'], label: 'Xcode CLT' },
      { type: 'command', prereq: 'brew',         command: ['brew', 'install', 'swift'],   label: 'Homebrew'  },
    ],
    installHint: 'Requires Xcode or Xcode Command Line Tools: xcode-select --install',
  },
]

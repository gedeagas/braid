# Contributing

Braid is currently in **alpha** and is not accepting external contributions or new maintainers at this time.

## Bug Reports

If you encounter a bug, you may file a report via [GitHub Issues](https://github.com/gedeagas/braid/issues). Please include:

- Braid version (Settings > About)
- macOS version and architecture (Apple Silicon or Intel)
- Steps to reproduce the issue
- Expected vs. actual behavior
- Relevant logs or screenshots

## Feature Requests

We are not accepting feature requests at this time. This may change in the future.

## Development Setup

If you want to explore the codebase locally:

```bash
git clone https://github.com/gedeagas/braid.git
cd braid
corepack enable
yarn install
yarn dev
```

### Commands

| Command | Description |
| --- | --- |
| `yarn dev` | Development mode with hot reload |
| `yarn build` | Production build |
| `yarn typecheck` | Type-check main + renderer |
| `yarn test` | Run unit tests (Vitest) |
| `yarn package` | Build `.dmg` installer |

### Architecture

Braid is an Electron app with three layers. Changes must be threaded through all three:

1. **Main process** (`src/main/`) - services, IPC handlers
2. **Preload** (`src/preload/index.ts`) - context-isolated bridge
3. **Renderer** (`src/renderer/`) - React UI with Zustand stores

See `CLAUDE.md` for detailed architecture documentation.

## Code Style

- TypeScript strict mode
- No file should exceed 450 lines - decompose into directory modules
- Use design tokens from `tokens.css`, never hardcode pixel values
- Use the component library (`src/renderer/components/ui/`) instead of raw HTML
- All user-facing strings must be translated (en, ja, id)

## License

By submitting a contribution, you agree that it will be licensed under the MIT License.

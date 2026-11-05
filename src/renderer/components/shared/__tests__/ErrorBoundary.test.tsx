import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ErrorBoundary } from '../ErrorBoundary'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

let shouldThrow = true
function Bomb() {
  if (shouldThrow) throw new Error('kaboom')
  return <div>recovered</div>
}

beforeEach(() => {
  shouldThrow = true
  // React logs caught errors; keep test output clean
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('shows the panel fallback with the error message, leaving siblings rendered', () => {
    render(
      <>
        <ErrorBoundary scope="panel"><Bomb /></ErrorBoundary>
        <div>sibling panel</div>
      </>
    )
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('errorBoundary.panelTitle')).toBeTruthy()
    expect(screen.getByText('kaboom')).toBeTruthy()
    expect(screen.getByText('sibling panel')).toBeTruthy()
  })

  it('uses the app-level title by default', () => {
    render(<ErrorBoundary><Bomb /></ErrorBoundary>)
    expect(screen.getByText('errorBoundary.appTitle')).toBeTruthy()
  })

  it('re-renders children after "try again" once the cause is gone', () => {
    render(<ErrorBoundary scope="panel"><Bomb /></ErrorBoundary>)
    shouldThrow = false
    fireEvent.click(screen.getByText('errorBoundary.tryAgain'))
    expect(screen.getByText('recovered')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

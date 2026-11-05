import { describe, it, expect, beforeEach } from 'vitest'
import { confirmDialog, useConfirmStore } from '../confirm'

function head() {
  return useConfirmStore.getState().queue[0]
}

describe('confirmDialog', () => {
  beforeEach(() => {
    useConfirmStore.setState({ queue: [] })
  })

  it('enqueues a request and resolves true when confirmed', async () => {
    const result = confirmDialog({ message: 'Delete it?' })
    expect(head()?.options.message).toBe('Delete it?')

    useConfirmStore.getState().settle(head()!.id, true)

    await expect(result).resolves.toBe(true)
    expect(useConfirmStore.getState().queue).toHaveLength(0)
  })

  it('resolves false when cancelled', async () => {
    const result = confirmDialog({ message: 'Delete it?' })
    useConfirmStore.getState().settle(head()!.id, false)
    await expect(result).resolves.toBe(false)
  })

  it('shows concurrent requests one at a time, in order', async () => {
    const first = confirmDialog({ message: 'first' })
    const second = confirmDialog({ message: 'second' })

    expect(head()?.options.message).toBe('first')
    useConfirmStore.getState().settle(head()!.id, true)
    await expect(first).resolves.toBe(true)

    expect(head()?.options.message).toBe('second')
    useConfirmStore.getState().settle(head()!.id, false)
    await expect(second).resolves.toBe(false)
  })

  it('ignores settling an unknown or already-settled id', async () => {
    const result = confirmDialog({ message: 'once' })
    const { id } = head()!
    useConfirmStore.getState().settle(id, true)
    useConfirmStore.getState().settle(id, false)
    useConfirmStore.getState().settle('nope', false)
    await expect(result).resolves.toBe(true)
  })
})

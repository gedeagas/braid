/**
 * Tracks which paired mobile device most recently drove a terminal's PTY
 * viewport (a phone-fit `terminal.resize` / `terminal.setDisplayMode`, or a
 * `terminal.subscribe` that pre-fit the PTY).
 *
 * A terminal has a single shared PTY, so two phones with different screen sizes
 * cannot both be satisfied at once - whoever wins the size, the other must scale
 * to fit. Without arbitration both clients keep re-asserting their own fit when
 * they see a divergent `terminal.resized`, ping-ponging the PTY forever.
 *
 * The rule ("most-recent-actor's viewport wins"): the last device
 * to act owns the viewport; every other subscriber yields and CSS-scales. The
 * server already binds each connection to a device id at the E2EE handshake, so
 * it can tag each `terminal.resized` with whether the receiving device is the
 * current actor - no device identity needs to travel in the request payload.
 */
const actors = new Map<string, string>()

/** Record `deviceId` as the current viewport owner for `terminalId`. */
export function setMobileTerminalActor(terminalId: string, deviceId: string): void {
  actors.set(terminalId, deviceId)
}

export function getMobileTerminalActor(terminalId: string): string | undefined {
  return actors.get(terminalId)
}

/**
 * True when `deviceId` may drive the viewport: it is the current actor, or no
 * actor has claimed the terminal yet (so a lone device always owns its fit).
 */
export function isMobileTerminalActor(terminalId: string, deviceId: string): boolean {
  const actor = actors.get(terminalId)
  return !actor || actor === deviceId
}

/**
 * Release the floor. With no `deviceId` the actor is cleared unconditionally;
 * with one, only if that device currently holds it - so a yielding device
 * disconnecting never clears the active actor, while the actor leaving frees the
 * terminal for the next device to reclaim on its next fit.
 */
export function clearMobileTerminalActor(terminalId: string, deviceId?: string): void {
  if (deviceId && actors.get(terminalId) !== deviceId) return
  actors.delete(terminalId)
}

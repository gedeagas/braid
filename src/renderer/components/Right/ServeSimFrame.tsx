import { memo } from 'react'
import { SERVE_SIM_PARTITION } from '@shared/serve-sim'

interface ServeSimFrameProps {
  url: string
  title: string
}

/**
 * Embeds a serve-sim preview server (loopback only). serve-sim renders the
 * device bezel and handles touch, keyboard and hardware buttons itself, so
 * this replaces the mockup + canvas + DeviceToolbar used for mobilecli streams.
 */
export const ServeSimFrame = memo(function ServeSimFrame({ url, title }: ServeSimFrameProps) {
  return (
    <webview
      key={url}
      className="simulator-serve-sim-frame"
      title={title}
      src={url}
      partition={SERVE_SIM_PARTITION}
    />
  )
})

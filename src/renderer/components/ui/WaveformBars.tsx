type BarsSize = 'sm' | 'md' | 'lg'

interface WaveformBarsProps {
  size?: BarsSize
  className?: string
}

const sizeClass: Record<BarsSize, string> = {
  sm: 'waveform-bars waveform-bars--sm',
  md: 'waveform-bars waveform-bars--md',
  lg: 'waveform-bars waveform-bars--lg',
}

export function WaveformBars({ size = 'md', className }: WaveformBarsProps) {
  const classes = [sizeClass[size], className].filter(Boolean).join(' ')
  return (
    <span className={classes} role="status" aria-label="Loading">
      <span className="waveform-bars__bar" />
      <span className="waveform-bars__bar" />
      <span className="waveform-bars__bar" />
      <span className="waveform-bars__bar" />
    </span>
  )
}

import React from 'react'

interface Callout {
  /** X position as percentage (0-100) */
  x: number
  /** Y position as percentage (0-100) */
  y: number
  /** Callout number displayed in the circle */
  number: number
  /** Label shown in the legend below the image */
  label: string
}

interface AnnotatedImageProps {
  src: string
  alt: string
  callouts: Callout[]
}

export default function AnnotatedImage({ src, alt, callouts }: AnnotatedImageProps): React.JSX.Element {
  return (
    <div className="annotated-image-wrapper">
      <div className="annotated-image">
        <img src={src} alt={alt} loading="lazy" />
        {callouts.map((callout) => (
          <span
            key={callout.number}
            className="annotated-image__callout"
            style={{ left: `${callout.x}%`, top: `${callout.y}%` }}
          >
            {callout.number}
          </span>
        ))}
      </div>
      {callouts.length > 0 && (
        <ol className="annotated-image__legend">
          {callouts.map((callout) => (
            <li key={callout.number}>
              <span className="annotated-image__legend-number">{callout.number}</span>
              <span>{callout.label}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

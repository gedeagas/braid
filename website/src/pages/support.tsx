import React from 'react'
import Layout from '@theme/Layout'

export default function Support(): React.JSX.Element {
  return (
    <Layout
      title="Support"
      description="Get help with Braid and the Braid Mobile companion app"
    >
      <main className="legal-page">
        <div className="legal-container">
          <h1 className="legal-title">Support</h1>
          <p className="legal-intro">
            Need help with Braid or the Braid Mobile companion app? We're happy
            to help. Most questions are answered in our documentation, and you
            can always reach us by email or open an issue on GitHub.
          </p>

          <h2>Contact Us</h2>
          <p>
            For support, questions, bug reports, or feedback, email us and we'll
            get back to you as soon as we can:
          </p>
          <p className="legal-contact">
            <a href="mailto:support@getbraid.dev">support@getbraid.dev</a>
          </p>

          <h2>Braid Mobile</h2>
          <p>
            Braid Mobile is a companion app for the Braid desktop application.
            It pairs to your computer over your local network to let you monitor
            and drive your agent sessions from your phone or iPad.
          </p>
          <ul>
            <li>
              <strong>Getting started.</strong> Install the Braid desktop app,
              open the Mobile settings, and scan the pairing QR code with Braid
              Mobile. Both devices must be on the same local network.
            </li>
            <li>
              <strong>Can't find your desktop?</strong> Make sure the desktop
              app is running, both devices share the same Wi-Fi network, and
              your firewall allows local network discovery. You can also pair by
              entering your desktop's address manually.
            </li>
            <li>
              <strong>Privacy.</strong> Pairing is end-to-end encrypted and all
              communication stays on your local network. Your code and sessions
              are never sent to our servers.
            </li>
          </ul>

          <h2>Documentation</h2>
          <p>
            Our documentation covers installation, features, integrations, and
            troubleshooting:
          </p>
          <ul>
            <li>
              <a href="/docs/getting-started/installation">
                Getting Started &amp; Installation
              </a>
            </li>
            <li>
              <a href="/docs/features/projects-and-worktrees">Features</a>
            </li>
            <li>
              <a href="/changelog">Release Notes &amp; Changelog</a>
            </li>
          </ul>

          <h2>Report an Issue</h2>
          <p>
            Found a bug or want to request a feature? Open an issue on our public
            issue tracker:
          </p>
          <p className="legal-contact">
            <a
              href="https://github.com/gedeagas/braid/issues"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/gedeagas/braid/issues
            </a>
          </p>

          <h2>Privacy &amp; Terms</h2>
          <p>
            Read our <a href="/privacy">Privacy Policy</a> and{' '}
            <a href="/terms">Terms of Service</a> to understand how Braid
            handles your data.
          </p>
        </div>
      </main>
    </Layout>
  )
}

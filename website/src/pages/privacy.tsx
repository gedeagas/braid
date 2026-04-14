import React from 'react'
import Layout from '@theme/Layout'

export default function Privacy(): React.JSX.Element {
  return (
    <Layout title="Privacy Policy" description="Braid Privacy Policy">
      <main className="legal-page">
        <div className="legal-container">
          <p className="legal-updated">Last Updated: April 14, 2026</p>
          <h1 className="legal-title">Privacy Policy</h1>
          <p className="legal-intro">
            This Privacy Policy describes how Braid ("we", "us", or "our")
            handles information in connection with the Braid desktop application
            and the website located at{' '}
            <a href="https://gedeagas.github.io/braid/">
              gedeagas.github.io/braid
            </a>{' '}
            (collectively, the "Service"). Braid is developed and operated from
            Tokyo, Japan.
          </p>

          <div className="legal-lang-switch">
            <a href="/braid/privacy">English</a>
            <span className="legal-lang-divider">/</span>
            <a href="/braid/privacy-ja">日本語</a>
          </div>

          <h2>1. Local-First Architecture</h2>
          <p>
            Braid is a local-first desktop application. Your source code, chat
            history, session data, and configuration files are stored entirely on
            your local machine. We do not operate servers that receive, store, or
            process your code or conversation data.
          </p>

          <h2>2. Information We Collect</h2>

          <h3>2.1 Information You Provide</h3>
          <ul>
            <li>
              <strong>GitHub Account Data.</strong> If you connect your GitHub
              account via the <code>gh</code> CLI, Braid accesses repository
              metadata, pull request status, and check results through the
              GitHub API on your behalf. Credentials are managed by the{' '}
              <code>gh</code> CLI and are not stored by Braid.
            </li>
            <li>
              <strong>API Keys.</strong> You may configure API keys for
              Anthropic or other AI providers. These keys are stored locally in
              your system's configuration directory and are never transmitted to
              us.
            </li>
            <li>
              <strong>Support Communications.</strong> If you contact us for
              support or submit feedback, we may collect your name, email
              address, and the content of your communications.
            </li>
          </ul>

          <h3>2.2 Information Collected Automatically</h3>
          <ul>
            <li>
              <strong>Website Analytics.</strong> Our documentation website may
              use privacy-respecting analytics to collect aggregated, anonymous
              usage data such as page views, referral sources, and browser type.
              No personally identifiable information is collected through website
              analytics.
            </li>
            <li>
              <strong>Crash Reports.</strong> If you opt in to crash reporting,
              diagnostic data (stack traces, OS version, app version) may be
              sent to help us improve stability. Crash reports do not include
              your source code or chat history.
            </li>
          </ul>

          <h3>2.3 Information We Do Not Collect</h3>
          <p>We do not collect, access, or store:</p>
          <ul>
            <li>Your source code or repository contents</li>
            <li>AI chat sessions or conversation history</li>
            <li>File system contents or directory structures</li>
            <li>Terminal commands or output</li>
            <li>Git credentials or SSH keys</li>
          </ul>

          <h2>3. Third-Party Services</h2>
          <p>
            Braid integrates with third-party services that have their own
            privacy policies:
          </p>
          <ul>
            <li>
              <strong>Anthropic (Claude API).</strong> When you use AI agent
              sessions, your prompts and code context are sent directly from
              your machine to Anthropic's API. See{' '}
              <a
                href="https://www.anthropic.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
              >
                Anthropic's Privacy Policy
              </a>
              .
            </li>
            <li>
              <strong>GitHub.</strong> Repository operations use the GitHub API
              via the <code>gh</code> CLI. See{' '}
              <a
                href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub's Privacy Statement
              </a>
              .
            </li>
          </ul>
          <p>
            We are not responsible for the privacy practices of these
            third-party services.
          </p>

          <h2>4. How We Use Information</h2>
          <p>The limited information we collect is used to:</p>
          <ul>
            <li>Provide, maintain, and improve the Service</li>
            <li>Respond to support requests and feedback</li>
            <li>Diagnose and fix bugs (if crash reporting is enabled)</li>
            <li>
              Understand aggregate usage patterns on our documentation website
            </li>
          </ul>

          <h2>5. Data Sharing</h2>
          <p>
            We do not sell, rent, or share your personal information with third
            parties for their marketing purposes. We may share information only
            in the following circumstances:
          </p>
          <ul>
            <li>
              <strong>Legal Requirements.</strong> When required by applicable
              law, regulation, legal process, or enforceable governmental
              request under Japanese law.
            </li>
            <li>
              <strong>Safety.</strong> To protect the rights, property, or
              safety of Braid, our users, or the public as required or permitted
              by law.
            </li>
          </ul>

          <h2>6. Data Security</h2>
          <p>
            Because Braid operates locally on your machine, you maintain direct
            control over your data. We recommend following security best
            practices: keeping your operating system and Braid updated, using
            strong passwords, and enabling full-disk encryption.
          </p>

          <h2>7. Children's Privacy</h2>
          <p>
            The Service is not directed to children under the age of 16. We do
            not knowingly collect personal information from children. If you
            believe a child has provided us with personal information, please
            contact us so we can delete it.
          </p>

          <h2>8. No Server-Side Data Processing</h2>
          <p>
            Braid is a local-first desktop application. We do not operate
            servers that receive or process your data. All application data
            remains on your machine. The only data we may receive is
            information you voluntarily send through support emails, which is
            handled from Tokyo, Japan.
          </p>

          <h2>9. Your Rights</h2>
          <p>
            Under the Act on the Protection of Personal Information (APPI) and
            other applicable laws, you may have the right to:
          </p>
          <ul>
            <li>
              Request access to personal information we hold about you
            </li>
            <li>
              Request correction or deletion of your personal information
            </li>
            <li>Request that we cease using your personal information</li>
            <li>Withdraw consent where processing is based on consent</li>
          </ul>
          <p>
            To exercise these rights, please contact us using the information
            below.
          </p>

          <h2>10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify
            you of material changes by posting the updated policy on our website
            with a revised "Last Updated" date. Your continued use of the
            Service after any changes constitutes acceptance of the updated
            policy.
          </p>

          <h2>11. Contact</h2>
          <p>
            If you have questions about this Privacy Policy, please contact us
            at:
          </p>
          <p className="legal-contact">
            Braid
            <br />
            Tokyo, Japan
            <br />
            <a href="mailto:privacy@getbraid.dev">privacy@getbraid.dev</a>
          </p>
        </div>
      </main>
    </Layout>
  )
}

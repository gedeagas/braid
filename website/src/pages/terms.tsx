import React from 'react'
import Layout from '@theme/Layout'

export default function Terms(): React.JSX.Element {
  return (
    <Layout title="Terms of Service" description="Braid Terms of Service">
      <main className="legal-page">
        <div className="legal-container">
          <p className="legal-updated">Last Updated: April 14, 2026</p>
          <h1 className="legal-title">Terms of Service</h1>
          <p className="legal-intro">
            These Terms of Service ("Terms") govern your use of the Braid
            desktop application and the website located at{' '}
            <a href="https://gedeagas.github.io/braid/">
              gedeagas.github.io/braid
            </a>{' '}
            (collectively, the "Service"), provided by Braid ("we", "us", or
            "our"), operated from Tokyo, Japan. By downloading, installing, or
            using the Service, you agree to these Terms.
          </p>

          <div className="legal-lang-switch">
            <a href="/braid/terms">English</a>
            <span className="legal-lang-divider">/</span>
            <a href="/braid/terms-ja">日本語</a>
          </div>

          <h2>1. Acceptance of Terms</h2>
          <p>
            By accessing or using the Service, you confirm that you are at least
            16 years of age and agree to be bound by these Terms. If you are
            using the Service on behalf of an organization, you represent that
            you have the authority to bind that organization to these Terms.
          </p>

          <h2>2. Description of Service</h2>
          <p>
            Braid is an open-source desktop application for managing Git
            worktrees and running AI coding agent sessions. The Service operates
            locally on your machine. We do not host, process, or store your
            source code, chat history, or session data on our servers.
          </p>

          <h2>3. License</h2>
          <h3>3.1 Open-Source License</h3>
          <p>
            The Braid application is made available under an open-source
            license. The specific license terms are set forth in the{' '}
            <code>LICENSE</code> file included in the source repository. In the
            event of any conflict between these Terms and the open-source
            license, the open-source license governs with respect to the source
            code.
          </p>
          <h3>3.2 Restrictions</h3>
          <p>You agree not to:</p>
          <ul>
            <li>
              Use the Service for any unlawful purpose or in violation of any
              applicable law or regulation
            </li>
            <li>
              Misrepresent Braid's origin, authorship, or affiliation in any
              derivative work
            </li>
            <li>
              Use the Service to transmit malware, viruses, or other harmful
              code
            </li>
            <li>
              Attempt to interfere with the proper functioning of the Service
            </li>
          </ul>

          <h2>4. Your Data</h2>
          <h3>4.1 Ownership</h3>
          <p>
            You retain all rights, title, and interest in your source code, AI
            conversation history, configuration, and any other data processed
            by the Service on your local machine ("Your Data"). We claim no
            ownership over Your Data.
          </p>
          <h3>4.2 Local Processing</h3>
          <p>
            Your Data is processed and stored locally on your machine. We do
            not access, collect, or store Your Data. You are solely responsible
            for backing up Your Data.
          </p>
          <h3>4.3 AI Model Interactions</h3>
          <p>
            When you use AI agent sessions, your prompts and code context are
            sent directly from your machine to the AI provider (e.g.,
            Anthropic). These interactions are governed by the AI provider's
            terms of service and privacy policy. We are not a party to and bear
            no responsibility for those interactions.
          </p>
          <h3>4.4 AI Output</h3>
          <p>
            AI-generated code and content are provided "as is" without
            warranties of any kind. You are solely responsible for reviewing,
            testing, and validating any AI-generated output before use. We do
            not guarantee the accuracy, security, completeness, or fitness for
            any particular purpose of AI-generated content.
          </p>

          <h2>5. Third-Party Services</h2>
          <p>
            The Service integrates with third-party services including GitHub,
            Anthropic, and others. Your use of these services is subject to
            their respective terms and conditions. We are not responsible for
            the availability, accuracy, or practices of any third-party
            service.
          </p>

          <h2>6. Intellectual Property</h2>
          <p>
            The Braid name, logo, and branding are the property of Braid. Apart
            from rights granted under the open-source license, no other
            intellectual property rights are granted by these Terms.
          </p>

          <h2>7. Disclaimer of Warranties</h2>
          <p>
            THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT
            WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY,
            INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS
            FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND ACCURACY. WE DO
            NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR
            FREE OF HARMFUL COMPONENTS.
          </p>
          <p>
            YOU ACKNOWLEDGE THAT THE SERVICE INTERACTS WITH YOUR LOCAL FILE
            SYSTEM AND GIT REPOSITORIES. YOU ARE SOLELY RESPONSIBLE FOR
            MAINTAINING BACKUPS OF YOUR DATA.
          </p>

          <h2>8. Limitation of Liability</h2>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT
            SHALL BRAID, ITS CONTRIBUTORS, OR ITS LICENSORS BE LIABLE FOR ANY
            INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES,
            INCLUDING BUT NOT LIMITED TO LOSS OF DATA, LOSS OF PROFITS, OR
            BUSINESS INTERRUPTION, ARISING OUT OF OR IN CONNECTION WITH YOUR
            USE OF OR INABILITY TO USE THE SERVICE, EVEN IF ADVISED OF THE
            POSSIBILITY OF SUCH DAMAGES.
          </p>
          <p>
            OUR TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THESE
            TERMS SHALL NOT EXCEED THE AMOUNTS YOU HAVE PAID TO US IN THE
            TWELVE (12) MONTHS PRECEDING THE CLAIM, OR ONE THOUSAND JAPANESE
            YEN (JPY 1,000), WHICHEVER IS GREATER.
          </p>

          <h2>9. Indemnification</h2>
          <p>
            You agree to indemnify, defend, and hold harmless Braid and its
            contributors from and against any claims, liabilities, damages,
            losses, and expenses (including reasonable attorneys' fees) arising
            out of or relating to your use of the Service, your violation of
            these Terms, or your violation of any applicable law or
            third-party rights.
          </p>

          <h2>10. Termination</h2>
          <p>
            You may stop using the Service at any time by uninstalling the
            application. We reserve the right to modify, suspend, or
            discontinue the Service (or any part thereof) at any time without
            notice. Upon termination, all rights granted to you under these
            Terms will cease, except that the open-source license for the
            source code survives in accordance with its own terms.
          </p>

          <h2>11. Governing Law and Dispute Resolution</h2>
          <h3>11.1 Governing Law</h3>
          <p>
            These Terms are governed by and construed in accordance with the
            laws of Japan, without regard to conflict-of-law principles.
          </p>
          <h3>11.2 Jurisdiction</h3>
          <p>
            Any dispute arising out of or relating to these Terms shall be
            subject to the exclusive jurisdiction of the Tokyo District Court
            as the court of first instance.
          </p>
          <h3>11.3 Informal Resolution</h3>
          <p>
            Before filing any formal legal proceeding, you agree to first
            attempt to resolve the dispute informally by contacting us. We will
            attempt to resolve the dispute within thirty (30) days.
          </p>

          <h2>12. General Provisions</h2>
          <ul>
            <li>
              <strong>Entire Agreement.</strong> These Terms, together with the
              Privacy Policy and any applicable open-source license, constitute
              the entire agreement between you and Braid regarding the Service.
            </li>
            <li>
              <strong>Severability.</strong> If any provision of these Terms is
              found to be unenforceable, the remaining provisions will remain
              in full force and effect.
            </li>
            <li>
              <strong>Waiver.</strong> Failure to enforce any provision of these
              Terms does not constitute a waiver of that provision.
            </li>
            <li>
              <strong>Assignment.</strong> You may not assign your rights under
              these Terms without our prior written consent.
            </li>
            <li>
              <strong>Language.</strong> These Terms are provided in English and
              Japanese. In the event of any discrepancy, the Japanese version
              shall prevail for users located in Japan.
            </li>
          </ul>

          <h2>13. Changes to These Terms</h2>
          <p>
            We may update these Terms from time to time. We will notify you of
            material changes by posting the updated Terms on our website with a
            revised "Last Updated" date. Your continued use of the Service
            after any changes constitutes acceptance of the updated Terms.
          </p>

          <h2>14. Contact</h2>
          <p>
            If you have questions about these Terms, please contact us at:
          </p>
          <p className="legal-contact">
            Braid
            <br />
            Tokyo, Japan
            <br />
            <a href="mailto:legal@getbraid.dev">legal@getbraid.dev</a>
          </p>
        </div>
      </main>
    </Layout>
  )
}

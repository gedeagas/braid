import React from 'react'
import clsx from 'clsx'
import Link from '@docusaurus/Link'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import Layout from '@theme/Layout'
import FeatureCard from '../components/FeatureCard'

const features = [
  {
    icon: '\uD83C\uDF33',
    title: 'Git Worktrees',
    description:
      'Isolate features in parallel branches. Each worktree gets its own terminal, file tree, and Claude sessions.',
  },
  {
    icon: '\uD83E\uDD16',
    title: 'AI Agent Sessions',
    description:
      'Chat with Claude directly in your workspace. Multiple sessions per worktree, with full tool call visibility.',
  },
  {
    icon: '\uD83D\uDD00',
    title: 'Git & GitHub',
    description:
      'Stage, commit, push, and merge without leaving the app. PR checks, deployments, and merge controls built in.',
  },
  {
    icon: '\uD83D\uDCBB',
    title: 'Terminal & Editor',
    description:
      'Built-in terminals with lifecycle scripts. Monaco-powered editor for quick file edits alongside your chat.',
  },
  {
    icon: '\uD83D\uDCCB',
    title: 'Mission Control',
    description:
      'Kanban overview of all your sessions and PRs across every worktree. See what needs attention at a glance.',
  },
  {
    icon: '\uD83C\uDFA8',
    title: 'Themes & Customization',
    description:
      'Dark and light modes, custom themes, VSCode theme import. Configure models, prompts, and notifications.',
  },
]

function HeroSection(): React.JSX.Element {
  const { siteConfig } = useDocusaurusContext()

  return (
    <header className="hero-section">
      <h1 className="hero-title">{siteConfig.title}</h1>
      <p className="hero-subtitle">{siteConfig.tagline}</p>
      <div className="hero-buttons">
        <Link className="button button--primary button--lg" to="/docs/getting-started/installation">
          Get Started
        </Link>
        <Link
          className="button button--secondary button--lg"
          href="https://github.com/gedeagas/braid"
        >
          View on GitHub
        </Link>
      </div>
      <div className="hero-screenshot">
        <img
          src="/img/hero-screenshot.png"
          alt="Braid app screenshot showing the three-panel layout"
        />
      </div>
    </header>
  )
}

function FeaturesSection(): React.JSX.Element {
  return (
    <section className="features-section">
      <h2>Everything you need to ship</h2>
      <div className="features-grid">
        {features.map((feature) => (
          <FeatureCard key={feature.title} {...feature} />
        ))}
      </div>
    </section>
  )
}

export default function Home(): React.JSX.Element {
  const { siteConfig } = useDocusaurusContext()

  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <HeroSection />
      <main>
        <FeaturesSection />
      </main>
    </Layout>
  )
}

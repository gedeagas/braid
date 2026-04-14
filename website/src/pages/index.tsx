import React, { useState } from 'react'
import Link from '@docusaurus/Link'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import useBaseUrl from '@docusaurus/useBaseUrl'
import Layout from '@theme/Layout'
import FeatureCard from '../components/FeatureCard'
import DownloadDialog from '../components/DownloadDialog'
import WorkflowSection from '../components/WorkflowSection'
import {
  WorktreeIcon,
  AgentIcon,
  GitIcon,
  TerminalIcon,
  KanbanIcon,
  ThemeIcon,
} from '../components/icons/FeatureIcons'

const features = [
  {
    icon: <WorktreeIcon />,
    title: 'Git Worktrees',
    description:
      'Isolate features in parallel branches. Each worktree gets its own terminal, file tree, and AI sessions.',
  },
  {
    icon: <AgentIcon />,
    title: 'AI Agent Sessions',
    description:
      'Run AI coding agents directly in your workspace. Multiple sessions per worktree, with full tool call visibility.',
  },
  {
    icon: <GitIcon />,
    title: 'Git & GitHub',
    description:
      'Stage, commit, push, and merge without leaving the app. PR checks, deployments, and merge controls built in.',
  },
  {
    icon: <TerminalIcon />,
    title: 'Terminal & Editor',
    description:
      'Built-in terminals with lifecycle scripts. Monaco-powered editor for quick file edits alongside your chat.',
  },
  {
    icon: <KanbanIcon />,
    title: 'Mission Control',
    description:
      'Kanban overview of all your sessions and PRs across every worktree. See what needs attention at a glance.',
  },
  {
    icon: <ThemeIcon />,
    title: 'Themes & Customization',
    description:
      'Dark and light modes, custom themes, VSCode theme import. Configure models, prompts, and notifications.',
  },
]

function DownloadIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function HeroSection(): React.JSX.Element {
  const heroImg = useBaseUrl('/img/hero-screenshot.png')
  const [downloadOpen, setDownloadOpen] = useState(false)

  return (
    <header className="hero-section">
      <span className="hero-badge">v26.1.0 Now Available</span>
      <h1 className="hero-title">
        AI Coding Agents, <br />
        <span className="hero-title-muted">Parallelized.</span>
      </h1>
      <p className="hero-subtitle">
        Braid is the desktop workspace for developers who use AI coding agents
        as a core part of their workflow. Run multiple sessions in parallel,
        each scoped to its own Git worktree.
      </p>
      <div className="hero-buttons">
        <button
          className="button button--primary button--lg"
          onClick={() => setDownloadOpen(true)}
        >
          <DownloadIcon />
          Download for macOS
        </button>
        <Link
          className="button button--secondary button--lg"
          href="https://github.com/gedeagas/braid"
        >
          View on GitHub
        </Link>
      </div>
      <div className="hero-screenshot">
        <img
          src={heroImg}
          alt="Braid app screenshot showing the three-panel layout"
        />
      </div>
      <DownloadDialog
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
      />
    </header>
  )
}

function FeaturesSection(): React.JSX.Element {
  return (
    <div className="features-bg">
      <section className="features-section">
        <div className="features-section__header">
          <h2 className="features-section__title">
            Built for the AI-First Developer
          </h2>
          <p className="features-section__subtitle">
            Braid isn't just a wrapper. It's a purpose-built environment that
            understands your code and your workflow.
          </p>
        </div>
        <div className="features-grid">
          {features.map((feature) => (
            <FeatureCard key={feature.title} {...feature} />
          ))}
        </div>
      </section>
    </div>
  )
}

export default function Home(): React.JSX.Element {
  const { siteConfig } = useDocusaurusContext()

  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <HeroSection />
      <main>
        <FeaturesSection />
        <WorkflowSection />
      </main>
    </Layout>
  )
}

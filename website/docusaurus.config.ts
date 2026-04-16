import { themes as prismThemes } from 'prism-react-renderer'
import type { Config } from '@docusaurus/types'
import type * as Preset from '@docusaurus/preset-classic'

const config: Config = {
  title: 'Braid',
  tagline: 'Manage worktrees. Run AI agents. Ship from isolated branches.',
  favicon: 'img/favicon.ico',

  url: 'https://getbraid.dev',
  baseUrl: '/',

  organizationName: 'gedeagas',
  projectName: 'Braid',

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  headTags: [
    {
      tagName: 'meta',
      attributes: {
        name: 'keywords',
        content:
          'braid, git worktrees, ai coding agent, claude code, desktop ide, parallel development, multi-agent coding',
      },
    },
    {
      tagName: 'meta',
      attributes: {
        name: 'author',
        content: 'Braid',
      },
    },
    {
      tagName: 'script',
      attributes: {
        type: 'application/ld+json',
      },
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Braid',
        operatingSystem: 'macOS',
        applicationCategory: 'DeveloperApplication',
        description:
          'Desktop workspace for AI-first developers. Run multiple AI coding agent sessions in parallel, each scoped to its own Git worktree.',
        url: 'https://getbraid.dev',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
      }),
    },
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/gedeagas/braid/tree/main/website/',
        },
        blog: {
          routeBasePath: 'changelog',
          path: './changelog',
          blogTitle: 'Changelog',
          blogDescription: 'Braid release notes and changelog.',
          blogSidebarTitle: 'Releases',
          blogSidebarCount: 'ALL',
          showReadingTime: false,
          sortPosts: 'descending',
          feedOptions: {
            type: ['rss', 'atom'],
            title: 'Braid Changelog',
          },
        },
        sitemap: {
          changefreq: 'weekly' as const,
          priority: 0.5,
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/hero-screenshot.png',
    metadata: [
      { name: 'description', content: 'Braid is the desktop workspace for AI-first developers. Run multiple AI coding agent sessions in parallel, each scoped to its own Git worktree.' },
      { name: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],

    navbar: {
      title: 'Braid',
      logo: {
        alt: 'Braid Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/changelog',
          label: 'Changelog',
          position: 'left',
        },
        {
          href: 'https://github.com/gedeagas/braid',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },

    footer: {
      style: 'light',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Getting Started', to: '/docs/getting-started/installation' },
            { label: 'Features', to: '/docs/features/projects-and-worktrees' },
            { label: 'Keyboard Shortcuts', to: '/docs/reference/keyboard-shortcuts' },
            { label: 'Changelog', to: '/changelog' },
          ],
        },
        {
          title: 'Legal',
          items: [
            { label: 'Privacy Policy', to: '/privacy' },
            { label: 'Terms of Service', to: '/terms' },
            { label: 'プライバシーポリシー', to: '/privacy-ja' },
            { label: '利用規約', to: '/terms-ja' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'GitHub', href: 'https://github.com/gedeagas/braid' },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Braid`,
    },

    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: false,
    },

    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript'],
    },
  } satisfies Preset.ThemeConfig,
}

export default config

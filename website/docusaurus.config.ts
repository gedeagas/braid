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
          feedOptions: {
            type: ['rss', 'atom'],
            title: 'Braid Changelog',
          },
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/social-card.png',

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

# GitHub Pages deployment

Sokomind produces a static `dist/` directory and deploys it with
`.github/workflows/deploy-pages.yml`.

## One-time repository setting

Open **Settings > Pages** in the GitHub repository and choose **GitHub
Actions** as the source. The workflow creates and uses the standard
`github-pages` environment.

## Deployment flow

Every pull request, push to `main`, or manual workflow dispatch performs:

1. checkout;
2. Node setup and `npm ci`;
3. lint;
4. unit tests and production build;
5. static artifact tests;
6. Playwright and axe tests beneath `/Sokomind/`.

Pull requests stop there. Pushes to `main` and manual runs additionally upload
the Pages artifact and deploy through the `github-pages` environment. The
build job receives `contents: read`; Pages and OIDC write permissions exist
only on the deploy job.

Dependabot checks npm and GitHub Actions dependencies weekly.

## Path contract

`vite.config.ts` sets `base: "./"`. Scripts, styles, the favicon, and future
static media must therefore remain relative or be imported through Vite.

Use one of these patterns:

```ts
import soundUrl from "./sound.ogg";

const worker = new Worker(
  new URL("./solver.worker.ts", import.meta.url),
  { type: "module" },
);
```

For a file in `public/`, use a relative HTML path or
`import.meta.env.BASE_URL`. Do not hard-code `/assets/...`; that points at the
host root and breaks a project site mounted at `/Sokomind/`.

Puzzle and replay routes use the URL hash, so a `404.html` fallback remains
unnecessary.

## Public metadata

The default canonical URL is
`https://willpatpost.github.io/Sokomind/`. Set `VITE_PUBLIC_SITE_URL` during
the build when the repository is renamed or moved to a custom domain. Include
the final path; the build normalizes a missing trailing slash.

The production build disables public source maps and ships a 1200x630 social
image. The manifest and service worker use only relative, scope-safe paths.

## Service worker and asset precaching

`public/sw.js` uses an `asset-manifest.json` file to precache all hashed build
assets on install. The manifest is generated automatically by a `closeBundle`
plugin in `vite.config.ts` that lists every file Vite emits into `dist/assets/`.
On the `install` event, the worker fetches the manifest, opens the v2 cache,
and adds every listed asset. This replaces the earlier approach of
hard-coding asset paths. The `fetch` handler serves cached assets and falls
back to the network, so the PWA shell remains an enhancement that cannot block
the online game.

## Local production check

```sh
npm run build
npm run test:static
npm run test:browser
npm run preview:pages
```

Do not commit `dist/`. GitHub Actions builds from the committed lockfile and
uploads the artifact directly.

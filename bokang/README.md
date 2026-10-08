# 泊康项目管理系统

Based on Plane CE v1.4.2, upstream commit 5f7d92784c403f76284f0f16718f320221dc7fec.
This fork preserves upstream AGPL-3.0-only licensing and copyright notices.

## Scope

Chinese login and navigation, Bokang branding/icons/titles/PWA metadata, internal help,
removal of GitHub stars, Community/upgrade badges and external promotional help.
The backend API, database schema, permissions and project behavior stay upstream.
Production uses managed local accounts, password login and administrator recovery without SMTP.

## Build

Node >=22.18, pnpm 11.3.0. Dependencies are pinned by the upstream lockfile.

```sh
pnpm install --filter 'web...' --filter 'admin...' --filter 'space...' --frozen-lockfile
pnpm exec turbo run build --filter=web --filter=admin --filter=space
```

`apps/{web,admin,space}/build/client` are the static production artifacts.
Package each into the matching upstream v1.4.2 frontend image using `Dockerfile.runtime`.
Only three frontend images need to be replaced. Preserve production volumes.
The original image tags and compose file are retained on the server for rollback.

`/open-source.html` offers corresponding source and the full AGPL license.
`/bokang-help.html` describes the department's workflow and account recovery.
Do not commit production credentials, account handoffs, database dumps or API keys.

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
./bokang/build-frontends.sh
```

Web uses `apps/web/build/client` at `/usr/share/nginx/html`. Admin uses
`apps/admin/build/client` at `/usr/share/nginx/html/god-mode` (ASSET_PATH build arg, HEALTHCHECK_PATH=/god-mode/).
Package these with `Dockerfile.runtime`. Space serves SSR through Node and uses
all of `apps/space/build`, copied to `/app/apps/space/build` by `Dockerfile.space-runtime`.
The build script sets the same API/admin/space/live base paths as upstream Dockerfiles.
Only three frontend images need to be replaced. Preserve production volumes.
The original image tags and compose file are retained on the server for rollback.

`/open-source.html` offers corresponding source and the full AGPL license.
`/bokang-help.html` describes the department's workflow and account recovery.
Do not commit production credentials, account handoffs, database dumps or API keys.

## Daily UI Chinese localization

Common project/view/filter controls, state-group and priority labels, activity text,
Chinese dates and Gantt calendar labels are maintained in this Chinese-first fork.
Shared constants/utils/UI packages are rebuilt before the three frontend apps.
Existing default project state names are renamed through server maintenance while
preserving UUIDs and task associations; this is separate from frontend deployment.
Custom state names are preserved. Administrator screens are outside this scope.

## AI Strategy workspace URL

Production workspace slug: `ai-strategy`, display name: AI战略部.
Workspace UUID, membership, projects, tasks and API keys are unchanged.
`bokang/Caddyfile` redirects old browser URLs and rewrites old workspace API
paths for compatibility. Mount it read-only at `/etc/caddy/Caddyfile` in proxy.
New integrations should use `/api/v1/workspaces/ai-strategy/`.
Separate departments can use separate workspaces; cross-workspace reporting
requires API aggregation rather than the current workspace views.

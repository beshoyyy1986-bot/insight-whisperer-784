<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Base44 dev environment
- Run: `docker compose -f docker-compose.base44.yml up -d`. The single `web` service runs `vite dev` (TanStack Start SSR + server functions) inside the Playwright image so server-side Chromium works (`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`). Its version must match the `playwright` npm version (1.63.0).
- node_modules lives in a named volume, and `npm ci` runs on every start. Use npm, not bun: the Dockerfile uses package-lock.json.
- Meta OAuth (`META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`, `META_SESSION_SECRET`) is optional. Without it the UI shows a hint and the cookie/Playwright flow still works. The secrets come from `/run/base44/app.env`.
- Don't add plugins to vite.config.ts: `@lovable.dev/vite-tanstack-config` already includes them. Tests are in `tests/`.
- Check it works: `curl localhost:3000/` returns 200 with the Arabic "JAMAIKA Meta Ads Pro" dashboard.

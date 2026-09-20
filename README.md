# Smart Extractor

https://github.com/beshoyyy1986-bot/s-experiment.git
شغله و اتاكد ان الاداة بتعرف تستخرج المطلوب من المدخلات باحترافية شديدة

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://smart-insight-extractor.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/11d9327a-b0cc-419a-a1ca-cbce88f51b4c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Deploy on Railway

The repository includes a Railway `Dockerfile` based on Playwright's official
Chromium image. Railway builds and starts the app automatically; no custom
build or start command is required.

Configure these Railway variables before enabling Meta OAuth:

```text
META_APP_ID=your-meta-app-id
META_APP_SECRET=your-meta-app-secret
META_REDIRECT_URI=https://YOUR_RAILWAY_DOMAIN/auth/meta/callback
META_SESSION_SECRET=a-random-secret-with-at-least-32-characters
```

Add the same `META_REDIRECT_URI` value to the Meta app's **Valid OAuth Redirect
URIs**. The cookie/Playwright flow works without Meta app variables. It runs in
an ephemeral browser context, never writes cookies to disk, and closes the
context after each discovery request.

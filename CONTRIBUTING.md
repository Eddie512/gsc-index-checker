# Contributing

Thanks for your interest in contributing to GSC Index Checker!

## Getting Started

1. Fork and clone the repo
2. `cd worker && npm install`
3. Copy `wrangler.toml.example` to `wrangler.toml` and fill in your D1 database ID
4. Run tests: `npm test`

## Development

The project runs on Cloudflare Workers with Hono and D1. Key entry points:

- `src/index.tsx` — Routes and cron handlers
- `src/db.ts` — All D1 database queries
- `src/components/` — JSX page components
- `test/` — Vitest tests using Cloudflare Workers pool

### Running locally

```bash
npx wrangler dev
```

### Running tests

```bash
npm test
```

## Pull Requests

- Keep PRs focused on a single change
- Add tests for new database queries or API behavior
- Make sure `npm test` passes before submitting
- Update the README if you're changing setup steps or adding features

## Reporting Issues

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce (if applicable)
- Your Wrangler version (`npx wrangler --version`)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

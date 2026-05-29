# context-limits

Cloudflare Worker for fleet context management — part of the Cocapn Fleet context processing pipeline.

## What This Gives You

- **Edge-deployed** — runs on Cloudflare Workers at the network edge
- **KV-backed state** — persistent storage for context data
- **Fleet-native** — exposes `/vessel.json` for automatic discovery
- **Zero external dependencies** — no third-party API calls

## Quick Start

```bash
wrangler deploy

# Health check
curl https://context-limits.<your-subdomain>.workers.dev/health
```

## How It Fits

A Cocapn Fleet vessel in the context processing pipeline. Part of the SuperInstance ecosystem.

Related repos:
- [context-compactor](https://github.com/SuperInstance/context-compactor) — text compression
- [context-compactor-v2](https://github.com/SuperInstance/context-compactor-v2) — next-gen compression
- [cocapn-shells](https://github.com/SuperInstance/cocapn-shells) — fleet shell infrastructure

## License

Apache 2.0

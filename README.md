# Tri-Market API

Stock portfolio manual trade API deployed on Vercel Edge Functions.

## Endpoints

- `POST /api/manual-sell` - Manual sell
- `POST /api/manual-add` - Manual add (increase position)
- `POST /api/manual-reduce` - Manual reduce (decrease position)
- `POST /api/delist` - Remove from post-sell watchlist

## Environment Variables

- `GITHUB_TOKEN` - GitHub personal access token

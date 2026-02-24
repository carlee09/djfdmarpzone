#!/bin/bash
# Cloudflare Workers에 환경변수(시크릿) 등록

set -e
cd "$(dirname "$0")/../worker"

source ../.env

echo "Setting Cloudflare Worker secrets..."

echo "$SUPABASE_URL"       | wrangler secret put SUPABASE_URL
echo "$SUPABASE_ANON_KEY"  | wrangler secret put SUPABASE_ANON_KEY
echo "$GEMINI_API_KEY"     | wrangler secret put GEMINI_API_KEY
echo "$SELA_API_KEY"       | wrangler secret put SELA_API_KEY
echo "$SELA_API_URL"       | wrangler secret put SELA_API_URL

echo "All secrets set successfully!"

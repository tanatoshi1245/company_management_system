#!/usr/bin/env bash
# BigQuery サービスアカウント鍵を Cloudflare Worker のシークレットに登録する。
# 事前に: claude_analysis で python3 02_データエンジニアリング/scripts/fetch-bq-credentials.py を実行し /tmp/bq-key.json を生成、wrangler login 済みであること。
set -euo pipefail
KEY="${1:-/tmp/bq-key.json}"
[ -f "$KEY" ] || { echo "鍵ファイルがありません: $KEY" >&2; exit 1; }
python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))))' "$KEY" | npx wrangler secret put BQ_SA_KEY
echo "BQ_SA_KEY を登録しました。BQ_MOCK は wrangler.jsonc の vars で 0 になっていることを確認してください。"

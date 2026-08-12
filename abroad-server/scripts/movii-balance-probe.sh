#!/usr/bin/env bash
#
# Calls BTB CO GET BALANCE PASSWORD SUBSCRIBER exactly the way BrebPaymentService
# does, and prints the response body. The spec never names the field inside
# `data`, so this is how we learn the real shape.
#
# Reads every value from Secret Manager. Credentials and the bearer token are
# never printed — only the HTTP status and the response body.
#
# Usage:
#   ./movii-balance-probe.sh [--project PROJECT_ID] [--account SA_EMAIL]

set -euo pipefail
set +x

readonly API_PATH='/core/co/btb-balance-password-subscriber/get-balance'

PROJECT_ID="${PROJECT_ID:-}"
GCLOUD_ACCOUNT="${ABROAD_GCP_SA:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT_ID="${2:-}"; shift 2 ;;
    --account) GCLOUD_ACCOUNT="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Pin the identity explicitly so a session never reads secrets as whichever
# human account happens to be active in the gcloud profile.
gcloud_args=()
[[ -n "$GCLOUD_ACCOUNT" ]] && gcloud_args+=(--account "$GCLOUD_ACCOUNT")

command -v gcloud >/dev/null 2>&1 || { echo "gcloud is not installed." >&2; exit 1; }
command -v curl   >/dev/null 2>&1 || { echo "curl is not installed." >&2; exit 1; }

if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
fi
if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "(unset)" ]]; then
  echo "No project. Pass --project or run: gcloud config set project PROJECT_ID" >&2
  exit 1
fi

if ! gcloud auth print-access-token >/dev/null 2>&1; then
  echo "gcloud credentials are stale. Run: gcloud auth login" >&2
  exit 1
fi

fetch_secret() {
  local name="$1"
  if ! gcloud secrets versions access latest --secret "$name" \
       --project "$PROJECT_ID" "${gcloud_args[@]+"${gcloud_args[@]}"}" 2>/dev/null; then
    echo "Could not read secret $name from project $PROJECT_ID." >&2
    echo "Run scripts/movii-balance-secrets.sh first." >&2
    exit 1
  fi
}

echo "Project: $PROJECT_ID"
echo "Reading secrets..."
BASE_URL="$(fetch_secret MOVII_BALANCE_API_BASE_URL)"
AUTH_URL="$(fetch_secret MOVII_BALANCE_AUTH_URL)"
CLIENT_ID="$(fetch_secret MOVII_BALANCE_CLIENT_ID)"
CLIENT_SECRET="$(fetch_secret MOVII_BALANCE_CLIENT_SECRET)"

# Optional: Movii may not have issued the static subscriber credential yet.
# Without it we still probe, so the endpoint's own error tells us whether it is
# genuinely required and in what form.
MOVII_AUTH="$(gcloud secrets versions access latest --secret MOVII_BALANCE_AUTHORIZATION \
  --project "$PROJECT_ID" "${gcloud_args[@]+"${gcloud_args[@]}"}" 2>/dev/null || true)"
if [[ -n "$MOVII_AUTH" ]]; then
  echo "  MOVII_BALANCE_AUTHORIZATION: present"
else
  echo "  MOVII_BALANCE_AUTHORIZATION: NOT SET — probing without it"
fi

BASE_URL="${BASE_URL%/}"
# The API-manager gateway publishes its own route, which is not the internal
# path in the spec. If the stored URL already names the operation, it is the
# whole endpoint; only bare origins get the documented path appended.
if [[ "$BASE_URL" == */get-balance ]]; then
  ENDPOINT="$BASE_URL"
  echo "  base URL is a full endpoint; not appending $API_PATH"
else
  ENDPOINT="${BASE_URL}${API_PATH}"
fi

# 16-digit numeric correlation id, matching the width in Movii's own example.
CORRELATION_ID="$(printf '%08d%08d' "$((RANDOM * RANDOM % 100000000))" "$((RANDOM * RANDOM % 100000000))")"

echo
echo "== 1. OAuth2 client_credentials =="
echo "POST $AUTH_URL"
TOKEN_BODY="$(curl -sS -X POST "$AUTH_URL" \
  -u "${CLIENT_ID}:${CLIENT_SECRET}" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=client_credentials' \
  --max-time 20 || true)"

ACCESS_TOKEN="$(printf '%s' "$TOKEN_BODY" | python3 -c '
import json,sys
try:
    print(json.load(sys.stdin).get("access_token",""))
except Exception:
    print("")
')"

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "Failed to obtain an access token." >&2
  # The token endpoint returns no balance data, so echoing its error is safe —
  # but strip anything token-shaped in case it partially succeeded.
  printf '%s\n' "$TOKEN_BODY" | python3 -c '
import json,sys
raw=sys.stdin.read()
try:
    d=json.load(__import__("io").StringIO(raw))
    for k in ("access_token","refresh_token","id_token"):
        if k in d: d[k]="<redacted>"
    print(json.dumps(d,indent=2))
except Exception:
    print(raw[:2000])
' >&2
  exit 1
fi
echo "  token acquired (${#ACCESS_TOKEN} chars), not printed"

echo
echo "== 2. GET balance =="
echo "GET $ENDPOINT"
echo

# Each variant is a header shape worth ruling in or out. Header *names* are
# printed, values never are.
try_variant() {
  local label="$1"; shift
  local -a headers=("$@")
  local -a curl_args=()
  local name

  for h in "${headers[@]}"; do
    curl_args+=(-H "$h")
    name="${h%%:*}"
    printf -v name '%s' "$name"
  done

  echo "--- variant: $label"
  printf '    headers:'
  for h in "${headers[@]}"; do printf ' %s' "${h%%:*}"; done
  echo

  local response status body
  response="$(curl -sS -w '\n__HTTP_STATUS__:%{http_code}' -X GET "$ENDPOINT" \
    "${curl_args[@]}" -H "correlationid: ${CORRELATION_ID}" --max-time 30 2>&1 || true)"
  status="${response##*__HTTP_STATUS__:}"
  body="${response%$'\n'__HTTP_STATUS__:*}"

  echo "    HTTP ${status}"
  printf '%s\n' "$body" | python3 -c '
import json,sys
raw=sys.stdin.read()
try:
    print("    body: " + json.dumps(json.loads(raw), ensure_ascii=False))
except Exception:
    print("    body: " + raw[:1500].replace("\n"," "))
'
  # Surface the data shape whenever the call actually returned one.
  printf '%s\n' "$body" | python3 -c '
import json,sys
try:
    d=json.loads(sys.stdin.read()).get("data")
except Exception:
    raise SystemExit
if isinstance(d,list) and d: d=d[0]
if isinstance(d,dict):
    print("    KEYS UNDER data:")
    for k,v in d.items():
        print(f"      {k}: {type(v).__name__} = {v!r}")
elif d is not None:
    print(f"    data is {type(d).__name__}: {d!r}")
'
  echo
}

if [[ -n "$MOVII_AUTH" ]]; then
  try_variant "spec headers (bearer + static credential)" \
    "authorizationApi: Bearer ${ACCESS_TOKEN}" \
    "authorization: ${MOVII_AUTH}" \
    "Content-Type: text/plain"
else
  # No static credential issued yet: establish whether the bearer alone is
  # accepted, and if not, what the endpoint says is missing.
  try_variant "bearer in authorizationApi, no static credential" \
    "authorizationApi: Bearer ${ACCESS_TOKEN}" \
    "Content-Type: text/plain"

  try_variant "bearer in authorization" \
    "authorization: Bearer ${ACCESS_TOKEN}" \
    "Content-Type: text/plain"

  try_variant "bearer in both headers" \
    "authorizationApi: Bearer ${ACCESS_TOKEN}" \
    "authorization: Bearer ${ACCESS_TOKEN}" \
    "Content-Type: text/plain"
fi

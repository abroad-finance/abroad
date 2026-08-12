#!/usr/bin/env bash
#
# Provisions the Secret Manager values that the BTB CO GET BALANCE PASSWORD
# SUBSCRIBER integration needs (replaces the retired traguatan gateway).
#
#   MOVII_BALANCE_API_BASE_URL    full endpoint URL, or a bare origin
#   MOVII_BALANCE_AUTH_URL        full /oauth2/token URL for the BTB OAuth client
#   MOVII_BALANCE_CLIENT_ID       BTB OAuth client id
#   MOVII_BALANCE_CLIENT_SECRET   BTB OAuth client secret
#   MOVII_BALANCE_AUTHORIZATION   the "<base64>==:<base64>==" credential Movii issues
#
# BTB is a separate Movii product from Bre-B payments and has its own OAuth
# client, so none of the BREB_* secrets are reused here.
#
# Values are read from your terminal (hidden) or from same-named environment
# variables. They are piped straight to gcloud and never echoed, logged, or
# written to disk.
#
# By default it asks ONLY for values that are not stored yet, so adding one
# missing credential does not walk you through the four you already set.
#
# Usage:
#   ./movii-balance-secrets.sh --project abroad-452212
#       prompt only for values that are still missing
#
#   ./movii-balance-secrets.sh --project abroad-452212 MOVII_BALANCE_AUTHORIZATION
#       set exactly this one, even if it already has a value (use to rotate)
#
#   ./movii-balance-secrets.sh --project abroad-452212 --all
#       prompt for every value
#
#   --service-account SA_EMAIL    also grant secretAccessor on what it writes
#   MOVII_BALANCE_CLIENT_ID=...   take that value from the environment instead
#
# Rerunning is safe: each run adds a new version, and any value you skip by
# pressing Enter is left untouched.

set -euo pipefail

# Never let this run under xtrace: the secret values pass through this shell.
set +x

readonly API_PATH='/core/co/btb-balance-password-subscriber/get-balance'
readonly SECRET_NAMES=(
  MOVII_BALANCE_API_BASE_URL
  MOVII_BALANCE_AUTH_URL
  MOVII_BALANCE_CLIENT_ID
  MOVII_BALANCE_CLIENT_SECRET
  MOVII_BALANCE_AUTHORIZATION
)

PROJECT_ID="${PROJECT_ID:-}"
SERVICE_ACCOUNT=""
PROMPT_ALL=false
REQUESTED=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT_ID="${2:-}"; shift 2 ;;
    --service-account)
      SERVICE_ACCOUNT="${2:-}"; shift 2 ;;
    --all)
      PROMPT_ALL=true; shift ;;
    -h|--help)
      sed -n '2,30p' "$0"; exit 0 ;;
    -*)
      echo "Unknown option: $1" >&2; exit 2 ;;
    *)
      # A bare argument names one secret to set, so you can replace a single
      # value without being walked through the others.
      matched=false
      for known in "${SECRET_NAMES[@]}"; do
        [[ "$1" == "$known" ]] && matched=true && break
      done
      if [[ "$matched" != true ]]; then
        echo "Unknown secret: $1" >&2
        printf 'Valid names: %s\n' "${SECRET_NAMES[*]}" >&2
        exit 2
      fi
      REQUESTED+=("$1"); shift ;;
  esac
done

command -v gcloud >/dev/null 2>&1 || { echo "gcloud is not installed." >&2; exit 1; }

if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
fi
if [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "(unset)" ]]; then
  echo "No project. Pass --project or run: gcloud config set project PROJECT_ID" >&2
  exit 1
fi

# Fail early with a readable message instead of once per gcloud call.
if ! gcloud auth print-access-token >/dev/null 2>&1; then
  echo "gcloud credentials are stale. Run: gcloud auth login" >&2
  exit 1
fi

echo "Project: $PROJECT_ID"
echo

has_version() {
  local count
  count="$(gcloud secrets versions list "$1" --project "$PROJECT_ID" \
    --format='value(name)' 2>/dev/null | wc -l | tr -d ' ')"
  [[ "${count:-0}" -gt 0 ]]
}

# Work out what to ask for. Default: only values that are not stored yet, so a
# rerun to add one missing credential does not walk through the others.
TARGETS=()
if [[ ${#REQUESTED[@]} -gt 0 ]]; then
  TARGETS=("${REQUESTED[@]}")
  echo "Setting only: ${TARGETS[*]}"
elif [[ "$PROMPT_ALL" == true ]]; then
  TARGETS=("${SECRET_NAMES[@]}")
  echo "Setting all values (--all)."
else
  echo "Checking what is already stored..."
  for name in "${SECRET_NAMES[@]}"; do
    if has_version "$name"; then
      echo "  $name: already set, skipping"
    else
      echo "  $name: missing"
      TARGETS+=("$name")
    fi
  done
fi
echo

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  cat <<EOF
Nothing to do — every value is already stored.

To replace one, name it explicitly:
  $0 --project $PROJECT_ID MOVII_BALANCE_AUTHORIZATION
EOF
  exit 0
fi

# Reads a secret value into the named variable: environment first, then a
# hidden prompt. Returns non-zero if nothing was supplied.
#
# Every local is __-prefixed: the caller passes the *name* of its own variable,
# and a plain name like `value` here would shadow the caller's, so `printf -v`
# would assign to the local and the caller would silently keep an empty string.
read_value() {
  local __name="$1" __out="$2" __value=""

  if [[ "$__out" == __* ]]; then
    echo "    internal error: output variable may not start with __" >&2
    return 1
  fi

  if [[ -n "${!__name:-}" ]]; then
    __value="${!__name}"
    echo "  $__name: taken from environment"
  else
    read -rsp "  $__name: " __value </dev/tty
    echo
  fi

  [[ -n "$__value" ]] || { echo "    empty value, skipping $__name" >&2; return 1; }
  printf -v "$__out" '%s' "$__value"
}

# Cheap shape checks so a bad paste fails here rather than in production.
# Only ever reports *about* the value; never prints it.
validate_value() {
  local name="$1" value="$2"

  case "$name" in
    MOVII_BALANCE_API_BASE_URL)
      if [[ "$value" != http://* && "$value" != https://* ]]; then
        echo "    ! must start with http:// or https://" >&2; return 1
      fi
      # Either form is accepted: Movii's API gateway publishes its own
      # deployment path, so a full endpoint URL is used verbatim, while a bare
      # origin gets the spec's internal route appended.
      if [[ "${value%/}" == */get-balance ]]; then
        echo "    reads as a full endpoint URL; used verbatim"
      else
        echo "    reads as an origin; the service will append $API_PATH"
      fi
      ;;
    MOVII_BALANCE_AUTH_URL)
      if [[ "$value" != http://* && "$value" != https://* ]]; then
        echo "    ! must start with http:// or https://" >&2; return 1
      fi
      if [[ "$value" != *token* ]]; then
        echo "    note: expected the full token URL, e.g. https://host/oauth2/token"
      fi
      ;;
    MOVII_BALANCE_AUTHORIZATION)
      if [[ "$value" == Bearer\ * || "$value" == Basic\ * ]]; then
        echo "    ! store the bare credential, without an auth scheme prefix" >&2; return 1
      fi
      if [[ "$value" =~ [[:space:]] ]]; then
        echo "    ! contains a space or line break — the email client likely mangled it" >&2
        echo "      copy it from a plain-text view and try again" >&2
        return 1
      fi
      # Movii documents '<base64>==:<base64>==' but may hand over that pair
      # encoded once more as a single blob. Accept either; reject anything that
      # is neither, so a corrupted paste fails here instead of in production.
      if command -v python3 >/dev/null 2>&1; then
        if ! printf '%s' "$value" | python3 -c '
import sys, base64, re
v = sys.stdin.read().strip()
def ok(s):
    if not s or re.search(r"[^A-Za-z0-9+/=]", s):
        return False
    try:
        base64.b64decode(s, validate=True)
        return True
    except Exception:
        return False
parts = v.split(":")
valid = (len(parts) == 2 and all(ok(p) for p in parts)) or (len(parts) == 1 and ok(v))
sys.exit(0 if valid else 1)
'; then
          echo "    ! not valid base64" >&2
          echo "      expected '<base64>:<base64>' or a single base64 blob;" >&2
          echo "      a length that is not a multiple of 4 means characters were lost in transit" >&2
          return 1
        fi
        echo "    base64 shape OK"
      fi
      ;;
  esac
  return 0
}

write_secret() {
  local name="$1" value="$2"

  # Last line of defence. An empty secret typechecks fine and then fails every
  # balance read in production, so never let one through regardless of how the
  # caller got here.
  if [[ -z "$value" ]]; then
    echo "    refusing to write an empty value to $name" >&2
    return 1
  fi

  if ! gcloud secrets describe "$name" --project "$PROJECT_ID" >/dev/null 2>&1; then
    gcloud secrets create "$name" \
      --project "$PROJECT_ID" \
      --replication-policy=automatic \
      --labels=component=movii-balance >/dev/null
    echo "    created secret"
  fi

  printf '%s' "$value" \
    | gcloud secrets versions add "$name" --project "$PROJECT_ID" --data-file=- >/dev/null

  # Read back and compare lengths only — proves the write landed intact without
  # putting the value on screen.
  local stored_len
  stored_len="$(gcloud secrets versions access latest --secret "$name" --project "$PROJECT_ID" 2>/dev/null | wc -c | tr -d ' ')"
  if [[ "$stored_len" == "${#value}" ]]; then
    echo "    added new version (${#value} chars, verified)"
  else
    echo "    ! wrote $name but read back $stored_len chars, expected ${#value}" >&2
    return 1
  fi

  if [[ -n "$SERVICE_ACCOUNT" ]]; then
    gcloud secrets add-iam-policy-binding "$name" \
      --project "$PROJECT_ID" \
      --member "serviceAccount:$SERVICE_ACCOUNT" \
      --role roles/secretmanager.secretAccessor >/dev/null
    echo "    granted accessor to $SERVICE_ACCOUNT"
  fi
}

if [[ ${#TARGETS[@]} -eq 1 ]]; then
  echo "Enter the value below (input is hidden):"
else
  echo "Enter each value (input is hidden; press Enter to skip one):"
fi
written=0
for name in "${TARGETS[@]}"; do
  value=""
  read_value "$name" value || continue
  validate_value "$name" "$value" || { echo "    not written." >&2; continue; }
  write_secret "$name" "$value"
  written=$((written + 1))
  unset value
done

echo
if [[ "$written" -eq ${#TARGETS[@]} ]]; then
  echo "Done — wrote $written of ${#TARGETS[@]}."
  echo
  echo "Then have the probe confirm the live response shape:"
  echo "  ./movii-balance-probe.sh --project $PROJECT_ID"
else
  echo "Wrote $written of ${#TARGETS[@]} — rerun for the rest." >&2
fi

cat <<'EOF'

The old gateway's secrets are no longer read by any code path:

  MOVII_BALANCE_API_KEY
  MOVII_BALANCE_ACCOUNT_ID

They are left in place on purpose — deleting a secret is irreversible, and a
rollback to the previous release still needs them. Remove them only once this
release is confirmed stable:

  gcloud secrets delete MOVII_BALANCE_API_KEY --project PROJECT_ID
  gcloud secrets delete MOVII_BALANCE_ACCOUNT_ID --project PROJECT_ID
EOF

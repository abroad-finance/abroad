#!/usr/bin/env bash
# Records the confidential deposit demo, driving the terminal at readable pace.
#
# screencapture records the WHOLE DESKTOP. Before running: close anything with
# credentials, secrets or customer data, and turn on Do Not Disturb. Nothing in
# this script can detect what ended up in frame — review the file before sharing.
#
#   ./record-demo.sh [output.mov]
#
# Requires Screen Recording permission for the terminal app in
# System Settings → Privacy & Security → Screen Recording.
set -euo pipefail

OUT="${1:-$HOME/Desktop/confidential-deposit-demo.mov}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SERVER="$HERE/../../abroad-server"
CLIENT="$HERE/../client"
LAB="${CONFIDENTIAL_LAB:-$HOME/Documents/GitHub/abroad-git/confidential-lab}"
DB="postgresql://postgres:postgres@localhost:5432/postgres?schema=public"
TX="${DEMO_TRANSACTION_ID:-3f2b1a90-8c4d-4e21-9b77-5a1c2d3e4f50}"

# Beats are held long enough to read on playback. Trim in the edit, not here —
# a cut is cheap and a beat that flashed past is unrecoverable.
beat() { printf '\n\033[1;36m▸ %s\033[0m\n\n' "$1"; sleep "${2:-4}"; }

command -v screencapture >/dev/null || { echo "screencapture not found"; exit 1; }

echo "Recording the whole desktop to $OUT"
echo "Close anything sensitive, then press return."
read -r

screencapture -v -V 600 "$OUT" &
CAPTURE=$!
trap 'kill -INT "$CAPTURE" 2>/dev/null || true' EXIT
sleep 3

beat "The problem: today every Stellar deposit amount is public on Horizon." 6

beat "The transaction, before anything is paid." 2
( cd "$SERVER" && DATABASE_URL="$DB" npx tsx "$HERE/status.ts" )
sleep 4

beat "Sending a confidential transfer on Stellar testnet. The amount is hidden." 4
( cd "$CLIENT" \
  && SECRET="$(STELLAR_CONFIG_HOME="$LAB/stellar-config" stellar keys show payer)" \
     npx tsx src/submit.ts \
       "${CONFIDENTIAL_WRAPPER:?set CONFIDENTIAL_WRAPPER}" \
       "${PAYER_ADDRESS:?set PAYER_ADDRESS}" \
       "${ABROAD_ADDRESS:?set ABROAD_ADDRESS}" \
       "$LAB/tx_demo.hex" "$TX" )
sleep 6

beat "The listener finds it, verifies the amount against the on-chain commitment." 10

beat "The rail takes over." 2
for _ in 1 2 3 4 5 6; do
  ( cd "$SERVER" && DATABASE_URL="$DB" npx tsx "$HERE/status.ts" )
  echo
  sleep 12
done

beat "Hidden on chain. Verified against the commitment. Settled as BRL." 8

kill -INT "$CAPTURE" 2>/dev/null || true
wait "$CAPTURE" 2>/dev/null || true
trap - EXIT
echo "Saved to $OUT — review every frame before sharing."

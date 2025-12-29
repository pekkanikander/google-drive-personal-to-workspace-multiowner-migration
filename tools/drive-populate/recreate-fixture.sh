#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: recreate-fixture.sh --root-id <id> [--spec <path>] [--verbose]

Defaults:
  --spec fixtures/example.json
EOF
}

die() {
  echo "Error: $*" >&2
  exit 2
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
spec_path="$script_dir/fixtures/example.json"
root_id=""
verbose=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root-id)
      [[ $# -ge 2 ]] || die "Missing value for --root-id"
      root_id="$2"
      shift 2
      ;;
    --spec)
      [[ $# -ge 2 ]] || die "Missing value for --spec"
      spec_path="$2"
      shift 2
      ;;
    --verbose)
      verbose=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

[[ -n "$root_id" ]] || die "Missing --root-id"

if [[ "$spec_path" != /* ]]; then
  spec_path="$script_dir/$spec_path"
fi

[[ -f "$spec_path" ]] || die "Spec not found: $spec_path"
command -v node >/dev/null 2>&1 || die "node is required"
command -v npm >/dev/null 2>&1 || die "npm is required"

accounts_tsv="$(node -e '
const fs = require("fs");
const spec = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!spec.accounts || !Array.isArray(spec.accounts) || spec.accounts.length === 0) {
  console.error("Spec missing accounts");
  process.exit(2);
}
for (const acct of spec.accounts) {
  if (!acct.email) {
    console.error("Spec account missing email");
    process.exit(2);
  }
  const profile = acct.profile || "";
  process.stdout.write(`${acct.email}\t${profile}\n`);
}
' "$spec_path")"

if [[ -z "$accounts_tsv" ]]; then
  die "Spec has no accounts"
fi

list_output="$(npm --prefix "$script_dir" run --silent drive:populate -- list-accounts)"
stored_emails=""
if ! printf "%s\n" "$list_output" | grep -q "^No accounts stored\\.$"; then
  stored_emails="$(printf "%s\n" "$list_output" | awk -F '\t' '{print $1}')"
fi

while IFS=$'\t' read -r email profile; do
  [[ -n "$email" ]] || continue
  if ! printf "%s\n" "$stored_emails" | grep -Fxq "$email"; then
    auth_args=(--account "$email")
    if [[ -n "${profile:-}" ]]; then
      auth_args+=(--chrome-profile-dir "$profile")
    fi
    npm --prefix "$script_dir" run --silent drive:populate -- auth "${auth_args[@]}"
  fi
done <<< "$accounts_tsv"

npm --prefix "$script_dir" run --silent drive:populate -- clean --root-id "$root_id"

populate_args=(populate --spec "$spec_path" --root-id "$root_id")
if [[ "$verbose" == "true" ]]; then
  populate_args+=(--verbose)
fi
npm --prefix "$script_dir" run --silent drive:populate -- "${populate_args[@]}"

#!/usr/bin/env bash
# Operator provisioning for Authelia's users file (ADR 0002, unit A6). Run it over SSH on the host.
#
#   deploy/authelia-user.sh add <username> <email> "<display name>" <group>[,<group>...]
#   deploy/authelia-user.sh disable <username>
#   deploy/authelia-user.sh reset <username>
#   deploy/authelia-user.sh list
#
# `add` and `reset` generate a random password, hash it with the authelia binary inside the Authelia container,
# store only the argon2id digest, and print the password once on stdout for the operator to send. Nothing else
# ever prints it, and it never appears in an argument list.
#
# Environment:
#   AUTHELIA_USERS_FILE    Required. The users file on the host. The container must mount its DIRECTORY, not the
#                          file: every edit replaces the file with a rename, and a single-file bind mount keeps
#                          pointing at the old inode.
#   AUTHELIA_CONTAINER     The Authelia container for `docker exec`. Default: authelia.
#   AUTHELIA_HASH_CMD      Replaces the default `docker exec` hash command. It must print authelia's
#                          `--random` output ("Random Password: ..." and "Digest: ...").
#   AUTHELIA_VALIDATE_CMD  Optional. Runs after the file is replaced. When it fails, the backup is restored.
#   AUTHELIA_RELOAD_CMD    Replaces the reload nudge described below. Needed only where the container cannot see
#                          host-side file events, such as Docker Desktop on Windows or macOS.
#   AUTHELIA_KEEP_BACKUPS  Dated backups to keep. Default: 20.
#
# Every change keeps a dated backup (<file>.bak-<timestamp>), is written to a temporary file beside the users file,
# checked, and moved into place with one rename. Authelia, with `watch: true`, reloads only on a WRITE event and
# ignores a rename over the file (checked on 4.39.28), so the script then rewrites the file's own bytes in place
# (dd conv=notrunc). Content never changes or tears, and Authelia reloads without a restart.
set -euo pipefail
umask 077

readonly EX_FAIL=1 EX_USAGE=2 EX_REFUSED=3

die() { printf 'error: %s\n' "$1" >&2; exit "${2:-$EX_FAIL}"; }

usage() {
  cat >&2 <<'USAGE'
usage:
  authelia-user.sh add <username> <email> "<display name>" <group>[,<group>...]
  authelia-user.sh disable <username>
  authelia-user.sh reset <username>
  authelia-user.sh list
The users file comes from $AUTHELIA_USERS_FILE.
USAGE
  exit "$EX_USAGE"
}

# Reads the users section. Prints "U<TAB>name<TAB>email<TAB>disabled<TAB>groups" per user and "E<TAB>message" per
# problem. Passwords are checked for shape and never printed.
read -r -d '' SCAN_AWK <<'AWK' || true
function indent(s) { match(s, /^ */); return RLENGTH }
function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
function unquote(s) {
  s = trim(s); sub(/[ \t]+#.*$/, "", s); s = trim(s)
  if (s ~ /^".*"$/ || s ~ /^'.*'$/) s = substr(s, 2, length(s) - 2)
  return s
}
function err(m) { printf "E\t%s\n", m }
function addGroup(g) { if (g != "") groups = (groups == "" ? g : groups "," g) }
function flush() {
  if (name == "") return
  if (!pwok) err("user " name " has no password hash")
  if (email == "") err("user " name " has no email")
  printf "U\t%s\t%s\t%s\t%s\n", name, email, (disabled ? "true" : "false"), groups
  name = ""
}
BEGIN { section = 0; uind = -1; find = -1; inGroups = 0; name = "" }
{
  line = $0
  if (line ~ /\r$/) { err("line " NR " has a carriage return; use LF line endings"); sub(/\r$/, "", line) }
  if (line ~ /^[ ]*\t/) { err("line " NR " is indented with a tab"); next }
  if (line ~ /^[ ]*(#.*)?$/) next
  ind = indent(line)
  body = substr(line, ind + 1)
  if (ind == 0) {
    flush()
    if (body ~ /^users:[ ]*(#.*)?$/ || body ~ /^users:[ ]*\{\}[ ]*(#.*)?$/) {
      if (usersFound) err("users: appears twice")
      usersFound = 1; section = 1
    } else if (section == 1) section = 2
    next
  }
  if (section != 1) next
  if (uind < 0) uind = ind
  if (ind == uind) {
    flush()
    if (body !~ /^["']?[A-Za-z0-9._@-]+["']?:[ ]*(#.*)?$/) { err("line " NR ": cannot read a user name"); next }
    name = body; sub(/:.*$/, "", name); gsub(/["']/, "", name)
    if (tolower(name) in seen) err("user " name " appears twice")
    seen[tolower(name)] = 1
    email = ""; disabled = 0; pwok = 0; groups = ""; inGroups = 0
    next
  }
  if (name == "") next
  if (inGroups && body ~ /^- /) { addGroup(unquote(substr(body, 3))); next }
  if (find < 0) find = ind
  if (ind != find || body !~ /^[A-Za-z_]+:/) next
  key = body; sub(/:.*$/, "", key)
  val = body; sub(/^[^:]*:/, "", val)
  inGroups = 0
  if (key == "email") email = unquote(val)
  else if (key == "password") pwok = (unquote(val) ~ /^\$/)
  else if (key == "disabled") disabled = (unquote(val) == "true")
  else if (key == "groups") {
    val = trim(val); sub(/[ \t]+#.*$/, "", val)
    if (val ~ /^\[.*\]$/) {
      n = split(substr(val, 2, length(val) - 2), parts, ",")
      for (j = 1; j <= n; j++) addGroup(unquote(parts[j]))
    } else if (val == "") inGroups = 1
  }
}
END {
  flush()
  if (!usersFound) err("no top-level users: section")
}
AWK

# Applies one change, chosen by CBS_MODE (add, disable or reset), to the lines of the users file. Everything
# secret or free-form arrives through the environment, which keeps it out of the argument list. Exits 3 when
# the target user is missing.
read -r -d '' EDIT_AWK <<'AWK' || true
function indent(s) { match(s, /^ */); return RLENGTH }
function blank(s) { return s ~ /^[ ]*(#.*)?$/ }
{ L[NR] = $0 }
END {
  mode = ENVIRON["CBS_MODE"]; target = tolower(ENVIRON["CBS_TARGET"])
  usersAt = 0
  for (i = 1; i <= NR; i++) if (L[i] ~ /^users:[ ]*(#.*)?$/ || L[i] ~ /^users:[ ]*\{\}[ ]*(#.*)?$/) { usersAt = i; break }
  last = usersAt; uind = -1; nb = 0
  if (usersAt) {
    for (i = usersAt + 1; i <= NR; i++) {
      if (blank(L[i])) continue
      if (L[i] !~ /^ /) break
      last = i
      if (uind < 0) uind = indent(L[i])
      if (indent(L[i]) == uind) { nb++; start[nb] = i; nm = substr(L[i], uind + 1); sub(/:.*$/, "", nm); gsub(/["']/, "", nm); bname[nb] = tolower(nm) }
    }
  }
  if (uind < 0) uind = 2
  for (b = 1; b <= nb; b++) bend[b] = (b < nb ? start[b + 1] - 1 : last)
  find = uind + 2
  if (nb) for (i = start[1] + 1; i <= bend[1]; i++) if (!blank(L[i]) && indent(L[i]) > uind) { find = indent(L[i]); break }
  pad = sprintf("%" find "s", "")
  upad = sprintf("%" uind "s", "")

  if (mode == "add") {
    ins = (usersAt ? last : NR)
    if (usersAt && L[usersAt] ~ /\{\}/) L[usersAt] = "users:"
    n = split(ENVIRON["CBS_GROUPS"], g, ",")
    k = 0
    block[++k] = upad ENVIRON["CBS_TARGET"] ":"
    block[++k] = pad "disabled: false"
    block[++k] = pad "displayname: \"" ENVIRON["CBS_NAME"] "\""
    block[++k] = pad "password: \"" ENVIRON["CBS_DIGEST"] "\""
    block[++k] = pad "email: " ENVIRON["CBS_EMAIL"]
    block[++k] = pad "groups:"
    for (j = 1; j <= n; j++) block[++k] = pad "  - " g[j]
    for (i = 1; i <= NR; i++) {
      print L[i]
      if (i == ins && usersAt) for (j = 1; j <= k; j++) print block[j]
    }
    if (!usersAt) { print "users:"; for (j = 1; j <= k; j++) print block[j] }
    exit 0
  }

  hit = 0
  for (b = 1; b <= nb; b++) if (bname[b] == target) hit = b
  if (!hit) exit 3
  if (mode == "disable") { field = "disabled"; repl = pad "disabled: true" }
  else { field = "password"; repl = pad "password: \"" ENVIRON["CBS_DIGEST"] "\"" }
  has = 0
  for (i = start[hit] + 1; i <= bend[hit]; i++) if (!blank(L[i]) && indent(L[i]) == find && substr(L[i], find + 1) ~ ("^" field ":")) { has = i; break }
  for (i = 1; i <= NR; i++) {
    if (i == has) { print repl; continue }
    print L[i]
    if (!has && i == start[hit]) print repl
  }
}
AWK

command -v awk > /dev/null || die "awk is required"

users_file() {
  [ -n "${AUTHELIA_USERS_FILE:-}" ] || die "set AUTHELIA_USERS_FILE to the Authelia users file" "$EX_USAGE"
  [ -f "$AUTHELIA_USERS_FILE" ] || die "users file not found: $AUTHELIA_USERS_FILE"
  [ -r "$AUTHELIA_USERS_FILE" ] || die "users file is not readable: $AUTHELIA_USERS_FILE"
}

scan() { awk "$SCAN_AWK" "$1"; }

# Prints the problems in a users file, one per line, or nothing when it is well formed.
problems() { scan "$1" | awk -F '\t' '$1 == "E" { print $2 }'; }

generate_credentials() {
  local out
  if [ -n "${AUTHELIA_HASH_CMD:-}" ]; then
    out="$(bash -c "$AUTHELIA_HASH_CMD" 2> /dev/null)" || die "the hash command failed"
  else
    command -v docker > /dev/null || die "docker is required to hash with the authelia binary"
    out="$(docker exec "${AUTHELIA_CONTAINER:-authelia}" authelia crypto hash generate argon2 --random --random.length 24 --random.charset alphanumeric 2> /dev/null)" \
      || die "could not run authelia in container ${AUTHELIA_CONTAINER:-authelia}"
  fi
  PASSWORD="$(printf '%s\n' "$out" | sed -n 's/^Random Password: //p' | head -n 1)"
  DIGEST="$(printf '%s\n' "$out" | sed -n 's/^Digest: //p' | head -n 1)"
  out=""
  [ -n "$PASSWORD" ] || die "the hash command printed no password"
  [[ "$DIGEST" =~ ^\$argon2id\$v=[0-9]+\$[A-Za-z0-9,=]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$ ]] || die "the hash command did not print an argon2id digest"
}

with_lock() {
  command -v flock > /dev/null || return 0
  exec 9> "$AUTHELIA_USERS_FILE.lock"
  flock -n 9 || die "another authelia-user.sh run holds $AUTHELIA_USERS_FILE.lock"
}

# Authelia's file watcher ignores a rename over the file. Rewriting the file's own bytes in place raises the WRITE
# event it does react to, and with conv=notrunc the file is never empty or partial.
reload_authelia() {
  if [ -n "${AUTHELIA_RELOAD_CMD:-}" ]; then
    bash -c "$AUTHELIA_RELOAD_CMD" > /dev/null 2>&1 || printf 'warning: the reload command failed; Authelia may still hold the old users\n' >&2
  else
    dd if="$AUTHELIA_USERS_FILE" of="$AUTHELIA_USERS_FILE" bs=1048576 conv=notrunc 2> /dev/null || printf 'warning: could not nudge Authelia to reload\n' >&2
  fi
}

prune_backups() {
  local keep="${AUTHELIA_KEEP_BACKUPS:-20}"
  # shellcheck disable=SC2012
  ls -1t "$AUTHELIA_USERS_FILE".bak-* 2> /dev/null | tail -n +"$((keep + 1))" | while IFS= read -r old; do rm -f -- "$old"; done
}

# apply <mode> <username>: edit, check, rename into place. The caller has set CBS_* in the environment.
apply() {
  local mode="$1" target="$2" file="$AUTHELIA_USERS_FILE" dir base stamp bak tmp rc=0
  dir="$(dirname "$file")"; base="$(basename "$file")"
  with_lock

  local existing; existing="$(problems "$file")"
  if [ -n "$existing" ]; then printf '%s\n' "$existing" >&2; die "the users file is not well formed; fix it by hand first"; fi

  stamp="$(date +%Y%m%d-%H%M%S)"; bak="$file.bak-$stamp"
  cp -p -- "$file" "$bak"
  tmp="$(mktemp "$dir/.$base.XXXXXX")"
  cleanup() { rm -f -- "$tmp" "${tmp}.before" "${tmp}.after"; }
  trap cleanup EXIT
  cp -p -- "$file" "$tmp"
  CBS_MODE="$mode" CBS_TARGET="$target" awk "$EDIT_AWK" "$file" > "$tmp" || rc=$?
  if [ "$rc" -ne 0 ]; then rm -f -- "$bak"; die "user $target was not found" "$EX_REFUSED"; fi

  local bad; bad="$(problems "$tmp")"
  if [ -n "$bad" ]; then printf '%s\n' "$bad" >&2; rm -f -- "$bak"; die "the edit produced a malformed users file; nothing was changed"; fi

  scan "$file" | grep '^U' > "${tmp}.before" || true
  scan "$tmp" | grep '^U' > "${tmp}.after" || true
  # The edit may touch only the target. Records are compared without passwords, so the diff line counts
  # cover the password lines: add may only append, disable changes one line, reset replaces one.
  local added removed gained lost
  added="$(diff "$file" "$tmp" | grep -c '^>' || true)"
  removed="$(diff "$file" "$tmp" | grep -c '^<' || true)"
  gained="$(grep -vxFf "${tmp}.before" "${tmp}.after" || true)"
  lost="$(grep -vxFf "${tmp}.after" "${tmp}.before" || true)"
  local ok=0
  case "$mode" in
    add) local replaced_marker=0
      grep -qE '^users:[[:space:]]*\{\}' "$file" && replaced_marker=1
      [ "$removed" -eq "$replaced_marker" ] && [ -z "$lost" ] && [ "$(count_lines "$gained")" -eq 1 ] && ok=1 ;;
    disable) [ "$removed" -le 1 ] && [ "$added" -le 1 ] && [ "$(count_lines "$lost")" -le 1 ] \
      && { [ -z "$gained" ] || [ "$(printf '%s\n' "$gained" | awk -F '\t' '{ print tolower($2) ":" $4 }')" = "$(lowercase "$target"):true" ]; } && ok=1 ;;
    reset) [ "$removed" -eq 1 ] && [ "$added" -eq 1 ] && [ -z "$gained" ] && [ -z "$lost" ] && ok=1 ;;
  esac
  if [ "$ok" -ne 1 ]; then rm -f -- "$bak"; die "the edit changed more than the target user; nothing was changed"; fi

  mv -f -- "$tmp" "$file"
  trap - EXIT; rm -f -- "${tmp}.before" "${tmp}.after"
  reload_authelia

  if [ -n "${AUTHELIA_VALIDATE_CMD:-}" ] && ! bash -c "$AUTHELIA_VALIDATE_CMD" > /dev/null 2>&1; then
    tmp="$(mktemp "$dir/.$base.XXXXXX")"; cp -p -- "$bak" "$tmp"; mv -f -- "$tmp" "$file"
    reload_authelia
    die "validation failed after the edit; restored $bak"
  fi
  prune_backups
  printf 'backup: %s\n' "$bak" >&2
}

lowercase() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }
count_lines() { printf '%s\n' "$1" | grep -c . || true; }
valid_username() { [[ "$1" =~ ^[a-z0-9._-]{1,64}$ ]]; }
valid_email() { [[ "$1" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] && [ "${#1}" -le 254 ]; }
valid_group() { [[ "$1" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; }

cmd_add() {
  [ "$#" -eq 4 ] || usage
  local username="$1" email="$2" name="$3" groups="$4" group
  [ -n "$username" ] || die "username is empty" "$EX_USAGE"
  valid_username "$username" || die "username must match [a-z0-9._-]{1,64}" "$EX_USAGE"
  [ -n "$email" ] || die "email is empty" "$EX_USAGE"
  valid_email "$email" || die "email is not valid" "$EX_USAGE"
  [ -n "$name" ] || die "display name is empty" "$EX_USAGE"
  [ "${#name}" -le 100 ] || die "display name is longer than 100 characters" "$EX_USAGE"
  [[ "$name" =~ [[:cntrl:]] ]] && die "display name has a control character" "$EX_USAGE"
  [ -n "$groups" ] || die "group is empty" "$EX_USAGE"
  case "$groups" in ,* | *, | *,,*) die "group list has an empty entry" "$EX_USAGE" ;; esac
  local -a group_list
  IFS=, read -ra group_list <<< "$groups"
  for group in "${group_list[@]}"; do valid_group "$group" || die "group names must match [A-Za-z0-9._-]{1,64}" "$EX_USAGE"; done
  users_file

  local lower_email; lower_email="$(lowercase "$email")"
  if scan "$AUTHELIA_USERS_FILE" | awk -F '\t' -v u="$username" '$1 == "U" && tolower($2) == u { found = 1 } END { exit !found }'; then
    die "user $username already exists" "$EX_REFUSED"
  fi
  if scan "$AUTHELIA_USERS_FILE" | awk -F '\t' -v e="$lower_email" '$1 == "U" && tolower($3) == e { found = 1 } END { exit !found }'; then
    die "email $email is already in the users file" "$EX_REFUSED"
  fi

  local escaped="${name//\\/\\\\}"; escaped="${escaped//\"/\\\"}"
  generate_credentials
  CBS_DIGEST="$DIGEST" CBS_NAME="$escaped" CBS_EMAIL="$email" CBS_GROUPS="$groups" apply add "$username"
  printf 'user: %s\npassword: %s\n' "$username" "$PASSWORD"
}

cmd_disable() {
  [ "$#" -eq 1 ] || usage
  valid_username "$1" || die "username must match [a-z0-9._-]{1,64}" "$EX_USAGE"
  users_file
  apply disable "$1"
  printf 'disabled: %s\n' "$1"
}

cmd_reset() {
  [ "$#" -eq 1 ] || usage
  valid_username "$1" || die "username must match [a-z0-9._-]{1,64}" "$EX_USAGE"
  users_file
  scan "$AUTHELIA_USERS_FILE" | awk -F '\t' -v u="$1" '$1 == "U" && tolower($2) == u { found = 1 } END { exit !found }' || die "user $1 was not found" "$EX_REFUSED"
  generate_credentials
  CBS_DIGEST="$DIGEST" apply reset "$1"
  printf 'user: %s\npassword: %s\n' "$1" "$PASSWORD"
}

cmd_list() {
  [ "$#" -eq 0 ] || usage
  users_file
  local bad; bad="$(problems "$AUTHELIA_USERS_FILE")"
  if [ -n "$bad" ]; then printf '%s\n' "$bad" >&2; die "the users file is not well formed"; fi
  scan "$AUTHELIA_USERS_FILE" | awk -F '\t' 'BEGIN { printf "%-24s %-36s %-9s %s\n", "USERNAME", "EMAIL", "STATUS", "GROUPS" } $1 == "U" { printf "%-24s %-36s %-9s %s\n", $2, $3, ($4 == "true" ? "disabled" : "active"), $5 }'
}

[ "$#" -ge 1 ] || usage
command_name="$1"; shift
case "$command_name" in
  add) cmd_add "$@" ;;
  disable) cmd_disable "$@" ;;
  reset) cmd_reset "$@" ;;
  list) cmd_list "$@" ;;
  *) usage ;;
esac

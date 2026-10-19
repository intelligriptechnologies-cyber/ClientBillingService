#!/usr/bin/env bash
# Plain-bash tests for deploy/authelia-user.sh (ADR 0002, unit A6). No docker: a stub stands in for the authelia
# hash command. The real binary is exercised by deploy/smoke/run.sh. Usage: bash deploy/authelia-user.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/authelia-user.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
failures=0
checks=0

pass() { checks=$((checks + 1)); }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf 'FAIL: %s\n' "$1" >&2; }
expect() { if [ "$1" = "$2" ]; then pass; else fail "$3 (expected '$2', got '$1')"; fi; }
expect_nonzero() { if [ "$1" -ne 0 ]; then pass; else fail "$2 (exit was 0)"; fi; }
expect_unchanged() { if cmp -s "$1" "$2"; then pass; else fail "$3 (file changed)"; fi; }
expect_contains() { if grep -qF -- "$2" "$1"; then pass; else fail "$3 (missing '$2')"; fi; }
expect_absent() { if grep -qF -- "$2" "$1"; then fail "$3 (found '$2')"; else pass; fi; }

cat > "$WORK/stub-hash.sh" <<'STUB'
#!/usr/bin/env bash
dir="$(dirname "$0")"
n=$(($(cat "$dir/counter" 2>/dev/null || echo 0) + 1))
echo "$n" > "$dir/counter"
if [ -f "$dir/bad" ]; then printf 'Random Password: BadPass%s\nDigest: not-a-hash\n' "$n"; exit 0; fi
printf 'Random Password: StubPass%sZ9Q\nDigest: $argon2id$v=19$m=65536,t=3,p=4$c3R1YnNhbHQ$c3R1YmRpZ2VzdA%s\n' "$n" "$n"
STUB
chmod +x "$WORK/stub-hash.sh"

export AUTHELIA_HASH_CMD="$WORK/stub-hash.sh"
export AUTHELIA_USERS_FILE="$WORK/users.yml"
unset AUTHELIA_VALIDATE_CMD

write_fixture() {
  cat > "$AUTHELIA_USERS_FILE" <<'YAML'
# hand-edited users file
users:
  alice:
    disabled: false
    displayname: "Alice A"
    password: "$argon2id$v=19$m=65536,t=3,p=4$YWxpY2VzYWx0$QUxJQ0VISEg"
    email: Alice@Example.com
    groups:
      - cbs-users
      - other-app
  # bob works on cwerp
  bob:
    displayname: 'Bob'
    password: '$argon2id$v=19$m=65536,t=3,p=4$Ym9ic2FsdA$Qk9CSEg'
    email: bob@example.com
    groups: [cwerp-users]

# trailing comment
YAML
  chmod 640 "$AUTHELIA_USERS_FILE"
  rm -f "$AUTHELIA_USERS_FILE".bak-* "$WORK/bad" "$WORK/counter"
}

run() { rc=0; bash "$SCRIPT" "$@" > "$WORK/out" 2> "$WORK/err" || rc=$?; }
snapshot() { cp "$AUTHELIA_USERS_FILE" "$WORK/snapshot"; }
backups() { ls "$AUTHELIA_USERS_FILE".bak-* 2> /dev/null | wc -l | tr -d ' '; }

echo "list"
write_fixture
run list
expect "$rc" 0 "list exits 0"
expect_contains "$WORK/out" "alice" "list shows alice"
expect_contains "$WORK/out" "bob" "list shows bob"
expect_contains "$WORK/out" "cwerp-users" "list reads inline groups"
expect_absent "$WORK/out" 'argon2' "list never prints a hash"

echo "add"
write_fixture; snapshot
run add carol Carol@Example.com 'Carol "C" \ Smith' cbs-users,cbs-staging-users
expect "$rc" 0 "add exits 0"
password="$(sed -n 's/^password: //p' "$WORK/out")"
expect "$password" "StubPass1Z9Q" "add prints the generated password"
expect_absent "$AUTHELIA_USERS_FILE" "$password" "the plain password is never written to the users file"
expect_absent "$WORK/err" "$password" "the plain password never reaches stderr"
expect_contains "$AUTHELIA_USERS_FILE" '  carol:' "carol block added"
expect_contains "$AUTHELIA_USERS_FILE" 'displayname: "Carol \"C\" \\ Smith"' "display name is escaped"
expect_contains "$AUTHELIA_USERS_FILE" '      - cbs-staging-users' "both groups written"
expect_contains "$AUTHELIA_USERS_FILE" '# trailing comment' "comments survive"
expect_contains "$AUTHELIA_USERS_FILE" '# bob works on cwerp' "inner comments survive"
expect "$(diff "$WORK/snapshot" "$AUTHELIA_USERS_FILE" | grep -c '^<' || true)" 0 "add removes no existing line"
expect "$(backups)" 1 "add keeps one backup"
expect_unchanged "$(ls "$AUTHELIA_USERS_FILE".bak-*)" "$WORK/snapshot" "the backup equals the file before the edit"
[ "$(uname -s)" != Linux ] || expect "$(stat -c %a "$AUTHELIA_USERS_FILE")" 640 "file mode is kept"
run list
expect_contains "$WORK/out" "carol" "list shows the new user"

echo "add twice"
snapshot
run add carol other@example.com 'Carol Two' cbs-users
expect_nonzero "$rc" "a duplicate username is refused"
expect_unchanged "$WORK/snapshot" "$AUTHELIA_USERS_FILE" "adding carol twice leaves the file unchanged"
run add CAROL other2@example.com 'Carol Three' cbs-users
expect_nonzero "$rc" "usernames must be lowercase"
expect_unchanged "$WORK/snapshot" "$AUTHELIA_USERS_FILE" "an uppercase duplicate leaves the file unchanged"

echo "add refusals leave the file unchanged"
write_fixture; snapshot
run add dave ALICE@example.COM 'Dave' cbs-users
expect_nonzero "$rc" "an email already present is refused, case-insensitively"
expect_unchanged "$WORK/snapshot" "$AUTHELIA_USERS_FILE" "duplicate email leaves the file unchanged"
run add alice dave@example.com 'Dave' cbs-users
expect_nonzero "$rc" "an existing username is refused"
expect_unchanged "$WORK/snapshot" "$AUTHELIA_USERS_FILE" "duplicate username leaves the file unchanged"
run add '' dave@example.com 'Dave' cbs-users
expect_nonzero "$rc" "an empty username is refused"
run add dave '' 'Dave' cbs-users
expect_nonzero "$rc" "an empty email is refused"
run add dave dave@example.com '' cbs-users
expect_nonzero "$rc" "an empty display name is refused"
run add dave dave@example.com 'Dave' ''
expect_nonzero "$rc" "an empty group is refused"
run add dave dave@example.com 'Dave' 'cbs-users,'
expect_nonzero "$rc" "an empty group in a list is refused"
run add 'da ve' dave@example.com 'Dave' cbs-users
expect_nonzero "$rc" "a username with a space is refused"
run add dave 'not-an-email' 'Dave' cbs-users
expect_nonzero "$rc" "a malformed email is refused"
run add dave dave@example.com "$(printf 'Da\nve')" cbs-users
expect_nonzero "$rc" "a display name with a newline is refused"
expect_unchanged "$WORK/snapshot" "$AUTHELIA_USERS_FILE" "refusals leave the file unchanged"
expect "$(backups)" 0 "refusals leave no backup behind"

echo "add into an empty users map"
printf 'users: {}\n' > "$AUTHELIA_USERS_FILE"
run add erin erin@example.com 'Erin' cbs-users
expect "$rc" 0 "add works on 'users: {}'"
expect_contains "$AUTHELIA_USERS_FILE" '  erin:' "erin added"
expect_absent "$AUTHELIA_USERS_FILE" '{}' "the empty map marker is gone"

echo "reload"
write_fixture
export AUTHELIA_RELOAD_CMD="touch '$WORK/reloaded'"
run disable bob
expect "$rc" 0 "disable with a reload command"
[ -f "$WORK/reloaded" ] && pass || fail "the reload command ran after the edit"
rm -f "$WORK/reloaded"
export AUTHELIA_VALIDATE_CMD='exit 1'
run disable alice
expect_nonzero "$rc" "a failed validation still fails"
[ -f "$WORK/reloaded" ] && pass || fail "the reload command ran again after the restore"
unset AUTHELIA_VALIDATE_CMD
export AUTHELIA_RELOAD_CMD='exit 1'
run disable alice
expect "$rc" 0 "a failing reload command only warns"
expect_contains "$WORK/err" "warning" "the warning is printed"
unset AUTHELIA_RELOAD_CMD

echo "disable"
write_fixture; snapshot
run disable bob
expect "$rc" 0 "disable exits 0"
expect_contains "$AUTHELIA_USERS_FILE" '    disabled: true' "bob is disabled"
run list
expect_contains "$WORK/out" "disabled" "list shows the status"
expect "$(diff "$WORK/snapshot" "$AUTHELIA_USERS_FILE" | grep -c '^[<>]' || true)" 1 "only one line changed (bob had no disabled line)"
run disable alice
expect "$rc" 0 "disable flips an existing disabled: false"
expect "$(grep -c 'disabled: true' "$AUTHELIA_USERS_FILE")" 2 "both users are disabled now"
snapshot
run disable alice
expect "$rc" 0 "disable is idempotent"
expect_unchanged "$WORK/snapshot" "$AUTHELIA_USERS_FILE" "a repeated disable changes nothing"
run disable nobody
expect_nonzero "$rc" "disabling an unknown user is refused"
expect_unchanged "$WORK/snapshot" "$AUTHELIA_USERS_FILE" "an unknown user leaves the file unchanged"

echo "reset"
write_fixture; snapshot
run reset alice
expect "$rc" 0 "reset exits 0"
password="$(sed -n 's/^password: //p' "$WORK/out")"
expect "$password" "StubPass1Z9Q" "reset prints the new password"
expect_absent "$AUTHELIA_USERS_FILE" 'QUxJQ0VISEg' "the old digest is gone"
expect_contains "$AUTHELIA_USERS_FILE" 'c3R1YmRpZ2VzdA1' "the new digest is stored"
expect_contains "$AUTHELIA_USERS_FILE" 'Qk9CSEg' "bob's digest is untouched"
expect_absent "$AUTHELIA_USERS_FILE" "$password" "the plain password is never written"
expect_absent "$WORK/err" "$password" "the plain password never reaches stderr"
expect "$(diff "$WORK/snapshot" "$AUTHELIA_USERS_FILE" | grep -c '^[<>]' || true)" 2 "reset replaces exactly one line"
snapshot
run reset nobody
expect_nonzero "$rc" "resetting an unknown user is refused"
expect_unchanged "$WORK/snapshot" "$AUTHELIA_USERS_FILE" "reset of an unknown user leaves the file unchanged"
expect "$(cat "$WORK/counter")" 1 "an unknown user does not even hash a password"

echo "malformed edits"
write_fixture; snapshot
touch "$WORK/bad"
run add frank frank@example.com 'Frank' cbs-users
expect_nonzero "$rc" "a hash command that prints no argon2id digest is refused"
run reset alice
expect_nonzero "$rc" "reset refuses a bad digest too"
expect_unchanged "$WORK/snapshot" "$AUTHELIA_USERS_FILE" "a bad digest leaves the file unchanged"
rm -f "$WORK/bad"
export AUTHELIA_VALIDATE_CMD='exit 1'
run add frank frank@example.com 'Frank' cbs-users
expect_nonzero "$rc" "a failing validation command fails the run"
expect_unchanged "$WORK/snapshot" "$AUTHELIA_USERS_FILE" "the backup is restored when validation fails"
expect "$(backups)" 1 "the backup stays on disk after a restore"
unset AUTHELIA_VALIDATE_CMD
printf 'users:\n\tbroken:\n' > "$AUTHELIA_USERS_FILE"
snapshot
run disable broken
expect_nonzero "$rc" "a file that is already malformed is not edited"
expect_unchanged "$WORK/snapshot" "$AUTHELIA_USERS_FILE" "a malformed file stays as it was"

echo "usage and environment"
run
expect "$rc" 2 "no command is a usage error"
run frobnicate
expect "$rc" 2 "an unknown command is a usage error"
AUTHELIA_USERS_FILE="$WORK/missing.yml" run list
expect_nonzero "$rc" "a missing users file is refused"
( unset AUTHELIA_USERS_FILE; rc=0; bash "$SCRIPT" list > /dev/null 2>&1 || rc=$?; exit "$rc" ); expect_nonzero "$?" "no AUTHELIA_USERS_FILE is refused"

echo "backups are pruned"
write_fixture
export AUTHELIA_KEEP_BACKUPS=2
for i in 1 2 3 4; do touch -d "2026-01-0$i" "$AUTHELIA_USERS_FILE.bak-2026010$i-000000"; done
run disable bob
expect "$rc" 0 "disable with old backups present"
expect "$(backups)" 2 "only the newest backups are kept"
unset AUTHELIA_KEEP_BACKUPS

echo
if [ "$failures" -eq 0 ]; then printf 'authelia-user.sh: %s checks passed\n' "$checks"; else printf 'authelia-user.sh: %s of %s checks failed\n' "$failures" "$checks" >&2; exit 1; fi

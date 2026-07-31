# claude-profiles (`claudep`)

Switch between multiple Claude Code logins from the terminal. Save several
logged-in accounts, pick one to use, and only re-login when a token actually
breaks. macOS + Linux + Windows.

## Why

Claude Code keeps a single active login per machine — logging into a second
account overwrites the first. `claudep` snapshots each login and swaps only the
canonical credential when you switch, so everything else in `~/.claude` stays shared.

## Install

Requires Node ≥ 18.

From npm:

```bash
npm i -g claude-login-switcher
```

(The npm package is `claude-login-switcher`; the command it installs is `claudep`.)

From source or git (the `prepare` script builds automatically):

```bash
npm i -g git+<repo-url>
# or, from a local clone:
git clone <repo-url> claude-profiles && cd claude-profiles && npm i -g .
```

Verify with `claudep doctor`. On macOS the first run may raise a Keychain
"allow access" dialog — click Allow.

## Commands

```
claudep                        # interactive menu: pick an account to switch to
claudep <n>                    # switch to account #n (as numbered by `list`)
claudep list                   # (ls, status, current) list saved accounts, mark the active one
claudep switch <name|n>        # (use) make an account active, by name or number
claudep remove <name|n> [-y]   # (rm) forget a saved account; -y skips the confirm
claudep rename <old> <new>     # relabel a saved account
claudep version                # show the version and check npm for a newer one
claudep doctor                 # diagnose credential path, config, and store
claudep daemon install         # run a background watcher for INSTANT capture (autostart on login)
claudep daemon status          # is the watcher installed?
claudep daemon uninstall       # remove the watcher
```

Accounts are numbered in a stable order (by email), so `claudep 2` always refers
to the same account. Output is colored on a terminal and plain when piped, `--json`,
or `NO_COLOR` is set.

Global flags: `--json` (on `list`), `--version`, `--help`.

### Interactive menu

Running `claudep` with no arguments (in a terminal) opens a menu of your saved
accounts. Navigate with **↑/↓ or the mouse wheel**, press **Enter** (or a
**number key**) to switch to the highlighted account. Action hotkeys work
anywhere: **r** rename · **d** doctor · **q**/**Esc** quit. Removing an account is
deliberately kept out of the menu — use `claudep remove <name|n>`.

## How capture works

There is **no manual `save`** — capture is automatic. A global install
(`npm i -g`) turns on **instant** capture by default; the **lazy** path is the
fallback when the daemon is off.

**Instant (default on global install).** A `postinstall` step runs
`claudep daemon install`, starting a background watcher on `~/.claude.json` that
captures every login/switch/logout the moment it happens — no `claudep` command
needed. It autostarts on login (launchd on macOS, systemd user service on Linux,
a logon Task on Windows). Check with `claudep daemon status`; turn it off with
`claudep daemon uninstall`, or skip it at install time with
`CLAUDE_P_NO_DAEMON=1 npm i -g claude-login-switcher`.

**Lazy (fallback).** With the daemon off, every `claudep` command runs a
reconcile first: it reads your current login and, if new, snapshots it. So after
logging in with `claude`, simply running `claudep list` captures the account. A
login that happens while you never run `claudep` is saved on your next invocation.

Give any account a friendlier name with `claudep rename <email> <name>`.

## Logout behavior

Configured in `~/.claude-profiles/config.json`:

```jsonc
{ "logoutBehavior": "keep" }
```

| value | on logout (credential + profile both gone) |
|-------|--------------------------------------------|
| `keep` (default) | keep the account saved, stay signed out — never loses a backup |
| `keep-switch` | keep the account saved, switch to another |
| `delete-switch` | forget the logged-out account, switch to the newest remaining |
| `none` | do nothing |

## Where things live

- **macOS**: canonical login in Keychain `Claude Code-credentials`; saved accounts
  in Keychain service `claude-profiles-accounts`.
- **Linux/Windows**: canonical login file `~/.claude/.credentials.json`; saved
  accounts in `~/.claude-profiles/creds.json` (mode `0600`).
- Account metadata: `~/.claude-profiles/accounts.json`.

On macOS the first read of Claude's Keychain item may raise an "allow access"
dialog — click Allow. Run `claudep doctor` if anything looks off.

## Uninstalling

Your saved accounts live in the Keychain (service `claude-profiles-accounts`) and
`~/.claude-profiles/` — **outside** the npm package — so uninstalling the CLI does
**not** delete them. Reinstalling picks them right back up.

Remove cleanly (turn off the autostart watcher first, or it's left orphaned pointing
at the deleted binary):

```bash
claudep daemon uninstall
npm rm -g claude-login-switcher
```

To also erase the saved accounts:

```bash
rm -rf ~/.claude-profiles
# macOS also: delete each Keychain item
security delete-generic-password -s claude-profiles-accounts -a "<account-name>"
```

## Scope

Switching changes the login for **all** Claude Code on the machine (the canonical
slot is shared). A `claude` session already running keeps its old login until
restarted.

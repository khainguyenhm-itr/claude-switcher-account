# claude-profiles (`claude-p`)

Switch between multiple Claude Code logins from the terminal. Save several
logged-in accounts, pick one to use, and only re-login when a token actually
breaks. macOS + Linux + Windows.

## Why

Claude Code keeps a single active login per machine — logging into a second
account overwrites the first. `claude-p` snapshots each login and swaps only the
canonical credential when you switch, so everything else in `~/.claude` stays shared.

## Install

Requires Node ≥ 18.

From npm:

```bash
npm i -g claude-login-switcher
```

(The npm package is `claude-login-switcher`; the command it installs is `claude-p`.)

From source or git (the `prepare` script builds automatically):

```bash
npm i -g git+<repo-url>
# or, from a local clone:
git clone <repo-url> claude-profiles && cd claude-profiles && npm i -g .
```

Verify with `claude-p doctor`. On macOS the first run may raise a Keychain
"allow access" dialog — click Allow.

## Commands

```
claude-p                      # interactive menu: pick an account to switch to, or an action
claude-p list                 # (ls) list saved accounts, mark the active one
claude-p current              # (status) show the active login
claude-p switch <name>        # (use) make <name> the active login
claude-p remove <name> [-y]   # (rm) forget a saved account; -y skips the confirm
claude-p rename <old> <new>   # relabel a saved account
claude-p version              # show the version and check npm for a newer one
claude-p doctor               # diagnose credential path, config, and store
claude-p daemon install       # run a background watcher for INSTANT capture (autostart on login)
claude-p daemon status        # is the watcher installed?
claude-p daemon uninstall     # remove the watcher
```

Global flags: `--json` (on read commands), `--version`, `--help`.

### Interactive menu

Running `claude-p` with no arguments (in a terminal) opens a menu listing your
saved accounts plus Rename / Remove / Doctor / Quit. Navigate with **↑/↓ or the
mouse wheel**, press **Enter** to select (or a **number key** for a quick pick),
and **q**/**Esc** to cancel. Selecting an account switches to it.

## How capture works

There is **no manual `save`** — capture is automatic. A global install
(`npm i -g`) turns on **instant** capture by default; the **lazy** path is the
fallback when the daemon is off.

**Instant (default on global install).** A `postinstall` step runs
`claude-p daemon install`, starting a background watcher on `~/.claude.json` that
captures every login/switch/logout the moment it happens — no `claude-p` command
needed. It autostarts on login (launchd on macOS, systemd user service on Linux,
a logon Task on Windows). Check with `claude-p daemon status`; turn it off with
`claude-p daemon uninstall`, or skip it at install time with
`CLAUDE_P_NO_DAEMON=1 npm i -g claude-login-switcher`.

**Lazy (fallback).** With the daemon off, every `claude-p` command runs a
reconcile first: it reads your current login and, if new, snapshots it. So after
logging in with `claude`, simply running `claude-p list` captures the account. A
login that happens while you never run `claude-p` is saved on your next invocation.

Give any account a friendlier name with `claude-p rename <email> <name>`.

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
dialog — click Allow. Run `claude-p doctor` if anything looks off.

## Uninstalling

Your saved accounts live in the Keychain (service `claude-profiles-accounts`) and
`~/.claude-profiles/` — **outside** the npm package — so uninstalling the CLI does
**not** delete them. Reinstalling picks them right back up.

Remove cleanly (turn off the autostart watcher first, or it's left orphaned pointing
at the deleted binary):

```bash
claude-p daemon uninstall
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

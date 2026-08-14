# claude-switcher-account — switch between multiple Claude Code accounts (`claudep`)

Use several Claude Code accounts on one machine and switch between them in a
single command. `claudep` saves each logged-in account, swaps the active one
instantly, and only makes you log in again when a token actually breaks.
macOS + Linux + Windows.

```bash
npm i -g claude-switcher-account
claudep          # pick an account to switch to
```

## Why

Claude Code keeps a single active login per machine — logging into a second
account overwrites the first, so juggling a personal account and a work account
normally means re-authenticating every time you change. `claudep` snapshots each
login and swaps only the canonical credential when you switch, so everything else
in `~/.claude` stays shared.

## Install

Requires Node ≥ 20.

From npm:

```bash
npm i -g claude-switcher-account
```

(The npm package is `claude-switcher-account`; the command it installs is `claudep`.)

From source (the `prepare` script builds automatically):

```bash
# from a local clone of the sources:
npm i -g .
```

Verify with `claudep doctor`. On macOS the first run may raise a Keychain
"allow access" dialog — click Allow.

### Migrating from `claude-login-switcher`

The npm package was renamed; the command is still `claudep`. npm has no rename
redirect, so `npm update -g claude-login-switcher` will never find the new
releases — reinstall once, **removing the old package first** (both packages own
the `claudep` bin, so installing before removing leaves you without the command):

```bash
npm rm -g claude-login-switcher
npm i -g claude-switcher-account
claudep list                     # your accounts are still there
```

Nothing of yours is lost: saved accounts, config, and credentials live in
`~/.claude-profiles/` and the Keychain, outside the package, and `npm rm` has no
uninstall hook that touches them.

The autostart watcher is renamed too, so the install deregisters the old entry
(`com.claude-login-switcher.daemon`, `claude-login-switcher.service`, or the
`claude-login-switcher` logon Task) before registering the new one — you are never
left with two watchers, and no `claudep daemon uninstall` is needed first. If you
upgrade with `CLAUDE_P_NO_DAEMON=1` the old entry survives, since nothing ran to
clear it; a later `claudep daemon install` or `claudep daemon uninstall` removes it.

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
`CLAUDE_P_NO_DAEMON=1 npm i -g claude-switcher-account`.

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
npm rm -g claude-switcher-account
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

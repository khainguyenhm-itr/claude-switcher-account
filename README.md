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
claude-p list                 # (ls) list saved accounts, mark the active one
claude-p current              # (status) show the active login
claude-p switch <name>        # (use) make <name> the active login
claude-p remove <name> [-y]   # (rm) forget a saved account; -y skips the confirm
claude-p rename <old> <new>   # relabel a saved account
claude-p doctor               # diagnose credential path, config, and store
```

Global flags: `--json` (on read commands), `--version`, `--help`.

## How capture works

There is **no background daemon** and **no manual `save`**. Every `claude-p`
command runs a reconcile first: it reads your current Claude login and, if it is
new, snapshots it automatically (named by email). So after logging in with
`claude`, simply running `claude-p list` captures the account. To give it a
friendlier name, use `claude-p rename <email> <name>`.

Because capture is lazy, a login that happens while you never run `claude-p` is
saved on your next invocation.

## Logout behavior

Configured in `~/.claude-profiles/config.json`:

```jsonc
{ "logoutBehavior": "delete-switch" }
```

| value | on logout (credential + profile both gone) |
|-------|--------------------------------------------|
| `delete-switch` (default) | forget the logged-out account, switch to the newest remaining |
| `keep-switch` | keep the account saved, switch to another |
| `keep` | keep the account saved, stay signed out |
| `none` | do nothing |

## Where things live

- **macOS**: canonical login in Keychain `Claude Code-credentials`; saved accounts
  in Keychain service `claude-profiles-accounts`.
- **Linux/Windows**: canonical login file `~/.claude/.credentials.json`; saved
  accounts in `~/.claude-profiles/creds.json` (mode `0600`).
- Account metadata: `~/.claude-profiles/accounts.json`.

On macOS the first read of Claude's Keychain item may raise an "allow access"
dialog — click Allow. Run `claude-p doctor` if anything looks off.

## Scope

Switching changes the login for **all** Claude Code on the machine (the canonical
slot is shared). A `claude` session already running keeps its old login until
restarted.

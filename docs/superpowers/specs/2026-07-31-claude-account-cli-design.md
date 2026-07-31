# claude-profiles (`clp`) — Claude Account Manager CLI — Design

Date: 2026-07-31
Status: Approved (design)
Scope: macOS + Linux + Windows

## Problem

Claude Code CLI keeps a single active login per machine. Logging into a second
account overwrites the first, with no way back without re-authenticating. Users
want to keep several logged-in accounts, switch between them from the terminal,
and only re-login when a token actually breaks.

A prior solution exists as a VS Code extension (ClaudeSteps, macOS-only, using a
background file watcher). `claude-profiles` is a **standalone, cross-platform CLI**
that provides the same capability without an editor, and is **fully separate** from
that extension — its own metadata store, its own credential namespace. The two are
not meant to run their daemons at the same time (accepted; user's responsibility).

## How Claude Code stores login (must verify per-OS at implementation time)

- **macOS**: login lives in the **macOS Keychain**, not a file.
  - `service = "Claude Code-credentials"`, `account = <OS username>`.
  - There is no `~/.claude/.credentials.json` on macOS.
- **Linux**: believed to be a file `~/.claude/.credentials.json`.
- **Windows**: believed to be a file `%USERPROFILE%\.claude\.credentials.json`
  (may instead be DPAPI / Windows Credential Manager).

⚠️ The Linux and Windows locations are **assumptions**. The very first
implementation task is to empirically verify each OS's real credential location
and format. The `CredentialStore` interface (below) isolates this so a wrong guess
changes exactly one class, not the manager or the CLI.

Non-secret account identity is written by Claude Code to `~/.claude.json` under
`oauthAccount` (`emailAddress`, `displayName`, `organizationName`, `accountUuid`).
This is the label/identity source; the credential blob itself carries no email.

## Chosen approach — Keychain/file swap

One shared `~/.claude` for everything. Only the **canonical login credential** is
swapped when switching accounts. Nothing else changes.

Consequences (accepted):
- **Global scope**: switching changes the login for *all* Claude Code on the
  machine, because the canonical slot is shared. This matches "share everything,
  only login differs".
- A `claude` session already running keeps its old login until restarted.

## Architecture

Four layers, each with one purpose, each testable in isolation:

```
CLI (commander)  ──►  AccountManager  ──►  CredentialStore (interface)
                            │                   ├─ MacKeychainStore  (`security` CLI)
                            │                   └─ FileStore         (Linux/Windows blob file, 0600)
                            ├─►  MetadataStore   (JSON, atomic temp+rename write + file lock)
                            └─►  ProfileFile     (read/write ~/.claude.json oauthAccount, atomic)
Daemon (watch ~/.claude.json) ──► AccountManager.reconcileOnChange()
```

`AccountManager` ports the proven logic from the extension's `accountManager.ts`
(identity match `accountUuid` → `email` → fingerprint fallback; refresh the stored
credential when a token rotates) but depends only on the injected `CredentialStore`,
`MetadataStore`, and `ProfileFile` — so it is platform-agnostic and unit-testable
without a real Keychain or filesystem.

### CredentialStore (interface)

```ts
interface CredentialStore {
  isAvailable(): boolean;              // platform + backend present
  readCanonical(): Promise<string>;    // current active login blob ('' if none)
  writeCanonical(blob: string): Promise<void>;
  readSaved(name: string): Promise<string>;
  writeSaved(name: string, blob: string): Promise<void>;
  deleteSaved(name: string): Promise<void>;
}
```

| OS | Canonical slot (Claude's) | Saved-account storage |
|----|---------------------------|-----------------------|
| macOS | Keychain `Claude Code-credentials` / OS-user | Keychain service **`claude-profiles-accounts`** |
| Linux | `~/.claude/.credentials.json` | `~/.claude-profiles/creds/<name>.json` (chmod 600) |
| Windows | `%USERPROFILE%\.claude\.credentials.json` | `%USERPROFILE%\.claude-profiles\creds\<name>.json` (user-only ACL) |

`FileStore` serves both Linux and Windows (path resolution differs; permission
hardening differs). A future `WinCredStore` can replace it for Windows if
verification shows credentials live in Credential Manager rather than a file.

### MetadataStore

JSON at `~/.claude-profiles/accounts.json`. Same shape as the extension:

```jsonc
{ "accounts": [ {
  "name": "ba@itrvn.com", "email": "ba@itrvn.com",
  "displayName": "…", "organizationName": "ITR",
  "fingerprint": "<sha256 of blob>", "savedAt": "<iso>",
  "oauthAccount": { /* full snapshot from ~/.claude.json */ }
} ] }
```

Writes are **atomic** (write temp file + `rename`) and guarded by a file lock —
fixing a race the extension had, so a daemon and a foreground command never
corrupt the store.

### ProfileFile

Reads `oauthAccount` from `~/.claude.json` for labels/identity, and on `switch`
restores the saved `oauthAccount` so `claude /status` shows the right profile.
Writes the whole file back **atomically** (read-modify-write, temp+rename) to
avoid clobbering the large, Claude-owned config file. Best-effort; never corrupts.

## Behavior

### Auto-save (primary capture path — no manual `save` command)

The daemon watches `~/.claude.json`. On each change, `reconcileOnChange`:

- **New login** (blob fingerprint not yet saved, and an email is present) →
  snapshot it as an account named by its email. If Claude wrote the credential
  before populating `oauthAccount`, the email is briefly absent; the daemon simply
  auto-saves on the *next* change once the email appears. No user action needed.
- **Known login / switch** (identity or fingerprint matches a saved account) →
  remember it as active; if the token rotated (fingerprint changed) refresh the
  stored credential so future switches use a valid token.
- **Logout** (canonical credential AND `oauthAccount` both gone) → apply the
  configured `logoutBehavior` (below).

`reconcileOnChange` never throws — safe to call from a watcher.

There is **no manual `save` command**. Custom names are set with `clp rename`.
`clp daemon install` runs one reconcile immediately so the current login is
captured at setup time, closing the only gap where nothing was watching yet.

### Logout behavior (configurable)

`~/.claude-profiles/config.json`:

```jsonc
{ "logoutBehavior": "delete-switch" }
```

| value | on logout |
|-------|-----------|
| `delete-switch` (**default**) | forget the logged-out account, then switch to the most-recently-saved remaining account |
| `keep-switch` | keep the account saved, switch to another |
| `keep` | keep the account saved, do nothing else (stay signed out) |
| `none` | do nothing |

Default `delete-switch` matches the extension's behavior (user's explicit choice).
The other values exist because deleting the only backup of an account on logout is
a real data-loss risk; the toggle lets the user opt out without a code change.

## CLI commands

```
clp list                 # (ls) list saved accounts, mark the active one
clp current              # (status/whoami) show the active login
clp switch <name>        # (use) make <name> the active login
clp remove <name>        # (rm) forget a saved account
clp rename <old> <new>   # relabel / rekey a saved account
clp daemon run           # foreground reconcile loop (invoked by launchd/systemd/Task Scheduler)
clp daemon start|stop|status
clp daemon install|uninstall   # create/remove OS autostart, and run one reconcile on install
```

- Output is human-readable by default; `--json` on read commands for scripting.
- On an unsupported platform / missing backend, commands print a clear message and
  exit non-zero rather than crashing.

## Daemon & autostart

- `daemon run` watches `~/.claude.json` (`fs.watch`, debounced ~500ms) and calls
  `reconcileOnChange`. On start it seeds the active-login memory (`noteActive`) so a
  logout occurring before any file change still knows which account to forget.
- `daemon install` writes the OS autostart unit and runs one immediate reconcile:
  - **macOS**: a launchd user agent `~/Library/LaunchAgents/…plist`.
  - **Linux**: a systemd **user** unit `~/.config/systemd/user/claude-profiles.service`.
  - **Windows**: a Task Scheduler logon task (or Startup entry).
- `daemon start/stop/status` wrap the OS mechanism (or manage a PID file when run
  bare). Single-daemon assumption holds because the app is fully separate from the
  extension.

## Error handling

- **Unsupported OS / backend absent**: `CredentialStore.isAvailable()` false →
  feature disabled with a clear message; no crash.
- **macOS ACL prompt**: first `security …` read of Claude's slot may raise an
  "allow access" dialog. Expected; surface guidance if the read fails/empties.
- **Empty/invalid canonical blob on save**: skip (daemon) / message (unreachable
  via CLI since save is auto-only).
- **Switch target missing**: user-visible error; current login left intact.
- **~/.claude.json malformed or mid-write**: best-effort; never corrupt it.
- **Concurrent writes**: atomic temp+rename + file lock on the metadata store.

## Testing

- Port the extension's ~38 `AccountManager` unit tests, injecting a mock
  `CredentialStore` + fake `MetadataStore`/`ProfileFile` (no real Keychain/fs).
- Add `FileStore` tests (Linux/Windows path + permission behavior, mocked fs).
- Add a daemon debounce/reconcile test (fake watcher events → expected calls).
- Target ≥90% coverage on the manager and stores.
- Per-OS credential-location verification is a manual implementation task, not a
  unit test.

## Distribution

- npm package `claude-profiles`, `bin: { clp: … }`. `npm i -g claude-profiles`.
- Node ≥18. No native modules: macOS uses the `security` CLI, Linux/Windows use
  plain files — so no `keytar`/node-gyp build step.

## Out of scope (v1)

- Windows Credential Manager / DPAPI backend (start file-based; add if verification
  requires it).
- Importing accounts from the ClaudeSteps extension's store.
- Detecting auth failures from `claude` output (re-login is manual; the daemon
  re-captures it automatically).
```

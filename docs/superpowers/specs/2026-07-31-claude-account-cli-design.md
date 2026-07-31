# claude-profiles (`claude-p`) — Claude Account Manager CLI — Design

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
that extension — its own metadata store, its own credential namespace. It runs no
background process of its own; if the extension's watcher is also active it may
react to the same login change, but since both only swap the one canonical slot the
end state converges (accepted; user's responsibility).

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

Four layers, each with one purpose, each testable in isolation. There is **no
background daemon**: every CLI command runs `reconcileOnChange()` first, so
auto-save and active-detection happen lazily on use (see Behavior).

```
CLI (commander)  ──►  AccountManager  ──►  CredentialStore (interface)
  (reconcile first)         │                   ├─ MacKeychainStore  (`security` CLI)
                            │                   └─ FileStore         (Linux/Windows blob file, 0600)
                            ├─►  MetadataStore   (JSON, atomic temp+rename write + file lock)
                            └─►  ProfileFile     (read/write ~/.claude.json oauthAccount, atomic)
```

`AccountManager` ports the proven logic from the extension's `accountManager.ts`
(identity match `accountUuid` → `email` → fingerprint fallback; refresh the stored
credential when a token rotates) but depends only on the injected `CredentialStore`,
`MetadataStore`, and `ProfileFile` — so it is platform-agnostic and unit-testable
without a real Keychain or filesystem. Unlike the extension, it is driven by
explicit command invocations rather than a file watcher, so the "which account was
active" memory is **persisted to disk** (see MetadataStore `lastActive`) instead of
held in process memory.

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
{
  "lastActive": "ba@itrvn.com",   // name last observed as the active login; used to
                                  // know which account to forget on a later logout
  "accounts": [ {
    "name": "ba@itrvn.com", "email": "ba@itrvn.com",
    "displayName": "…", "organizationName": "ITR",
    "fingerprint": "<sha256 of blob>", "savedAt": "<iso>",
    "oauthAccount": { /* full snapshot from ~/.claude.json */ }
  } ]
}
```

Writes are **atomic** (write temp file + `rename`) and guarded by a file lock, so
two `claude-p` commands running at once never corrupt the store. Persisting
`lastActive` here (rather than in process memory) makes logout handling
deterministic — any invocation, in any terminal, knows what the last active
account was.

### ProfileFile

Reads `oauthAccount` from `~/.claude.json` for labels/identity, and on `switch`
restores the saved `oauthAccount` so `claude /status` shows the right profile.
Writes the whole file back **atomically** (read-modify-write, temp+rename) to
avoid clobbering the large, Claude-owned config file. Best-effort; never corrupts.

## Behavior

### Reconcile-on-command (capture path — no daemon, no manual `save`)

Every `claude-p` command runs `reconcileOnChange()` **before** its own work. It reads
the current canonical login and, comparing against the saved store:

- **New login** (blob fingerprint not yet saved, and an email is present) →
  snapshot it as an account named by its email, and record it as `lastActive`. If
  Claude wrote the credential before populating `oauthAccount`, the email is briefly
  absent and the login is skipped; the *next* `claude-p` command captures it once
  the email is present. No user action needed.
- **Known login / switch** (identity or fingerprint matches a saved account) →
  record it as `lastActive`; if the token rotated (fingerprint changed) refresh the
  stored credential so future switches use a valid token.
- **Logout** (canonical credential AND `oauthAccount` both gone) → apply the
  configured `logoutBehavior` (below), using `lastActive` to know which account was
  signed in.

`reconcileOnChange` never throws — a reconcile failure never blocks the command the
user actually asked for.

Because capture is lazy, a login that happens while the user never runs `claude-p`
is not saved until the next invocation. This is an accepted trade-off for dropping
the background daemon: in practice the user runs `claude-p switch`/`list` around the
logins they care about, so those get captured. There is **no manual `save`
command**; custom names are set with `claude-p rename`.

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
claude-p list                 # (ls) list saved accounts, mark the active one
claude-p current              # (status/whoami) show the active login
claude-p switch <name>        # (use) make <name> the active login
claude-p remove <name> [-y]   # (rm) forget a saved account; -y skips the confirm prompt
claude-p rename <old> <new>   # relabel / rekey a saved account
claude-p doctor               # diagnose OS credential path, config, and store
```

- Every command runs `reconcileOnChange()` first (see Behavior), so simply running
  `claude-p list` after a new login is enough to capture it.
- Global flags: `--json` (read commands, machine-readable output), `--version`, `--help`.
  Each command also has `claude-p <command> --help`.
- `remove` asks for confirmation by default; `-y`/`--yes` skips it (for scripts).
- `doctor` prints a per-section checklist (system, Claude login, claude-profiles
  config/store/credentials) with ✓/✗/○ per check and a fix hint on each failure;
  exits non-zero if any check fails. It is the first thing to run when the per-OS
  credential location is wrong.
- On an unsupported platform / missing backend, commands print a clear message and
  exit non-zero rather than crashing.

## Error handling

- **Unsupported OS / backend absent**: `CredentialStore.isAvailable()` false →
  feature disabled with a clear message; no crash.
- **macOS ACL prompt**: first `security …` read of Claude's slot may raise an
  "allow access" dialog. Expected; surface guidance if the read fails/empties.
- **Reconcile failure**: swallowed — it never blocks the command the user asked for.
- **Switch target missing**: user-visible error; current login left intact.
- **~/.claude.json malformed or mid-write**: best-effort; never corrupt it.
- **Concurrent writes**: atomic temp+rename + file lock on the metadata store, so two
  `claude-p` commands at once can't corrupt it.

## Testing

- Port the extension's ~38 `AccountManager` unit tests, injecting a mock
  `CredentialStore` + fake `MetadataStore`/`ProfileFile` (no real Keychain/fs).
- Add `FileStore` tests (Linux/Windows path + permission behavior, mocked fs).
- Add reconcile-on-command tests: a command captures a new login, marks active, and
  a logout (via persisted `lastActive`) applies the configured behavior.
- Target ≥90% coverage on the manager and stores.
- Per-OS credential-location verification is a manual implementation task, not a
  unit test.

## Distribution

- npm package `claude-profiles`, `bin: { "claude-p": … }`. `npm i -g claude-profiles`.
- Node ≥18. No native modules: macOS uses the `security` CLI, Linux/Windows use
  plain files — so no `keytar`/node-gyp build step.

## Out of scope (v1)

- Windows Credential Manager / DPAPI backend (start file-based; add if verification
  requires it).
- Importing accounts from the ClaudeSteps extension's store.
- A background daemon / instant auto-save on login. Capture is lazy
  (reconcile-on-command); a daemon can be added later if instant capture is needed.
- Detecting auth failures from `claude` output (re-login is manual; the next
  `claude-p` command re-captures it automatically).
```

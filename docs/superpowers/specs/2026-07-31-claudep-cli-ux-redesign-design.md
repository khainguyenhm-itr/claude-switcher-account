# claudep — CLI UX Redesign

**Date:** 2026-07-31
**Status:** Approved (pending spec review)
**Scope:** Rename the command, streamline the command surface, and make terminal
output colored, aligned, and quick to act on. No changes to credential storage,
the daemon, or autostart behavior.

## Goal

The current `claude-p` CLI is functional but hard to use and hard to read:
monochrome output, brittle column padding, verbose commands (must type a full
email to switch), and a noisy switch message. Make it **concise and fast**:
short command name, number-based quick switching, and a clean colored list.

## Non-Goals

- No change to where credentials live: `~/.claude-profiles/`, Keychain services
  `Claude Code-credentials` and `claude-profiles-accounts` stay exactly as-is.
  **Renaming those would orphan every existing user's saved accounts.**
- No change to the npm package name (`claude-login-switcher`).
- No change to daemon, autostart, doctor, or reconcile logic.

## Decisions (locked)

| Question | Decision |
|----------|----------|
| Command name | `claude-p` → **`claudep`** (no hyphen; keeps identity, no Shift) |
| Scope | Both command surface **and** display |
| List style | **Numbered** quick-switch, colored |
| Color | **Yes**, auto-disabled on pipe / `NO_COLOR` / `--json` |
| Quick switch | **Bare number only**: `claudep 2` (names still need `switch`) |
| `current`/`status` | **Merged** into `list` (kept as aliases) |
| Aliases | **Keep** `ls`, `use`, `rm`; `status`/`current` become aliases of `list` |
| Menu style | **Sectioned + hotkey** — header + divider, accounts navigable, `r`/`d`/`q` hotkeys |
| Remove in menu | **Dropped** — destructive action lives only at `claudep remove <name\|n>` |
| Usage / reset / used% | **Out of scope** — rate-limit data is live server-side, not cached on disk; showing it would require calling an unofficial endpoint per stored token |

## Display grammar (applied to every screen)

One consistent language across all output:

- **Indent** every line by 2 spaces.
- **Multi-line screens** (menu, list, doctor, version) open with a header
  `claudep · <context>` (bold + dim) and a divider rule.
- **Result lines** follow one pattern: `<symbol> <message>` plus an optional
  dim continuation line indented 4 spaces (replaces ad-hoc parentheticals).
- **Symbols carry fixed roles**: `●` green = active/on · `○` dim = off ·
  `✓` green = success · `✗` red = error (exit 1) · `!` yellow = notice ·
  `❯` cyan = cursor · `→` dim / hotkey letters cyan = interactive.
- **Colors** are role-based (green active/success, red error, yellow notice,
  cyan interactive, dim secondary) and auto-off on pipe / `NO_COLOR` / `--json`.

`SYMBOLS.warn` changes from `⚠` to `!`. Result-message wording is the two-line
pattern above (e.g. switch → `✓ Now using <name>` + dim `restart running claude
sessions to apply`; errors → `✗ <what>` + dim `run claudep list …`).

## 1. Command Surface

```
claudep                        # interactive menu (unchanged behavior)
claudep <n>                    # NEW: switch to account #n from the list
claudep list                   # (ls, status, current) numbered list, active marked
claudep switch <name|n>        # (use) switch by name OR number
claudep remove <name|n> [-y]   # (rm) forget account by name or number
claudep rename <old> <new>     # relabel
claudep version                # version + npm update check
claudep doctor                 # diagnose
claudep daemon install|status|uninstall|run
```

Changes from today:

- **`claudep <n>`** — a bare integer at the top level switches to that account.
  Implemented via an optional argument on the default (menu) action: no argument
  → menu; an integer argument → resolve by index and switch; a non-integer
  argument → error (`Unknown account 'x' — run 'claudep list'`). A first token
  that matches a subcommand name still routes to the subcommand (Commander
  precedence), so `list`, `switch`, etc. are unaffected.
- **`switch <name|n>` and `remove <name|n>`** accept an index too. Resolution
  rule: if the argument is all digits and in range, treat it as an index;
  otherwise treat it as a name. (An account literally named "2" is
  unreachable-by-name via this shortcut — acceptable; names are emails.)
- **`current` command removed**; `current` and `status` become **aliases of
  `list`** so existing muscle memory still works.

### Stable numbering

Both the list display and index resolution use one shared ordering helper,
`orderAccounts(views)`, sorting **by email ascending** (case-insensitive). This
ordering is **independent of which account is active**, so `claudep 2` always
refers to the same account across switches. Numbers are 1-based.

Index resolution lives in `AccountManager` as `resolveByIndex(n): name | null`
(reads accounts, applies `orderAccounts`, returns the name at position `n-1` or
null). `switch`/`remove`/bare-number all go through it.

## 2. `list` Display

Colored, dynamically aligned, with a switch hint:

```
  1  ● ba@itrvn.com         itrvn        active
  2    personal@gmail.com   —            3d ago
  3    work@acme.io         Acme Inc     2w ago

  → claudep <n> to switch
```

Formatting rules (`formatList(views, nowMs, colors)`):

- **Index** — 1-based, right-aligned to the widest index width, rendered `dim`.
- **Marker** — `●` in `green` when active; a space otherwise.
- **Email** — active row `bold` + `green`; others default. Column width =
  `max(email lengths)` (no fixed floor that wastes space; small minimum of ~12).
- **Org** — `dim`; truncated with `…` to a max width (~20) so a long org name
  can’t break alignment. `—` when absent.
- **Last column** — active row → `green` `active`; others → `dim` relative time
  (`formatRelative`, unchanged).
- **Footer** — a single `dim` hint line `→ claudep <n> to switch`, shown only
  when there is more than one account and color is enabled (i.e. interactive).
  The `N accounts` count line is dropped (the numbering already conveys count).
- **Empty state** — unchanged message, updated to say `claudep list`.
- **External-login note** — if there is an active login not among the saved
  accounts (the old `current` "external login … not yet saved" case), append one
  `dim` note line. This preserves the information the removed `current` command
  used to surface.

`--json` output is unchanged in shape (array of `AccountView`), always uncolored.

## 3. Other Output

- **Switch success** uses the two-line result pattern:
  `✓ Now using ba@itrvn.com` + dim `restart running claude sessions to apply`.
- **Menu** (`claudep`, no args) is **sectioned + hotkey**: header
  `claudep · N accounts`, a divider, then one numbered account row per account
  (arrow / number keys navigate & switch), a divider, and a hotkey bar
  `r rename · d doctor · q quit`. The selected row is drawn with a background
  highlight (not by recoloring the text) so the active row keeps its green.
  **Remove is not in the menu** — it stays a command only. `interactiveSelect`
  therefore separates navigable account rows from action hotkeys (`r`/`d`/`q`),
  and `MenuAction` drops the `remove` variant.
- All user-facing strings that say `claude-p` become `claudep` (help text,
  messages, empty state, daemon log prefix `[claude-p]` → `[claudep]`, doctor
  hints, version/update hint). **Storage paths and Keychain service names are
  NOT touched.**

## 4. Color Module

New `src/color.ts`:

```ts
export interface Colors {
  green(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
  cyan(s: string): string;
  red(s: string): string;
  yellow(s: string): string;
}
export function makeColors(enabled: boolean): Colors;
```

`makeColors(false)` returns identity functions (every method returns its input
unchanged) so tests assert stable, uncolored strings and piped output is clean.

CLI computes `enabled = process.stdout.isTTY && !process.env.NO_COLOR` and passes
`makeColors(enabled)` into `formatList` / `formatCurrent` / menu rendering.
`--json` paths always use `makeColors(false)`.

Rationale for threading `colors` as a parameter (vs a module global): keeps the
format functions **pure**, matching the existing dependency-injection style, so
`format.test.ts` stays deterministic.

## Affected Files

| File | Change |
|------|--------|
| `package.json` | `bin`: `claude-p` → `claudep` |
| `src/color.ts` | **new** — `makeColors`, `Colors` |
| `src/format.ts` | numbered + colored `formatList`; `colors` param; drop count line; `orderAccounts` (or import) |
| `src/accountManager.ts` | `resolveByIndex(n)`; shared `orderAccounts` ordering |
| `src/cli.ts` | bare-number arg on default action; `switch`/`remove` accept index; `list` aliases `status`/`current`; remove `current` command; wire `makeColors`; trim switch message |
| `src/menu.ts` | numbered + colored rows; shortened title |
| `src/types.ts` | minor (if a shared ordering/type is added) |
| user-facing strings in `doctor.ts`, `daemon.ts`, `version.ts`, `app.ts`, `credentialStore.ts`, `macKeychainStore.ts` | `claude-p` → `claudep` (command references only) |
| `scripts/postinstall.mjs` | `claude-p` → `claudep` in messages |
| `README.md` | command name + all examples → `claudep` |
| `test/*` | update expectations; add tests for `resolveByIndex`, bare-number switch, color on/off |

## Testing

- `format.test.ts` — numbered layout, active marker, org truncation, footer
  visibility rules, empty state; assert **uncolored** via `makeColors(false)`,
  plus one case asserting ANSI codes present via `makeColors(true)`.
- `accountManager` tests — `orderAccounts` stability (order unaffected by active),
  `resolveByIndex` in-range / out-of-range / empty.
- `cli.commands.test.ts` — `claudep 2` switches the right account; `switch 2` and
  `switch <name>` both work; non-integer bare arg errors; `status`/`current`
  alias `list`.
- `menu.test.ts` — labels carry indices; dispatch unchanged.
- Keep coverage at/above current (~91% stmt / ~94% line).

## Rollout Note

Renaming the `bin` means a reinstall replaces the `claude-p` command with
`claudep`; the old `claude-p` symlink from a prior global install is left behind
until `npm rm -g` / reinstall. Saved accounts are untouched (they live outside
the package). Optional (not in scope unless requested): ship **both** `claude-p`
and `claudep` bins for one release as a compatibility bridge.

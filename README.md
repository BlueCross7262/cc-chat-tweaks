# cc-chat-tweaks

Chat display tweaks for Claude Code. Each tweak is a mod feature with its own `use-*` switch in your settings.

## Install

```
/plugin install cc-chat-tweaks --marketplace BlueCross7262/cc-chat-tweaks
```

Answer `y` to add the marketplace, then pick a scope.

## Settings

Every feature is off until you turn it on. Switches live under `ccChatTweaks.chat` in any settings file (`settings.json`, `settings.local.json`, project or user). A boolean in a higher-precedence source wins. A key that is absent uses its default, `false`.

| Key | Default | Feature |
|---|---|---|
| `use-tool-fold` | `false` | Fold consecutive tool calls into one line. |
| `use-progress-line` | `false` | Draw the phase-chain progress line above the prompt. |
| `use-edit-summary` | `false` | Draw `Edit` and `Write` calls as one summary line. |

```json
{
  "ccChatTweaks": {
    "chat": {
      "use-tool-fold": true,
      "use-progress-line": true,
      "use-edit-summary": false
    }
  }
}
```

### Add the switches to settings.json

`/tweaks-doctor --apply` writes every missing switch into your user `settings.json` with its default, `false`, so you can see and flip them. It never changes a value that is already there and it leaves a file that is not plain JSON alone.

## Doctor

```
/tweaks-doctor
```

Prints each switch with its value and the source it came from, the fold counters, the progress-line state and a list of checks. Add `--apply` to write the missing switches (see above).

## Features

### `use-tool-fold`

Consecutive tool calls with no assistant message between them fold into one line:

```
● Calling Read, Edit, replace_content 5 times ... +9 -3
● Called Read, Edit, replace_content 7 times ... +13 -5
```

- `Calling` with a blinking blue `●` while a call has no result yet. `Called` with a green `●` once every call has finished. The colours follow your theme.
- The `+N -M` total counts the lines changed by `Edit`, `Write` and Serena's `replace_content`, `insert_after_symbol`, `insert_before_symbol` and `replace_symbol_body`. `Edit` and `Write` read the exact diff. The Serena figures come from the call arguments and are approximate: `replace_symbol_body` counts added lines only.
- Every run folds, even a single call: `● Called Edit 1 time ... +3 -1`. A failed call keeps its own row, so an error never hides behind the summary.
- Calls made by subagents are not folded.
- Rows inside a folded line cannot be opened from the line. Use the full transcript (`ctrl+o`).
- Clicking a folded line for `Grep`, MCP tools and other calls the engine groups can still select the row (a blank line below, an inverted background). The engine draws that, and a plugin cannot turn it off.

### `use-edit-summary`

An `Edit` or `Write` call that is not folded draws as one line. The diff body is hidden until you click the line. Calls fold while `use-tool-fold` is on, so this row shows when that switch is off. A count of zero is left out.

```
● Update(src/app.ts) +3 -1
● Write(notes.md) +12
```

### `use-progress-line`

Above the prompt: `Phase n/N · Story n/N · title`. It reads the chain state files that the [let-me-go-home](https://github.com/BlueCross7262/let-me-go-home) plugin writes under `.lmgh/state/sessions`. Without that plugin the line stays empty.

## Options

Set at install time or with `claude plugin configure cc-chat-tweaks`.

| Option | Meaning |
|---|---|
| `projectRoot` | The repository that runs the phase chain. Empty uses the session's own root. |
| `sessionId` | The session id that owns the chain state. Empty uses the session's own id. |
| `debugFile` | Absolute path of a JSON file that receives the shown progress line and read failures. Empty writes nothing. |

## Develop

```
claude --plugin-dir <path to this folder>
claude plugin validate <path to this folder>
claude plugin test <path to this folder>
```

The sources are TypeScript loaded as is, with no build step.

| File | Role |
|---|---|
| `hooks/register.tsx` | The hooks module: the three features. `$` cannot cross an import, so every function that uses it lives here. |
| `hooks/settings.ts` | The `use-*` switches, their defaults, their lookup across settings sources and the missing-switch merge. |
| `hooks/doctor.ts` | Pure report building for `/tweaks-doctor`. |
| `hooks/runs.ts` | Pure run bookkeeping: boundaries, pending state, change totals. |
| `hooks/edit-counts.ts` | Pure line counting and unified-diff building. |
| `hooks/line.ts` | Pure progress-line building. |
| `types/index.d.ts` | The `$.state` contract. |

To add a feature, add its key and default to `FLAG_DEFAULTS` in `hooks/settings.ts`, add it to `flagsOf`, and read the flag in the hook that draws it.

## License

MIT

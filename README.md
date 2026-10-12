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
| `use-edit-summary` | `false` | Draw `Edit` and `Write` calls as one summary line. |

```json
{
  "ccChatTweaks": {
    "chat": {
      "use-tool-fold": true,
      "use-edit-summary": false
    }
  }
}
```

## Doctor

```
/tweaks-doctor
```

First it writes every switch your user `settings.json` lacks, with its default, `false`, so you can see and flip them. It never changes a value that is already there. It leaves a file that is not plain JSON alone and says so.

Then it prints each switch with its value and the source it came from, the fold counters, the environment and a list of checks.

## Features

### `use-tool-fold`

Consecutive tool calls with no assistant message between them fold into one line:

```
● Calling 5 times Read, Edit, replace_content ... +9 -3
● Called 7 times Read, Edit, replace_content ... +13 -5
```

- `Calling` with a blinking blue `●` while a call has no result yet. `Called` with a green `●` once every call has finished. The colours follow your theme.
- The `+N -M` total counts the lines changed by `Edit`, `Write` and Serena's `replace_content`, `insert_after_symbol`, `insert_before_symbol` and `replace_symbol_body`. `Edit` and `Write` read the exact diff. The Serena figures come from the call arguments and are approximate: `replace_symbol_body` counts added lines only.
- Every run folds, even a single call: `● Called 1 time Edit ... +3 -1`. A failed call keeps its own row, so an error never hides behind the summary.
- A call row is not drawn while the model is still writing the call. The folded line appears when the call is stored. A call that is in no run, such as one made by a subagent, stays hidden until it has a result.
- Calls made by subagents are not folded.
- `AskUserQuestion` and `Skill` are never folded. Each keeps its own row and ends the run before it.
- Rows inside a folded line cannot be opened from the line. Use the full transcript (`ctrl+o`).
- Clicking a folded line for `Grep`, MCP tools and other calls the engine groups can still select the row (a blank line below, an inverted background). The engine draws that, and a plugin cannot turn it off.

### `use-edit-summary`

An `Edit` or `Write` call that is not folded draws as one line. The diff body is hidden until you click the line. Calls fold while `use-tool-fold` is on, so this row shows when that switch is off. A count of zero is left out.

```
● Update(src/app.ts) +3 -1
● Write(notes.md) +12
```

## Develop

```
claude --plugin-dir <path to this folder>
claude plugin validate <path to this folder>
claude plugin test <path to this folder>
```

The sources are TypeScript loaded as is, with no build step.

| File | Role |
|---|---|
| `hooks/register.tsx` | The hooks module: the features and the doctor command. `$` cannot cross an import, so every function that uses it lives here. |
| `hooks/settings.ts` | The `use-*` switches, their defaults, their lookup across settings sources and the missing-switch merge. |
| `hooks/doctor.ts` | Pure report building for `/tweaks-doctor`. |
| `hooks/runs.ts` | Pure run bookkeeping: boundaries, pending state, change totals. |
| `hooks/edit-counts.ts` | Pure line counting and unified-diff building. |
| `types/index.d.ts` | The `$.state` contract. |

To add a feature, add its key and default to `FLAG_DEFAULTS` and to `flagsOf` in `hooks/settings.ts`, and read the flag in the hook that draws it.

## License

MIT

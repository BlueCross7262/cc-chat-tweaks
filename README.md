# cc-chat-tweaks

Chat tweaks for Claude Code. Each tweak is a mod feature with its own `use-*` switch in your settings.

## Install

```
/plugin install cc-chat-tweaks --marketplace BlueCross7262/cc-chat-tweaks
```

Answer `y` to add the marketplace, then pick a scope.

## Settings

Every feature is off until you turn it on. Switches live under `ccChatTweaks` in any settings file (`settings.json`, `settings.local.json`, project or user). The tool-call tweaks sit in the `chat` group and the prompt upgrade in the `prompt` group. A boolean in a higher-precedence source wins. A key that is absent uses its default.

| Group | Key | Default | Feature |
|---|---|---|---|
| `chat` | `use-tool-fold` | `false` | Fold consecutive tool calls into one line. |
| `chat` | `use-edit-summary` | `false` | Draw `Edit` and `Write` calls as one summary line. |
| `prompt` | `use-prompt-upgrade` | `false` | Ask clarifying questions about your prompt and rewrite it before it is sent. |
| `prompt` | `use-questions` | `true` | Option of `use-prompt-upgrade`. When `false`, the prompt is rewritten without questions. |
| `prompt` | `use-silent-upgrade` | `true` | Option of `use-prompt-upgrade`. A prompt that starts or ends with the trigger is upgraded without the pane, and the draft is put in the prompt box without being sent. |
| `prompt` | `silent-trigger` | `+++` | The trigger text for the silent upgrade. |
| `prompt` | `min-length` | `10` | Shortest prompt that is upgraded, in characters. |
| `prompt` | `model` | `haiku` | The model of every upgrade call. An alias or a full model id. |
| `prompt` | `effort` | `low` | The effort of every upgrade call: `low`, `medium`, `high`, `xhigh` or `max`. |

```json
{
  "ccChatTweaks": {
    "chat": {
      "use-tool-fold": true,
      "use-edit-summary": false
    },
    "prompt": {
      "use-prompt-upgrade": false,
      "use-questions": true
    }
  }
}
```

The prompt switches are not read from the `chat` group. A `use-prompt-upgrade` or `use-questions` left there from an earlier version has no effect.

## Doctor

```
/tweaks-doctor
```

First it writes every switch your user `settings.json` lacks, with its default, so you can see and flip them. It never changes a value that is already there. It leaves a file that is not plain JSON alone and says so.

Then it prints each switch with its value and the source it came from, the fold counters, the prompt upgrade phase and threshold, the environment and a list of checks.

## Features

### `use-tool-fold`

Consecutive tool calls with no assistant message between them fold into one line:

```
● Calling 5 times Edit, Read, replace_content ... +9 -3
● Called 7 times Edit, Read, replace_content ... +13 -5
```

- Tool names sort with capital letters first, then lowercase, each from a to z. The line shows the 4 most used tools and ends with `…` when there are more.
- `Calling` with a blinking blue `●` while a call has no result yet. `Called` with a green `●` once every call has finished. The colours follow your theme.
- The `+N -M` total counts the lines changed by `Edit`, `Write` and Serena's `replace_content`, `insert_after_symbol`, `insert_before_symbol` and `replace_symbol_body`. `Edit` and `Write` read the exact diff. The Serena figures come from the call arguments and are approximate: `replace_symbol_body` counts added lines only.
- Every run folds, even a single call: `● Called 1 time Edit ... +3 -1`. A failed call folds in too: its row and error text are hidden, and the header adds an orange `N failed` count.
- A call row is not drawn while the model is still writing the call. The folded line appears when the call is stored. A call that is in no run, such as one made by a subagent, stays hidden until it has a result.
- Calls made by subagents are not folded.
- `AskUserQuestion`, `Skill` and `Agent` are never folded. Each keeps its own row and ends the run before it.
- Rows inside a folded line cannot be opened from the line. Use the full transcript (`ctrl+o`).
- Clicking a folded line for `Grep`, MCP tools and other calls the engine groups can still select the row (a blank line below, an inverted background). The engine draws that, and a plugin cannot turn it off.

### `use-edit-summary`

An `Edit` or `Write` call that is not folded draws as one line. The diff body is hidden until you click the line. Calls fold while `use-tool-fold` is on, so this row shows when that switch is off. A count of zero is left out.

```
● Update(src/app.ts) +3 -1
● Write(notes.md) +12
```

### `use-prompt-upgrade`

A prompt you type at the prompt box and send is held back, and a pane opens with four steps: your prompt, questions, rewrite, review.

- Haiku asks up to three questions with 3 to 5 options each. You pick an option, type your own answer, or skip.
- Haiku rewrites the prompt as prose and keeps pasted material as it is, wrapped in `<input>` tags.
- In the review you can ask for a change to the draft, undo it, edit the draft in the prompt box, send the draft, send the original, or cancel.
- Each upgraded prompt costs up to three Haiku calls on your plan or API key.
- Prompts typed while a turn runs, prompts with attachments, slash commands and short prompts pass through unchanged. So does every prompt when the pane cannot be placed or Haiku does not answer.
- `/prompt-upgrade status | threshold <n> | reset | probe on|off|show|clear` shows and tunes the feature.

Details, controls and limits: [docs/prompt-upgrade.md](docs/prompt-upgrade.md). Proof-of-concept results: [docs/prompt-upgrade-poc-results.md](docs/prompt-upgrade-poc-results.md).

## Develop

```
claude --plugin-dir <path to this folder>
claude plugin validate <path to this folder>
claude plugin test <path to this folder>
```

The sources are TypeScript loaded as is, with no build step.

| File | Role |
|---|---|
| `hooks/register.tsx` | The hooks module: the tool-call features and the doctor command. It calls `registerUpgrade(on)`. `$` cannot cross an import, so every function that uses it lives in this file or in `hooks/upgrade.tsx`. |
| `hooks/upgrade.tsx` | The prompt upgrade hooks, pane and command. |
| `hooks/upgrade-logic.ts` | Pure gate, flow and parsing logic for the prompt upgrade. |
| `hooks/upgrade-prompts.ts` | The Haiku system prompts for the prompt upgrade. |
| `hooks/settings.ts` | The `use-*` switches, their defaults, their lookup across settings sources and the missing-switch merge. |
| `hooks/doctor.ts` | Pure report building for `/tweaks-doctor`. |
| `hooks/runs.ts` | Pure run bookkeeping: boundaries, pending state, change totals. |
| `hooks/edit-counts.ts` | Pure line counting and unified-diff building. |
| `types/index.d.ts` | The `$.state` contract. |

To add a feature, add its key and default to `FLAG_DEFAULTS` and to `flagsOf` in `hooks/settings.ts`, and read the flag in the hook that draws it.

## License

MIT

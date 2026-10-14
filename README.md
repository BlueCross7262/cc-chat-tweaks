# cc-chat-tweaks

Chat tweaks for Claude Code. Each tweak is a mod feature with its own `use-*` switch in your settings.

## Install

```
/plugin install cc-chat-tweaks --marketplace BlueCross7262/cc-chat-tweaks
```

Answer `y` to add the marketplace, then pick a scope.

## Settings

Tool folding and the Edit/Write summary are off until you turn them on. The prompt upgrade is on by default, and it needs no setting to run. Switches live under `ccChatTweaks` in any settings file (`settings.json`, `settings.local.json`, project or user). Tool folding sits in `ccChatTweaks.chat.tool-fold`, the Edit/Write summary in `ccChatTweaks.chat` and the prompt upgrade in `ccChatTweaks.prompt.prompt-upgrade`. A later prompt feature gets its own group under `ccChatTweaks.prompt`. A boolean in a higher-precedence source wins. A key that is absent uses its default.

| Group | Key | Default | Feature |
|---|---|---|---|
| `chat.tool-fold` | `use` | `false` | Fold consecutive tool calls into one line. |
| `chat.tool-fold` | `unfolded-tools` | `["AskUserQuestion", "Skill", "Agent"]` | Option of `use`. The tools that are never folded. Each keeps its own row and ends the run before it. |
| `chat` | `use-edit-summary` | `false` | Draw `Edit` and `Write` calls as one summary line. |
| `prompt.prompt-upgrade` | `use` | `true` | Ask clarifying questions about your prompt and rewrite it before it is sent. |
| `prompt.prompt-upgrade` | `use-questions` | `false` | Option of `use`. When `false`, the prompt is rewritten without questions. |
| `prompt.prompt-upgrade` | `use-silent-upgrade` | `true` | Option of `use`. When `true`, the pane never opens, and only a prompt with the trigger is upgraded. The recommended answers to the questions are applied when `use-questions` is `true`, and the draft is put in the prompt box without being sent. |
| `prompt.prompt-upgrade` | `skip-silent-trigger` | `true` | Option of `use-silent-upgrade`. When `true`, the trigger check is skipped and every prompt of `min-length` or more is upgraded without the pane. |
| `prompt.prompt-upgrade` | `silent-triggers` | `["+++"]` | The trigger texts for the silent upgrade, as an array of strings. |
| `prompt.prompt-upgrade` | `min-length` | `10` | Shortest prompt that is upgraded, in characters. |
| `prompt.prompt-upgrade` | `model` | `sonnet` | The model of every upgrade call. An alias or a full model id. |
| `prompt.prompt-upgrade` | `effort` | `low` | The effort of every upgrade call: `low`, `medium`, `high`, `xhigh` or `max`. |

```json
{
  "ccChatTweaks": {
    "chat": {
      "tool-fold": {
        "use": true,
        "unfolded-tools": ["AskUserQuestion", "Skill", "Agent"]
      },
      "use-edit-summary": false
    },
    "prompt": {
      "prompt-upgrade": {
        "use": true,
        "use-questions": false
      }
    }
  }
}
```

The tool folding keys are read only from `ccChatTweaks.chat.tool-fold`. The old `ccChatTweaks.chat.use-tool-fold` and `ccChatTweaks.chat.unfolded-tools` have no effect.

The prompt upgrade keys are read only from `ccChatTweaks.prompt.prompt-upgrade`. Keys left in `ccChatTweaks.prompt` or `ccChatTweaks.chat` by an earlier version have no effect, and neither do the old `use-prompt-upgrade` key (now `use`) and the old `silent-trigger` key.

`/tweaks-doctor` writes the new groups with defaults and leaves the old keys where they are, so move your values by hand. If you had `use-tool-fold` set to `true`, folding is off until you set `chat.tool-fold.use`.

## Doctor

```
/tweaks-doctor
```

First it writes every key your user `settings.json` lacks, switches and value keys alike, with its default, so you can see and flip them. It never changes a value that is already there. It leaves a file that is not plain JSON alone and says so.

Then it prints each switch and each value key (`unfolded-tools`, `min-length`, `silent-triggers`, `model`, `effort`) by its path under `ccChatTweaks`, such as `chat.tool-fold.use`, with its value and the source it came from, the fold counters, the prompt upgrade phase and threshold, the environment and a list of checks.

## Features

### `chat.tool-fold.use`

Consecutive tool calls with no assistant message between them fold into one line:

```
● Calling 5 times Edit, Read, replace_content … +9 -3
● Called 7 times Bash, Edit, Grep, Read, … +13 -5
● Called 7 times Edit, Read, replace_content 2 failed … +13 -5
● Called 7 times Bash, Edit, Grep, Read, 2 failed … +13 -5
● Called 7 times Bash, Edit, Grep, Read, 2 failed
● Called 7 times Bash, Edit, Grep, Read, …
```

- Tool names sort with capital letters first, then lowercase, each from a to z. The line shows the 4 most used tools. When there are more, the list ends with a comma.
- The order after the names is `N failed`, then `…`, then `+N -M`.
- A `…` always sits in front of the `+N -M` total, and only there when something follows the names. When nothing follows a cut list, the list itself ends with `, …`, as in the last line above.
- `Calling` with a blinking blue `●` while a call has no result yet. `Called` with a green `●` once every call has finished. The colours follow your theme.
- The `+N -M` total counts the lines changed by `Edit`, `Write` and Serena's `replace_content`, `insert_after_symbol`, `insert_before_symbol` and `replace_symbol_body`. `Edit` and `Write` read the exact diff. The Serena figures come from the call arguments and are approximate: `replace_symbol_body` counts added lines only.
- Every run folds, even a single call: `● Called 1 time Edit … +3 -1`. A failed call folds in too: its row and error text are hidden, and the header adds an orange `N failed` count.
- A call row is not drawn while the model is still writing the call. The folded line appears when the call is stored. A call that is in no run, such as one made by a subagent, stays hidden until it has a result.
- Calls made by subagents are not folded.
- The tools in `unfolded-tools` are never folded. The default is `AskUserQuestion`, `Skill` and `Agent`. Each keeps its own row and ends the run before it.
  - The names are the exact tool names, with the same letter case, such as `Bash` or `mcp__serena__find_symbol`. A name that matches no tool does nothing.
  - Each entry is 1 to 100 characters after trimming. A blank or non-text entry is dropped, a repeated entry counts once, and only the first 50 entries are used.
  - An empty array `[]` means every tool folds. An array with no valid entry uses the default list. The list in the highest-precedence source wins and is not merged with the others.
  - The list is read on every tool call, so a change applies to the next call. Runs already stored keep the grouping they got.
- Rows inside a folded line cannot be opened from the line. Use the full transcript (`ctrl+o`).
- Clicking a folded line for `Grep`, MCP tools and other calls the engine groups can still select the row (a blank line below, an inverted background). The engine draws that, and a plugin cannot turn it off.

### `use-edit-summary`

An `Edit` or `Write` call that is not folded draws as one line. The diff body is hidden until you click the line. Calls fold while `chat.tool-fold.use` is on, so this row shows when that switch is off. A count of zero is left out.

```
● Update(src/app.ts) +3 -1
● Write(notes.md) +12
```

### `prompt.prompt-upgrade.use`

A prompt you type at the prompt box and send is held back, and a pane opens with four steps: your prompt, questions, rewrite, review.

- Haiku asks up to three questions with 3 to 5 options each. You pick an option, type your own answer, or skip.
- Haiku rewrites the prompt as prose with one sentence on each line and keeps pasted material as it is, wrapped in `<input>` tags.
- In the review you can ask for a change to the draft, undo it, edit the draft in the prompt box, send the draft, send the original, or cancel.
- Each upgraded prompt costs up to three model calls on your plan or API key. The default model is `sonnet`.
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

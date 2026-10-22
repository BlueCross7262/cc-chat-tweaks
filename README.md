# cc-chat-tweaks

Chat tweaks for Claude Code. Each tweak is a mod feature with its own `use-*` switch in your settings.

## Install

```
/plugin install cc-chat-tweaks --marketplace BlueCross7262/cc-chat-tweaks
```

Answer `y` to add the marketplace, then pick a scope.

## Settings

Tool folding, the Edit/Write summary and the character count are off until you turn them on. The prompt upgrade is on by default, and it needs no setting to run. Switches live under `ccChatTweaks` in any settings file (`settings.json`, `settings.local.json`, project or user). Tool folding sits in `ccChatTweaks.chat.tool-fold`, the Edit/Write summary in `ccChatTweaks.chat`, the prompt upgrade in `ccChatTweaks.prompt.prompt-upgrade` and the character count in `ccChatTweaks.prompt.char-count`. A later prompt feature gets its own group under `ccChatTweaks.prompt`. A boolean in a higher-precedence source wins. A key that is absent uses its default.

| Group | Key | Default | Feature |
|---|---|---|---|
| `chat.tool-fold` | `use` | `false` | Fold consecutive tool calls into one line. |
| `chat.tool-fold` | `unfolded-tools` | `["AskUserQuestion", "Skill", "Agent"]` | Option of `use`. The tools that are never folded. Each keeps its own row and ends the run before it. |
| `chat` | `use-edit-summary` | `false` | Draw `Edit` and `Write` calls as one summary line. |
| `prompt.prompt-upgrade` | `use` | `true` | Rewrite your prompt and put the draft in the prompt box, without sending it. |
| `prompt.prompt-upgrade` | `use-questions` | `false` | Option of `use`. When `true`, Haiku writes clarifying questions first and the recommended answers are applied. When `false`, the prompt is rewritten without questions. |
| `prompt.prompt-upgrade` | `skip-silent-trigger` | `true` | Option of `use`. When `true`, the trigger check is skipped and every prompt of `min-length` or more is upgraded. When `false`, only a prompt with the trigger is upgraded. |
| `prompt.prompt-upgrade` | `silent-triggers` | `["+++"]` | The trigger texts for the silent upgrade, as an array of strings. |
| `prompt.prompt-upgrade` | `silent-off-triggers` | `["---"]` | The texts that turn the silent upgrade off for one prompt, as an array of strings. The prompt is sent as it is, without the text. `[]` turns this off. |
| `prompt.prompt-upgrade` | `min-length` | `10` | Shortest prompt that is upgraded, in characters. |
| `prompt.prompt-upgrade` | `models.ask.model`, `models.ask.effort` | `sonnet`, `low` | The model and effort of the questions call. The model is an alias or a full model id. The effort is `low`, `medium`, `high`, `xhigh` or `max`. |
| `prompt.prompt-upgrade` | `models.rewrite.model`, `models.rewrite.effort` | `sonnet`, `low` | The model and effort of the rewrite call. |
| `prompt.prompt-upgrade` | `models.classify.model`, `models.classify.effort` | `haiku`, `low` | The model and effort of the prompt type call. |
| `prompt.char-count` | `use` | `false` | Show the number of characters in the prompt box at the right end of the line under it. |

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
      },
      "char-count": {
        "use": true
      }
    }
  }
}
```

The tool folding keys are read only from `ccChatTweaks.chat.tool-fold`. The old `ccChatTweaks.chat.use-tool-fold` and `ccChatTweaks.chat.unfolded-tools` have no effect.

The prompt upgrade keys are read only from `ccChatTweaks.prompt.prompt-upgrade`. Keys left in `ccChatTweaks.prompt` or `ccChatTweaks.chat` by an earlier version have no effect, and neither do the old `use-prompt-upgrade` key (now `use`) and the old `silent-trigger` key. The key `use-silent-upgrade` is retired: its value is not read, and the prompt upgrade behaves as it did with `true`. Use `skip-silent-trigger` to choose between upgrading every long prompt and upgrading only a prompt with the trigger.

`/tweaks-doctor` writes the new groups with defaults and leaves the old keys where they are, so move your values by hand. If you had `use-tool-fold` set to `true`, folding is off until you set `chat.tool-fold.use`.

## Doctor

```
/tweaks-doctor
```

First it writes every key your user `settings.json` lacks, switches and value keys alike, with its default, so you can see and flip them. It never changes a value that is already there. It leaves a file that is not plain JSON alone and says so.

Then it prints each switch and each value key (`unfolded-tools`, `min-length`, `silent-triggers`, `silent-off-triggers` and the six `models.<call>.model` and `models.<call>.effort` keys) by its path under `ccChatTweaks`, such as `chat.tool-fold.use`, with its value and the source it came from, the fold counters, the prompt upgrade phase and threshold, the environment and a list of checks. The checks include one warning for each old key `model`, `effort`, `type-model`, `type-effort` or `use-silent-upgrade` found in your settings, because the mod no longer reads them.

## Features

### `chat.tool-fold.use`

Consecutive tool calls with no assistant message between them fold into one line:

```
● Calling 5 times Edit, Read, replace_content … +9 -3
● Called 7 times in 3.4s Bash, Edit, Grep, Read, … +13 -5
● Calling 9 times Edit, Read, 1 failed … +9 -3
● Called 8 times Bash, Edit, Grep, Read, 1 failed … +2 -1
● Called 7 times Edit, Read, replace_content, 2 failed … +13 -5
● Called 7 times Bash, Edit, Grep, Read, 2 failed … +13 -5
● Called 7 times Bash, Edit, Grep, Read, 2 failed
● Called 7 times Bash, Edit, Grep, Read, …
```

- Tool names sort with capital letters first, then lowercase, each from a to z. The line shows the 4 most used tools. When there are more, the list ends with a comma.
- The order after the names is `N failed`, then `…`, then `+N -M`.
- `N failed` is set off from the names by a comma. A cut name list already ends with a comma, so no second one is added. This makes a cut list and a list of exactly 4 names look the same in front of `N failed`.
- A `…` always sits in front of the `+N -M` total, and only there when something follows the names. When nothing follows a cut list, the list itself ends with `, …`, as in the last line above.
- `in 3.4s` after the count is the time from the start of the first call to the end of the last call in the line. The end of a call is the moment the mod sees it finish. Its start is that moment minus the run time the engine reports for the call, so the time of a permission prompt is not in it. Calls that run at the same time count once. A gap between two calls, such as the model writing the next call, is in the time. The time is left out while the line says `Calling`, and when any call has no reported time.
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

A prompt you type at the prompt box and send is held back, upgraded in the background and put back in the prompt box as a draft. You read it and press Enter yourself. With the default `skip-silent-trigger` every prompt of `min-length` or more is upgraded. With `false` only a prompt that starts or ends with the trigger `+++` is. A prompt that starts or ends with `---` is sent as it is.

- With `use-questions` `true`, Haiku asks up to three questions with 3 to 5 options each, and the mod answers each one with its recommended option. You are not asked.
- Haiku rewrites the prompt as prose with one sentence on each line and keeps pasted material as it is, wrapped in `<input>` tags.
- A Korean prompt is put into one message: an instruction that asks Claude to write a prompt from the rewrite, print it and run it, the rewrite between `<source>` tags, and the answer rules for its type between `<hard rule>` tags. The mod builds the message in code, so the rules reach Claude as they are written.
- Each upgraded prompt costs up to three model calls on your plan or API key. The default model is `sonnet`.
- A prompt you type while a turn runs is upgraded like any other. The draft lands in the prompt box and the turn keeps running. Press Enter on the draft to send it. Prompts with attachments, slash commands, shell commands that start with `!`, prompts with an `@file` or `@agent` mention, prompts that are only pasted material and short prompts pass through unchanged. When Haiku does not answer, the prompt box gets your original prompt back and a toast says so.
- `/prompt-upgrade status | threshold <n> | reset | probe on|off|show|clear` shows and tunes the feature.

Details and limits: [docs/prompt-upgrade.md](docs/prompt-upgrade.md). Proof-of-concept results: [docs/prompt-upgrade-poc-results.md](docs/prompt-upgrade-poc-results.md).

### `prompt.char-count.use`

The number of characters in the prompt box shows as `N자` among the dim mode labels at the right end of the line under the prompt box:

```
? for shortcuts                                    focus & 12자
```

- A character is one grapheme, the unit you see: `안녕` is 2, `👨‍👩‍👧` is 1 and `é` written as `e` plus a combining accent is 1. Where the runtime has no `Intl.Segmenter`, the count falls back to code points, and those two examples count 5 and 2.
- Spaces and line breaks count.
- The label is left out while the box is empty.
- The count follows each key and paste, a draft the prompt upgrade puts in the box, and text another plugin fills in.
- A prompt that is sent as it is gets the box counted again after it is sent. A prompt that the prompt upgrade holds back keeps the old count until the draft lands in the box.
- The terminal and desktop surfaces draw the mode labels. Other surfaces show no count.
- After you change the switch, run `/reload-plugins`.

## Develop

```
claude --plugin-dir <path to this folder>
claude plugin validate <path to this folder>
claude plugin test <path to this folder>
```

The sources are TypeScript loaded as is, with no build step.

| File | Role |
|---|---|
| `hooks/register.tsx` | The hooks module: the tool-call features and the doctor command. It calls `registerUpgrade(on)` and `registerCharCount(on)`. `$` crosses an import only into a function declaration, so a function that takes `$` from another file is written `function name($) { ... }`, as `recount` in `hooks/char-count.tsx` is. |
| `hooks/upgrade.tsx` | The prompt upgrade hooks and command. |
| `hooks/char-count.tsx` | The character count hooks and `recount`, which the prompt upgrade calls after it fills the box and after a prompt is sent. |
| `hooks/char-count-logic.ts` | Pure grapheme and code point counting and the `N자` label. |
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

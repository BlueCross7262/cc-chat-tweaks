# cc-chat-tweaks

Chat tweaks for Claude Code. Each tweak is a mod feature with its own `use-*` switch in your settings.

## Install

```
/plugin install cc-chat-tweaks --marketplace BlueCross7262/cc-chat-tweaks
```

Answer `y` to add the marketplace, then pick a scope.

## Settings

Tool folding, the Edit/Write summary, the answer colours, the session band and the character count are off until you turn them on. The prompt upgrade is on by default, and it needs no setting to run. Switches live under `ccChatTweaks` in any settings file (`settings.json`, `settings.local.json`, project or user). Tool folding sits in `ccChatTweaks.chat.tool-fold`, the Edit/Write summary in `ccChatTweaks.chat`, the answer colours in `ccChatTweaks.chat.answer-colors`, the session band in `ccChatTweaks.chat.band`, the prompt upgrade in `ccChatTweaks.prompt.prompt-upgrade` and the character count in `ccChatTweaks.prompt.char-count`. A later prompt feature gets its own group under `ccChatTweaks.prompt`. A boolean in a higher-precedence source wins. A key that is absent uses its default.

| Group | Key | Default | Feature |
|---|---|---|---|
| `chat.tool-fold` | `use` | `false` | Fold consecutive tool calls into one line. |
| `chat.tool-fold` | `unfolded-tools` | `["AskUserQuestion", "Skill", "Agent"]` | Option of `use`. The tools that are never folded. Each keeps its own row and ends the run before it. |
| `chat` | `use-edit-summary` | `false` | Draw `Edit` and `Write` calls as one summary line. |
| `chat.answer-colors` | `use` | `false` | Draw the row that holds your answers to Claude's questions in three colours: title, question and answer. |
| `chat.band` | `use` | `false` | Draw one band above the prompt with the session at a glance. |
| `chat.band` | `use-turns` | `true` | Option of `use`. Show the number of prompts you sent in this session. |
| `chat.band` | `use-speed` | `true` | Option of `use`. Show the output speed of the current or last turn. |
| `chat.band` | `use-turn-cost` | `true` | Option of `use`. Show the cost of the current or last turn. |
| `chat.band` | `use-session-cost` | `true` | Option of `use`. Show the cost of the session. |
| `chat.band` | `use-context` | `true` | Option of `use`. Show how full the context window is. |
| `chat.band` | `use-cache` | `true` | Option of `use`. Show the time left on the prompt cache. |
| `chat.band` | `order` | `["turns", "speed", "turn-cost", "session-cost", "context", "cache"]` | Option of `use`. The order of the items. An item that is not in the array goes to the end, in the default order. Unknown names and repeats are left out. |
| `prompt.prompt-upgrade` | `use` | `true` | Send a Korean prompt with an instruction and answer rules added. A prompt without Korean characters is sent as you typed it. |
| `prompt.prompt-upgrade` | `skip-silent-trigger` | `true` | Option of `use`. When `true`, the trigger check is skipped and every prompt is upgraded; a Korean prompt shorter than `min-length` gets no prompt type call and only the common rules in the `<hard rule>` block. When `false`, only a prompt with the trigger is upgraded. |
| `prompt.prompt-upgrade` | `silent-triggers` | `["+++"]` | The trigger texts for the silent upgrade, as an array of strings. |
| `prompt.prompt-upgrade` | `silent-off-triggers` | `["---"]` | The texts that turn the silent upgrade off for one prompt, as an array of strings. The prompt is sent as it is, without the text. `[]` turns this off. |
| `prompt.prompt-upgrade` | `min-length` | `10` | Shortest prompt that gets the prompt type call and the type rules, in characters. A shorter Korean prompt gets the common rules only. A character is a grapheme, the unit the character count label uses, and white space at both ends is left out. |
| `prompt.prompt-upgrade` | `models.classify.model`, `models.classify.effort` | `haiku`, `low` | The model and effort of the prompt type call. The model is an alias or a full model id. The effort is `low`, `medium`, `high`, `xhigh` or `max`. |
| `prompt.char-count` | `use` | `false` | Show the number of characters in the prompt box at the right end of the line under it. |

```json
{
  "ccChatTweaks": {
    "chat": {
      "tool-fold": {
        "use": true,
        "unfolded-tools": ["AskUserQuestion", "Skill", "Agent"]
      },
      "use-edit-summary": false,
      "answer-colors": {
        "use": true
      },
      "band": {
        "use": true,
        "use-turns": true,
        "use-speed": true,
        "use-turn-cost": true,
        "use-session-cost": true,
        "use-context": true,
        "use-cache": true,
        "order": ["turns", "speed", "turn-cost", "session-cost", "context", "cache"]
      }
    },
    "prompt": {
      "prompt-upgrade": {
        "use": true
      },
      "char-count": {
        "use": true
      }
    }
  }
}
```

The tool folding keys are read only from `ccChatTweaks.chat.tool-fold`. The old `ccChatTweaks.chat.use-tool-fold` and `ccChatTweaks.chat.unfolded-tools` have no effect.

The prompt upgrade keys are read only from `ccChatTweaks.prompt.prompt-upgrade`. Keys left in `ccChatTweaks.prompt` or `ccChatTweaks.chat` by an earlier version have no effect, and neither do the old `use-prompt-upgrade` key (now `use`) and the old `silent-trigger` key. The removed keys `use-rewrite`, `use-questions`, `use-silent-upgrade`, `model`, `effort`, `models.ask` and `models.rewrite` are not read either, and doctor does not warn about them, so remove them by hand.

`/tweaks-doctor` writes the new groups with defaults and leaves the old keys where they are, so move your values by hand. If you had `use-tool-fold` set to `true`, folding is off until you set `chat.tool-fold.use`.

## Doctor

```
/tweaks-doctor
```

First it writes every key your user `settings.json` lacks, switches and value keys alike, with its default, so you can see and flip them. It never changes a value that is already there. It leaves a file that is not plain JSON alone and says so.

Then it prints each switch and each value key (`unfolded-tools`, `min-length`, `silent-triggers`, `silent-off-triggers`, `models.classify.model`, `models.classify.effort` and `order`) by its path under `ccChatTweaks`, such as `chat.tool-fold.use`, with its value and the source it came from, the fold counters, the prompt upgrade threshold, the environment and a list of checks. The checks include one warning for each old key `type-model` or `type-effort` found in your settings, because the mod no longer reads them.

## Features

### `chat.tool-fold.use`

Consecutive tool calls with no assistant message between them fold into one line:

```
● Calling 5 times Edit, Read, replace_content … +9 -3
● Called 7 times in 3.4s Bash, Edit, Grep, Read … +13 -5
● Calling 9 times Edit, Read, 1 failed … +9 -3
● Called 8 times Bash, Edit, Grep, Read, 1 failed … +2 -1
● Called 7 times Edit, Read, replace_content, 2 failed … +13 -5
● Called 7 times Bash, Edit, Grep, Read, 2 failed … +13 -5
● Called 7 times Bash, Edit, Grep, Read, 2 failed
● Called 7 times Bash, Edit, Grep, Read …
```

- Tool names sort with capital letters first, then lowercase, each from a to z. The line shows the 4 most used tools.
- The order after the names is `N failed`, then `…`, then `+N -M`.
- `N failed` is set off from the names by a comma. A cut list and a list of exactly 4 names look the same in front of `N failed`.
- A `…` is set off by a space, never by a comma. It sits in front of the `+N -M` total whenever the line has one. A cut name list with nothing after it ends with ` …`, as in the last line above. A cut name list followed by `N failed` and no total shows no `…`.
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

### `chat.answer-colors.use`

The row the engine draws after you answer an `AskUserQuestion` dialog is drawn again with one colour for each zone: a cyan title, a light blue question and an amber answer:

```
● User answered Claude's questions:
  ⎿  · <question> → <answer>
```

- The title and its `●` are `rgb(95,158,160)`, the question with its `·` and `→` is `rgb(143,188,203)` and the answer is `rgb(255,200,100)`. The `⎿` keeps the theme's dim colour.
- A free text response is drawn as `· <response>`, the answer in the answer colour. As in the engine row, the question rows are left out when there is a response and no follow-up.
- The title text follows the engine's: `User asked Claude for more questions` is drawn for a follow-up.
- A dialog you decline is drawn the same way: the `User declined to answer questions` title in the title colour and one line per question, `· <question> (<option> / <option>)`, in the question colour. The lines come from the call input, since the declined row belongs to the call row and not to its result. An aborted call keeps the engine row.
- An answer the dialog filled in by itself after an idle time, an errored call and every other tool keep the engine row.
- The colours are constants in `hooks/answer-view.ts`. They are not settings.

### `chat.band.use`

One band above the prompt shows the session at a glance:

```
 Turn 12   84 tok/s   $0.31   $4.20   42%   37:12
```

- `Turn 12` is the number of prompts you sent in this session.
- The speed is output tokens per second over the current turn. Each model request is timed from its first text, thinking or tool chunk to its end, less the time of tools the API ran itself (the advisor is one). The requests of a turn are added up. Subagent requests are left out. The value of the last turn stays until the new turn has at least 20 tokens over half a second.
- The first cost is the turn so far, the second the session. A turn whose start cost is not known shows `—`.
- The percentage is the context window fill.
- The countdown is the time left on the 1-hour prompt cache since the last answer. The band gets an amber frame 20 minutes before it expires and a red one at 10, and the hourglass and the time take that colour. It shows `…` while a turn runs and `expired` at zero.
- A value the session does not have yet shows `—`.
- Under 64 cells the turn and speed text gets shorter (`#12`, `84/s`). Under 52 the icons get smaller. A row that is still too wide is cut at the right, so the last items in `order` go first.
- Each item has its own `use-*` switch, and `order` sets their order. The band is not drawn while a survey holds it, before your first prompt, or when every item is off.
- After you change a switch, run `/reload-plugins`.

### `prompt.prompt-upgrade.use`

A prompt you type at the prompt box and send is sent at once. With the default `skip-silent-trigger` every prompt is upgraded, and one shorter than `min-length` gets the common rules only. With `false` only a prompt that starts or ends with the trigger `+++` is. A prompt that starts or ends with `---` is sent as it is.

- A Korean prompt waits for the prompt type call, up to 5 seconds. It is then sent as one message: an instruction that asks Claude to write a prompt from your text, print it and answer it, a statement that the instruction is not an approval to run anything, the common answer rules and the rules for its type between `<hard rule>` tags (the task list rules join them when `env.CLAUDE_CODE_ENABLE_TODO_TOOLS` is `"1"` in settings), and your prompt between `<source>` tags at the end. The mod builds the message in code, so the rules reach Claude as they are written.
  - The chat row of the sent message shows your prompt alone. The instruction and the rules are not drawn, but Claude still gets them.
- A prompt without Korean characters is sent as you typed it, without the trigger. No model call is made.
- Each Korean prompt costs one prompt type call on your plan or API key. The default model is `haiku`.
- A prompt with an image or another attachment is upgraded like any other. Only its text changes, and the attachments go on with it.
- Slash commands, shell commands that start with `!`, and prompts with an `@file` or `@agent` mention pass through unchanged. Pasted material counts toward the length, so a prompt that is only a paste is upgraded like any other.
- `/prompt-upgrade status | threshold <n> | probe on|off|show|clear` shows and tunes the feature.

Details and limits: [docs/prompt-upgrade.md](docs/prompt-upgrade.md). Proof-of-concept results: [docs/prompt-upgrade-poc-results.md](docs/prompt-upgrade-poc-results.md).

### `prompt.char-count.use`

The number of characters in the prompt box shows as a bare number among the dim mode labels at the right end of the line under the prompt box:

```
? for shortcuts                                    focus & 12
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
| `hooks/register.tsx` | The hooks module: the tool-call features and the doctor command. It calls `registerUpgrade(on)`, `registerCharCount(on)` and `registerBand(on)`, and the band's `startBandTick($)` and `completeBand($, e)` from its own `session.start` and `turn.complete` hooks. `$` crosses an import only into a function declaration, so a function that takes `$` from another file is written `function name($) { ... }`, as `recount` in `hooks/char-count.tsx` is. |
| `hooks/upgrade.tsx` | The prompt upgrade hooks and command. |
| `hooks/char-count.tsx` | The character count hooks and `recount`, which the prompt upgrade calls after it fills the box and after a prompt is sent. |
| `hooks/answer-colors.tsx` | `drawAnswer` and `drawDeclined`, which draw the answer row and the declined row in their colours. `register.tsx` calls them from its `ToolResult` and `ToolUse` hooks. |
| `hooks/band.tsx` | The session band: its `turn.step` and `AbovePrompt` hooks, `startBandTick` and `completeBand`. |
| `hooks/band-logic.ts` | Pure band logic: item order, step timing and speed, cache countdown text and warning colour, layout by width. |
| `hooks/answer-view.ts` | Pure reading of an `AskUserQuestion` result into a title, rows and a response, and of its call input into the declined lines, and the three colours. |
| `hooks/char-count-logic.ts` | Pure grapheme and code point counting and the label, the count alone. |
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

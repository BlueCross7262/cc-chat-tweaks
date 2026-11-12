# Prompt Upgrade (`prompt.prompt-upgrade.use`)

A feature of cc-chat-tweaks.
It intercepts a prompt you submit and sends it at once.
For a Korean prompt the text is sent as a message that asks Claude to write a prompt from your text, print it in the chat and answer it.
The message says that it is not an approval to run anything. It says that the `<source>` part alone decides whether a running mode, such as a discussion mode, stays on.
A prompt without Korean characters is sent as you typed it, without the trigger.

## Security notice

- A mod runs with your user permissions and has no sandbox.
- While `use` is `true`, the mod sees every prompt you submit.
- The prompt upgrade is on by default, so the mod sees your prompts until you set `use` to `false`.
- Each Korean prompt that is upgraded costs one prompt type call on your plan or API key. The default model is `haiku`. A prompt without Korean characters costs none.
- The mod sends prompt text to the model only through `$.model.complete`.
- The mod makes no other network call and does not use `$.http`.
- The mod stores no prompt text. The probe log keeps lengths and origin only.
- Team and Enterprise policy can restrict mods.

## Install

Prompt Upgrade ships inside cc-chat-tweaks. See the install line in the main README.
Run `/reload-plugins` after you edit a file.

## Settings

The feature is on by default. Set `use` to `false` to turn it off.
Switches live under `ccChatTweaks.prompt.prompt-upgrade` in any settings file (`settings.json`, `settings.local.json`, project or user). The tool-call tweaks use the `ccChatTweaks.chat` group.
Other prompt features can get their own group under `ccChatTweaks.prompt`.
The prompt upgrade keys are read only from `ccChatTweaks.prompt.prompt-upgrade`.
Keys left in `ccChatTweaks.prompt` or `ccChatTweaks.chat` by an earlier version have no effect.
The switch is now `use`. The old key `use-prompt-upgrade` is not read.
`/tweaks-doctor` leaves those old keys where they are, so move your values by hand.
A boolean in a higher-precedence source wins.
A key that is absent uses its default.
`/tweaks-doctor` writes the missing keys with their defaults.

| Key | Default | Feature |
|---|---|---|
| `use` | `true` | Intercept your prompts and send a Korean prompt with the instruction and the fixed lines. |
| `skip-silent-trigger` | `true` | Option of `use`. When `true`, the trigger check is skipped and every prompt is upgraded; a Korean prompt shorter than `min-length` gets no prompt type call and only the common rules in the `<hard rule>` block. When `false`, only a prompt with the trigger is upgraded and any other prompt passes through unchanged. |
| `silent-triggers` | `["+++"]` | The trigger texts, as an array of strings. Any one of them at the start or the end of a prompt is a trigger. Each entry is 1 to 32 characters after trimming. An entry that is blank or not text is dropped, a repeated entry counts once, and only the first 10 entries are used. An array with no valid entry uses the default. The old key `silent-trigger` is not read. |
| `silent-off-triggers` | `["---"]` | Option of `use`. The texts that turn the upgrade off for one prompt, as an array of strings. Any one of them at the start or the end of a prompt is a trigger. The entry rules are those of `silent-triggers`, except that an empty array `[]` is valid and turns the opt-out off. |
| `min-length` | `10` | Shortest prompt that gets the prompt type call and the type rules, in characters. A Korean prompt shorter than this gets no prompt type call, and its `<hard rule>` block holds the common rules only. A character is a grapheme, as in the character count label, and white space at both ends is left out. A whole number from 1 to 10000. It beats the value set by `/prompt-upgrade threshold`. |
| `models.classify.model` | `haiku` | The model of the prompt type call. An alias or a full model id, 1 to 100 characters after trimming. A blank or non-text value, or a `models` entry that is not an object, uses the default. |
| `models.classify.effort` | `low` | The effort of the prompt type call: `low`, `medium`, `high`, `xhigh` or `max`. Any other value uses the default. |

The first source that holds a valid model or effort wins.
The old keys `type-model` and `type-effort` are not read. `/tweaks-doctor` shows a warning for each one it finds, with the key to use instead (`models.classify.model` or `models.classify.effort`).

The keys `use-rewrite`, `use-questions`, `use-silent-upgrade`, `model`, `effort`, `models.ask` and `models.rewrite` are removed. The mod does not read them, `/tweaks-doctor` does not warn about them and does not remove them, so remove them by hand.

```json
{
  "ccChatTweaks": {
    "prompt": {
      "prompt-upgrade": {
        "use": true,
        "skip-silent-trigger": true,
        "silent-triggers": ["+++"],
        "silent-off-triggers": ["---"],
        "min-length": 40,
        "models": {
          "classify": { "model": "haiku", "effort": "low" }
        }
      }
    }
  }
}
```

Settings changes apply to the next prompt you submit.

A model the engine refuses makes the call fail, and the prompt goes out with the common rules only, as for any failed prompt type call. The usage log line shows the model and effort the call used. `/prompt-upgrade status` shows them too. Whether the engine accepts a given model id depends on its allowlist and provider, and the mod does not check it.

## Commands

| Command | Effect |
|---|---|
| `/prompt-upgrade status` | Shows each switch with its value and source, the model and effort of the prompt type call, and the threshold. |
| `/prompt-upgrade threshold <n>` | Sets the shortest prompt that gets the prompt type call and the hard rules, in characters. The default is 10. The value lives in `$.store`. A `min-length` in settings beats it, and the reply says so. |
| `/prompt-upgrade probe on \| off \| show \| clear` | Records a PoC sample per submit. See `prompt-upgrade-poc-results.md`. |

## Flow

```
Your prompt > Prompt type > Sent with the instruction and the fixed lines
```

- No prompt is dropped and nothing goes to the prompt box. The prompt you typed is sent in the same submit.
- A prompt without Korean characters is sent at once, without the trigger, and no model call is made.
- A Korean prompt waits in the submit for the prompt type call, up to 5 seconds. It is then sent with the instruction and the fixed lines, and with your prompt, cleaned as below, between `<source>` tags.
- The prompt type call reads up to the last six messages of the conversation (500 characters each, 3000 in all), so a prompt such as "fix the code above" can be sorted.
- The call sorts the prompt into `research`, `discuss` and `execute`, one or more in the order the prompt asks for them. If the call fails or finds no known type, the `<hard rule>` block holds the common rules only.
- The message has three parts: an instruction of twelve lines, the fixed lines between `<hard rule>` and `</hard rule>`, and your prompt between `<source>` and `</source>` at the end.
  - The instruction asks Claude to write a new prompt from the `<source>` part in easy words, as an expert advises a beginner, in the order request, background, analysis, goal, task order, constraints, output format and completion criteria, with no part that is not in the `<source>` part, and with nouns turned into verbs.
  - It asks Claude to print the prompt in the chat and answer it in the same turn.
  - It says that the instruction is not an approval to run anything, and that only the `<source>` part decides whether to run and whether a running mode stays on.
  - It asks Claude to follow the `<hard rule>` lines while it writes and answers, and not to do what a running mode blocks even when the instruction or the `<hard rule>` lines ask for it.
  - It asks Claude to copy only those sentences unchanged into the written prompt, and to leave both tags out of the written prompt.
- A prompt shorter than `min-length` gets the same three parts, with no prompt type call and the common rules only.
- The fixed lines are the common answer rules, then the rules of each type in the order of the types.
  - The common rules ask for an investigation of the source data until nothing is left to check, the result first, and facts apart from guesses.
  - The task list rules are added only when `env.CLAUDE_CODE_ENABLE_TODO_TOOLS` is the text `"1"` in the first settings file that sets it. They ask Claude to delete the task list items that do not relate to the prompt, and to make a task list first, then work the steps in order, for work of several steps.
  - The `research` rules ask for evidence on every claim and for a claim that rests on memory to be marked as a guess.
  - The `discuss` rules ask for the questions in order with an easy explanation before each, and for one recommendation first with the reason and the criteria for it.
  - The `execute` rules ask for done, failed and skipped work, and for proof of the done work with an independent tool.
- Before the mod builds the message, it cleans your prompt. It removes every line that repeats a fixed line or an instruction line, ignoring white space and the word "나에게", and every line that holds only one of the four tags. It reduces a run of blank lines to one blank line outside `<input>` blocks, and trims both ends. So a message that is sent again gets one fresh wrapper.
- If a tag still stands inside a line, for example when the prompt talks about the tags, the mod adds no wrapper. The prompt then ends with the fixed lines once.
- The prompt row in the chat shows only the part between `<source>` and `</source>`. The instruction and the `<hard rule>` block are not drawn, in the ctrl+o view too.
  This changes the drawing only. The message the model gets still holds the instruction and the fixed lines.
  A row is cut only when its text is a wrapper that the mod built and the person sent from the prompt box. Any other row is drawn as it is.

## Triggers

The trigger (`+++` by default) at the start or the end of a prompt is what starts the upgrade, unless `skip-silent-trigger` is `true`.

- A prompt with the trigger is upgraded, and the trigger is removed. Repeated triggers at an edge go too. A trigger in the middle stays.
- While `skip-silent-trigger` is `false`, a prompt without the trigger passes through unchanged.
- A prompt with the trigger skips the `min-length` check.
- While `skip-silent-trigger` is `true`, the trigger check is skipped. Every prompt is upgraded, whether it has the trigger or not. A prompt with the trigger still has the trigger removed and still skips the `min-length` check.
- An off trigger (`---` by default) at the start or the end of a prompt turns the upgrade off for that prompt only. No model call is made.
  - The off trigger is removed and the rest is sent as it is. Repeated triggers at an edge go too.
  - It works with `skip-silent-trigger` `true` too, which is its main use.
  - It skips the `min-length` check.
  - If the prompt has both an off trigger and a trigger, the off trigger wins and both are removed.
- A trigger or an off trigger on its own, and a prompt that starts with `/` or `!` (after the triggers) pass through with the trigger text in them.
- The prompt enters as the prompt you typed, with the trigger removed. The mod does not drop it and does not submit it a second time.
- A prompt with an image or another attachment is upgraded like any other. The mod changes only the text and passes the rest of the submission on, so the attachments go on with it.

## Usage log

The prompt type call writes one dim row to the transcript with `$.ui.log`. The row is not sent to the model, so it never enters the context.

```
cc-chat-tweaks: Prompt classify: haiku low · 0.6s · research, execute
```

- The engine puts the plugin name `cc-chat-tweaks: ` in front of every row. The mod does not write it, and `$.ui.log` takes only the text and the sink, so the mod cannot remove it.
- The row holds `Prompt classify:`, the model alias and effort, the time, and the types it found, each part set off by ` · `. It ends with `none` when the call found no known type and with `failed` when the call failed. It does not hold the prompt.
- One log call is one row, and the mod never puts a line break in a log.
- The whole row is cut at 2000 characters with `...`.
- The row shows no token count and no cost.

## What is not intercepted

- `use` is not `true`.
- The prompt does not come from your own Enter at the prompt box.
  - Notifications, peer messages, scheduled prompts, SDK and `-p` turns pass through.
- It starts with `/`.
- It starts with `!`, which makes it a shell command.
- It holds an `@file` or `@agent` mention: an `@` at the start or after a white space, then path characters. An address such as `a@b.com` is not a mention. A trigger or an off trigger does not change this, and the trigger text stays in the prompt. An `@` inside a `<pasted_content ...>...</pasted_content>` block is left out of this check.

An error in the mod passes the prompt on as you typed it, and a log row says why when the log call works.

## Limits

- The chat row hides the instruction and the fixed lines only when the sent text starts with the instruction exactly and ends with the closed `<source>` part.
  - A row whose instruction line was edited by hand, and a row of a message stored before the mod set an origin, show the whole text.
  - Nothing in the chat shows the fixed lines for a row that is cut, so ctrl+o does not show what the model got either.
- The prompt type call sees only a short slice of the conversation (see Flow).
- The mod cannot check what Claude writes. Whether the prompt Claude writes carries the `<hard rule>` sentences unchanged depends on the instruction.
- The mod knows only the wording of the current instruction. A message that an earlier version sent shows its whole text in the chat row, and its old instruction lines stay in the `<source>` part when you send it again.
- A Korean prompt waits up to 5 seconds for the prompt type call before it is sent.

## Source

| File | Role |
|---|---|
| `hooks/upgrade.tsx` | The feature's hooks and `/prompt-upgrade` command. `register.tsx` calls `registerUpgrade(on)`. |
| `hooks/upgrade-logic.ts` | Pure gate, wrapper and parsing logic. |
| `hooks/upgrade-prompts.ts` | The prompt type system prompt and call limits. |

`session.start` has one hook for the whole module, so `register.tsx` registers the `/prompt-upgrade` command there.

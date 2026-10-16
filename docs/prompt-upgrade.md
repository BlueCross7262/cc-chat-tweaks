# Prompt Upgrade (`prompt.prompt-upgrade.use`)

A feature of cc-chat-tweaks.
It intercepts a prompt you submit, asks Haiku for up to three clarifying questions, rewrites the prompt as prose, and sends it after you review it.

## Security notice

- A mod runs with your user permissions and has no sandbox.
- While `use` is `true`, the mod sees every prompt you submit.
- The prompt upgrade is on by default, so the mod sees your prompts until you set `use` to `false`.
- Each upgraded prompt costs up to four model calls on your plan or API key: one prompt type call and up to three upgrade calls. The default model is `haiku` for the prompt type call and `sonnet` for the others.
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
| `use` | `true` | Intercept your prompts and upgrade them. |
| `use-questions` | `false` | Ask Haiku for clarifying questions. When `false`, the mod rewrites the prompt at once. |
| `use-silent-upgrade` | `true` | Option of `use`. When `true`, the pane never opens, and only a prompt with the trigger is upgraded. The recommended answers to the questions are applied when `use-questions` is `true`, and the draft is put in the prompt box without being sent. When `false`, the pane runs for every prompt and the trigger is ordinary text. |
| `skip-silent-trigger` | `true` | Option of `use-silent-upgrade`. When `true`, the trigger check is skipped and every prompt of `min-length` or more is upgraded without the pane. It has no effect while `use-silent-upgrade` is `false`. |
| `silent-triggers` | `["+++"]` | The trigger texts, as an array of strings. Any one of them at the start or the end of a prompt is a trigger. Each entry is 1 to 32 characters after trimming. An entry that is blank or not text is dropped, a repeated entry counts once, and only the first 10 entries are used. An array with no valid entry uses the default. The old key `silent-trigger` is not read. |
| `silent-off-triggers` | `["---"]` | Option of `use-silent-upgrade`. The texts that turn the silent upgrade off for one prompt, as an array of strings. Any one of them at the start or the end of a prompt is a trigger. The entry rules are those of `silent-triggers`, except that an empty array `[]` is valid and turns the opt-out off. It has no effect while `use-silent-upgrade` is `false`. |
| `min-length` | `10` | Shortest prompt that is intercepted, in characters. A whole number from 1 to 10000. It beats the value set by `/prompt-upgrade threshold`. |
| `models.<call>.model` | `sonnet`, and `haiku` for `classify` | The model of one call. `<call>` is `ask` (the questions), `rewrite`, `revise` or `classify` (the prompt type). An alias or a full model id, 1 to 100 characters after trimming. A blank or non-text value, or a `models` entry that is not an object, uses the default. |
| `models.<call>.effort` | `low` | The effort of the same call: `low`, `medium`, `high`, `xhigh` or `max`. Any other value uses the default. |

Each call reads only its own entry. The first source that holds a valid value wins.
The old keys `model`, `effort`, `type-model` and `type-effort` are not read. `/tweaks-doctor` shows a warning for each one it finds, with the key to use instead (`type-model` and `type-effort` map to `models.classify`, the others to `models.ask`, `models.rewrite` and `models.revise`).

```json
{
  "ccChatTweaks": {
    "prompt": {
      "prompt-upgrade": {
        "use": true,
        "use-questions": false,
        "use-silent-upgrade": true,
        "skip-silent-trigger": true,
        "silent-triggers": ["+++"],
        "silent-off-triggers": ["---"],
        "min-length": 40,
        "models": {
          "ask": { "model": "sonnet", "effort": "low" },
          "rewrite": { "model": "sonnet", "effort": "low" },
          "revise": { "model": "sonnet", "effort": "low" },
          "classify": { "model": "haiku", "effort": "low" }
        }
      }
    }
  }
}
```

Settings changes apply to the next prompt you submit.

A model the engine refuses makes the call fail, and the flow ends with your original prompt as for any Haiku failure. The usage log line shows the model and effort the call used. `/prompt-upgrade status` shows them too. Whether the engine accepts a given model id depends on its allowlist and provider, and the mod does not check it.

## Commands

| Command | Effect |
|---|---|
| `/prompt-upgrade status` | Shows each switch with its value and source, the model and effort of each of the four calls (`ask`, `rewrite`, `revise` and `classify`), the threshold and the current phase. |
| `/prompt-upgrade threshold <n>` | Sets the shortest prompt that is intercepted, in characters. The default is 10. The value lives in `$.store`. A `min-length` in settings beats it, and the reply says so. |
| `/prompt-upgrade reset` | Closes the pane and puts the original prompt back in the prompt box. |
| `/prompt-upgrade probe on \| off \| show \| clear` | Records a PoC sample per submit. See `prompt-upgrade-poc-results.md`. |

## Flow

```
Your prompt > Questions > Rewrite > Review
```

- A prompt typed at the prompt box is dropped and a pane opens.
- Haiku also reads up to the last six messages of the conversation (500 characters each, 3000 in all), so a prompt such as "fix the code above" has something to refer to.
- At the same time, one prompt type call sorts the prompt into `research`, `discuss` and `execute`, one or more in the order the prompt asks for them.
  - It runs on every upgrade, with or without `use-questions`, and with the questions call when there is one.
  - The rewrite waits for it. The rewrite uses the types only to order the sentences and to choose how each request is phrased. It adds no request that is not in your prompt.
  - If the call fails or finds no known type, the rewrite goes on without types.
  - When the types hold at least one known type and the prompt has Korean characters, the mod adds fixed lines to the end of the draft. These are the common answer rules, then the rules of each type in the order of the types. The common rules ask for a thorough investigation, the result first, facts apart from guesses, and no unrequested background. The `research` rules ask for evidence on every claim. The `discuss` rules ask for one recommendation first with the pros and cons of each option. The `execute` rules ask for done, failed and skipped work, the changed files, and how the change was checked.
  - When the types hold `research` or `discuss`, the mod then adds two more fixed lines. They ask Claude to put its questions through AskUserQuestion with the recommended option first.
  - A revision applies the same lines to its result. Before the mod adds its lines, it removes every line of the draft that repeats one of them, ignoring white space and the word "나에게", so the draft never holds the same rule twice.
  - With no known type, or with a prompt that has no Korean characters, the mod adds nothing.
- Haiku asks up to three questions with 3 to 5 options each.
  - Pick an option, type your own answer, or skip.
  - `나머지 건너뛰고 업그레이드` goes on with the answers so far.
  - `권장안으로 업그레이드` fills the open questions with the recommended options and goes on.
- Haiku rewrites the prompt as prose with one sentence on each line.
  - The mod does not break lines itself. The line breaks are what Haiku wrote.
  - Pasted material stays as it is, wrapped in `<input>` tags.
- In the review you can:

| Control | Key | Effect |
|---|---|---|
| `수정` field | | Haiku changes only the draft, as you ask. |
| `이 프롬프트 보내기` | `s` | Sends the draft and clears the prompt box. |
| `수정 되돌리기` | `u` | Brings back the draft before the last revision. |
| `입력창에서 편집` | `e` | Closes the pane and puts the draft in the prompt box. Your next submit passes once: any time for the same characters as the draft, and within 5 minutes for anything else. |
| `원문 그대로 보내기` | `o` | Sends the prompt you typed. |
| `취소` | `c` | Closes the pane and puts the original back in the prompt box. |

The keys fire while the pane holds the focus.
Whether they fire while the cursor sits in the revise field is not verified.
Press Tab to move to a button, or click it.

## Silent upgrade

`use-silent-upgrade` only hides the pane. It does not make the upgrade run on every prompt.

The trigger (`+++` by default) at the start or the end of a prompt is what starts the upgrade.

- While `use-silent-upgrade` is `true`, a prompt with the trigger is upgraded without the pane.
- While `use-silent-upgrade` is `true`, a prompt without the trigger passes through unchanged. The pane does not open and nothing is upgraded.
- While `use-silent-upgrade` is `false`, the pane runs for every prompt of `min-length` or more, and the trigger is ordinary text.
- A prompt with the trigger skips the `min-length` check.
- While `skip-silent-trigger` is `true`, the trigger check is skipped. Every prompt of `min-length` or more is upgraded without the pane, whether it has the trigger or not. A prompt with the trigger still has the trigger removed and still skips the `min-length` check.
- `skip-silent-trigger` has no effect while `use-silent-upgrade` is `false`.
- An off trigger (`---` by default) at the start or the end of a prompt turns the silent upgrade off for that prompt only. Nothing is upgraded and no model call is made.
  - The off trigger is removed and the rest is sent as it is. Repeated triggers at an edge go too.
  - It works with `skip-silent-trigger` `true` too, which is its main use.
  - It skips the `min-length` check and beats an open manual-edit pass.
  - If the prompt has both an off trigger and a trigger, the off trigger wins and both are removed.
  - An off trigger on its own and a prompt that starts with `/` or `!` (after the triggers) pass through with the text in them. So does a prompt with an attachment.
  - The prompt enters as the prompt you typed, with the trigger removed. The mod does not drop it and does not submit it a second time.

- The trigger is removed. Repeated triggers at an edge go too. A trigger in the middle stays.
- With `use-questions` `true`, Haiku first writes the questions, and the mod answers each one with its recommended option. A question with no recommended option stays unanswered. Nothing is shown and you are not asked. This costs one more Haiku call.
- With `use-questions` `false`, there is no question call.
- Haiku then rewrites the prompt once with those answers, and the mod puts the result in the prompt box. It does not send it.
- If the questions call fails, the rewrite goes on without answers.
- You read the draft in the prompt box, edit it if you want, and press Enter yourself.
- The pane is not opened, so there is no review pane. Use the normal path when you want to revise the draft with Haiku.
- The mod remembers the characters of the draft it put in the prompt box, with every space, tab and line break dropped.
- A prompt that holds the same characters passes through, however its spaces and line breaks differ, and however long you waited. So the draft goes out without a second upgrade, and the pass is spent.
- A prompt that holds other characters is an edited draft or a new prompt, and the mod cannot tell which. Within 5 minutes it passes through once. After 5 minutes it is upgraded.
- A prompt with the trigger is upgraded again instead, and the pass stays open.
- Only the white space is ignored. A changed letter, digit or punctuation mark counts as an edit.
- If Haiku fails, the prompt box gets the prompt as you wrote it, without the trigger, and a toast says so.
- The mod reads the prompt box 0.3 s after it took the prompt, and keeps that text as the baseline. It is whatever the engine left there, such as a paste placeholder.
- If the box holds other text than the baseline when the draft is ready, you typed something meanwhile. The mod leaves the box alone and puts the draft on your clipboard. A toast says so.
- If something unexpected fails after the prompt was taken, the text without the trigger is put back in the prompt box.
- A prompt you send while the silent upgrade is still running passes through as it is, trigger included.
- The `min-length` check and the terminal-surface check do not apply to a prompt with the trigger. The terminal-surface check does not apply to any silent upgrade.
- A trigger on its own, a prompt with an attachment, and a prompt that starts with `/` or `!` (after the trigger) pass through with the trigger text in them.
- A prompt you type after `입력창에서 편집` or after a silent draft passes through once when it holds the same characters as the draft, or within 5 minutes when it holds other characters. A prompt with the trigger is not passed this way. It is upgraded again.
- Not verified: what the prompt box and the up-arrow history hold after the mod takes the prompt.
  - A prompt with an off trigger enters as the prompt you typed, so the history is expected to hold it. Check it in a real session.
  - The paths that drop the prompt and submit it again as a plugin prompt may leave nothing in the history. The pane `이 프롬프트 보내기` and `원문 그대로 보내기` are such paths.

## Usage log

Each model call writes one dim row to the transcript with `$.ui.log`. The row is not sent to the model, so it never enters the context.

```
cc-chat-tweaks: Prompt classify: haiku low · 0.6s · research, execute
cc-chat-tweaks: Prompt rewrite: sonnet low · 1.9s · fix the login bug
```

- The engine puts the plugin name `cc-chat-tweaks: ` in front of every row. The mod does not write it, and `$.ui.log` takes only the text and the sink, so the mod cannot remove it.
- The row holds a call prefix, the model alias and effort, the time, and the prompt you typed without the trigger, each part set off by ` · `.
- The prefix names the call: `Prompt ask:` for the questions call, `Prompt rewrite:` for the rewrite call, and `Prompt revise:` for the revise call.
- A silent run applies the recommended answers on its own and writes one `Prompt answer:` row for each answer it applies. A row holds the question and its answer, as `question → answer`. A question with no recommended answer writes no row, and a run with no applied answer writes none. The pane path writes no such row, because you pick the answers there.
- The prompt type call writes its own row. It holds `Prompt classify:`, the model alias and effort, the time, and the types it found, each part set off by ` · `. It ends with `none` when the call found no known type and with `failed` when the call failed. It does not hold the prompt.
- One log call is one row. A line break inside the text of a call is not drawn as a break, and shows as a garbled character. So the mod turns every run of spaces and line breaks in the prompt into one space, and never puts a line break in a log.
- The whole row is cut at 2000 characters with `...`.
- The empty line the engine draws between rows is the engine's own spacing. The mod writes no empty row.
- The row shows no token count and no cost.
- A failed call writes its row too. A row with no prompt text ends after the time.
- A run with questions makes two upgrade calls, so it writes a `Prompt ask:` row and a `Prompt rewrite:` row with the same prompt and different times. Every run also writes one `Prompt classify:` row. It can come before or after the questions row.

## What is not intercepted

- `use` is not `true`.
- The prompt does not come from your own Enter at the prompt box.
  - Notifications, peer messages, scheduled prompts, SDK and `-p` turns pass through.
- You typed it while a turn was running.
- It carries an image or another attachment.
- It starts with `/`.
- It starts with `!`, which makes it a shell command.
- It holds an `@file` or `@agent` mention: an `@` at the start or after a white space, then path characters. The resubmit does not expand mentions, so the upgraded prompt would lose the file. An address such as `a@b.com` is not a mention. A trigger or an off trigger does not change this, and the trigger text stays in the prompt.
- It is only pasted material. The mod removes every `<pasted_content ...>...</pasted_content>` block and counts what is left. If that is shorter than the threshold, the prompt passes. A prompt with a trigger skips this check, like the other length check.
- It is shorter than the threshold.
- No terminal surface is attached.
- A flow is already running.
- The pane cannot be placed.

Every failure path ends with your original prompt: a Haiku error or timeout shows the original as the draft, and an error in the mod passes the prompt on.

## Limits

- The resubmitted prompt is sent as a plugin prompt.
  - `@file` mentions and pasted images are not expanded again.
  - Prompts with attachments are not intercepted for this reason.
- Haiku sees only a short slice of the conversation (see Flow).
  - A prompt that refers to something older than that cannot be improved.
  - The mod does not detect such prompts. Use `원문 그대로 보내기`.
- The revise field is one line.

## Source

| File | Role |
|---|---|
| `hooks/upgrade.tsx` | The feature's hooks, pane and `/prompt-upgrade` command. `register.tsx` calls `registerUpgrade(on)`. |
| `hooks/upgrade-logic.ts` | Pure gate, flow and parsing logic. |
| `hooks/upgrade-prompts.ts` | The Haiku system prompts and call limits. |

`session.start` has one hook for the whole module, so `register.tsx` registers the `/prompt-upgrade` command there.
A flow left open by a reload is closed at the first prompt after the reload, and a toast carries the full text of the earlier prompt.

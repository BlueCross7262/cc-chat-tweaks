# Prompt Upgrade (`use-prompt-upgrade`)

A feature of cc-chat-tweaks.
It intercepts a prompt you submit, asks Haiku for up to three clarifying questions, rewrites the prompt as prose, and sends it after you review it.

## Security notice

- A mod runs with your user permissions and has no sandbox.
- While `use-prompt-upgrade` is `true`, the mod sees every prompt you submit.
- Each upgraded prompt costs up to three Haiku calls on your plan or API key.
- The mod sends prompt text to Haiku only through `$.model.complete`.
- The mod makes no other network call and does not use `$.http`.
- The mod stores no prompt text. The probe log keeps lengths and origin only.
- Team and Enterprise policy can restrict mods.

## Install

Prompt Upgrade ships inside cc-chat-tweaks. See the install line in the main README.
Run `/reload-plugins` after you edit a file.

## Settings

The feature is off until you turn it on.
Switches live under `ccChatTweaks.prompt` in any settings file (`settings.json`, `settings.local.json`, project or user). The tool-call tweaks use the `ccChatTweaks.chat` group.
The prompt keys are not read from `ccChatTweaks.chat`.
A boolean in a higher-precedence source wins.
A key that is absent uses its default.
`/tweaks-doctor` writes the missing keys with their defaults.

| Key | Default | Feature |
|---|---|---|
| `use-prompt-upgrade` | `false` | Intercept your prompts and upgrade them. |
| `use-questions` | `true` | Ask Haiku for clarifying questions. When `false`, the mod rewrites the prompt at once. |
| `use-silent-upgrade` | `true` | Option of `use-prompt-upgrade`. When `true`, no prompt opens the pane. Each one is upgraded without questions, and the draft is put in the prompt box without being sent. When `false`, the pane runs and the trigger is ordinary text. |
| `silent-trigger` | `+++` | The trigger text. 1 to 32 characters after trimming. A blank or non-text value uses the default. |
| `min-length` | `10` | Shortest prompt that is intercepted, in characters. A whole number from 1 to 10000. It beats the value set by `/prompt-upgrade threshold`. |
| `model` | `haiku` | The model of the question, rewrite and revise calls. An alias or a full model id, 1 to 100 characters after trimming. A blank or non-text value uses the default. |
| `effort` | `low` | The effort of the same calls: `low`, `medium`, `high`, `xhigh` or `max`. Any other value uses the default. |

```json
{
  "ccChatTweaks": {
    "prompt": {
      "use-prompt-upgrade": true,
      "use-questions": true,
      "use-silent-upgrade": true,
      "silent-trigger": "+++",
      "min-length": 40,
      "model": "haiku",
      "effort": "low"
    }
  }
}
```

Settings changes apply to the next prompt you submit.

A `model` the engine refuses makes the call fail, and the flow ends with your original prompt as for any Haiku failure. The usage log line shows the model and effort the call used. `/prompt-upgrade status` shows them too. Whether the engine accepts a given model id depends on its allowlist and provider, and the mod does not check it.

## Commands

| Command | Effect |
|---|---|
| `/prompt-upgrade status` | Shows each switch with its value and source, the threshold and the current phase. |
| `/prompt-upgrade threshold <n>` | Sets the shortest prompt that is intercepted, in characters. The default is 10. The value lives in `$.store`. A `min-length` in settings beats it, and the reply says so. |
| `/prompt-upgrade reset` | Closes the pane and puts the original prompt back in the prompt box. |
| `/prompt-upgrade probe on \| off \| show \| clear` | Records a PoC sample per submit. See `prompt-upgrade-poc-results.md`. |

## Flow

```
Your prompt > Questions > Rewrite > Review
```

- A prompt typed at the prompt box is dropped and a pane opens.
- Haiku also reads up to the last six messages of the conversation (500 characters each, 3000 in all), so a prompt such as "fix the code above" has something to refer to.
- Haiku asks up to three questions with 3 to 5 options each.
  - Pick an option, type your own answer, or skip.
  - `나머지 건너뛰고 업그레이드` goes on with the answers so far.
  - `권장안으로 업그레이드` fills the open questions with the recommended options and goes on.
- Haiku rewrites the prompt as one or two paragraphs of prose.
  - Pasted material stays as it is, wrapped in `<input>` tags.
- In the review you can:

| Control | Key | Effect |
|---|---|---|
| `수정` field | | Haiku changes only the draft, as you ask. |
| `이 프롬프트 보내기` | `s` | Sends the draft and clears the prompt box. |
| `수정 되돌리기` | `u` | Brings back the draft before the last revision. |
| `입력창에서 편집` | `e` | Closes the pane and puts the draft in the prompt box. Your next submit passes once, for up to 5 minutes. |
| `원문 그대로 보내기` | `o` | Sends the prompt you typed. |
| `취소` | `c` | Closes the pane and puts the original back in the prompt box. |

The keys fire while the pane holds the focus.
Whether they fire while the cursor sits in the revise field is not verified.
Press Tab to move to a button, or click it.

## Silent upgrade

While `use-silent-upgrade` is `true`, no prompt opens the pane. Every prompt that would be intercepted is upgraded silently. The `min-length` check still applies to a prompt without the trigger, so a short prompt passes through.

The trigger (`+++` by default) at the start or the end of a prompt forces the silent upgrade past the `min-length` check.

- The trigger is removed. Repeated triggers at an edge go too. A trigger in the middle stays.
- Haiku rewrites the prompt once, with no questions, and the mod puts the result in the prompt box. It does not send it.
- You read the draft in the prompt box, edit it if you want, and press Enter yourself.
- The pane is not opened, so there is no review pane. Use the normal path when you want to revise the draft with Haiku.
- The next prompt you submit within 5 minutes passes through once, so the draft goes out without a second upgrade.
- If Haiku fails, the prompt box gets the prompt as you wrote it, without the trigger, and a toast says so.
- If you typed something else in the prompt box meanwhile, the mod leaves the box alone and puts the draft on your clipboard. A toast says so.
- If something unexpected fails after the prompt was taken, the text without the trigger is put back in the prompt box.
- A prompt you send while the silent upgrade is still running passes through as it is, trigger included.
- The `min-length` check and the terminal-surface check do not apply to a silent upgrade.
- A trigger on its own, a prompt with an attachment, and a prompt that starts with `/` (after the trigger) pass through with the trigger text in them.
- A prompt you type within 5 minutes after `입력창에서 편집` passes through once, trigger included.
- Not verified: what the prompt box and the up-arrow history hold after the mod takes the prompt. The original text, trigger included, is likely to be in the history.

## Usage log

Each Haiku call writes one dim line to the transcript with `$.ui.log`. The line is not sent to the model, so it never enters the context.

```
Prompt Upgrade rewrite: haiku low · 1.2s
```

- The line names the call (`questions`, `rewrite` or `revise`), the model alias and effort, and the time.
- The line shows no token count and no cost.
- A failed call logs its line too.

## What is not intercepted

- `use-prompt-upgrade` is not `true`.
- The prompt does not come from your own Enter at the prompt box.
  - Notifications, peer messages, scheduled prompts, SDK and `-p` turns pass through.
- You typed it while a turn was running.
- It carries an image or another attachment.
- It starts with `/`.
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

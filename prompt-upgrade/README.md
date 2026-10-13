# prompt-upgrade

Intercepts a prompt you submit, asks Haiku for up to three clarifying questions, rewrites the prompt as prose, and sends it after you review it.

## Security notice

- A mod runs with your user permissions and has no sandbox.
- This mod sees every prompt you submit while it is loaded.
- Each upgraded prompt costs up to three Haiku calls on your plan or API key.
- The mod sends prompt text to Haiku only through `$.model.complete`.
- The mod makes no other network call and does not use `$.http`.
- The mod stores no prompt text. The probe log keeps lengths and origin only.
- Team and Enterprise policy can restrict mods.

## Install

```
claude --plugin-dir <path to this folder>
```

Run `/reload-plugins` after you edit a file.

## Settings

The mod is off until you turn it on.
Switches live under `promptUpgrade.chat` in any settings file (`settings.json`, `settings.local.json`, project or user).
A boolean in a higher-precedence source wins.
A key that is absent uses its default.

| Key | Default | Feature |
|---|---|---|
| `use-prompt-upgrade` | `false` | Intercept your prompts and upgrade them. |
| `use-questions` | `true` | Ask Haiku for clarifying questions. When `false`, the mod rewrites the prompt at once. |

```json
{
  "promptUpgrade": {
    "chat": {
      "use-prompt-upgrade": true,
      "use-questions": true
    }
  }
}
```

Settings changes apply to the next prompt you submit.

## Commands

| Command | Effect |
|---|---|
| `/prompt-upgrade status` | Shows each switch with its value and source, the threshold and the current phase. |
| `/prompt-upgrade threshold <n>` | Sets the shortest prompt that is intercepted, in characters. The default is 10. The value lives in `$.store`. |
| `/prompt-upgrade reset` | Closes the pane and puts the original prompt back in the prompt box. |
| `/prompt-upgrade probe on \| off \| show \| clear` | Records a PoC sample per submit. See `docs/poc-results.md`. |

## Flow

```
Your prompt > Questions > Rewrite > Review
```

- A prompt typed at the prompt box is dropped and a pane opens.
- Haiku asks up to three questions with 3 to 5 options each.
  - Pick an option, type your own answer, or skip.
  - `Skip the rest, upgrade now` goes on with the answers so far.
- Haiku rewrites the prompt as one or two paragraphs of prose.
  - Pasted material stays as it is, wrapped in `<input>` tags.
- In the review you can:

| Control | Key | Effect |
|---|---|---|
| Revise field | | Haiku changes only the draft, as you ask. |
| Send this prompt | `s` | Sends the draft. |
| Undo revision | `u` | Brings back the draft before the last revision. |
| Edit in prompt box | `e` | Closes the pane and puts the draft in the prompt box. Your next submit passes once. |
| Send original | `o` | Sends the prompt you typed. |
| Cancel | `c` | Closes the pane and puts the original back in the prompt box. |

The keys fire while the pane holds the focus.
Whether they fire while the cursor sits in the revise field is not verified.
Press Tab to move to a button, or click it.

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
- Haiku has no conversation history.
  - A prompt such as "fix the code above" cannot be improved.
  - The mod does not detect such prompts. Use `Send original`.
- The revise field is one line.

## Develop

```
claude plugin validate <path to this folder>
claude plugin test <path to this folder>
```

Type-check with `tsc -p <path to this folder>` once the engine has laid `.claude-plugin/types`.

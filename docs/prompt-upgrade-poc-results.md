# Prompt Upgrade PoC 결과

> 대상 빌드는 Claude Code 2.1.296이다.
> 근거 파일은 이 빌드가 쓴 `claude-code.d.ts`다.
> 「타입 확인」은 선언을 읽은 결과이고 실행으로 관찰한 결과가 아니다.
> 「미관측」은 라이브 TUI에서 확인해야 하는 항목이다.

## 요약

| # | 항목 | 상태 | 결과 |
|---|---|---|---|
| 1 | `$.model.complete` 반환 타입 | 타입 확인 | 지시서의 문서 버전과 같다. 실호출은 미관측이다. |
| 2 | 첨부 처리 | 타입 확인 | 재제출은 첨부와 `@file` 확장을 보존하지 않는다. 첨부가 있으면 통과시킨다. |
| 3 | `e.origin` 형식 | 타입 확인 | 사용자 Enter는 `composer`, 플러그인 재제출은 `plugin`이다. |
| 4 | Pane 폭 조건 | 타입 확인 | `$.ui.open`은 `isPlaced: false`를 돌려줄 수 있다. 그 경우 drop하지 않는다. |
| 5 | drop된 프롬프트의 잔존 | 미관측 | probe로 관찰한다. |
| 6 | 질문 JSON 안정성 | 미관측 | 파서는 실패 시 빈 배열을 돌려준다. 샘플 20개 시험은 남아 있다. |
| 7 | 짧은 입력 임계값 | 미관측 | 초기값은 10자다. |
| 8 | `Input` 멀티라인 | 타입 확인 | `Input`은 한 줄 필드다. 한 줄 요청 위주로 설계한다. |
| 9 | 다른 훅과의 상호작용 | 미관측 | 다른 mod 병행 시험이 필요하다. |
| 10 | UI 없는 환경 | 부분 확인 | 터미널 surface가 없으면 통과시킨다. `claude -p` 실행은 미관측이다. |

## 지시서 §3과 다른 점

- `prompt.submit`의 `origin.kind`에는 `composer`·`plugin`·`peer`·`task-notification`·`scheduled-trigger`·`sdk`·`bridge`·`channel` 등이 있다.
  - 지시서의 통과 조건에는 origin 필터가 없다.
  - 알림이나 다른 세션의 메시지를 가로채면 아무도 요청하지 않은 pane이 열린다.
  - 그래서 사용자 Enter(`composer`)만 가로챈다.
- `prompt.submit`의 `turnId`는 턴 진행 중에 입력한 프롬프트에만 있다.
  - 지시서는 이 경우를 다루지 않는다.
  - 시나리오 9의 교착을 피하려고 통과시킨다.
- 지시서는 훅 모듈을 `.js`로 쓰라고 한다.
  - 이 빌드의 `hooks.json`과 JSX는 `.tsx`/`.ts`를 쓴다.
  - 파일은 `.ts`/`.tsx`로 쓴다.
- 지시서는 `skipNext`를 타이머로 해제하라고 한다.
  - 구현은 `skipUntil` 시각을 저장하고 제출 시점에 비교한다.
  - 타이머와 같은 효과이고 reload에도 안전하다.
- 지시서의 `S`는 모듈 변수다.
  - hot reload가 모듈 변수를 초기화하므로 상태는 `$.state`(`flow`)에 둔다.
  - `$.state`를 읽는 렌더는 쓰기마다 다시 그려져서 `invalidate` 호출이 필요 없다.
- pane이 놓이지 않는 경우를 지시서가 다루지 않는다.
  - `$.ui.open`은 `{ isPlaced: false, reason }`을 돌려줄 수 있다.
  - 이때 drop하면 프롬프트가 사라진다.
  - 그래서 `isPlaced`가 true일 때만 drop한다.

## 항목별 근거

### 1 — `$.model.complete`

- 선언은 `Promise<ModelCompleteResult>`다.
- 결과는 `{ isAnswered: true, text, usage }` 또는 `{ isAnswered: false, reason }`이다.
- `reason`은 `api-error`·`empty-reply`·`aborted`다.
- 요청은 `model`·`prompt`·`system`·`maxTokens`·`effort`·`timeoutMs`를 받는다.
- 지시서의 호출 파라미터와 필드명이 모두 맞다.
- `normalizeCompletion()`이 문자열 반환과 객체 반환을 모두 처리한다.

### 2 — 첨부

- `PromptSubmitInput.attachments`는 종류만 담고 바이트를 담지 않는다.
- `$.prompt.submit`은 플러그인 프롬프트의 `@file` 멘션과 붙여 넣은 이미지를 확장하지 않는다.
- 재제출하면 첨부가 사라지므로 첨부가 있는 프롬프트는 업그레이드에서 제외한다.
- `e.text`에 이미 확장된 내용이 들어 있는지는 미관측이다.

### 3 — origin

- 사용자 Enter는 `{ kind: 'composer' }`다.
- 플러그인 재제출은 `{ kind: 'plugin', name, asUser: true }`다.
- 텍스트 비교(`pending`)를 기본 식별자로 쓰고 origin은 보조로 둔다.

### 4 — Pane 폭

- `$.ui.open`의 `focus`는 요청일 뿐이다.
- 플러그인이 스스로 연 pane은 144열 미만에서 그려지지 않고 기다린다.
- 사용자가 입력한 명령이나 프롬프트에 답해 연 pane은 어떤 폭에서도 놓인다. `PaneOpenArgs`의 문서가 그렇게 적는다.
- 결과 `isPlaced: false`에는 `reason`이 붙는다.
- 그래서 `prompt.submit` 훅 안에서 연 pane은 놓일 가능성이 높다. 실제 폭별 동작은 미관측이다.
- 구현은 `isPlaced`가 false이면 drop하지 않고 프롬프트를 통과시킨다.

### 8 — Input

- `InputProps`는 `key`·`label`·`placeholder`·`value`·`onInput`·`onSubmit`을 가진다.
- 한 줄 텍스트 필드로 문서화되어 있다.

## 라이브 관찰 절차

기본은 꺼져 있다.
probe는 프롬프트를 바꾸거나 drop하지 않는다.
probe가 켜져 있으면 제출마다 pane 하나를 열었다가 바로 닫고 결과를 `$.store`에 기록한다.
텍스트는 기록하지 않고 길이만 기록한다.

### 절차

- `/prompt-upgrade probe on` 을 입력한다.
- 아래 프롬프트를 하나씩 보낸다.
  - 20자 이상의 평범한 문장 하나
  - 5자 문장 하나
  - 이미지를 붙인 프롬프트 하나
  - `@파일경로` 멘션이 든 프롬프트 하나
  - 모델이 응답하는 도중에 보내는 프롬프트 하나
- 터미널 폭을 100열과 150열로 바꿔 평범한 문장을 하나씩 더 보낸다.
- `/prompt-upgrade probe show` 의 출력을 붙여 넣는다.
- 끝나면 `/prompt-upgrade probe off` 와 `/prompt-upgrade probe clear` 를 입력한다.

### 읽는 법

| 필드 | 확인할 것 |
|---|---|
| `origin` | 사용자 Enter가 `composer`로 나오는가 |
| `attachments` | 이미지와 멘션이 어떻게 보이는가 |
| `isMidTurn` | 응답 중 입력에서 true가 되는가 |
| `pane` | 100열에서 `waits`, 150열에서 `placed`가 나오는가 |
| `surfaces` | 터미널에서 `terminal`이 나오는가 |

## 시나리오 검증 상태

> 「자동」은 `claude plugin test`의 mock 엔진 테스트다.
> mock 엔진은 화면을 그리지 않고 키 입력을 보내지 않는다.

| # | 시나리오 | 상태 |
|---|---|---|
| 1 | 일반 프롬프트 흐름 | 자동 |
| 2 | 질문 전부 Skip | 자동(Skip the rest) |
| 3 | 원문 그대로 전송 | 자동 |
| 4 | 직접 편집 후 다음 제출 통과 | 자동 |
| 5 | Haiku 실패 시 원문 폴백과 알림 | 자동 |
| 6 | Cancel로 원문 복원 | 자동 |
| 6 | Esc로 닫기 | 미관측(테스트 키트에 person close가 없다) |
| 7 | 슬래시 명령과 짧은 입력 통과 | 자동 |
| 8 | `claude -p` | 미관측(표면이 없으면 통과하는 로직만 자동) |
| 9 | 작업 중 재제출 | 자동(turnId 통과) |
| 10 | 질문 대기 중 새 제출 | 자동 |
| - | 복원 실패 시 클립보드와 토스트 | 자동 |

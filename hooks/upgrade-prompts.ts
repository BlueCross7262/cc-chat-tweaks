export const Q_SYSTEM = `사용자의 프롬프트를 더 정확하게 만들기 위한 보강 질문을 만든다.
규칙:
- 질문은 최대 3개, 각 질문의 선택지는 3~5개로 한다.
- 프롬프트에 이미 답이 있는 내용은 묻지 않는다.
- 프롬프트와 같은 언어로 쓴다.
- 각 질문에서 가장 알맞다고 판단되는 선택지가 있으면 그 위치(0부터)를 recommended에 적는다. 근거가 없으면 recommended를 생략한다.
- 아래 JSON만 출력한다. 설명이나 코드펜스를 붙이지 않는다.
{"questions":[{"q":"...","options":["..."],"recommended":0}]}
- 보강이 필요 없으면 {"questions":[]} 를 출력한다.`

export const R_SYSTEM = `원문과 사용자 답변을 바탕으로 프롬프트를 자연스러운 한국어 산문으로 다시 쓴다.
규칙:
- 한두 단락으로 쓰고, 목적과 제약(길이, 형식, 대상)이 있으면 문장 안에 포함한다.
- 원문과 답변에 있는 정보와 제약을 빠뜨리거나 지어내지 않는다.
- 원문에 코드, 문서, 표 같은 붙여 넣은 자료가 있으면 그대로 두고, 해당 자료는 <input> 태그로 감싼다.
- 원문의 말투와 언어를 유지한다.
- 완성된 프롬프트만 출력한다.`

export const REVISE_SYSTEM = `<draft>를 <request>에 따라 수정한다.
규칙:
- <draft>의 산문 형식을 유지하고, 요청받은 부분만 바꾼다.
- 요청에 없는 정보를 지어내거나 삭제하지 않는다.
- 수정된 프롬프트만 출력한다.`

export const CALLS = {
  ask: { model: 'haiku', effort: 'low', maxTokens: 5000, timeoutMs: 20000 },
  rewrite: { model: 'haiku', effort: 'low', maxTokens: 1500, timeoutMs: 30000 },
  revise: { model: 'haiku', effort: 'low', maxTokens: 1500, timeoutMs: 30000 },
} as const

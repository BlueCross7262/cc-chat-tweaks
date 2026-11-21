import { expect, test } from 'claude-code/testing'

import { NAME_MAX, nameOf } from './session-rename'

test('nameOf takes the first non-blank line without quotes or a final period, cut to the limit', () => {
  expect(nameOf(null)).toBe('')
  expect(nameOf('')).toBe('')
  expect(nameOf('\n  \r\n ')).toBe('')
  expect(nameOf('\n  "Title."  ')).toBe('Title')
  expect(nameOf("'Band timer fix'")).toBe('Band timer fix')
  expect(nameOf('`밴드 타이머 수정`\n둘째 줄')).toBe('밴드 타이머 수정')
  expect(nameOf('a'.repeat(70))).toBe('a'.repeat(NAME_MAX))
  expect(nameOf('v1.2 release')).toBe('v1.2 release')
})

test('nameOf keeps only the first sentence of the line', () => {
  expect(nameOf('고정 대기 제거하기. 작업 내용은 UI 테스트다')).toBe('고정 대기 제거하기')
  expect(nameOf('밴드 수정하기! 다음')).toBe('밴드 수정하기')
  expect(nameOf('Thread.Sleep 제거하기')).toBe('Thread.Sleep 제거하기')
})

test('nameOf cuts a long name at the last word that fits the limit', () => {
  const name = nameOf('UI 테스트 고정 대기를 조건 대기로 바꾸고 판정 충돌 근거를 검토하기')

  expect(name.length).toBeLessThanOrEqual(NAME_MAX)
  expect(name).toBe('UI 테스트 고정 대기를 조건 대기로 바꾸고 판정 충돌')
})

test('nameOf drops a label such as 세션 제목: before the name', () => {
  expect(nameOf('세션 제목: 인자 없이 브랜치 키 사용하기')).toBe('인자 없이 브랜치 키 사용하기')
  expect(nameOf('제목： "밴드 수정하기"')).toBe('밴드 수정하기')
  expect(nameOf('Title: Fix band timer')).toBe('Fix band timer')
  expect(nameOf('Session name: Fix band timer')).toBe('Fix band timer')
  expect(nameOf('README: 설치 절차 고치기')).toBe('README: 설치 절차 고치기')
})

test('nameOf drops a label with other words around the title word', () => {
  expect(nameOf('한국어 제목 생성: 규칙 파일 수정 및 wormhole')).toBe('규칙 파일 수정 및 wormhole')
  expect(nameOf('Korean title: Fix band timer')).toBe('Fix band timer')
  expect(nameOf('세션 이름 제안: 밴드 수정하기')).toBe('밴드 수정하기')
  expect(nameOf('한국어 제목 생성:\n규칙 파일 수정하기')).toBe('규칙 파일 수정하기')
  expect(nameOf('"한국어 제목 생성: 밴드 수정하기"')).toBe('밴드 수정하기')
})

test('nameOf keeps a colon phrase with no title word near it', () => {
  expect(nameOf('README: 설치 절차 고치기')).toBe('README: 설치 절차 고치기')
  expect(nameOf('rename: 훅 고치기')).toBe('rename: 훅 고치기')
  expect(nameOf('filename 규칙: 정리하기')).toBe('filename 규칙: 정리하기')
  expect(nameOf('제목줄 수정하기')).toBe('제목줄 수정하기')
  expect(nameOf('세션 이름 바꾸기')).toBe('세션 이름 바꾸기')
  expect(nameOf('a b c 제목: x')).toBe('a b c 제목: x')
})

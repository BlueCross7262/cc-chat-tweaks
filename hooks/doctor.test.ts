import { expect, test } from 'claude-code/testing'

import { checksOf, formatReport, type DoctorInput } from './doctor'

const input = (patch: Partial<DoctorInput> = {}): DoctorInput => ({
  flags: [
    { key: 'use-tool-fold', value: true, from: 'user' },
    { key: 'use-progress-line', value: false, from: 'default' },
    { key: 'use-edit-summary', value: false, from: 'default' },
  ],
  missing: [],
  settingsPath: 'C:/Users/x/.claude/settings.json',
  runs: { tracked: 3, pending: false, failed: 0, changes: 5 },
  line: { root: 'D:/p', sessionId: 's1', pointerFound: true, shown: 'Phase 1/2', debugFile: '' },
  env: { surface: 'terminal', version: '2.1.0' },
  ...patch,
})

test('prints each switch with its value and where it came from', () => {
  const text = formatReport(input())

  expect(text).toContain('use-tool-fold      on   (user)')
  expect(text).toContain('use-progress-line  off  (default)')
})

test('prints the fold counters and the progress line state', () => {
  const text = formatReport(input())

  expect(text).toContain('runs tracked: 3, pending: no, failed calls: 0, change records: 5')
  expect(text).toContain('chain pointer: found')
  expect(text).toContain('shown now: Phase 1/2')
  expect(text).toContain('debug file: (off)')
})

test('reports no problem when everything is in place', () => {
  expect(checksOf(input())[0]).toBe('[ok] No problem found.')
})

test('tells how to add switches that settings.json lacks', () => {
  const [first] = checksOf(input({ missing: ['use-progress-line', 'use-edit-summary'] }))

  expect(first).toContain('lacks 2 switch(es): use-progress-line, use-edit-summary')
  expect(first).toContain('/tweaks-doctor --apply')
})

test('warns when folding is on and no run has been tracked', () => {
  const checks = checksOf(input({ runs: { tracked: 0, pending: false, failed: 0, changes: 0 } }))

  expect(checks.some(check => check.startsWith('[warn] use-tool-fold is on'))).toBe(true)
})

test('says the mod draws nothing when every switch is off', () => {
  const off = input({
    flags: [
      { key: 'use-tool-fold', value: false, from: 'default' },
      { key: 'use-progress-line', value: false, from: 'default' },
      { key: 'use-edit-summary', value: false, from: 'default' },
    ],
  })

  expect(checksOf(off).some(check => check.includes('Every feature is off'))).toBe(true)
})

test('notes a missing chain pointer only while the progress line is on', () => {
  const on = input({
    flags: [{ key: 'use-progress-line', value: true, from: 'user' }],
    line: { root: 'D:/p', sessionId: 's1', pointerFound: false, shown: null, debugFile: '' },
  })

  expect(checksOf(on).some(check => check.includes('No phase-chain state'))).toBe(true)
  expect(checksOf(input({ line: { ...on.line } })).some(check => check.includes('No phase-chain state'))).toBe(false)
})

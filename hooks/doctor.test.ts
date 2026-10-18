import { expect, test } from 'claude-code/testing'

import { checksOf, formatReport, versionText, type DoctorInput } from './doctor'

const input = (patch: Partial<DoctorInput> = {}): DoctorInput => ({
  flags: [
    { key: 'use-tool-fold', value: true, from: 'user' },
    { key: 'use-edit-summary', value: false, from: 'default' },
  ],
  extras: [
    { key: 'min-length', value: 10, from: 'default' },
    { key: 'silent-triggers', value: ['+++'], from: 'default' },
    { key: 'models.ask.model', value: 'haiku', from: 'default' },
    { key: 'models.ask.effort', value: 'low', from: 'user' },
    { key: 'unfolded-tools', value: ['AskUserQuestion', 'Skill', 'Agent'], from: 'default' },
  ],
  ignored: [],
  runs: {
    tracked: 3,
    pending: false,
    failed: 0,
    changes: 5,
    times: 7,
    done: 9,
    untimed: {
      failed: ['Bash'],
      others: [],
      perTool: [
        ['Bash', { untimed: 1, total: 1 }],
        ['Edit', { untimed: 0, total: 8 }],
      ],
    },
  },
  upgrade: { phase: 'idle', minLen: 10 },
  env: { surface: 'terminal', version: '2.1.0' },
  ...patch,
})

test('prints each switch with its value and where it came from', () => {
  const text = formatReport(input())

  expect(text).toMatch(/chat\.tool-fold\.use\s+on\s+\(user\)/)
  expect(text).toMatch(/chat\.use-edit-summary\s+off\s+\(default\)/)
})

test('prints the value keys with their value and source under the switches', () => {
  const text = formatReport(input())

  expect(text).toMatch(/prompt\.prompt-upgrade\.min-length\s+10\s+\(default\)/)
  expect(text).toMatch(/chat\.tool-fold\.unfolded-tools\s+\["AskUserQuestion","Skill","Agent"\]\s+\(default\)/)
  expect(text).toMatch(/silent-triggers\s+\["\+\+\+"\]\s+\(default\)/)
  expect(text).toMatch(/prompt\.prompt-upgrade\.models\.ask\.model\s+"haiku"\s+\(default\)/)
  expect(text).toMatch(/prompt\.prompt-upgrade\.models\.ask\.effort\s+"low"\s+\(user\)/)
  expect(text.indexOf('use-edit-summary')).toBeLessThan(text.indexOf('min-length'))
})

test('prints the prompt upgrade phase and threshold', () => {
  const text = formatReport(input({ upgrade: { phase: 'review', minLen: 25 } }))

  expect(text).toContain('phase: review, threshold: 25 characters')
})

test('the questions option alone does not count as a feature being on', () => {
  const onlyOption = input({
    flags: [
      { key: 'use-tool-fold', value: false, from: 'default' },
      { key: 'use-questions', value: true, from: 'default' },
    ],
  })

  expect(checksOf(onlyOption).some(check => check.includes('Every feature is off'))).toBe(true)
})

test('prints the fold counters and the environment', () => {
  const text = formatReport(input())

  expect(text).toContain('runs tracked: 3, pending: no, failed calls: 0, change records: 5')
  expect(text).toContain('surface: terminal')
  expect(text).toContain('claude code: 2.1.0')
})

test('prints the time records and the calls that finished without a time', () => {
  const text = formatReport(input())

  expect(text).toContain('time records: 7, done calls: 9')
  expect(text).toContain('untimed failed: Bash, untimed other: none')
  expect(text).toContain('per tool (untimed/total): Bash 1/1, Edit 0/8')
})

test('prints none where no call finished without a time', () => {
  const text = formatReport(
    input({
      runs: {
        tracked: 0,
        pending: false,
        failed: 0,
        changes: 0,
        times: 0,
        done: 0,
        untimed: { failed: [], others: [], perTool: [] },
      },
    }),
  )

  expect(text).toContain('time records: 0, done calls: 0')
  expect(text).toContain('untimed failed: none, untimed other: none')
  expect(text).toContain('per tool (untimed/total): none')
})

test('reads the version from a string, an object or a nested object', () => {
  expect(versionText('2.1.295')).toBe('2.1.295')
  expect(versionText({ version: '2.1.295', base: '2.1.295' })).toBe('2.1.295')
  expect(versionText({ version: { version: '2.1.295' } })).toBe('2.1.295')
  expect(versionText(undefined)).toBe('unknown')
  expect(versionText({ base: '2.1.295' })).toBe('{"base":"2.1.295"}')
})

test('reports no problem when everything is in place', () => {
  expect(checksOf(input())).toEqual(['[ok] No problem found.'])
})

test('warns once for each old model key found, naming where it was found and the key to use instead', () => {
  const checks = checksOf(
    input({
      ignored: [
        { key: 'model', from: 'user' },
        { key: 'effort', from: 'local' },
        { key: 'type-model', from: 'user' },
        { key: 'type-effort', from: 'project' },
      ],
    }),
  )

  expect(checks).toEqual([
    '[warn] prompt.prompt-upgrade.model in user is ignored. Use prompt.prompt-upgrade.models.<ask|rewrite>.model.',
    '[warn] prompt.prompt-upgrade.effort in local is ignored. Use prompt.prompt-upgrade.models.<ask|rewrite>.effort.',
    '[warn] prompt.prompt-upgrade.type-model in user is ignored. Use prompt.prompt-upgrade.models.classify.model.',
    '[warn] prompt.prompt-upgrade.type-effort in project is ignored. Use prompt.prompt-upgrade.models.classify.effort.',
  ])
})

test('warns when folding is on and no run has been tracked', () => {
  const checks = checksOf(input({
      runs: {
        tracked: 0,
        pending: false,
        failed: 0,
        changes: 0,
        times: 0,
        done: 0,
        untimed: { failed: [], others: [], perTool: [] },
      },
    }))

  expect(checks.some(check => check.startsWith('[warn] chat.tool-fold.use is on'))).toBe(true)
})

test('says the mod draws nothing when every switch is off', () => {
  const off = input({
    flags: [
      { key: 'use-tool-fold', value: false, from: 'default' },
      { key: 'use-edit-summary', value: false, from: 'default' },
    ],
  })

  expect(checksOf(off).some(check => check.includes('Every feature is off'))).toBe(true)
})

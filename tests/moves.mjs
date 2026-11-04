// Checks the move rules: every path uses a different move, and
// "change" + "wildcard" are always present. Loads the built backend.js in a
// sandbox with a stub Lumiverse API, then calls its internal helpers.
import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const stub = new Proxy(function () {}, {
  get: (_t, key) => (key === 'then' ? undefined : stub),
  apply: () => stub,
})
const src = fs.readFileSync(new URL('../backend.js', import.meta.url), 'utf8')
const ctx = { spindle: stub, console, setTimeout, clearTimeout, URL, TextEncoder, crypto: globalThis.crypto }
vm.createContext(ctx)
vm.runInContext(src + '\n;globalThis.__pp = { validateResult, normalizeMove, buildSystemPrompt, MOVES };', ctx)
const { validateResult, normalizeMove, buildSystemPrompt, MOVES } = ctx.__pp

const text = 'I set the mug down and look at her for a long moment, weighing whether to say anything at all, then I lean back against the counter.'
const choice = (move, extra = {}) => ({ move, intent: 'go ' + move, title: 'Some label', stakes: 'Could cost her trust', text, intensity: 2, ...extra })
const result = (moves, state = {}) => ({
  scene_state: { location: 'Kitchen', moment: 'Hannah waiting', pressure: 'Hannah wants an answer before she leaves.', ...state },
  choices: moves.map(choice),
})

assert.equal(MOVES.length, 6)
assert.equal(validateResult(result(['deeper', 'change', 'wildcard']), 3, 'normal').length, 0)
assert.equal(validateResult(result(['deeper', 'pushback', 'pullback', 'change', 'wildcard', 'wait']), 6, 'normal').length, 0)

let issues = validateResult(result(['deeper', 'deeper', 'change', 'wildcard']), 4, 'normal')
assert.ok(issues.some(i => i.includes('repeats the move')), issues.join('; '))

issues = validateResult(result(['deeper', 'pushback', 'change']), 3, 'normal')
assert.ok(issues.some(i => i.includes('"wildcard"')), issues.join('; '))

issues = validateResult(result(['deeper', 'pushback', 'wildcard']), 3, 'normal')
assert.ok(issues.some(i => i.includes('"change"')), issues.join('; '))

issues = validateResult(result(['deeper', 'change', 'wildcard'], { pressure: '' }), 3, 'normal')
assert.ok(issues.some(i => i.includes('pressure')), issues.join('; '))

const noStakes = result(['deeper', 'change', 'wildcard']); noStakes.choices[0].stakes = ''
assert.ok(validateResult(noStakes, 3, 'normal').some(i => i.includes('stakes')))

assert.equal(normalizeMove('Push back'), 'pushback')
assert.equal(normalizeMove('Watch and wait'), 'wait')
assert.equal(normalizeMove('WILDCARD'), 'wildcard')
assert.equal(normalizeMove('dance'), undefined)

const prompt = buildSystemPrompt({ choiceCount: 4, pov: 'auto', tense: 'auto', detail: 'normal', adultContent: 'match_scene' })
assert.ok(prompt.includes('NO TWO CHOICES MAY SHARE A MOVE'))
assert.ok(!prompt.includes('do not force them into fixed categories'))
assert.ok(prompt.includes('"pressure"'))
console.log('moves: all checks passed')

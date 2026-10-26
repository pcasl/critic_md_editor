const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { compare, cases } = require('./diff-worker.cjs');

const pythonFile = path.resolve(process.argv[2] || path.join(__dirname, '../diff.py'));
const inputs = cases.map(([old, current]) => [old, current]);
let seed = 7341;
function random(limit) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % limit;
}
const pieces = ['a', 'b', ' ', '\n', '你好', '🙂', '{==highlight==}',
  '{++addition++}', '{--deletion--}', '{>>comment<<}', '{>><<}',
  '{>>literal {++text++} {==highlight==}<<}', '{>>unclosed {++literal<<}',
  '{>>multiple\nlines<<}', 'CRITICCOMMENTPLACEHOLDER0END'];
for (let i = 0; i < 1000; i++) {
  let old = '', current = '';
  for (let j = random(12); j > 0; j--) old += pieces[random(pieces.length)];
  for (let j = random(12); j > 0; j--) current += pieces[random(pieces.length)];
  inputs.push([old, current]);
}
const expected = inputs.map(([old, current]) => compare(old, current));
const runner = `import json, runpy, sys
ns = runpy.run_path(sys.argv[1], run_name='test')
print(json.dumps([ns['create_diff'](old, current) for old, current in json.load(sys.stdin)]))
`;
const result = spawnSync('python3', ['-c', runner, pythonFile], {
  input: JSON.stringify(inputs), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
});
assert.equal(result.status, 0, result.stderr);
const actual = JSON.parse(result.stdout);
assert.equal(actual.length, expected.length);
actual.forEach((value, i) => assert.equal(value, expected[i], JSON.stringify(inputs[i])));
console.log(`Python matches the HTML worker for ${inputs.length} comparisons.`);

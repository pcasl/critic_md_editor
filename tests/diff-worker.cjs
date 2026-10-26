const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');

const html = fs.readFileSync(path.join(__dirname, '../critic-md.html'), 'utf8');
const source = html.slice(html.indexOf('function diffWorker(){'), html.indexOf('function ensureWorker()'));
const messages = [];
const context = vm.createContext({ self: { postMessage: message => messages.push(message) } });
vm.runInContext(source + '\ndiffWorker();', context);
// Network loading is deliberately unavailable in this context.
function compare(original, current) {
  messages.length = 0;
  context.self.onmessage({ data: { original, current } });
  const result = messages.at(-1);
  assert.equal(result.type, 'result', result.message);
  return result.diff;
}

const cases = [
  ["","",""],
  ["","Hello","{++Hello++}"],
  ["Hello","","{--Hello--}"],
  ["Hello world","Hello Earth","Hello {--world--}{++Earth++}"],
  ["a\n\nb","a\nb","a{--\n\n--}{++\n++}b"],
  ["你好，世界","你好，朋友","你好，{--世界--}{++朋友++}"],
  ["café 🙂","café 🚀","café {--🙂--}{++🚀++}"],
  ["Hello world","Hello {--world--}{++Earth++}","Hello {++{--++}world{++--}{++Earth++}++}"],
  ["a b","a {>>keep {++literal++} and {--markers--}<<}b","a {>>keep {++literal++} and {--markers--}<<}b"],
  ["a","a{++b{--c--}d++}","a{++{++b{--c--}d++}++}"],
  ["a {++unclosed","a {++unclosed","a {++unclosed"],
  ["same","same","same"],
  ["x","{>>comment only<<}","{--x--}{>>comment only<<}"],
  ["","{++addition only++}","{++{++addition only++}++}"],
  ["Hello world","Hello {==world==}","Hello {==world==}"],
  ["Hello {==world==}","Hello world","Hello world"],
  ["Hello {==world==}","Hello {==world==}","Hello {==world==}"],
  ["hello","hel{==lo==}","hel{==lo==}"],
  ["hel{==lo==}","hello","hello"],
  ["Hello world","Hello {==Earth==}","Hello {=={--world--}{++Earth++}==}"],
  ["Hello {==world==}","Hello Earth","Hello {--world--}{++Earth++}"],
  ["a b c","a {==b==} {==c==}","a {==b==} {==c==}"],
  ["","{====}","{====}"],
  ["a","a{====}","a{====}"],
  ["a b","a {=={--b--}{++c++}==}","a {=={++{--++}b{++--}{++c++}++}==}"],
  ["a b","a {==b==}{>>highlight comment<<}","a {==b==}{>>highlight comment<<}"],
  ["a {==unclosed","a {==unclosed","a {==unclosed"],
  ["a b","a {==b{>>literal {==highlight==}<<}==}","a {==b{>>literal {==highlight==}<<}==}"],
  ["abc","a{==b==}c","a{==b==}c"],
  ["abc","{==a{==b==}c==}","{==a{==b==}c==}"],
  ["CRITICHIGHLIGHTPLACEHOLDEROPENEND","{==new==}","{--CRITICHIGHLIGHTPLACEHOLDEROPENEND--}{=={++new++}==}"],
  ["","{>><<}","{>><<}"],
  ["a b","a {>><<}b","a {>><<}b"],
  ["a","a{>>first\nsecond<<}","a{>>first\nsecond<<}"],
  ["a","a{>>{++unclosed {==also unclosed<<}","a{>>{++unclosed {==also unclosed<<}"],
  ["The quick brown fox.","The slow red fox.","The {--quick brown--}{++slow red++} fox."],
  ["a b\nc d","x y\nz w","{--a b--}{++x y++}\n{--c d--}{++z w++}"],
  ["a\tb","x\ty","{--a\tb--}{++x\ty++}"],
  ["a\rb","x\ry","{--a--}{++x++}\r{--b--}{++y++}"],
  ["same{>>old<<}","same{>>new<<}","same{>>new<<}"],
  ["abc","{==a==}{>>note<<}xy","{--abc--}{=={++a++}==}{>>note<<}{++xy++}"],
  ["a﻿b","x﻿y","{--a--}{++x++}﻿{--b--}{++y++}"],
  ["ab","xy","{--ab--}{++xy++}"],
  ["𐐀 ²","𐐁 ³","{--𐐀 ²--}{++𐐁 ³++}"],
];
for (const [old, current, expected] of cases) assert.equal(compare(old, current), expected);

// Verify the actual serialized worker entry point and consecutive requests.
const worker = new Worker(`
  const { parentPort } = require('node:worker_threads');
  global.self = { postMessage: message => parentPort.postMessage(message) };
  ${source}
  diffWorker();
  parentPort.on('message', data => self.onmessage({ data }));
`, { eval: true });
const timeout = setTimeout(() => { worker.terminate(); throw new Error('Worker timed out'); }, 10000);
let results = 0;
worker.on('error', error => { throw error; });
worker.on('message', message => {
  assert.notEqual(message.type, 'error', message.message);
  if (message.type !== 'result') return;
  assert.equal(message.diff, cases[results][2]);
  results++;
  if (results === cases.length) {
    clearTimeout(timeout);
    worker.terminate();
    console.log(`Passed ${cases.length} offline diff cases and ${results} worker round trips.`);
  } else worker.postMessage({ original: cases[results][0], current: cases[results][1] });
});
worker.postMessage({ original: cases[0][0], current: cases[0][1] });

// Parse the complete browser script as well as the isolated worker.
new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
assert.doesNotMatch(html, /importScripts\(|loadPyodide\(|cdn\.jsdelivr\.net/);
module.exports = { compare, cases };

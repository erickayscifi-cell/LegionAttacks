// Minimal hand-rolled DOM shim, just enough to execute app.js / index.html
// wiring and catch runtime errors, since no network access to install jsdom.
class FakeClassList {
  constructor(el) { this.el = el; }
  _set() { return (this.el._className || '').split(/\s+/).filter(Boolean); }
  toggle(name) {
    const s = new Set(this._set());
    if (s.has(name)) s.delete(name); else s.add(name);
    this.el._className = Array.from(s).join(' ');
  }
  add(name) { const s = new Set(this._set()); s.add(name); this.el._className = Array.from(s).join(' '); }
  remove(name) { const s = new Set(this._set()); s.delete(name); this.el._className = Array.from(s).join(' '); }
  contains(name) { return this._set().includes(name); }
}

class FakeStyle {
  constructor() { this._props = {}; }
  set width(v) { this._props.width = v; }
  get width() { return this._props.width; }
}

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this._attrs = {};
    this._className = '';
    this._listeners = {};
    this._value = '';
    this._checked = false;
    this.style = new FakeStyle();
    this.classList = new FakeClassList(this);
  }
  set className(v) { this._className = v; }
  get className() { return this._className; }
  setAttribute(k, v) {
    this._attrs[k] = v;
    if (k === 'id') this._id = v;
    if (k === 'value' && this.tagName !== 'select') this._value = v;
  }
  getAttribute(k) { return this._attrs[k]; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  set innerHTML(v) { this.children = []; this._innerHTML = v; }
  get innerHTML() { return this._innerHTML || ''; }
  set textContent(v) { this._textContent = v; this.children = []; }
  get textContent() { return this._textContent || ''; }
  set value(v) { this._value = v; }
  get value() { return this._value; }
  set checked(v) { this._checked = v; }
  get checked() { return this._checked; }
  set selected(v) { this._selected = v; }
  addEventListener(type, fn) {
    this._listeners[type] = this._listeners[type] || [];
    this._listeners[type].push(fn);
  }
  dispatchEvent(evt) {
    (this._listeners[evt.type] || []).forEach((fn) => fn({ target: this, ...evt }));
  }
  click() { this.dispatchEvent({ type: 'click' }); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); }
  querySelectorAll(sel) {
    // extremely limited: match by ".classname"
    const cls = sel.replace('.', '');
    const results = [];
    const walk = (node) => {
      (node.children || []).forEach((c) => {
        if (c._className && c._className.split(/\s+/).includes(cls)) results.push(c);
        walk(c);
      });
    };
    walk(this);
    return results;
  }
}

const idRegistry = {};
global.document = {
  body: new FakeElement('body'),
  createElement(tag) {
    const e = new FakeElement(tag);
    return e;
  },
  createTextNode(text) {
    const e = new FakeElement('#text');
    e.textContent = text;
    return e;
  },
  getElementById(id) {
    if (!idRegistry[id]) throw new Error('Missing element in registry: ' + id);
    return idRegistry[id];
  },
};

// Register every element referenced by app.js via getElementById, matching index.html.
const ids = [
  'gearBtn', 'settingsPanel', 'closeSettings', 'trialsSelect', 'themeSelect',
  'def-health', 'def-defenseDie', 'def-defenseSurgeConv', 'def-cover', 'def-coverX', 'def-lowProfile',
  'def-armorEnabled', 'def-armorX', 'def-impervious', 'def-dangerSenseX', 'def-uncannyLuckX',
  'def-upgradeX', 'def-immunePierce', 'def-immuneBlast', 'def-block', 'def-nimble', 'def-outmaneuver',
  'def-dodge', 'def-shield', 'def-suppression', 'def-surge',
  'addAttackBtn', 'attacksList', 'resultsList', 'trialsLabel', 'quoteLine',
  'exportAllBtn', 'importAllBtn', 'importAllFile',
];
ids.forEach((id) => {
  const tag = id.includes('Select') || id.startsWith('def-defenseDie') || id.startsWith('def-defenseSurgeConv') || id === 'def-cover' ? 'select' : 'div';
  const e = new FakeElement(tag);
  e._id = id;
  idRegistry[id] = e;
});
// give inputs a .value/.checked baseline matching index.html defaults
idRegistry['def-health'].value = '6';

global.window = global;
global.self = global;

// Minimal stubs so the download/upload toolbar buttons don't throw.
global.LegionTheme = { get: () => 'system', set: () => {} };
global.Blob = function Blob(parts, opts) { this.parts = parts; this.opts = opts; };
global.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} };
global.FileReader = function FileReader() {
  this.readAsText = () => { /* no file selected in this test, so onload never fires */ };
};
global.alert = (msg) => { console.log('[alert]', msg); };

const fs = require('fs');
const engineSrc = fs.readFileSync('/sessions/trusting-cool-einstein/mnt/LegionTargeter/engine.js', 'utf8');
const appSrc = fs.readFileSync('/sessions/trusting-cool-einstein/mnt/LegionTargeter/app.js', 'utf8');

const indirectEval = (0, eval); // runs in global scope, like a <script> tag, unlike node's module-scoped eval

try {
  indirectEval(engineSrc);
  console.log('engine.js evaluated OK, LegionEngine defined:', typeof global.LegionEngine);
} catch (e) {
  console.error('ERROR evaluating engine.js:', e);
  process.exit(1);
}

try {
  indirectEval(appSrc);
  console.log('app.js evaluated OK (initial render + first simulation ran without throwing)');
} catch (e) {
  console.error('ERROR evaluating app.js:', e);
  process.exit(1);
}

// Give the debounced recompute() a moment to fire, then inspect state.
setTimeout(() => {
  const attacksList = idRegistry['attacksList'];
  console.log('attack cards after init:', attacksList.children.filter(c => c._className && c._className.includes('attack-card')).length);

  // Simulate clicking "Add Attack"
  idRegistry['addAttackBtn'].dispatchEvent({ type: 'click' });
  console.log('attack cards after add:', attacksList.children.filter(c => c._className && c._className.includes('attack-card')).length);

  // Simulate editing health
  idRegistry['def-health'].value = '10';
  idRegistry['def-health'].dispatchEvent({ type: 'input' });

  setTimeout(() => {
    const resultsList = idRegistry['resultsList'];
    console.log('result cards after health edit + debounce:', resultsList.children.filter(c => c._className && c._className.includes('result-card')).length);

    // Exercise the per-attack toolbar: move up/down, duplicate, download, upload-click (no file chosen).
    const firstCard = attacksList.children.find(c => c._className && c._className.includes('attack-card'));
    const toolbarBtns = firstCard.querySelectorAll('.icon-mini-btn');
    console.log('toolbar buttons found on first card:', toolbarBtns.length, '(expect 6: moveUp/moveDown/duplicate/download/upload/remove)');
    const [moveUpBtn, moveDownBtn, dupBtn, downloadBtn, uploadBtn] = toolbarBtns;
    if (!('disabled' in moveUpBtn._attrs)) throw new Error('First card\'s move-up button should be disabled');
    moveDownBtn.click();
    const namesAfterMove = attacksList.children
      .filter(c => c._className && c._className.includes('attack-card'))
      .map(c => c.children.find(x => x._className === 'attack-card-header').children.find(x => x._className === 'attack-name').value);
    console.log('attack order after moving card 1 down:', namesAfterMove.join(', '));
    if (namesAfterMove[1] !== 'Attack 1') throw new Error('Move-down did not reorder the attack list');
    // Move it back up so the rest of the test's card-1 assumptions still hold.
    const cardNowSecond = attacksList.children.filter(c => c._className && c._className.includes('attack-card'))[1];
    cardNowSecond.querySelectorAll('.icon-mini-btn')[0].click();

    dupBtn.click();
    console.log('attack cards after duplicate:', attacksList.children.filter(c => c._className && c._className.includes('attack-card')).length);
    downloadBtn.click();
    console.log('download click did not throw');
    uploadBtn.click(); // triggers hidden fileInput.click(); no file chosen, so onload never fires
    console.log('upload button click (no file) did not throw');

    console.log('ALL CHECKS PASSED');
  }, 400);
}, 400);

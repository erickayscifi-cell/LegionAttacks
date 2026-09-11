// Focused test: verify the actual JSON export/import round trip (not just
// "did it throw"). Reuses the same fake DOM approach as minidom_test.js.
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
class FakeStyle { constructor() { this._props = {}; } set width(v) { this._props.width = v; } get width() { return this._props.width; } }
class FakeElement {
  constructor(tag) {
    this.tagName = tag; this.children = []; this._attrs = {}; this._className = '';
    this._listeners = {}; this._value = ''; this._checked = false;
    this.style = new FakeStyle(); this.classList = new FakeClassList(this);
  }
  set className(v) { this._className = v; }
  get className() { return this._className; }
  setAttribute(k, v) { this._attrs[k] = v; if (k === 'id') this._id = v; if (k === 'value' && this.tagName !== 'select') this._value = v; }
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
  set files(v) { this._files = v; }
  get files() { return this._files; }
  addEventListener(type, fn) { this._listeners[type] = this._listeners[type] || []; this._listeners[type].push(fn); }
  dispatchEvent(evt) { (this._listeners[evt.type] || []).forEach((fn) => fn({ target: this, ...evt })); }
  click() { this.dispatchEvent({ type: 'click' }); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); }
  querySelectorAll(sel) {
    const cls = sel.replace('.', '');
    const results = [];
    const walk = (node) => { (node.children || []).forEach((c) => { if (c._className && c._className.split(/\s+/).includes(cls)) results.push(c); walk(c); }); };
    walk(this);
    return results;
  }
}

const idRegistry = {};
global.document = {
  body: new FakeElement('body'),
  createElement(tag) { return new FakeElement(tag); },
  createTextNode(text) { const e = new FakeElement('#text'); e.textContent = text; return e; },
  getElementById(id) { if (!idRegistry[id]) throw new Error('Missing element in registry: ' + id); return idRegistry[id]; },
};
const ids = [
  'gearBtn', 'settingsPanel', 'closeSettings', 'trialsSelect', 'themeSelect',
  'def-name', 'defSaveBtn', 'defLoadBtn', 'defLoadFile',
  'def-health', 'def-defenseDie', 'def-defenseSurgeConv', 'def-cover', 'def-coverX', 'def-lowProfile',
  'def-armorEnabled', 'def-armorX', 'def-impervious', 'def-dangerSenseX', 'def-uncannyLuckX',
  'def-upgradeX', 'def-immunePierce', 'def-immuneBlast', 'def-block', 'def-nimble', 'def-outmaneuver',
  'def-dodge', 'def-shield', 'def-suppression', 'def-surge',
  'addAttackBtn', 'attacksList', 'resultsList', 'trialsLabel', 'quoteLine',
  'exportAllBtn', 'importAllBtn', 'importAllFile',
];
ids.forEach((id) => { const e = new FakeElement('div'); e._id = id; idRegistry[id] = e; });
idRegistry['def-health'].value = '6';
global.window = global;
global.self = global;
global.LegionTheme = { get: () => 'system', set: () => {} };

let lastBlobContent = null;
global.Blob = function Blob(parts) { lastBlobContent = parts.join(''); };
global.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} };
global.FileReader = function FileReader() {
  this.readAsText = (file) => { this.result = file._text; if (this.onload) this.onload(); };
};
global.alert = (msg) => { throw new Error('Unexpected alert: ' + msg); };

const fs = require('fs');
const indirectEval = (0, eval);
indirectEval(fs.readFileSync('/sessions/trusting-cool-einstein/mnt/LegionTargeter/engine.js', 'utf8'));
indirectEval(fs.readFileSync('/sessions/trusting-cool-einstein/mnt/LegionTargeter/app.js', 'utf8'));

setTimeout(() => {
  const attacksList = idRegistry['attacksList'];
  const cards = () => attacksList.children.filter(c => c._className && c._className.includes('attack-card'));

  // 1) Edit attack #1's dice pool and name so we have something distinctive to export.
  const firstCard = cards()[0];
  const nameInput = firstCard.children.find(c => c._className === 'attack-card-header').children.find(c => c._className === 'attack-name');
  nameInput.value = 'Stormtrooper Squad';
  nameInput.dispatchEvent({ type: 'input' });

  // Toolbar order is now: moveUp, moveDown, duplicate, download, upload, remove.
  const firstToolbar = firstCard.querySelectorAll('.icon-mini-btn');
  const [dupBtn, downloadBtn, uploadBtn] = [firstToolbar[2], firstToolbar[3], firstToolbar[4]];

  // 2) Download it -> capture the JSON that would have been written to disk.
  downloadBtn.click();
  const exported = JSON.parse(lastBlobContent);
  console.log('exported name:', exported.name, '| schema:', exported.schema, '| black dice:', exported.black);
  if (exported.name !== 'Stormtrooper Squad') throw new Error('Export did not capture the renamed attack');
  if (exported.schema !== 'legion-targeter-attacker') throw new Error('Missing/wrong schema tag');

  // 3) Mutate the export to simulate a different attacker, then "upload" it
  //    into attack card #2 and confirm card #2 (not #1) gets overwritten.
  const secondCard = cards()[1];
  const secondNameInputBefore = secondCard.children.find(c => c._className === 'attack-card-header').children.find(c => c._className === 'attack-name').value;
  console.log('card 2 name before upload:', secondNameInputBefore);

  const imported = Object.assign({}, exported, { name: 'Uploaded Squad', black: 7, criticalX: 2 });
  const secondToolbar = secondCard.querySelectorAll('.icon-mini-btn');
  const secondUploadBtn = secondToolbar[4];
  const fileInput = secondToolbar[4].parentNode.children.find(c => c.tagName === 'input' && c._attrs.type === 'file');
  fileInput.files = [{ _text: JSON.stringify(imported) }];
  fileInput.dispatchEvent({ type: 'change' });

  setTimeout(() => {
    const newCards = cards();
    const secondCardAfter = newCards[1];
    const nameAfter = secondCardAfter.children.find(c => c._className === 'attack-card-header').children.find(c => c._className === 'attack-name').value;
    console.log('card 2 name after upload:', nameAfter);
    if (nameAfter !== 'Uploaded Squad') throw new Error('Upload did not overwrite the correct card');

    const firstCardAfter = newCards[0];
    const firstNameAfter = firstCardAfter.children.find(c => c._className === 'attack-card-header').children.find(c => c._className === 'attack-name').value;
    console.log('card 1 name unchanged:', firstNameAfter);
    if (firstNameAfter !== 'Stormtrooper Squad') throw new Error('Upload leaked into the wrong card');

    console.log('ALL JSON ROUND-TRIP CHECKS PASSED');

    // 4) Full export/import: change the defender's health, export everything,
    //    mutate the export, "upload" it via the Import All flow, and confirm
    //    both the defender field and the attack cards were replaced.
    idRegistry['def-health'].value = '9';
    idRegistry['def-health'].dispatchEvent({ type: 'input' });

    idRegistry['exportAllBtn'].click();
    const fullExport = JSON.parse(lastBlobContent);
    if (fullExport.schema !== 'legion-targeter-full') throw new Error('Full export missing schema tag');
    if (String(fullExport.defender.health) !== '9') throw new Error('Full export did not capture defender health edit');
    console.log('full export defender health:', fullExport.defender.health, '| attacks exported:', fullExport.attacks.length);

    const fullImport = JSON.parse(JSON.stringify(fullExport));
    fullImport.defender.health = 3;
    fullImport.defender.dodge = 2;
    fullImport.attacks = [Object.assign({}, fullImport.attacks[0], { name: 'Imported Solo Attacker' })];

    idRegistry['importAllFile'].files = [{ _text: JSON.stringify(fullImport) }];
    idRegistry['importAllFile'].dispatchEvent({ type: 'change' });

    setTimeout(() => {
      if (idRegistry['def-health'].value !== 3) throw new Error('Full import did not update def-health field');
      if (idRegistry['def-dodge'].value !== 2) throw new Error('Full import did not update def-dodge field');
      const importedCards = attacksList.children.filter(c => c._className && c._className.includes('attack-card'));
      if (importedCards.length !== 1) throw new Error('Full import did not replace the attack list with the imported one');
      const importedName = importedCards[0].children.find(c => c._className === 'attack-card-header').children.find(c => c._className === 'attack-name').value;
      if (importedName !== 'Imported Solo Attacker') throw new Error('Full import attack name mismatch');
      console.log('full import defender health/dodge:', idRegistry['def-health'].value, idRegistry['def-dodge'].value, '| attack count:', importedCards.length, '| name:', importedName);
      console.log('ALL FULL EXPORT/IMPORT CHECKS PASSED');

      // 5) Standalone defender save/load: name it, tweak a field, save it,
      //    mutate the export, "upload" it, and confirm both the name field
      //    and the tweaked field landed (independent of the attack list).
      idRegistry['def-name'].value = 'Heavy Weapon Team';
      idRegistry['def-name'].dispatchEvent({ type: 'input' });
      idRegistry['def-suppression'].value = '4';
      idRegistry['def-suppression'].dispatchEvent({ type: 'input' });

      idRegistry['defSaveBtn'].click();
      const defExport = JSON.parse(lastBlobContent);
      if (defExport.schema !== 'legion-targeter-defender') throw new Error('Defender export missing schema tag');
      if (defExport.name !== 'Heavy Weapon Team') throw new Error('Defender export did not capture the name');
      if (String(defExport.suppression) !== '4') throw new Error('Defender export did not capture the suppression edit');
      console.log('defender export name:', defExport.name, '| suppression:', defExport.suppression);

      const defImport = Object.assign({}, defExport, { name: 'Loaded Defender', health: 11, dodge: 3 });
      idRegistry['defLoadFile'].files = [{ _text: JSON.stringify(defImport) }];
      idRegistry['defLoadFile'].dispatchEvent({ type: 'change' });

      if (idRegistry['def-name'].value !== 'Loaded Defender') throw new Error('Defender import did not update the name field');
      if (idRegistry['def-health'].value !== 11) throw new Error('Defender import did not update health');
      if (idRegistry['def-dodge'].value !== 3) throw new Error('Defender import did not update dodge');
      const attackCountAfterDefenderLoad = attacksList.children.filter(c => c._className && c._className.includes('attack-card')).length;
      if (attackCountAfterDefenderLoad !== importedCards.length) throw new Error('Loading a defender file should not touch the attack list');
      console.log('defender import name/health/dodge:', idRegistry['def-name'].value, idRegistry['def-health'].value, idRegistry['def-dodge'].value, '| attacks untouched:', attackCountAfterDefenderLoad);
      console.log('ALL DEFENDER SAVE/LOAD CHECKS PASSED');
    }, 50);
  }, 50);
}, 400);

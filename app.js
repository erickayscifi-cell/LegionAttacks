(function () {
  'use strict';

  let attackCounter = 0;
  function makeAttack(name, overrides) {
    attackCounter++;
    return Object.assign({
      id: 'a' + attackCounter,
      name: name || ('Attack ' + attackCounter),
      red: 0, black: 3, white: 0,
      surgeConv: 'none',
      tokens: { surge: 0, aim: 0, observe: 0 },
      criticalX: 0, preciseX: 0, sharpshooterX: 0, impactX: 0, pierceX: 0, downgradeX: 0, ramX: 0,
      marksmanAim: 0, jarKaiDodge: 0,
      highVelocity: false,
      suppressive: false,
      blast: false,
      isMelee: false,
    }, overrides || {});
  }

  const state = {
    defender: {
      health: 6,
      defenseDie: 'white',
      defenseSurgeConv: 'none',
      cover: 'none',
      coverX: 0,
      lowProfile: false,
      armorEnabled: false,
      armorX: null, // null => unlimited
      impervious: false,
      dangerSenseX: 0,
      uncannyLuckX: 0,
      upgradeX: 0,
      immunePierce: false,
      immuneBlast: false,
      block: false,
      nimble: false,
      outmaneuver: false,
      dodge: 0,
      shield: 0,
      suppression: 0,
      surge: 0,
    },
    attacks: [makeAttack('Attack 1'), makeAttack('Attack 2'), makeAttack('Attack 3')],
    trials: 20000,
  };

  // ---------------- helpers ----------------
  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        if (k === 'class') e.className = attrs[k];
        else if (k === 'html') e.innerHTML = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach((c) => e.appendChild(c));
    return e;
  }

  function hintIcon(hintText) {
    const q = el('span', { class: 'hint-icon', title: hintText, tabindex: '0' });
    q.textContent = '?';
    return q;
  }

  function stepperField(labelText, value, min, onChange, hintText) {
    const wrap = el('label', { class: 'field' });
    const labelRow = el('span', { class: 'field-label' });
    labelRow.appendChild(document.createTextNode(labelText));
    if (hintText) labelRow.appendChild(hintIcon(hintText));
    wrap.appendChild(labelRow);
    const input = el('input', { type: 'number', min: String(min) });
    input.value = value;

    const commit = (v) => {
      let n = parseInt(v, 10);
      if (isNaN(n)) n = min;
      if (n < min) n = min;
      input.value = n;
      onChange(n);
    };
    input.addEventListener('input', () => commit(input.value));

    wrap.appendChild(input);
    return wrap;
  }

  function selectField(labelText, value, options, onChange) {
    const wrap = el('label', { class: 'field' });
    wrap.appendChild(document.createTextNode(labelText));
    const select = el('select');
    options.forEach((opt) => {
      const o = el('option', { value: opt.value });
      o.textContent = opt.label;
      if (opt.value === value) o.selected = true;
      select.appendChild(o);
    });
    select.addEventListener('change', () => onChange(select.value));
    wrap.appendChild(select);
    return wrap;
  }

  function checkboxField(labelText, checked, onChange) {
    const wrap = el('label', { class: 'field checkbox-field' });
    const input = el('input', { type: 'checkbox' });
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    wrap.appendChild(input);
    wrap.appendChild(document.createTextNode(labelText));
    return wrap;
  }

  // ---------------- render: attacks ----------------
  function renderAttacks() {
    const list = document.getElementById('attacksList');
    list.innerHTML = '';
    if (state.attacks.length === 0) {
      list.appendChild(el('p', { class: 'empty-state', html: 'No attacks yet. Add one to get started.' }));
      return;
    }
    state.attacks.forEach((attack) => {
      list.appendChild(renderAttackCard(attack));
    });
  }

  // Fields that count as "active" for the Tokens / Keywords badges and
  // auto-open decision, and the JSON export/import shape for an attacker.
  const ATTACKER_TOKEN_KEYS = ['surge', 'aim', 'observe'];
  const ATTACKER_KEYWORD_NUMERIC_KEYS = [
    'criticalX', 'preciseX', 'sharpshooterX', 'impactX', 'pierceX', 'downgradeX', 'ramX',
    'marksmanAim', 'jarKaiDodge',
  ];
  const ATTACKER_KEYWORD_BOOL_KEYS = ['highVelocity', 'suppressive', 'blast'];
  const ATTACKER_SCHEMA = 'legion-targeter-attacker';

  function countActive(attack, numericKeys, boolKeys) {
    let n = 0;
    (numericKeys || []).forEach((k) => { if (attack[k]) n++; });
    (boolKeys || []).forEach((k) => { if (attack[k]) n++; });
    return n;
  }

  // The data fields that define an attacker, deliberately excluding id/name
  // so callers decide those independently (duplicate vs. import both reuse this).
  function attackFields(attack) {
    return {
      red: attack.red, black: attack.black, white: attack.white,
      surgeConv: attack.surgeConv,
      tokens: Object.assign({ surge: 0, aim: 0, observe: 0 }, attack.tokens),
      criticalX: attack.criticalX, preciseX: attack.preciseX, sharpshooterX: attack.sharpshooterX,
      impactX: attack.impactX, pierceX: attack.pierceX, downgradeX: attack.downgradeX, ramX: attack.ramX,
      marksmanAim: attack.marksmanAim, jarKaiDodge: attack.jarKaiDodge,
      highVelocity: attack.highVelocity, suppressive: attack.suppressive, blast: attack.blast,
      isMelee: attack.isMelee,
    };
  }

  function serializeAttack(attack) {
    return Object.assign({ schema: ATTACKER_SCHEMA, version: 1, name: attack.name }, attackFields(attack));
  }

  // Shared by single-attack import and full-state import.
  function attackOverridesFromData(data) {
    data = data || {};
    return {
      red: numOr(data.red, 0), black: numOr(data.black, 0), white: numOr(data.white, 0),
      surgeConv: ['none', 'hit', 'crit'].includes(data.surgeConv) ? data.surgeConv : 'none',
      tokens: {
        surge: numOr(data.tokens && data.tokens.surge, 0),
        aim: numOr(data.tokens && data.tokens.aim, 0),
        observe: numOr(data.tokens && data.tokens.observe, 0),
      },
      criticalX: numOr(data.criticalX, 0), preciseX: numOr(data.preciseX, 0),
      sharpshooterX: numOr(data.sharpshooterX, 0), impactX: numOr(data.impactX, 0),
      pierceX: numOr(data.pierceX, 0), downgradeX: numOr(data.downgradeX, 0), ramX: numOr(data.ramX, 0),
      marksmanAim: numOr(data.marksmanAim, 0), jarKaiDodge: numOr(data.jarKaiDodge, 0),
      highVelocity: !!data.highVelocity, suppressive: !!data.suppressive, blast: !!data.blast,
      isMelee: !!data.isMelee,
    };
  }

  function applyImportedData(attack, data) {
    if (!data || typeof data !== 'object') throw new Error('Not a valid attacker file.');
    const fresh = makeAttack(data.name || attack.name, attackOverridesFromData(data));
    // Keep the same id (and thus the same card slot) as the card being
    // overwritten, so "upload" replaces this attack in place.
    fresh.id = attack.id;
    return fresh;
  }

  function numOr(v, fallback) {
    const n = parseInt(v, 10);
    return isNaN(n) ? fallback : Math.max(0, n);
  }

  // ---------------- full export / import (defender + all attacks) ----------------
  const FULL_SCHEMA = 'legion-targeter-full';

  function serializeDefender(d) {
    return {
      health: d.health, defenseDie: d.defenseDie, defenseSurgeConv: d.defenseSurgeConv,
      cover: d.cover, coverX: d.coverX, lowProfile: d.lowProfile,
      armorEnabled: d.armorEnabled, armorX: d.armorX,
      impervious: d.impervious, dangerSenseX: d.dangerSenseX, uncannyLuckX: d.uncannyLuckX,
      upgradeX: d.upgradeX,
      immunePierce: d.immunePierce, immuneBlast: d.immuneBlast,
      block: d.block, nimble: d.nimble, outmaneuver: d.outmaneuver,
      dodge: d.dodge, shield: d.shield, suppression: d.suppression, surge: d.surge,
    };
  }

  function serializeFullState() {
    return {
      schema: FULL_SCHEMA,
      version: 1,
      defender: serializeDefender(state.defender),
      attacks: state.attacks.map(serializeAttack),
    };
  }

  function defenderFromData(dd) {
    dd = dd || {};
    return {
      health: Math.max(1, numOr(dd.health, 6)),
      defenseDie: dd.defenseDie === 'red' ? 'red' : 'white',
      defenseSurgeConv: dd.defenseSurgeConv === 'block' ? 'block' : 'none',
      cover: ['none', 'light', 'heavy'].includes(dd.cover) ? dd.cover : 'none',
      coverX: numOr(dd.coverX, 0),
      lowProfile: !!dd.lowProfile,
      armorEnabled: !!dd.armorEnabled,
      armorX: (dd.armorX === null || dd.armorX === undefined || dd.armorX === '') ? null : numOr(dd.armorX, 0),
      impervious: !!dd.impervious,
      dangerSenseX: numOr(dd.dangerSenseX, 0),
      uncannyLuckX: numOr(dd.uncannyLuckX, 0),
      upgradeX: numOr(dd.upgradeX, 0),
      immunePierce: !!dd.immunePierce,
      immuneBlast: !!dd.immuneBlast,
      block: !!dd.block,
      nimble: !!dd.nimble,
      outmaneuver: !!dd.outmaneuver,
      dodge: numOr(dd.dodge, 0),
      shield: numOr(dd.shield, 0),
      suppression: numOr(dd.suppression, 0),
      surge: numOr(dd.surge, 0),
    };
  }

  function setDefenderFieldsFromState() {
    const d = state.defender;
    document.getElementById('def-health').value = d.health;
    document.getElementById('def-defenseDie').value = d.defenseDie;
    document.getElementById('def-defenseSurgeConv').value = d.defenseSurgeConv;
    document.getElementById('def-cover').value = d.cover;
    document.getElementById('def-coverX').value = d.coverX;
    document.getElementById('def-lowProfile').checked = d.lowProfile;
    document.getElementById('def-armorEnabled').checked = d.armorEnabled;
    document.getElementById('def-armorX').value = d.armorX === null ? '' : d.armorX;
    document.getElementById('def-impervious').checked = d.impervious;
    document.getElementById('def-dangerSenseX').value = d.dangerSenseX;
    document.getElementById('def-uncannyLuckX').value = d.uncannyLuckX;
    document.getElementById('def-upgradeX').value = d.upgradeX;
    document.getElementById('def-immunePierce').checked = d.immunePierce;
    document.getElementById('def-immuneBlast').checked = d.immuneBlast;
    document.getElementById('def-block').checked = d.block;
    document.getElementById('def-nimble').checked = d.nimble;
    document.getElementById('def-outmaneuver').checked = d.outmaneuver;
    document.getElementById('def-dodge').value = d.dodge;
    document.getElementById('def-shield').value = d.shield;
    document.getElementById('def-suppression').value = d.suppression;
    document.getElementById('def-surge').value = d.surge;
  }

  function applyImportedFullState(data) {
    if (!data || typeof data !== 'object') throw new Error('Not a valid Legion Targeter export.');
    state.defender = defenderFromData(data.defender);
    const importedAttacks = Array.isArray(data.attacks) ? data.attacks : [];
    state.attacks = importedAttacks.length
      ? importedAttacks.map((a) => makeAttack((a && a.name) || 'Attack', attackOverridesFromData(a)))
      : [makeAttack('Attack 1')];
    setDefenderFieldsFromState();
    renderAttacks();
    recompute();
  }

  function downloadJson(filename, dataObj) {
    const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function safeFilename(name) {
    return (name || 'attacker').trim().replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'attacker';
  }

  function renderAttackCard(attack) {
    const card = el('div', { class: 'attack-card' });

    const header = el('div', { class: 'attack-card-header' });
    const nameInput = el('input', { class: 'attack-name', type: 'text' });
    nameInput.value = attack.name;
    nameInput.addEventListener('input', () => { attack.name = nameInput.value; recompute(); });
    header.appendChild(nameInput);

    const toolbar = el('div', { class: 'card-toolbar' });

    const idx0 = state.attacks.findIndex((a) => a.id === attack.id);
    const moveUpBtn = el('button', { class: 'icon-mini-btn', title: 'Move this attack earlier in the sequence', type: 'button' });
    moveUpBtn.textContent = '▲';
    if (idx0 <= 0) moveUpBtn.setAttribute('disabled', '');
    moveUpBtn.addEventListener('click', () => {
      const idx = state.attacks.findIndex((a) => a.id === attack.id);
      if (idx <= 0) return;
      const [moved] = state.attacks.splice(idx, 1);
      state.attacks.splice(idx - 1, 0, moved);
      renderAttacks();
      recompute();
    });
    toolbar.appendChild(moveUpBtn);

    const moveDownBtn = el('button', { class: 'icon-mini-btn', title: 'Move this attack later in the sequence', type: 'button' });
    moveDownBtn.textContent = '▼';
    if (idx0 >= state.attacks.length - 1) moveDownBtn.setAttribute('disabled', '');
    moveDownBtn.addEventListener('click', () => {
      const idx = state.attacks.findIndex((a) => a.id === attack.id);
      if (idx < 0 || idx >= state.attacks.length - 1) return;
      const [moved] = state.attacks.splice(idx, 1);
      state.attacks.splice(idx + 1, 0, moved);
      renderAttacks();
      recompute();
    });
    toolbar.appendChild(moveDownBtn);

    const dupBtn = el('button', { class: 'icon-mini-btn', title: 'Duplicate this attacker', type: 'button' });
    dupBtn.textContent = '⧉';
    dupBtn.addEventListener('click', () => {
      const copy = makeAttack(attack.name + ' copy', attackFields(attack));
      const idx = state.attacks.findIndex((a) => a.id === attack.id);
      state.attacks.splice(idx + 1, 0, copy);
      renderAttacks();
      recompute();
    });
    toolbar.appendChild(dupBtn);

    const downloadBtn = el('button', { class: 'icon-mini-btn', title: 'Save this attacker as a JSON file', type: 'button' });
    downloadBtn.textContent = '💾';
    downloadBtn.addEventListener('click', () => {
      downloadJson(safeFilename(attack.name) + '.json', serializeAttack(attack));
    });
    toolbar.appendChild(downloadBtn);

    const uploadBtn = el('button', { class: 'icon-mini-btn', title: 'Load an attacker JSON file into this card', type: 'button' });
    uploadBtn.textContent = '📂';
    const fileInput = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result));
          const updated = applyImportedData(attack, data);
          const idx = state.attacks.findIndex((a) => a.id === attack.id);
          state.attacks[idx] = updated;
          renderAttacks();
          recompute();
        } catch (e) {
          window.alert('Could not load that file as an attacker: ' + e.message);
        }
        fileInput.value = '';
      };
      reader.readAsText(file);
    });
    uploadBtn.addEventListener('click', () => fileInput.click());
    toolbar.appendChild(uploadBtn);
    toolbar.appendChild(fileInput);

    const removeBtn = el('button', { class: 'icon-mini-btn danger', title: 'Remove attack', type: 'button' });
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      state.attacks = state.attacks.filter((a) => a.id !== attack.id);
      renderAttacks();
      recompute();
    });
    toolbar.appendChild(removeBtn);

    header.appendChild(toolbar);
    card.appendChild(header);

    // Dice pool
    const diceRow = el('div', { class: 'field-row' });
    diceRow.appendChild(stepperField('🟥 Red dice', attack.red, 0, (v) => { attack.red = v; recompute(); }));
    diceRow.appendChild(stepperField('⬛ Black dice', attack.black, 0, (v) => { attack.black = v; recompute(); }));
    diceRow.appendChild(stepperField('⬜ White dice', attack.white, 0, (v) => { attack.white = v; recompute(); }));
    card.appendChild(diceRow);

    const surgeRow = el('div', { class: 'field-row' });
    surgeRow.appendChild(selectField('Attack Surge', attack.surgeConv, [
      { value: 'none', label: 'None' },
      { value: 'hit', label: '→ Hit' },
      { value: 'crit', label: '→ Crit' },
    ], (v) => { attack.surgeConv = v; recompute(); }));
    surgeRow.appendChild(checkboxField('Melee attack', attack.isMelee, (v) => { attack.isMelee = v; recompute(); }));
    card.appendChild(surgeRow);

    // Tokens (collapsible)
    const tokenCount = countActive(attack.tokens, ATTACKER_TOKEN_KEYS, []);
    const tokenDetails = el('details', { class: 'collapsible' });
    if (tokenCount > 0) tokenDetails.setAttribute('open', '');
    const tokenSummary = el('summary', {});
    tokenSummary.appendChild(document.createTextNode('Tokens '));
    if (tokenCount > 0) {
      const badge = el('span', { class: 'badge' });
      badge.textContent = String(tokenCount);
      tokenSummary.appendChild(badge);
    }
    tokenDetails.appendChild(tokenSummary);
    const tokenBody = el('div', { class: 'details-body' });
    const tokenRow = el('div', { class: 'field-row' });
    tokenRow.appendChild(stepperField('Surge', attack.tokens.surge, 0, (v) => { attack.tokens.surge = v; recompute(); }));
    tokenRow.appendChild(stepperField('Aim', attack.tokens.aim, 0, (v) => { attack.tokens.aim = v; recompute(); }));
    tokenRow.appendChild(stepperField('Observe', attack.tokens.observe, 0, (v) => { attack.tokens.observe = v; recompute(); }, '(enemy obs. tokens spent)'));
    tokenBody.appendChild(tokenRow);
    tokenDetails.appendChild(tokenBody);
    card.appendChild(tokenDetails);

    // Keywords (collapsible)
    const kwCount = countActive(attack, ATTACKER_KEYWORD_NUMERIC_KEYS, ATTACKER_KEYWORD_BOOL_KEYS);
    const kwDetails = el('details', { class: 'collapsible' });
    if (kwCount > 0) kwDetails.setAttribute('open', '');
    const kwSummary = el('summary', {});
    kwSummary.appendChild(document.createTextNode('Keywords '));
    if (kwCount > 0) {
      const badge = el('span', { class: 'badge' });
      badge.textContent = String(kwCount);
      kwSummary.appendChild(badge);
    }
    kwDetails.appendChild(kwSummary);
    const kwBody = el('div', { class: 'details-body' });
    const kwRow1 = el('div', { class: 'field-row' });
    kwRow1.appendChild(stepperField('Critical X', attack.criticalX, 0, (v) => { attack.criticalX = v; recompute(); }));
    kwRow1.appendChild(stepperField('Precise X', attack.preciseX, 0, (v) => { attack.preciseX = v; recompute(); }));
    kwRow1.appendChild(stepperField('Sharpshooter X', attack.sharpshooterX, 0, (v) => { attack.sharpshooterX = v; recompute(); }));
    kwBody.appendChild(kwRow1);
    const kwRow2 = el('div', { class: 'field-row' });
    kwRow2.appendChild(stepperField('Impact X', attack.impactX, 0, (v) => { attack.impactX = v; recompute(); }, '(vs Armor)'));
    kwRow2.appendChild(stepperField('Pierce X', attack.pierceX, 0, (v) => { attack.pierceX = v; recompute(); }));
    kwRow2.appendChild(stepperField('Downgrade Def. Dice X', attack.downgradeX, 0, (v) => { attack.downgradeX = v; recompute(); }));
    kwRow2.appendChild(stepperField('Ram X', attack.ramX, 0, (v) => { attack.ramX = v; recompute(); }, '(blanks then hits → crit)'));
    kwBody.appendChild(kwRow2);
    const kwRow3 = el('div', { class: 'field-row' });
    kwRow3.appendChild(checkboxField('High Velocity (no Dodge)', attack.highVelocity, (v) => { attack.highVelocity = v; recompute(); }));
    kwRow3.appendChild(checkboxField('Suppressive (adds 1 suppression after)', attack.suppressive, (v) => { attack.suppressive = v; recompute(); }));
    kwRow3.appendChild(checkboxField('Blast (ignores cover, unless Immune: Blast)', attack.blast, (v) => { attack.blast = v; recompute(); }));
    kwBody.appendChild(kwRow3);
    const kwRow4 = el('div', { class: 'field-row' });
    kwRow4.appendChild(stepperField('Marksman: Aim spent', attack.marksmanAim, 0, (v) => { attack.marksmanAim = v; recompute(); }, '(Blank→Hit / Hit→Crit, smartly chosen each trial)'));
    kwRow4.appendChild(stepperField('Jar\'Kai Mastery: Dodge spent', attack.jarKaiDodge, 0, (v) => { attack.jarKaiDodge = v; recompute(); }, '(same conversions; only applies on a Melee attack)'));
    kwBody.appendChild(kwRow4);
    kwDetails.appendChild(kwBody);
    card.appendChild(kwDetails);

    return card;
  }

  // ---------------- render: defender ----------------
  function wireDefenderInputs() {
    const d = state.defender;
    document.getElementById('def-health').addEventListener('input', (e) => { d.health = Math.max(1, parseInt(e.target.value, 10) || 1); recompute(); });
    document.getElementById('def-defenseDie').addEventListener('change', (e) => { d.defenseDie = e.target.value; recompute(); });
    document.getElementById('def-defenseSurgeConv').addEventListener('change', (e) => { d.defenseSurgeConv = e.target.value; recompute(); });
    document.getElementById('def-cover').addEventListener('change', (e) => { d.cover = e.target.value; recompute(); });
    document.getElementById('def-coverX').addEventListener('input', (e) => { d.coverX = Math.max(0, parseInt(e.target.value, 10) || 0); recompute(); });
    document.getElementById('def-lowProfile').addEventListener('change', (e) => { d.lowProfile = e.target.checked; recompute(); });
    document.getElementById('def-armorEnabled').addEventListener('change', (e) => { d.armorEnabled = e.target.checked; recompute(); });
    document.getElementById('def-armorX').addEventListener('input', (e) => { d.armorX = e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10) || 0); recompute(); });
    document.getElementById('def-impervious').addEventListener('change', (e) => { d.impervious = e.target.checked; recompute(); });
    document.getElementById('def-dangerSenseX').addEventListener('input', (e) => { d.dangerSenseX = Math.max(0, parseInt(e.target.value, 10) || 0); recompute(); });
    document.getElementById('def-uncannyLuckX').addEventListener('input', (e) => { d.uncannyLuckX = Math.max(0, parseInt(e.target.value, 10) || 0); recompute(); });
    document.getElementById('def-upgradeX').addEventListener('input', (e) => { d.upgradeX = Math.max(0, parseInt(e.target.value, 10) || 0); recompute(); });
    document.getElementById('def-immunePierce').addEventListener('change', (e) => { d.immunePierce = e.target.checked; recompute(); });
    document.getElementById('def-immuneBlast').addEventListener('change', (e) => { d.immuneBlast = e.target.checked; recompute(); });
    document.getElementById('def-block').addEventListener('change', (e) => { d.block = e.target.checked; recompute(); });
    document.getElementById('def-nimble').addEventListener('change', (e) => { d.nimble = e.target.checked; recompute(); });
    document.getElementById('def-outmaneuver').addEventListener('change', (e) => { d.outmaneuver = e.target.checked; recompute(); });
    document.getElementById('def-dodge').addEventListener('input', (e) => { d.dodge = Math.max(0, parseInt(e.target.value, 10) || 0); recompute(); });
    document.getElementById('def-shield').addEventListener('input', (e) => { d.shield = Math.max(0, parseInt(e.target.value, 10) || 0); recompute(); });
    document.getElementById('def-suppression').addEventListener('input', (e) => { d.suppression = Math.max(0, parseInt(e.target.value, 10) || 0); recompute(); });
    document.getElementById('def-surge').addEventListener('input', (e) => { d.surge = Math.max(0, parseInt(e.target.value, 10) || 0); recompute(); });
  }

  // ---------------- compute + render results ----------------
  let recomputeTimer = null;
  function recompute() {
    clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(runSimulation, 150);
  }

  function runSimulation() {
    const d = state.defender;
    const defenderConfig = {
      health: d.health,
      defenseDie: d.defenseDie,
      defenseSurgeConv: d.defenseSurgeConv,
      cover: d.cover,
      coverX: d.coverX,
      lowProfile: d.lowProfile,
      armor: { enabled: d.armorEnabled, x: d.armorEnabled ? (d.armorX === null ? Infinity : d.armorX) : 0 },
      impervious: d.impervious,
      dangerSenseX: d.dangerSenseX,
      uncannyLuckX: d.uncannyLuckX,
      upgradeDefenseDiceX: d.upgradeX,
      immunePierce: d.immunePierce,
      immuneBlast: d.immuneBlast,
      block: d.block,
      nimble: d.nimble,
      outmaneuver: d.outmaneuver,
      tokenPool: { dodge: d.dodge, shield: d.shield, suppression: d.suppression, surge: d.surge },
    };

    const attackConfigs = state.attacks.map((a) => ({
      red: a.red, black: a.black, white: a.white,
      surgeConv: a.surgeConv,
      tokens: a.tokens,
      criticalX: a.criticalX,
      preciseX: a.preciseX,
      sharpshooterX: a.sharpshooterX,
      impactX: a.impactX,
      pierceX: a.pierceX,
      downgradeX: a.downgradeX,
      ramX: a.ramX,
      marksmanAim: a.marksmanAim,
      jarKaiDodge: a.jarKaiDodge,
      highVelocity: a.highVelocity,
      suppressive: a.suppressive,
      blast: a.blast,
      isMelee: a.isMelee,
    }));

    document.getElementById('trialsLabel').textContent = attackConfigs.length
      ? ('Based on ' + state.trials.toLocaleString() + ' simulated trials.')
      : '';

    const resultsList = document.getElementById('resultsList');
    resultsList.innerHTML = '';
    if (attackConfigs.length === 0) {
      resultsList.appendChild(el('p', { class: 'empty-state', html: 'Add at least one attack to see results.' }));
      clearTimeout(quoteTimer);
      const quoteLine = document.getElementById('quoteLine');
      if (quoteLine) quoteLine.textContent = '';
      return;
    }

    const output = LegionEngine.simulate(attackConfigs, defenderConfig, state.trials);

    output.perAttack.forEach((res, i) => {
      const name = state.attacks[i].name;
      const card = el('div', { class: 'result-card' });
      card.appendChild(el('h4', { html: 'After ' + escapeHtml(name) + (i > 0 ? ' (cumulative)' : '') }));

      const killPct = (res.chanceToKillCumulative * 100);
      const pctEl = el('div', { class: 'kill-pct cumulative' });
      pctEl.textContent = killPct.toFixed(1) + '%';
      card.appendChild(pctEl);
      const track = el('div', { class: 'kill-bar-track' });
      const fill = el('div', { class: 'kill-bar-fill' });
      fill.style.width = Math.min(100, killPct) + '%';
      track.appendChild(fill);
      card.appendChild(track);

      const woundRow = el('div', { class: 'stat-row' });
      woundRow.appendChild(el('span', { class: 'label', html: 'Avg wounds this attack' }));
      const woundVal = el('span', { class: 'value' });
      woundVal.textContent = res.avgWounds.toFixed(2);
      woundRow.appendChild(woundVal);
      card.appendChild(woundRow);

      resultsList.appendChild(card);
    });

    // Total expected wounds only needs to appear once, for the full sequence.
    const finalResult = output.perAttack[output.perAttack.length - 1];
    const totalCard = el('div', { class: 'result-card total-summary' });
    const totalRow = el('div', { class: 'stat-row' });
    totalRow.appendChild(el('span', { class: 'label', html: 'Total expected wounds (all attacks)' }));
    const totalVal = el('span', { class: 'value' });
    totalVal.textContent = finalResult.avgCumulativeWounds.toFixed(2);
    totalRow.appendChild(totalVal);
    totalCard.appendChild(totalRow);
    resultsList.appendChild(totalCard);

    scheduleQuoteUpdate(finalResult.chanceToKillCumulative * 100);
  }

  // Quotes intentionally refresh on their own, slower timer than the main
  // recompute, so mashing a spinner doesn't flicker the quote every 150ms.
  let quoteTimer = null;
  function scheduleQuoteUpdate(killPct) {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(() => {
      const quoteLine = document.getElementById('quoteLine');
      if (quoteLine) quoteLine.textContent = pickQuote(killPct);
    }, 500);
  }

  // ---------------- Star Wars flavor quotes ----------------
  const QUOTES_BAD = [
    'I have a bad feeling about this.',
    'The odds of successfully surviving an attack on an Imperial Star Destroyer are approximately—',
    'You might want to quit while you’re behind.',
  ];
  const QUOTES_GOOD = [
    'In my experience, there is no such thing as luck.',
    'I have spoken.',
    'I’ve got a really good feeling about this.',
    'I call it luck.',
    'I’m a lucky guy, Han.',
  ];
  const QUOTES_MIDDLE = [
    'This is the way.',
    'Do or do not. There is no try.',
    'Rebellions are built on hope.',
    'May the Force be with you.',
    'We take the next chance, and the next, on and on until we win, or the chances are spent.',
    'You got everything you need there, pal?',
  ];

  function pickQuote(killPct) {
    let pool;
    if (killPct <= 15) pool = QUOTES_BAD;
    else if (killPct >= 90) pool = QUOTES_GOOD;
    else pool = QUOTES_MIDDLE;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------------- wiring ----------------
  document.getElementById('addAttackBtn').addEventListener('click', () => {
    state.attacks.push(makeAttack('Attack ' + (state.attacks.length + 1)));
    renderAttacks();
    recompute();
  });

  document.getElementById('gearBtn').addEventListener('click', () => {
    document.getElementById('settingsPanel').classList.toggle('hidden');
  });
  document.getElementById('closeSettings').addEventListener('click', () => {
    document.getElementById('settingsPanel').classList.add('hidden');
  });
  document.getElementById('trialsSelect').addEventListener('change', (e) => {
    state.trials = parseInt(e.target.value, 10);
    recompute();
  });

  const themeSelect = document.getElementById('themeSelect');
  if (themeSelect && window.LegionTheme) {
    themeSelect.value = window.LegionTheme.get();
    themeSelect.addEventListener('change', (e) => {
      window.LegionTheme.set(e.target.value);
    });
  }

  document.getElementById('exportAllBtn').addEventListener('click', () => {
    downloadJson('legion-targeter-export.json', serializeFullState());
  });
  document.getElementById('importAllBtn').addEventListener('click', () => {
    document.getElementById('importAllFile').click();
  });
  document.getElementById('importAllFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        applyImportedFullState(JSON.parse(reader.result));
      } catch (err) {
        window.alert('Could not import file: ' + err.message);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  wireDefenderInputs();
  renderAttacks();
  runSimulation();
})();

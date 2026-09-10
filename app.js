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
      highVelocity: false,
      suppressive: false,
    }, overrides || {});
  }

  const state = {
    defender: {
      health: 6,
      defenseDie: 'white',
      defenseSurgeConv: 'none',
      cover: 'none',
      lowProfile: false,
      armorEnabled: false,
      armorX: null, // null => unlimited
      impervious: false,
      dangerSenseX: 0,
      uncannyLuckX: 0,
      upgradeX: 0,
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

  function stepperField(labelText, value, min, onChange, hintText) {
    const wrap = el('label', { class: 'field' });
    wrap.appendChild(document.createTextNode(labelText));
    if (hintText) {
      const h = el('span', { class: 'hint' });
      h.textContent = ' ' + hintText;
      wrap.appendChild(h);
    }
    const row = el('div', { style: 'display:flex; gap:4px; align-items:center;' });
    const minusBtn = el('button', { class: 'secondary-btn', type: 'button', style: 'padding:4px 8px;' });
    minusBtn.textContent = '−';
    const input = el('input', { type: 'number', min: String(min) });
    input.value = value;
    const plusBtn = el('button', { class: 'secondary-btn', type: 'button', style: 'padding:4px 8px;' });
    plusBtn.textContent = '+';

    const commit = (v) => {
      let n = parseInt(v, 10);
      if (isNaN(n)) n = min;
      if (n < min) n = min;
      input.value = n;
      onChange(n);
    };
    minusBtn.addEventListener('click', () => commit((parseInt(input.value, 10) || 0) - 1));
    plusBtn.addEventListener('click', () => commit((parseInt(input.value, 10) || 0) + 1));
    input.addEventListener('input', () => commit(input.value));

    row.appendChild(minusBtn);
    row.appendChild(input);
    row.appendChild(plusBtn);
    wrap.appendChild(row);
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

  function renderAttackCard(attack) {
    const card = el('div', { class: 'attack-card' });

    const header = el('div', { class: 'attack-card-header' });
    const nameInput = el('input', { class: 'attack-name', type: 'text' });
    nameInput.value = attack.name;
    nameInput.addEventListener('input', () => { attack.name = nameInput.value; recompute(); });
    header.appendChild(nameInput);
    const removeBtn = el('button', { class: 'remove-attack-btn', title: 'Remove attack', type: 'button' });
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      state.attacks = state.attacks.filter((a) => a.id !== attack.id);
      renderAttacks();
      recompute();
    });
    header.appendChild(removeBtn);
    card.appendChild(header);

    // Dice pool
    const diceRow = el('div', { class: 'field-row' });
    diceRow.appendChild(stepperField('Red dice', attack.red, 0, (v) => { attack.red = v; recompute(); }));
    diceRow.appendChild(stepperField('Black dice', attack.black, 0, (v) => { attack.black = v; recompute(); }));
    diceRow.appendChild(stepperField('White dice', attack.white, 0, (v) => { attack.white = v; recompute(); }));
    card.appendChild(diceRow);

    const surgeRow = el('div', { class: 'field-row' });
    surgeRow.appendChild(selectField('Attack Surge', attack.surgeConv, [
      { value: 'none', label: 'None' },
      { value: 'hit', label: '→ Hit' },
      { value: 'crit', label: '→ Crit' },
    ], (v) => { attack.surgeConv = v; recompute(); }));
    card.appendChild(surgeRow);

    // Tokens
    card.appendChild(el('h3', { html: 'Tokens' }));
    const tokenRow = el('div', { class: 'field-row' });
    tokenRow.appendChild(stepperField('Surge', attack.tokens.surge, 0, (v) => { attack.tokens.surge = v; recompute(); }));
    tokenRow.appendChild(stepperField('Aim', attack.tokens.aim, 0, (v) => { attack.tokens.aim = v; recompute(); }));
    tokenRow.appendChild(stepperField('Observe', attack.tokens.observe, 0, (v) => { attack.tokens.observe = v; recompute(); }, '(enemy obs. tokens spent)'));
    card.appendChild(tokenRow);

    // Keywords
    card.appendChild(el('h3', { html: 'Keywords' }));
    const kwRow1 = el('div', { class: 'field-row' });
    kwRow1.appendChild(stepperField('Critical X', attack.criticalX, 0, (v) => { attack.criticalX = v; recompute(); }));
    kwRow1.appendChild(stepperField('Precise X', attack.preciseX, 0, (v) => { attack.preciseX = v; recompute(); }));
    kwRow1.appendChild(stepperField('Sharpshooter X', attack.sharpshooterX, 0, (v) => { attack.sharpshooterX = v; recompute(); }));
    card.appendChild(kwRow1);
    const kwRow2 = el('div', { class: 'field-row' });
    kwRow2.appendChild(stepperField('Impact X', attack.impactX, 0, (v) => { attack.impactX = v; recompute(); }, '(vs Armor)'));
    kwRow2.appendChild(stepperField('Pierce X', attack.pierceX, 0, (v) => { attack.pierceX = v; recompute(); }));
    kwRow2.appendChild(stepperField('Downgrade Def. Dice X', attack.downgradeX, 0, (v) => { attack.downgradeX = v; recompute(); }));
    kwRow2.appendChild(stepperField('Ram X', attack.ramX, 0, (v) => { attack.ramX = v; recompute(); }, '(blanks then hits → crit)'));
    card.appendChild(kwRow2);
    const kwRow3 = el('div', { class: 'field-row' });
    kwRow3.appendChild(checkboxField('High Velocity (no Dodge)', attack.highVelocity, (v) => { attack.highVelocity = v; recompute(); }));
    kwRow3.appendChild(checkboxField('Suppressive (adds 1 suppression after)', attack.suppressive, (v) => { attack.suppressive = v; recompute(); }));
    card.appendChild(kwRow3);

    return card;
  }

  // ---------------- render: defender ----------------
  function wireDefenderInputs() {
    const d = state.defender;
    document.getElementById('def-health').addEventListener('input', (e) => { d.health = Math.max(1, parseInt(e.target.value, 10) || 1); recompute(); });
    document.getElementById('def-defenseDie').addEventListener('change', (e) => { d.defenseDie = e.target.value; recompute(); });
    document.getElementById('def-defenseSurgeConv').addEventListener('change', (e) => { d.defenseSurgeConv = e.target.value; recompute(); });
    document.getElementById('def-cover').addEventListener('change', (e) => { d.cover = e.target.value; recompute(); });
    document.getElementById('def-lowProfile').addEventListener('change', (e) => { d.lowProfile = e.target.checked; recompute(); });
    document.getElementById('def-armorEnabled').addEventListener('change', (e) => { d.armorEnabled = e.target.checked; recompute(); });
    document.getElementById('def-armorX').addEventListener('input', (e) => { d.armorX = e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10) || 0); recompute(); });
    document.getElementById('def-impervious').addEventListener('change', (e) => { d.impervious = e.target.checked; recompute(); });
    document.getElementById('def-dangerSenseX').addEventListener('input', (e) => { d.dangerSenseX = Math.max(0, parseInt(e.target.value, 10) || 0); recompute(); });
    document.getElementById('def-uncannyLuckX').addEventListener('input', (e) => { d.uncannyLuckX = Math.max(0, parseInt(e.target.value, 10) || 0); recompute(); });
    document.getElementById('def-upgradeX').addEventListener('input', (e) => { d.upgradeX = Math.max(0, parseInt(e.target.value, 10) || 0); recompute(); });
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
      lowProfile: d.lowProfile,
      armor: { enabled: d.armorEnabled, x: d.armorEnabled ? (d.armorX === null ? Infinity : d.armorX) : 0 },
      impervious: d.impervious,
      dangerSenseX: d.dangerSenseX,
      uncannyLuckX: d.uncannyLuckX,
      upgradeDefenseDiceX: d.upgradeX,
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
      highVelocity: a.highVelocity,
      suppressive: a.suppressive,
    }));

    document.getElementById('trialsLabel').textContent = attackConfigs.length
      ? ('Based on ' + state.trials.toLocaleString() + ' simulated trials.')
      : '';

    const resultsList = document.getElementById('resultsList');
    resultsList.innerHTML = '';
    if (attackConfigs.length === 0) {
      resultsList.appendChild(el('p', { class: 'empty-state', html: 'Add at least one attack to see results.' }));
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

  wireDefenderInputs();
  renderAttacks();
  runSimulation();
})();

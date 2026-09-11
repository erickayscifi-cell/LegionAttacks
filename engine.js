// Legion Targeter — combat simulation engine (pure JS, no DOM dependencies)
// Runs in both browser and Node for testing.
//
// Implements the official Attack Sequence (Rules Reference / Core Rulebook)
// as closely as is practical for a "core keywords" fan calculator:
//   1. Roll Attack Dice, Reroll Dice (Aim/Observe/Precise, round-based),
//      Convert Attack Surges (Critical X), Ram X (blanks then hits -> crit).
//   2. Apply Dodge and Cover: Low Profile cancels 1 hit outright while any
//      Cover is present; a unit's own Suppression tokens improve its
//      effective Cover by 1 tier; roll a Cover Pool (1 white defense die
//      per remaining hit) and cancel hits per light/heavy Cover; then
//      spend Dodge tokens.
//   3. Modify Attack Dice: Impact X (hit->crit, only vs Armor), Armor X
//      (cancel hits), Shield tokens (cancel 1 hit or crit each).
//   4. Roll Defense Dice for remaining hits+crits (die count = hits+crits),
//      applying Downgrade then Upgrade Defense Dice, Danger Sense bonus
//      dice (tied to Suppression tokens held), and Impervious bonus dice
//      (vs Pierce).
//   5. Reroll (Uncanny Luck: blanks and any surge results that won't be
//      converted, red dice prioritized), Convert Defense Surges (chart or
//      Surge tokens), Modify Defense Dice (Pierce X cancels Block results).
//   6. Compare Results: remaining Block results cancel crits first, then
//      hits (mathematically equivalent to just subtracting total blocks
//      from total hits+crits, since nothing downstream distinguishes them).
//
// Cross-checked dice faces and mechanics against the official Rules
// Reference and against github.com/dankraus/legion-roller (LegionRoller).
// Documented simplifications: no hero-specific / conditional-regen
// keywords (Nimble, Outmaneuver, Block, Deflect, Soresu Mastery, Guardian,
// Backup, etc.), Shield tokens usable on any attack (not gated to Ranged
// only), Cover Pool die color fixed to white (per RAW), Impervious modeled
// as bonus defense dice (per current keyword glossary) rather than a
// Pierce-reduction effect.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LegionEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ATTACK_DIE = {
    red:   { total: 8, hit: 5, crit: 1, surge: 1, blank: 1 },
    black: { total: 8, hit: 3, crit: 1, surge: 1, blank: 3 },
    white: { total: 8, hit: 1, crit: 1, surge: 1, blank: 5 },
  };
  const DEFENSE_DIE = {
    red:   { total: 6, block: 3, surge: 1, blank: 2 },
    white: { total: 6, block: 1, surge: 1, blank: 4 },
  };
  // Reroll priority when capacity is limited: red first (best odds to
  // waste on a re-roll), then black, then white.
  const COLOR_PRIORITY = { red: 0, black: 1, white: 2 };

  function rollAttackDie(color) {
    const d = ATTACK_DIE[color];
    const r = Math.random() * d.total;
    if (r < d.hit) return 'hit';
    if (r < d.hit + d.crit) return 'crit';
    if (r < d.hit + d.crit + d.surge) return 'surge';
    return 'blank';
  }

  function rollDefenseDie(color) {
    const d = DEFENSE_DIE[color];
    const r = Math.random() * d.total;
    if (r < d.block) return 'block';
    if (r < d.block + d.surge) return 'surge';
    return 'blank';
  }

  /**
   * Reroll capacity per token, as discrete rounds: each Aim token grants
   * one round in which up to (2 + Precise X) currently-blank dice may be
   * rerolled simultaneously; each Observe token grants one round of 1.
   * A die can be rerolled again in a later round if it comes up blank
   * again, but at most once within the same round.
   */
  function getRerollRounds(aimTokens, observeTokens, preciseX) {
    const aim = Math.max(0, aimTokens || 0);
    const observe = Math.max(0, observeTokens || 0);
    const capacity = 2 + Math.max(0, preciseX || 0);
    const rounds = [];
    for (let i = 0; i < aim; i++) rounds.push(capacity);
    for (let i = 0; i < observe; i++) rounds.push(1);
    return rounds;
  }

  function applyRerollRounds(dice, rounds) {
    for (const capacity of rounds) {
      if (capacity <= 0) continue;
      const blankIdx = [];
      for (let i = 0; i < dice.length; i++) if (dice[i].result === 'blank') blankIdx.push(i);
      if (blankIdx.length === 0) continue;
      blankIdx.sort((a, b) => COLOR_PRIORITY[dice[a].color] - COLOR_PRIORITY[dice[b].color]);
      const n = Math.min(capacity, blankIdx.length);
      for (let i = 0; i < n; i++) {
        const idx = blankIdx[i];
        dice[idx].result = rollAttackDie(dice[idx].color);
      }
    }
  }

  /**
   * Resolve one attack against the defender, mutating the persistent token
   * pool in place, and returning wounds inflicted.
   *
   * attack: {
   *   red, black, white,                 // dice pool counts
   *   surgeConv: 'none'|'hit'|'crit',     // weapon's attack surge chart
   *   tokens: { surge, aim, observe },    // attacker's own tokens, spent fresh each attack
   *   criticalX, preciseX, sharpshooterX, impactX, pierceX, downgradeX, ramX,
   *   highVelocity: bool,                // defender cannot spend Dodge
   *   suppressive: bool,                 // defender gains 1 Suppression token after this attack
   * }
   * defender: {
   *   health, defenseDie: 'white'|'red', defenseSurgeConv: 'none'|'block',
   *   cover: 'none'|'light'|'heavy',
   *   armor: { enabled, x },             // x may be Infinity for unlimited "Armor"
   *   impervious: bool,
   *   dangerSenseX, uncannyLuckX,
   *   lowProfile: bool,
   *   upgradeDefenseDiceX: int,
   * }
   * pool: { dodge, shield, suppression, surge } -- persistent, mutated in place
   */
  function resolveAttack(attack, defender, pool) {
    const dice = [];
    for (let i = 0; i < (attack.red || 0); i++) dice.push({ color: 'red', result: rollAttackDie('red') });
    for (let i = 0; i < (attack.black || 0); i++) dice.push({ color: 'black', result: rollAttackDie('black') });
    for (let i = 0; i < (attack.white || 0); i++) dice.push({ color: 'white', result: rollAttackDie('white') });

    // --- Reroll Dice: Aim (2 + Precise dice per token, per round) and Observe (1 die per token, per round) ---
    const tokens = attack.tokens || {};
    const rounds = getRerollRounds(tokens.aim || 0, tokens.observe || 0, attack.preciseX || 0);
    applyRerollRounds(dice, rounds);

    let hits = dice.filter((d) => d.result === 'hit').length;
    let crits = dice.filter((d) => d.result === 'crit').length;
    let surges = dice.filter((d) => d.result === 'surge').length;
    const blanksAfterReroll = dice.filter((d) => d.result === 'blank').length;

    // --- Convert Attack Surges (Critical X, then weapon chart / Surge tokens) ---
    const critX = attack.criticalX || 0;
    const surgeToCrit = Math.min(critX, surges);
    crits += surgeToCrit;
    surges -= surgeToCrit;
    if (attack.surgeConv === 'crit') {
      crits += surges;
      surges = 0;
    } else if (attack.surgeConv === 'hit') {
      hits += surges;
      surges = 0;
    } else {
      const surgeTokens = Math.min(tokens.surge || 0, surges);
      hits += surgeTokens;
      surges -= surgeTokens;
    }

    // --- Ram X: convert up to X blanks (post-reroll) to crit, then any
    //     leftover Ram budget converts hits to crit. ---
    if (attack.ramX) {
      let ramLeft = attack.ramX;
      const blanksConverted = Math.min(ramLeft, blanksAfterReroll);
      crits += blanksConverted;
      ramLeft -= blanksConverted;
      const hitsConverted = Math.min(ramLeft, hits);
      crits += hitsConverted;
      hits -= hitsConverted;
    }

    // --- Apply Dodge and Cover ---
    // Low Profile cancels 1 hit outright whenever any Cover is present,
    // applied before the Cover Pool is rolled (so it also shrinks the pool).
    const coverBaseTier = defender.cover === 'heavy' ? 2 : defender.cover === 'light' ? 1 : 0;
    if (coverBaseTier > 0 && defender.lowProfile && hits > 0) {
      hits -= 1;
    }
    // A unit's own Suppression tokens improve its effective Cover by 1 tier
    // (capped at heavy), then Sharpshooter X steps the tier back down.
    const suppressionBump = (pool.suppression || 0) > 0 ? 1 : 0;
    const coverTierBeforeSharpshooter = Math.min(2, coverBaseTier + suppressionBump);
    const coverTier = Math.max(0, coverTierBeforeSharpshooter - (attack.sharpshooterX || 0));
    if (coverTier > 0 && hits > 0) {
      // Roll a Cover Pool: 1 white defense die for every current hit result.
      let cancel = 0;
      for (let i = 0; i < hits; i++) {
        const r = rollDefenseDie('white');
        if (r === 'block') cancel++;
        else if (r === 'surge' && coverTier >= 2) cancel++; // heavy cover also counts Surge
      }
      hits -= Math.min(hits, cancel);
    }

    const dodgeAllowed = !attack.highVelocity;
    if (dodgeAllowed && pool.dodge > 0 && hits > 0) {
      const spend = Math.min(pool.dodge, hits);
      pool.dodge -= spend;
      hits -= spend;
    }

    // --- Modify Attack Dice: Impact X, then Armor X, then Shield tokens ---
    const armorEnabled = !!(defender.armor && defender.armor.enabled);
    if (armorEnabled && attack.impactX) {
      const conv = Math.min(hits, attack.impactX);
      hits -= conv;
      crits += conv;
    }
    if (armorEnabled) {
      const armorX = defender.armor.x === undefined || defender.armor.x === null ? Infinity : defender.armor.x;
      hits -= Math.min(hits, armorX);
    }
    if (pool.shield > 0) {
      const shieldOnCrits = Math.min(crits, pool.shield);
      crits -= shieldOnCrits;
      pool.shield -= shieldOnCrits;
      const shieldOnHits = Math.min(hits, pool.shield);
      hits -= shieldOnHits;
      pool.shield -= shieldOnHits;
    }

    // --- Roll Defense Dice ---
    let remaining = hits + crits;
    let defColors = [];
    for (let i = 0; i < remaining; i++) defColors.push(defender.defenseDie);

    // Downgrade (attacker keyword, red -> white) resolves before Upgrade
    // (defender's own ability, white -> red), per the official dice-mod order.
    let downgradeLeft = attack.downgradeX || 0;
    defColors = defColors.map((c) => {
      if (c === 'red' && downgradeLeft > 0) {
        downgradeLeft--;
        return 'white';
      }
      return c;
    });
    let upgradeLeft = defender.upgradeDefenseDiceX || 0;
    defColors = defColors.map((c) => {
      if (c === 'white' && upgradeLeft > 0) {
        upgradeLeft--;
        return 'red';
      }
      return c;
    });

    const dangerSenseBonus = Math.min(pool.suppression || 0, defender.dangerSenseX || 0);
    for (let i = 0; i < dangerSenseBonus; i++) defColors.push(defender.defenseDie);

    if (defender.impervious && attack.pierceX) {
      for (let i = 0; i < attack.pierceX; i++) defColors.push(defender.defenseDie);
    }

    let defDice = defColors.map((c) => ({ color: c, result: rollDefenseDie(c) }));

    // Reroll (Uncanny Luck): reroll up to X dice that are blank, or that
    // rolled Surge but won't end up converted to Block, prioritizing red
    // dice first (they have the best odds).
    let luckLeft = defender.uncannyLuckX || 0;
    if (luckLeft > 0) {
      const totalSurges = defDice.filter((d) => d.result === 'surge').length;
      const excessSurgeCount = defender.defenseSurgeConv === 'block'
        ? 0
        : Math.max(0, totalSurges - (pool.surge || 0));
      let excessSurgeBudget = excessSurgeCount;
      const rerollIdx = [];
      defDice.forEach((d, i) => {
        if (d.result === 'blank') rerollIdx.push(i);
        else if (d.result === 'surge' && excessSurgeBudget > 0) {
          rerollIdx.push(i);
          excessSurgeBudget--;
        }
      });
      rerollIdx.sort((a, b) => (defDice[a].color === 'red' ? 0 : 1) - (defDice[b].color === 'red' ? 0 : 1));
      const n = Math.min(luckLeft, rerollIdx.length);
      for (let i = 0; i < n; i++) {
        const idx = rerollIdx[i];
        defDice[idx].result = rollDefenseDie(defDice[idx].color);
      }
    }

    let blocks = defDice.filter((d) => d.result === 'block').length;
    let defSurges = defDice.filter((d) => d.result === 'surge').length;

    // Convert Defense Surges: weapon/unit chart first, then Surge tokens
    // from the persistent pool for any surges the chart doesn't convert.
    if (defender.defenseSurgeConv === 'block') {
      blocks += defSurges;
      defSurges = 0;
    }
    if (defSurges > 0 && pool.surge > 0) {
      const spend = Math.min(pool.surge, defSurges);
      pool.surge -= spend;
      blocks += spend;
      defSurges -= spend;
    }

    // Modify Defense Dice: Pierce X cancels up to X Block results.
    if (attack.pierceX) {
      blocks = Math.max(0, blocks - attack.pierceX);
    }

    // Compare Results: remaining Block results cancel crits first, then hits.
    const critsCancelled = Math.min(crits, blocks);
    crits -= critsCancelled;
    blocks -= critsCancelled;
    const hitsCancelled = Math.min(hits, blocks);
    hits -= hitsCancelled;

    const woundsThisAttack = hits + crits;

    if (attack.suppressive) {
      pool.suppression = (pool.suppression || 0) + 1;
    }

    return woundsThisAttack;
  }

  /**
   * Run a full Monte Carlo simulation of a sequence of attacks against one
   * defender, with a shared/depleting token pool across the sequence.
   */
  function simulate(attacks, defender, trials) {
    trials = trials || 20000;
    const n = attacks.length;
    const killAtOrBefore = new Array(n).fill(0);
    const woundsPerAttack = attacks.map(() => 0);
    const woundHistogramPerAttack = attacks.map(() => ({}));
    const cumulativeWoundHistogram = attacks.map(() => ({}));
    const cumulativeWoundsSum = new Array(n).fill(0); // uncapped, for the "total expected wounds" stat

    for (let t = 0; t < trials; t++) {
      const pool = {
        dodge: (defender.tokenPool && defender.tokenPool.dodge) || 0,
        shield: (defender.tokenPool && defender.tokenPool.shield) || 0,
        suppression: (defender.tokenPool && defender.tokenPool.suppression) || 0,
        surge: (defender.tokenPool && defender.tokenPool.surge) || 0,
      };
      let health = defender.health;
      let dead = false;
      let cumulativeWounds = 0;

      for (let i = 0; i < n; i++) {
        let wounds = 0;
        if (!dead) {
          wounds = resolveAttack(attacks[i], defender, pool);
          health -= wounds;
          cumulativeWounds += wounds;
          if (health <= 0) dead = true;
        }
        if (dead) killAtOrBefore[i]++;

        woundsPerAttack[i] += wounds;
        woundHistogramPerAttack[i][wounds] = (woundHistogramPerAttack[i][wounds] || 0) + 1;
        cumulativeWoundsSum[i] += cumulativeWounds;
        const cw = Math.min(cumulativeWounds, defender.health);
        cumulativeWoundHistogram[i][cw] = (cumulativeWoundHistogram[i][cw] || 0) + 1;
      }
    }

    const perAttack = attacks.map((a, i) => ({
      avgWounds: woundsPerAttack[i] / trials,
      avgCumulativeWounds: cumulativeWoundsSum[i] / trials,
      chanceToKillCumulative: killAtOrBefore[i] / trials,
      woundHistogram: normalizeHistogram(woundHistogramPerAttack[i], trials),
      cumulativeWoundHistogram: normalizeHistogram(cumulativeWoundHistogram[i], trials),
    }));

    return { trials, perAttack };
  }

  function normalizeHistogram(hist, trials) {
    const out = {};
    Object.keys(hist).forEach((k) => {
      out[k] = hist[k] / trials;
    });
    return out;
  }

  return { ATTACK_DIE, DEFENSE_DIE, rollAttackDie, rollDefenseDie, resolveAttack, simulate };
});

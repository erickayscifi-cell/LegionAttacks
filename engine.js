// Legion Targeter — combat simulation engine (pure JS, no DOM dependencies)
// Runs in both browser and Node for testing.
//
// Implements the official Attack Sequence (Rules Reference / Core Rulebook)
// as closely as is practical for a "core keywords" fan calculator:
//   1. Roll Attack Dice, Reroll Dice (Aim/Observe/Precise, round-based),
//      Convert Attack Surges (Critical X), then Marksman (spend Aim) /
//      Jar'Kai Mastery (spend the attacker's own Dodge, Melee only) may
//      convert Blank->Hit or Hit->Crit -- see resolveAttack for the greedy
//      per-trial priority this uses -- then Ram X (blanks then hits -> crit).
//   2. Apply Dodge and Cover: a Melee attack gets no Cover at all (Ranged-
//      only defense); otherwise Blast (unless Immune: Blast) removes cover
//      entirely, else terrain Cover, the Cover X keyword, and a unit's own
//      Suppression tokens (all improving effective cover, capped at heavy)
//      combine and Sharpshooter X steps the tier back down; Low Profile
//      cancels 1 hit outright if cover remains; roll a Cover Pool (1 white
//      defense die per remaining hit) and cancel hits per light/heavy
//      Cover; then spend Dodge tokens (Outmaneuver lets leftover Dodge
//      also cancel Crits) -- Block and Nimble key off how many Dodge
//      tokens were spent here.
//   3. Modify Attack Dice: Impact X (hit->crit, only vs Armor), Armor X
//      (cancel hits), Shield tokens (cancel 1 hit or crit each, Ranged
//      attacks only).
//   4. Roll Defense Dice for remaining hits+crits (die count = hits+crits),
//      applying Downgrade then Upgrade Defense Dice, Danger Sense bonus
//      dice (tied to Suppression tokens held, Ranged attacks only), and
//      Impervious bonus dice (vs effective Pierce X, i.e. 0 if the
//      defender is Immune: Pierce).
//   5. Reroll (Uncanny Luck: blanks and any surge results that won't be
//      converted, red dice prioritized), Convert Defense Surges (chart,
//      Block's own Surge:Block if it spent Dodge this attack, or Surge
//      tokens), Modify Defense Dice (effective Pierce X cancels Block
//      results).
//   6. Compare Results: remaining Block results cancel crits first, then
//      hits (mathematically equivalent to just subtracting total blocks
//      from total hits+crits, since nothing downstream distinguishes them).
//   7. After defending: Nimble regains 1 Dodge token if 1+ were spent.
//
// Cross-checked dice faces and mechanics against the official Rules
// Reference and against github.com/dankraus/legion-roller (LegionRoller).
// Documented simplifications: no conditional counter-attack keywords
// (Deflect, Soresu Mastery -- these deal wounds back to the attacker, out
// of scope for a chance-to-kill-the-defender calculator), no Guardian/
// Backup (redirects an attack to a different unit), Shield tokens usable
// on any attack (not gated to Ranged only), Cover Pool die color fixed to
// white (per RAW), Impervious modeled as bonus defense dice (per current
// keyword glossary) rather than a Pierce-reduction effect.
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
   *   blast: bool,                       // defender may not apply cover to this attack
   *   isMelee: bool,                     // this is a Melee attack: no Cover, Shield, or Danger Sense for the defender
   *   marksmanAim: int,                  // Aim tokens spent via Marksman (Blank->Hit / Hit->Crit), separate from tokens.aim
   *   jarKaiDodge: int,                  // attacker's own Dodge tokens spent via Jar'Kai Mastery (Melee attacks only)
   * }
   * defender: {
   *   health, defenseDie: 'white'|'red', defenseSurgeConv: 'none'|'block',
   *   cover: 'none'|'light'|'heavy',
   *   coverX: int,                       // Cover X keyword, adds to the cover tier (capped at heavy)
   *   armor: { enabled, x },             // x may be Infinity for unlimited "Armor"
   *   impervious: bool,
   *   dangerSenseX, uncannyLuckX,
   *   lowProfile: bool,
   *   upgradeDefenseDiceX: int,
   *   immunePierce: bool,                // Immune: Pierce -- attacker's Pierce X has no effect
   *   immuneBlast: bool,                 // Immune: Blast -- attacker's Blast has no effect
   *   block: bool,                       // Block -- gains Surge:Block for the rest of the attack if it spends 1+ Dodge
   *   nimble: bool,                      // Nimble -- regains 1 Dodge token after defending if it spent 1+
   *   outmaneuver: bool,                 // Outmaneuver -- Dodge tokens may also cancel Crit results
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
    let blanksAfterReroll = dice.filter((d) => d.result === 'blank').length;

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

    // --- Marksman (spend Aim) / Jar'Kai Mastery (spend the attacker's own
    // Dodge tokens, Melee attacks only): convert Blank->Hit or Hit->Crit,
    // 1 point each (2 points spent as one of each nets a Blank->Crit, so
    // that combo needs no separate code path). This is a greedy per-trial
    // approximation of optimal play, not a full solver: with no apparent
    // hit-cancelling defense in play it spends on Blank->Hit first (a
    // guaranteed-positive conversion), but flips to Hit->Crit first
    // whenever the defender has Cover, Armor, or a live Dodge pool, since
    // only Crit results are immune to Cover Pool cancellation, Dodge
    // spending, and Armor X.
    let conversionBudget = (attack.marksmanAim || 0) + (attack.isMelee ? (attack.jarKaiDodge || 0) : 0);
    if (conversionBudget > 0) {
      const hasHitCancellingDefense = defender.cover !== 'none' || (defender.coverX || 0) > 0 ||
        !!(defender.armor && defender.armor.enabled) || (pool.dodge || 0) > 0;
      const spendCrit = () => {
        const n = Math.min(conversionBudget, hits);
        hits -= n; crits += n; conversionBudget -= n;
      };
      const spendHit = () => {
        const n = Math.min(conversionBudget, blanksAfterReroll);
        hits += n; blanksAfterReroll -= n; conversionBudget -= n;
      };
      if (hasHitCancellingDefense) { spendCrit(); spendHit(); } else { spendHit(); spendCrit(); }
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
    // A defending unit does not benefit from Cover at all against a Melee
    // attack (Cover, and everything that improves it, is a Ranged-only
    // defense). Otherwise, Blast lets the defender apply no cover either,
    // unless it has Immune: Blast (in which case Blast has no effect on it).
    const blastNegatesCover = !!attack.blast && !defender.immuneBlast;
    let coverTier = 0;
    if (!attack.isMelee && !blastNegatesCover) {
      // Terrain cover, the Cover X keyword, and a unit's own Suppression
      // tokens (which improve effective cover by 1 tier) all stack, capped
      // at heavy; Sharpshooter X then steps the tier back down. Low Profile
      // is evaluated against this same final tier, since its RAW wording is
      // negated whenever Sharpshooter (or Blast, handled above) removes the
      // defender's cover entirely.
      const terrainTier = defender.cover === 'heavy' ? 2 : defender.cover === 'light' ? 1 : 0;
      const coverXBump = defender.coverX || 0;
      const suppressionBump = (pool.suppression || 0) > 0 ? 1 : 0;
      const coverTierBeforeSharpshooter = Math.min(2, terrainTier + coverXBump + suppressionBump);
      coverTier = Math.max(0, coverTierBeforeSharpshooter - (attack.sharpshooterX || 0));
    }
    // Low Profile cancels 1 hit outright whenever the defender still has
    // cover, applied before the Cover Pool is rolled (so it also shrinks it).
    if (coverTier > 0 && defender.lowProfile && hits > 0) {
      hits -= 1;
    }
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

    // Spend Dodge tokens: normally only against hits; Outmaneuver also lets
    // leftover Dodge tokens cancel Crit results. Track how many were spent
    // for Block (Surge:Block for the rest of this attack) and Nimble (regain
    // 1 Dodge token after defending).
    const dodgeAllowed = !attack.highVelocity;
    let dodgeSpent = 0;
    if (dodgeAllowed && pool.dodge > 0) {
      const spendOnHits = Math.min(pool.dodge, hits);
      pool.dodge -= spendOnHits;
      hits -= spendOnHits;
      dodgeSpent += spendOnHits;
      if (defender.outmaneuver && pool.dodge > 0 && crits > 0) {
        const spendOnCrits = Math.min(pool.dodge, crits);
        pool.dodge -= spendOnCrits;
        crits -= spendOnCrits;
        dodgeSpent += spendOnCrits;
      }
    }
    // Block: gains Surge:Block for the remainder of this attack if it spent
    // 1 or more Dodge tokens (stacks with any chart-based Surge conversion).
    const blockSurgeToBlock = !!defender.block && dodgeSpent > 0;

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
    // Shield tokens can only be spent against a Ranged attack -- a Melee
    // attack also denies the defender's Cover (handled above) and Guardian.
    if (!attack.isMelee && pool.shield > 0) {
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

    // Danger Sense X is also a Ranged-only defense (per its RAW wording).
    const dangerSenseBonus = attack.isMelee ? 0 : Math.min(pool.suppression || 0, defender.dangerSenseX || 0);
    for (let i = 0; i < dangerSenseBonus; i++) defColors.push(defender.defenseDie);

    // Immune: Pierce means the attacker's Pierce X has no effect on this
    // defender at all, so treat it as 0 for both Impervious's bonus dice and
    // the later Block-cancelling step.
    const effectivePierceX = defender.immunePierce ? 0 : (attack.pierceX || 0);

    if (defender.impervious && effectivePierceX) {
      for (let i = 0; i < effectivePierceX; i++) defColors.push(defender.defenseDie);
    }

    let defDice = defColors.map((c) => ({ color: c, result: rollDefenseDie(c) }));

    // Reroll (Uncanny Luck): reroll up to X dice that are blank, or that
    // rolled Surge but won't end up converted to Block, prioritizing red
    // dice first (they have the best odds).
    let luckLeft = defender.uncannyLuckX || 0;
    if (luckLeft > 0) {
      const totalSurges = defDice.filter((d) => d.result === 'surge').length;
      const excessSurgeCount = (defender.defenseSurgeConv === 'block' || blockSurgeToBlock)
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
    if (defender.defenseSurgeConv === 'block' || blockSurgeToBlock) {
      blocks += defSurges;
      defSurges = 0;
    }
    if (defSurges > 0 && pool.surge > 0) {
      const spend = Math.min(pool.surge, defSurges);
      pool.surge -= spend;
      blocks += spend;
      defSurges -= spend;
    }

    // Modify Defense Dice: Pierce X cancels up to X Block results (unless
    // the defender is Immune: Pierce, handled above via effectivePierceX).
    if (effectivePierceX) {
      blocks = Math.max(0, blocks - effectivePierceX);
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

    // Nimble: after defending, regain 1 Dodge token if 1 or more were spent.
    if (defender.nimble && dodgeSpent > 0) {
      pool.dodge = (pool.dodge || 0) + 1;
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

# Legion Targeter

A chance-to-kill calculator for *Star Wars: Legion*. Unlike a single-roll
dice-odds calculator (e.g. LegionRoller), this tool sequences **multiple
attacks against one defender** and tracks the defender's **Dodge / Shield /
Suppression / Surge token pool as a single depleting resource across the
whole sequence** — so you can answer questions like "how many pools of 5
black dice with an Aim does it take to kill a 6-health defender with 3
Dodge tokens?"

It's a static, dependency-free site (plain HTML/CSS/JS) meant to be hosted
on GitHub Pages.

## Files

- `index.html` — the calculator's page structure
- `about.html` — an About page (author bio, books, links); edit the text
  directly, no build step. Drop matching image files into `images/` (see
  `images/README.txt`) — a missing file just falls back to its alt text.
- `style.css` — styling for both pages
- `engine.js` — the dice/combat simulation engine (also runnable in Node for testing)
- `app.js` — UI wiring (state, rendering, recompute-on-change)

## UI features

- **Chance to Kill panel**: the results column is headed "Chance to Kill".
  A "Total expected wounds (all attacks)" card appears once at the bottom,
  after every attack's card — the average cumulative damage dealt across
  the whole sequence (not capped at the defender's health). Each individual
  attack card still shows its own "Avg wounds this attack".
- **Flavor quote**: a Star Wars quote appears under the heading, picked
  from a bad/middle/good pool based on the final cumulative chance to kill
  (≤15% bad, ≥90% good, otherwise middle) — see the `QUOTES_*` arrays in
  `app.js` to add or re-tier your own. The quote updates on its own ~500ms
  debounce, separate from the (faster) results recompute, so mashing a
  number spinner doesn't flicker it on every keystroke.

- **Theme**: Settings (gear icon) has a Dark / Light / System selector,
  saved in `localStorage` and applied on both pages before first paint (no
  flash of the wrong theme).
- **Full export / import**: Settings also has "Export All" / "Import All",
  which save or load the defender *and every attack* together as one
  `.json` file (`{"schema":"legion-targeter-full", ...}`) — for backing up
  or sharing an entire matchup setup, as opposed to the per-attack
  save/load below which handles one attacker at a time.
- **Compact layout**: each attack's Tokens and Keywords are collapsed
  behind `<details>` sections (a small badge shows how many are non-zero),
  and they auto-expand if the attack already has any of them set — e.g.
  loading a saved attacker with Critical X set opens its Keywords section
  automatically.
- **Reorder / save / load / duplicate an attacker**: each attack card has a
  small toolbar — ▲/▼ move that attack earlier or later in the sequence
  (order matters: token depletion, Nimble regen, and Blast/Cover
  interactions all depend on which attack happens first), ⧉ duplicates it
  into a new card right after itself, 💾 downloads its full configuration
  as a `.json` file, and 📂 loads a previously-downloaded file back into
  *that* card (overwriting only it). Handy for a squad you'll reuse across
  attacks or sessions: build it once, download it, then upload the same
  file into attack #2, #3, etc. The format is a plain JSON object
  (`{"schema":"legion-targeter-attacker", ...}`) — safe to hand-edit or
  version-control.

## How it works

Each attack is resolved as a Monte Carlo simulation (20,000 trials by
default, adjustable in Settings) following the official Attack Sequence:
roll attack dice → reroll (Aim/Observe/Precise) → convert attack surges
(Critical X) → roll a Cover Pool and apply Cover/Low Profile → spend Dodge
→ Impact X / Armor X / Shield tokens → roll defense dice (with
Downgrade/Upgrade, Danger Sense, Impervious) → reroll (Uncanny Luck) →
convert defense surges → Pierce → compare results (Block cancels crits
first, then hits).

For a sequence of attacks, the **same simulated trial** carries the
defender's token pool and remaining health from one attack into the next,
so token depletion (e.g. spending your last Dodge token on attack 2 means
attack 3 has none left) is modeled correctly, and "chance to kill after
attack N" is a true cumulative probability, not an independent per-attack
estimate.

## Keywords modeled

Attacker/weapon: Critical X, Precise X, Sharpshooter X, Impact X, Pierce X,
Downgrade Defense Dice X, Ram X, High Velocity, Suppressive, Blast (ignores
the defender's cover, terrain or keyword-granted, unless it has
Immune: Blast), Marksman (spend Aim tokens to convert Blank→Hit or
Hit→Crit), and Jar'Kai Mastery (the same conversions, spending the
attacker's own Dodge tokens instead — only on a Melee attack). Each attack
card also has a **Melee attack** toggle, since several defensive keywords
below (and Jar'Kai Mastery) only apply to one attack type or the other.

Defender/unit: Cover (terrain: none/light/heavy) and Cover X (a keyword
that adds to the cover tier, capped at heavy — e.g. the T-47 Airspeeder's
Cover 1), Low Profile, Armor / Armor X, Impervious, Danger Sense X, Uncanny
Luck X, Upgrade Defense Dice X, Immune: Pierce, Immune: Blast, Block (gains
Surge:Block for the rest of the attack if it spends 1+ Dodge), Nimble
(regains 1 Dodge token after defending if it spent 1+), and Outmaneuver
(leftover Dodge tokens may also cancel Crit results, not just hits). Cover
(terrain, Cover X, and the Suppression bump), Shield tokens, and Danger
Sense X are all Ranged-only per RAW, so they have no effect when an
attack's Melee toggle is on.

### Marksman / Jar'Kai Mastery: how the "smart spend" works

Both keywords let the attacker upgrade its own dice (Blank→Hit or
Hit→Crit, 1 point each — spending 2 points as one of each nets a
Blank→Crit, so that combo doesn't need separate handling) right after
Convert Attack Surges. The reserved budget is a single number you set
(`Marksman: Aim spent` / `Jar'Kai Mastery: Dodge spent`); the engine then
decides *how* to spend it on each simulated trial, rather than you having
to pre-commit to an exact split of Blank→Hit vs. Hit→Crit:

- With no apparent hit-cancelling defense in play (no Cover, no Armor, no
  live Dodge pool), it spends on Blank→Hit first — that's a guaranteed
  net-positive conversion regardless of what happens later.
- Once the defender has Cover, Armor, or Dodge tokens available, it
  spends on Hit→Crit first instead, since only Crit results are immune to
  Cover Pool cancellation, Dodge spending, and Armor X.

This is a greedy per-trial heuristic, not an exhaustive solver — it can
be a little conservative in Block-heavy matchups (converting to Crit also
exposes that result to Block's crits-first cancellation), but it tracks
real optimal play closely in the more common case where Cover/Armor/Dodge
are the bigger threat.

Note: "Speeder" itself is a movement keyword with no defensive effect —
if you were thinking of a speeder-type vehicle's Cover 1 and Immune: Pierce
(e.g. the T-47 Airspeeder), those are two separate keywords (Cover X and
Immune: Pierce) that unit happens to also have; set them individually.

## Documented simplifications

This intentionally leaves out hero-specific counter-attack keywords that
deal wounds back to the attacker (Deflect, Soresu Mastery) and
Guardian/Backup (which redirect an attack to a different unit) — those
are out of scope for a calculator focused on the defender's own chance to
be killed. Shield tokens are usable on any attack (not gated to Ranged
only). Attacker tokens (Aim/Surge/Observe) are set per-attack (they're
spent fresh each activation); defender tokens (Dodge/Shield/Suppression/
Surge) are one shared pool across the whole attack sequence, matching how
they persist in the real game until spent or removed in the End Phase —
this also means keywords that key off "spent a Dodge token this attack"
(Block, Nimble) and the attack order itself (drag attacks up/down with the
▲/▼ buttons) can meaningfully change the outcome.

Dice faces and the full attack sequence (Roll → Reroll → Convert Surges →
Apply Dodge and Cover → Modify Attack Dice → Roll/Modify Defense Dice →
Compare Results) were verified against the official Rules Reference PDF,
and cross-checked against [LegionRoller's source](https://github.com/dankraus/legion-roller)
(a mature, well-tested single-roll calculator). That comparison caught and
fixed a few things along the way:

- A unit's own Suppression tokens improve its effective Cover by one tier
  (none→light, light→heavy), per the rulebook — this now feeds into the
  Cover Pool roll, not just Danger Sense.
- Low Profile cancels 1 hit outright (shrinking the Cover Pool itself),
  rather than just adding a flat bonus after the pool was already rolled.
- Ram X now converts blanks (then hits) to crits, matching the official
  wording, instead of adding flat bonus crits.
- Uncanny Luck rerolls both blank results and any Surge results that won't
  end up converted to Block, prioritizing red dice first.
- Reroll tokens (Aim/Observe) are modeled as discrete rounds — each token
  is its own reroll opportunity — instead of one pooled reroll budget.

One place this tool intentionally differs from LegionRoller: Dodge is
applied *before* Impact/Armor/Shield resolve (per the Rules Reference's
explicit step order — Apply Dodge and Cover is step 5, Modify Attack Dice
is step 6), whereas LegionRoller's code applies Dodge last. If your
in-person rulings differ, that's the one spot to double check against your
own group's understanding. Impervious is modeled as its RAW text describes
(roll bonus defense dice equal to the attacker's Pierce X) rather than
reducing Pierce's effect.

If you spot a mismatch with your rules printing, open an issue or just
edit `engine.js` — it's a small, readable file.

## Running locally

No build step. Just open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

## Deploying to GitHub Pages

1. Create a new GitHub repo (or use an existing one) and push these files
   to it:
   ```
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
2. In the repo on GitHub: **Settings → Pages**.
3. Under "Build and deployment", set **Source** to "Deploy from a branch",
   branch `main`, folder `/ (root)`. Save.
4. GitHub will publish the site at
   `https://<your-username>.github.io/<repo-name>/` within a minute or two.

Any future change just needs `git add`, `git commit`, `git push` — Pages
redeploys automatically.

## Possible future additions

- A Supabase-backed library of saved defender/attacker presets (unit
  cards) so you don't have to re-enter stats every time.
- An automatic "how many repetitions of this attack pool are needed to
  reach X% kill chance" solver, built on the same simulation engine.
- Wound/kill distribution charts per attack (the engine already returns
  histograms; the UI currently only surfaces the summary numbers).

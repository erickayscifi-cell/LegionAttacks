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

## Documented simplifications

This models the "core" defensive keyword set well but intentionally
leaves out hero-specific / conditional-regen keywords (Nimble, Outmaneuver,
Block, Deflect, Soresu Mastery, Guardian, Backup, etc.) and melee-only
gating on Shield tokens. Attacker tokens (Aim/Surge/Observe) are set
per-attack (they're spent fresh each activation); defender tokens
(Dodge/Shield/Suppression/Surge) are one shared pool across the whole
attack sequence, matching how they persist in the real game until spent or
removed in the End Phase.

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

// Character creation, the character sheet, and the reputation screen.
//
// Kept apart from screens.js because character creation is a multi-step flow
// with its own state, rather than a panel rendered from the game object.

import { el, clear, panel, button, readout, pill, field, textInput, select } from './lcars.js';
import { haptic } from './touch.js';
import { audio } from '../audio/engine.js';

import {
  ABILITIES, ABILITY_IDS, PLAYER_SPECIES, ORIGINS, CAREERS, TRAITS,
  FEATS, FEAT_BY_ID, MAX_TRAITS, POINT_BUY_COST, POINT_BUY_BUDGET,
  POINT_BUY_MIN, POINT_BUY_MAX, STANDARD_ARRAY, pointBuyCost,
  Character, randomCharacter,
} from '../rules/character.js';
import { DIFFICULTIES } from '../rules/difficulty.js';
import { REP_TIERS, TRACK_LIST } from '../rules/reputation.js';
import { abilityMod } from '../rules/dice.js';
import { ERA_LIST } from '../world/crews.data.js';

const tap = (fn, cue = 'ui_tap') => (...args) => {
  audio.play(cue);
  haptic('tap');
  return fn(...args);
};

const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

// ================================================================ creation

const STEPS = [
  { id: 'difficulty', label: 'Difficulty' },
  { id: 'identity', label: 'Identity' },
  { id: 'species', label: 'Species' },
  { id: 'origin', label: 'Origin' },
  { id: 'career', label: 'Career' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'traits', label: 'Traits' },
  { id: 'crew', label: 'Crew & Ship' },
  { id: 'review', label: 'Review' },
];

/**
 * Multi-step captain creation. Holds its own draft and re-renders in place,
 * so nothing is committed until the last step.
 */
export class CharacterCreator {
  constructor(app, onComplete) {
    this.app = app;
    this.onComplete = onComplete;
    this.stepIndex = 0;
    this.draft = {
      difficulty: 'lieutenant',
      firstName: 'Alexander',
      lastName: 'Reyes',
      pronouns: 'they/them',
      speciesId: 'human',
      originId: 'core_world',
      careerId: 'command',
      traits: [],
      baseScores: Object.fromEntries(ABILITY_IDS.map((id) => [id, 10])),
      crewMode: 'canon',
      era: 'tos',
      shipName: 'Enterprise',
      registry: 'NCC-1701',
      seed: '',
    };
    // Start from the standard array rather than a flat ten.
    ABILITY_IDS.forEach((id, i) => { this.draft.baseScores[id] = STANDARD_ARRAY[i] ?? 10; });

    this.root = el('div', { class: 'screen' });
    this.body = el('div', { class: 'scroll' });
    this.footer = el('div', { class: 'creator-footer' });
    this.root.append(this.body, this.footer);
    this.render();
  }

  get step() { return STEPS[this.stepIndex]; }

  /** A live Character built from the draft, for previewing final numbers. */
  preview() {
    return new Character(this.draft);
  }

  go(delta) {
    this.stepIndex = Math.max(0, Math.min(STEPS.length - 1, this.stepIndex + delta));
    this.render();
    this.body.scrollTop = 0;
  }

  render() {
    clear(this.body);
    clear(this.footer);

    // Progress rail across the top.
    this.body.append(el('div', { class: 'steprail' }, STEPS.map((s, i) => el('div', {
      class: `steppip ${i === this.stepIndex ? 'on' : i < this.stepIndex ? 'done' : ''}`.trim(),
      title: s.label,
      onclick: i <= this.stepIndex ? tap(() => { this.stepIndex = i; this.render(); }) : null,
    }))));
    this.body.append(el('div', { class: 'speaker', text: `Step ${this.stepIndex + 1} of ${STEPS.length} — ${this.step.label}` }));

    this[`step_${this.step.id}`]();

    // Footer navigation.
    const last = this.stepIndex === STEPS.length - 1;
    this.footer.append(el('div', { class: 'btn-row' }, [
      this.stepIndex > 0
        ? button('Back', tap(() => this.go(-1), 'ui_back'), { color: 'ghost' })
        : button('Random captain', tap(() => this.randomise(), 'ui_select'), { color: 'ghost' }),
      last
        ? button('Assume command', tap(() => this.finish(), 'ui_confirm'), { color: 'green' })
        : button('Continue', tap(() => this.go(1), 'ui_select'), { color: 'orange' }),
    ]));
  }

  randomise() {
    const c = randomCharacter(this.app.rngForCreation());
    Object.assign(this.draft, {
      firstName: c.firstName, lastName: c.lastName, speciesId: c.speciesId,
      originId: c.originId, careerId: c.careerId, traits: c.traits,
      baseScores: c.baseScores,
    });
    this.render();
  }

  finish() {
    this.onComplete(this.draft);
  }

  // ---------------------------------------------------------------- steps

  step_difficulty() {
    this.body.append(panel('How hard should this be?', [
      el('p', { class: 'hint', text: 'Named up the command ladder. This is the difficulty of the game, not your character’s rank — you start as a Captain either way.' }),
    ], 'accent'));

    for (const d of DIFFICULTIES) {
      const chosen = this.draft.difficulty === d.id;
      this.body.append(el('div', {
        class: `diffcard ${chosen ? 'on' : ''}`.trim(),
        onclick: tap(() => { this.draft.difficulty = d.id; this.render(); }, 'ui_select'),
      }, [
        el('div', { class: 'diffhead' }, [
          el('b', { text: d.name }),
          el('span', { class: 'insignia', text: d.insignia }),
        ]),
        el('div', { class: 'difftag', text: d.tagline }),
        chosen ? el('p', { class: 'hint', text: d.description }) : null,
        chosen ? el('div', {}, [
          d.permadeath ? pill('permadeath', 'red') : pill('no permanent loss', 'green'),
          d.shipLoss ? pill('ship can be lost', 'red') : pill('ship cannot be lost', 'green'),
          d.ironman ? pill('ironman', 'red') : null,
          pill(`DC ${signed(d.dcShift)}`),
          pill(`XP ×${d.xpRate}`),
        ]) : null,
      ]));
    }
  }

  step_identity() {
    this.body.append(panel('Starfleet Personnel File', [
      field('Given name', textInput(this.draft.firstName, (v) => { this.draft.firstName = v; })),
      field('Surname', textInput(this.draft.lastName, (v) => { this.draft.lastName = v; })),
      field('Pronouns', select([
        { value: 'they/them', label: 'they / them' },
        { value: 'she/her', label: 'she / her' },
        { value: 'he/him', label: 'he / him' },
        { value: 'xe/xem', label: 'xe / xem' },
      ], this.draft.pronouns, (v) => { this.draft.pronouns = v; })),
      el('p', { class: 'hint', text: 'Your officers will address you as Captain. This is what goes on the record.' }),
    ], 'accent'));
  }

  step_species() {
    this.body.append(panel('Species', [
      el('p', { class: 'hint', text: 'Species shifts your ability scores and grants a trait that is always in effect.' }),
    ]));
    for (const s of PLAYER_SPECIES) {
      const chosen = this.draft.speciesId === s.id;
      this.body.append(el('div', {
        class: `optcard ${chosen ? 'on' : ''}`.trim(),
        onclick: tap(() => { this.draft.speciesId = s.id; this.render(); }, 'ui_select'),
      }, [
        el('div', { class: 'opthead' }, [
          el('b', { text: s.name }),
          el('span', { class: 'bonuslist', text: this.bonusText(s) }),
        ]),
        el('div', { class: 'muted small', text: s.description }),
        chosen ? el('p', { class: 'hint' }, [
          el('b', { text: `${s.trait}: ` }), s.traitText,
        ]) : null,
      ]));
    }
  }

  bonusText(entry) {
    const parts = [];
    for (const [k, v] of Object.entries(entry.bonuses ?? {})) {
      parts.push(`${ABILITIES.find((a) => a.id === k)?.abbr ?? k} ${signed(v)}`);
    }
    for (const [k, v] of Object.entries(entry.penalties ?? {})) {
      parts.push(`${ABILITIES.find((a) => a.id === k)?.abbr ?? k} ${signed(v)}`);
    }
    return parts.join('  ');
  }

  step_origin() {
    this.body.append(panel('Where you grew up', [
      el('p', { class: 'hint', text: 'Origin adds smaller ability bonuses and one lasting perk.' }),
    ]));
    for (const o of ORIGINS) {
      const chosen = this.draft.originId === o.id;
      this.body.append(el('div', {
        class: `optcard ${chosen ? 'on' : ''}`.trim(),
        onclick: tap(() => { this.draft.originId = o.id; this.render(); }, 'ui_select'),
      }, [
        el('div', { class: 'opthead' }, [
          el('b', { text: o.name }),
          el('span', { class: 'bonuslist', text: this.bonusText(o) }),
        ]),
        el('div', { class: 'muted small', text: o.description }),
        chosen ? el('p', { class: 'hint' }, [el('b', { text: 'Perk: ' }), o.perk]) : null,
      ]));
    }
  }

  step_career() {
    this.body.append(panel('Your track before the chair', [
      el('p', { class: 'hint', text: 'Career grants proficiency in two abilities — a flat bonus on every check with them — and one signature power usable once per engagement.' }),
    ]));
    for (const c of CAREERS) {
      const chosen = this.draft.careerId === c.id;
      this.body.append(el('div', {
        class: `optcard ${chosen ? 'on' : ''}`.trim(),
        onclick: tap(() => { this.draft.careerId = c.id; this.render(); }, 'ui_select'),
      }, [
        el('div', { class: 'opthead' }, [
          el('b', { text: c.name }),
          el('span', { class: 'bonuslist', text: c.proficiencies
            .map((p) => ABILITIES.find((a) => a.id === p)?.abbr ?? p).join(' · ') }),
        ]),
        el('div', { class: 'muted small', text: c.description }),
        chosen ? el('p', { class: 'hint' }, [
          el('b', { text: `${c.signature}: ` }), c.signatureText,
        ]) : null,
      ]));
    }
  }

  step_abilities() {
    const spent = pointBuyCost(this.draft.baseScores);
    const remaining = POINT_BUY_BUDGET - spent;
    const preview = this.preview();

    this.body.append(panel(`Ability scores — ${remaining} point${remaining === 1 ? '' : 's'} remaining`, [
      el('p', { class: 'hint', text: 'Point buy, 8 to 15. Species and origin bonuses are added on top; the right-hand column is your final score and the modifier every d20 check uses.' }),
      ...ABILITIES.map((a) => {
        const base = this.draft.baseScores[a.id];
        const final = preview.score(a.id);
        const mod = abilityMod(final);
        const canRaise = base < POINT_BUY_MAX
          && (POINT_BUY_COST[base + 1] - POINT_BUY_COST[base]) <= remaining;
        const canLower = base > POINT_BUY_MIN;
        return el('div', { class: 'abilityrow' }, [
          el('div', { class: 'abilityname' }, [
            el('b', { text: a.name }),
            el('small', { text: a.governs }),
          ]),
          el('div', { class: 'abilitycontrols' }, [
            el('button', {
              class: 'stepbtn', disabled: !canLower,
              onclick: canLower ? tap(() => {
                this.draft.baseScores[a.id]--; this.render();
              }) : null, text: '−',
            }),
            el('div', { class: 'abilityval' }, [
              el('b', { text: String(final) }),
              el('small', { text: signed(mod) }),
            ]),
            el('button', {
              class: 'stepbtn', disabled: !canRaise,
              onclick: canRaise ? tap(() => {
                this.draft.baseScores[a.id]++; this.render();
              }) : null, text: '+',
            }),
          ]),
        ]);
      }),
      el('div', { class: 'btn-row' }, [
        button('Standard array', tap(() => {
          ABILITY_IDS.forEach((id, i) => { this.draft.baseScores[id] = STANDARD_ARRAY[i]; });
          this.render();
        }), { color: 'ghost' }),
        button('Reset to 8s', tap(() => {
          ABILITY_IDS.forEach((id) => { this.draft.baseScores[id] = POINT_BUY_MIN; });
          this.render();
        }), { color: 'ghost' }),
      ]),
    ], remaining === 0 ? 'good' : 'accent'));
  }

  step_traits() {
    const chosenCount = this.draft.traits.length;
    this.body.append(panel(`Personal traits — ${chosenCount} of ${MAX_TRAITS} chosen`, [
      el('p', { class: 'hint', text: 'Optional. Each is a real trade rather than a bonus: take the advantage and take what it costs. Some traits cannot be held together.' }),
    ]));

    for (const group of [true, false]) {
      this.body.append(el('h3', { class: 'traitgroup', text: group ? 'Advantages' : 'Complications' }));
      for (const t of TRAITS.filter((x) => x.positive === group)) {
        const chosen = this.draft.traits.includes(t.id);
        const conflict = (t.conflicts ?? []).some((c) => this.draft.traits.includes(c));
        const full = chosenCount >= MAX_TRAITS && !chosen;
        this.body.append(el('div', {
          class: `optcard ${chosen ? 'on' : ''} ${(conflict || full) && !chosen ? 'disabled' : ''}`.trim(),
          onclick: (conflict || full) && !chosen ? null : tap(() => {
            this.draft.traits = chosen
              ? this.draft.traits.filter((x) => x !== t.id)
              : [...this.draft.traits, t.id];
            this.render();
          }, 'ui_select'),
        }, [
          el('div', { class: 'opthead' }, [
            el('b', { text: t.name }),
            el('span', { class: 'bonuslist', text: t.positive ? 'advantage' : 'complication' }),
          ]),
          el('div', { class: 'muted small', text: t.text }),
          conflict && !chosen
            ? el('div', { class: 'hint', text: 'Incompatible with a trait you have taken.' })
            : null,
        ]));
      }
    }
  }

  step_crew() {
    const d = this.draft;
    this.body.append(panel('Crew', [
      el('div', { class: 'grid-2' }, [
        button('Canonical crew', tap(() => { d.crewMode = 'canon'; this.render(); }),
          { color: d.crewMode === 'canon' ? 'green' : 'blue' }),
        button('Original crew', tap(() => { d.crewMode = 'original'; this.render(); }),
          { color: d.crewMode === 'original' ? 'green' : 'blue' }),
      ]),
      ...(d.crewMode === 'canon'
        ? ERA_LIST.map((e) => button(e.name, tap(() => { d.era = e.id; this.render(); }), {
          color: d.era === e.id ? 'amber' : 'ghost',
          sub: e.description,
        }))
        : [el('p', { class: 'hint', text: 'A senior staff will be generated from your world seed — species, traits, and abilities rolled fresh. They are yours, and they can be lost.' })]),
    ]));

    this.body.append(panel('Ship', [
      field('Ship name', textInput(d.shipName, (v) => { d.shipName = v; })),
      field('Registry', textInput(d.registry, (v) => { d.registry = v; })),
    ]));

    this.body.append(panel('Galaxy', [
      field('World seed (optional)', textInput('', (v) => { d.seed = v; }, 'leave blank for a new galaxy')),
      el('p', { class: 'hint', text: 'The same seed always builds the same galaxy, the same encounters, and the same dice.' }),
    ]));
  }

  step_review() {
    const c = this.preview();
    const diff = DIFFICULTIES.find((x) => x.id === this.draft.difficulty);

    this.body.append(panel('Service Record', [
      el('p', { class: 'big-stat', text: c.name }),
      el('p', { class: 'muted', text: `${c.species.name} · ${c.origin.name} · ${c.career.name}` }),
      el('div', {}, [
        pill(`Difficulty: ${diff.name}`, diff.order >= 7 ? 'red' : diff.order <= 1 ? 'green' : ''),
        pill(this.draft.crewMode === 'canon' ? `${this.draft.era.toUpperCase()} crew` : 'Original crew'),
        pill(`${this.draft.shipName} ${this.draft.registry}`),
      ]),
    ], 'accent'));

    this.body.append(panel('Abilities', ABILITIES.map((a) => {
      const score = c.score(a.id);
      const mod = abilityMod(score);
      return el('div', { class: 'readout' }, [
        el('div', { class: 'label', text: a.abbr }),
        el('div', { class: 'bar' }, [el('i', {
          class: score >= 16 ? '' : score >= 12 ? 'mid' : 'low',
          style: { width: `${(score / 20) * 100}%` },
        })]),
        el('div', { class: 'val', text: `${score} (${signed(mod)})` }),
      ]);
    })));

    this.body.append(panel('Always in effect', [
      el('p', { class: 'hint' }, [el('b', { text: `${c.species.trait}: ` }), c.species.traitText]),
      el('p', { class: 'hint' }, [el('b', { text: 'Origin: ' }), c.origin.perk]),
      el('p', { class: 'hint' }, [el('b', { text: `${c.career.signature}: ` }), c.career.signatureText]),
      el('p', { class: 'hint' }, [
        el('b', { text: 'Proficient in: ' }),
        c.proficiencies.map((p) => ABILITIES.find((a) => a.id === p)?.name ?? p).join(', '),
        ` (${signed(c.proficiencyBonus)} on those checks)`,
      ]),
      ...c.traits.map((t) => {
        const trait = TRAITS.find((x) => x.id === t);
        return el('p', { class: 'hint' }, [el('b', { text: `${trait.name}: ` }), trait.text]);
      }),
    ], 'good'));
  }
}

// ================================================================ sheet

export function characterSheetScreen(app) {
  const g = app.game;
  const c = g.character;
  const root = el('div', { class: 'scroll' });

  root.append(panel('Character', [
    el('p', { class: 'big-stat', text: `${g.progress.rankName} ${c.name}` }),
    el('p', { class: 'muted', text: `${c.species.name} · ${c.origin.name} · ${c.career.name} · ${c.pronouns}` }),
    el('div', {}, [
      pill(`Level ${c.level}`),
      pill(`Proficiency ${signed(c.proficiencyBonus)}`),
      pill(`Difficulty: ${g.difficulty.name}`, g.difficulty.order >= 7 ? 'red' : ''),
      ...g.reputation.allTitles.map((t) => pill(t, 'green')),
    ]),
  ], 'accent'));

  root.append(panel('Abilities', ABILITIES.map((a) => {
    const score = c.score(a.id);
    const mod = abilityMod(score);
    const prof = c.isProficient(a.id);
    return el('div', { class: 'abilityrow static' }, [
      el('div', { class: 'abilityname' }, [
        el('b', {}, [a.name, prof ? el('span', { class: 'profdot', text: '●' }) : null]),
        el('small', { text: a.governs }),
      ]),
      el('div', { class: 'abilityval' }, [
        el('b', { text: String(score) }),
        el('small', { text: `${signed(mod)}${prof ? ` / ${signed(mod + c.proficiencyBonus)}` : ''}` }),
      ]),
    ]);
  }).concat([
    el('p', { class: 'hint', text: '● marks a proficient ability. The second number is the total added to a d20 for those checks.' }),
  ])));

  root.append(panel('Always in effect', [
    el('p', { class: 'hint' }, [el('b', { text: `${c.species.trait}: ` }), c.species.traitText]),
    el('p', { class: 'hint' }, [el('b', { text: `${c.origin.name}: ` }), c.origin.perk]),
    el('p', { class: 'hint' }, [
      el('b', { text: `${c.career.signature}: ` }), c.career.signatureText,
      c.signatureUsed ? ' — used this engagement.' : ' — available.',
    ]),
    ...c.traits.map((t) => {
      const trait = TRAITS.find((x) => x.id === t);
      return trait ? el('p', { class: 'hint' }, [el('b', { text: `${trait.name}: ` }), trait.text]) : null;
    }),
  ]));

  // Feats, with anything currently selectable offered.
  const pending = g.pendingFeats ?? 0;
  const taken = c.feats.map((f) => FEAT_BY_ID[f]).filter(Boolean);
  root.append(panel(`Feats${pending ? ` — ${pending} to choose` : ''}`, [
    ...(taken.length
      ? taken.map((f) => el('p', { class: 'hint' }, [el('b', { text: `${f.name}: ` }), f.text]))
      : [el('p', { class: 'muted', text: 'None yet. Feats are chosen on promotion.' })]),
    ...(pending > 0
      ? FEATS
        .filter((f) => f.repeatable || !c.hasFeat(f.id))
        .filter((f) => (f.minRank ?? 0) <= g.progress.rank.tier)
        .map((f) => button(f.name, tap(() => app.chooseFeat(f.id), 'ui_confirm'), {
          color: 'amber', sub: f.text,
        }))
      : []),
  ], pending > 0 ? 'warn' : ''));

  // Recent dice, so the player can audit what the game did to them.
  const rolls = app.recentRolls ?? [];
  if (rolls.length) {
    root.append(panel('Recent Rolls', rolls.slice(-10).reverse().map((r) =>
      el('p', {
        class: `hint roll ${r.criticalSuccess ? 'crit' : r.criticalFailure ? 'fumble' : ''}`.trim(),
        text: r.formatted ?? '',
      }))));
  }

  return root;
}

// ================================================================ reputation

export function reputationScreen(app) {
  const g = app.game;
  const root = el('div', { class: 'scroll' });

  root.append(panel('Reputation', [
    el('p', { class: 'hint', text: 'Reputation is what you have earned with a power over a career. It only ever rises. Standing — whether they are shooting at you this week — is tracked separately on the Record screen.' }),
  ], 'accent'));

  for (const track of TRACK_LIST) {
    const t = g.reputation.track(track.id);
    if (!t) continue;
    const next = t.nextTier;

    const nodes = [
      el('div', {}, [
        pill(t.tierName, t.tier >= 4 ? 'green' : t.tier >= 2 ? 'amber' : ''),
        pill(`${t.marks} ${track.currency}`),
      ]),
      el('div', { class: 'readout' }, [
        el('div', { class: 'label', text: next ? `to ${next.name}` : 'max' }),
        el('div', { class: 'bar' }, [el('i', { style: { width: `${t.progress * 100}%` } })]),
        el('div', { class: 'val', text: next ? `${t.xp}/${next.xp}` : '—' }),
      ]),
      el('p', { class: 'muted small', text: track.description }),
    ];

    const available = t.availableProjects();
    for (const p of available) {
      const afford = t.canAfford(p);
      nodes.push(button(p.name, afford ? tap(() => {
        app.buyProject(track.id, p.id);
        app.render();
      }, 'ui_confirm') : null, {
        color: afford ? 'amber' : 'ghost',
        sub: `${p.cost} ${track.currency} — ${p.text}`,
        disabled: !afford,
      }));
    }

    const locked = t.lockedProjects();
    if (locked.length) {
      nodes.push(el('p', { class: 'hint', text: `Locked: ${locked.map((p) => `${p.name} (${REP_TIERS[p.tier].name})`).join(' · ')}` }));
    }
    if (t.completed.length) {
      nodes.push(el('div', {}, t.completed.map((id) => {
        const p = track.projects.find((x) => x.id === id);
        return p ? pill(p.name, 'green') : null;
      })));
    }

    const card = panel(track.name, nodes, t.tier >= 3 ? 'good' : '');
    card.style.borderLeftColor = track.color;
    root.append(card);
  }

  return root;
}

// ================================================================ difficulty

export function difficultyBadge(g) {
  const d = g.difficulty;
  return pill(`${d.insignia} ${d.name}`, d.order >= 7 ? 'red' : d.order <= 1 ? 'green' : '');
}

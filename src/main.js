// Boot, the frame loop, and the shell that owns every screen.
//
// There is no loading step. The galaxy is generated from its seed, the audio
// graph is built on the first tap, and the first frame is the game.

import { el, clear, button, modal } from './ui/lcars.js';
import { ASSIGNMENTS, beginAssignment, bestTeamFor } from './sim/duty.js';
import { haptic, configureTouch, requestWakeLock, releaseWakeLock, trackViewportInsets } from './ui/touch.js';
import { audio } from './audio/engine.js';
import { TacticalView } from './ui/tactical.js';
import { TacticalView3D } from './ui/tactical3d.js';
import { Renderer } from './gfx/gl.js';
import { FirstPersonView } from './ui/firstperson.js';
import { stationReport } from './sim/consoles.js';
import { GalaxyMap } from './ui/galaxymap.js';
import * as screens from './ui/screens.js';
import { warpSwitches } from './ui/chair.js';
import { CharacterCreator, characterSheetScreen, reputationScreen } from './ui/charscreens.js';

import { Game, MODES } from './core/state.js';
import { on } from './core/events.js';
import { SIM_STEP } from './core/time.js';
import { hashSeed } from './core/rng.js';
import {
  saveGame, loadSave, hasSave, loadSettings, saveSettings as persistSettings,
  exportSave, downloadSave, importSave,
} from './core/save.js';

import { ABILITIES } from './sim/officers.js';
import { WATCHES } from './sim/watch.js';
import { FACINGS, REPEL_STRENGTH, REPEL_DURATION } from './sim/ship.js';
import { answeringFor } from './sim/address.js';
import { parseOrder } from './ui/orders.js';
import { readAnswer, AFFIRM_PHRASE, BELAY_PHRASE } from './lang/answers.js';
import { SKILLS } from './sim/skills.js';
import { RNG } from './core/rng.js';
import { FEAT_BY_ID, ABILITIES as ABILITY_LIST } from './rules/character.js';
import { CONSOLES } from './sim/loadout.js';
import { yardReport, takeCommandOf } from './sim/command.js';
import { venueFor } from './rules/inquiry.js';
import { TIERS, TRAIT_LIST } from './sim/mastery.js';

// TABS ARE FOR TEXT.
//
// The viewer, the tactical plot and the galaxy map used to be tabs, and they
// are not text — they are things you LOOK at, and a starship's crew looks at
// them on the main viewer or at a console. So the bridge is the first-person
// view now, what is outside is on the viewscreen inside it, and the map is the
// navigation console you walk to.
//
// What is left here is the record: the log, the roster, the manual. Reading is
// the one thing a tab is actually for.
const NAV = [
  { id: 'bridge', label: 'Bridge', ico: '⌂' },
  { id: 'log', label: 'Log', ico: '▤' },
  { id: 'ship', label: 'Ship', ico: '⬡' },
  { id: 'crew', label: 'Crew', ico: '☰' },
  { id: 'sheet', label: 'Captain', ico: '✧' },
  { id: 'reputation', label: 'Rep', ico: '◈' },
  { id: 'captain', label: 'Record', ico: '★' },
];

/** Which console panel a station opens when you walk up and use it. */
const STATION_PANEL = {
  helm: 'helm', navigation: 'galaxy', comms: 'comms', power: 'power',
  weapons: 'tactical', science: 'science', damage: 'ship', medical: 'crew',
  transport: 'transport', fabrication: 'shop', missions: 'missions',
  // Not a console anywhere on the ship — the panel a thing on a planet opens.
  survey: 'survey',
  log: 'log', record: 'captain', turbolift: 'turbolift', crew: 'crew',
  galaxy: 'galaxy',
};


/**
 * Render an outcome as an auditable card: the verdict, the arithmetic that
 * produced it, and the prose.
 *
 * Gameplay no longer rolls a d20, so this shows a margin — how comfortably or
 * how badly — rather than a die face. Everything else is unchanged: the terms
 * are still itemised, and the player can still see exactly which ability, which
 * officer and which circumstance contributed what.
 */
function rollCard(r) {
  const cls = r.criticalSuccess ? 'crit' : r.criticalFailure ? 'fumble' : '';
  const breakdown = (r.parts ?? [])
    .filter((p) => p.value !== 0)
    .map((p) => `${p.source} ${p.value >= 0 ? '+' : ''}${p.value}`)
    .join('  ·  ');

  // The margin bar: centred on the pass mark, filling right for a comfortable
  // success and left for a bad failure. It reads at a glance in a way a number
  // does not, which matters when the same modal is telling you an officer died.
  const margin = typeof r.margin === 'number' ? r.margin : null;
  const bar = margin === null ? null : el('div', { class: 'marginbar' }, [
    el('i', {
      class: margin >= 0 ? 'good' : 'bad',
      style: {
        width: `${Math.min(50, Math.abs(margin) * 3.2)}%`,
        [margin >= 0 ? 'left' : 'right']: '50%',
      },
    }),
  ]);

  return el('div', { class: `rollcard ${cls}`.trim() }, [
    el('div', { class: 'dieline', text: r.formatted ?? '' }),
    bar,
    breakdown ? el('div', { class: 'breakdown', text: breakdown }) : null,
    r.text ? el('div', { class: 'breakdown', text: r.text }) : null,
  ]);
}

class App {
  constructor(root) {
    this.root = root;
    this.settings = loadSettings();
    this.game = null;
    this.screen = 'bridge';
    this.selectedSystemId = null;
    this.modalHandle = null;
    this.tactical = null;
    this.map = null;
    this.needsRender = true;
    this.lastAutosave = 0;

    this.buildShell();
    this.applySettings();
    this.wireEvents();
    trackViewportInsets();
  }

  // ------------------------------------------------------------ shell

  buildShell() {
    clear(this.root);

    this.shipNameEl = el('span', { class: 'shipname', text: 'Starfleet' });
    this.stardateEl = el('span', { class: 'stardate', text: '' });
    this.root.append(el('div', { class: 'topbar' }, [
      el('div', { class: 'cap' }),
      el('div', { class: 'title' }, [this.shipNameEl, this.stardateEl]),
    ]));

    this.root.append(el('div', { class: 'alertbar' }));

    this.screenEl = el('div', { class: 'screen' });
    this.root.append(this.screenEl);

    // Order line — typed orders, parsed by ui/orders.js.
    this.orderInput = el('input', {
      type: 'text', placeholder: 'Give an order…',
      autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      onkeydown: (e) => { if (e.key === 'Enter') this.submitOrder(); },
    });
    this.orderBar = el('div', { class: 'orderbar' }, [
      // The parser accepts hundreds of phrasings and the game had no way to
      // say so. This is that way: one tap from wherever you are stuck.
      //
      // It sits to the LEFT of the input on purpose. Putting it between the
      // input and Order left it under the thumb that reaches for Order — and
      // made `.orderbar button` ambiguous, which the browser harness noticed
      // by typing an order and watching the manual open instead.
      el('button', {
        class: 'manual', text: '?', title: 'What can I say?', 'aria-label': 'Command reference',
        onclick: () => { audio.play('ui_tap'); haptic('tap'); this.go('reference'); },
      }),
      this.orderInput,
      el('button', { class: 'send', text: 'Order', onclick: () => this.submitOrder() }),
    ]);
    this.root.append(this.orderBar);

    this.navEl = el('div', { class: 'nav' });
    this.root.append(this.navEl);
    this.buildNav();
  }

  buildNav() {
    clear(this.navEl);
    // A contact waiting on the bridge is flagged, so stepping away to check
    // the map never loses track of the thing that needs an answer.
    const pending = this.game?.mode === MODES.ENCOUNTER;
    for (const item of NAV) {
      this.navEl.append(el('button', {
        class: this.screen === item.id ? 'active' : '',
        onclick: () => { audio.play('ui_select'); haptic('select'); this.go(item.id); },
      }, [
        el('div', { class: 'ico', text: item.ico }),
        el('div', { text: item.label }),
        item.id === 'bridge' && pending && this.screen !== 'bridge'
          ? el('div', { class: 'badge', text: '!' })
          : null,
      ]));
    }
    this.navEl.append(el('button', {
      class: this.screen === 'options' ? 'active' : '',
      onclick: () => { audio.play('ui_select'); haptic('select'); this.go('options'); },
    }, [el('div', { class: 'ico', text: '⚙' }), el('div', { text: 'Setup' })]));
  }

  applySettings() {
    const s = this.settings;
    // The interface has an era, and the game already knows which one. This is
    // the seam the stylesheet reads: TOS gets 1966 consoles, TNG/DS9/VOY get
    // LCARS, which is what those eras actually had.
    document.documentElement.dataset.era = this.game?.era ?? s.era ?? 'tos';
    document.documentElement.dataset.text = s.textSize ?? 'normal';
    document.documentElement.dataset.motion = s.reduceMotion ? 'reduced' : 'normal';
    // Reduced motion stops the deck moving and leaves the flash doing the work:
    // the hit is still visible, it just does not throw the camera about.
    if (this.fpv) this.fpv.shake = !s.reduceMotion;
    configureTouch({ haptics: s.haptics, wakeLock: s.wakeLock });
    audio.voiceEnabled = s.voice;
    for (const key of ['master', 'sfx', 'ui', 'alert', 'ambience']) {
      audio.setVolume(key, s[key] ?? 1);
    }
    // After the volumes, so muting wins over whatever they just restored.
    audio.setEnabled(!s.muted);
    if (s.wakeLock) requestWakeLock(); else releaseWakeLock();
    this.saveSettings();
  }

  saveSettings() { persistSettings(this.settings); }

  /**
   * Give the tactical display a canvas that has never been spoken to.
   *
   * A canvas can only ever have ONE context type. Once `getContext('webgl')`
   * has succeeded on a node, `getContext('2d')` returns null on that node for
   * as long as it exists — and `#tactical` is deliberately a singleton, kept
   * and moved between screens because GL contexts are expensive and browsers
   * cap how many may exist at once.
   *
   * So the flat plot could never have been switched TO at runtime. It worked
   * only when it was chosen first, before GL had touched the canvas, which is
   * the one case the old dead `render3d` flag could not produce. Turning the
   * setting on for real means the mode change has to bring its own canvas.
   */
  replaceTacticalCanvas() {
    const host = this.tacticalHost;
    const old = this.tacticalCanvas;
    if (!host || !old) return;

    this.fpv?.dispose?.();
    this.fpv = null;
    this.fpvCanvas = null;
    this.tactical?.dispose?.();
    this.tactical = null;
    this.tacticalViewCanvas = null;
    // The GL context belongs to the node being thrown away. Let it go, or the
    // browser holds it against the cap for nothing.
    this.renderer?.dispose?.();
    this.renderer = null;
    this.rendererCanvas = null;

    const fresh = el('canvas', { id: 'tactical' });
    old.replaceWith(fresh);
    this.tacticalCanvas = fresh;
    // Label overlays are created by the 3D view against the old canvas. Any
    // that outlived their view would paint over the new one.
    for (const stale of host.querySelectorAll('canvas.tactical-labels')) stale.remove();
  }

  // ------------------------------------------------------------ events

  wireEvents() {
    // Somebody reported. Turn them round to say it — the event has carried the
    // station since the day it was written and nothing had ever listened.
    on('officer:speak', ({ station }) => { this.fpv?.speak(station); });

    on('alert', (level) => {
      document.documentElement.dataset.alert = level;
      audio.setAlertLevel(level === 'red' ? 'red' : level === 'yellow' ? 'yellow' : 'normal');
      if (level === 'red') { audio.play('red_alert'); haptic('alert'); }
      else if (level === 'yellow') audio.play('yellow_alert');
      else audio.play('alert_clear');
      this.needsRender = true;
    });

    // A fight does NOT take the screen. You stay where you are — on the
    // bridge, in the chair, with the enemy on the main viewer — and the
    // tactical plot stays a console you walk to when you want to read the
    // fight rather than watch it.
    //
    // This listener said `this.go('tactical')`, which is the exact behaviour
    // the comment in `render()` thirty lines below says the whole restructure
    // exists to stop: "being teleported to a plot view the moment somebody
    // decloaks". The render-time override was removed and the listener that
    // did the same thing was left behind, so every fight still yanked the
    // player off the bridge — which is also why nobody noticed the main viewer
    // had been black since the day it was written. You were never looking at
    // it while anything was happening.
    on('combat:begin', () => { this.needsRender = true; });
    // Presentation only. The game settles the fight itself on its own tick —
    // see the COMBAT case in Game.update — and says so with `combat:resolved`.
    // This listener used to be the thing that awarded the experience and took
    // the salvage, which meant the rules of the game lived in the UI.
    on('combat:resolved', ({ outcome }) => { this.showCombatResult(outcome); });

    on('combat:fire', ({ attacker, weapon, type }) => {
      if (type === 'torpedo') audio.play('torpedo_launch', { throttle: 120 });
      else if (attacker.faction === 'federation') {
        // A capital ship's main battery is not a light phaser bank.
        audio.play(weapon?.damage >= 250 ? 'phaser_heavy' : 'phaser', { throttle: 110 });
      }
      else audio.play('disruptor', { throttle: 110 });
    });

    on('combat:torpedo-impact', () => audio.play('torpedo_impact', { throttle: 90 }));

    // The countdown to losing the ship. There is one way out — eject the core —
    // and the warning tone existed in sfx.js and was played from nowhere.
    // Two cues that existed and were played by nothing.
    //
    // `sfx.js` has synthesised `cloak` and `decloak` since it was written, and
    // the cloak ORDER played `power_reroute` — the generic power hum — while a
    // captain who had spent 130 Tokens of Regard on a cloaking device got the
    // same sound as trimming the grid. Hostiles cloak far more often than the
    // player ever will and made no sound at all.
    //
    // Throttled, because a wing decloaking together is one event to the ear.
    on('ship:cloak', () => audio.play('cloak', { throttle: 200 }));
    on('ship:decloak', () => audio.play('decloak', { throttle: 200 }));

    on('ship:breach', ({ ship, seconds }) => {
      if (!ship.isPlayer) return;
      audio.play('core_breach_warning');
      haptic('alert');
      this.game?.pushLog(
        `Warp core breach in ${Math.round(seconds)} seconds. Eject the core or we lose her.`,
        'engineering',
      );
      this.needsRender = true;
    });

    // Somebody is aboard. The cue was synthesised, routed to the alert bus and
    // reserved for a mechanic the game did not have; this is where it finally
    // gets played, and the captain is told in the same breath which order
    // answers it.
    on('ship:boarded', ({ ship, count, from }) => {
      if (!ship.isPlayer) return;
      audio.play('intruder_alert');
      haptic('alert');
      this.game?.setAlert('red');
      this.game?.officerSays('security',
        `Intruder alert. ${count} of them, beamed aboard from ${from?.name ?? 'the hostile'}. `
        + 'Say the word and I will turn out the guard.',
        'report');
      this.needsRender = true;
    });

    on('ship:boarders-repelled', ({ ship }) => {
      if (!ship.isPlayer) return;
      audio.play('computer_ack');
      this.game?.officerSays('security', 'Decks are clear, Captain. They are off my ship.', 'report');
      this.needsRender = true;
    });

    on('combat:player-hit', ({ severity, penetrated }) => {
      // Seen as well as heard. The viewer is the whole interface now, so
      // something arriving on the hull cannot be a sound effect alone.
      this.fpv?.hit(severity, penetrated);
      if (penetrated) {
        audio.play('hull_impact', { severity, throttle: 110 });
        haptic(severity > 0.5 ? 'hit_heavy' : 'hit_light');
        if (severity > 0.7) audio.play('console_explode', { throttle: 900 });
        // Structural stress, once the hull is genuinely in trouble. Sparingly
        // throttled — it is a groan, not a soundtrack.
        if (this.game && this.game.ship.hullPct < 0.4) {
          audio.play('hull_groan', { throttle: 4000 });
        }
      } else {
        audio.play('shield_impact', { severity, throttle: 110 });
        haptic('hit_light');
      }
    });

    on('combat:destroyed', ({ ship }) => {
      audio.play('explosion');
      if (ship === this.game?.ship) haptic('explosion');
    });

    on('officer:killed', ({ officer }) => {
      this.game?.pushLog(`${officer.rank} ${officer.name} was killed.`, 'medical');
      haptic('deny');
    });

    on('captain:promoted', (promo) => {
      // The level, the feat and the recomputed modifiers are `Game.awardXP`'s
      // job now. They used to be this listener's, which meant a promotion
      // earned with no screen attached moved the rank index and did nothing
      // else at all.
      audio.play('promotion');
      audio.play('boatswain');
      haptic('confirm');
      const g = this.game;
      this.showMessage('Promotion', [
        `You are promoted to ${promo.rank.name}.`,
        `${promo.points} skill points awarded, and a feat to choose on the Captain screen.`,
        `Character level ${g?.character.level ?? 1}. Proficiency is now ${g ? `+${g.character.proficiencyBonus}` : ''}.`,
      ]);
    });

    // Reputation tier-ups are a real unlock, so they are announced.
    on('reputation:tier', (up) => {
      audio.play('promotion');
      haptic('confirm');
      this.showMessage('Reputation', [
        `Your standing with them has advanced to ${up.name}.`,
        'New projects are available on the Reputation screen.',
      ]);
    });

    // Every d20 roll is captured so the player can audit the arithmetic.
    on('away:check', (result) => {
      this.recentRolls ??= [];
      this.recentRolls.push(result);
      if (this.recentRolls.length > 60) this.recentRolls.shift();
      if (result.criticalSuccess) { audio.play('ui_confirm'); haptic('confirm'); }
      else if (result.criticalFailure) { audio.play('ui_deny'); haptic('deny'); }
      else audio.play('ui_tap');
    });

    on('ledger:inquiry', ({ reason } = {}) => {
      this.game?.ledger.setFlag('inquiry_summoned');
      // The venue was hardcoded to Starbase 11 — the one from the episode —
      // and the board sat nowhere at all, so this was an order to a place the
      // game had no business with and a promise nothing kept. Now it names the
      // base the captain is actually nearest, and the board really is waiting
      // there.
      const venue = venueFor(this.game)?.name ?? 'the nearest starbase';
      this.showMessage('Signal from Starfleet Command', [
        `You are ordered to ${venue} to appear before a board of inquiry into `
        + `${reason ?? 'your command record'}.`,
        'Promotion is suspended until the board reports.',
      ]);
    });

    on('transit:begin', () => { this.go('bridge'); });
    on('arrived', () => { audio.play('warp_drop'); audio.setAlertLevel('normal'); this.needsRender = true; });
    // A hail brings you to the CHAIR, not to a separate screen. The encounter's
    // panel appears in the bridge's own strip, and the Bridge tab carries a
    // badge if you happen to be reading the roster when it comes in.
    on('encounter:begin', () => { this.go('bridge'); haptic('select'); });
    // To the BRIDGE, not to a mission screen. The stage is a panel there now,
    // the same way a hail and a transit are — an episode is something that
    // happens around you rather than a place you are sent.
    on('mission:start', () => { this.go('bridge'); });
    on('mission:stage', () => { this.needsRender = true; });
    on('game:over', () => { this.go('gameover'); });
    on('log', () => { this.needsRender = true; });

    // Unlock audio on any touch — mobile policy requires a gesture to start,
    // and the listener deliberately does NOT remove itself.
    //
    // It used to. That was the whole bug behind "the sound effects are too
    // quiet": a phone suspends the AudioContext when the app goes to the
    // background, `unlock()` is the only thing that resumes it, and after the
    // first tap nothing could call it again. The game went permanently silent
    // the first time you looked at something else, with no way back but a
    // reload.
    const unlock = () => audio.unlock();
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock);

    globalThis.addEventListener('beforeunload', () => { if (this.game) this.save(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { if (this.game) this.save(); return; }
      // Back in the foreground. The audio context was very likely suspended
      // while we were away, and this is the only thing that brings it back —
      // before the game check, because a silent menu is still silent.
      audio.unlock();
      if (!this.game) return;
      // The ship has been working the whole time we were gone.
      this.resumeCommission();
    });
  }

  // ------------------------------------------------------------ navigation

  go(screen) {
    this.screen = screen;
    // The tactical view is deliberately NOT dropped here. Its canvas lives in a
    // persistent host that survives the DOM swap, so the view stays valid — and
    // nulling it leaked a WebGL context and inserted a second overlay canvas on
    // every visit, with the stale overlays painting over the live one. The
    // `tacticalViewCanvas` guard in render() rebuilds it if the host really is
    // replaced, and disposes the old one first.
    this.map = null;
    this.buildNav();
    this.render();
  }

  /**
   * The one WebGL context, made once and lent to whichever view is on screen.
   *
   * There is exactly one GL canvas in this application and three views that
   * draw through it — the tactical plot, the main viewer and the first-person
   * bridge. Each making its own renderer is how you get two contexts on one
   * element, which browsers cap and then silently drop the oldest of; the
   * display goes black and nothing says why. So the App owns it.
   */
  sharedRenderer() {
    if (!this.tacticalCanvas) return null;
    if (this.renderer && this.rendererCanvas === this.tacticalCanvas && !this.renderer.lost) {
      return this.renderer;
    }
    this.renderer?.dispose?.();
    this.renderer = Renderer.create(this.tacticalCanvas);
    this.rendererCanvas = this.tacticalCanvas;
    return this.renderer;
  }

  /** Release the GL context and overlay canvas. For teardown, not navigation. */
  disposeTacticalView() {
    this.tactical?.dispose?.();
    this.tactical = null;
    this.tacticalViewCanvas = null;
  }

  render() {
    if (!this.game) return;
    const g = this.game;

    // The era drives the whole interface, and it is only known once a game
    // exists — applySettings() runs before that, on the menu.
    if (document.documentElement.dataset.era !== g.era) {
      document.documentElement.dataset.era = g.era ?? 'tos';
    }

    this.shipNameEl.textContent = `${g.ship.name} ${g.ship.registry}`;
    this.stardateEl.textContent = `SD ${g.stardate}`;

    // The room decides what the ship sounds like. Driven from render rather
    // than from an event because there is no single place the captain's
    // location changes — a walk finishes on a tick, a turbolift on a tap, a
    // transporter on an order — and `setRoom` is a no-op when nothing moved.
    const here = g.walk?.room;
    if (here) {
      audio.setRoom(here.id, {
        outdoors: here.surface === true,
        airless: here.surface === true && here.kind === 'moon',
      });
    }

    // Combat and missions take the screen outright — you do not get to browse
    // the crew roster mid-broadside. An encounter or a transit only replaces
    // the bridge, so the map, ship, and record stay reachable while you decide.
    let screen = this.screen;
    if (g.over) screen = 'gameover';
    // Combat no longer takes the screen AT ALL. You are on the bridge and they
    // are on the viewer, which is where a fight is supposed to happen — being
    // teleported to a plot view the moment somebody decloaks is the thing this
    // restructure exists to stop.
    //
    // Nor does it forbid the plot: the tactical console is a station on the
    // bridge you can walk to. Redirecting *away* from it during a fight was the
    // same mistake in the other direction, and it left the tactical view never
    // built and the renderer reporting a mode it was not in.
    // MODES.MISSION no longer takes over the screen. The stage hangs on the
    // bridge; overriding here is what used to dispose the first-person view
    // mid-episode and leave a frozen photograph of a room nobody was drawing.
    // An ENCOUNTER and a TRANSIT no longer replace the bridge either. A ship
    // hailing you is something you see on the viewer and answer from the chair,
    // and being at warp is something you are doing while sitting in it — both
    // used to swap the whole screen out, which disposed the first-person view
    // and left the canvas showing a frozen frame of a bridge nobody was in.
    // Their panels appear in the bridge's own strip instead.
    //
    // A MISSION does not take the screen either, whatever this used to say. It
    // hangs on the bridge's side strip like the rest — `missionPanel`, appended
    // by `bridgeScreen` whenever an episode is active. The full-screen
    // `missionScreen` below is reachable only by asking for it by name.

    const old = this.screenEl;

    // Scroll positions have to survive the swap below.
    //
    // `replaceWith` throws the old DOM away, and in combat `render` runs about
    // four times a second — so a captain who scrolled down to the bridge
    // officer tray, which lives under the plot and the target panel, was
    // thrown back to the top of the page before they could reach one. On a
    // phone that made the whole tray unusable in the one situation it exists
    // for. Carried across only when the same screen is being redrawn: moving
    // to a different screen should start at the top, and does.
    const sameScreen = screen === this.renderedScreen;
    const heldScroll = sameScreen
      ? [old, ...old.querySelectorAll('.scroll')].map((n) => n.scrollTop)
      : null;

    let node;
    switch (screen) {
      case 'tactical': node = screens.tacticalScreen(this); break;
      case 'chair': node = el('div', { class: 'screen' }, [screens.chairConsole(this)]); break;
      case 'viewscreen': node = screens.viewscreenScreen(this); break;
      case 'galaxy': node = screens.galaxyScreen(this); break;
      case 'crew': node = el('div', { class: 'screen' }, [screens.crewScreen(this)]); break;
      case 'sheet': node = el('div', { class: 'screen' }, [characterSheetScreen(this)]); break;
      case 'reputation': node = el('div', { class: 'screen' }, [reputationScreen(this)]); break;
      case 'captain': node = el('div', { class: 'screen' }, [screens.captainScreen(this)]); break;
      case 'ship': node = el('div', { class: 'screen' }, [screens.shipScreen(this)]); break;
      case 'options': node = el('div', { class: 'screen' }, [screens.optionsScreen(this)]); break;
      case 'encounter': node = el('div', { class: 'screen' }, [screens.encounterScreen(this)]); break;
      case 'mission': node = el('div', { class: 'screen' }, [screens.missionScreen(this)]); break;
      case 'transit': node = el('div', { class: 'screen' }, [screens.transitScreen(this)]); break;
      case 'gameover': node = el('div', { class: 'screen' }, [screens.gameOverScreen(this)]); break;
      case 'log': node = el('div', { class: 'screen' }, [screens.logScreen(this)]); break;
      case 'reference': node = el('div', { class: 'screen' }, [screens.referenceScreen(this)]); break;
      case 'bridge':
      default: node = el('div', { class: 'screen' }, [screens.bridgeScreen(this)]); break;
    }

    old.replaceWith(node);
    this.screenEl = node;
    this.renderedScreen = screen;
    if (heldScroll) {
      const now = [node, ...node.querySelectorAll('.scroll')];
      for (let i = 0; i < now.length && i < heldScroll.length; i++) {
        if (heldScroll[i] > 0) now[i].scrollTop = heldScroll[i];
      }
    }

    // The first-person bridge shares the one GL canvas with the tactical plot.
    // Two contexts on one element is a bug this project has already fixed, and
    // browsers cap how many can live at once — so the renderer is created once
    // and the two views take turns owning it.
    if (screen === 'bridge' && this.tacticalCanvas) {
      if (!this.fpv || this.fpvCanvas !== this.tacticalCanvas) {
        this.disposeTacticalView();
        this.fpv?.dispose?.();
        const renderer = this.sharedRenderer();
        this.fpv = renderer ? new FirstPersonView(this.tacticalCanvas, renderer) : null;
        this.fpvCanvas = this.tacticalCanvas;
        if (this.fpv) {
          this.fpv.onLook = (dYaw, dPitch) => {
            g.walk.yaw += dYaw;
            this.fpv.look(0, dPitch);
          };
          this.fpv.onUse = () => this.useWhatIsInFront();
          // The view is rebuilt whenever the canvas is, so the setting has to
          // be applied here as well as when it is changed.
          this.fpv.shake = !this.settings.reduceMotion;
        }
      }
    } else if (this.fpv) {
      this.fpv.dispose();
      this.fpv = null;
      this.fpvCanvas = null;
    }

    // Canvas-backed screens need their renderers rebuilt after a DOM swap.
    if ((screen === 'tactical' || screen === 'viewscreen') && this.tacticalCanvas) {
      // Three dimensions when the device can, two when it cannot. The 2D view
      // is not a stub — it is the display this game shipped with, and it stays
      // complete, because "no WebGL" must mean a different picture and not a
      // broken game.
      // The third clause is what makes the setting a setting. The rebuild used
      // to fire only on a new canvas, so flipping the flag changed nothing
      // until something else happened to swap the DOM — a control that works
      // eventually is worse than one that does not work at all, because you
      // cannot tell which you have.
      //
      // It compares against what was ASKED for and not against `renderMode`,
      // which is what was achieved. On a device with no WebGL those differ
      // permanently: the request is 3D, the result is 2D, and comparing the
      // two would rebuild the view and retry the context on every single
      // render — a rebuild loop on exactly the hardware least able to afford
      // one.
      const want3d = this.settings.render3d !== false;
      if (this.tactical && this.renderWanted !== undefined && want3d !== this.renderWanted) {
        this.replaceTacticalCanvas();
      }
      if (!this.tactical
        || this.tacticalViewCanvas !== this.tacticalCanvas
        || want3d !== this.renderWanted) {
        this.renderWanted = want3d;
        this.tactical?.dispose?.();
        this.tactical = (want3d
          ? TacticalView3D.create(this.tacticalCanvas, this.sharedRenderer())
          : null)
          ?? new TacticalView(this.tacticalCanvas);
        this.tacticalViewCanvas = this.tacticalCanvas;
        this.renderMode = this.tactical instanceof TacticalView3D ? '3d' : '2d';
        this.tactical.onSelect = (ship) => {
          g.engagement?.setTarget(ship);
          audio.play('ui_select');
          this.render();
        };
      }
      // The camera follows the screen you are on: the plot orbits, the viewer
      // looks out. Same renderer, same context — one call, not one more canvas.
      this.tactical.setCameraMode?.(screen === 'viewscreen' ? 'forward' : 'orbit');
      // The sky belongs to the system, not to the screen. Setting it here means
      // a fight at Rigel happens against Rigel's worlds whether or not you
      // happened to open the viewer first.
      this.tactical.setVista?.(g.location?.id, g.location?.type);
    }
    if (screen === 'galaxy' && this.galaxyCanvas) {
      // The screen rebuilds its canvas, so the map object has to be rebuilt
      // with it — but how the captain was LOOKING at the chart is not part of
      // the screen. It used to be: every render made a fresh map at the
      // default zoom, re-centred on the selection, so any pan, any zoom and
      // (once the chart gained a third axis) any tilt was thrown away by the
      // next thing that happened to mark the UI dirty.
      // Snapshot the outgoing map's view before it is replaced. `view` is the
      // live object the pan/zoom gestures write into, so this is wherever the
      // captain had actually got to.
      const was = this.map
        ? { view: { ...this.map.view }, tilt: this.map.tilt, spin: this.map.spin }
        : this.mapView;
      this.map = new GalaxyMap(this.galaxyCanvas);
      this.map.selectedId = this.selectedSystemId ?? g.locationId;
      this.map.game = g;
      if (was) {
        Object.assign(this.map.view, was.view);
        this.map.setTilt(was.tilt ?? 0);
        this.map.setSpin(was.spin ?? 0);
      } else {
        this.map.focus(this.selectedSystemId ?? g.locationId);
      }
      // Kept on the app as well, so leaving the chart and coming back to it
      // returns to the same view rather than snapping home.
      this.mapView = was ?? { view: { ...this.map.view }, tilt: 0, spin: 0 };
      this.map.onSelect = (sys) => {
        this.selectedSystemId = sys.id;
        audio.play('ui_tap');
        haptic('tap');
        this.renderSystemDetail(sys);
      };
    }

    // A console showing state that has just changed has to be redrawn with it —
    // but ONLY then.
    //
    // Rebuilding it on every render made the modal a new set of DOM nodes
    // several times a second, and in combat, where the screen refreshes
    // continuously, that meant every control on an open console detached from
    // under the finger before the tap landed. A console you cannot press is
    // worse than one showing a stale number.
    if (this.consoleOpen && this.consoleDirty && !this._refreshingConsole) {
      this.consoleDirty = false;
      this._refreshingConsole = true;
      try { this.openConsole(this.consoleOpen.key, this.consoleOpen.station); }
      finally { this._refreshingConsole = false; }
    }

    this.orderBar.style.display = (screen === 'gameover' || screen === 'options') ? 'none' : '';
    this.needsRender = false;
  }

  /**
   * Operate whatever the captain is standing at.
   *
   * This is the whole "walk to a console" interaction. A station opens the
   * panel that already exists for that department — the power grid, the weapons
   * console, the galaxy map — as a console rather than as a tab, because the
   * panel was never the problem. Being able to reach it from anywhere was.
   */
  useWhatIsInFront() {
    const g = this.game;
    if (!g) return;
    const w = g.walk;

    if (w.atStation) {
      const key = STATION_PANEL[w.atStation.panel] ?? w.atStation.panel;
      if (!key) {
        // Four stations open no panel — environmental, gravity and the
        // security board on the bridge, and the CMO's desk in sickbay — and
        // they are not places you give orders from. They are places you ASK
        // something, and the answer is a page of readings the ship already
        // has. See src/sim/consoles.js.
        //
        // What was here before said "That station is not mine to work,
        // Captain", spoken by the officer standing at it — which is the one
        // person it certainly is.
        const report = stationReport(g, w.atStation.id);
        if (report) {
          audio.play('computer_query');
          haptic('tap');
          this.showMessage(report.title, report.lines);
          return;
        }
        audio.play('ui_deny');
        g.officerSays(w.atStation.crew ?? 'ops', 'There is nothing on this board for you, Captain.', 'object');
        this.render();
        return;
      }
      audio.play('computer_query');
      haptic('tap');
      this.openConsole(key, w.atStation);
      return;
    }

    if (w.atExit) {
      // `g.useExitAhead`, not `w.useExit`. Going round the game into the
      // walker meant the door was the one way off a deck that asked nothing:
      // not whether we are under fire, and not who has the con.
      // Asked before the lift's own question, so a captain under fire is told
      // no rather than offered a list of decks that will each refuse him.
      const may = g.mayWalk();
      if (!may.ok) {
        audio.play('ui_deny');
        g.pushLog(may.reason, 'computer');
        this.render();
        return;
      }
      const r = w.room.lift ? { ok: false, needsDestination: true } : g.useExitAhead();
      if (r.ok) { audio.play('door'); haptic('confirm'); this.render(); return; }
      // A lift needs a deck. Offer the stops rather than guessing one.
      // The lift asks "which deck" and then offered eight buttons with no deck
      // on them. `deckOf` puts the number back, renumbered onto this hull.
      this.showMessage('Turbolift', ['Which deck, Captain?'],
        w.liftStops().map((e) => button(e.label ?? e.to, () => {
          this.closeModal();
          const ride = g.useExitAhead(e.to);
          audio.play(ride.ok ? 'door' : 'ui_deny');
          if (!ride.ok && ride.reason) g.pushLog(ride.reason, 'computer');
          this.render();
        }, { color: 'blue', sub: `Deck ${g.deckOf(e.to) ?? e.deck}` })));
      return;
    }

    audio.play('ui_deny');
  }

  /** Open a station's console as a modal over the bridge. */
  openConsole(key, station) {
    const g = this.game;
    // Remembered so the console can be rebuilt when the state it shows changes.
    // Without this, throwing a warp switch set the factor and left the switch
    // drawn in its old position — the order worked and the console lied.
    //
    // Only for the consoles that actually open one. Half the keys below are
    // navigation: they change screen and return without a modal, and marking
    // those as an open console left `consoleOpen` set with nothing to rebuild
    // — so the next time anything marked the console dirty, the refresh in
    // `render` called back in here and navigated the player to that screen
    // again. Every order given after using Weapons Control teleported you to
    // the tactical plot.
    const body = [];
    switch (key) {
      case 'galaxy': this.consoleOpen = null; this.go('galaxy'); return;
      case 'tactical': this.consoleOpen = null; this.go('tactical'); return;
      case 'log': this.consoleOpen = null; this.go('log'); return;
      case 'captain': this.consoleOpen = null; this.go('captain'); return;
      case 'crew': this.consoleOpen = null; this.go('crew'); return;
      case 'ship': this.consoleOpen = null; this.go('ship'); return;
      case 'chair': this.consoleOpen = null; this.go('chair'); return;
      case 'power': body.push(screens.powerPanel(this)); break;
      case 'shop': body.push(screens.machineShopPanel(this)); break;
      // The briefing room. Its station has always declared this key and
      // nothing has ever answered to it, so the screen said "Working,
      // Captain." and a captain read his standing orders anywhere but the
      // room the ship keeps for reading them.
      case 'missions': body.push(screens.briefingPanel(this)); break;
      case 'comms':
        // Hailing is an ORDER, not a console read-out: it goes through the same
        // dispatch a typed "open a channel" does, so there is one path.
        this.consoleOpen = null;
        this.executeOrder({ action: 'hail' }, 'hailing frequencies open');
        return;
      case 'science': {
        body.push(el('p', { text: 'Sensor sweep of the system.' }));
        for (const line of this.scanSystem()) body.push(el('p', { class: 'muted', text: String(line) }));
        break;
      }
      case 'helm':
        // The eight warp flip switches live on the helm console, because that
        // is where they were on the prop. The chair shows them too — the chair
        // is where the order is given from — but this is where they are.
        body.push(warpSwitches(this));
        body.push(el('p', { class: 'hint', text: 'Throw a switch to set the standing warp factor. Every course is plotted at it.' }));
        break;
      case 'transport': {
        // The one console that puts you somewhere else. It refuses for reasons
        // rather than being absent, because "why can I not beam down" is a
        // question the room should answer standing in it.
        const g2 = this.game;
        const world = g2.orbitLabel;
        body.push(el('p', {
          text: world
            ? `Transporter ready. ${world} is below us.`
            : 'Transporter ready. The ship is not in orbit of anything.',
        }));
        if (g2.ashore) {
          body.push(button('Energise — beam up', () => {
            this.closeModal();
            this.executeOrder({ action: 'transport' }, 'energize');
          }, { color: 'blue', say: 'energise' }));
        } else {
          body.push(button('Energise — beam down', () => {
            this.closeModal();
            this.executeOrder({ action: 'beam_down' }, 'beam down');
          }, { color: world ? 'blue' : 'ghost', say: 'two to beam down' }));
          if (!world) {
            body.push(el('p', { class: 'hint', text: 'Make standard orbit first, and there will be somewhere to go.' }));
          }
        }
        break;
      }
      case 'survey': {
        // Not a console. This is the away team going over something, so it
        // shows the same auditable card every other check in the game shows —
        // the margin, and every term that produced it.
        const g3 = this.game;
        const r = g3.surveyFeature(station?.id);
        if (!r.ok) {
          body.push(el('p', { class: 'muted', text: r.error }));
          audio.play(r.done ? 'ui_back' : 'ui_deny');
          break;
        }
        const { feature, result } = r;
        audio.play(result.success ? 'scan_complete' : 'ui_deny');
        haptic(result.success ? 'confirm' : 'hit_light');
        body.push(rollCard(result));
        body.push(el('p', { text: result.success ? feature.found : feature.failed }));
        if (result.success) {
          const got = Object.entries(feature.yield ?? {})
            .map(([m, n]) => `${n} ${m}`).join(', ');
          if (got) body.push(el('p', { class: 'hint', text: `Transported aboard: ${got}.` }));
        }
        for (const c of result.casualties ?? []) {
          body.push(el('p', { class: 'hint', text: String(c) }));
        }
        break;
      }
      // The lift control panel, which is the ONE station inside the turbolift
      // and the only reason the compartment has a console at all. It shared the
      // `default` branch and answered "Working, Captain." — and it passed the
      // audit in `tests/audit.test.js` for exactly that reason, because the
      // guard harvested `case` labels and a case label is not a panel. Same
      // failure as the sound-cue guard: a check satisfied by the shape of the
      // source rather than by what it does.
      case 'turbolift': {
        const stops = g.walk.liftStops();
        body.push(el('p', { class: 'muted', text: 'Turbolift control. Name a deck.' }));
        for (const e of stops) {
          body.push(button(e.label ?? e.to, () => {
            this.closeModal();
            const ride = g.useExitAhead(e.to);
            audio.play(ride.ok ? 'door' : 'ui_deny');
            if (!ride.ok && ride.reason) g.pushLog(ride.reason, 'computer');
            this.render();
          }, { color: 'blue', sub: g.deckLabel(e.to) ?? '' }));
        }
        break;
      }
      default:
        body.push(el('p', { class: 'muted', text: 'Working, Captain.' }));
        break;
    }
    // Set here rather than at the top: everything above that navigates has
    // already returned, so what is left is a console that is genuinely open.
    this.consoleOpen = { key, station };
    this.showConsole(station?.label ?? 'Console', body);
  }

  /**
   * A console, as a modal over the room you are standing in.
   *
   * Not `showMessage`: that takes LINES and stringifies whatever it is given,
   * so handing it a panel produced a dialog reading "[object HTMLDivElement]".
   * A console is nodes.
   */
  showConsole(title, nodes) {
    this.closeModal(true);
    this.consoleTitle = title;
    const body = (nodes.length ? nodes : [el('p', { text: 'Working, Captain.' })])
      .map((n) => (n instanceof globalThis.Node ? n : el('p', { text: String(n) })));
    this.modalHandle = this.raiseModal(title, body, [
      button('Step away', () => this.closeModal(), { color: 'ghost' }),
    ]);
  }

  renderSystemDetail(sys) {
    if (!this.galaxyDetail) return;
    clear(this.galaxyDetail);
    this.galaxyDetail.append(screens.systemDetail(this, sys));
  }

  // ------------------------------------------------------------ modals

  showMessage(title, lines, actions = null) {
    this.closeModal();
    // Anything that is a roll result is rendered as an auditable die card
    // rather than a sentence, so the arithmetic is always visible.
    const body = [].concat(lines).map((l) => (
      typeof l === 'object' && l?.natural !== undefined ? rollCard(l) : el('p', { text: String(l) })
    ));
    const dismiss = () => { audio.play('computer_ack'); this.closeModal(); };
    this.modalHandle = this.raiseModal(title, body,
      actions ?? [button('Acknowledged', dismiss, { color: 'blue', say: 'acknowledged' })]);
    // A report is not a question, but it blocks the screen exactly like one and
    // the only way past it was a tap. Either answer puts it away: there is
    // nothing here to agree or disagree with.
    if (!actions) this.pendingQuestion = { affirm: dismiss, belay: dismiss };
    audio.play('computer_query');
    return this.modalHandle;
  }

  /**
   * @param {boolean} keepConsole true when the modal is being replaced rather
   *        than dismissed — a console you are standing at must survive giving
   *        an order FROM it. Throwing a warp switch dispatches `warp_factor`,
   *        which closes modals on the way through, and that closed the very
   *        console the switch was on.
   */
  /**
   * Put a modal up, and take down whatever was already there.
   *
   * `modal()` appends to the document, so two calls leave two stacked
   * backdrops — and `closeModal` only ever knew about the last handle, so
   * dismissing the top one left the other one on screen with nothing able to
   * remove it. Two things can raise a modal in the same breath: a boarding
   * party's report and the end of the battle that party just decided.
   *
   * One at a time, newest wins. The one raised last is the one that answers
   * the order the captain actually gave.
   */
  raiseModal(title, body, actions = []) {
    this.modalHandle?.close();
    return modal(title, body, actions);
  }

  closeModal(keepConsole = false) {
    if (!keepConsole && !this._refreshingConsole) this.consoleOpen = null;
    this.modalHandle?.close();
    this.modalHandle = null;
    // Whatever was being asked is no longer being asked. Left set, the next
    // "make it so" would answer a question that is not on the screen.
    this.pendingQuestion = null;
  }

  /**
   * The parser has a reading it is not confident enough to act on. Show it,
   * offer the runners-up, and let the captain settle it in one tap.
   *
   * This is the honest half of "type anything and it works": the table cannot
   * cover every sentence in English, so what it does instead is never silently
   * do the wrong thing.
   */
  confirmReading(result, raw) {
    const alts = (result.alternatives ?? []).map((a) => button(a.help, () => {
      this.closeModal();
      // Re-parse the original line against the chosen intent's canonical form,
      // so entities the captain actually gave — a system, a facing — survive.
      const forced = parseOrder(`${a.help.replace(/<[^>]+>/g, '')} ${raw}`);
      this.executeOrder(forced.confirm ? forced.order : forced, raw);
    }, { color: 'ghost' }));

    const execute = () => {
      this.closeModal();
      this.executeOrder(result.order, raw);
    };
    const belay = () => {
      audio.play('ui_deny');
      this.closeModal();
    };

    this.modalHandle = this.raiseModal('Confirm order', [
      el('p', { class: 'muted', text: `You said: “${raw}”` }),
      el('p', { text: `I read that as: ${result.reading}` }),
      alts.length ? el('p', { class: 'muted', text: 'Or did you mean:' }) : null,
      ...alts,
    ].filter(Boolean), [
      button('Execute', execute, { color: 'blue', say: AFFIRM_PHRASE }),
      button('Belay that', belay, { color: 'ghost', say: BELAY_PHRASE }),
    ]);
    // The one moment the game stops and asks the captain a direct question used
    // to be the one moment the captain could not answer in words: every spoken
    // reply — "make it so", "yes", "execute", "do it", even the "belay that"
    // printed on the button — fell through to the parser and was swallowed, and
    // the only way out of the dialog was to touch the screen. See
    // docs/RESEARCH.md §26.
    this.pendingQuestion = { affirm: execute, belay };
    audio.play('computer_query');
    return this.modalHandle;
  }

  showOfficer(officer) {
    this.closeModal();
    this.modalHandle = this.raiseModal(officer.name,
      screens.officerDetail(this, officer),
      [button('Close', () => this.closeModal(), { color: 'ghost' })]);
  }

  openHail(factionId) {
    this.closeModal();
    this.modalHandle = this.raiseModal('Open Channel',
      screens.hailOptions(this, factionId, (optionId) => {
        const result = this.game.hail(optionId);
        this.closeModal();
        this.showMessage('Response', [result.text]);
        this.render();
      }),
      [button('Close the channel', () => this.closeModal(), { color: 'ghost' })]);
    audio.play('hail_incoming');
  }

  /**
   * Send a detail out.
   *
   * Picking who goes is the game's job, not a form to fill in: the best
   * suited people who are actually aboard, up to the size the work takes.
   * A captain says "send a survey detail" and the first officer decides which
   * hands to use, which is how it would actually happen — and the panel and
   * the order both come through here, so they cannot drift apart.
   */
  sendDetail(assignmentId) {
    const g = this.game;
    const assignment = ASSIGNMENTS[assignmentId];
    if (!assignment) {
      audio.play('ui_deny');
      g.officerSays('comms', 'Which detail, Captain?', 'object');
      return null;
    }

    // `bestTeamFor`, which is the same function the OUTCOME is graded with.
    // This used to be a second ranking written out here — speciality, then
    // division, then `expertise` — and `teamFitness` weighs a person as
    // `(expertise + discipline) / 2`. Two answers to one question, and the
    // captain was graded against the other one.
    const team = bestTeamFor(assignment, g.dutyRoster);

    const r = beginAssignment(g, assignmentId, team.map((p) => p.id));
    if (r.ok) { audio.play('computer_ack'); haptic('confirm'); }
    else { audio.play('ui_deny'); g.officerSays('comms', r.reason, 'object'); }
    return r;
  }

  showCombatResult(outcome) {
    const g = this.game;
    const lines = {
      victory: ['All hostile contacts destroyed.'],
      routed: ['They have broken off and gone to warp.'],
      escaped: g.transit
        ? [`We are clear and at warp, making for ${g.transit.to?.name ?? 'the nearest system'}.`]
        : ['We are clear of them. We are not going anywhere — holding station.'],
      destroyed: ['The ship is lost.'],
      // Talking your way out used to be the rarest ending in the game — it was
      // reachable only through the Kobayashi Maru, because every hail that
      // ended a real battle was recorded as a rout instead. Now that it is the
      // ordinary ending for a fight settled by talking, this line cannot go on
      // claiming nobody fired: most parleys are reached after shooting, and
      // "rescue operations may proceed" was written for the one scenario that
      // is about a rescue.
      parley: g.lastCombat?.shotsFired
        ? ['They are standing off. The shooting has stopped.']
        : ['They are standing off. Nobody fired a shot.'],
    }[outcome] ?? ['The engagement has ended.'];
    if (outcome !== 'destroyed') {
      // From the after-action record, which counts the dead of THIS fight.
      //
      // This used to be `maxCrew - crew`, which is the standing deficit for the
      // whole commission — the exact bug `finishCombat` was fixed for, left
      // behind in the panel the player actually reads. Eleven people lost in
      // the first engagement were reported again after every quiet battle for
      // the rest of the five years, next to a ledger entry that had it right.
      const lost = g.lastCombat?.crewLost ?? 0;
      if (lost > 0) lines.push(`${lost} crew did not survive it.`);
      // The hull as it was when the shooting stopped, which the record has
      // carried all along. Reading the LIVE hull put this fight's casualties
      // next to a number from some later moment — and after a ship is lost and
      // replaced, next to a different ship entirely.
      const hull = g.lastCombat?.hullLeft ?? g.ship.hullPct;
      lines.push(`Hull at ${Math.round(hull * 100)}%.`);
    }
    this.showMessage('Engagement Concluded', lines);
  }

  confirmNewGame(skipConfirm = false) {
    const start = () => { this.closeModal(); this.showNewGame(); };
    if (skipConfirm) return start();
    this.closeModal();
    this.modalHandle = this.raiseModal('Abandon Command', [
      el('p', { text: 'This ends the current commission. The record cannot be recovered unless you exported it.' }),
    ], [
      button('Abandon command', () => start(), { color: 'red' }),
      button('Cancel', () => this.closeModal(), { color: 'ghost' }),
    ]);
    return null;
  }

  // ------------------------------------------------------------ game actions

  scanSystem() {
    // What the sensors SEE is in Game.sensorSweep, so the order can be given
    // without a screen and the reading can depend on the ship — this used to
    // be a constant list of facts about the system that no state of the array
    // and no setting of the power grid could change. What is left here is the
    // noise it makes.
    const lines = this.game.sensorSweep();
    audio.play('scan_complete');
    return lines;
  }

  useAbility(officer, ability) {
    // What the power DOES is in src/sim/powers.js, so it can be fired without
    // a screen. What is left here is what it sounds like.
    const r = this.game.useAbility(officer, ability);
    if (!r.ok) { audio.play('ui_deny'); return; }
    if (this.settings.voice) audio.speak(r.line);
    if (r.report) this.showMessage(r.report.title, r.report.lines);
    if (r.ability?.special === 'eject') audio.play('explosion');
    if (r.ability?.special === 'detect_cloak') audio.play('scan');
    if (r.ability?.special === 'spread') audio.play('torpedo_launch');
    haptic('confirm');
  }

  /**
   * Career signature powers: one big effect, once per engagement.
   *
   * Each reuses machinery that already exists — buffs, repair, cooldowns —
   * rather than inventing a parallel system. All seven are in
   * src/sim/powers.js; this is the announcement.
   */
  useSignature() {
    const r = this.game.useSignature();
    if (!r.ok) { audio.play('ui_deny'); return false; }

    if (this.settings.voice) audio.speak(r.line);
    audio.play('ui_confirm');
    audio.play('computer_ack');
    haptic('confirm');
    // A power whose whole result is a screen of its own shows that instead of
    // a dialog it would only have to close again. The line is in the log
    // either way — and the channel is opened AFTER the announcement, because
    // `showMessage` replaces whatever modal is up, so opening it first meant
    // the confirmation closed the channel the power had just forced open.
    if (r.openHail !== null && r.openHail !== undefined) this.openHail(r.openHail);
    else this.showMessage(r.career.signature, [r.line]);
    this.render();
    return true;
  }

  useDevice(id) {
    const r = this.game.useDevice(id);
    if (!r.ok) {
      // A buzz and nothing else. Every other refusal in the game says why —
      // this one made a device that declined to be wasted look broken.
      audio.play('ui_deny');
      // Through the officer who would actually say it, the same way a refused
      // order is answered. `ack` in executeOrder is a closure, not a method.
      this.game.officerSays('engineering', r.reason ?? 'That one is spent, Captain.');
      this.needsRender = true;
      return;
    }
    audio.play('power_reroute');
    haptic('confirm');
  }

  resolveEncounter(choiceId) {
    if (choiceId === 'hail') {
      this.openHail(this.game.encounter?.factionId);
      return;
    }
    const result = this.game.resolveEncounter(choiceId);
    if (result.messages?.length) this.showMessage('Report', result.messages);
    this.render();
  }

  startMission(id) {
    this.game.startMission(id);
    this.render();
  }

  /** More than one set of orders on the boards: let the captain say which. */
  chooseStandingOrders(offered) {
    audio.play('ui_select');
    this.modalHandle = this.raiseModal('Standing Orders', [
      el('p', { class: 'muted', text: 'More than one assignment is on the boards here, Captain.' }),
      ...offered.map((m) => button(m.title, () => {
        this.closeModal();
        this.startMission(m.id);
      }, { say: 'take the mission', sub: m.summary, color: 'amber' })),
    ], [button('Not now', () => this.closeModal(), { color: 'ghost' })]);
    this.needsRender = true;
  }

  chooseMission(choiceId) {
    const result = this.game.chooseMission(choiceId);
    if (!result) { audio.play('ui_deny'); return; }
    if (result.complete && result.ending) {
      this.showMessage(result.ending.label ?? 'Mission complete', [result.ending.text]);
    }
    this.render();
  }

  changeShip(classId) {
    const g = this.game;
    // Same reason as `Game.acceptCommand`: swapping the hull mid-battle leaves
    // the engagement fighting the ship you just left.
    if (g.engagement && !g.engagement.over) {
      audio.play('ui_deny');
      g.officerSays('engineering', 'Not in the middle of an engagement, Captain.', 'object');
      this.render();
      return;
    }
    const oldName = g.ship.name;
    const oldRegistry = g.ship.registry;
    // Through `takeCommandOf`, which is the one path that puts a captain in a
    // different hull — and whose neighbour already claims to be shared by "all
    // three ways a captain ends up in a different hull: promotion, a board of
    // inquiry, and the change-of-command screen". This screen was the one that
    // was not.
    //
    // What it was missing is the line `takeCommandOf` carries a comment for:
    // "The track follows the captain, not the hull." Nothing here re-pointed
    // `mastery.classId`, so a Constitution worked up to tier five and then
    // swapped for an Excelsior at the yard flew the Excelsior on the
    // Constitution's mastery — five tiers of bonuses on a hull nobody had ever
    // flown. Measured:
    //
    //   changeShip     flying excelsior | track: constitution | tier 5
    //   takeCommandOf  flying excelsior | track: excelsior    | tier 0
    //
    // And there are six shipyards, one of them Sol, so this is a button a
    // captain can press on the first day.
    const took = takeCommandOf(g, classId, { name: oldName, registry: oldRegistry });
    if (!took.ok) {
      audio.play('ui_deny');
      g.officerSays('engineering', took.reason ?? 'The yard cannot do that, Captain.', 'object');
      this.render();
      return;
    }
    const refit = took;
    // The yard time is this screen's own contribution: the other two ways into
    // a new hull do not spend four days in dock. Through `spendHours`, so those
    // four days are four days of the commission and of the ship's work, not
    // four days that only the calendar noticed.
    g.spendHours(96);
    g.pushLog(`Transferred command to a ${g.ship.cls.name}.`, 'captain');
    audio.play('dock');
    this.showMessage('Change of Command', [
      `${oldName} is now a ${g.ship.cls.name}.`,
      // Naming the consoles rather than the generic "any consoles that no
      // longer fit": the captain should not have to go and count bays to find
      // out what the yard took out of his ship.
      `Four days in the yard. ${yardReport(refit, CONSOLES) ?? 'Every console fitted before is still fitted.'}`,
    ]);
    this.render();
  }

  // ------------------------------------------------------------ orders

  submitOrder() {
    const text = this.orderInput.value.trim();
    if (!text) return;
    this.orderInput.value = '';

    // With the channel forced open, the order line stops being an order line.
    // Whatever you type is what you say, verbatim, and it is judged against
    // your record rather than parsed into a command. This is the one place in
    // the game where the literal words are the input.
    if (this.game?.gambitOpen) {
      const outcome = this.game.makeAppeal(text);
      this.showAppealOutcome(outcome);
      return;
    }

    // A question is on the screen, and this line is an answer to it.
    //
    // Checked BEFORE the parser, not added to it, so the existing intents keep
    // their meanings — with nothing pending, "belay that" still stops the guns,
    // which is what it means when somebody is shooting at you. A line that is
    // not an answer falls through and is parsed as an ordinary order: a captain
    // who says "fire phasers" while being asked something has changed the
    // subject, and is entitled to.
    if (this.pendingQuestion) {
      const answer = readAnswer(text);
      if (answer) {
        const act = this.pendingQuestion[answer];
        this.game?.pushLog(`“${text}”`, 'captain');
        act();
        this.render();
        return;
      }
    }

    const order = parseOrder(text, this.game?.crew ?? null);
    this.executeOrder(order, text);
  }

  /**
   * What the commander made of it, and — win or lose — which of the things you
   * said the record could actually back up.
   */
  showAppealOutcome(outcome) {
    const body = [
      el('p', { class: 'muted', text: `You said: “${outcome.text}”` }),
      ...outcome.lines.map((l) => el('p', { text: l })),
      el('p', {}, [el('b', { text: outcome.reply })]),
    ];

    if (outcome.hits.length) {
      body.push(el('p', { class: 'muted', text: 'What the record could confirm:' }));
      for (const h of outcome.hits) {
        body.push(el('p', {
          class: 'muted',
          text: `${h.supported ? '✓' : '✗'} ${h.label} — ${h.value >= 0 ? '+' : ''}${h.value}`,
        }));
      }
    }

    audio.play(outcome.success ? 'computer_ack' : 'ui_deny');
    haptic(outcome.success ? 'confirm' : 'deny');
    this.modalHandle = this.raiseModal(
      outcome.success ? 'They Are Standing Down' : 'The Channel Closes',
      body,
      [button('Acknowledged', () => this.closeModal(), { color: outcome.success ? 'green' : 'red' })],
    );
    this.needsRender = true;
  }

  /**
   * More than one place to send them: let the captain say which.
   *
   * `opts` carries whether the captain said they were going down with them, so
   * "away team, I'll lead" survives the question about where.
   */
  chooseAwayMission(options, opts = {}) {
    audio.play('ui_select');
    this.modalHandle = this.raiseModal('Where To, Captain?', [
      el('p', { class: 'muted', text: 'A landing party can be sent to more than one place from here.' }),
      ...options.map((t) => button(t.title, () => {
        this.closeModal();
        this.runAwayMission(t.id, opts);
      }, { say: t.id === 'boarding_action' ? 'board them' : 'send an away team', color: 'ice' })),
    ], [button('Belay that', () => this.closeModal(), { color: 'ghost' })]);
    this.needsRender = true;
  }

  /** Run one, and show what came back. */
  runAwayMission(id, opts = {}) {
    const r = this.game.awayMission(id, opts);
    if (!r.ok) {
      audio.play('ui_deny');
      this.game.pushLog(r.reason, 'transporter');
      this.render();
      return;
    }
    audio.play(r.outcome === 'failure' ? 'ui_deny' : 'computer_ack');
    haptic(r.outcome === 'failure' ? 'deny' : 'confirm');
    this.modalHandle = this.raiseModal(r.title, [
      ...r.steps.map((st) => el('p', {
        class: st.success ? '' : 'muted',
        text: `${st.success ? '\u2713' : '\u2717'} ${st.text}${st.officer ? ` — ${st.officer}` : ''}`,
      })),
      // Said on the report as well as in the log: a captain carried off their
      // own landing party should not have to read the ship's log to find out.
      r.captainWounded
        ? el('p', { class: 'muted', text: 'You were hit. The party broke off and brought you back.' })
        : null,
      el('p', {}, [el('b', {
        text: `${r.passed} of ${r.of} objectives.`
          + (r.lost ? ` We lost ${r.lost}.` : ''),
      })]),
    ], [button('Acknowledged', () => this.closeModal(), {
      color: r.outcome === 'failure' ? 'red' : 'green',
    })]);
    this.needsRender = true;
  }

  executeOrder(order, raw) {
    const g = this.game;
    const eng = g.engagement;
    // An order given FROM a console changes what that console is showing.
    this.consoleDirty = true;

    // The parser read something plausible but is not sure enough to act on it.
    // Ask, rather than guess — a wrong order in combat costs more than a
    // question does.
    if (order.confirm) {
      this.confirmReading(order, raw);
      return;
    }

    if (order.unknown) {
      audio.play('ui_deny');
      g.pushLog(`"${raw}" — the computer does not recognise that order.`, 'computer');
      if (order.suggestions?.length) {
        g.pushLog(`Did you mean: ${order.suggestions.join('  ·  ')}`, 'computer');
      }
      this.render();
      return;
    }
    if (order.error) {
      audio.play('ui_deny');
      g.pushLog(order.error, 'helm');
      this.render();
      return;
    }

    // Who answers.
    //
    // An order given to somebody by name is answered BY THAT PERSON. "Mr.
    // Sulu, warp six" used to be acknowledged by whichever station the order
    // belonged to, which is usually the same officer and sometimes flatly
    // wrong — and always wrong when the captain deliberately went round the
    // duty roster to ask a particular person.
    //
    // Naming somebody who cannot answer does not swallow the order. The post
    // still has somebody standing it, they still carry it out, and the log
    // says why it was not the person who was asked.
    const spokenTo = order.addressee?.station ?? null;
    if (spokenTo) {
      const named = g.crew.officers.find((o) => o.name === order.addressee.name);
      const answering = answeringFor(
        { station: spokenTo, officer: named ?? null }, g.crew,
      );
      if (named && answering && answering !== named) {
        g.pushLog(
          `${named.name} is off duty — ${answering.name} has the station, Captain.`,
          'computer',
        );
      }
    }

    const ack = (station, text) => {
      // The station the order belongs to, unless the captain named somebody.
      const officer = g.officerSays(spokenTo ?? station, text);
      if (this.settings.voice && officer) audio.speak(text);
      audio.play('computer_ack');
      haptic('confirm');
    };

    // While something is on the viewer, the orders that name its choices answer
    // IT rather than doing the same thing to the wider world.
    //
    // The two are the same words. Withdrawing from a convoy and breaking off a
    // battle are both "withdraw"; hailing a patrol and hailing anybody are both
    // "hail them". The difference is what is happening, and the dispatcher is
    // the only place that knows. Without this the order line answered the
    // wrong question: "withdraw" at an encounter ran `warp_out`, which breaks
    // off a fight that is not happening, and "engage them" ran `fire`, which
    // shoots at nothing.
    //
    // Only choices the encounter actually OFFERS: a trapped ship has no
    // withdraw and saying it must not silently do nothing.
    if (g.encounter) {
      const offered = g.encounterChoices();
      const has = (id) => offered.some((c) => c.id === id);
      const wanted = order.action === 'encounter_choice' ? order.choice
        : order.action === 'warp_out' ? 'withdraw'
        : order.action === 'fire' ? 'engage'
        : order.action === 'scan' ? 'scan'
        : order.action === 'hail' ? (has('hail') ? 'hail' : 'contact_peaceful')
        : null;
      if (wanted && has(wanted)) {
        this.resolveEncounter(wanted);
        return;
      }
      if (order.action === 'encounter_choice') {
        // Said at the wrong moment, which is a refusal and not a silence.
        audio.play('ui_deny');
        ack('comms', 'That is not one of the choices in front of us, Captain.');
        return;
      }
    }

    switch (order.action) {
      case 'course': {
        const r = g.setCourse(order.system, order.warp);
        if (r.ok) { audio.play('warp_engage'); haptic('warp'); audio.setAlertLevel('warp'); }
        // A refusal that is only a beep is a bug report waiting to happen: the
        // order had a reason and the helm never said it. "We are under fire,
        // Captain" is the difference between a game that ignored you and a
        // crew that answered.
        else { audio.play('ui_deny'); ack('helm', r.error ?? 'We cannot, Captain.'); }
        break;
      }
      case 'orbit': {
        const r = g.enterOrbit();
        if (r.ok) { audio.play('ui_confirm'); haptic('confirm'); }
        else { audio.play('ui_deny'); ack('helm', r.error ?? 'We cannot, Captain.'); }
        break;
      }
      case 'break_orbit': {
        const r = g.breakOrbit();
        if (r.ok) { audio.play('ui_confirm'); haptic('confirm'); }
        else { audio.play('ui_deny'); g.pushLog(r.error, 'helm'); }
        break;
      }
      case 'warp_factor': {
        // This used to be an acknowledgement and nothing else — the helm said
        // "warp eight standing by" and the next course still went out at six.
        // It sets the standing factor now, which is what the flip switches on
        // the console do and what the word means.
        const r = g.setWarpFactor(order.warp);
        audio.play(r.limited ? 'ui_deny' : 'ui_confirm');
        ack('helm', r.limited
          ? `Warp ${r.max} is all she has, Captain. Standing by at warp ${r.factor}.`
          : `Warp ${r.factor} standing by.`);
        break;
      }
      case 'throttle': {
        // "All stop" while the ship is at warp is not the impulse throttle: it
        // is the order to come out of warp, and it is what a captain says.
        if (order.value === 0 && g.transit) { this.executeOrder({ action: 'drop_warp' }, raw); return; }
        // Engines answering an order is a sound the game had and never made.
        const opening = order.value > g.ship.throttle + 0.15;
        g.ship.throttle = order.value;
        if (opening) audio.play('impulse_burn', { throttle: 400 });
        ack('helm', order.value === 0 ? 'All stop.' : `Ahead ${Math.round(order.value * 100)} percent.`);
        break;
      }

      case 'drop_warp': {
        const r = g.dropOutOfWarp();
        if (!r.ok) { audio.play('ui_deny'); ack('helm', r.error); break; }
        audio.play('warp_drop');
        ack('helm', `Dropping to impulse at ${r.system.name}, Captain.`);
        break;
      }
      case 'heading':
        // Something to steer. `eng?.` quietly did nothing with no fight on and
        // the acknowledgement went out anyway, so the helm confirmed a course
        // change that had not happened.
        if (!eng || eng.over) { ack('helm', 'We are not manoeuvring, Captain.'); break; }
        eng.setHeading(order.value);
        // "Bearing 210 mark 15" always parsed its mark, carried it in the order
        // object, and had it dropped here. The mark is the elevation, and it is
        // the only reason the third axis is in the sentence.
        if (order.mark) eng.setPitch(order.mark);
        ack('helm', order.mark
          ? `Coming to bearing ${order.value} mark ${order.mark}.`
          : `Coming to bearing ${order.value}.`);
        break;
      case 'turn': {
        if (!eng) { ack('helm', 'We are not manoeuvring, Captain.'); break; }
        if (order.value === 0) {
          eng.setHeading(g.ship.heading);
          ack('helm', 'Steady as she goes.');
          break;
        }
        eng.setHeading(g.ship.heading + order.value);
        ack('helm', order.value < 0 ? 'Coming to port.' : 'Coming to starboard.');
        break;
      }
      case 'cloak': {
        // No Federation hull in this game carries one. The refusal is the
        // point: an officer says why, rather than the parser shrugging at an
        // order every captain in this setting knows the words to.
        if (!g.ship.cloakCapable) {
          audio.play('ui_deny');
          ack('engineering', 'We have no cloaking device, Captain. Treaty of Algeron.');
          break;
        }
        const worked = order.on ? g.ship.cloak() : g.ship.decloak();
        if (!worked) {
          audio.play('ui_deny');
          ack('engineering', order.on
            ? 'The cloak is still cycling, Captain.'
            : 'We are not cloaked.');
          break;
        }
        // No `audio.play` here: `Ship.cloak`/`decloak` emit, and the
        // listener above plays the cue that was written for this. Playing one
        // here as well would double it for the player and still leave every
        // hostile cloak silent.
        ack('tactical', order.on ? 'Cloaking device engaged.' : 'Decloaking.');
        break;
      }
      case 'pitch': {
        if (!eng || eng.over) { ack('helm', 'We are not manoeuvring, Captain.'); break; }
        const from = order.relative ? (g.ship.desiredPitch ?? 0) : 0;
        eng.setPitch(from + order.value);
        const said = order.value === 0 ? 'Levelling off.'
          : order.value > 0 ? `Coming up ${Math.round(order.value)} degrees.`
            : `Taking her down ${Math.round(-order.value)} degrees.`;
        ack('helm', said);
        break;
      }
      case 'come_about':
        if (!eng || eng.over) { ack('helm', 'There is nothing to come about on, Captain.'); break; }
        eng.comeAboutTo(eng.target);
        ack('helm', 'Coming about.');
        break;
      case 'evasive':
        eng?.evasive(order.value);
        g.ship.evasive = order.value;
        ack('helm', order.value ? 'Evasive manoeuvres, aye.' : 'Resuming standard flight.');
        break;
      case 'warp_out':
        if (eng) { if (!eng.beginWarpOut()) audio.play('ui_deny'); }
        else ack('helm', 'Nothing to run from, Captain.');
        break;
      case 'dock': {
        const r = g.dock();
        if (r.ok) audio.play('dock'); else { audio.play('ui_deny'); g.pushLog(r.error, 'helm'); }
        // Spoken and tapped reach the same place: a board that sat while you
        // were docking gets a screen either way.
        if (r.finding) {
          this.showMessage('Board of Inquiry', [r.finding.text]
            .concat(r.finding.reducedTo ? [`Your rank is now ${r.finding.reducedTo}.`] : []));
        }
        break;
      }
      // Repairing where you stand. The same call the "Effect repairs" button
      // makes, and reachable by phrase for the first time — every wording of it
      // used to be read as a request to dock, which is the one thing a captain
      // with a holed hull and no yard in reach cannot do.
      case 'effect_repairs': {
        const r = g.effectRepairs();
        if (!r.ok) { audio.play('ui_deny'); ack('engineering', r.reason); break; }
        audio.play('computer_ack');
        this.showMessage('Repairs', [
          `Hull integrity ${Math.round(r.before * 100)}% → ${Math.round(r.after * 100)}%.`,
          r.blue
            ? 'Fourteen hours, with the whole crew at maintenance stations.'
            : 'Nineteen hours. The chief says that is the best she can do without a starbase.',
        ]);
        break;
      }
      // Training an officer in an ability, which had no phrase at all — the
      // words that look like one fire the ability instead. Finds whoever can
      // actually learn it: the officer the order was addressed to if they can,
      // otherwise the one whose department it belongs to.
      case 'train': {
        const wanted = order.ability;
        const addressed = order.addressee?.station ? g.crew.at(order.addressee.station) : null;
        const canLearn = (o) => o && g.trainableFor(o).some((a) => a.id === wanted);
        const officer = canLearn(addressed)
          ? addressed
          : g.crew.available.find(canLearn);
        if (!officer) {
          audio.play('ui_deny');
          // Say WHY rather than going quiet: already known and not yet
          // available are different answers, and the officer knows which.
          const holder = g.crew.available.find((o) => o.abilities.includes(wanted));
          ack('first_officer', holder
            ? `${holder.name} already has that qualification, Captain.`
            : 'Nobody aboard can take that course yet, Captain.');
          break;
        }
        const r = g.trainOfficer(officer, wanted);
        if (!r.ok) { audio.play('ui_deny'); ack('first_officer', r.reason); break; }
        audio.play('computer_ack');
        ack('first_officer', `${officer.name} is on the training programme, Captain. One day.`);
        break;
      }
      case 'alert':
        g.setAlert(order.level);
        break;
      case 'shields':
        g.ship.shieldsUp = order.up;
        // Lowering them on purpose is a standing decision; being shot out is
        // not. Only the first survives the emitter being repaired.
        g.ship.shieldsDown = !order.up;
        ack('tactical', order.up ? 'Shields up.' : 'Shields down.');
        break;
      case 'reinforce':
        g.ship.reinforceShield(order.facing);
        audio.play('power_reroute');
        ack('engineering', `Transferring power to the ${order.facing} shield.`);
        break;
      case 'power':
        g.ship.power.set(order.subsystem, order.amount >= 100 ? 100 : g.ship.power.target[order.subsystem] + order.amount);
        audio.play('power_reroute');
        ack('engineering', `Rerouting power to ${order.subsystem}.`);
        break;
      case 'preset':
        g.ship.power.applyPreset(order.preset);
        audio.play('power_reroute');
        ack('engineering', `${order.preset} configuration, aye.`);
        break;
      case 'target_subsystem':
        eng?.targetSubsystem(order.subsystem);
        ack('tactical', `Targeting their ${order.subsystem}.`);
        break;
      case 'cycle_target':
        eng?.cycleTarget();
        break;
      case 'target_nearest': {
        if (eng) {
          const nearest = eng.liveHostiles
            .reduce((best, s) => (!best || g.ship.distanceTo(s) < g.ship.distanceTo(best) ? s : best), null);
          if (nearest) eng.setTarget(nearest);
        }
        break;
      }
      case 'fire': {
        if (!eng || eng.over) { audio.play('ui_deny'); g.pushLog('No target, Captain.', 'tactical'); break; }
        // What was actually asked for. The parser has always read the weapon
        // out of the order and this threw it away, so "fire phasers" launched
        // torpedoes.
        const n = eng.fireAll(order.weaponType ?? 'all');
        if (!n) audio.play('ui_deny');
        break;
      }
      case 'cease_fire':
        if (eng) eng.autoFire = false;
        ack('tactical', 'Holding fire.');
        break;
      case 'hail':
        this.openHail(eng?.hostiles[0]?.faction ?? g.encounter?.factionId);
        break;
      case 'hail_option':
        this.showMessage('Response', [g.hail(order.option).text]);
        break;
      case 'scan': {
        if (eng?.target) {
          const t = eng.target;
          this.showMessage(`Scan — ${t.name}`, [
            `${t.cls.name}. ${t.cls.description}`,
            `Hull ${Math.round(t.hullPct * 100)}%, shields ${Math.round(t.shieldPct * 100)}%.`,
          ]);
        } else {
          this.showMessage('Sensor Sweep', this.scanSystem());
        }
        audio.play('scan');
        break;
      }
      case 'status': {
        const s = eng ? eng.statusReport() : {
          hull: Math.round(g.ship.hullPct * 100),
          shields: FACINGS.map((f) => `${f} ${Math.round(g.ship.shieldPctOf(f) * 100)}%`).join(', '),
          crew: g.ship.crew, casualties: g.ship.maxCrew - g.ship.crew, condition: g.ship.condition,
        };
        this.showMessage('Damage Report', [
          `Hull integrity ${s.hull} percent. Condition ${s.condition}.`,
          `Shields: ${s.shields}.`,
          `Crew ${s.crew}${s.casualties ? `, ${s.casualties} casualties` : ''}.`,
          g.ship.fires ? `${g.ship.fires} fires burning.` : 'No fires reported.',
        ]);
        break;
      }

      // ---- the captain's chair, reachable equally from a typed order ----
      case 'intercom': {
        const dept = order.dept ?? 'security';
        this.showMessage(`${dept[0].toUpperCase()}${dept.slice(1)}`, [g.intercom(dept)]);
        break;
      }
      case 'log_entry': {
        // "Captain's log" with nothing after it is not an entry — it is a
        // captain starting to dictate one. It used to FILE an entry whose text
        // was the words "captains log"; now it opens the recorder in the chair
        // and puts the cursor in it.
        if (!order.text) {
          this.go('bridge');
          this.render();
          const line = document.querySelector('.logline');
          if (line) { line.focus(); ack('computer', 'Recording, Captain.'); }
          else ack('computer', 'Take the chair to record, Captain.');
          break;
        }
        const recorded = g.logEntry(order.text);
        if (recorded) ack('captain', 'Log entry recorded.');
        else audio.play('ui_deny');
        break;
      }
      // Reading the log, which used to write one. The parser now tells the two
      // apart; this is where the reading goes.
      case 'read_log':
        audio.play('ui_tap');
        this.go('log');
        break;
      case 'jettison_pod': {
        const r = g.jettisonPod();
        if (r.ok) { audio.play('torpedo_launch'); haptic('warp'); }
        else { audio.play('ui_deny'); g.pushLog(r.reason, 'engineering'); }
        break;
      }
      case 'go_to_room': {
        const r = g.goToRoom(order.room);
        if (r.ok) {
          audio.play('door');
          haptic('confirm');
        } else {
          audio.play('ui_deny');
          ack('computer', r.reason);
        }
        break;
      }
      case 'chair': {
        const r = g.takeChair(order.sit !== false);
        if (r.ok) { audio.play('ui_confirm'); haptic('tap'); }
        else { audio.play('ui_deny'); ack('computer', r.reason); }
        break;
      }
      case 'hand_over_con': {
        // Who was named, if anyone. `parseOrder` resolves the address against
        // the real roster now, so this no longer has to do its own surname
        // matching — and it gets "Number One", "Bones" and "the chief
        // engineer" for free, which the old substring test never did.
        const r = g.handOverCon(order.addressee?.station ?? null);
        if (r.ok) { audio.play('ui_confirm'); haptic('confirm'); }
        else { audio.play('ui_deny'); ack('computer', r.reason); }
        break;
      }
      case 'call_for_help': {
        const r = g.callForHelp();
        if (!r.ok) { audio.play('ui_deny'); ack('comms', r.reason); break; }
        audio.play(r.answered ? 'computer_ack' : 'ui_deny');
        haptic(r.answered ? 'confirm' : 'deny');
        break;
      }
      case 'take_con': {
        const r = g.takeCon();
        if (r.ok) { audio.play('ui_confirm'); haptic('confirm'); }
        else { audio.play('ui_deny'); ack('computer', r.reason); }
        break;
      }
      case 'diagnostic': {
        const r = g.diagnostic(order.level);
        audio.play(r.clean ? 'computer_ack' : 'ui_deny');
        if (!r.clean) haptic('alert');
        break;
      }
      case 'chart_tilt': {
        // The chart is on the navigation console, so the order takes you there
        // as well as moving it — saying "tilt the chart" while looking at
        // something else and having nothing visibly happen is not an answer.
        if (this.screen !== 'galaxy') this.go('galaxy');
        const map = this.map;
        if (!map) { audio.play('ui_deny'); break; }
        if (order.spin !== undefined) map.setSpin(map.spin + order.spin);
        else map.setTilt(order.tilt);
        audio.play('ui_select');
        haptic('tap');
        ack('helm', order.tilt === 0 ? 'Chart levelled, Captain.'
          : order.spin !== undefined ? 'Rotating the chart.'
            : 'Laying the chart over.');
        this.needsRender = true;
        break;
      }
      case 'watch_bill': {
        const holder = g.conOfficer;
        g.pushLog(holder
          ? `${holder.rank} ${holder.name} has the con. ${g.watch.name} is standing.`
          : `You have the con, Captain. ${g.watch.name} is standing.`, 'computer');
        for (const w of WATCHES) {
          const names = g.watchBill[w.id].map((o) => o.name).join(', ');
          g.pushLog(`${w.name}: ${names || 'unmanned'}.`, 'computer');
        }
        audio.play('computer_ack');
        break;
      }
      case 'help':
        audio.play('computer_ack');
        this.go('reference');
        break;
      case 'viewscreen': {
        // "On screen." One order, both directions: it opens the main viewer,
        // and said again it closes it and puts you back where you were —
        // the tactical plot mid-fight, the bridge otherwise.
        if (this.screen === 'viewscreen') {
          this.go(eng && !eng.over ? 'tactical' : 'bridge');
          ack('helm', 'Screen off, Captain.');
        } else {
          this.go('viewscreen');
          audio.play('ui_select');
          ack('helm', 'On screen.');
        }
        break;
      }
      case 'magnify': {
        // "Magnify" while the viewer is shut means "show me" — open it first,
        // then zoom, rather than silently magnifying something nobody can see.
        if (this.screen !== 'viewscreen') this.go('viewscreen');
        const v = this.tactical;
        if (!v?.setMagnification) { audio.play('ui_deny'); break; }
        const factor = order.factor && order.factor > 0
          ? order.factor
          : Math.min(12, v.magnification * 2);
        const now = v.setMagnification(factor);
        audio.play('computer_ack');
        ack('science', `Magnification factor ${now % 1 ? now.toFixed(1) : now.toFixed(0)}.`);
        break;
      }

      // ---- the machine shop ----
      case 'fabricate': {
        if (!order.recipe) {
          audio.play('ui_deny');
          g.officerSays('engineering', 'Build what, Captain?', 'object');
          break;
        }
        const r = g.fabricate(order.recipe);
        if (r.ok) { audio.play('computer_ack'); haptic('confirm'); }
        else { audio.play('ui_deny'); g.officerSays('engineering', r.reason, 'object'); }
        break;
      }
      case 'work_shop': {
        const status = g.fabricationStatus;
        if (!status) {
          audio.play('ui_deny');
          g.officerSays('engineering', 'Nothing on the bench, Captain.', 'object');
          break;
        }
        // Spend hours rather than merely asking. "Get on with it" is an order
        // to put the time in, and the time is real.
        const spend = Math.min(status.hoursRemaining, 8);
        const r = g.workTheShop(spend);
        if (r.done) {
          this.showMessage(r.done.recipe.name, [r.done.text]);
        } else {
          g.officerSays('engineering',
            `${(g.fabricationStatus.hoursRemaining).toFixed(1)} hours to go on the ${status.name.toLowerCase()}.`,
            'report');
        }
        break;
      }
      case 'repel_boarders': {
        // Turning out the guard. The defence in `Ship.update` draws its
        // defenders from the crew and reads `repelBoarders`, so what this
        // order does is put more people into the corridor for a while — and
        // there was no way to order it, because until the trigger was written
        // nothing could ever be aboard to repel.
        if (!(g.ship.boarders > 0)) {
          audio.play('ui_deny');
          ack('security', 'There is nobody aboard who should not be, Captain.');
          break;
        }
        const already = g.ship.buffs?.some((b) => b.id === 'repel_boarders');
        if (already) {
          audio.play('ui_deny');
          ack('security', 'Every hand I have is already down there, Captain.');
          break;
        }
        g.ship.addBuff({
          id: 'repel_boarders', label: 'Security to all decks',
          until: REPEL_DURATION, mods: { repelBoarders: REPEL_STRENGTH },
        });
        audio.play('intruder_alert');
        haptic('confirm');
        ack('security', `Security teams to all decks. ${Math.round(g.ship.boarders)} aboard, Captain.`);
        break;
      }
      case 'encounter_choice': {
        // Reached only when nothing is in front of the ship: the dispatch above
        // answers it while an encounter is up, and returns. A case here anyway,
        // because an order with no handler falls through the switch and does
        // nothing at all — which is what the guard in tests/lang.test.js is
        // for, and it caught this.
        audio.play('ui_deny');
        ack('comms', 'There is nothing in front of us to answer, Captain.');
        break;
      }
      case 'take_mission': {
        // Standing orders could be TAKEN only by pressing a button, which is
        // the one thing this game says it will not have. The refusals go
        // through the same officer who would voice them, because an order that
        // does nothing and says nothing is indistinguishable from a broken one.
        const running = g.missions.active;
        if (running && !running.complete) {
          audio.play('ui_deny');
          ack('comms', `We are still in the middle of ${running.title}, Captain.`);
          break;
        }
        const offered = g.availableMissions();
        if (!offered.length) {
          audio.play('ui_deny');
          ack('comms', 'Nothing on the boards for us here, Captain.');
          break;
        }
        // One set of orders is taken; several are laid out to choose from, the
        // same way more than one place to send a landing party is.
        if (offered.length === 1) { this.startMission(offered[0].id); break; }
        this.chooseStandingOrders(offered);
        break;
      }
      case 'abandon_mission': {
        const r = g.abandonMission();
        if (r.ok) { audio.play('computer_ack'); haptic('confirm'); }
        else { audio.play('ui_deny'); ack('comms', r.error); }
        break;
      }
      case 'duty_roster': {
        // A question, so it is answered rather than acted on.
        const roster = g.dutyRoster ?? [];
        const out = (g.assignments ?? []).length;
        if (!roster.length) { ack('comms', 'We have no specialists aboard, Captain.'); break; }
        const aboard = roster.filter((p) => p.state === 'aboard').length;
        const hurt = roster.filter((p) => p.state === 'recovering').length;
        const lines = [
          `${aboard} aboard, ${out} ${out === 1 ? 'detail' : 'details'} out${hurt ? `, ${hurt} in sickbay` : ''}.`,
          ...(g.assignments ?? []).map((job) => {
            const a = ASSIGNMENTS[job.assignmentId];
            const who = (job.team ?? [])
              .map((id) => roster.find((p) => p.id === id)?.name)
              .filter(Boolean).join(', ');
            return `${a?.name ?? 'A detail'}: ${who} — ${Math.max(0, Math.round(job.hoursRemaining))} hours.`;
          }),
        ];
        for (const line of lines) g.pushLog(line, 'comms');
        this.showMessage('Ship’s Company', lines);
        audio.play('computer_ack');
        break;
      }
      case 'assign_detail': {
        this.sendDetail(order.detail);
        break;
      }
      case 'ship_mastery': {
        // A question, so it is answered rather than acted on.
        const m = g.mastery?.report();
        if (!m) { ack('engineering', 'There is nothing to report about the ship, Captain.'); break; }
        const lines = m.shakedown
          ? [`${m.shakedown.name}, Captain. ${m.shakedown.text}`]
          : m.earned.map((step) => `${step.name}. ${step.text}`);
        if (m.next) {
          lines.push(`Next is ${m.next.name}, and we are ${Math.ceil(m.next.remaining)} short of it.`);
        }
        if (m.slotOpen) {
          lines.push(m.trait
            ? `Standing doctrine: ${m.trait.name}. ${m.trait.text}`
            : 'We know her well enough to commit to a doctrine, Captain. You have only to say which.');
        }
        for (const line of lines) g.pushLog(line, 'engineering');
        this.showMessage(`${m.className} — ${m.tier} of ${TIERS.length}`, lines);
        audio.play('computer_ack');
        break;
      }
      case 'set_doctrine': {
        if (!order.doctrine) {
          ack('engineering', `Which doctrine, Captain? ${TRAIT_LIST.map((t) => t.name).join(', ')}.`);
          break;
        }
        const r = g.mastery?.chooseTrait(order.doctrine)
          ?? { ok: false, reason: 'There is no doctrine to set, Captain.' };
        if (!r.ok) { audio.play('ui_deny'); ack('engineering', r.reason); break; }
        g.applyAllMods();
        audio.play('computer_ack');
        haptic('confirm');
        ack('engineering', `Standing doctrine is ${r.trait.name}, Captain. ${r.trait.text}`);
        break;
      }
      case 'take_command': {
        const r = g.acceptCommand();
        if (!r.ok) { audio.play('ui_deny'); ack('comms', r.reason); break; }
        audio.play('computer_ack');
        haptic('confirm');
        this.render();
        break;
      }
      case 'request_command': {
        const r = g.requestCommand();
        if (!r.ok) { audio.play('ui_deny'); ack('comms', r.reason); break; }
        audio.play('computer_ack');
        this.render();
        break;
      }
      case 'keep_command': {
        const r = g.declineCommand();
        if (!r.ok) { audio.play('ui_deny'); ack('comms', r.reason); break; }
        audio.play('computer_ack');
        this.render();
        break;
      }
      case 'salvage': {
        const r = g.stripWreck();
        // `tractor_beam`, which was synthesised and played by nothing. Duty.js
        // calls this "tractoring in the floaters" and ship.js describes core
        // recovery as getting a tractor beam on a live antimatter assembly —
        // the two moments in the game that are a tractor beam both made a
        // generic acknowledgement noise.
        if (r.ok) { audio.play('tractor_beam'); haptic('confirm'); }
        else { audio.play('ui_deny'); ack('engineering', r.reason); }
        break;
      }

      case 'force_channel': {
        const r = g.forceChannel();
        if (r.ok) {
          // `hail_incoming`, which is the cue that exists. This said `'hail'`,
          // and `AudioEngine.play` returns silently on a name it does not know
          // — so the opening move of the Kobayashi Maru, forcing a channel on
          // people whose doctrine is to ignore hails, was the one dramatic
          // moment in the game that made no sound at all. An ordinary incoming
          // hail has had this cue since the beginning.
          audio.play('hail_incoming');
          haptic('confirm');
          this.showMessage('Channel Forced', [
            'They are receiving. Whatever you say next, they will hear.',
            'Type it into the order line. All of it. It is not a menu.',
          ]);
        } else {
          audio.play('ui_deny');
          this.showMessage('They Are Not Listening', r.reasons);
        }
        break;
      }

      case 'eject_core':
        if (g.ship.ejectCore()) { audio.play('explosion'); haptic('explosion'); ack('engineering', 'Core away!'); }
        else audio.play('ui_deny');
        break;
      case 'recover_core': {
        const r = g.recoverCore();
        if (r.ok) { audio.play('tractor_beam'); haptic('confirm'); }
        else { audio.play('ui_deny'); ack('engineering', r.reason); }
        break;
      }
      case 'ability': {
        const ability = ABILITIES[order.ability];
        const officer = ability ? g.crew.officerFor(ability.id) : null;
        // An officer who is not ready is the same as no officer, for the
        // purpose of choosing between the ability and the plain order behind
        // it. `useAbility` refuses on cooldown with a deny beep and returns, so
        // "evasive manoeuvres" — which is BOTH a trained ability and an
        // ordinary helm order — silently did nothing at all for thirty seconds
        // after its first use.
        if (officer && ability && !officer.ready(ability.id) && order.fallback) {
          this.executeOrder(order.fallback, raw);
          return;
        }
        if (officer && ability) {
          this.useAbility(officer, ability);
        } else if (order.fallback) {
          // No trained officer, but the phrase is also a plain order.
          this.executeOrder(order.fallback, raw);
          return;
        } else {
          audio.play('ui_deny');
          g.pushLog('Nobody aboard is trained for that.', 'computer');
        }
        break;
      }

      case 'signature': {
        // The captain's own power, spoken. `useSignature` announces it, opens
        // the channel for a diplomat, and refuses with a reason for a tactical
        // captain on an empty bridge — this only has to say what the refusal
        // was, because a deny beep on its own is not an answer.
        if (!this.useSignature()) {
          const why = g.character?.signatureUsed
            ? 'We have already played that card this engagement, Captain.'
            : 'There is nothing to use it on, Captain.';
          ack('computer', why);
        }
        break;
      }

      case 'device': {
        if (!order.device) {
          audio.play('ui_deny');
          ack('engineering', 'Which one, Captain? A battery, or a hull patch?');
          break;
        }
        const before = g.loadout.equipped.device.length;
        this.useDevice(order.device);
        if (g.loadout.equipped.device.length === before) {
          ack('engineering', 'We are out of those, Captain.');
        }
        break;
      }

      case 'away_team': {
        // This used to assemble a team and say it was standing by, and that was
        // the whole order — a landing party that never went anywhere. The five
        // templates in AWAY_TEMPLATES have been sitting unread since the away
        // system was written; what runs is decided by where the ship is and
        // what is in front of it.
        const options = g.availableAwayMissions();
        if (!options.length) {
          g.buildAwayTeam(['science', 'medical', 'tactical'], order.captainLeads);
          ack('transporter',
            'Away team assembled and standing by. There is nowhere to send them, Captain.');
          break;
        }
        const wanted = order.prefer === 'board'
          ? options.find((t) => t.id === 'boarding_action' || t.id === 'derelict_search')
          : null;
        const pick = wanted ?? (options.length === 1 ? options[0] : null);
        const lead = { captainLeads: !!order.captainLeads };
        if (!pick) { this.chooseAwayMission(options, lead); break; }
        this.runAwayMission(pick.id, lead);
        break;
      }
      case 'mission_choice': {
        const m = g.missions.active;
        const choices = m?.choices?.() ?? [];
        const pick = choices[order.index ?? 0];
        if (!m || !pick || pick.locked) {
          audio.play('ui_deny');
          g.pushLog('There is nothing to decide, Captain.', 'computer');
          break;
        }
        this.chooseMission(pick.id);
        break;
      }
      case 'use':
        // The whole physical-console interface, reachable by saying so. Walking
        // to a station and pressing the button was the only way to operate
        // anything on this ship, which made the order line an interface for
        // half the game and a decoration for the other half.
        this.useWhatIsInFront();
        break;
      case 'survey_here': {
        const target = g.walk?.looking;
        if (!g.ashore || !target?.check) {
          audio.play('ui_deny');
          g.pushLog('There is nothing in front of you to survey, Captain.', 'science');
          break;
        }
        this.openConsole('survey', target);
        break;
      }
      case 'beam_down': {
        const r = g.beamDown();
        if (r.ok) { audio.play('transporter'); haptic('confirm'); }
        else { audio.play('ui_deny'); g.pushLog(r.error, 'transporter'); }
        break;
      }
      case 'transport':
        // "Energise" means bring us back when the captain is the one standing
        // on the planet, and means the usual acknowledgement when they are not.
        if (g.ashore) {
          const r = g.beamUp();
          if (r.ok) { audio.play('transporter'); haptic('confirm'); }
          else audio.play('ui_deny');
        } else {
          audio.play('transporter');
          ack('comms', 'Energising.');
        }
        break;
      default:
        audio.play('ui_deny');
        break;
    }
    this.render();
  }

  // ------------------------------------------------------------ character

  /**
   * Promotion grants a feat choice. The sheet screen offers the list; this
   * applies the pick and, for the repeatable ability feat, asks which scores.
   */
  chooseFeat(featId) {
    const g = this.game;
    if (!g || !(g.pendingFeats > 0)) return;
    const feat = FEAT_BY_ID[featId];
    if (!feat) return;

    if (featId === 'ability_score') {
      // Two +1s, chosen one at a time, so the UI stays a simple list.
      this.pickAbilityIncrease(2, []);
      return;
    }
    // Spending the bank and recomputing what the feat changes is
    // `Game.takeFeat`; this is the announcement.
    if (g.takeFeat(featId).ok) {
      audio.play('ui_confirm');
      this.showMessage(feat.name, [feat.text]);
      this.render();
    }
  }

  pickAbilityIncrease(remaining, picked) {
    const g = this.game;
    this.closeModal();
    this.modalHandle = this.raiseModal(`Field Commission — ${remaining} to assign`, [
      el('p', { class: 'hint', text: 'Raise an ability score by one. Scores are capped at 20.' }),
      ...ABILITY_LIST.map((a) => {
        const score = g.character.score(a.id);
        return button(`${a.name} — ${score} → ${Math.min(20, score + 1)}`, () => {
          const next = [...picked, a.id];
          if (remaining > 1) {
            this.pickAbilityIncrease(remaining - 1, next);
          } else {
            g.takeFeat('ability_score', next);
            this.closeModal();
            audio.play('ui_confirm');
            this.render();
          }
        }, { color: score >= 20 ? 'ghost' : 'blue', disabled: score >= 20 });
      }),
    ], [button('Cancel', () => this.closeModal(), { color: 'ghost' })]);
  }

  /**
   * Buy a reputation project and say what arrived.
   *
   * What the project GIVES is in `Game.buyProject`, so it happens whether or
   * not anybody is looking at it. This is the announcement.
   */
  buyProject(trackId, projectId) {
    const r = this.game.buyProject(trackId, projectId);
    if (!r.ok) { audio.play('ui_deny'); return false; }
    audio.play('ui_confirm');
    this.showMessage(r.project.name, [r.project.text, ...r.lines]);
    return true;
  }

  // ------------------------------------------------------------ persistence

  save() { return saveGame(this.game, 'auto'); }

  exportSave() {
    try {
      downloadSave(this.game);
    } catch {
      // Some mobile browsers block programmatic downloads; fall back to text.
      this.showMessage('Command Record', [exportSave(this.game).slice(0, 4000)]);
    }
  }

  importSave() {
    const input = el('input', { type: 'file', accept: '.json,application/json' });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = importSave(await file.text());
        this.game = Game.load(data, { compression: this.settings.compression });
        this.go('bridge');
        this.showMessage('Record Restored', [`Resumed command at stardate ${this.game.stardate}.`]);
      } catch (err) {
        this.showMessage('Import Failed', [String(err.message ?? err)]);
      }
    });
    input.click();
  }

  // ------------------------------------------------------------ start

  showNewGame() {
    this.game = null;
    this.creator = new CharacterCreator(this, (draft) => this.startGame(draft));
    this.screenEl.replaceWith(this.creator.root);
    this.screenEl = this.creator.root;
    this.orderBar.style.display = 'none';
    this.navEl.style.display = 'none';
    this.shipNameEl.textContent = 'Starfleet Command';
    this.stardateEl.textContent = 'New Commission';
  }

  /** Character creation needs randomness before a Game (and its RNG) exists. */
  rngForCreation() {
    this.creationRng ??= new RNG(hashSeed(`creation:${Date.now()}:${Math.random()}`));
    return this.creationRng;
  }

  startGame(draft) {
    const seed = draft.seed?.trim()
      ? hashSeed(draft.seed.trim())
      : hashSeed(`${Date.now()}:${Math.random()}`);

    this.game = new Game({
      seed,
      character: {
        firstName: draft.firstName || 'Alexander',
        lastName: draft.lastName || 'Reyes',
        pronouns: draft.pronouns,
        speciesId: draft.speciesId,
        originId: draft.originId,
        careerId: draft.careerId,
        traits: draft.traits,
        baseScores: draft.baseScores,
      },
      difficulty: draft.difficulty,
      crewMode: draft.crewMode,
      era: draft.era,
      shipName: draft.shipName || 'Enterprise',
      registry: draft.registry || 'NCC-1701',
    });

    // The career skill, the Starfleet family's extra pip and any reprimand
    // already on file are applied by `Game.commission`, in the constructor —
    // they used to be applied here, which meant only a captain created through
    // this screen ever got them.
    this.recentRolls = [];

    this.orderBar.style.display = '';
    this.navEl.style.display = '';
    this.creator = null;
    this.go('bridge');
    audio.unlock();
    audio.play('boatswain');

    const c = this.game.character;
    this.showMessage(`Stardate ${this.game.stardate}`, [
      `${this.game.progress.rankName} ${c.name}, you have the ${this.game.ship.name}.`,
      `${c.species.name}, ${c.career.name} track, serving at ${this.game.difficulty.name} difficulty.`,
      'Orders are on the screen at Sol. Type an order at any time — "helm, set course for Vulcan, warp eight" — or use the panels.',
    ]);
    this.save();
  }

  /**
   * Credit the time that passed while the app was closed, and show the captain
   * what happened. Called on load and whenever the tab comes back.
   *
   * Silent when nothing meaningful elapsed — coming back after ninety seconds
   * should not open a modal.
   */
  resumeCommission() {
    const r = this.game?.syncCampaign();
    if (!r || r.hours < 1) { this.needsRender = true; return; }
    this.showMessage('While You Were Away', r.lines);
    audio.play('computer_query');
    this.needsRender = true;
  }

  resumeOrStart() {
    if (hasSave('auto')) {
      const data = loadSave('auto');
      this.modalHandle = this.raiseModal('Resume Command', [
        el('p', { text: data.label ?? 'A command record was found.' }),
      ], [
        button('Resume', () => {
          this.closeModal();
          try {
            this.game = Game.load(data, { compression: this.settings.compression });
            this.orderBar.style.display = '';
            this.go('bridge');
            if (data.recoveredFromBackup) {
              this.game.pushLog(
                'Primary command record was unreadable; restored from backup.',
                'computer',
              );
            }
            this.resumeCommission();
          } catch {
            this.showNewGame();
          }
        }, { color: 'green' }),
        button('New command', () => { this.closeModal(); this.showNewGame(); }, { color: 'ghost' }),
      ]);
    } else {
      this.showNewGame();
    }
  }

  // ------------------------------------------------------------ loop

  frame(timestamp) {
    const g = this.game;
    if (g && !g.over) {
      const steps = g.clock.frame(timestamp);
      for (let i = 0; i < steps; i++) g.update(SIM_STEP);

      // Canvas views redraw every frame; DOM only when something changed.
      const dt = Math.min(0.1, Math.max(0, (timestamp - (this.lastFrameAt ?? timestamp)) / 1000));
      this.lastFrameAt = timestamp;
      if (this.fpv) this.fpv.render(g, dt);
      else if (this.tactical) {
        if (g.engagement) {
          this.tactical.render(g.engagement, g.clock.alpha, dt);
        } else if (this.screen === 'viewscreen') {
          // No engagement and the viewer is open: draw what is actually
          // outside, rather than the black rectangle a combat camera gives you
          // at peace.
          this.tactical.renderVista?.(g, dt);
        } else {
          // The plot, with nothing on it. Gated on a live engagement, the last
          // frame of the battle simply stayed on the canvas — the dead fleet's
          // hulls, their labels, the hull bars and the target reticle, painted
          // over a plot that no longer had anything in it. `render` clears both
          // the GL frame and the 2D chrome before it decides there is nothing
          // to draw.
          this.tactical.render(null, g.clock.alpha, dt);
        }
      }
      if (this.map) this.map.render(g);
      this.updateOverlay();

      // Combat and transit change numbers continuously.
      if (steps > 0 && (g.mode === MODES.COMBAT || g.mode === MODES.TRANSIT)) {
        this.tickCounter = (this.tickCounter ?? 0) + steps;
        if (this.tickCounter > 8) { this.tickCounter = 0; this.needsRender = true; }
      }
      if (this.needsRender) this.render();

      // Autosave every 30 seconds of wall clock.
      if (timestamp - this.lastAutosave > 30000) {
        this.lastAutosave = timestamp;
        this.save();
      }
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  /** The chips over the tactical canvas update every frame, cheaply. */
  updateOverlay() {
    const g = this.game;
    const overlay = this.tacticalOverlay;
    if (!overlay) return;
    // No fight, no chips.
    //
    // This returned early when the engagement went away and left whatever was
    // painted on the last frame of the battle sitting there — the hull bars,
    // the target reticle and the dead fleet's labels, over the first-person
    // bridge, for the rest of the session. The overlay is a view of a fight;
    // with no fight it has to be empty.
    if (!g?.engagement || g.engagement.over) {
      if (overlay.childNodes.length) clear(overlay);
      return;
    }
    const eng = g.engagement;
    const p = g.ship;
    clear(overlay);
    overlay.append(
      el('div', { class: 'row' }, [
        el('div', { class: `chip ${p.hullPct < 0.35 ? 'danger' : p.hullPct < 0.7 ? 'warn' : ''}`, text: `Hull ${Math.round(p.hullPct * 100)}%` }),
        el('div', { class: 'chip', text: `Shields ${Math.round(p.shieldPct * 100)}%` }),
        el('div', { class: 'chip', text: `${eng.liveHostiles.length} hostile` }),
      ]),
      el('div', { class: 'row' }, [
        el('div', { class: 'chip', text: `Speed ${Math.round(p.throttle * 100)}%` }),
        p.breaching ? el('div', { class: 'chip danger', text: `BREACH ${p.breachTimer.toFixed(0)}s` }) : null,
        eng.warpOutTimer > 0 ? el('div', { class: 'chip warn', text: `Warp in ${eng.warpOutTimer.toFixed(0)}s` }) : null,
        el('div', { class: 'chip', text: `Crew ${p.crew}` }),
      ].filter(Boolean)),
    );
  }
}

// ---------------------------------------------------------------- boot

function boot() {
  const root = document.getElementById('app');
  const app = new App(root);
  globalThis.__app = app;   // handy for the test harness
  globalThis.__audio = audio;   // so the harness can observe which cues fire
  app.resumeOrStart();
  requestAnimationFrame((t) => app.frame(t));

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* file:// or unsupported */ });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

export { App };

/** @typedef {import('./objects').AnimationContext} AnimationContext */
/** @typedef {import('./objects').AnimationChoice} AnimationChoice */

const groups = ['Idle', 'Movement', 'Combat', 'Reactions', 'Emotes', 'Other'];
const weaponPrefixes = ['stick', 'pistol', 'rifle', 'rocket', 'bomb'];
const labels = {
  'nif-default': 'Default', stand: 'Idle', staying: 'Idle', ready: 'Ready stance',
  runback: 'Run backward', turnleft: 'Turn left', turnright: 'Turn right',
  jumpstart: 'Jump takeoff', jumpend: 'Jump descent', jumplandrun: 'Running landing',
  wound: 'Hit reaction', criticalwound: 'Critical hit reaction', die: 'Defeated', death: 'Death',
  luncher: 'Launched', luncherfly: 'Airborne', luncher_none: 'Launched', knockdown: 'Knockdown',
  standup: 'Get up', inven: 'Inventory pose', foldedarms: 'Folded arms',
  melee: 'Melee attack', range: 'Ranged attack', attack: 'Attack',
  corruptak: 'Corruption attack', megatak: 'Mega attack',
  corruptak_readyspell: 'Corruption windup', megatak_readyspell: 'Mega attack windup',
  readyspell: 'Casting stance', spellomni: 'Cast', spellcasting: 'Cast',
  talkexclamation: 'Talk excitedly', talkquestion: 'Ask a question', usestanding: 'Use item',
  powershot: 'Power shot', trifleshot: 'Triple shot', sniper: 'Aim', sniperattack: 'Aimed shot',
  dashback: 'Dash backward', swimback: 'Swim backward', swimidle: 'Swim idle',
  swimleft: 'Swim left', swimright: 'Swim right', swordguard: 'Sword guard',
  whillwind: 'Whirlwind', beach: 'Beach pose', skill: 'Skill', call: 'Summon',
};

/** @param {number} equipType @returns {import('./objects').WeaponAnimationStyle} */
export function weaponStyle(equipType) {
  // cnAvatarStatus.SetFaceHand -> cnAvatarAnimation.RunName/StandName.
  switch (equipType) {
    case 1: case 2: return 'stick';
    case 3: return 'pistol';
    case 4: return 'rifle';
    case 10: return 'bomb';
    case 11: return 'rocket';
    case 0: return 'unarmed';
    default: return 'plain';
  }
}

/** @param {number} equipType @returns {import('./objects').VehicleAnimationStyle | undefined} */
export function vehicleStyle(equipType) {
  if (equipType === 1) return 'board';
  if (equipType === 2 || equipType === 3) return 'scooter';
  return undefined;
}

/** @param {string} name @returns {AnimationChoice['group']} */
function groupOf(name) {
  if (/^(stand\d*|idle\d*|staying|inven|nif-default)$/.test(name)) return 'Idle';
  if (/^(walk|run|jump|turn|swim|slide|dash|somersault|tumbling)/.test(name)) return 'Movement';
  if (/^(death|die|wound|criticalwound|knockdown|stun|luncher|standup|dodge)/.test(name)) return 'Reactions';
  if (/^(attack|melee|range|ready|skill|spell|corrupt|mega|sniper|powershot|trifleshot|swordguard|whillwind)/.test(name)) return 'Combat';
  if (/^(dance|beach|agree|angry|applaud|cheer|cry|enough|flex|foldedarms|goodbye|happy|hello|kiss|laugh|lose|no$|observe|ok$|report|sad|scratch|shocked|talk|tease|thank|tie$|win$|yes$)/.test(name)) return 'Emotes';
  return 'Other';
}

/** @param {string} name @returns {string} */
function labelOf(name) {
  const side = /_(left|right)$/.exec(name);
  const stem = side ? name.slice(0, -side[0].length) : name;
  const number = /\d+$/.exec(stem)?.[0] ?? '';
  const word = number ? stem.slice(0, -number.length) : stem;
  const label = labels[/** @type {keyof typeof labels} */ (word)] ?? word.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return label.charAt(0).toUpperCase() + label.slice(1) + (number ? ` ${number}` : '') + (side ? ` · ${side[1]}` : '');
}

/**
 * @param {{name: string, duration: number}[]} clips
 * @param {AnimationContext} context
 * @returns {AnimationChoice[]}
 */
export function animationChoices(clips, context) {
  const available = new Set(clips.map((clip) => clip.name.toLowerCase()));
  const avatar = context.kind === 'avatar';
  const weapon = context.weapon ?? 'unarmed';
  const seen = new Set();
  /** @type {AnimationChoice[]} */
  const choices = [];
  for (const clip of clips) {
    if (seen.has(clip.name)) continue;
    seen.add(clip.name);
    if (!(clip.duration > 0)) continue;
    let name = clip.name.toLowerCase();
    if (name.includes('@')) continue;
    if (/^(height|shape)(?:_add)?$/.test(name) || /(?:upper|uppper|_add|_additive)$/.test(name)) continue;
    if (avatar) {
      if (context.vehicle) {
        const prefix = `${context.vehicle}_`;
        if (!name.startsWith(prefix)) continue;
        name = name.slice(prefix.length);
        // Steering clips are additive layers in cnAvatarAnimation.
        if (/^turn(left|right)$/.test(name)) continue;
      } else {
        if (/^(board_|scooter_|mount\d|rope)/.test(name)) continue;
        const prefix = weaponPrefixes.find((value) => name.startsWith(value));
        if (prefix) {
          if (prefix !== weapon) continue;
          name = name.slice(prefix.length);
        } else if (weaponPrefixes.includes(weapon) && available.has(weapon + name) && /^(stand|run|jump|turn|ready|attack|wound|dodge)/.test(name)) {
          continue;
        }
        if (weapon === 'unarmed' && /^(attack|readyspell|spellomni|swordguard|sheath)/.test(name)) continue;
        if (name === 'swordguard' && weapon !== 'stick') continue;
      }
    }
    choices.push({ name: clip.name, label: labelOf(name), group: groupOf(name), duration: clip.duration });
  }
  return choices.sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group) || a.label.localeCompare(b.label, 'en', { numeric: true }) || a.name.localeCompare(b.name));
}

/** @param {AnimationChoice[]} choices @param {AnimationContext} context @param {string} [requested] @returns {string} */
export function preferredAnimation(choices, context, requested) {
  const prefix = context.kind === 'avatar' ? context.vehicle ? `${context.vehicle}_` : weaponPrefixes.includes(context.weapon ?? '') ? context.weapon : '' : '';
  const preferred = [prefix ? `${prefix}stand1` : '', requested, 'stand1', 'stand', 'idle', 'nif-default'];
  return preferred.find((name) => name && choices.some((choice) => choice.name === name)) ?? choices[0]?.name ?? '';
}

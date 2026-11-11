// Legacy table references corrected in Retrobution's tables. Try the original
// path first so builds that actually contain it retain their own version.
export const MODEL_ALIASES: Record<string, string> = {
  'wear/f_pants_saturdayspants.nif': 'wear/w_pants_saturdayspants.nif',
  'wear/f_shirt_saturdaysshirt.nif': 'wear/w_shirt_saturdaysset.nif',
  'wear/sword_prototypesword.nif': 'wear/melee_prototypesword.nif',
  // The mob prefab contains the npc_blowfish skinned renderer.
  'mob/npc_blowfish.kfm': 'mob/mob_blowfish.kfm',
};

export const TEXTURE_ALIASES: Record<string, string> = {
  'texture/f_shirt_creationset_a.dds': 'texture/m_shirt_creationset_a.dds',
  'texture/sword_prototypesword.dds': 'texture/melee_prototypesword.dds',
  // Both names export the same image bytes in the beta clients.
  'texture/m_shoes_pummelgranateboots.dds': 'texture/m_shoes_bombegranateboots.dds',
};

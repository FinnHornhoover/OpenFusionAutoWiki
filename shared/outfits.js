/** @typedef {import('./objects').PreviewVariant} PreviewVariant */

/**
 * Compose item recipes using the hat's face/hair cutouts and the equipped pose.
 * @param {PreviewVariant} base
 * @param {PreviewVariant[]} items
 * @returns {PreviewVariant}
 */
export function composeOutfit(base, items) {
  const parts = new Map((base.parts ?? []).map((part) => [part.slot, part]));
  const hat = items.find((item) => item.parts?.some((part) => part.slot === 'hat'));
  if (hat) {
    for (const slot of /** @type {const} */ (['face', 'hair'])) {
      parts.delete(slot);
      const part = hat.parts?.find((part) => part.slot === slot);
      if (part) parts.set(slot, part);
    }
  }
  for (const item of items) {
    // Each item recipe includes default clothing; replace only its own slot.
    const slot = item.outfitSlot;
    const part = item.parts?.find((part) => part.slot === slot);
    if (slot && part) parts.set(slot, part);
  }
  for (const slot of hat?.hiddenSlots ?? []) parts.delete(slot);
  if (items.some((item) => item.outfitSlot === 'vehicle')) parts.delete('weapon');
  const pose = items.find((item) => item.outfitSlot === 'vehicle') ?? items.find((item) => item.outfitSlot === 'weapon') ?? base;
  return { ...base, parts: [...parts.values()], hiddenSlots: hat?.hiddenSlots, animationContext: pose.animationContext, idle: pose.idle, animations: pose.animations };
}

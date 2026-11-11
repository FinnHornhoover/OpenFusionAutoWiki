import type { AnimationChoice, AnimationContext, VehicleAnimationStyle, WeaponAnimationStyle } from './objects';
export function weaponStyle(equipType: number): WeaponAnimationStyle;
export function vehicleStyle(equipType: number): VehicleAnimationStyle | undefined;
export function animationChoices(clips: { name: string; duration: number }[], context: AnimationContext): AnimationChoice[];
export function preferredAnimation(choices: AnimationChoice[], context: AnimationContext, requested?: string): string;

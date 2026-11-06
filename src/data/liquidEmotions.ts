/** Item names and original game icon filenames, cross-checked with PoE2DB.
 * Recipes themselves always come from the selected GGG tree export.
 * See public/liquid-emotions/README.md for asset sources. */
export const LIQUID_EMOTIONS: Readonly<Record<string, { name: string; icon: string }>> = {
  PotentLiquidMelancholy: { name: 'Potent Liquid Melancholy', icon: 'UniqueHumansEmotion.webp' },
  PotentLiquidFerocity: { name: 'Potent Liquid Ferocity', icon: 'UniqueConstructsEmotion.webp' },
  PotentLiquidContempt: { name: 'Potent Liquid Contempt', icon: 'UniqueBeastEmotion.webp' },
  ConcentratedLiquidFear: { name: 'Concentrated Liquid Fear', icon: 'ConcentratedDistilledFear.webp' },
  ConcentratedLiquidSuffering: { name: 'Concentrated Liquid Suffering', icon: 'ConcentratedDistilledSuffering.webp' },
  ConcentratedLiquidIsolation: { name: 'Concentrated Liquid Isolation', icon: 'ConcentratedDistilledIsolation.webp' },
  LiquidEnvy: { name: 'Liquid Envy', icon: 'DistilledEnvy.webp' },
  LiquidDisgust: { name: 'Liquid Disgust', icon: 'DistilledDisgust.webp' },
  LiquidDespair: { name: 'Liquid Despair', icon: 'DistilledDespair.webp' },
};

// Framer Motion spring presets — matching PRD §7.5.4
export const springs = {
  snappy:  { type: 'spring' as const, stiffness: 400, damping: 28 },
  default: { type: 'spring' as const, stiffness: 300, damping: 30 },
  gentle:  { type: 'spring' as const, stiffness: 200, damping: 26 },
  bouncy:  { type: 'spring' as const, stiffness: 400, damping: 20, mass: 0.8 },
};

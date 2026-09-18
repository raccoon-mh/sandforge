import type { Reaction } from '../types.ts'

/**
 * Reactions bolted onto materials declared elsewhere. Keeping them here rather
 * than inside each record stops the material tables from turning into walls of
 * rules, and puts every chain in one place where it can be read end to end.
 *
 * A rule fires from the side that declares it, so only one of a pair needs it.
 */
export const EXTRA_REACTIONS: Record<string, Reaction[]> = {
  // --- alkali metals: the reason sodium is kept under oil ---
  SODM: [
    { with: 'WATR', into: ['FIRE', 'HYGN'], p: 0.9, heat: 900 },
    { with: 'SLTW', into: ['FIRE', 'HYGN'], p: 0.9, heat: 900 },
    { with: 'ICE', into: ['FIRE', 'HYGN'], p: 0.4, heat: 700 },
    { with: 'ACID', into: ['FIRE', 'HYGN'], p: 1, heat: 1100 },
  ],
  MSOD: [{ with: 'WATR', into: ['FIRE', 'HYGN'], p: 1, heat: 1100 }],

  // --- acid against metal: hydrogen off, metal gone ---
  ACID: [
    { with: 'IRON', into: [null, 'RUST'], p: 0.2, heat: 25 },
    { with: 'ZINC', into: ['', 'HYGN'], p: 0.3, heat: 40 },
    { with: 'ALMN', into: [null, 'HYGN'], p: 0.2, heat: 45 },
    { with: 'MAGN', into: ['', 'HYGN'], p: 0.5, heat: 80 },
    { with: 'MARB', into: ['CO2', ''], p: 0.35 },
    { with: 'LIME', into: ['', 'WATR'], p: 0.5, heat: 70 },
    { with: 'AMNA', into: ['SLTW', ''], p: 0.5, heat: 60 },
  ],

  // --- rusting and its reverse ---
  IRON: [{ with: 'OXYG', into: ['RUST', ''], p: 0.01 }, { with: 'SULF', into: ['FEST', ''], p: 0.03, minT: 600 }],
  IRND: [{ with: 'SULF', into: ['FEST', ''], p: 0.06, minT: 500 }],
  RUST: [{ with: 'CARB', into: ['IRON', ''], p: 0.05, minT: 1100, heat: -60 }],

  // --- combustion chains: fuel burns dirty without enough oxygen ---
  SMKE: [{ with: 'OXYG', into: ['CO2', ''], minT: 900, p: 0.15 }],
  COAL: [{ with: 'OXYG', into: [null, 'CO'], minT: 800, p: 0.05 }],
  BCOL: [{ with: 'OXYG', into: [null, 'CO'], minT: 700, p: 0.08 }],
  ACTY: [{ with: 'OXYG', into: ['CO2', 'FIRE'], minT: 580, p: 0.9, heat: 1100 }],
  METH: [{ with: 'CHLG', into: ['HACD', ''], minT: 700, p: 0.2, heat: 120 }],

  // --- halogens ---
  CHLG: [
    { with: 'HYGN', into: ['HACD', ''], p: 0.5, heat: 200 },
    { with: 'AMNA', into: ['NITG', ''], p: 0.4, heat: 90 },
    { with: 'SODM', into: ['SALT', ''], p: 0.8, heat: 300 },
    { with: 'WATR', into: ['', 'ACID'], p: 0.08 },
  ],

  // --- water doing quiet work ---
  WATR: [
    { with: 'DICE', into: ['FOG', 'CO2'], p: 0.5, heat: -80 },
    { with: 'MIRN', into: ['STEM', 'IRON'], p: 0.6, heat: -240 },
    { with: 'MCOP', into: ['STEM', 'COPR'], p: 0.6, heat: -240 },
    { with: 'MGLS', into: ['STEM', 'GLSD'], p: 0.6, heat: -240 },
    { with: 'MMTL', into: ['STEM', 'BRMT'], p: 0.6, heat: -240 },
    { with: 'MZNC', into: ['STEM', 'ZINC'], p: 0.6, heat: -200 },
    { with: 'CORL', into: [null, 'CORL'], p: 0.004 },
  ],

  // --- glass from a furnace floor ---
  LAVA: [
    { with: 'SAND', into: [null, 'MGLS'], p: 0.25 },
    { with: 'SALT', into: [null, 'LAVA'], p: 0.3 },
    { with: 'SNOW', into: ['OBSD', 'STEM'], p: 0.5, heat: -260 },
    { with: 'PLNT', into: [null, 'FIRE'], p: 0.6 },
  ],

  // --- photosynthesis: light is the reagent, not a decoration ---
  PHOT: [
    { with: 'PLNT', into: ['', 'PLNT'], p: 0.25 },
    { with: 'ALGE', into: ['', 'ALGE'], p: 0.25 },
  ],
  PLNT: [
    { with: 'SO2', into: ['ASH', ''], p: 0.1 },
    { with: 'ACID', into: ['ASH', null], p: 0.2 },
    { with: 'LYE', into: ['ASH', null], p: 0.2 },
  ],

  // --- nuclear support: the moderator earns its keep ---
  HVYW: [{ with: 'NEUT', into: [null, 'NEUT'], p: 0.3, heat: 6 }],
  GRPH: [{ with: 'NEUT', into: [null, 'NEUT'], p: 0.25, heat: 8 }],

  // --- cryogenics ---
  LN2: [
    { with: 'WATR', into: ['NITG', 'ICE'], p: 0.6, heat: -140 },
    { with: 'STEM', into: ['NITG', 'ICE'], p: 0.7, heat: -200 },
    { with: 'OXYG', into: [null, 'LOXY'], p: 0.5, heat: -60 },
    { with: 'CO2', into: [null, 'DICE'], p: 0.5, heat: -60 },
  ],
  LOXY: [
    { with: 'FIRE', into: ['OXYG', null], p: 0.9, heat: 400 },
    { with: 'BCOL', into: ['OXYG', 'FIRE'], p: 0.4, heat: 500 },
  ],

  // --- solvents and polymers ---
  GSLN: [{ with: 'PLAS', into: [null, 'RESN'], p: 0.04 }],
  SOAP: [{ with: 'ACID', into: ['', 'SLTW'], p: 0.2 }],
  GLUE: [{ with: 'SAND', into: ['', 'CNCR'], p: 0.08 }],

  // --- biology ---
  BCTR: [
    { with: 'HONY', into: [null, 'ETHN'], p: 0.03 },
    { with: 'ASH', into: [null, 'DIRT'], p: 0.02 },
    { with: 'ACID', into: ['', null], p: 0.4 },
  ],
  FUNG: [{ with: 'SAWD', into: [null, 'FUNG'], p: 0.01 }],
  MOSS: [{ with: 'STNE', into: [null, 'MOSS'], p: 0.002 }],

  // --- silicon and semiconductors ---
  SLCN: [
    { with: 'PHOS', into: ['NSCN', ''], p: 0.08, minT: 900 },
    { with: 'BORX', into: ['PSCN', ''], p: 0.08, minT: 900 },
  ],

  // --- alloys: mix and melt ---
  MCOP: [
    { with: 'ZINC', into: ['BRAS', 'BRAS'], p: 0.25 },
    { with: 'TIN', into: ['BRNZ', 'BRNZ'], p: 0.25 },
    { with: 'MZNC', into: ['BRAS', 'BRAS'], p: 0.35 },
    { with: 'MTIN', into: ['BRNZ', 'BRNZ'], p: 0.35 },
  ],
  MIRN: [
    { with: 'CARB', into: ['STEL', ''], p: 0.2 },
    { with: 'BCOL', into: ['STEL', ''], p: 0.15 },
    { with: 'CHRM', into: ['STEL', 'STEL'], p: 0.2 },
  ],
  MTIN: [{ with: 'LEAD', into: ['SLDR', 'SLDR'], p: 0.3 }],

  // --- pressure and phase oddities ---
  DICE: [{ with: 'FIRE', into: ['CO2', ''], p: 0.6, heat: -180 }],
  STEM: [{ with: 'IRON', into: ['HYGN', 'RUST'], minT: 900, p: 0.05, heat: -30 }],
  GYPS: [{ with: 'FIRE', into: [null, 'STEM'], p: 0.15, heat: -120 }],
}

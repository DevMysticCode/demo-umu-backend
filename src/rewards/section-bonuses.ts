// Section-completion bonus amounts — weighted by a UK property agent's
// rough read of each section's legal/practical significance, not a flat
// value across the board. Sections carrying real conveyancing risk or
// mandatory disclosure weight (Leasehold, Searches, Environmental,
// Disputes & Complaints, Occupiers) score highest; quick administrative
// ones score lowest — but every section is worth at least 50 points so
// none of them reads as an afterthought. Keyed by PassportSection.key
// (see prisma/seed.ts) with a safe fallback for any future/unmapped key.
export const DEFAULT_SECTION_BONUS_POINTS = 50;

export const SECTION_BONUS_POINTS: Record<string, number> = {
  // Foundational / administrative — quick to complete, lower legal weight.
  ownershipProfile: 50,
  transactionInformation: 50,
  guaranteesAndWarranties: 50,
  insurance: 50,
  landlord_insurance: 50,
  parking: 50,
  // Moderate — commonly queried by buyers/solicitors, some complexity.
  otherCharges: 55,
  boundaries: 60,
  services: 60,
  fixturesAndFittings: 60,
  rightsAndInformalArrangements: 65,
  // High — mandatory disclosure items / meaningful legal exposure.
  noticesAndProposals: 70,
  alterationsAndPlanning: 70,
  occupiers: 70,
  titleDeedsAndPlan: 70,
  disputesAndComplaints: 75,
  // Highest — the items that most affect a sale falling through or a
  // buyer's risk assessment.
  environmental: 80,
  searches: 80,
  leasehold: 100,
};

// e.g. "ownershipProfile" -> "SECTION_BONUS_OWNERSHIP_PROFILE"
export function sectionBonusActionKey(sectionKey: string): string {
  const snake = sectionKey.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  return `SECTION_BONUS_${snake}`;
}

export function sectionBonusPoints(sectionKey: string): number {
  return SECTION_BONUS_POINTS[sectionKey] ?? DEFAULT_SECTION_BONUS_POINTS;
}

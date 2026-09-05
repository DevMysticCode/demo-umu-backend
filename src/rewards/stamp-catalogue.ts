// UMU Stamp Reward System V1 — config for the 22-stamp spec. Each entry
// describes WHAT has to be true on a passport for that stamp to mint,
// expressed in terms of existing PassportSectionTask/PassportQuestion data
// rather than inventing a parallel tracking mechanism. See
// stamp-evaluator.ts for how these get checked.
//
// Design notes (the judgment calls behind this file):
//
// - Addressing is by (sectionKey, taskKey), optionally narrowed to one
//   specific question via `order` (its QuestionTemplate.order within that
//   task) when a task's questions serve more than one stamp — e.g.
//   leasehold's "documents" task holds the lease copy (order 1), a
//   management-pack-style correspondence upload (order 3), service-charge
//   evidence (order 4) and ground-rent evidence (order 5) as separate
//   ordered questions in the same task.
//
// - `requireUpload: true` means at least one answer among this stamp's
//   requirements must have a real uploaded file — a task "completed"
//   entirely with "No"/text answers and nothing attached doesn't earn a
//   stamp for a section whose whole point is evidence (Guarantees &
//   Warranties, Electrical Safety, the search stamps, etc). Left false
//   for stamps that are genuinely informational rather than
//   document-based (Boundaries & Rights, Fixtures & Contents/TA10) or
//   where a definitive "No" answer is itself a complete, meaningful
//   result (Building Safety).
//
// - Applicability gates: `requiresLeasehold` (the leasehold PassportSection
//   is only ever seeded for leasehold properties) and `notApplicableIf`
//   (a passport answer directly says "this doesn't apply") — both checked
//   in RewardsService.getStampsCatalogue(). Solar and Private Drainage
//   have a reliable existing yes/no signal, so they're gated. Window
//   Compliance and Mining Risk Search do NOT have one yet (Window
//   Compliance reuses a general warranty question — see below — and
//   there's no mining-risk-area signal anywhere in the data model), so
//   those two stay universally visible (Available to everyone) rather
//   than risk hiding a stamp for someone it actually applies to. All four
//   still only ever MINT when real matching evidence exists, regardless
//   of the applicable flag — this only affects catalogue display.
//
// - Window Compliance (5) reuses the existing guaranteesAndWarranties /
//   window_roof_light_door task (window/roof-light/door guarantees)
//   rather than a new FENSA/CERTASS-specific question, since no such
//   question exists in the seed data yet — an approximation, flagged for
//   a follow-up if the client wants a literal compliance-certificate
//   question distinct from the warranty one.

export type StampCategory = 'CORE' | 'TA6' | 'TA10' | 'SEARCHES' | 'LEASEHOLD';

// actionKey for a catalogue stamp's RewardAction — see seed-reward-actions.ts.
export function stampActionKey(stampKey: string): string {
  return `STAMP_${stampKey}`;
}

export interface StampRequirement {
  sectionKey: string;
  taskKey: string;
  /** Narrows to one QuestionTemplate.order within the task, if set. */
  order?: number;
}

// A stamp is NOT applicable when every gate here matches the passport's
// current answer for that (sectionKey, taskKey, order) question — e.g.
// "not applicable if solar_panels' answer is 'no'". Multiple gates are
// AND'd together (all must match) so a two-question condition like
// "fully on mains drainage" (both foul AND surface water = yes) can be
// expressed without a bespoke check per stamp.
export interface NotApplicableGate {
  sectionKey: string;
  taskKey: string;
  order: number;
  valuesIn: string[];
}

export interface StampCatalogueEntry {
  key: string;
  title: string;
  subtitle: string;
  description: string;
  category: StampCategory;
  requirements: StampRequirement[];
  requireUpload: boolean;
  requiresLeasehold?: boolean;
  /**
   * Additional conditional-visibility gate beyond requiresLeasehold, per
   * the client spec's UX Rule ("a property without solar panels should
   * not show Solar Documentation", etc). Only wired up where a reliable
   * existing answer signal exists — see stamp-catalogue.ts's own comment
   * above for the two (Window Compliance, Mining Risk) that don't have one
   * yet and stay universally visible.
   */
  notApplicableIf?: NotApplicableGate[];
}

export const STAMP_CATALOGUE: StampCatalogueEntry[] = [
  // ── CORE ──────────────────────────────────────────────────────────
  // Identity Verified + Ownership Verified are NOT here — they're already
  // wired via KYC_COMPLETED_OWNER / OWNERSHIP_VERIFIED RewardActions,
  // fired directly from the KYC and ownership-claim flows rather than
  // this task-based evaluator (see rewards/seed-reward-actions.ts).
  {
    key: 'TITLE_DOCUMENTS_ADDED',
    title: 'Title Documents Added',
    subtitle: 'Your title register and plan are on file.',
    description: 'The Title Register and Title Plan for this property have been retrieved and added to your Passport.',
    category: 'CORE',
    requirements: [{ sectionKey: 'titleDeedsAndPlan', taskKey: 'title_deeds_review' }],
    requireUpload: true,
  },

  // ── TA6-adjacent ─────────────────────────────────────────────────
  {
    key: 'PLANNING_BUILDING_CONTROL_COMPLETE',
    title: 'Planning & Building Control Complete',
    subtitle: "You've supplied your planning and building control evidence.",
    description: 'Relevant planning permission, Building Regulations approval, completion certificates and consent evidence for any alterations or extensions have been added.',
    category: 'TA6',
    requirements: [
      { sectionKey: 'alterationsAndPlanning', taskKey: 'building_works' },
      { sectionKey: 'alterationsAndPlanning', taskKey: 'unfinished_works' },
      { sectionKey: 'alterationsAndPlanning', taskKey: 'breaches_of_consent_conditions' },
      { sectionKey: 'alterationsAndPlanning', taskKey: 'planning_or_building_issues' },
    ],
    requireUpload: true,
  },
  {
    key: 'WINDOW_COMPLIANCE_ADDED',
    title: 'Window Compliance Added',
    subtitle: 'Window and door compliance evidence is on file.',
    description: 'Relevant FENSA, CERTASS or equivalent compliance documentation for replacement windows and doors has been added.',
    category: 'TA6',
    requirements: [{ sectionKey: 'guaranteesAndWarranties', taskKey: 'window_roof_light_door' }],
    requireUpload: true,
  },
  {
    key: 'ELECTRICAL_SAFETY_ADDED',
    title: 'Electrical Safety Added',
    subtitle: 'Your electrical safety evidence is on file.',
    description: 'Relevant electrical safety and compliance evidence - an Electrical Installation Certificate, EICR, or equivalent - has been added.',
    category: 'TA6',
    requirements: [{ sectionKey: 'services', taskKey: 'electricity' }],
    requireUpload: true,
  },
  {
    key: 'GAS_HEATING_SAFETY_ADDED',
    title: 'Gas & Heating Safety Added',
    subtitle: 'Your gas and heating safety evidence is on file.',
    description: 'Relevant gas, heating and boiler evidence - Gas Safe documentation, installation records or compliance evidence - has been added.',
    category: 'TA6',
    requirements: [{ sectionKey: 'services', taskKey: 'central_heating' }],
    requireUpload: true,
  },
  {
    key: 'GUARANTEES_WARRANTIES_ADDED',
    title: 'Guarantees & Warranties Added',
    subtitle: "You've added your property's guarantees and warranties.",
    description: 'Significant transferable guarantees or warranties for the property have been added.',
    category: 'TA6',
    requirements: [
      { sectionKey: 'guaranteesAndWarranties', taskKey: 'new_home_warranty' },
      { sectionKey: 'guaranteesAndWarranties', taskKey: 'damp_proofing' },
      { sectionKey: 'guaranteesAndWarranties', taskKey: 'timber_treatment' },
      { sectionKey: 'guaranteesAndWarranties', taskKey: 'window_roof_light_door' },
      { sectionKey: 'guaranteesAndWarranties', taskKey: 'electrical_work' },
      { sectionKey: 'guaranteesAndWarranties', taskKey: 'roofing' },
      { sectionKey: 'guaranteesAndWarranties', taskKey: 'central_heating' },
      { sectionKey: 'guaranteesAndWarranties', taskKey: 'underpinning' },
    ],
    requireUpload: true,
  },
  {
    key: 'SOLAR_DOCUMENTATION_ADDED',
    title: 'Solar Documentation Added',
    subtitle: 'Your solar panel documentation is on file.',
    description: 'Relevant solar panel documentation - installation records, MCS certificate, warranty or ownership/lease information - has been added.',
    category: 'TA6',
    requirements: [
      { sectionKey: 'alterationsAndPlanning', taskKey: 'solar_panels' },
      { sectionKey: 'alterationsAndPlanning', taskKey: 'solar_panels_ownership' },
      { sectionKey: 'alterationsAndPlanning', taskKey: 'solar_panel_roof_lease' },
    ],
    requireUpload: true,
    // "Have solar panels been installed?" (order 1) has a plain 'no' option
    // — a reliable existing signal for "this property has no solar panels".
    notApplicableIf: [
      { sectionKey: 'alterationsAndPlanning', taskKey: 'solar_panels', order: 1, valuesIn: ['no'] },
    ],
  },
  {
    key: 'PRIVATE_DRAINAGE_COMPLETE',
    title: 'Private Drainage Complete',
    subtitle: "You've completed your private drainage details.",
    description: 'Relevant private drainage details - septic tank, treatment plant, cesspool or compliance/maintenance information - have been completed.',
    category: 'TA6',
    requirements: [{ sectionKey: 'services', taskKey: 'drainage_and_sewerage' }],
    requireUpload: false,
    // "Is the property connected to mains: foul water drainage?" (order 1)
    // and "...surface water drainage?" (order 2) are both plain yes/no —
    // fully on mains for both means private drainage doesn't apply here.
    notApplicableIf: [
      { sectionKey: 'services', taskKey: 'drainage_and_sewerage', order: 1, valuesIn: ['yes'] },
      { sectionKey: 'services', taskKey: 'drainage_and_sewerage', order: 2, valuesIn: ['yes'] },
    ],
  },
  {
    key: 'BOUNDARIES_RIGHTS_COMPLETE',
    title: 'Boundaries & Rights Complete',
    subtitle: "You've completed your boundaries and rights information.",
    description: 'Significant boundary, access and property-right information - boundary responsibilities, shared driveways, rights of way and access arrangements - has been completed.',
    category: 'TA6',
    requirements: [
      { sectionKey: 'boundaries', taskKey: 'boundary_responsibilities' },
      { sectionKey: 'rightsAndInformalArrangements', taskKey: 'shared_costs_maintenance_and_responsibilities' },
      { sectionKey: 'rightsAndInformalArrangements', taskKey: 'rights_over_neighbouring_property' },
      { sectionKey: 'rightsAndInformalArrangements', taskKey: 'shared_services_and_utilities' },
    ],
    requireUpload: false,
  },

  // ── TA10 ─────────────────────────────────────────────────────────
  {
    key: 'FIXTURES_CONTENTS_COMPLETE',
    title: 'Fixtures & Contents Complete',
    subtitle: "You've completed your Fixtures & Contents form.",
    description: 'Your Fixtures & Contents (TA10) journey has reached completed status.',
    category: 'TA10',
    requirements: [
      { sectionKey: 'fixturesAndFittings', taskKey: 'basic_fittings' },
      { sectionKey: 'fixturesAndFittings', taskKey: 'kitchen' },
      { sectionKey: 'fixturesAndFittings', taskKey: 'bathroom' },
      { sectionKey: 'fixturesAndFittings', taskKey: 'carpets' },
      { sectionKey: 'fixturesAndFittings', taskKey: 'curtains_and_curtain_rails' },
      { sectionKey: 'fixturesAndFittings', taskKey: 'light_fittings' },
      { sectionKey: 'fixturesAndFittings', taskKey: 'fitted_units' },
      { sectionKey: 'fixturesAndFittings', taskKey: 'outdoor_area' },
      { sectionKey: 'fixturesAndFittings', taskKey: 'television_and_telephone' },
      { sectionKey: 'fixturesAndFittings', taskKey: 'stock_of_fuels' },
    ],
    requireUpload: false,
  },

  // ── Searches (each individual — new questions, see prisma/seed.ts) ──
  {
    key: 'LOCAL_AUTHORITY_SEARCH_ADDED',
    title: 'Local Authority Search',
    subtitle: 'Your Local Authority Search is on file.',
    description: 'A valid Local Authority Search has been ordered or added to your Passport.',
    category: 'SEARCHES',
    requirements: [{ sectionKey: 'searches', taskKey: 'local_authority_search' }],
    requireUpload: true,
  },
  {
    key: 'DRAINAGE_WATER_SEARCH_ADDED',
    title: 'Drainage & Water Search',
    subtitle: 'Your Drainage & Water Search is on file.',
    description: 'A valid Drainage & Water Search has been ordered or added to your Passport.',
    category: 'SEARCHES',
    requirements: [{ sectionKey: 'searches', taskKey: 'drainage_water_search' }],
    requireUpload: true,
  },
  {
    key: 'ENVIRONMENTAL_SEARCH_ADDED',
    title: 'Environmental Search',
    subtitle: 'Your Environmental Search is on file.',
    description: 'A valid Environmental Search has been ordered or added to your Passport.',
    category: 'SEARCHES',
    requirements: [{ sectionKey: 'searches', taskKey: 'environmental_search' }],
    requireUpload: true,
  },
  {
    key: 'FLOOD_SEARCH_ADDED',
    title: 'Flood Search',
    subtitle: 'Your Flood Search is on file.',
    description: 'A valid Flood Search has been ordered or added to your Passport.',
    category: 'SEARCHES',
    requirements: [{ sectionKey: 'searches', taskKey: 'flood_search' }],
    requireUpload: true,
  },
  {
    key: 'MINING_RISK_SEARCH_ADDED',
    title: 'Mining / Local Risk Search',
    subtitle: 'Your mining or local risk search is on file.',
    description: 'A relevant mining or location-specific risk search has been ordered or added to your Passport.',
    category: 'SEARCHES',
    requirements: [{ sectionKey: 'searches', taskKey: 'mining_risk_search' }],
    requireUpload: true,
  },

  // ── Leasehold (all require the leasehold section, i.e. a leasehold
  //    property — see requiresLeasehold) ──────────────────────────────
  {
    key: 'LEASE_ADDED',
    title: 'Lease Added',
    subtitle: 'Your lease is on file.',
    description: 'The complete current lease has been retrieved or uploaded.',
    category: 'LEASEHOLD',
    requirements: [{ sectionKey: 'leasehold', taskKey: 'documents', order: 1 }],
    requireUpload: true,
    requiresLeasehold: true,
  },
  {
    key: 'GROUND_RENT_COMPLETE',
    title: 'Ground Rent Complete',
    subtitle: "You've completed your ground rent information.",
    description: 'Significant ground rent information - current amount, latest demand, payment frequency and any review/escalation terms - has been added.',
    category: 'LEASEHOLD',
    requirements: [{ sectionKey: 'leasehold', taskKey: 'documents', order: 5 }],
    requireUpload: true,
    requiresLeasehold: true,
  },
  {
    key: 'SERVICE_CHARGE_COMPLETE',
    title: 'Service Charge Complete',
    subtitle: "You've completed your service charge information.",
    description: 'Significant service charge information - current charge, latest demand, accounts, reserve fund and known future expenditure - has been added.',
    category: 'LEASEHOLD',
    requirements: [
      { sectionKey: 'leasehold', taskKey: 'documents', order: 4 },
      { sectionKey: 'leasehold', taskKey: 'maintenance_and_service_charges' },
    ],
    requireUpload: true,
    requiresLeasehold: true,
  },
  {
    key: 'MANAGEMENT_PACK_ADDED',
    title: 'Management Pack Added',
    subtitle: 'Your management information pack is on file.',
    description: 'Management information from the freeholder or managing agent has been received and added to your Passport.',
    category: 'LEASEHOLD',
    requirements: [{ sectionKey: 'leasehold', taskKey: 'documents', order: 3 }],
    requireUpload: true,
    requiresLeasehold: true,
  },
  {
    key: 'BUILDING_SAFETY_COMPLETE',
    title: 'Building Safety Complete',
    subtitle: "You've completed your building safety information.",
    description: 'Relevant building safety documentation - Leaseholder/Landlord Certificate, remediation information or other building-safety evidence - has been added where applicable.',
    category: 'LEASEHOLD',
    requirements: [{ sectionKey: 'leasehold', taskKey: 'building_safety_cladding_and_the_leaseholder_deed_of_certificate' }],
    requireUpload: false,
    requiresLeasehold: true,
  },
];

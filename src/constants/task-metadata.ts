// ============================================
// TASK DESCRIPTIONS & ORDERS
// Shared between prisma/seed.ts and passport.service.ts
// ============================================

export const TASK_DESCRIPTIONS: Record<string, Record<string, string>> = {
  ownershipProfile: {
    notes: 'You must read notes before starting ',
    name_of_sellers_and_address_of_the_property:
      'Let\u2019s start with the basics \u2014 what\u2019s the full name and address of the property you\u2019re selling?',
    seller_solicitor:
      'Add the details of the seller\u2019s solicitor so we can keep things moving smoothly.',
    give_your_home_a_story:
      'Every home has a story \u2014 let\u2019s give yours the perfect name',
  },
  boundaries: {
    notes: 'You must read notes before starting.',
    boundary_responsibilities:
      'Boundary responsibility determines who pays for maintenance, repairs, or replacement of fences, walls, hedges, or other boundary features.',
    irregular_boundaries:
      "When a property's boundary isn't a straight line \u2013 for example, if it curves, bends, or follows unusual shapes.",
    moved_boundary_features:
      'If fences, walls, or hedges marking the boundary have ever been moved from their original position.',
    adjacent_land_purchased:
      'This means whether any extra land next to the property has been bought and added to it by the seller.',
    complex_boundaries:
      "This means boundaries that are tricky to describe or don't follow a simple line, such as when several properties meet or the edges overlap in unusual ways.",
    notices_under_the_party_wall_act_1996:
      'Formal notice about work affecting a shared wall, boundary, or structure under the Party Wall Act 1996.',
  },
  disputesAndComplaints: {
    past_disputes_or_complaints:
      'Determine whether there have been any disputes or complaints regarding this property or nearby properties',
    prospective_disputes_or_complaints:
      'Understanding if there is likely to be a future dispute about this property or nearby properties',
  },
  noticesAndProposals: {
    received_or_sent_notices:
      'Any letters, notices, or talks with neighbours or the council that might affect this home or nearby properties.',
    proposals_to_develop_or_alter:
      'Details of any proposals for development or changes to nearby land or buildings the seller is aware of.',
  },
  alterationsAndPlanning: {
    notes: 'You must read notes before starting ',
    building_works:
      'Any changes to your property affecting building works, usage, windows, doors or the conservatory. ',
    unfinished_works:
      'Any changes to your property affecting building works, usage, windows, doors or the conservatory., that are unfinished.',
    breaches_of_consent_conditions:
      'If any alterations to the property were complete without approval or did not comply with planning or building regulations.',
    planning_or_building_issues:
      'Any ongoing issues requiring resolution with the relevant bodies for that work. E.g. applying for retrospective consent or meeting conditions for approval.',
    solar_panels:
      'If any solar panels have been installed and dates of installation.',
    solar_panels_ownership:
      'If the installed solar panels belong to the seller or if an external solar panel provider owns them.',
    solar_panel_roof_lease:
      'Whether a lease of the air/ roof space where the panels were installed has been obtained by the provider. ',
    listed_building:
      "Confirmation of the property's listing status, if applicable.",
    conservation_orders:
      'Confirmation of any conservation orders applicable to the property.',
    tree_preservation_orders:
      'Confirmation of any Tree Preservation Orders applicable to the property,',
  },
  guaranteesAndWarranties: {
    notes: 'Review all property guarantees and warranties',
    new_home_warranty:
      'Upload your NHBC (or similar) warranty certificate to protect your structural investment',
    damp_proofing:
      'Upload your damp-proofing guarantee to protect against rising damp and moisture damage',
    timber_treatment:
      'Upload your damp-proofing guarantee to protect against rising damp and moisture damage',
    window_roof_light_door:
      'Upload your glazing and fenestration warranties for weather protection and energy efficiency',
    electrical_work:
      'Upload your electrical installation certificates for safety compliance and warranty coverage',
    roofing:
      'Upload your roofing warranty to protect against leaks and structural weather damage',
    central_heating:
      'Upload your heating system warranty to ensure warmth and protect against breakdowns',
    underpinning:
      'Upload your underpinning guarantee to secure foundation stability and structural integrity',
    other: 'Upload any other relevant guarantees and warranties here',
    claims_made_under_guarantees_warranties:
      'Track and manage your warranty claims to maximize your property protection benefits',
  },
  insurance: {
    seller_insurance: 'Floor coverings and carpets remaining in each room',
    landlord_insurance: 'Floor coverings and carpets remaining in each room',
    buildings_insurance: 'Floor coverings and carpets remaining in each room',
  },
  environmental: {
    notes: 'You must read notes before starting ',
    Flooding:
      'Upload your NHBC or similar warranty certificate to protect your structural investment',
    radon:
      'Upload your damp-proofing guarantee to protect against rising damp and moisture damage',
    energy_efficiency:
      'Upload your damp-proofing guarantee to protect against rising damp and moisture damage',
    japanese_knotweed:
      'Upload your glazing and fenestration warranties for weather protection and energy efficiency',
  },
  rightsAndInformalArrangements: {
    notes: 'You must read notes before starting.',
    resposibility_towards_jointly:
      'Document property rights, shared responsibilities, and informal agreements affecting your property',
    '2_dunno_how_id_surmise_this':
      'Record utility connections and service lines that cross property boundaries',
    prevented_access:
      'Document property rights, shared responsibilities, and informal agreements affecting your property',
    right_of_light:
      'Including but not limited to rights of light, customary rights, rights of support from adjoining properties, extraction rights',
    rights_of_support:
      'Document property rights, shared responsibilities, and informal agreements affecting your property',
    arrangements:
      "Mining and mineral rights, chancel repair liability and other people's rights to take things from the land (such as timber, hay or fish)",
    other_rights_and_arrangements:
      "Mining and mineral rights, chancel repair liability and other people's rights to take things from the land (such as timber, hay or fish)",
    chancel_repair_liability:
      'Record utility connections and service lines that cross property boundaries',
    service_crossing_the_property_or_neighboring_property:
      'Record utility connections and service lines that cross property boundaries',
  },
  parking: {
    parking_arrangements:
      'Document property rights, shared responsibilities, and informal agreements affecting your property',
    controlled_parking_zone_or_local_authority_schemes:
      'Document property rights, shared responsibilities, and informal agreements affecting your property',
  },
  otherCharges: {
    notes: 'You must read notes before starting ',
    charges_relating_to_the_property:
      'Document property rights, shared responsibilities, and informal agreements affecting your property',
  },
  occupiers: {
    notes: 'You must read notes before starting ',
    the_seller:
      'Document property rights, shared responsibilities, and informal agreements affecting your property',
    other_occupiers: 'eheheheh',
    lodgers_and_tenants: 'shahcdhsc',
    vacant_possession:
      'Document property rights, shared responsibilities, and informal agreements affecting your property',
  },
  services: {
    notes: 'You must read notes before starting ',
    electricity:
      'Document property rights, shared responsibilities, and informal agreements affecting your property',
    central_heating:
      'Document property rights, shared responsibilities, and informal agreements affecting your property',
    drainage_and_sewerage:
      'Document property rights, shared responsibilities, and informal agreements affecting your property',
    connection_to_services_and_utilities:
      'Document property rights, shared responsibilities, and informal agreements affecting your property',
  },
  transactionInformation: {
    transaction_information_questions:
      'Document property rights, shared responsibilities, and informal agreements affecting your property',
    special_requirements:
      'Document property rights, shared responsibilities, and informal agreements affecting your property',
    payment_of_mortgages_and_charges_after_the_sales_of_the_property:
      'Document property rights, shared responsibilities, and informal agreements affecting your property',
    seller_obligations:
      'Document property rights, shared responsibilities, and informal agreements affecting your property',
  },
  fixturesAndFittings: {
    notes: 'You must read notes before starting ',
    basic_fittings:
      'Essential fixtures and electrical installations throughout the property',
    kitchen: 'Appliances, fixtures, and fittings included in the kitchen',
    bathroom:
      'Bathroom fixtures, fittings, and accessories included with the property',
    carpets: 'Floor coverings and carpets remaining in each room',
    curtains_and_curtain_rails:
      'Window treatments, curtain rails, and blinds etc.',
    light_fittings:
      'Light fixtures and fittings remaining throughout the property',
    fitted_units:
      'Built-in storage, cupboards, shelves, and wardrobes included',
    outdoor_area:
      'Garden furniture, plants, and outdoor equipment included in the sale',
    televison_and_telephone:
      'Communication equipment and aerial installations included',
    stock_of_fuels:
      'Appliances, fixtures, and fittings included in the kitchen',
    other_items: 'Additional fixtures, fittings, or contents not listed above',
  },
  leasehold: {
    notes: 'You must read notes before starting ',
    lease_details:
      'Provide key details about the property lease including expiry and rent',
    the_property:
      'Essential fixtures and electrical installations throughout the property',
    ownership_and_management:
      'Appliances, fixtures, and fittings included in the kitchen',
    documents:
      'Bathroom fixtures, fittings, and accessories included with the property',
    contact_details: 'Floor coverings and carpets remaining in each room',
    maintenance_and_service_charges:
      'Window treatments, curtain rails, and blinds etc.',
    notices: 'Light fixtures and fittings remaining throughout the property',
    consents: 'Built-in storage, cupboards, shelves, and wardrobes included',
    complaints:
      'Garden furniture, plants, and outdoor equipment included in the sale',
    alterations: 'Communication equipment and aerial installations included',
    enfranchisement:
      'Appliances, fixtures, and fittings included in the kitchen',
    building_safety_cladding_and_the_leaseholder_deed_of_certificate:
      'Additional fixtures, fittings, or contents not listed above',
  },
  titleDeedsAndPlan: {
    title_deeds_review: 'Review title deeds and property plans',
  },
  searches: {
    searches_review: 'Review all property search results and reports',
  },
};

export const TASK_ORDERS: Record<string, Record<string, number>> = {
  ownershipProfile: {
    notes: 1,
    name_of_sellers_and_address_of_the_property: 2,
    seller_solicitor: 3,
    give_your_home_a_story: 4,
  },
  boundaries: {
    notes: 1,
    boundary_responsibilities: 2,
    irregular_boundaries: 3,
    moved_boundary_features: 4,
    adjacent_land_purchased: 5,
    complex_boundaries: 6,
    notices_under_the_party_wall_act_1996: 7,
  },
  disputesAndComplaints: {
    past_disputes_or_complaints: 1,
    prospective_disputes_or_complaints: 2,
  },
  noticesAndProposals: {
    received_or_sent_notices: 1,
    proposals_to_develop_or_alter: 2,
  },
  alterationsAndPlanning: {
    notes: 1,
    building_works: 2,
    unfinished_works: 3,
    breaches_of_consent_conditions: 4,
    planning_or_building_issues: 5,
    solar_panels: 6,
    solar_panels_ownership: 7,
    solar_panel_roof_lease: 8,
    listed_building: 9,
    conservation_orders: 10,
    tree_preservation_orders: 11,
  },
  guaranteesAndWarranties: {
    notes: 1,
    new_home_warranty: 2,
    damp_proofing: 3,
    timber_treatment: 4,
    window_roof_light_door: 5,
    electrical_work: 6,
    roofing: 7,
    central_heating: 8,
    underpinning: 9,
    other: 10,
    claims_made_under_guarantees_warranties: 11,
  },
  insurance: {
    seller_insurance: 1,
    landlord_insurance: 2,
    buildings_insurance: 3,
  },
  environmental: {
    notes: 1,
    Flooding: 2,
    radon: 3,
    energy_efficiency: 4,
    japanese_knotweed: 5,
  },
  rightsAndInformalArrangements: {
    notes: 1,
    resposibility_towards_jointly: 2,
    '2_dunno_how_id_surmise_this': 3,
    prevented_access: 4,
    right_of_light: 5,
    rights_of_support: 6,
    arrangements: 7,
    other_rights_and_arrangements: 8,
    chancel_repair_liability: 9,
    service_crossing_the_property_or_neighboring_property: 10,
  },
  parking: {
    parking_arrangements: 1,
    controlled_parking_zone_or_local_authority_schemes: 2,
  },
  otherCharges: {
    notes: 1,
    charges_relating_to_the_property: 2,
  },
  occupiers: {
    notes: 1,
    the_seller: 2,
    other_occupiers: 3,
    lodgers_and_tenants: 4,
    vacant_possession: 5,
  },
  services: {
    notes: 1,
    electricity: 2,
    central_heating: 3,
    drainage_and_sewerage: 4,
    connection_to_services_and_utilities: 5,
  },
  transactionInformation: {
    transaction_information_questions: 1,
    special_requirements: 2,
    payment_of_mortgages_and_charges_after_the_sales_of_the_property: 3,
    seller_obligations: 4,
  },
  fixturesAndFittings: {
    notes: 1,
    basic_fittings: 2,
    kitchen: 3,
    bathroom: 4,
    carpets: 5,
    curtains_and_curtain_rails: 6,
    light_fittings: 7,
    fitted_units: 8,
    outdoor_area: 9,
    televison_and_telephone: 10,
    stock_of_fuels: 11,
    other_items: 12,
  },
  leasehold: {
    notes: 1,
    lease_details: 2,
    the_property: 3,
    ownership_and_management: 4,
    documents: 5,
    contact_details: 6,
    maintenance_and_service_charges: 7,
    notices: 8,
    consents: 9,
    complaints: 10,
    alterations: 11,
    enfranchisement: 12,
    building_safety_cladding_and_the_leaseholder_deed_of_certificate: 13,
  },
  titleDeedsAndPlan: {
    title_deeds_review: 1,
  },
  searches: {
    searches_review: 1,
  },
};

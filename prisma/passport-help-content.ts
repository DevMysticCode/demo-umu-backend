/**
 * Passport Help Content
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO EDIT:
 *  1. Update QUESTION_HELP_CONTENT below with per-question guidance.
 *     Key format: "sectionKey.taskKey.questionTitleSlug"
 *     Use toSlug(questionTitle) to compute the slug for any question.
 *
 *  2. TASK_HELP_CONTENT (keyed by "sectionKey.taskKey") acts as a fallback
 *     for questions that have no matching entry in QUESTION_HELP_CONTENT.
 *     (Typically MULTIPART sub-questions with no distinct title.)
 *
 *  3. SECTION_HELP_CONTENT (keyed by "sectionKey") is shown on the Steps page.
 *
 *  4. Stop the backend → run: npx ts-node prisma/seed.ts
 *
 * GUIDANCE TEXT: Plain text. Use \n\n for paragraph breaks, • for bullets.
 * VIDEO URL: YouTube embed URL e.g. 'https://www.youtube.com/embed/VIDEO_ID'
 */

export interface HelpContent {
  sellerGuidance: string;
  buyerGuidance: string;
  disclaimer?: string;
  helpVideoUrl?: string;
}

/** Convert a question title to a URL/key slug (must match seed.ts logic). */
export function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const DISCLAIMER =
  'This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.';

// ─────────────────────────────────────────────────────────────────────────────
// PER-QUESTION HELP  (highest priority)
// Key: "sectionKey.taskKey.questionTitleSlug"
// Leave empty — fill via the CSV template returned by the client.
// ─────────────────────────────────────────────────────────────────────────────

export const QUESTION_HELP_CONTENT: Record<string, HelpContent> = {
  // Example (fill these in once the client returns the CSV):
  //
  // 'boundaries.boundary_responsibilities.looking_at_the_property_from_the_road_who_owns_or_accepts_responsibility_to_maintain_or_repair_the_boundary_features_on_each_side_of_the_property': {
  //   sellerGuidance: '...',
  //   buyerGuidance: '...',
  //   disclaimer: DISCLAIMER,
  // },
};

// ─────────────────────────────────────────────────────────────────────────────
// TASK-LEVEL HELP  (fallback when no per-question entry exists)
// Key: "sectionKey.taskKey"
// ─────────────────────────────────────────────────────────────────────────────

export const TASK_HELP_CONTENT: Record<string, HelpContent> = {

  // ── OWNERSHIP PROFILE ───────────────────────────────────────────────────────

  'ownershipProfile.notes': {
    sellerGuidance:
      'You are legally responsible for every answer you give. Providing misleading information — even accidentally — can result in the buyer claiming compensation after the sale completes.\n\nCheck your paperwork, not just your memory. Gather planning permissions, guarantees, warranties, and certificates before you start.\n\n• Answer everything — even if the answer is "not known"\n• Be truthful and complete — partial disclosure is almost as bad as none\n• Tell your solicitor immediately if any answers change before completion',
    buyerGuidance:
      "The seller's disclosure is your starting point, not your safety net. Use it alongside an independent building survey, your solicitor's searches, and your own observations from viewings.\n\nIf you receive any additional information about the property from the estate agent, seller, or online — tell your solicitor.\n\n• Sellers are legally responsible for their answers\n• 'Not known' is acceptable; blank answers are not\n• Misleading a buyer — even accidentally — can lead to compensation claims",
    disclaimer: DISCLAIMER,
  },

  'ownershipProfile.name_of_sellers_and_address_of_the_property': {
    sellerGuidance:
      "The legal owner of the property must complete this — the person or people named on the Land Registry title.\n\n• Standard owner: Complete it yourself\n• Executor or Administrator: Selling on behalf of a deceased estate — gather information from people who knew the property\n• Attorney: Must have valid legal authority to sell\n• Company seller: A director or authorised person completes the information\n\nALL sellers must sign. One person cannot sign on behalf of another without specific legal authority to do so.",
    buyerGuidance:
      "If the seller is an executor, attorney, or trustee, they may have limited personal knowledge of the property's history. Commission a thorough building survey and ask your solicitor about areas where the disclosure says 'not known.'\n\n• Must be completed by the legal owner named on the Land Registry title\n• ALL owners must sign — one cannot sign for another without legal authority",
    disclaimer: DISCLAIMER,
  },

  // ── BOUNDARIES ──────────────────────────────────────────────────────────────

  'boundaries.boundary_responsibilities': {
    sellerGuidance:
      "Check your title deeds before answering. Look for boundary markers:\n• A T-mark pointing inward toward your property = that boundary is your responsibility\n• An H-mark = shared responsibility with the neighbour\n\nIf you cannot find clear documentation, 'Not Known' is a valid and honest answer. Do not guess — a wrong guess can cause a dispute later.\n\nCommon misconceptions:\n• A fence on the left does not automatically mean the left boundary is yours\n• The presence of a fence does not indicate its ownership",
    buyerGuidance:
      "If you plan to erect a fence or build near a boundary, confirm which boundaries the seller owns before exchange. The physical boundary you see at a viewing may not match the legal boundary on the title plan.\n\nAsk your solicitor to investigate boundary responsibility if this matters to your plans.\n\n• Check title deeds for T-marks and H-marks\n• Physical fences do not automatically indicate legal ownership\n• Boundary disputes are one of the most common causes of neighbour conflicts",
    disclaimer: DISCLAIMER,
  },

  'boundaries.moved_boundary_features': {
    sellerGuidance:
      "You must disclose if you are aware of:\n• A fence, wall, hedge, or other boundary feature being moved\n• Land bought from a neighbour and added to the property\n• A neighbour building on or encroaching on any part of your property\n\nThis applies even if the change happened before your ownership — if you know about it, you must say so. Even if a boundary change feels like ancient history, disclose it. Your solicitor can help you frame the answer appropriately.",
    buyerGuidance:
      "If a boundary change is disclosed, ask your solicitor to check whether it is properly reflected in the Land Registry title. Compare what you see physically during your viewing with the title plan.\n\nAny discrepancy should be flagged to your solicitor immediately.\n\n• Changes not registered at Land Registry create legal uncertainty\n• Physical and legal boundaries do not always match",
    disclaimer: DISCLAIMER,
  },

  'boundaries.adjacent_land_purchased': {
    sellerGuidance:
      "If you have bought extra land from a neighbour and added it to the property, this must be disclosed. Check whether the additional land was properly registered at Land Registry at the time of purchase.\n\nIf it was not registered, tell your solicitor — this needs to be resolved before exchange.",
    buyerGuidance:
      "If additional land has been purchased and added to this property, ask your solicitor to verify it is correctly registered at Land Registry and forms part of the title you are buying.\n\n• Unregistered land additions create legal uncertainty\n• Your solicitor should confirm the full extent of the title before exchange",
    disclaimer: DISCLAIMER,
  },

  'boundaries.irregular_boundaries': {
    sellerGuidance:
      "If your property has an unusual or irregular boundary — one that differs from what appears on the title plan, follows an old watercourse, or where you have an informal agreement with a neighbour about where the boundary runs — this should be disclosed.\n\nIf you are not sure, 'Not Known' is acceptable. Walk your boundaries and compare with the title plan before answering.",
    buyerGuidance:
      "If an irregular boundary is disclosed, your solicitor should investigate further before you exchange contracts. Irregular boundaries can create uncertainty about legal ownership and affect future development or fencing plans.\n\n• Ask your solicitor to confirm the exact legal boundary before exchange",
    disclaimer: DISCLAIMER,
  },

  'boundaries.complex_boundaries': {
    sellerGuidance:
      "Check whether any part of your building physically extends beyond the legal boundary:\n• Overhanging roof eaves projecting into the neighbour's airspace\n• Gutters or pipes crossing the boundary line\n• Underground cellars extending beneath a neighbouring property\n\nFeatures that have been in place for a long time generally have established legal rights to remain — but they must be disclosed and documented. If you are not sure, your surveyor or solicitor can help you check.",
    buyerGuidance:
      "An overhanging feature is not automatically a dealbreaker. What matters is whether the right to maintain it is properly established in the title deeds.\n\nYour solicitor will check whether the feature is mentioned in the deeds or whether rights have been established through long use.\n\n• Indemnity insurance may be available if documentation is missing\n• Features crossing the boundary are more common than people think",
    disclaimer: DISCLAIMER,
  },

  'boundaries.notices_under_the_party_wall_act_1996': {
    sellerGuidance:
      "If you carried out building works near a shared boundary or party wall, you may have been required to serve formal written notice on your neighbours under the Party Wall etc. Act 1996.\n\nTriggered by: loft conversions, rear extensions, basement excavations, or any work to a shared wall.\n\nLook through your files for any party wall notices and party wall award documents. If you had work done and cannot find notices, tell your solicitor — indemnity insurance may be the solution.",
    buyerGuidance:
      "Party wall documentation confirms that relevant building work was carried out with proper legal notice to neighbours. If significant work was done without the required notice, your solicitor will advise whether this creates any risk.\n\n• Missing notices can be covered by indemnity insurance in some cases\n• Extensions, loft conversions, and deep excavations near shared boundaries typically require notice",
    disclaimer: DISCLAIMER,
  },

  // ── DISPUTES AND COMPLAINTS ──────────────────────────────────────────────────

  'disputesAndComplaints.past_disputes_or_complaints': {
    sellerGuidance:
      "You must disclose any disputes or complaints — past or current. This is broader than most sellers expect:\n• Formal legal disputes and solicitors' letters\n• Complaints to the council about a neighbour (or from a neighbour about you)\n• Arguments about noise, parking, access, boundaries, or trees\n\nResolved disputes still need to be disclosed. Be honest — your solicitor can help you phrase disclosures appropriately.\n\nFailing to disclose a known dispute is one of the most common grounds for post-completion compensation claims.",
    buyerGuidance:
      "If disputes are disclosed, ask for full details: what happened, when, who was involved, and how it was resolved. Ask your solicitor whether the underlying issue could recur.\n\nConsider making your own enquiries with neighbours before exchange.\n\n• Noise, parking, access, boundary, and tree disputes all count\n• Even minor, informal arguments must be disclosed if the seller is aware of them",
    disclaimer: DISCLAIMER,
  },

  'disputesAndComplaints.prospective_disputes_or_complaints': {
    sellerGuidance:
      "You must also disclose any anticipated or ongoing disputes — not just past ones. If there is an unresolved situation with a neighbour or third party that could develop into a formal dispute, this must be disclosed.\n\nBeing honest here protects you from post-completion claims. Your solicitor can help you phrase the disclosure appropriately.",
    buyerGuidance:
      "If any prospective or ongoing disputes are disclosed, ask your solicitor to investigate the situation thoroughly before exchange. Consider whether the issue could affect your enjoyment of the property or its future value.\n\n• An ongoing dispute can become more serious after you move in\n• Your solicitor can advise on how to protect your position",
    disclaimer: DISCLAIMER,
  },

  // ── NOTICES AND PROPOSALS ────────────────────────────────────────────────────

  'noticesAndProposals.received_or_sent_notices': {
    sellerGuidance:
      "Disclose any formal notices or official correspondence that might affect the property or surrounding area:\n• Planning applications from you or a neighbour\n• Council proposals for road changes or new parking restrictions\n• Tree preservation orders\n• Utility company notices about works in the area\n• Enforcement notices from the local authority\n\nGo through your paperwork and emails. Even planning consultation leaflets count.",
    buyerGuidance:
      "Even if nothing is disclosed, your solicitor's local authority search will pick up many relevant issues. However, searches have a time lag — very recent proposals may not appear.\n\nCheck the local planning portal directly if you are concerned about nearby development.\n\n• Disclose all formal notices and official correspondence received\n• Includes planning applications, road proposals, and enforcement actions",
    disclaimer: DISCLAIMER,
  },

  'noticesAndProposals.proposals_to_develop_or_alter': {
    sellerGuidance:
      "If you are aware of any proposals to develop or alter the property or surrounding area — including planning applications you have submitted or received, proposed road changes, or any other formal proposals — these must be disclosed.\n\nCheck your files and emails. Even planning consultation letters about nearby developments could be relevant.",
    buyerGuidance:
      "Your solicitor's local authority search will catch many things, but not the most recent proposals. Check the local planning portal directly if you are concerned about nearby development.\n\n• Proposals to develop nearby land can affect property value and enjoyment\n• Your solicitor can advise on the significance of any disclosed proposals",
    disclaimer: DISCLAIMER,
  },

  // ── ALTERATIONS AND PLANNING ─────────────────────────────────────────────────

  'alterationsAndPlanning.building_works': {
    sellerGuidance:
      "Disclose all significant building works:\n• Extensions, loft conversions, garage conversions, conservatories\n• Replacement windows and doors (since April 2002)\n• Removal of internal walls or chimney breasts\n• Any other structural or significant work\n\nThree types of documentation may be needed:\n1. Planning Permission — for works changing the external appearance\n2. Building Regulations Approval — for structural and safety-related works\n3. Competent Person Certificates — FENSA for windows, Gas Safe for gas, NICEIC for electrics\n\nGather all paperwork. If documents are lost, your solicitor can advise — sometimes they can be retrieved from the local authority or covered by indemnity insurance.",
    buyerGuidance:
      "Building works without proper documentation carry real risks. The work may not meet required standards and the local authority could require remediation.\n\nIf significant works are disclosed without corresponding approvals, your solicitor will advise on whether indemnity insurance is appropriate.\n\n• Permitted Development does not mean no documentation is needed\n• Missing certificates can often be covered by indemnity insurance",
    disclaimer: DISCLAIMER,
  },

  'alterationsAndPlanning.unfinished_works': {
    sellerGuidance:
      "Any building works that remain unfinished at the time of sale must be disclosed. Unfinished works can affect the buyer's mortgage offer, insurance, and the ability to obtain a completion certificate.\n\nBe clear about the current state of any works. If you intend to complete works before sale, this should be agreed and documented with your solicitor.",
    buyerGuidance:
      "Unfinished works are a significant concern. Ask what completion involves, how much it will cost, and whether a completion certificate can be obtained.\n\nFactor this into your offer and ensure your mortgage lender is aware.\n\n• Unfinished works can affect insurance and mortgage offers\n• Your solicitor should address this before exchange",
    disclaimer: DISCLAIMER,
  },

  'alterationsAndPlanning.breaches_of_consent_conditions': {
    sellerGuidance:
      "Planning permissions and building regulations approvals often come with conditions attached — restrictions on materials, landscaping obligations, or limits on use. If any condition has not been complied with, this must be disclosed.\n\nReview any planning permissions you hold and check whether all conditions have been met. Tell your solicitor about any you are not sure about.",
    buyerGuidance:
      "Ask your solicitor to check all planning permissions and their conditions as part of pre-exchange enquiries. Breaches of planning conditions can result in local authority enforcement action.\n\n• Indemnity insurance may be available for minor technical breaches\n• Your solicitor should confirm all conditions have been met before exchange",
    disclaimer: DISCLAIMER,
  },

  'alterationsAndPlanning.planning_or_building_issues': {
    sellerGuidance:
      "Disclose any outstanding planning or building control issues — including enforcement notices, stop notices, or any matters raised by the local authority relating to the property.\n\nIf in doubt, tell your solicitor. They can advise on whether the issue is significant and how to address it.",
    buyerGuidance:
      "Outstanding planning or building control issues can be serious. Your solicitor's pre-exchange searches and enquiries should reveal any enforcement activity.\n\nRaise any concerns with your solicitor before exchange.\n\n• Local authority searches will flag most planning enforcement matters\n• Indemnity insurance may be available in some circumstances",
    disclaimer: DISCLAIMER,
  },

  'alterationsAndPlanning.solar_panels': {
    sellerGuidance:
      "Two very different situations:\n\n1. You own the panels: You paid for them. They transfer with the property.\n2. Provider-owned under a roof lease: A company installed them free in exchange for a 20-25 year lease of your roof. The provider owns the panels — not you.\n\nA roof lease can affect the buyer's ability to get a mortgage. Contact your solar panel provider and gather all documentation: ownership details, any roof lease, FIT or SEG agreement, MCS certificate.",
    buyerGuidance:
      "Tell your mortgage lender about any solar arrangement before proceeding. Find out whether they will lend on properties with a roof lease — some lenders won't.\n\n• Owner-purchased panels: straightforward — transfer with the property\n• Provider-installed under a roof lease: complex — can affect mortgage availability\n• Check whether any Feed-in Tariff or Smart Export Guarantee income transfers to you",
    disclaimer: DISCLAIMER,
  },

  'alterationsAndPlanning.solar_panels_ownership': {
    sellerGuidance:
      "Confirm whether the solar panels are owned outright by you or are owned by a third party under a roof lease arrangement. Gather all relevant documentation before answering.\n\nIf panels are owned by a provider, provide the full lease documentation so the buyer's solicitor can assess the mortgage implications.",
    buyerGuidance:
      "Speak to your mortgage lender before proceeding if the panels are not owned outright by the seller. Some lenders refuse to lend on properties with solar roof leases.\n\n• Check the lease term and provider contact details\n• Confirm any income arrangements transfer correctly to you",
    disclaimer: DISCLAIMER,
  },

  'alterationsAndPlanning.solar_panel_roof_lease': {
    sellerGuidance:
      "Provide the full roof lease documentation including lease term, provider details, and any assignment or novation terms. The buyer's solicitor will need this to assess whether their mortgage lender will accept the property.\n\nContact your solar provider to confirm what documentation is required for a sale.",
    buyerGuidance:
      "Speak to your mortgage lender before exchange. Some lenders are comfortable with managed solar leases; others are not.\n\n• Confirm the lease term remaining and the provider's obligations\n• Ensure your solicitor reviews the lease terms carefully before exchange",
    disclaimer: DISCLAIMER,
  },

  'alterationsAndPlanning.listed_building': {
    sellerGuidance:
      "If the property is listed, you must declare this. Listed building consent is required for any alterations affecting the character of the building — inside AND outside. Enforcement has NO TIME LIMIT.\n\nThink carefully about any works carried out during your ownership. Was consent obtained? If any work was done without consent, your solicitor needs to know immediately.\n\nCheck your listing status at historicengland.org.uk/listing/the-list (England) or cadw.gov.wales (Wales).",
    buyerGuidance:
      "Commission a specialist listed buildings survey — not just a standard homebuyer report. Ask your solicitor to check the history of any alterations and whether listed building consent was obtained.\n\nYou are taking on legal responsibility for the building's listed status — including any work done by previous owners.\n\n• No time limit on enforcement action — applies to all owners past and present\n• A buyer can face action for unauthorised work done before their ownership",
    disclaimer: DISCLAIMER,
  },

  'alterationsAndPlanning.conservation_orders': {
    sellerGuidance:
      "Properties in conservation areas face additional planning controls. Even if your property is not listed, being in a conservation area affects what changes can be made without planning permission.\n\nDisclose conservation area status and any planning permissions obtained for works. If any works were done without required consents, tell your solicitor.",
    buyerGuidance:
      "Factor conservation area restrictions into your plans for the property. Extensions, external alterations, and satellite dish installation may all require planning permission.\n\nGet advice from the local planning authority about what changes are permitted before exchange.\n\n• Tree work in conservation areas requires council notification",
    disclaimer: DISCLAIMER,
  },

  'alterationsAndPlanning.tree_preservation_orders': {
    sellerGuidance:
      "A Tree Preservation Order (TPO) makes it illegal to cut down, top, lop, or damage a protected tree without council permission. Check with your local council if you are unsure whether any trees are protected.\n\nIf you have had any work done on trees, confirm that permission was obtained and provide any relevant documents. Conservation area trees have automatic protection even without a specific TPO.",
    buyerGuidance:
      "Trees with TPOs are a responsibility that transfers with the property. You cannot remove or significantly alter a protected tree without council permission — even if it is causing structural damage.\n\nFactor tree management and any restrictions into your plans before exchange.\n\n• TPO responsibilities transfer to the new owner\n• Tree restrictions can affect future planning applications for extensions or outbuildings",
    disclaimer: DISCLAIMER,
  },

  // ── GUARANTEES AND WARRANTIES ────────────────────────────────────────────────

  'guaranteesAndWarranties.new_home_warranty': {
    sellerGuidance:
      "If the property is relatively new, it may have a new home warranty (e.g. NHBC Buildmark) that provides protection against structural defects. Provide full documentation including the warranty certificate, policy number, and remaining term.\n\nIf the warranty has been transferred previously, provide transfer documentation.",
    buyerGuidance:
      "A new home warranty provides valuable protection against structural defects — particularly important in the first 10 years. Confirm the remaining term and what is covered.\n\n• Check whether the warranty transfers to you and at what cost\n• Ask your solicitor to review the warranty terms before exchange",
    disclaimer: DISCLAIMER,
  },

  'guaranteesAndWarranties.damp_proofing': {
    sellerGuidance:
      "If damp proofing work has been carried out at the property, provide the guarantee documentation including the company name, date of work, and guarantee period. Most damp proofing guarantees are transferable to a new owner.\n\nIf the guarantee has lapsed or you cannot find the documentation, tell your solicitor.",
    buyerGuidance:
      "A transferable damp proofing guarantee provides reassurance that the work was done professionally. Ask for the full guarantee documentation and check whether it transfers to you.\n\n• Confirm the guarantee is still within its term\n• Your surveyor should check for any evidence of damp during their inspection",
    disclaimer: DISCLAIMER,
  },

  'guaranteesAndWarranties.timber_treatment': {
    sellerGuidance:
      "If timber treatment work (for woodworm or rot) has been carried out, provide the guarantee certificate. These are typically 20-30 year guarantees and are transferable to new owners.\n\nLocate the documentation before listing. If it has been lost, contact the company that carried out the work — they may be able to reissue it.",
    buyerGuidance:
      "A timber treatment guarantee provides assurance that any infestation or rot has been professionally treated. Confirm the guarantee transfers to you and check the remaining term.\n\n• Your surveyor should inspect for any evidence of woodworm or rot\n• A new guarantee from a specialist may be available if the original has lapsed",
    disclaimer: DISCLAIMER,
  },

  'guaranteesAndWarranties.window_roof_light_door': {
    sellerGuidance:
      "Windows installed or replaced since April 2002 should have a FENSA certificate or equivalent. Provide all relevant certificates and any installer guarantees for windows, rooflights, or doors installed during your ownership.",
    buyerGuidance:
      "FENSA certificates confirm that window and door installations comply with building regulations. Ask for certificates for any glazing installed since 2002.\n\n• Missing FENSA certificates can sometimes be covered by indemnity insurance\n• Your solicitor will advise on the options available",
    disclaimer: DISCLAIMER,
  },

  'guaranteesAndWarranties.electrical_work': {
    sellerGuidance:
      "Provide any guarantees or warranties provided by electricians for work carried out during your ownership. This is separate from the compliance certificate — it covers the quality and safety of the work itself.\n\nGather all relevant paperwork and check guarantee periods.",
    buyerGuidance:
      "Electrical work guarantees provide reassurance about the quality and safety of the installation. Check the remaining guarantee period and whether it transfers to you.\n\n• For older properties, consider commissioning an independent EICR inspection",
    disclaimer: DISCLAIMER,
  },

  'guaranteesAndWarranties.roofing': {
    sellerGuidance:
      "If roofing work has been carried out, provide any guarantee documentation from the roofing company. Most reputable roofing companies provide 10-20 year guarantees.\n\nLocate the paperwork. If it has been lost, contact the company — they may be able to reissue it.",
    buyerGuidance:
      "A roofing guarantee provides important protection given the cost of roof repairs and replacement. Confirm the remaining term and whether the guarantee transfers to you.\n\n• Your surveyor should inspect the roof condition as part of their survey\n• A guarantee does not replace a thorough survey inspection",
    disclaimer: DISCLAIMER,
  },

  'guaranteesAndWarranties.central_heating': {
    sellerGuidance:
      "Provide any guarantee or service plan documentation for the central heating system. This includes the boiler installation certificate, annual service records, and any cover plan.\n\nMost boiler manufacturers provide 5-10 year guarantees. Gather all relevant paperwork.",
    buyerGuidance:
      "A heating guarantee and recent service history are important indicators of the system's condition. Check the boiler age — boilers typically last 10-15 years.\n\n• Confirm the service history and whether any guarantee transfers to you\n• Consider having an independent Gas Safe engineer inspect the system before exchange",
    disclaimer: DISCLAIMER,
  },

  'guaranteesAndWarranties.underpinning': {
    sellerGuidance:
      "If the property has been underpinned, this must be disclosed. Underpinning is significant structural work and will affect the buyer's mortgage and insurance arrangements.\n\nProvide all documentation: structural engineer's report, building regulations completion certificate, and any guarantees from the underpinning company. Be fully transparent with your solicitor.",
    buyerGuidance:
      "A property that has been underpinned requires careful consideration. Obtain an independent structural engineer's survey before exchange.\n\nSpeak to your mortgage lender and buildings insurer BEFORE exchange — some lenders and insurers impose conditions or decline cover for underpinned properties.\n\n• Full documentation of the work and any ongoing monitoring is essential\n• Your solicitor should review all structural reports carefully",
    disclaimer: DISCLAIMER,
  },

  // ── INSURANCE ────────────────────────────────────────────────────────────────

  'insurance.buildings_insurance': {
    sellerGuidance:
      "Sellers must maintain buildings insurance until completion. Provide details of the current insurer and policy. If any insurance claims have been made during your ownership, these must be disclosed.\n\nNote: If a claim has been made for subsidence, flooding, or major structural damage, this can affect the buyer's ability to obtain insurance at a standard rate.",
    buyerGuidance:
      "You must arrange buildings insurance from exchange of contracts — not completion. The property is at your risk from exchange.\n\nIf the seller has made claims for flooding, subsidence, or major structural damage, speak to your insurer BEFORE exchange to confirm you can obtain cover and at what cost.\n\n• Get quotes from multiple insurers before exchange\n• A history of flooding or subsidence can make insurance expensive or unavailable",
    disclaimer: DISCLAIMER,
  },

  'insurance.landlord_insurance': {
    sellerGuidance:
      "If the property is or has been let, provide details of any landlord insurance held. Disclose any claims made during your ownership.\n\nIf the property will be sold with tenants in place, the buyer will need to arrange their own landlord insurance from completion.",
    buyerGuidance:
      "If you are buying a property with tenants in place or plan to let it, you will need specialist landlord insurance. Standard buildings insurance does not cover let properties.\n\n• Arrange landlord insurance from the date you take ownership\n• Confirm the tenancy arrangements with your solicitor before exchange",
    disclaimer: DISCLAIMER,
  },

  // ── ENVIRONMENTAL ────────────────────────────────────────────────────────────

  'environmental.Flooding': {
    sellerGuidance:
      "You must disclose if any part of the property has ever been flooded — including the main building, garage, garden, or outbuildings. Even a single event must be disclosed.\n\nTypes to disclose:\n• Surface water flooding (heavy rainfall)\n• Groundwater flooding (rising water table)\n• River or coastal flooding\n• Sewer flooding\n\nAlso disclose any flood defences installed (barriers, sump pumps, air brick covers). Failing to disclose known flooding is one of the most common grounds for post-completion compensation claims.",
    buyerGuidance:
      "Carry out independent checks at gov.uk/check-flooding regardless of what is disclosed. Speak to your buildings insurer BEFORE exchange — find out if the property can be insured and at what cost.\n\nSome flooded properties carry enormous premiums or are practically uninsurable.\n\n• Check gov.uk/request-flooding-history for historical flood data\n• Factor insurance costs into your budget before committing to purchase",
    disclaimer: DISCLAIMER,
  },

  'environmental.radon': {
    sellerGuidance:
      "Radon is a naturally occurring radioactive gas — the second biggest cause of lung cancer in the UK. If a radon test has been carried out, share the results. If remediation has been done, provide the documentation — it is reassuring for buyers.\n\nYour solicitor's local authority search will indicate whether the property is in a Radon Affected Area.",
    buyerGuidance:
      "If the property is in a Radon Affected Area, a radon test is strongly advisable. Test kits cost around £50 and take a few months to produce a result.\n\nIf the result is above the recommended action level, remediation typically costs a few thousand pounds and is usually effective.\n\n• Areas at higher risk: Cornwall, Devon, parts of the Midlands, Yorkshire, and Wales\n• Remediation involves a sump system, improved ventilation, or sealing floors and walls",
    disclaimer: DISCLAIMER,
  },

  'environmental.japanese_knotweed': {
    sellerGuidance:
      "If you are aware of Japanese knotweed within or near the property boundary, you must disclose it. A property is considered at risk if knotweed is growing within 3 metres of the boundary.\n\nIf a professional management plan is in place, provide full documentation — it is a positive thing, showing the problem is being handled professionally.\n\n'Not known' is acceptable where you genuinely do not know.",
    buyerGuidance:
      "If knotweed is disclosed, speak to your mortgage lender BEFORE exchange. Some lenders will lend with a professional management plan in place; others will not lend until the property is clear.\n\n• Full eradication typically takes 3-5 years of professional management\n• Factor ongoing management costs into your budget\n• A professional management plan with insurance is the key reassurance for lenders",
    disclaimer: DISCLAIMER,
  },

  // ── SERVICES ────────────────────────────────────────────────────────────────

  'services.electricity': {
    sellerGuidance:
      "Since January 2005, significant electrical work must have a compliance certificate. Work requiring certification includes:\n• New circuit installations\n• Consumer unit or fuse box replacement\n• EV charging point installation\n• Electrical work in bathrooms or swimming pools\n\nFind the relevant certificates for any work done during your ownership. If you cannot find a certificate, contact the original electrician — they may be able to reissue it.",
    buyerGuidance:
      "For older properties (pre-1970s especially), consider commissioning an independent EICR (Electrical Installation Condition Report). Old wiring can be a safety concern and may affect your insurance.\n\n• Check with your home insurer whether old wiring affects your policy\n• An EICR is not legally required for sales but is strongly recommended for older properties",
    disclaimer: DISCLAIMER,
  },

  'services.central_heating': {
    sellerGuidance:
      "Gather all heating system documentation:\n• Boiler installation certificate (Gas Safe for gas boilers installed after April 2005)\n• Annual service records (boilers should be serviced annually)\n• Most recent boiler inspection report\n• Certificates for heat pumps, wood-burning stoves, or underfloor heating\n\nIf missing service records, check with your service provider — they may have records on file.",
    buyerGuidance:
      "Boiler age matters — boilers typically last 10-15 years. An old boiler approaching the end of its life could mean a £2,000-£4,000 replacement in the near future.\n\nConsider having an independent Gas Safe engineer inspect the system before exchange.\n\n• Ask for a demonstration that the heating is working correctly\n• Check when the boiler was last serviced and by whom",
    disclaimer: DISCLAIMER,
  },

  'services.drainage_and_sewerage': {
    sellerGuidance:
      "Most properties connect to mains drainage — confirm this is the case. If the property has a private system (septic tank, sewage treatment plant, or cesspool), provide full details.\n\nImportant: Since January 2020 in England, septic tanks cannot discharge directly to surface water (rivers, streams). If yours does, this must be disclosed and resolved — it is non-compliant.\n\nProvide: installation date, last service/emptying date, whether it is shared with neighbours, and maintenance records.",
    buyerGuidance:
      "If the property has a private sewerage system, establish the annual servicing cost, confirm current Environment Agency compliance, and check whether any part of the system is outside the property's boundaries.\n\nA non-compliant septic tank can cost tens of thousands to upgrade.\n\n• Ask your solicitor to obtain a drainage search before exchange\n• The drainage search will confirm whether the property is connected to mains sewerage",
    disclaimer: DISCLAIMER,
  },

  // ── LEASEHOLD ────────────────────────────────────────────────────────────────

  'leasehold.the_property': {
    sellerGuidance:
      "Provide full details of the lease: current unexpired term, annual ground rent and whether it escalates, service charge amounts for the last three years, and contact details for the freeholder and managing agent.\n\nIf the lease has fewer than 80 years remaining, expect this to affect the sale — buyers will face difficulty obtaining a mortgage and lease extension costs increase significantly below 80 years.",
    buyerGuidance:
      "Lease length is critical:\n• 80+ years: Generally fine for mortgages\n• Under 80 years: Extension becomes significantly more expensive\n• Under 70 years: Many lenders become cautious\n• Under 60 years: Most lenders will not lend\n\nAfter 2 years of ownership, you have a legal right to extend by 90 years at zero (peppercorn) ground rent. Factor the cost of this extension into your budget if the lease is short.",
    disclaimer: DISCLAIMER,
  },

  'leasehold.maintenance_and_service_charges': {
    sellerGuidance:
      "Provide three years of service charge accounts. Be transparent about:\n• The current annual service charge\n• Any planned major works\n• Any disputes about charges\n• Whether any service charges are currently outstanding\n\nAlso disclose any active or recent Section 20 consultation notices for major works.",
    buyerGuidance:
      "Calculate the full annual cost: ground rent (if any), service charge, and reserve fund contribution.\n\nKey questions:\n• Is the reserve fund healthy? No reserve = risk of sudden large special levies\n• Are major works planned in the next 3-5 years?\n• Is there an active Section 20 notice?\n\nDoubling ground rents can make a property unmortgageable — check the ground rent escalation clause carefully.",
    disclaimer: DISCLAIMER,
  },

  'leasehold.building_safety_cladding_and_the_leaseholder_deed_of_certificate': {
    sellerGuidance:
      "Following the Grenfell Tower fire, the Building Safety Act 2022 requires leaseholders to complete a Leaseholder Deed of Certificate before selling. Complete this accurately before listing.\n\nAlso:\n• Provide the Landlord's Certificate if you have received one\n• Notify the freeholder of your intention to sell\n• Your solicitor must have Building Safety Act expertise\n\nBe fully transparent about any known remediation works or building safety issues.",
    buyerGuidance:
      "This is potentially the most important question for flats built after around 1990. Before exchange:\n• Request the Leaseholder Deed of Certificate and Landlord's Certificate\n• Confirm with your mortgage lender whether they will lend on this property\n• Ensure your solicitor has specialist Building Safety Act expertise\n• Check whether the building is part of an approved remediation scheme\n\nThis is a rapidly evolving area of law. Get specialist advice early.",
    disclaimer: DISCLAIMER,
  },

  // ── FIXTURES AND FITTINGS ────────────────────────────────────────────────────

  'fixturesAndFittings.basic_fittings': {
    sellerGuidance:
      "Go through every category carefully and mark each item: Included, Excluded, or None.\n\nGenerally stays (fixtures — attached to the building):\n• Fitted kitchen units and integrated appliances\n• Bathroom fittings, light fittings, built-in wardrobes\n• Central heating system\n\nGenerally goes (chattels — movable items):\n• Freestanding appliances, curtains, garden furniture, plants in pots\n\nIf taking something a buyer might expect to stay (like a designer light fitting), mark it excluded early — before viewings begin.",
    buyerGuidance:
      "Read the fittings list carefully. Do not assume anything stays — verify it is marked as included. If something you saw during a viewing matters to you, confirm it is included before exchange.\n\nVerbal agreements about what is staying mean nothing unless they appear in the written list.\n\n• The fittings and contents list can form part of the legal sale contract\n• Any discrepancy on moving day is much harder to resolve after completion",
    disclaimer: DISCLAIMER,
  },

  'fixturesAndFittings.light_fittings': {
    sellerGuidance:
      "Light fittings are legally fixtures and stay with the property unless specifically excluded before exchange. If you want to take a light fitting:\n1. Mark it as excluded before exchange of contracts\n2. Replace it with a basic fitting before completion (ceiling rose, flex, bulb holder, bulb)\n\nLeaving bare wires is a breach of contract AND a safety hazard. Decide what you are taking before viewings begin — not after exchange.",
    buyerGuidance:
      "If a light fitting you expected to stay is not marked as included, flag this before exchange — not after. At the final inspection on completion morning, verify all excluded fittings have been properly replaced.\n\n• Bare wires left by the seller are unacceptable and must be resolved before funds are released\n• Designer or specialist fittings are commonly excluded — check the list carefully",
    disclaimer: DISCLAIMER,
  },

  // ── TRANSACTION INFORMATION ──────────────────────────────────────────────────

  'transactionInformation.transaction_information_questions': {
    sellerGuidance:
      "This section covers the practical details of your sale — including whether the sale is dependent on you purchasing another property on the same day (a chain), your proposed completion date, and whether you can offer vacant possession.\n\nBe realistic about your timeline. Chain-dependent sales carry more risk of falling through.",
    buyerGuidance:
      "Understanding the seller's chain situation is important. A chain-dependent sale is more complex and carries greater risk of delays or collapse.\n\n• Confirm the seller can offer vacant possession on completion\n• Ask about the length and stability of the chain\n• Your solicitor will coordinate with other solicitors in the chain",
    disclaimer: DISCLAIMER,
  },

};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION-LEVEL HELP
// Key: sectionKey  (shown on the Steps page for the whole section)
// ─────────────────────────────────────────────────────────────────────────────

export const SECTION_HELP_CONTENT: Record<string, HelpContent> = {

  ownershipProfile: {
    sellerGuidance:
      "The Ownership Profile section sets out who owns the property and the basic facts about the sale. Gather your Land Registry title documents, solicitor details, and any relevant certificates before you start.\n\nYou are legally responsible for every answer you give. Be thorough and accurate — your solicitor can help if you are unsure about anything.",
    buyerGuidance:
      "The Ownership Profile section gives you the basic facts about who owns the property and who you are dealing with. Review this alongside your solicitor's Land Registry searches to confirm ownership is as stated.\n\n• Verify the sellers named here match the Land Registry title\n• Ask your solicitor if anything in this section seems unclear",
    disclaimer: DISCLAIMER,
  },

  boundaries: {
    sellerGuidance:
      "The Boundaries section asks you to confirm responsibility for each side of your property and disclose any historical changes. Check your title deeds for T-marks and H-marks before answering.\n\nBoundary disputes are one of the most common causes of property sale delays — clear, honest answers here protect you from post-completion claims.",
    buyerGuidance:
      "Boundary information tells you who is responsible for maintaining fences, walls, and hedges. Review this alongside the title plan carefully.\n\nIf you plan to build near or on any boundary, ask your solicitor to confirm responsibility before exchange.\n\n• Physical boundaries may not match the legal title plan\n• Boundary disputes can be expensive and time-consuming to resolve",
    disclaimer: DISCLAIMER,
  },

  disputesAndComplaints: {
    sellerGuidance:
      "This section requires honest disclosure of all disputes and complaints — past and present, formal and informal. Even resolved disputes must be disclosed if you are aware of them.\n\nFailing to disclose known disputes is one of the most common grounds for post-completion compensation claims. Your solicitor can help you phrase disclosures appropriately.",
    buyerGuidance:
      "Review all disclosed disputes carefully. Consider making your own enquiries with neighbours before exchange — not all neighbourhood situations will be captured in formal disclosures.\n\n• Ask your solicitor whether any disclosed dispute could recur after you move in\n• A history of disputes can affect your enjoyment of the property",
    disclaimer: DISCLAIMER,
  },

  noticesAndProposals: {
    sellerGuidance:
      "This section covers formal notices and official correspondence that could affect the property or surrounding area. Go through your paperwork and emails carefully — even planning consultation leaflets count.\n\nDisclose everything you are aware of. Your solicitor's searches will pick up much of this, but recent proposals may not yet appear in searches.",
    buyerGuidance:
      "Your solicitor's local authority search will reveal most planning and notice history — but searches have a time lag. Check the local planning portal directly if you are concerned about nearby development.\n\n• Road proposals, planning applications, and utility notices can all affect a property's value and enjoyment\n• Raise anything concerning with your solicitor before exchange",
    disclaimer: DISCLAIMER,
  },

  alterationsAndPlanning: {
    sellerGuidance:
      "This section covers all building works, alterations, and planning matters at the property. Gather all paperwork: planning permissions, building regulations completion certificates, and competent person certificates.\n\nMissing documentation can delay a sale — or require indemnity insurance. Better to find it early than during the conveyancing process.",
    buyerGuidance:
      "Review all disclosed works carefully. Building works without proper documentation carry real risks — the local authority could require remediation.\n\nYour solicitor will check planning history as part of their pre-exchange searches.\n\n• Ask for all certificates related to any disclosed works\n• Missing certificates can sometimes be covered by indemnity insurance",
    disclaimer: DISCLAIMER,
  },

  guaranteesAndWarranties: {
    sellerGuidance:
      "Transferable guarantees and warranties are a real selling point. Gather all guarantee certificates: damp proofing, timber treatment, window (FENSA), roofing, boiler, and any new home warranty.\n\nCheck whether each guarantee is still within its term and whether it is transferable. Contact the issuing company if you have lost the paperwork.",
    buyerGuidance:
      "Transferable guarantees provide valuable protection after purchase. Check the remaining term on each guarantee and confirm it transfers to you.\n\n• A guarantee does not replace a thorough independent survey\n• Check whether any claims have been made under any guarantee\n• Ask your solicitor to confirm transfer arrangements",
    disclaimer: DISCLAIMER,
  },

  insurance: {
    sellerGuidance:
      "Sellers must maintain buildings insurance until completion. Disclose any claims made during your ownership — particularly for flooding, subsidence, or major structural damage, as these can affect the buyer's ability to obtain cover.\n\nProvide your current insurer details and policy information.",
    buyerGuidance:
      "You must arrange buildings insurance from exchange of contracts — not completion. The property is at your risk from exchange.\n\nIf the seller has made claims for flooding, subsidence, or major structural damage, get insurance quotes BEFORE exchange to confirm you can obtain cover and at what cost.\n\n• A history of major claims can make insurance expensive or unavailable\n• Do not rely on the seller's policy after exchange",
    disclaimer: DISCLAIMER,
  },

  environmental: {
    sellerGuidance:
      "Honest disclosure of environmental matters is legally required and protects you from post-completion compensation claims. Be especially thorough on flooding — even garden flooding, even a single event, even if it happened before your ownership.\n\nIf in doubt about any environmental matter, ask your solicitor before answering.",
    buyerGuidance:
      "Environmental matters can significantly affect a property's value, insurability, and your enjoyment of it. Carry out independent checks regardless of what is disclosed:\n\n• Flooding: gov.uk/check-flooding\n• Radon: check with your solicitor's local authority search\n• Japanese knotweed: ask your surveyor to look during their inspection",
    disclaimer: DISCLAIMER,
  },

  rightsAndInformalArrangements: {
    sellerGuidance:
      "This section covers rights of way, easements, shared access arrangements, and any informal agreements affecting the property. Document everything — including arrangements that feel informal or historic.\n\nAn undocumented arrangement can cause significant problems for a buyer and could come back to affect you if not properly disclosed.",
    buyerGuidance:
      "Rights and informal arrangements can affect how you use and enjoy the property. Ask your solicitor to investigate any disclosed rights before exchange.\n\n• Rights of way may limit what you can do with parts of the property\n• Informal arrangements are difficult to enforce without documentation\n• Your solicitor's searches will reveal registered rights",
    disclaimer: DISCLAIMER,
  },

  parking: {
    sellerGuidance:
      "Provide full details of parking arrangements: allocated spaces, garage, permit schemes, or informal arrangements. If parking is via a permit scheme, provide details of the scheme and current permit status.\n\nIf parking arrangements are informal (e.g. by agreement with a neighbour), document this and tell your solicitor.",
    buyerGuidance:
      "Confirm the parking arrangements carefully before exchange. If parking is via a permit scheme, check availability and cost.\n\n• Verify that any allocated space or garage is included in the sale\n• Informal parking arrangements may not be enforceable\n• Ask your solicitor to confirm parking rights are properly documented",
    disclaimer: DISCLAIMER,
  },

  otherCharges: {
    sellerGuidance:
      "Disclose any financial charges or obligations attached to the property beyond the mortgage — such as rentcharges, estate management charges, or overage agreements.\n\nThese are obligations that transfer to the buyer with the property. Your solicitor can help you identify and disclose them correctly.",
    buyerGuidance:
      "Check for any ongoing financial charges attached to the property. Estate management charges are increasingly common on new-build estates and can amount to hundreds of pounds per year.\n\n• Ask your solicitor to check for rentcharges, overage clauses, and estate charges\n• These charges transfer with the property and become your responsibility",
    disclaimer: DISCLAIMER,
  },

  occupiers: {
    sellerGuidance:
      "Disclose who currently lives in or occupies the property. If there are tenants or lodgers, their rights must be properly managed as part of the sale.\n\nAll adult occupiers (17 or over) who are not named sellers may need to sign a waiver of their rights before completion. Tell your solicitor about all occupiers.",
    buyerGuidance:
      "Confirm the property will be sold with vacant possession unless specifically agreed otherwise. All occupiers must vacate by completion.\n\n• Adult occupiers (other than the sellers) may have legal rights over the property\n• Your solicitor will ensure all occupier rights are properly addressed before exchange",
    disclaimer: DISCLAIMER,
  },

  services: {
    sellerGuidance:
      "This section covers all services connected to the property. Gather compliance certificates for any work done:\n• Gas Safe certificate for boiler installation (post April 2005)\n• FENSA or building regulations approval for windows\n• Electrical compliance certificates\n• HETAS certificate for wood-burning stoves\n\nProvide service records for heating and any other maintained systems.",
    buyerGuidance:
      "Services are often overlooked but can represent significant future costs. Key things to check:\n• Boiler age and service history\n• Whether private drainage is compliant (especially septic tanks)\n• Electrical system age and condition\n\nConsider commissioning independent inspections of heating and electrical systems before exchange.",
    disclaimer: DISCLAIMER,
  },

  transactionInformation: {
    sellerGuidance:
      "This section covers the practical details of the transaction. Be realistic about your timeline and chain situation. Delays caused by inaccurate information at this stage can cause the whole chain to collapse.\n\nConfirm with your solicitor that all financial obligations (mortgages, charges) can be repaid from the sale proceeds.",
    buyerGuidance:
      "Understanding the transaction details helps you plan your move and assess the risk of the purchase.\n\n• A chain-dependent sale carries more risk of delays or collapse\n• Confirm vacant possession arrangements and the proposed completion date\n• Your solicitor will coordinate the completion timetable",
    disclaimer: DISCLAIMER,
  },

  fixturesAndFittings: {
    sellerGuidance:
      "The fittings and contents list can form part of the legal sale contract — be accurate and complete. Go through every room and mark each item as Included, Excluded, or None.\n\nDecide what you are taking before viewings begin. Buyers form expectations during viewings — surprising them at exchange causes delays and disputes.",
    buyerGuidance:
      "Read the fittings list carefully and verify it matches what you saw during viewings. If something matters to you — an integrated appliance, a garden structure, a designer fitting — confirm it is marked as included before exchange.\n\n• Do not rely on verbal assurances\n• Check the list against your own viewing notes\n• Any dispute about fittings is much harder to resolve after completion",
    disclaimer: DISCLAIMER,
  },

  leasehold: {
    sellerGuidance:
      "Leasehold sales are more complex than freehold. Gather all documentation early:\n• Current lease document\n• Three years of service charge accounts\n• Ground rent details and any escalation clauses\n• Managing agent contact details\n• Building safety documentation (if applicable)\n\nIf the lease has fewer than 80 years remaining, discuss the implications with your solicitor before listing.",
    buyerGuidance:
      "Leasehold is significantly different from freehold. Review all lease details carefully:\n• Check the unexpired lease term — under 80 years is expensive to extend\n• Check the ground rent escalation clause — doubling ground rents can make a property unmortgageable\n• Check the service charge history and reserve fund\n\nGet specialist leasehold advice from your solicitor before exchange.",
    disclaimer: DISCLAIMER,
  },

  titleDeedsAndPlan: {
    sellerGuidance:
      "Provide any original title deeds or documents you hold relating to the property. These support the Land Registry title and may contain important information about rights and restrictions.\n\nIf you cannot find the deeds, your solicitor can obtain office copies from Land Registry.",
    buyerGuidance:
      "Your solicitor will obtain official copies of the title from Land Registry. Review the title plan carefully to confirm the extent of what you are buying.\n\n• The title plan should match the physical boundaries you have inspected\n• Any restrictions or covenants on the title will be revealed by your solicitor's searches",
    disclaimer: DISCLAIMER,
  },

  searches: {
    sellerGuidance:
      "Property searches are carried out by the buyer's solicitor. As a seller, you should be aware that searches will reveal planning history, road proposals, drainage connections, environmental matters, and local authority information about the property and surrounding area.\n\nEnsure all your disclosures are consistent with what searches are likely to reveal.",
    buyerGuidance:
      "Your solicitor will carry out a standard set of searches including local authority, drainage, and environmental searches. Additional searches may be recommended depending on the property's location.\n\n• Searches take time — allow 2-4 weeks for results\n• Additional searches (e.g. coal mining, flood) may be relevant depending on location\n• Your solicitor will advise on which searches are appropriate",
    disclaimer: DISCLAIMER,
  },

};

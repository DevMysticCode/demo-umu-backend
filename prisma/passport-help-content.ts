/**
 * Passport Help Content
 * ─────────────────────────────────────────────────────────────────────────────
 * SOURCE: UK_Property_Education_Database.csv
 *
 * How to edit:
 *  1. Update the content below (MAIN_EXPLANATION + KEY_POINTS + guidance).
 *  2. Stop the backend: npm run stop (or Ctrl+C)
 *  3. Run: npx ts-node prisma/seed.ts
 *
 * Key format: "sectionKey.taskKey"
 * All question templates belonging to that task will receive this help content.
 *
 * helpVideoUrl: Leave as undefined until the video is recorded and uploaded.
 *               Set to a YouTube embed URL e.g. 'https://www.youtube.com/embed/VIDEO_ID'
 */

export interface HelpContent {
  mainExplanation: string;
  keyPoints: string[];
  sellerGuidance?: string;
  buyerGuidance?: string;
  disclaimer?: string;
  helpVideoUrl?: string;
}

export const TASK_HELP_CONTENT: Record<string, HelpContent> = {

  // ── GETTING STARTED ─────────────────────────────────────────────────────────

  'ownershipProfile.notes': {
    mainExplanation:
      "When you sell a home, the buyer is making one of the largest financial decisions of their life. The questions you answer give them the information they need to make that decision safely — and your answers can form part of the binding sale contract.\n\nYou are legally responsible for your answers. Providing misleading information — even accidentally — can result in the buyer claiming compensation after the sale completes.\n\nLeaving questions blank is not the same as saying 'not known.' Blanks cause delays and raise red flags. If you genuinely don't know something, say so explicitly.",
    keyPoints: [
      "Answer everything — even if the answer is 'not known'",
      "Be truthful and complete — partial disclosure is almost as bad as none",
      "Tell your solicitor immediately if any answers change before completion",
      "Sellers are legally responsible for their answers",
      "Misleading a buyer — even accidentally — can lead to compensation claims",
    ],
    sellerGuidance:
      "Check your paperwork — not just your memory. Gather planning permissions, guarantees, warranties, and certificates before you start. If something changes after you have submitted your answers, tell your solicitor immediately.",
    buyerGuidance:
      "The seller's disclosure is your starting point, not your safety net. Use it alongside an independent building survey, your solicitor's searches, and your own observations from viewings. If you receive any additional information about the property from the estate agent, seller, or online, tell your solicitor.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'ownershipProfile.name_of_sellers_and_address_of_the_property': {
    mainExplanation:
      "The legal owner of the property must answer — the person or people named on the Land Registry title or the title deeds.\n\n• Standard owner: Complete it yourself as the registered owner\n• Executor or Administrator: Selling on behalf of a deceased estate — gather information from people who knew the property\n• Attorney: Completing under a power of attorney — must have valid legal authority to sell\n• Trustee: Completing on behalf of a trust arrangement\n• Company seller: A director or person authorised by a director completes the information\n\nThe Signing Rule: ALL sellers must sign. If two or more people own the property, every owner must sign. One person cannot sign on behalf of another without specific legal authority to do so.",
    keyPoints: [
      "Must be completed by the legal owner named on the Land Registry title",
      "ALL owners must sign — one cannot sign for another without legal authority",
      "Executors, attorneys, and trustees can complete it — but remain legally responsible",
      "When in doubt, ask your solicitor before starting",
    ],
    sellerGuidance:
      "Check who is named on the Land Registry title — those are the people who need to sign. If anyone named has died or lost capacity, tell your solicitor before you begin. If acting as executor, gather whatever paperwork exists and note where gaps are.",
    buyerGuidance:
      "If the seller is an executor, attorney, or trustee, they may have limited personal knowledge of the property's history. Commission a thorough building survey and ask your solicitor about areas where the disclosure says 'not known.'",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  // ── BOUNDARIES ──────────────────────────────────────────────────────────────

  'boundaries.boundary_responsibilities': {
    mainExplanation:
      "Looking at your property from the road, you will be asked who owns or is responsible for maintaining the boundary features on each side. The options are: You / Your Neighbour / Shared / Not Known.\n\nHow to find out: Check your title deeds for boundary markers:\n• A T-mark pointing inward toward your property = that boundary is your responsibility\n• An H-mark = shared responsibility with the neighbour\n\nIf you cannot find clear documentation, 'Not Known' is a valid and honest answer. Do not guess.\n\nCommon misconceptions:\n• A fence on the left does not automatically mean the left boundary is your responsibility\n• Title plans show general boundary positions, not precise legal lines\n• The presence of a fence does not indicate its ownership",
    keyPoints: [
      "Check title deeds for T-marks and H-marks before answering",
      "'Not Known' is always better than guessing",
      "Physical fences do not automatically indicate legal ownership",
      "Boundary disputes are one of the most common causes of neighbour conflicts",
    ],
    sellerGuidance:
      "Check your title deeds before answering. If you are not sure, 'Not Known' is always better than a wrong guess that later causes a dispute.",
    buyerGuidance:
      "If you plan to erect a fence or build near a boundary, confirm which boundaries you own before exchange. The physical boundary you see at a viewing may not match the legal boundary on the title plan. Ask your solicitor to investigate if this matters to your plans.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'boundaries.moved_boundary_features': {
    mainExplanation:
      "You need to disclose if you are aware of:\n• A fence, wall, hedge, or other boundary feature being moved\n• Land bought from a neighbour and added to the property\n• A neighbour building on or encroaching on any part of your property\n• Any change in how physical boundaries relate to the title plan\n\nThis applies even if the change happened before your ownership — if you know about it, you must disclose it.\n\nAn undocumented boundary change can cause serious legal complications for a buyer. If the physical boundaries do not match the official Land Registry title plan, future disputes become harder to resolve.",
    keyPoints: [
      "Disclose any boundary changes you are aware of — even historic ones",
      "Changes that are not registered at Land Registry create legal uncertainty",
      "Physical and legal boundaries do not always match",
      "Your solicitor can advise on how to handle this in the sale",
    ],
    sellerGuidance:
      "Even if a boundary change feels like ancient history, disclose it. Your solicitor can help you frame the answer appropriately. If you bought extra land from a neighbour, check whether it was properly registered at the time.",
    buyerGuidance:
      "If a boundary change is disclosed, ask your solicitor to check whether it is properly reflected in the Land Registry title. Compare what you see physically during your viewing with the title plan. Any discrepancy should be flagged to your solicitor immediately.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'boundaries.adjacent_land_purchased': {
    mainExplanation:
      "You need to disclose if you are aware of:\n• A fence, wall, hedge, or other boundary feature being moved\n• Land bought from a neighbour and added to the property\n• A neighbour building on or encroaching on any part of your property\n• Any change in how physical boundaries relate to the title plan\n\nThis applies even if the change happened before your ownership — if you know about it, you must disclose it.",
    keyPoints: [
      "Disclose any boundary changes you are aware of — even historic ones",
      "Changes that are not registered at Land Registry create legal uncertainty",
      "Physical and legal boundaries do not always match",
    ],
    sellerGuidance:
      "Even if a boundary change feels like ancient history, disclose it. If you bought extra land from a neighbour, check whether it was properly registered at the time.",
    buyerGuidance:
      "If a boundary change is disclosed, ask your solicitor to check whether it is properly reflected in the Land Registry title.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'boundaries.irregular_boundaries': {
    mainExplanation:
      "Some properties have boundaries that do not follow a straight line or that differ from what appears on the title plan. This can happen due to historic land use, informal agreements between neighbours, or mapping inaccuracies.\n\nIf your property has an unusual or irregular boundary feature — such as a boundary that cuts through a building, follows an old watercourse, or differs from what a neighbour believes — this should be disclosed.",
    keyPoints: [
      "Irregular boundaries can create uncertainty about legal ownership",
      "Disclose any known discrepancies between the physical boundary and the title plan",
      "'Not Known' is acceptable where you have no specific knowledge",
      "Your solicitor can advise on how to document irregular boundaries",
    ],
    sellerGuidance:
      "Look at your title plan and walk your boundaries. If anything seems inconsistent, mention it to your solicitor before answering.",
    buyerGuidance:
      "If an irregular boundary is disclosed, your solicitor should investigate further before exchange.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'boundaries.complex_boundaries': {
    mainExplanation:
      "Some buildings have physical elements that extend beyond the legal boundary. These are more common than people think. Examples include:\n• Overhanging roof eaves projecting into the neighbour's airspace\n• Gutters or pipes crossing the boundary line\n• Underground cellars extending beneath a neighbouring property or public pavement\n• Upper-storey rooms sitting above a neighbour's passageway\n\nFeatures that have been in place for a long time — especially those mentioned in the title deeds — generally have established legal rights to remain. But they need to be properly documented so the buyer understands what they are taking on.",
    keyPoints: [
      "Features crossing the boundary are more common than people think",
      "Long-established features usually have legal rights to remain",
      "They must be disclosed so they can be addressed in the legal documents",
      "Indemnity insurance may be available if documentation is missing",
    ],
    sellerGuidance:
      "Look carefully at your building from the outside. Do your eaves, gutters, or pipes cross into next door's airspace? If you are not sure, your surveyor or solicitor can help you check. Disclose anything you are aware of.",
    buyerGuidance:
      "An overhanging feature is not automatically a dealbreaker. What matters is whether the right to maintain it is properly established. Your solicitor will check whether the feature is mentioned in the title deeds or whether rights have been established through long use.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'boundaries.notices_under_the_party_wall_act_1996': {
    mainExplanation:
      "Certain building works near a shared boundary or party wall require you to give your neighbours formal written notice before you start. This is a legal requirement under the Party Wall etc. Act 1996.\n\nWhen is notice required:\n• Constructing a new wall on or at the boundary line\n• Carrying out work to a shared wall — including extensions\n• Excavating within 3-6 metres of a neighbouring building\n\nCommon projects that trigger this: loft conversions, rear extensions, basement excavations.\n\nWhat notice looks like: A formal written notice sent to each affected neighbour. Any resulting agreement is documented in a Party Wall Award. Missing party wall notices for relevant work can raise questions about whether the work was done correctly.",
    keyPoints: [
      "The Party Wall Act requires formal written notice before certain works near shared boundaries",
      "Triggered by: extensions using shared walls, loft conversions, deep excavations",
      "All notices and party wall awards should be provided with the property information",
      "Missing notices can be covered by indemnity insurance in some cases",
    ],
    sellerGuidance:
      "Look through your files for any party wall notices sent to or received from neighbours, and any party wall award or agreement documents. If you had work done and cannot find notices, tell your solicitor — indemnity insurance may be the solution.",
    buyerGuidance:
      "Party wall documentation shows that relevant building work was carried out with proper legal notice to neighbours. If significant work was done without the required notice, ask your solicitor to assess whether this creates any risk.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  // ── DISPUTES AND COMPLAINTS ──────────────────────────────────────────────────

  'disputesAndComplaints.past_disputes_or_complaints': {
    mainExplanation:
      "You must disclose any disputes or complaints — past or current. This is broader than most sellers expect. It includes:\n• Formal legal disputes and solicitors' letters\n• Complaints to the council about a neighbour (or from a neighbour about you)\n• Arguments about noise, parking, access, boundaries, or trees\n• Disputes about shared facilities or communal areas\n\nResolved disputes still need to be disclosed. Even if something was sorted out amicably years ago, if you are aware of it, you must say so.\n\nFailing to disclose a known dispute that a buyer later discovers is one of the most common grounds for post-completion compensation claims.",
    keyPoints: [
      "Disclose ALL disputes — past or present, formal or informal",
      "Resolved disputes still need to be disclosed",
      "Noise, parking, access, boundary, and tree disputes all count",
      "Hiding a known dispute is a common ground for post-completion compensation claims",
    ],
    sellerGuidance:
      "Be honest, even if it feels uncomfortable. Your solicitor can help you phrase disclosures appropriately. Ask yourself: any formal complaints? Any argument involving a professional or the council? If yes, disclose it.",
    buyerGuidance:
      "If disputes are disclosed, ask for full details: what happened, when, who was involved, and how it was resolved. Ask your solicitor whether the underlying issue could recur. Consider making your own enquiries with neighbours before exchange.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'disputesAndComplaints.prospective_disputes_or_complaints': {
    mainExplanation:
      "You must disclose any disputes or complaints — past or current. This is broader than most sellers expect. It includes:\n• Formal legal disputes and solicitors' letters\n• Complaints to the council about a neighbour (or from a neighbour about you)\n• Arguments about noise, parking, access, boundaries, or trees\n• Disputes about shared facilities or communal areas\n\nFailing to disclose a known dispute that a buyer later discovers is one of the most common grounds for post-completion compensation claims.",
    keyPoints: [
      "Disclose ALL disputes — past or present, formal or informal",
      "Resolved disputes still need to be disclosed",
      "Noise, parking, access, boundary, and tree disputes all count",
      "Hiding a known dispute is a common ground for post-completion compensation claims",
    ],
    sellerGuidance:
      "Be honest, even if it feels uncomfortable. Your solicitor can help you phrase disclosures appropriately.",
    buyerGuidance:
      "Ask your solicitor whether any disclosed issues could recur. Consider making your own enquiries with neighbours before exchange.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  // ── NOTICES AND PROPOSALS ────────────────────────────────────────────────────

  'noticesAndProposals.received_or_sent_notices': {
    mainExplanation:
      "You should disclose any formal notices or official correspondence that might affect the property or the surrounding area, including:\n• Planning applications from you or a neighbour\n• Council proposals for road changes or new parking restrictions\n• Compulsory purchase proposals or consultations\n• Conservation area or listed building designation consultations\n• Tree preservation orders being placed on trees\n• Notices from utility companies about works in the area\n• Enforcement notices from the local authority about any nearby property\n• Highways notices about road adoption or improvements\n\nNotices can arrive as printed letters, emails, or planning consultation leaflets.",
    keyPoints: [
      "Disclose all formal notices and official correspondence received",
      "Includes planning applications, road proposals, utility notices, and enforcement actions",
      "Your solicitor's searches will catch many things — but not everything recent",
      "Check your files and emails before answering",
    ],
    sellerGuidance:
      "Go through your paperwork and emails. Have you received anything from the council, a neighbour's architect, a utility company, or the highways authority? Even planning consultation letters about developments nearby could be relevant.",
    buyerGuidance:
      "Even if nothing is disclosed, your solicitor's local authority search will pick up many relevant issues. However, searches have a time lag — very recent proposals may not appear. Check the local planning portal directly if you are concerned about nearby development.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'noticesAndProposals.proposals_to_develop_or_alter': {
    mainExplanation:
      "You should disclose any formal notices or official correspondence that might affect the property or the surrounding area, including planning applications, council proposals, compulsory purchase notices, and enforcement notices.\n\nNotices can arrive as printed letters, emails, or planning consultation leaflets. Even planning consultation letters about nearby developments could be relevant.",
    keyPoints: [
      "Disclose all formal notices and official correspondence received",
      "Includes planning applications, road proposals, utility notices, and enforcement actions",
      "Check your files and emails before answering",
    ],
    sellerGuidance:
      "Go through your paperwork and emails before answering. Even planning consultation letters about developments nearby could be relevant.",
    buyerGuidance:
      "Your solicitor's local authority search will pick up many relevant issues, but searches have a time lag — very recent proposals may not appear.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  // ── ALTERATIONS AND PLANNING ─────────────────────────────────────────────────

  'alterationsAndPlanning.building_works': {
    mainExplanation:
      "Any significant changes to the property should be disclosed, including: extensions, loft conversions, garage conversions, conservatories, replacement windows and doors (since April 2002), removal of internal walls or chimney breasts, insulation, and any other structural or significant building work.\n\nThe Three Types of Documentation:\n\n1. Planning Permission — Required when work changes the external appearance of the building. Some work is 'Permitted Development' and doesn't need it — but this doesn't mean no documentation is needed.\n\n2. Building Regulations Approval — Required for structural works, extensions, conversions, and many alterations regardless of planning permission. A Completion Certificate is issued once works are signed off by an inspector.\n\n3. Competent Person Certificates — Certain trades can self-certify: FENSA for windows, Gas Safe for gas, NAPIT or NICEIC for electrics. These replace the need for building control for that specific work.\n\nIf documentation is missing, your solicitor may recommend indemnity insurance to protect against the risk of enforcement.",
    keyPoints: [
      "Disclose all significant building works — extensions, conversions, new windows, structural changes",
      "Three types of documentation may be needed: planning permission, building regulations approval, competent person certificates",
      "Permitted Development does not mean no documentation is needed",
      "Missing certificates can be covered by indemnity insurance in many cases",
    ],
    sellerGuidance:
      "Gather all paperwork for any works done during your ownership: planning permissions, building regulations completion certificates, competent person certificates, and any architect or structural engineer reports. If documents are lost, your solicitor can advise — sometimes they can be retrieved from the local authority.",
    buyerGuidance:
      "Building works without proper documentation carry real risks — the work may not meet required standards and the local authority could require remediation. If significant works are disclosed without corresponding approvals, your solicitor will advise on whether indemnity insurance is appropriate.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'alterationsAndPlanning.unfinished_works': {
    mainExplanation:
      "Any building works that remain unfinished at the time of sale must be disclosed. Unfinished works can affect the buyer's mortgage offer, insurance, and the ability to get a completion certificate from the local authority.\n\nCommon examples: a loft conversion without a completion certificate, a partially completed extension, or structural work that was started but not signed off.",
    keyPoints: [
      "Disclose all unfinished building works at the property",
      "Unfinished works can affect mortgage offers and insurance",
      "Completion certificates may not be obtainable if works are incomplete",
      "Your solicitor can advise on how to handle disclosure of unfinished works",
    ],
    sellerGuidance:
      "Be clear about the current state of any works. If you intend to complete works before sale, this should be agreed and documented. If selling with works incomplete, disclose the situation fully.",
    buyerGuidance:
      "Unfinished works are a significant concern. Ask what completion involves, how much it will cost, and whether a completion certificate can be obtained. Factor this into your offer.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'alterationsAndPlanning.breaches_of_consent_conditions': {
    mainExplanation:
      "Planning permissions and building regulations approvals often come with conditions attached. Common conditions include: restrictions on working hours during construction, requirements to use specific materials, landscaping obligations, or limits on how parts of the building may be used.\n\nIf any condition attached to a consent has not been complied with, this must be disclosed. Breaches of planning conditions can result in enforcement action by the local authority.",
    keyPoints: [
      "Planning permissions often come with conditions that must be complied with",
      "Breaches of conditions can result in local authority enforcement action",
      "Disclose any known breaches — even if they seem minor",
      "Indemnity insurance may be available for minor technical breaches",
    ],
    sellerGuidance:
      "Review any planning permissions you have and check whether all conditions have been met. Tell your solicitor about any you are not sure about.",
    buyerGuidance:
      "Ask your solicitor to check all planning permissions and their conditions as part of their pre-exchange enquiries.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'alterationsAndPlanning.planning_or_building_issues': {
    mainExplanation:
      "Any significant changes to the property should be disclosed, including extensions, conversions, and structural alterations. Three types of documentation may be required: planning permission, building regulations approval, and competent person certificates.\n\nIf documentation is missing, indemnity insurance may be available.",
    keyPoints: [
      "Disclose all significant building works",
      "Planning permission, building regulations approval, and competent person certificates may be needed",
      "Missing certificates can often be covered by indemnity insurance",
    ],
    sellerGuidance:
      "Gather all paperwork for any works done during your ownership. If documents are lost, your solicitor can advise.",
    buyerGuidance:
      "If significant works are disclosed without corresponding approvals, your solicitor will advise on whether indemnity insurance is appropriate.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'alterationsAndPlanning.solar_panels': {
    mainExplanation:
      "Two very different situations:\n\nSituation 1 — You own the panels: You paid for them. They transfer with the property. Simpler for mortgage lenders.\n\nSituation 2 — Provider-owned under a roof lease: A company installed the panels for free in exchange for a long lease of your roof or airspace (typically 20-25 years). The provider owns the panels — not you. A roof lease granted to a third party can affect the buyer's ability to get a mortgage.\n\nFeed-in Tariff (FIT): Closed to new applicants since April 2019. Where panels were owner-paid, FIT payments can transfer to the buyer.\n\nSmart Export Guarantee (SEG): The current scheme (launched January 2020) allowing surplus electricity to be sold back to the National Grid.",
    keyPoints: [
      "Owner-purchased panels: straightforward — transfer with the property",
      "Provider-installed under a roof lease: complex — can affect mortgage availability",
      "Disclose: ownership details, roof lease (if any), FIT/SEG agreements, MCS certificate",
      "Buyers must check with their mortgage lender before proceeding",
    ],
    sellerGuidance:
      "Contact your solar panel provider and gather: the original installation agreement, details of who owns the panels, any roof lease documentation, FIT or SEG agreement documents, your most recent electricity bill, and the MCS installation certificate.",
    buyerGuidance:
      "Tell your mortgage lender about any solar arrangement before proceeding. Find out whether they will lend on properties with a roof lease — some lenders won't. Check whether any FIT or SEG income transfers to you as the buyer.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'alterationsAndPlanning.solar_panels_ownership': {
    mainExplanation:
      "Whether you own your solar panels outright or they are owned by a third party under a roof lease makes a significant difference to a buyer. Owner-purchased panels transfer with the property and are straightforward. Provider-installed panels under a roof lease mean the buyer will have a landlord for their roof.",
    keyPoints: [
      "Owner-purchased panels: straightforward — transfer with the property",
      "Provider-installed under a roof lease: complex — can affect mortgage availability",
      "Buyers must check with their mortgage lender before proceeding",
    ],
    sellerGuidance:
      "Confirm who owns the panels and gather all relevant documentation before answering.",
    buyerGuidance:
      "Tell your mortgage lender about any solar arrangement before proceeding. Some lenders won't lend on properties with a roof lease.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'alterationsAndPlanning.solar_panel_roof_lease': {
    mainExplanation:
      "A roof lease granted to a solar panel provider means a third party has a long-term right over part of your property. This can affect the buyer's mortgage availability and must be fully disclosed with all documentation.",
    keyPoints: [
      "Roof lease granted to a solar provider can affect the buyer's mortgage",
      "Some lenders refuse to lend on properties with solar roof leases",
      "Provide full documentation: lease terms, duration, and provider contact details",
    ],
    sellerGuidance:
      "Provide the full roof lease documentation including lease term, provider details, and any assignment or novation terms.",
    buyerGuidance:
      "Speak to your mortgage lender before exchange. Some lenders are comfortable with managed solar leases; others are not.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'alterationsAndPlanning.listed_building': {
    mainExplanation:
      "A listed building is one officially recognised as having special architectural or historic interest.\n• Grade I — Highest significance (around 2% of listed buildings)\n• Grade II* — Particularly important (around 6%)\n• Grade II — Nationally important (around 92%)\n\nKey rules:\n• Listed building consent is required for any alterations affecting the character of the building — inside AND outside\n• Even replacing windows with identical-looking ones may require consent\n• Enforcement for unauthorised works has NO TIME LIMIT\n• A current owner can face enforcement for work done by a previous owner\n\nWhere to check:\n• England: historicengland.org.uk/listing/the-list\n• Wales: cadw.gov.wales",
    keyPoints: [
      "Listed building consent is needed for most changes — inside and outside",
      "No time limit on enforcement action — applies to all owners past and present",
      "A buyer can face action for work done by a previous owner",
      "Specialist listed buildings survey is strongly recommended for buyers",
    ],
    sellerGuidance:
      "Declare your listed status. Think carefully about any works carried out during your ownership — was consent obtained for kitchen renovations, new windows, structural changes? If any work was done without consent, your solicitor needs to know.",
    buyerGuidance:
      "Commission a specialist listed buildings survey — not just a standard homebuyer report. Ask your solicitor to check the history of any alterations and whether listed building consent was obtained. Understand that you are taking on legal responsibility for the building's listed status and all that entails.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'alterationsAndPlanning.conservation_orders': {
    mainExplanation:
      "Properties in conservation areas are subject to additional planning controls designed to preserve the character and appearance of the area. Even if a property is not itself listed, being in a conservation area affects what changes can be made without planning permission.\n\nKey restrictions may include limits on: extensions, alterations to the external appearance, installation of satellite dishes or solar panels, and removal of trees.",
    keyPoints: [
      "Conservation area properties face additional planning restrictions",
      "External changes may require planning permission even if not listed",
      "Tree work in conservation areas requires council notification",
      "Check with your local planning authority before making any external changes",
    ],
    sellerGuidance:
      "Disclose conservation area status and any planning permissions obtained for works. If any works were done without required consents, tell your solicitor.",
    buyerGuidance:
      "Factor conservation area restrictions into your plans for the property. Get advice from the local planning authority about what changes are permitted.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'alterationsAndPlanning.tree_preservation_orders': {
    mainExplanation:
      "A Tree Preservation Order (TPO) is a legal protection placed on a specific tree by the local planning authority. Once a TPO is in place, it is an offence to cut down, top, lop, uproot, wilfully damage, or destroy a protected tree without the council's permission.\n\nConservation areas: Even without a specific TPO, trees in conservation areas have automatic protections. Before significant work, the owner must submit a formal notification to the council and wait six weeks.\n\nTPOs can affect where you build — extensions, outbuildings, and hard landscaping near protected trees may face restrictions.",
    keyPoints: [
      "TPOs make it illegal to remove, top, lop, or damage a protected tree without council permission",
      "Conservation area trees have automatic protection even without a specific TPO",
      "TPO responsibilities transfer to the new owner with the property",
      "Tree restrictions can affect future planning applications for extensions or outbuildings",
    ],
    sellerGuidance:
      "If you are not sure whether any trees are protected, check with your local council. If you have had any work done on trees at the property, confirm that permission was obtained and provide any relevant documents.",
    buyerGuidance:
      "Trees with TPOs are a responsibility that transfers with the property. You cannot remove or significantly alter a protected tree without council permission — even if it is causing structural damage. Factor tree management and any restrictions into your plans before exchange.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  // ── ENVIRONMENTAL ────────────────────────────────────────────────────────────

  'environmental.Flooding': {
    mainExplanation:
      "You must disclose if any part of the property has ever been flooded — including the main building, garage, garden, or any outbuildings.\n\nEven a single event must be disclosed — even if minor, even if only the garden, even if it happened before your ownership but you are aware of it.\n\nTypes of flooding:\n• Surface water — heavy rainfall overwhelms drainage systems\n• Groundwater — water table rises above ground level\n• River flooding — a nearby watercourse overflows\n• Coastal flooding — sea defences are breached\n• Sewer flooding — sewers overflow\n\nFlood defences installed at the property (barriers, sump pumps, air brick covers) must also be disclosed.\n\nFailing to disclose known flooding is one of the most common grounds for post-completion compensation claims.",
    keyPoints: [
      "Disclose any flooding — however minor, however historic, however partial",
      "Includes garden flooding, not just the building",
      "Types: surface water, groundwater, river, coastal, sewer",
      "Buyers should check gov.uk/check-flooding independently before exchange",
    ],
    sellerGuidance:
      "Be honest. State when flooding occurred, what type it was, and which parts were affected. Note any measures taken since. Your solicitor can help you phrase this appropriately.",
    buyerGuidance:
      "Carry out independent checks at gov.uk/check-flooding and gov.uk/request-flooding-history. Speak to your buildings insurance broker BEFORE exchange — find out if the property can be insured and at what cost. Some flooded properties carry enormous premiums or are practically uninsurable.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'environmental.radon': {
    mainExplanation:
      "Radon is a naturally occurring radioactive gas that rises from rocks and soil. It is invisible, odourless, and undetectable without specialist equipment. Indoors it can accumulate, and at high levels it is a significant health risk — the second leading cause of lung cancer in the UK after smoking.\n\nAreas at higher risk include parts of: Cornwall and Devon, Northamptonshire and Leicestershire, Derbyshire, Yorkshire, and parts of Wales.\n\nYour solicitor's local authority search will usually indicate whether the property is in a designated Radon Affected Area.\n\nRemediation typically involves: a sump system beneath the floor, improved underfloor ventilation, or sealing floors and walls. Costs are typically a few thousand pounds and are usually effective.",
    keyPoints: [
      "Radon is a naturally occurring radioactive gas — the second biggest cause of lung cancer in the UK",
      "Certain areas of England and Wales have higher radon levels",
      "Disclose any test results and any remediation measures taken",
      "Test kits are inexpensive — buyers in affected areas should consider commissioning one",
    ],
    sellerGuidance:
      "If a radon test has been carried out, share the results. If remediation has been carried out, disclose this and provide documentation — it is reassuring for buyers to know the issue has been addressed.",
    buyerGuidance:
      "If the property is in a Radon Affected Area, a radon test is strongly advisable. Test kits are available from around £50 and take a few months to produce a result. If the result is above the recommended action level, factor remediation costs into your budget.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'environmental.japanese_knotweed': {
    mainExplanation:
      "Japanese knotweed is an invasive plant that can damage buildings, walls, hard surfaces, and drainage systems. It has distinctive bamboo-like stems and an underground root system (rhizome) that can penetrate building foundations.\n\nA property is considered at risk if knotweed is growing within 3 metres of the boundary.\n\nWhy it is problematic:\n• The underground rhizome can survive even after above-ground growth is treated\n• Full treatment typically takes 3-5 years of professional management\n• Can affect mortgage availability — some lenders refuse to lend on affected properties\n\nMany sellers honestly answer 'not known' — and that is acceptable. Knotweed does not always show above ground, especially in winter.\n\nA professional management and treatment plan is a structured programme of treatment usually backed by insurance. These plans are reassuring for buyers and lenders.",
    keyPoints: [
      "Properties within 3 metres of Japanese knotweed are considered at risk",
      "The underground rhizome can survive treatment — full eradication takes years",
      "'Not known' is an acceptable answer where you genuinely are not sure",
      "A professional management plan with insurance is reassuring for buyers and mortgage lenders",
    ],
    sellerGuidance:
      "If you are aware of knotweed, disclose it. If a management plan is in place, provide full documentation. If you answer 'not known,' that is acceptable where you genuinely do not know.",
    buyerGuidance:
      "If knotweed is disclosed: ask whether a professional management plan is in place and insured. Speak to your mortgage lender BEFORE exchange — some will lend with a plan in place, others will not lend until the property is clear. Factor ongoing management costs into your budget.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  // ── SERVICES ────────────────────────────────────────────────────────────────

  'services.electricity': {
    mainExplanation:
      "Since January 2005, significant electrical installation work must comply with building regulations. Work that falls under this requirement includes:\n• New circuit installations\n• Replacement of consumer units or fuse boxes\n• Rewiring in outbuildings and gardens\n• Alterations to circuits in special locations (bathrooms, shower rooms, swimming pools)\n• EV charging point installation\n\nFor work carried out after January 2005, one of the following is required:\n1. BS7671 Electrical Installation Certificate — signed by the installer\n2. Building Regulations Compliance Certificate — from the installer's Competent Person scheme (e.g. NAPIT or NICEIC)\n3. Building Control Completion Certificate — from the local authority\n\nThe EICR (Electrical Installation Condition Report) assesses the safety and condition of all electrical installations. Required by law for rental properties (renewed every 5 years). Not legally required for property sales — but strongly recommended for older properties.",
    keyPoints: [
      "Significant electrical work since January 2005 must have a compliance certificate",
      "One of three certificates is acceptable: BS7671, Building Regulations Compliance, or Building Control Completion",
      "An EICR is not legally required for sales but is recommended for older properties",
      "Missing certificates can often be reissued by the original electrician",
    ],
    sellerGuidance:
      "Find the relevant electrical certificates for any work done during your ownership. If you cannot find a certificate for recent work, contact the original electrician — they may be able to reissue it.",
    buyerGuidance:
      "For older properties (pre-1970s especially), consider commissioning an independent EICR. Old wiring can be a safety concern and may affect insurance. Check with your home insurer whether old wiring affects your policy.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'services.central_heating': {
    mainExplanation:
      "Different heating systems require different documentation:\n• Gas boiler (installed after April 2005): Building Regulations Completion Certificate from a Gas Safe registered engineer\n• Oil boiler: Building Regulations Completion Certificate\n• Air source heat pump: Building Regulations Completion Certificate (and possibly planning permission)\n• Wood-burning stove: HETAS certificate or Building Regulations Completion Certificate\n• Underfloor heating: Building Regulations Completion Certificate\n\nBoiler age matters: Boilers typically last 10-15 years. An older boiler approaching replacement can cost £2,000-£4,000 — relevant information for a buyer's budget.",
    keyPoints: [
      "Gas boilers installed after April 2005 need a Gas Safe compliance certificate",
      "Boilers should be serviced annually — provide as many service records as available",
      "Boiler age matters: 10-15 year lifespan means an old boiler may need replacement soon",
      "Heat pumps and stoves also require specific installation certificates",
    ],
    sellerGuidance:
      "Gather: the boiler installation certificate, annual service records, the most recent boiler inspection report, and certificates for any other heating systems. If missing service records, check with your service provider — they may have records.",
    buyerGuidance:
      "Key questions: how old is the boiler, when was it last serviced (should be annually), is it working, and are there compliance certificates? Consider having an independent Gas Safe or heating engineer inspect the system before exchange.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'services.drainage_and_sewerage': {
    mainExplanation:
      "Two scenarios:\n\nMains connected (most urban and suburban properties): Connected to the public sewer for both foul water (toilets, sinks, baths) and surface water (gutters, hard surfaces). No ongoing maintenance responsibility beyond the property boundary.\n\nPrivate sewerage systems — three types:\n\nSeptic Tank: Solids settle, liquid flows out. Since January 2020 in England, cannot discharge directly to rivers, streams, or other surface water. Must discharge to a drainage field or mains sewer.\n\nSewage Treatment Plant: Treats waste to a higher standard. Can discharge to a watercourse in England if compliant with Environment Agency rules.\n\nCesspool: Completely sealed, no discharge. All waste must be emptied regularly by a registered waste carrier.",
    keyPoints: [
      "Most properties connect to the mains sewer — confirm this is the case",
      "Septic tanks in England cannot discharge to surface water since January 2020",
      "Private systems require ongoing maintenance and have compliance obligations",
      "Buyers should establish annual servicing costs and confirm current compliance",
    ],
    sellerGuidance:
      "Know what system you have and provide accurate dates. If your septic tank still discharges to surface water, this must be disclosed and resolved — it has been non-compliant since January 2020.",
    buyerGuidance:
      "If the property has a private sewerage system: find out the annual servicing cost, confirm current Environment Agency compliance (especially for septic tanks previously discharging to surface water), and check whether any part is outside the property's boundaries. A non-compliant system can be expensive to upgrade.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  // ── LEASEHOLD ────────────────────────────────────────────────────────────────

  'leasehold.the_property': {
    mainExplanation:
      "Freehold: You own the land and the building outright. No landlord. No end date on your ownership.\n\nLeasehold: You own the right to occupy the property for a fixed number of years. Someone else — the freeholder — owns the land and building. You have a landlord.\n\nMost flats in England and Wales are leasehold. Some houses are too, though this is becoming less common.\n\nWhy lease length matters:\n• 80+ years remaining: Generally fine for mortgages and future sale\n• Under 80 years: Lease extension becomes significantly more expensive (marriage value applies)\n• Under 70 years: Many lenders become cautious\n• Under 60 years: Most lenders will not lend\n• Under 40 years: Very difficult to sell or mortgage\n\nExtending a lease: After owning the property for 2 years, you have a legal right to extend your lease by 90 years at zero (peppercorn) ground rent.",
    keyPoints: [
      "Leasehold means you own the right to occupy — not the building or land",
      "Lease length is critical: under 80 years makes extension expensive, under 70 concerns lenders",
      "You have a legal right to extend after 2 years of ownership",
      "Always check: years remaining, ground rent terms, service charges, management quality",
    ],
    sellerGuidance:
      "Know your lease details: current unexpired term, annual ground rent and whether it escalates, service charge amounts for the last three years, and contact details for the freeholder and managing agent. If the lease has fewer than 80 years remaining, expect this to affect the sale.",
    buyerGuidance:
      "Before buying leasehold, confirm: how many years are left on the lease, what the ground rent is and whether it escalates, who manages the building and how well, what the service charges are, whether there is a healthy reserve fund, and whether there are any known building safety issues.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'leasehold.maintenance_and_service_charges': {
    mainExplanation:
      "Ground Rent: An annual payment from the leaseholder to the freeholder. New leases (post-2022) must have zero (peppercorn) ground rent. Older leases may have significant amounts.\n\nTypes of ground rent:\n• Peppercorn: Effectively zero\n• Fixed: Stays the same throughout the lease\n• Escalating (RPI or doubling): Increases over time — doubling ground rents can make properties unmortgageable\n\nService Charges cover: building insurance, communal area maintenance, gardening, management fees, and reserve fund contributions.\n\nThe Reserve (Sinking) Fund: Well-managed buildings maintain a reserve fund for future major works. Without one, leaseholders face sudden 'special levies' — potentially £10,000-£30,000+ per flat.\n\nSection 20 Consultations: For major works costing any leaseholder more than £250, the landlord must formally consult leaseholders. Any active or recent Section 20 notice must be disclosed.",
    keyPoints: [
      "Ground rent — know if it escalates: doubling ground rents can make properties unmortgageable",
      "Service charges cover building running costs — verify current annual amount",
      "Reserve fund: no reserve = risk of sudden large special levies",
      "Request three years of service charge accounts and ask about any Section 20 notices",
    ],
    sellerGuidance:
      "Provide three years of service charge accounts. Be transparent about: the current annual service charge, any planned major works, any disputes about charges, and whether any service charges are currently outstanding.",
    buyerGuidance:
      "Calculate the full annual cost: ground rent (if applicable), annual service charge, and reserve fund contribution. Find out: Is the reserve fund healthy? Are any major works planned in the next 3-5 years? Is there an active Section 20 notice that could result in a large levy?",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'leasehold.building_safety_cladding_and_the_leaseholder_deed_of_certificate': {
    mainExplanation:
      "Background: Following the Grenfell Tower fire in 2017, thousands of residential buildings were found to have dangerous cladding or fire safety defects. The Building Safety Act 2022 created a legal framework to fund remediation and protect qualifying leaseholders from having to pay for defects they did not cause.\n\nKey concepts:\n\nQualifying Lease: A lease meeting specific criteria under the Act. Qualifying leaseholders benefit from legal protections limiting their liability for remediation costs.\n\nLeaseholder Deed of Certificate: A formal legal document completed by the leaseholder confirming their qualifying status.\n\nLandlord's Certificate: A certificate provided by the freeholder confirming details about the building and the landlord's financial position.\n\nThis is a rapidly evolving area of law. Specialist legal advice is essential.",
    keyPoints: [
      "The Building Safety Act 2022 protects qualifying leaseholders from paying for defects they didn't cause",
      "Two key documents: Leaseholder Deed of Certificate (completed by leaseholder) and Landlord's Certificate (from freeholder)",
      "Sellers must complete the Leaseholder Deed of Certificate before listing",
      "Buyers must check mortgage lender position before exchange — this is a specialist area of law",
    ],
    sellerGuidance:
      "Complete your Leaseholder Deed of Certificate accurately before listing. Provide the Landlord's Certificate if received. Notify the freeholder of your intention to sell. Be fully transparent about any known issues. Your solicitor must have Building Safety Act expertise.",
    buyerGuidance:
      "Before exchange on any flat with potential cladding issues: request all documentation — Leaseholder Deed of Certificate, Landlord's Certificate, any remediation survey reports. Confirm with your mortgage lender whether they will lend on this property. Ensure your solicitor has specialist Building Safety Act expertise.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  // ── FIXTURES AND FITTINGS ────────────────────────────────────────────────────

  'fixturesAndFittings.basic_fittings': {
    mainExplanation:
      "When a property changes hands, it must be absolutely clear what stays and what goes. This information can form part of the legal sale contract — sellers can be held to what they have committed to leaving.\n\nFor each item, sellers mark one of three options:\n• Included — stays with the property\n• Excluded — the seller is taking it\n• None — the item does not exist at the property\n\nGenerally included (fixtures — attached to the building):\n• Fitted kitchen units and integrated appliances\n• Bathroom fittings (bath, basin, toilet)\n• Built-in wardrobes, light fittings, door and window fittings\n• Central heating system\n\nGenerally not included (chattels — movable items):\n• Freestanding appliances, curtains, garden furniture, plants in pots\n\nThese are general rules — always check, never assume.",
    keyPoints: [
      "The fittings and contents list can form part of the legal sale contract",
      "Mark every item: Included / Excluded / None — do not leave ambiguity",
      "Fixtures (attached to the building) legally stay; chattels (movable) legally go",
      "Verbal agreements mean nothing unless they appear in the written list",
    ],
    sellerGuidance:
      "Go through every category carefully. If unsure about an item, mark it excluded — you can always add it later. If taking something a buyer might reasonably expect to stay (like a designer light fitting), mark it excluded early so buyers have accurate expectations from viewings.",
    buyerGuidance:
      "Read the fittings and contents information carefully. Do not assume anything stays — verify it is marked as included. If something you saw during a viewing matters to you, confirm it is included before exchange. Any verbal agreements about what is staying must be reflected in the written information.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

  'fixturesAndFittings.light_fittings': {
    mainExplanation:
      "The legal position: Light fittings are technically fixtures — attached to the electrical system and the fabric of the building. They legally stay with the property unless specifically agreed otherwise before exchange of contracts.\n\nHowever, sellers are entitled to take light fittings provided they:\n1. Declare them as excluded in the fittings information BEFORE exchange of contracts\n2. Replace them with a basic fitting before completion\n\nThe replacement obligation: If you remove a light fitting, you MUST leave in its place:\n• A ceiling rose\n• A flex\n• A bulb holder\n• A bulb\n\nThis is both a legal contractual obligation and a health and safety requirement. Bare wires cannot be left.",
    keyPoints: [
      "Light fittings are fixtures and legally stay unless excluded before exchange",
      "If you take a fitting, you MUST replace it with: ceiling rose, flex, bulb holder, and bulb",
      "Leaving bare wires is a breach of contract AND a safety hazard",
      "Decide what you are taking before viewings — not after exchange",
    ],
    sellerGuidance:
      "Room by room: identify any fitting you want to take — designer pendants, chandeliers, specialist spotlights. Mark each as excluded before exchange. Source basic replacements and install them on or before completion day. If taking a fitting, having an electrician fit the replacement is the safest approach.",
    buyerGuidance:
      "If a light fitting you expected to stay is not marked as included, flag this before exchange — not after. At the final inspection on completion morning, verify all excluded fittings have been properly replaced with basic alternatives. Bare wires are unacceptable and must be resolved before funds are released.",
    disclaimer:
      "This content is for general educational purposes only — not legal advice. Always consult a qualified solicitor for guidance specific to your situation.",
  },

};

// ── Section-level help ────────────────────────────────────────────────────────
// Shown when the user taps the help icon on a section card.

export const SECTION_HELP_CONTENT: Record<string, { helpText: string; helpVideoUrl?: string }> = {
  ownershipProfile: {
    helpText:
      "The Ownership Profile section sets out who owns the property and the basic facts about the sale. It covers the seller's details, the property address, and key background information that the buyer and their solicitor will rely on throughout the conveyancing process.",
  },
  boundaries: {
    helpText:
      "The Boundaries section asks you to confirm who is responsible for each side of your property, and whether any boundary changes have occurred. Boundary disputes are one of the most common causes of property sale delays — clear, honest answers here protect both buyer and seller.",
  },
  disputesAndComplaints: {
    helpText:
      "This section requires you to disclose any disputes or complaints involving the property or nearby properties — past or present, formal or informal. Honest disclosure protects you from post-completion compensation claims.",
  },
  noticesAndProposals: {
    helpText:
      "This section covers any formal notices or proposals you have received that could affect the property or surrounding area — from planning applications to road proposals to utility company notices.",
  },
  alterationsAndPlanning: {
    helpText:
      "This section covers any building works, alterations, or planning matters at the property. Buyers and their solicitors need to know what has been changed, whether proper consents were obtained, and whether all documentation is in order.",
  },
  guaranteesAndWarranties: {
    helpText:
      "This section covers any guarantees or warranties that exist for the property — such as damp proofing, timber treatment, new home warranties, or roofing guarantees. Transferable warranties are a valuable asset for buyers.",
  },
  insurance: {
    helpText:
      "This section covers the property's insurance arrangements. Sellers must maintain buildings insurance until completion. Buyers need to arrange their own cover from exchange of contracts.",
  },
  environmental: {
    helpText:
      "This section covers environmental matters that could affect the property — including flooding history, radon gas, and Japanese knotweed. Honest disclosure here is legally required and protects you from future compensation claims.",
  },
  rightsAndInformalArrangements: {
    helpText:
      "This section covers any rights of way, easements, or informal arrangements that affect the property — such as a neighbour's right to cross your land, or shared access arrangements. These need to be documented so buyers understand what they are taking on.",
  },
  parking: {
    helpText:
      "This section covers parking arrangements for the property — including allocated spaces, garages, permits, and any shared or informal arrangements.",
  },
  otherCharges: {
    helpText:
      "This section covers any financial charges or obligations attached to the property beyond the mortgage — such as rentcharges, estate management charges, or overage agreements.",
  },
  occupiers: {
    helpText:
      "This section covers who currently lives in or occupies the property, and whether any occupiers have rights that could affect the sale.",
  },
  services: {
    helpText:
      "This section covers the services connected to the property — electricity, gas, water, drainage, broadband, and heating. Buyers need to know what systems are in place, their condition, and whether proper certificates exist for any installation work.",
  },
  transactionInformation: {
    helpText:
      "This section covers the practical details of the transaction — including the proposed completion date, vacant possession, and any special requirements or conditions attached to the sale.",
  },
  fixturesAndFittings: {
    helpText:
      "This section records what is included in the sale and what the seller is taking. The fittings and contents list can form part of the legal contract — clear, accurate answers prevent moving-day disputes.",
  },
  leasehold: {
    helpText:
      "This section applies to leasehold properties. It covers lease length, ground rent, service charges, and any building safety issues. Leasehold is significantly different from freehold — understanding these details is essential before exchange.",
  },
  titleDeedsAndPlan: {
    helpText:
      "This section covers the title deeds and plan — the legal documents that confirm ownership. Sellers should provide any original deeds or documents they hold, as these support the Land Registry title.",
  },
  searches: {
    helpText:
      "This section covers property searches — the official enquiries made by the buyer's solicitor to local authorities and other bodies. Searches reveal planning history, road proposals, drainage connections, and environmental matters.",
  },
};

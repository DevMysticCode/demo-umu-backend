import { PrismaClient, QuestionType } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================
// SECTION TEMPLATES
// Key = OPIcon name so frontend renders correct icons
// ============================================

const SECTION_TEMPLATES = [
  {
    key: 'instructions',
    title: 'Instructions',
    subtitle: 'Getting Started',
    description: 'Learn how to complete your property passport',
    icon: 'instructions',
    order: 1,
  },
  {
    key: 'boundaries',
    title: 'Boundaries',
    subtitle: 'Identifying Boundaries',
    description: 'Define property boundaries',
    icon: 'boundaries',
    order: 2,
  },
  {
    key: 'disputesAndComplaints',
    title: 'Disputes and Complaints',
    subtitle: 'Resolving Issues',
    description: 'Document any disputes or complaints',
    icon: 'disputesAndComplaints',
    order: 3,
  },
  {
    key: 'noticesAndProposals',
    title: 'Notices and Proposals',
    subtitle: 'Official Notices',
    description: 'Document any official notices',
    icon: 'noticesAndProposals',
    order: 4,
  },
  {
    key: 'alterationsAndPlanning',
    title: 'Alterations and Planning',
    subtitle: 'Property Changes',
    description: 'Document any alterations or planning',
    icon: 'alterationsAndPlanning',
    order: 5,
  },
  {
    key: 'guaranteesAndWarranties',
    title: 'Guarantees and Warranties',
    subtitle: 'Coverage Details',
    description: 'Document guarantees and warranties',
    icon: 'guaranteesAndWarranties',
    order: 6,
  },
  {
    key: 'insurance',
    title: 'Insurance',
    subtitle: 'Insurance Details',
    description: 'Document insurance information',
    icon: 'insurance',
    order: 7,
  },
  {
    key: 'environmental',
    title: 'Environmental',
    subtitle: 'Environmental Matters',
    description: 'Document environmental concerns',
    icon: 'environmental',
    order: 8,
  },
  {
    key: 'rightsAndInformalArrangements',
    title: 'Rights and Informal Arrangements',
    subtitle: 'Property Rights',
    description: 'Document rights and informal arrangements',
    icon: 'rightsAndInformalArrangements',
    order: 9,
  },
  {
    key: 'parking',
    title: 'Parking',
    subtitle: 'Parking Arrangements',
    description: 'Document parking information',
    icon: 'parking',
    order: 10,
  },
  {
    key: 'otherCharges',
    title: 'Other Charges',
    subtitle: 'Additional Charges',
    description: 'Document other charges',
    icon: 'otherCharges',
    order: 11,
  },
  {
    key: 'occupiers',
    title: 'Occupiers',
    subtitle: 'Current Occupiers',
    description: 'Document occupier information',
    icon: 'occupiers',
    order: 12,
  },
  {
    key: 'services',
    title: 'Services',
    subtitle: 'Property Services',
    description: 'Document service information',
    icon: 'services',
    order: 13,
  },
  {
    key: 'transactionInformation',
    title: 'Transaction Information',
    subtitle: 'Transaction Details',
    description: 'Document transaction information',
    icon: 'transactionInformation',
    order: 14,
  },
  {
    key: 'fixturesAndFittings',
    title: 'Fixtures and Fittings',
    subtitle: 'Property Contents',
    description: 'Document fixtures and fittings',
    icon: 'fixturesAndFittings',
    order: 15,
  },
  {
    key: 'leasehold',
    title: 'Leasehold',
    subtitle: 'Leasehold Details',
    description: 'Document leasehold information',
    icon: 'leasehold',
    order: 16,
  },
  {
    key: 'titleDeedsAndPlan',
    title: 'Title Deeds and Plan',
    subtitle: 'Title Documents',
    description: 'Document title deeds and plans',
    icon: 'titleDeedsAndPlan',
    order: 17,
  },
  {
    key: 'searches',
    title: 'Searches',
    subtitle: 'Property Searches',
    description: 'Document search results',
    icon: 'searches',
    order: 18,
  },
];

// ============================================
// QUESTION TEMPLATES
// All data extracted from usePassportSteps.ts
// ============================================

interface QSeed {
  sectionKey: string;
  taskKey: string;
  title: string;
  description?: string;
  instructionText?: string;
  type: QuestionType;
  helpText?: string;
  options?: any;
  placeholder?: string;
  displayMode?: string;
  uploadInstruction?: string;
  prewrittenTemplates?: any;
  dateFields?: any;
  points: number;
  order: number;
}

const QUESTION_TEMPLATES: QSeed[] = [
  // ────────────────────────────────────────────
  // INSTRUCTIONS
  // ────────────────────────────────────────────
  {
    sectionKey: 'instructions',
    taskKey: 'read_instructions',
    title: 'What is a Property Passport?',
    description:
      'A Property Passport is a comprehensive document that contains all the information about a property.',
    type: 'TEXT',
    helpText:
      'This helps property owners and buyers understand the property better.',
    displayMode: 'text',
    points: 50,
    order: 1,
  },

  // ────────────────────────────────────────────
  // BOUNDARIES — Task: Notes
  // ────────────────────────────────────────────
  {
    sectionKey: 'boundaries',
    taskKey: 'notes',
    title: 'Important Notes',
    description: 'You must read notes before starting.',
    instructionText:
      'Please indicate ownership by written instruction or by reference to a plan:',
    type: 'NOTE',
    placeholder: 'Enter your notes here...',
    prewrittenTemplates: {
      buyers:
        'If any alterations or improvements have been made since the property was last valued for council tax, the sale of the property may trigger a revaluation. This may mean that following completion of the sale, the property will be put into a higher council tax band. Further information about council tax valuation can be found at: http://www.gov.uk/government/organisations/valuation-office-agency',
      sellers:
        'All relevant approvals and supporting paperwork referred to in this form, such as listed building consents, planning permissions, Building Regulations consents and completion certificates should be provided. If the seller has had works carried out the seller should produce the documentation authorising this. Copies may be obtained from the relevant local authority website. Competent Persons Certificates may be obtained from the contractor or the scheme provider (e.g. FENSA or Gas Safe Register). Further information about Competent Persons Certificates can be found at: https://www.gov.uk/guidance/competent-person-scheme-current-schemes-and-how-schemes-are-authorised',
    },
    points: 0,
    order: 1,
  },

  // ────────────────────────────────────────────
  // BOUNDARIES — Task: Boundary Responsibilities
  // ────────────────────────────────────────────
  {
    sectionKey: 'boundaries',
    taskKey: 'boundary_responsibilities',
    title:
      'Looking at the property from the road, who owns or accepts responsibility to maintain or repair the boundary features on each side of the property?',
    description:
      'Identify who is responsible for boundary maintenance on each side',
    type: 'RADIO',
    helpText:
      'Boundary responsibility determines who pays for maintenance, repairs, or replacement of fences, walls, hedges, or other boundary features.',
    options: [
      { label: 'Neighbour', value: 'neighbour' },
      { label: 'You', value: 'you' },
      { label: 'Shared', value: 'shared' },
      { label: 'Unknown', value: 'unknown' },
    ],
    points: 25,
    order: 1,
  },
  {
    sectionKey: 'boundaries',
    taskKey: 'boundary_responsibilities',
    title:
      'Building works (e.g. extension, loft or garage conversion, removal of internal walls)',
    description: '',
    type: 'DATE',
    helpText:
      'Select if building works were done and provide the completion date.',
    options: [
      {
        label: 'Yes, select year',
        value: 'yes',
        hasDate: true,
        dateFormat: 'year',
        datePlaceholder: 'Select year',
      },
      { label: 'No', value: 'no', hasDate: false },
    ],
    points: 50,
    order: 2,
  },
  {
    sectionKey: 'boundaries',
    taskKey: 'boundary_responsibilities',
    title: 'When was the work completed?',
    description: '',
    type: 'DATE',
    helpText: 'Provide the completion date for the building works.',
    options: [
      {
        label: 'Select month',
        value: 'selected',
        hasDate: true,
        dateFormat: 'monthYear',
        datePlaceholder: 'Select month',
      },
    ],
    points: 25,
    order: 3,
  },
  {
    sectionKey: 'boundaries',
    taskKey: 'boundary_responsibilities',
    title: 'When did you first notice the issue?',
    description: '',
    type: 'DATE',
    helpText: 'Provide the exact date when you first noticed the issue.',
    options: [
      {
        label: 'Select date',
        value: 'selected',
        hasDate: true,
        dateFormat: 'fullDate',
        datePlaceholder: 'Select date',
      },
    ],
    points: 25,
    order: 4,
  },

  // ────────────────────────────────────────────
  // BOUNDARIES — Task: Irregular Boundaries
  // ────────────────────────────────────────────
  {
    sectionKey: 'boundaries',
    taskKey: 'irregular_boundaries',
    title: 'Are the boundaries irregular?',
    description: 'If yes, please give details below',
    type: 'RADIO',
    helpText:
      'Boundaries are irregular if they are not a straight line – for example, if they curve, bend, or follow unusual shapes.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 100,
    order: 1,
  },

  // ────────────────────────────────────────────
  // BOUNDARIES — Task: Moved Boundary Features
  // ────────────────────────────────────────────
  {
    sectionKey: 'boundaries',
    taskKey: 'moved_boundary_features',
    title:
      'Have fences, walls, or hedges marking the boundary ever been moved from their original position?',
    description: 'Provide details if yes',
    type: 'UPLOAD',
    helpText: 'This helps identify if boundary markers have shifted over time.',
    uploadInstruction:
      'Attach any photos or documents that show the moved boundary.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },
  {
    sectionKey: 'boundaries',
    taskKey: 'moved_boundary_features',
    title: 'Upload supporting documents (plans, photos, reports)',
    description:
      'Provide any files that support your answer about moved features',
    type: 'UPLOAD',
    helpText:
      'Upload any supporting documents showing changes to boundary features.',
    points: 25,
    order: 2,
  },

  // ────────────────────────────────────────────
  // BOUNDARIES — Task: Adjacent Land Purchased
  // ────────────────────────────────────────────
  {
    sectionKey: 'boundaries',
    taskKey: 'adjacent_land_purchased',
    title:
      'Has extra land next to the property been bought and added to it by the seller?',
    description:
      'This means whether any extra land next to the property has been purchased and added to it by the seller.',
    type: 'RADIO',
    helpText:
      'Understanding if the property has been expanded helps in valuation.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  // ────────────────────────────────────────────
  // BOUNDARIES — Task: Complex Boundaries
  // ────────────────────────────────────────────
  {
    sectionKey: 'boundaries',
    taskKey: 'complex_boundaries',
    title: 'Are boundaries complex or tricky to describe?',
    description:
      "Complex boundaries don't follow simple lines or overlap in unusual ways.",
    type: 'RADIO',
    helpText:
      "Complex boundaries are those that are tricky to describe or don't follow a simple line.",
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },

  // ────────────────────────────────────────────
  // DISPUTES AND COMPLAINTS
  // ────────────────────────────────────────────

    sectionKey: 'disputesAndComplaints',
    taskKey: 'past_disputes_or_complaints',
    title:
      'Have there been any disputes or complaints regarding this property or a property nearby? ',
    description: 'If yes, please give details below',
    type: 'RADIO',
    helpText:
      'If there has been any arguments, formal complaints, or legal issues about this home or a nearby one (such as rows over noise, parking, boundaries or shared areas) please detail what it was about, who it involved, when it happened, and how it was resolved or if it’s still ongoing. ',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'disputesAndComplaints',
    taskKey: 'prospective_disputes_or_complaints',
    title:
      'Is the seller aware of anything which might lead to a dispute about the property or a property nearby?  ',
    description: 'If yes, please give details below',
    type: 'RADIO',
    helpText:
      'If you are aware of any issues that could cause arguments or legal disputes about this property or nearby properties in the future, such as disagreements over boundaries, access, or shared spaces, please detail what the possible issue is, who it involves, why it could cause a dispute, and if anything has been done about it.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 100,
    order: 1,
  },

  // ────────────────────────────────────────────
  // NOTICES AND PROPOSALS
  // ────────────────────────────────────────────
  {
    sectionKey: 'noticesAndProposals',
    taskKey: 'received_or_sent_notices',
    title:
      'Hav
    e  any notices or correspondence been received or sent (e.g.from or to a neighbour, council or government department) or any negotiations or discussions taken place, which affect the property or a property nearby?',
    description: 'If yes, please give details below',
    type: 'RADIO',
    helpText:
      'This asks whether there have been any official letters, emails, notices, or any talks with neighbours, the council, or government about matters affecting this property or a nearby one. Examples include planning or enforcement notices, boundary or access issues, party wall matters, building control, highways/parking changes, tree preservation, noise/ASB notices, or utility works.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },

  {
    sectionKey: 'noticesAndProposals',
    taskKey: 'proposals_to_develop_or_alter',
    title:
     
      'Is the seller aware of any proposals to develop property or land nearby, or, any proposals to make alterations to buildings nearby?',
    description: 'If yes, please give details below',
    type: 'RADIO',
    helpText:
      'This asks whether there have been any official letters, emails, notices, or any talks with neighbours, the council, or government about matters affecting this property or a nearby one. Examples include planning or enforcement notices, boundary or access issues, party wall matters, building control, highways/parking changes, tree preservation, noise/ASB notices, or utility works.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 100,
    order: 1,
  },

  // ────────────────────────────────────────────
  // ALTERATIONS AND PLANNING
  // ────────────────────────────────────────────
  {
    sectionKey: 'alterationsAndPlanning',
    taskKey: 'alterations_review',
    title: 'Have there been any planning notices or proposals?',
    description: 'Document any planning applications or notices',
    type: 'RADIO',
    helpText:
      'This includes planning permission notices or development proposals.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },

  // ────────────────────────────────────────────
  // GUARANTEES AND WARRANTIES
  // ────────────────────────────────────────────
  {
    sectionKey: 'guaranteesAndWarranties',
    taskKey: 'guarantees_review',
    title: 'Have there been any planning notices or proposals?',
    description: 'Document any planning applications or notices',
    type: 'RADIO',
    helpText:
      'This includes planning permission notices or development proposals.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },

  // ────────────────────────────────────────────
  // INSURANCE
  // ────────────────────────────────────────────
  {
    sectionKey: 'insurance',
    taskKey: 'insurance_review',
    title: 'Have there been any planning notices or proposals?',
    description: 'Document any planning applications or notices',
    type: 'RADIO',
    helpText:
      'This includes planning permission notices or development proposals.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },

  // ────────────────────────────────────────────
  // ENVIRONMENTAL
  // ────────────────────────────────────────────
  {
    sectionKey: 'environmental',
    taskKey: 'environmental_review',
    title: 'Have there been any planning notices or proposals?',
    description: 'Document any planning applications or notices',
    type: 'RADIO',
    helpText:
      'This includes planning permission notices or development proposals.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },

  // ────────────────────────────────────────────
  // RIGHTS AND INFORMAL ARRANGEMENTS
  // ────────────────────────────────────────────
  {
    sectionKey: 'rightsAndInformalArrangements',
    taskKey: 'rights_review',
    title: 'Have there been any planning notices or proposals?',
    description: 'Document any planning applications or notices',
    type: 'RADIO',
    helpText:
      'This includes planning permission notices or development proposals.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },

  // ────────────────────────────────────────────
  // PARKING
  // ────────────────────────────────────────────
  {
    sectionKey: 'parking',
    taskKey: 'parking_review',
    title: 'Have there been any planning notices or proposals?',
    description: 'Document any planning applications or notices',
    type: 'RADIO',
    helpText:
      'This includes planning permission notices or development proposals.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },

  // ────────────────────────────────────────────
  // OTHER CHARGES
  // ────────────────────────────────────────────
  {
    sectionKey: 'otherCharges',
    taskKey: 'charges_review',
    title: 'Have there been any planning notices or proposals?',
    description: 'Document any planning applications or notices',
    type: 'RADIO',
    helpText:
      'This includes planning permission notices or development proposals.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },

  // ────────────────────────────────────────────
  // OCCUPIERS
  // ────────────────────────────────────────────
  {
    sectionKey: 'occupiers',
    taskKey: 'occupiers_review',
    title: 'Have there been any planning notices or proposals?',
    description: 'Document any planning applications or notices',
    type: 'RADIO',
    helpText:
      'This includes planning permission notices or development proposals.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },

  // ────────────────────────────────────────────
  // SERVICES
  // ────────────────────────────────────────────
  {
    sectionKey: 'services',
    taskKey: 'services_review',
    title: 'Have there been any planning notices or proposals?',
    description: 'Document any planning applications or notices',
    type: 'RADIO',
    helpText:
      'This includes planning permission notices or development proposals.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },

  // ────────────────────────────────────────────
  // TRANSACTION INFORMATION
  // ────────────────────────────────────────────
  {
    sectionKey: 'transactionInformation',
    taskKey: 'transaction_review',
    title: 'Have there been any planning notices or proposals?',
    description: 'Document any planning applications or notices',
    type: 'RADIO',
    helpText:
      'This includes planning permission notices or development proposals.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },

  // ────────────────────────────────────────────
  // FIXTURES AND FITTINGS
  // ────────────────────────────────────────────
  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'fixtures_review',
    title: 'Have there been any planning notices or proposals?',
    description: 'Document any planning applications or notices',
    type: 'RADIO',
    helpText:
      'This includes planning permission notices or development proposals.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },

  // ────────────────────────────────────────────
  // LEASEHOLD
  // ────────────────────────────────────────────
  {
    sectionKey: 'leasehold',
    taskKey: 'leasehold_review',
    title: 'Have there been any planning notices or proposals?',
    description: 'Document any planning applications or notices',
    type: 'RADIO',
    helpText:
      'This includes planning permission notices or development proposals.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },

  // ────────────────────────────────────────────
  // TITLE DEEDS AND PLAN
  // ────────────────────────────────────────────
  {
    sectionKey: 'titleDeedsAndPlan',
    taskKey: 'title_deeds_review',
    title: 'Have there been any planning notices or proposals?',
    description: 'Document any planning applications or notices',
    type: 'RADIO',
    helpText:
      'This includes planning permission notices or development proposals.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },

  // ────────────────────────────────────────────
  // SEARCHES
  // ────────────────────────────────────────────
  {
    sectionKey: 'searches',
    taskKey: 'searches_review',
    title: 'Have there been any planning notices or proposals?',
    description: 'Document any planning applications or notices',
    type: 'RADIO',
    helpText:
      'This includes planning permission notices or development proposals.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },
];

// ============================================
// HELPER
// ============================================

function formatTaskKey(key: string): string {
  return key
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ============================================
// MAIN SEED
// ============================================

async function main() {
  console.log('=== Seeding database ===\n');

  // 1. Clear existing passport structure (preserves User + Passport rows)
  console.log('Clearing existing passport data...');
  await prisma.questionAnswer.deleteMany();
  await prisma.passportQuestion.deleteMany();
  await prisma.passportSectionTask.deleteMany();
  await prisma.passportSection.deleteMany();

  // 2. Clear existing templates
  console.log('Clearing existing templates...');
  await prisma.questionTemplate.deleteMany();
  await prisma.sectionTemplate.deleteMany();

  // 3. Create SectionTemplates
  console.log('Creating section templates...');
  for (const st of SECTION_TEMPLATES) {
    await prisma.sectionTemplate.create({ data: st });
  }
  console.log(`  -> ${SECTION_TEMPLATES.length} section templates created`);

  // 4. Create QuestionTemplates
  console.log('Creating question templates...');
  for (const qt of QUESTION_TEMPLATES) {
    await prisma.questionTemplate.create({
      data: {
        sectionKey: qt.sectionKey,
        taskKey: qt.taskKey,
        title: qt.title,
        description: qt.description || null,
        instructionText: qt.instructionText || null,
        type: qt.type,
        helpText: qt.helpText || null,
        options: qt.options || undefined,
        placeholder: qt.placeholder || null,
        displayMode: qt.displayMode || null,
        uploadInstruction: qt.uploadInstruction || null,
        prewrittenTemplates: qt.prewrittenTemplates || undefined,
        dateFields: qt.dateFields || undefined,
        points: qt.points,
        order: qt.order,
      },
    });
  }
  console.log(`  -> ${QUESTION_TEMPLATES.length} question templates created`);

  // 5. Re-populate ALL existing passports
  const passports = await prisma.passport.findMany();
  console.log(`\nRe-populating ${passports.length} existing passport(s)...\n`);

  const allTemplates = await prisma.questionTemplate.findMany({
    orderBy: [{ sectionKey: 'asc' }, { taskKey: 'asc' }, { order: 'asc' }],
  });

  // Group templates by section -> task
  const grouped = new Map<
    string,
    Map<string, (typeof allTemplates)[number][]>
  >();
  for (const t of allTemplates) {
    if (!grouped.has(t.sectionKey)) grouped.set(t.sectionKey, new Map());
    const tasks = grouped.get(t.sectionKey)!;
    if (!tasks.has(t.taskKey)) tasks.set(t.taskKey, []);
    tasks.get(t.taskKey)!.push(t);
  }

  for (const passport of passports) {
    console.log(`  Passport: ${passport.addressLine1} (${passport.id})`);

    // Use SECTION_TEMPLATES ordering (not alphabetical from grouped map)
    for (const stDef of SECTION_TEMPLATES) {
      const sectionKey = stDef.key;
      const tasksForSection = grouped.get(sectionKey);

      const sectionTemplate = await prisma.sectionTemplate.findUnique({
        where: { key: sectionKey },
      });

      const sectionStatus = stDef.order === 1 ? 'ACTIVE' : 'LOCKED';

      const section = await prisma.passportSection.create({
        data: {
          passportId: passport.id,
          key: sectionKey,
          title: sectionTemplate?.title || sectionKey,
          subtitle: sectionTemplate?.subtitle,
          description: sectionTemplate?.description,
          imageKey: sectionTemplate?.icon,
          order: stDef.order,
          status: sectionStatus as any,
        },
      });

      if (!tasksForSection) continue;

      let taskOrder = 0;
      for (const [taskKey, questions] of tasksForSection) {
        taskOrder++;

        const task = await prisma.passportSectionTask.create({
          data: {
            passportSectionId: section.id,
            key: taskKey,
            title: formatTaskKey(taskKey),
            description: null,
            order: taskOrder,
          },
        });

        for (const template of questions) {
          await prisma.passportQuestion.create({
            data: {
              passportSectionTaskId: task.id,
              questionTemplateId: template.id,
            },
          });
        }
      }
    }

    console.log(`    -> ${SECTION_TEMPLATES.length} sections created`);
  }

  console.log('\n=== Seed complete! ===');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

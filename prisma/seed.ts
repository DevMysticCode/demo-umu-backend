import { PrismaClient, QuestionType } from '@prisma/client';
import { TASK_DESCRIPTIONS, TASK_ORDERS } from '../src/constants/task-metadata';

const prisma = new PrismaClient();

// ============================================
// SECTION TEMPLATES
// Key = OPIcon name so frontend renders correct icons
// ============================================

const SECTION_TEMPLATES = [
  {
    key: 'ownershipProfile',
    title: 'Ownership Profile',
    subtitle: 'Set out the ownership structure for this property',
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
    subtitle: 'Formal Correspondence',
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
  parts?: any;
  fields?: any;
  autoSaveOn?: {
    partKey?: string;
    value?: string;
  };
  repeatable?: boolean;
  buttonText?: string;
  scaleType?: string;
  scaleMin?: number;
  scaleMax?: number;
  scaleStep?: number;
  scaleFormat?: string;
  scaleMaxLabel?: string;
  points: number;
  order: number;
}

const QUESTION_TEMPLATES: QSeed[] = [
  // ────────────────────────────────────────────
  // OWNERSHIP PROFILE — 13 Tasks
  // ────────────────────────────────────────────

  {
    sectionKey: 'ownershipProfile',
    taskKey: 'notes',
    title: 'About this form',
    description: 'You must read notes before starting.',
    instructionText:
      'Please indicate ownership by written instruction or by reference to a plan:',
    type: 'NOTE',
    placeholder: 'Enter your notes here...',
    prewrittenTemplates: {
      buyers:
        'If  the seller gives you, separately from this form, any information concerning the property (in writing or in conversation, whether through an estate agent or solicitor or directly to you) on which you wish to rely when buying the property, you should tell your solicitor.You are entitled to rely on the replies given to enquiries but in relation to the physical condition of the property, the replies should not be treated as a substitute for undertaking your own survey or making your own independent enquiries, which you are recommended to do.The seller is only obliged to give answers based on their own information. They may not have knowledge of legal or technical matters. You should not expect the seller to have knowledge of, or give information about, matters prior to their ownership of the property.',
      sellers:
        'The answers should be prepared by the person or persons who are named as owner on the deeds or Land Registry title or by the owner’s legal representative(s) if selling under a power of attorney or grant of probate or representation. If there is more than one seller, you should prepare the answers together or, if only one seller prepares the form, the other(s) should check the answers given and all sellers should sign the form.If you do not know the answer to any question, you must say so If you are unsure of the meaning of any questions or answers.',
    },
    points: 0,
    order: 1,
  },

  {
    sectionKey: 'ownershipProfile',
    taskKey: 'name_of_sellers_and_address_of_the_property',
    title: 'Address of the Property',
    description: '',
    type: 'MULTIPART',
    helpText: '',
    parts: [
      {
        partKey: 'owner_names',
        type: 'text',
        title: 'Please provide the address of the property',
        placeholder: 'Start typing...',
        order: 1,
      },
      {
        partKey: 'property_address',
        type: 'address',
        title: '',
        placeholder: '12 Example Road, AB1 2CD',
        order: 2,
      },
    ],
    points: 100,
    order: 1,
  },

  {
    sectionKey: 'ownershipProfile',
    taskKey: 'name_of_sellers_and_address_of_the_property',
    title: '',
    description: '',
    type: 'MULTIPART',
    helpText: '',
    parts: [
      {
        partKey: 'full_names_of_sellers',
        type: 'multitextinput',
        title: 'Full names of the seller(s)',
        description:
          'Please state the full names of everyone who is named as owner on the HM Land Registry title or on the deeds. If you are completing the form on behalf of the seller, for example, under a power of attorney, grant of probate or representation, then they should provide their names here.',
        helpText: '',
        placeholder: 'Enter Name',
        buttonText: 'Add More Sellers',
        order: 1,
      },
      {
        partKey: 'are_you_the_owner_of_the_property',
        type: 'radio',
        title: 'Are you the owner of the property?',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 2,
      },
      {
        partKey: 'are_completing_this_form_on_the_behalf_of_the_seller',
        type: 'radio',
        title: 'Are completing this form on the behalf of the seller? ',
        options: [
          { label: 'Will / Grant of Probate', value: 'will_grant_of_probate' },
          { label: 'Trustee', value: 'trustee' },
          { label: 'Representative', value: 'representative' },
          { label: 'Power of Attorney', value: 'power_of_attorney' },
          { label: 'Limited Company ', value: 'limited_company' },
        ],
        order: 3,
      },
      {
        partKey: 'company_details',
        type: 'multifieldform',
        title: '',
        repeatable: false,
        fields: [
          {
            key: 'filler_name',
            label: 'N',
            placeholder: 'Enter Name',
          },
        ],
        order: 4,
      },
    ],
    points: 100,
    order: 2,
  },

  {
    sectionKey: 'ownershipProfile',
    taskKey: 'name_of_sellers_and_address_of_the_property',
    title: 'Are completing this form on the behalf of the seller?',
    description:
      'Please state the capacity in which you are providing the information, either as the seller or the seller’s representative, for example, under a will or power of attorney or as a trustee. If the seller is a company, then the name of the company, its company registration number, the name of a director or authorized person, and the country in which it is incorporated must be provided.',
    type: 'MULTIPART',
    helpText: '',
    parts: [
      {
        partKey: 'are_completing_this_form_on_the_behalf_of_the_seller',
        type: 'radio',
        title: 'Are completing this form on the behalf of the seller? ',
        options: [
          { label: 'Will / Grant of Probate', value: 'will_grant_of_probate' },
          { label: 'Trustee', value: 'trustee' },
          { label: 'Representative', value: 'representative' },
          { label: 'Power of Attorney', value: 'power_of_attorney' },
          { label: 'Limited Company ', value: 'limited_company' },
        ],
        order: 1,
      },
      {
        partKey: 'company_details',
        type: 'multifieldform',
        title: 'Enter the details of limited company',
        repeatable: false,
        fields: [
          {
            key: 'company_name',
            label: '',
            placeholder: 'Enter Limited Company name',
          },
          {
            key: 'company_registration_number',
            label: '',
            placeholder: 'Company registration number',
          },
          {
            key: 'company_address',
            label: '',
            placeholder: 'Name of the director or authorized person ',
          },
          {
            key: 'country_of_incorporation',
            label: '',
            placeholder: 'Country of incorporation',
          },
        ],
        order: 2,
      },
    ],
    points: 100,
    order: 3,
  },

  {
    sectionKey: 'ownershipProfile',
    taskKey: 'seller_solicitor',
    title: 'Please provide details of solicitor’s firm',
    description: '',
    type: 'MULTIFIELDFORM',
    repeatable: true,
    buttonText: 'Add More Solicitors',
    helpText: '',
    fields: [
      {
        key: 'law_firm_name',
        label: '',
        placeholder: 'Name of the Solicitors firm',
      },
      {
        key: 'contact_name',
        label: '',
        placeholder: 'Contact name',
      },
      {
        key: 'address',
        label: '',
        placeholder: 'Enter address',
      },
      {
        key: 'email',
        label: '',
        placeholder: 'Enter email',
      },
      {
        key: 'phonenumber',
        label: '',
        placeholder: 'Enter phone number',
      },
      {
        key: 'reference_number',
        label: '',
        placeholder: 'Enter reference number',
        required: false,
      },
    ],
    points: 100,
    order: 1,
  },

  {
    sectionKey: 'ownershipProfile',
    taskKey: 'give_your_home_a_story',
    title: 'Great photos help buyers connect emotionally.',
    description: '',
    type: 'UPLOAD',
    helpText: '',
    displayMode: 'upload',
    points: 100,
    order: 1,
  },

  // Question 1

  {
    sectionKey: 'ownershipProfile',
    taskKey: 'give_your_home_a_story',
    title: 'What is your council tax band?',
    description:
      'State the council tax band for the property. The council tax band can be obtained from the latest bill, or you can check it on the GOV.UK website.',
    type: 'SCALE',
    helpText: '',
    scaleType: 'alphabet', // ← Key: 'alphabet' for A-Z
    points: 100,
    order: 2,
  },

  // Question 2

  {
    sectionKey: 'ownershipProfile',
    taskKey: 'give_your_home_a_story',
    title: 'What is your asking price for the property?',
    description:
      'State the asking price of the property. Please use slider or enter actual selling price in the box below.',
    type: 'SCALE',
    helpText: '',
    scaleMin: 50,
    scaleMax: 350,
    scaleStep: 50,
    scaleFormat: 'currency', // ← Key: 'currency' for £50K format
    scaleMaxLabel: '350K+', // ← Optional: custom label for max
    points: 100,
    order: 3,
  },

  // Question 3

  {
    sectionKey: 'ownershipProfile',
    taskKey: 'give_your_home_a_story',
    title: 'What is the type of the ownership?',
    description:
      'National Trading Standard’s guidance includes a non-traditional tenure category (park homes and riverboats).',
    type: 'CHIPS',
    helpText: '',
    options: [
      { label: 'Freehold', value: 'freehold' },
      { label: 'Share of Freehold', value: 'share_of_freehold' },
      { label: 'Leasehold', value: 'Leasehold' },
      { label: 'Commonhold', value: 'Commonhold' },
      { label: 'Shared Ownership', value: 'shared_ownership' },
      { label: 'Flying Freehold', value: 'flying_freehold' },
    ],
    points: 100,
    order: 4,
  },

  // Question 4

  {
    sectionKey: 'ownershipProfile',
    taskKey: 'give_your_home_a_story',
    title:
      'Please enter the percentage of shared ownership and state how much rent you pay each year for the share that is not owned by you.',
    description: '',
    type: 'DATE',
    helpText: '',
    options: [
      {
        label: 'Enter percentage',
        value: 'percentage',
        hasDate: true,
        inputType: 'percentage',
        datePlaceholder: '00%',
      },
      {
        label: 'Enter rent amount',
        value: 'rent_amount',
        hasDate: true,
        inputType: 'currency',
        datePlaceholder: '£ 1500',
      },
    ],
    points: 100,
    order: 5,
  },

  // Question 5

  {
    sectionKey: 'ownershipProfile',
    taskKey: 'give_your_home_a_story',
    title: '',
    description: '',
    type: 'MULTIPART',
    helpText: '',
    parts: [
      {
        partKey: 'expiry_length',
        type: 'date',
        title: 'Please enter the expiry date and length of your lease.',
        description:
          'You should be able to find this information on your title deeds.',
        options: [
          {
            label: 'Select expiry date',
            value: 'expiry_date',
            hasDate: true,
            dateFormat: 'fullDate',
            datePlaceholder: 'Select expiry date',
          },
          {
            label: 'Length of lease',
            value: 'lease_length',
            hasDate: true,
            inputType: 'years',
            datePlaceholder: 'Years',
          },
        ],
        order: 1,
      },
      {
        partKey: 'rent_lease_info',
        type: 'RADIO',
        title:
          'If you have applied to extend the lease, buy the freehold of the property, or vary the terms of the lease, provide details of the date the application was made and whether it was accepted by the landlord.',
        options: [
          { label: 'Yes, Accepted by landlord', value: 'accepted' },
          { label: 'No, Rejected by landlord', value: 'rejected' },
          { label: 'Yes, Still pending', value: 'pending' },
        ],
        order: 2,
      },
      {
        partKey: 'expiry_length',
        type: 'date',
        title:
          'Advise how much ground rent your lease requires to be paid each year to your landlord.',
        options: [
          {
            label: 'Enter Amount',
            value: 'rent_lease_amount',
            hasDate: true,
            inputType: 'currency',
            datePlaceholder: '£ 0000',
          },
        ],
        order: 3,
      },
      {
        partKey: 'increase_in_rent',
        type: 'RADIO',
        title:
          'Does your lease includes provisions for an increase in the rent',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 4,
      },
      {
        partKey: 'increase_rent',
        type: 'date',
        title:
          'How frequently will the rent increase? And the amount you will pay after the increase (if known)',
        options: [
          {
            label: 'Every',
            value: 'frequency',
            hasDate: true,
            dateFormat: 'years',
            datePlaceholder: 'Years',
          },
          {
            label: 'Enter increase amount',
            value: 'increase_amount',
            hasDate: true,
            inputType: 'currency',
            datePlaceholder: '£ 0000',
          },
        ],
        order: 5,
      },
      {
        partKey: 'increase_rent_calculation',
        type: 'date',
        title: 'How this increase is calculated?(If Known)',
        options: [
          {
            label: 'Enter percentage',
            value: 'percentage',
            hasDate: true,
            inputType: 'percentage',
            datePlaceholder: '00%',
          },
        ],
        order: 6,
      },
    ],
    points: 200,
    order: 6,
  },

  // Question 6
  {
    sectionKey: 'ownershipProfile',
    taskKey: 'give_your_home_a_story',
    title: '',
    description: '',
    type: 'MULTIPART',
    helpText: '',
    parts: [
      {
        partKey: 'expiry_length',
        type: 'date',
        title:
          'If your lease includes a service charge, it will set out the way the service charge is organised and what can be charged.',
        description:
          'Service charges are usually for the maintenance and upkeep of the property, including common areas and gardens. ',
        options: [
          {
            label: 'Frequency of payment',
            value: 'frequency',
            hasDate: true,
            inputType: 'years',
            datePlaceholder: 'Years',
          },
          {
            label: 'Service charges amount',
            value: 'service_charge',
            hasDate: true,
            inputType: 'currency',
            datePlaceholder: '£ 1500',
          },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'upload',
        title: 'Please upload supporting document.',
        uploadInstruction: 'Please upload supporting document.',
        order: 5,
      },
    ],
    points: 200,
    order: 7,
  },

  // Question 7
  {
    sectionKey: 'ownershipProfile',
    taskKey: 'give_your_home_a_story',
    title: '',
    description: '',
    type: 'MULTIPART',
    helpText: '',
    parts: [
      {
        partKey: 'photos',
        type: 'upload',
        title: 'Provide a copy of the commonhold statement.',
        uploadInstruction:
          'The commonhold community statement is a document that makes provision in relation to specified land for the rights and duties of the commonhold association and the rights and duties of the unit-holders.',
        order: 1,
      },
      {
        partKey: 'expiry_length',
        type: 'date',
        title:
          'Indicate how many units there are in the commonhold and how much your owner is required to pay each year under the commonhold assessment.',
        description:
          'The commonhold community statement should include this information.',
        options: [
          {
            label: 'Numbers of units',
            value: 'number_of_units',
            hasDate: true,
            inputType: 'units',
            datePlaceholder: 'Units',
          },
          {
            label: 'Enter amount per unit',
            value: 'amount_per_unit',
            hasDate: true,
            inputType: 'currency',
            datePlaceholder: '£ 1500',
          },
        ],
        order: 2,
      },
      {
        partKey: 'rent_lease_info',
        type: 'RADIO',
        title:
          'Does your commonhold community statement includes a reserve fund and how much your unit is required to pay each year into that fund?',
        description:
          'The commonhold community statement should include this information.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 3,
      },
      {
        partKey: 'expiry_length',
        type: 'date',
        title: '',
        options: [
          {
            label: 'Enter Amount',
            value: 'rent_lease_amount',
            hasDate: true,
            inputType: 'currency',
            datePlaceholder: '£ 0000',
          },
        ],
        order: 4,
      },

      {
        partKey: 'increase_rent',
        type: 'date',
        title:
          'Provide details of charges, including the cost and frequency of payments required.',
        description:
          'This question aims to find out if there are any charges, such as payments with your neighbours for shared facilities or to a management company, affecting the property.',
        options: [
          {
            label: 'Frequency of payment',
            value: 'frequency',
            hasDate: true,
            inputType: 'years',
            datePlaceholder: 'Years',
          },
          {
            label: 'Service charges amount',
            value: 'service_charge',
            hasDate: true,
            inputType: 'currency',
            datePlaceholder: '£ 1500',
          },
        ],
        order: 5,
      },

      {
        partKey: 'increase_rent_calculation',
        type: 'date',
        title: 'Additional charges pertaining to Access roads and footpaths',
        description:
          'A common additional charge that may affect a property is for the upkeep of roads or footpaths. Indicate if this applies to the property.',
        options: [
          {
            label: 'Additional charges amount paid annually',
            value: 'additional_charge',
            hasDate: true,
            inputType: 'currency',
            datePlaceholder: '£ 000',
          },
        ],
        order: 6,
      },
    ],
    points: 200,
    order: 8,
  },

  // {
  //   sectionKey: 'ownershipProfile',
  //   taskKey: 'give_your_home_a_story',
  //   title:
  //     'If your lease includes a service charge, it will set out the way the service charge is organised and what can be charged.',
  //   description:
  //     'Service charges are usually for the maintenance and upkeep of the property, including common areas and gardens.',
  //   type: 'DATE',
  //   helpText: '',
  //   options: [
  //     {
  //       label: 'Frequency of payment',
  //       value: 'frequency',
  //       hasDate: true,
  //       inputType: 'years',
  //       datePlaceholder: 'Years',
  //     },
  //     {
  //       label: 'Service charges amount',
  //       value: 'service_charge',
  //       hasDate: true,
  //       inputType: 'currency',
  //       datePlaceholder: '£ 1500',
  //     },
  //   ],
  //   points: 100,
  //   order: 7,
  // },

  // Question 8
  {
    sectionKey: 'ownershipProfile',
    taskKey: 'give_your_home_a_story',
    title: '',
    description: '',
    type: 'MULTIPART',
    helpText: '',
    parts: [
      {
        partKey: 'features',
        type: 'chips',
        title: 'Specify what type of property you are selling',
        description:
          'If your property is link-detached, that is linked to another property only by a garage or other structure but not a structural wall of the house, choose ‘detached’.',
        options: [
          { label: 'Detached', value: 'detached' },
          { label: 'Semi-Detached', value: 'semi_detached' },
          { label: 'Terraced', value: 'terraced' },
          { label: 'Flat', value: 'flat' },
          { label: 'Maisonette', value: 'maisonette' },
          { label: 'Bungalow', value: 'bungalow' },
          { label: 'Dormer Bungalow', value: 'dormer_bungalow' },
          { label: 'Mobile Home', value: 'mobile_home' },
          { label: 'Boat', value: 'boat' },
          { label: 'Parking', value: 'parking' },
          { label: 'Land', value: 'land' },
        ],
        order: 1,
      },
      {
        partKey: 'number_of_rooms',
        type: 'chips',
        title: 'Specify what rooms are in this property',
        description: 'Select numbers of bedrooms or specify in the box below’.',
        options: [
          { label: 'Studio', value: 'studio' },
          { label: '1', value: '1' },
          { label: '2', value: '2' },
          { label: '3', value: '3' },
          { label: '4', value: '4' },
          { label: '5', value: '5' },
          { label: '6', value: '6' },
          { label: '7', value: '7' },
        ],
        order: 2,
      },
      {
        partKey: 'number_of_bathrooms',
        type: 'chips',
        title: '',
        description: 'Select numbers of bathrooms or specify in the box below',
        options: [
          { label: '1', value: '1' },
          { label: '2', value: '2' },
          { label: '3', value: '3' },
          { label: '4', value: '4' },
          { label: '5', value: '5' },
          { label: '6', value: '6' },
          { label: '7', value: '7' },
        ],
        order: 3,
      },
      {
        partKey: 'kitchen',
        type: 'chips',
        title: 'Select any special features of the property',
        description: 'Kitchen',
        options: [
          { label: 'Integrated Appliances', value: 'integrated_appliances' },
          { label: 'Open Plan Kitchen', value: 'open_plan_kitchen' },
          { label: 'Kitchen Dinner', value: 'kitchen_dinner' },
          { label: 'Kitchen Island', value: 'kitchen_island' },
          { label: 'Breakfast Bar', value: 'breakfast_bar' },
          { label: 'Gallery', value: 'gallery' },
        ],
        order: 4,
      },
      {
        partKey: 'bathroom',
        type: 'chips',
        title: '',
        description: 'Bathroom',
        options: [
          { label: 'Ensuite', value: 'ensuite' },
          { label: 'Downstairs Toilets', value: 'downstairs_toilets' },
          { label: 'Upstairs Toilets', value: 'upstairs_toilets' },
          { label: 'Walk-In Shower', value: 'walk_in_shower' },
          { label: 'Freestanding Bath', value: 'freestanding_bath' },
        ],
        order: 5,
      },
      {
        partKey: 'living_space',
        type: 'chips',
        title: '',
        description: 'Living Space',
        options: [
          { label: 'Living Room', value: 'living_room' },
          { label: 'Dining Room', value: 'dining_room' },
          { label: 'Conservatory', value: 'conservatory' },
          { label: 'Home Office', value: 'home_office' },
          { label: 'Utility Room', value: 'utility_room' },
          { label: 'Dressing Room', value: 'dressing_room' },
        ],
        order: 6,
      },

      {
        partKey: 'flooring',
        type: 'chips',
        title: '',
        description: 'Flooring',
        options: [
          { label: 'Laminated ', value: 'laminated ' },
          { label: 'Wooden', value: 'wooden' },
          { label: 'Stone', value: 'stone' },
        ],
        order: 7,
      },

      {
        partKey: 'features',
        type: 'chips',
        title: '',
        description: 'Features',
        options: [
          { label: 'Exposed Brickwork', value: 'exposed_brickwork' },
          { label: 'Fireplace', value: 'fireplace' },
          { label: 'High Ceilings', value: 'high_ceilings' },
          { label: 'Sash Windows', value: 'sash_windows' },
          { label: 'Wooden Beams', value: 'wooden_beams' },
        ],
        order: 8,
      },
    ],
    points: 200,
    order: 9,
  },

  // {
  //   sectionKey: 'ownershipProfile',
  //   taskKey: 'give_your_home_a_story',
  //   title:
  //     'If your lease includes a service charge, it will set out the way the service charge is organised and what can be charged.',
  //   description:
  //     'Service charges are usually for the maintenance and upkeep of the property, including common areas and gardens.',
  //   type: 'DATE',
  //   helpText: '',
  //   options: [
  //     {
  //       label: 'Frequency of payment',
  //       value: 'frequency',
  //       hasDate: true,
  //       inputType: 'years',
  //       datePlaceholder: 'Years',
  //     },
  //     {
  //       label: 'Service charges amount',
  //       value: 'service_charge',
  //       hasDate: true,
  //       inputType: 'currency',
  //       datePlaceholder: '£ 1500',
  //     },
  //   ],
  //   points: 100,
  //   order: 7,
  // },

  // {
  //   sectionKey: 'ownershipProfile',
  //   taskKey: 'give_your_home_a_story',
  //   title: 'What is the type of the ownership?',
  //   description:
  //     'National Trading Standard’s guidance includes a non-traditional tenure category (park homes and riverboats).',
  //   type: 'CHECKBOX',
  //   helpText: '',
  //   options: [
  //     { label: 'Detached', value: 'detached' },
  //     { label: 'Semi-Detached', value: 'semi_detached' },
  //     { label: 'Terraced', value: 'terraced' },
  //     { label: 'Flat', value: 'flat' },
  //     { label: 'Maisonette', value: 'maisonette' },
  //     { label: 'Bungalow', value: 'bungalow' },
  //     { label: 'Dormer Bungalow', value: 'dormer_bungalow' },
  //     { label: 'Mobile Home', value: 'mobile_home' },
  //     { label: 'Boat', value: 'boat' },
  //     { label: 'Parking', value: 'parking' },
  //     { label: 'Land', value: 'land' },
  //   ],
  //   points: 100,
  //   order: 8,
  // },

  // {
  //   sectionKey: 'ownershipProfile',
  //   taskKey: 'give_your_home_a_story',
  //   title: 'Name of sellers and address of the property (combined)',
  //   description: '',
  //   type: 'MULTIPART',
  //   helpText: '',
  //   parts: [
  //     {
  //       partKey: 'shared_ownership',
  //       type: 'date',
  //       title:
  //         'Please enter the percentage of shared ownership and state how much rent you pay each year for the share that is not owned by you.',
  //       options: [
  //         {
  //           label: 'Enter percentage',
  //           value: 'percentage',
  //           hasDate: true,
  //           inputType: 'percentage',
  //           datePlaceholder: '00%',
  //         },
  //         {
  //           label: 'Enter rent amount',
  //           value: 'rent_amount',
  //           hasDate: true,
  //           inputType: 'currency',
  //           datePlaceholder: '£ 1500',
  //         },
  //       ],
  //       order: 1,
  //     },
  //     {
  //       partKey: 'lease_info',
  //       type: 'date',
  //       title: 'Please enter the expiry date and length of your lease.',
  //       options: [
  //         {
  //           label: 'Select expiry date',
  //           value: 'expiry_date',
  //           hasDate: true,
  //           dateFormat: 'fullDate',
  //           datePlaceholder: 'Select expiry date',
  //         },
  //         {
  //           label: 'Length of lease',
  //           value: 'lease_length',
  //           hasDate: true,
  //           inputType: 'years',
  //           datePlaceholder: 'Years',
  //         },
  //       ],
  //       order: 2,
  //     },
  //   ],
  //   points: 200,
  //   order: 9,
  // },

  // {
  //   sectionKey: 'ownershipProfile',
  //   taskKey: 'give_your_home_a_story',
  //   title: 'What we love about our home?',
  //   description: '',
  //   type: 'CHECKBOX',
  //   helpText: '',
  //   options: [
  //     {
  //       label: 'Morning light in the kitchen',
  //       value: 'morning_light_in_the_kitchen',
  //     },
  //     {
  //       label: 'Kids can walk to school in 6 mins',
  //       value: 'kids_can_walk_to_school_in_6_mins',
  //     },
  //     {
  //       label: 'Neighbors are friendly but not intrusive ',
  //       value: 'neighbors_are_friendly_but_not_intrusive',
  //     },
  //   ],
  //   points: 100,
  //   order: 10,
  // },

  // {
  //   sectionKey: 'ownershipProfile',
  //   taskKey: 'name_and_address_multipart',
  //   title: 'Name of sellers and address of the property (combined)',
  //   description:
  //     'Multipart: owner names, property address, representative info, uploads and collaborators',
  //   type: 'MULTIPART',
  //   helpText: '',
  //   parts: [
  //     {
  //       partKey: 'owner_names',
  //       type: 'text',
  //       title: 'Full names of the seller(s)',
  //       placeholder: 'Enter full names',
  //       order: 1,
  //     },
  //     {
  //       partKey: 'property_address',
  //       type: 'address',
  //       title: 'Property address',
  //       placeholder: '12 Example Road, AB1 2CD',
  //       order: 2,
  //     },
  //     {
  //       partKey: 'representative',
  //       type: 'radio',
  //       title: 'Are you completing this form on behalf of the seller?',
  //       options: [
  //         { label: 'Yes', value: 'yes' },
  //         { label: 'No', value: 'no' },
  //       ],
  //       order: 3,
  //     },
  //     {
  //       partKey: 'company_details',
  //       type: 'text',
  //       title: 'Company details (if seller is a company)',
  //       placeholder: 'Company name, registration number',
  //       order: 4,
  //     },
  //     {
  //       partKey: 'photos',
  //       type: 'upload',
  //       title: 'Upload photos of the property',
  //       uploadInstruction: 'Add up to 6 photos',
  //       order: 5,
  //     },
  //     {
  //       partKey: 'features',
  //       type: 'chips',
  //       title: 'What we love about our home?',
  //       options: [
  //         { label: 'Morning light', value: 'morning_light' },
  //         { label: 'Large garden', value: 'large_garden' },
  //         { label: 'Great transport links', value: 'transport' },
  //       ],
  //       order: 6,
  //     },
  //     {
  //       partKey: 'collaborators',
  //       type: 'collaborators',
  //       title: 'Collaborators',
  //       order: 7,
  //     },
  //   ],
  //   points: 200,
  //   order: 8,
  // },

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
      content:
        'If the property is leasehold this section, or parts of it, may not apply.',
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
    type: 'BOUNDARY',
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

  // ────────────────────────────────────────────
  // BOUNDARIES — Task: Irregular Boundaries
  // ────────────────────────────────────────────

  {
    sectionKey: 'boundaries',
    taskKey: 'irregular_boundaries',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    autoSaveOn: {
      partKey: 'Are_irregular_boundaries',
      value: 'no',
    },
    parts: [
      {
        partKey: 'Are_irregular_boundaries',
        title: 'Are the boundaries irregular?',
        description: 'If yes, please give details below',
        type: 'RADIO',
        helpText:
          'If the property’s boundaries are irregular, ownership should be defined either with a clear written description, using landmarks or measurements, or by referring to a plan or map that shows the exact outline.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        display: 'both',
        title:
          'Please indicate ownership by written instruction or by reference to a plan:',
        placeholder:
          'E.g., The irregular boundary near the stream at the rear of the property is owned by...',
        conditionalOn: 'Are_irregular_boundaries',
        showOnValues: ['yes'],
        required: true, // only required if shown
        order: 2,
      },
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
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    autoSaveOn: {
      partKey: 'is_seller_aware',
      value: 'no',
    },
    parts: [
      {
        partKey: 'is_seller_aware',
        title:
          'Is the seller aware of any boundary feature having been moved in the last 10 years, or during the seller’s period of ownership if longer?',
        description: 'If yes, please give details below',
        helpText:
          'This is to flag any past changes to fences, walls, or hedges that might affect where the legal boundary really is. Even small changes can lead to neighbour disputes or sale delays, so any changes need to be clearly documented.',
        type: 'RADIO',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        display: 'both',
        title: 'Please provide written instruction for your answer above:',
        placeholder:
          'E.g., Back fence in the garden has been moved back 2 yards...',
        conditionalOn: 'is_seller_aware',
        showOnValues: ['yes'],
        required: true, // only required if shown
        order: 2,
      },
    ],
    points: 100,
    order: 1,
  },

  // ────────────────────────────────────────────
  // BOUNDARIES — Task: Adjacent Land Purchased
  // ────────────────────────────────────────────

  {
    sectionKey: 'boundaries',
    taskKey: 'adjacent_land_purchased',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    autoSaveOn: {
      partKey: 'seller_ownership',
      value: 'no',
    },
    parts: [
      {
        partKey: 'seller_ownership',
        title:
          'During the seller’s ownership, has any adjacent land or property been purchased by the seller?',
        description: 'If yes, please give details below',
        type: 'RADIO',
        helpText:
          'If you have purchased extra land or property next to your home, please provide details such as the address, title number, or a detailed description. as this could change the size or boundaries of what’s being sold.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        display: 'both',
        title: 'Please provide written instruction for your answer above:',
        placeholder:
          'E.g., Back fence in the garden has been moved back 2 yards...',
        conditionalOn: 'seller_ownership',
        showOnValues: ['yes'],
        required: true, // only required if shown
        order: 2,
      },
    ],
    points: 100,
    order: 1,
  },

  // ────────────────────────────────────────────
  // BOUNDARIES — Task: Complex Boundaries
  // ────────────────────────────────────────────

  {
    sectionKey: 'boundaries',
    taskKey: 'complex_boundaries',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    autoSaveOn: {
      partKey: 'seller_ownership_complex',
      value: 'no',
    },
    parts: [
      {
        partKey: 'seller_ownership_complex',
        title:
          'Does any part of the property overhang, or project under, the boundary of the neighbouring property or road, for example cellars under the pavement, roof eaves or a covered walkway?',
        description: 'If yes, please give details below',
        type: 'RADIO',
        helpText:
          'If any part of your home extends beyond its boundary please detail what the feature is, it’s location, size and any applicable rights/ permissions, as this could affect rights/ responsibilities with neighbours or the council.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        display: 'both',
        title: 'Please provide written instruction for your answer above:',
        placeholder: 'E.g., Cellar under the property...',
        conditionalOn: 'seller_ownership_complex',
        showOnValues: ['yes'],
        required: true, // only required if shown
        order: 2,
      },
    ],
    points: 100,
    order: 1,
  },

  // ────────────────────────────────────────────
  // BOUNDARIES — Task: Notices under the Party Wall Act 1996
  // ────────────────────────────────────────────

  {
    sectionKey: 'boundaries',
    taskKey: 'notices_under_the_party_wall_act_1996',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    autoSaveOn: {
      partKey: 'notice_received',
      value: 'no',
    },
    parts: [
      {
        partKey: 'notice_received',
        title:
          'Has any notice been received under the Party Wall Act 1996, in respect of any shared/party boundaries?',
        description: 'If yes, please give details below',
        type: 'RADIO',
        helpText:
          'If a formal notice under the Party Wall Act 1996 has been received, please detail what it was for, when it was received, who served it, and whether the works were completed or an agreement was made. ',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        display: 'both',
        title: 'Please provide written instruction for your answer above:',
        placeholder: 'E.g., Notice received in 2021 for repair work to fence..',
        conditionalOn: 'notice_received',
        showOnValues: ['yes'],
        required: true, // only required if shown
        order: 2,
      },
    ],
    points: 100,
    order: 1,
  },

  // ────────────────────────────────────────────
  // DISPUTES AND COMPLAINTS
  // ────────────────────────────────────────────

  {
    sectionKey: 'disputesAndComplaints',
    taskKey: 'past_disputes_or_complaints',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    autoSaveOn: {
      partKey: 'problems_affecting_property',
      value: 'no',
    },
    parts: [
      {
        partKey: 'problems_affecting_property',
        title:
          'Have there been any disputes or complaints regarding this property or a property nearby? ',
        description: 'If yes, please give details below',
        type: 'RADIO',
        helpText:
          'If there has been any arguments, formal complaints, or legal issues about this home or a nearby one (such as rows over noise, parking, boundaries or shared areas) please detail what it was about, who it involved, when it happened, and how it was resolved or if it’s still ongoing.  ',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        display: 'both',
        title: 'Please provide written instruction for your answer above:',
        placeholder: 'E.g., Dispute over noise with neighbours ',
        conditionalOn: 'problems_affecting_property',
        showOnValues: ['yes'],
        required: true, // only required if shown
        order: 2,
      },
    ],
    points: 50,
    order: 1,
  },

  // {
  //   sectionKey: 'disputesAndComplaints',
  //   taskKey: 'past_disputes_or_complaints',
  //   title:
  //     'Have there been any disputes or complaints regarding this property or a property nearby?',
  //   description: 'If yes, please give details below',
  //   type: 'RADIO',
  //   helpText:
  //     "If there has been any arguments, formal complaints, or legal issues about this home or a nearby one (such as rows over noise, parking, boundaries or shared areas) please detail what it was about, who it involved, when it happened, and how it was resolved or if it's still ongoing. ",
  //   options: [
  //     { label: 'Yes', value: 'yes' },
  //     { label: 'No', value: 'no' },
  //   ],
  //   points: 50,
  //   order: 1,
  // },

  {
    sectionKey: 'disputesAndComplaints',
    taskKey: 'prospective_disputes_or_complaints',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    autoSaveOn: {
      partKey: 'prospect_disputes_question',
      value: 'no',
    },
    parts: [
      {
        partKey: 'prospect_disputes_question',
        title:
          'Is the seller aware of anything which might lead to a dispute about the property or a property nearby?',
        description: 'If yes, please give details below',
        type: 'RADIO',
        helpText:
          'If you are aware of any issues that could cause arguments or legal disputes about this property or nearby properties in the future, such as disagreements over boundaries, access, or shared spaces, please detail what the possible issue is, who it involves, why it could cause a dispute, and if anything has been done about it.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        display: 'both',
        title: 'Please provide written instruction for your answer above:',
        placeholder:
          "E.g., Potential dispute over responsibility for hedge between mine and neighbour to the left's garden..",
        conditionalOn: 'prospect_disputes_question',
        showOnValues: ['yes'],
        required: true, // only required if shown
        order: 2,
      },
    ],
    points: 50,
    order: 1,
  },

  // {
  //   sectionKey: 'disputesAndComplaints',
  //   taskKey: 'prospective_disputes_or_complaints',
  //   title:
  //     'Is the seller aware of anything which might lead to a dispute about the property or a property nearby?  ',
  //   description: 'If yes, please give details below',
  //   type: 'RADIO',
  //   helpText:
  //     'If you are aware of any issues that could cause arguments or legal disputes about this property or nearby properties in the future, such as disagreements over boundaries, access, or shared spaces, please detail what the possible issue is, who it involves, why it could cause a dispute, and if anything has been done about it.',
  //   options: [
  //     { label: 'Yes', value: 'yes' },
  //     { label: 'No', value: 'no' },
  //   ],
  //   points: 100,
  //   order: 1,
  // },

  // ────────────────────────────────────────────
  // NOTICES AND PROPOSALS
  // ────────────────────────────────────────────

  {
    sectionKey: 'noticesAndProposals',
    taskKey: 'received_or_sent_notices',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    autoSaveOn: {
      partKey: 'notices_or_correspondence',
      value: 'no',
    },
    parts: [
      {
        partKey: 'notices_or_correspondence',
        title:
          'Have any notices or correspondence been received or sent (e.g.from or to a neighbour, council or government department) or any negotiations or discussions taken place, which affect the property or a property nearby?',
        description: 'If yes, please give details below',
        type: 'RADIO',
        helpText:
          'This asks whether there have been any official letters, emails, notices, or any talks with neighbours, the council, or government about matters affecting this property or a nearby one. Examples include planning or enforcement notices, boundary or access issues, party wall matters, building control, highways/parking changes, tree preservation, noise/ASB notices, or utility works.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        display: 'both',
        title: 'Please provide written instruction for your answer above:',
        placeholder: 'E.g., Lorem Ipsum',
        conditionalOn: 'notices_or_correspondence',
        showOnValues: ['yes'],
        required: true, // only required if shown
        order: 2,
      },
    ],
    points: 50,
    order: 1,
  },

  // {
  //   sectionKey: 'noticesAndProposals',
  //   taskKey: 'received_or_sent_notices',
  //   title:
  //     'Have  any notices or correspondence been received or sent (e.g.from or to a neighbour, council or government department) or any negotiations or discussions taken place, which affect the property or a property nearby?',
  //   description: 'If yes, please give details below',
  //   type: 'RADIO',
  //   helpText:
  //     'This asks whether there have been any official letters, emails, notices, or any talks with neighbours, the council, or government about matters affecting this property or a nearby one. Examples include planning or enforcement notices, boundary or access issues, party wall matters, building control, highways/parking changes, tree preservation, noise/ASB notices, or utility works.',
  //   options: [
  //     { label: 'Yes', value: 'yes' },
  //     { label: 'No', value: 'no' },
  //   ],
  //   points: 75,
  //   order: 1,
  // },

  {
    sectionKey: 'noticesAndProposals',
    taskKey: 'proposals_to_develop_or_alter',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    autoSaveOn: {
      partKey: 'seller_aware_of_any_proposals',
      value: 'no',
    },
    parts: [
      {
        partKey: 'seller_aware_of_any_proposals',
        title:
          'Is the seller aware of any proposals to develop property or land nearby, or, any proposals to make alterations to buildings nearby?',
        description: 'If yes, please give details below',
        type: 'RADIO',
        helpText:
          'This asks if the seller knows of any planned building work or developments nearby — such as new housing, extensions, or changes to existing buildings — that could affect the property or its surroundings.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        display: 'both',
        title: 'Please provide written instruction for your answer above:',
        placeholder: 'E.g., Lorem Ipsum',
        conditionalOn: 'seller_aware_of_any_proposals',
        showOnValues: ['yes'],
        required: true, // only required if shown
        order: 2,
      },
    ],
    points: 50,
    order: 1,
  },

  // {
  //   sectionKey: 'noticesAndProposals',
  //   taskKey: 'proposals_to_develop_or_alter',
  //   title:
  //     'Is the seller aware of any proposals to develop property or land nearby, or, any proposals to make alterations to buildings nearby?',
  //   description: 'If yes, please give details below',
  //   type: 'RADIO',
  //   helpText:
  //     'This asks whether there have been any official letters, emails, notices, or any talks with neighbours, the council, or government about matters affecting this property or a nearby one. Examples include planning or enforcement notices, boundary or access issues, party wall matters, building control, highways/parking changes, tree preservation, noise/ASB notices, or utility works.',
  //   options: [
  //     { label: 'Yes', value: 'yes' },
  //     { label: 'No', value: 'no' },
  //   ],
  //   points: 100,
  //   order: 1,
  // },

  // ────────────────────────────────────────────
  // ALTERATIONS AND PLANNING
  // ────────────────────────────────────────────
  {
    sectionKey: 'alterationsAndPlanning',
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
    points: 75,
    order: 1,
  },
  // Alterations and Planning Question 1
  {
    sectionKey: 'alterationsAndPlanning',
    taskKey: 'building_works',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'Are_irregular_boundaries',
        title:
          'Have any of the following changes been made to the whole or any part of the property (including the garden)?',
        description:
          'If yes, please give details including dates of all work undertaken below and supply copies of the planning permissions, Building Regulations approvals and Completion Certificates',
        type: 'DATE',
        helpText:
          'This section asks whether any alterations or building works have been carried out to the property or garden, such as extensions, loft or garage conversions, or the removal of internal walls. These details help identify if planning permission or building control approval was required.',
        options: [
          {
            label: 'Yes, select year',
            value: 'selected',
            hasDate: true,
            dateFormat: 'fullDate',
            datePlaceholder: 'Select date',
          },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        display: 'both',
        title:
          'Please indicate ownership by written instruction or by reference to a plan:',
        placeholder:
          'E.g., The irregular boundary near the stream at the rear of the property is owned by...',
        order: 2,
      },
    ],
    points: 100,
    order: 1,
  },

  // {
  //   sectionKey: 'alterationsAndPlanning',
  //   taskKey: 'building_works',
  //   title:
  //     'Have any of the following changes been made to the whole or any part of the property (including the garden)?',
  //   description:
  //     'If yes, please give details including dates of all work undertaken below and supply copies of the planning permissions, Building Regulations approvals and Completion Certificates',
  //   type: 'DATE',
  //   helpText:
  //     'This section asks whether any alterations or building works have been carried out to the property or garden, such as extensions, loft or garage conversions, or the removal of internal walls. These details help identify if planning permission or building control approval was required.',
  //   options: [
  //     {
  //       label: 'Yes, select year',
  //       value: 'selected',
  //       hasDate: true,
  //       dateFormat: 'fullDate',
  //       datePlaceholder: 'Select date',
  //     },
  //   ],
  //   points: 100,
  //   order: 1,
  // },

  {
    sectionKey: 'alterationsAndPlanning',
    taskKey: 'building_works',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'Are_irregular_boundaries',
        title:
          'Are any of the works disclosed in previous questions unfinished?',
        description: 'If yes, please give details:',
        type: 'RADIO',
        helpText:
          'This section asks whether any alterations or building works have been carried out to the property or garden, such as extensions, loft or garage conversions, or the removal of internal walls, and are unfinished. If so, please provide details of what work is incomplete, where it is and what is outstanding. ',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above:',
        placeholder:
          'E.g., Garage conversion on side of house hasn’t been finished yet - windows and doors need to be fitted...',
        order: 2,
      },
    ],
    points: 100,
    order: 1,
  },

  {
    sectionKey: 'alterationsAndPlanning',
    taskKey: 'breaches_of_consent_conditions',
    title: 'Are any of the works disclosed in previous questions unfinished?',
    description: 'If yes, please give details:',
    type: 'MULTIPART' as QuestionType,
    parts: [
      {
        partKey: 'Are_irregular_boundaries',
        title:
          'Are any of the works disclosed in previous questions unfinished?',
        description: 'If yes, please give details:',
        type: 'RADIO',
        helpText:
          'This section asks whether any alterations or building works have been carried out to the property or garden, such as extensions, loft or garage conversions, or the removal of internal walls, and are unfinished. If so, please provide details of what work is incomplete, where it is and what is outstanding. ',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above:',
        placeholder:
          'E.g., Garage conversion on side of house hasn’t been finished yet - windows and doors need to be fitted...',
        order: 2,
      },
    ],
    points: 50,
    order: 1,
  },

  // {
  //   sectionKey: 'alterationsAndPlanning',
  //   taskKey: 'building_works',
  //   title:
  //     'Is the seller aware of any breaches of planning permission conditions or Building Regulations consent conditions, unfinished work or work that does not have all necessary consents?',
  //   description: 'If yes, please give details:',
  //   type: 'RADIO',
  //   helpText:
  //     'This section asks if any of the works or alterations to the property were complete without approval or did not comply with planning or building regulations. If yes, please detail what the works are, when they happened and the nature of the breach.',
  //   options: [
  //     { label: 'Yes', value: 'yes' },
  //     { label: 'No', value: 'no' },
  //   ],
  //   points: 50,
  //   order: 1,
  // },

  {
    sectionKey: 'alterationsAndPlanning',
    taskKey: 'planning_or_building_issues',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'Are_irregular_boundaries',
        title:
          'Is the seller aware of any breaches of planningpermission conditions or Building Regulations consent conditions, unfinished work or work that does not have all necessary consents',
        description: 'If yes, please give details:',
        type: 'RADIO',
        helpText:
          'This section asks if any of the works or alterations to the property were complete without approval or did not comply with planning or building regulations. If yes, please detail what the works are, when they happened and the nature of the breach. ',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above:',
        placeholder:
          'E.g., Extension was complete without the right approval...',
        order: 2,
      },
    ],
    points: 50,
    order: 2,
  },

  {
    sectionKey: 'alterationsAndPlanning',
    taskKey: 'planning_or_building_issues',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'Are_irregular_boundaries',
        title: 'Are there any planning or building control issues to resolve?',
        description: 'If yes, please give details:',
        type: 'RADIO',
        helpText:
          'If you answered yes to the previous question, it is likely you may have ongoing issues requiring resolution with the relevant bodies for that work. This could include: applying for retrospective consent or meeting conditions for approval. If yes, please detail what the issue is, what part of the property it applies to, key dates, what has been done so far and what still needs to be resolved. ',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above:',
        placeholder:
          'E.g., Retrospective planning for a garage conversion was applied for on the 17th August 2025, we are awaiting an update from the planning authority...',
        order: 2,
      },
    ],
    points: 50,
    order: 2,
  },

  {
    sectionKey: 'alterationsAndPlanning',
    taskKey: 'solar_panels',
    title: 'Have solar panels been installed?',
    description: 'If yes, in what year were the solar panels installed?',
    type: 'RADIO',
    helpText:
      'If yes, please detail the year you had the solar panels installed. Check your installation papers, guarantees, planning records or energy statements. If the panels are leased, details may also be in the title deeds.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 1,
  },

  {
    sectionKey: 'alterationsAndPlanning',
    taskKey: 'solar_panels_ownership',
    title: 'Are the solar panels owned outright?',
    description: 'Please answer yes or no:',
    type: 'RADIO',
    helpText:
      'This is confirming whether the panels belong fully to the property owner or if a solar company installed them under a lease or roof-rental scheme and thus has rights over them.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 1,
  },

  {
    sectionKey: 'alterationsAndPlanning',
    taskKey: 'solar_panel_roof_lease',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'Party_Wall',
        title:
          'Has a long lease of the roof/air space been granted to a solar panel provider?',
        description:
          'If yes, please supply copies of the agreement, electricity bills or tariff payment records and contact details of the provider:',
        type: 'RADIO',
        helpText:
          'If solar panels have been installed by a provider, a lease of the space where the panels are installed is typically required. This information can be found on your roof lease agreement which you would have received and signed at the time of installation by the provider.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'upload',
        title: 'Please supply copies of the relevant documents: ',
        placeholder: '',
        order: 2,
      },
    ],
    points: 75,
    order: 1,
  },

  {
    sectionKey: 'alterationsAndPlanning',
    taskKey: 'listed_building',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'roof_air',
        title: 'Is the property or any part of it: a listed building??',
        description:
          'If yes, please supply copies of the confirmation of listing status and any consent for works:',
        type: 'RADIO',
        helpText:
          'A listed building is one that appears on the National Heritage List for England because it has special architectural or historic importance. Listing applies to the whole property and sometimes attached structures (e.g. outbuilding). You can find confirmation of listing status online.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'upload',
        title: 'Please supply copies of the relevant documents: ',
        placeholder: '',
        order: 2,
      },
    ],
    points: 75,
    order: 1,
  },

  {
    sectionKey: 'alterationsAndPlanning',
    taskKey: 'conservation_orders',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'roof_air',
        title: 'Is the property or any part of it: in a conservation area?',
        description:
          'If yes, please supply copies of the confirmation of conservation status, planning permission/ consents for work, any restrictions or conditions from previous applications',
        type: 'RADIO',
        helpText:
          'A conservation area is a designated zone of special architectural or historic interest, where extra planning controls protect the character of the neighbourhood. The local council’s planning department keeps a list and map of conservation areas.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'upload',
        title: 'Please supply copies of the relevant documents: ',
        placeholder: '',
        order: 2,
      },
    ],
    points: 25,
    order: 1,
  },

  {
    sectionKey: 'alterationsAndPlanning',
    taskKey: 'tree_preservation_orders',
    title:
      'Are any of the trees on the property subject to a Tree Preservation Order?',
    description: 'Please select yes or no:',
    type: 'RADIO',
    helpText:
      "A Tree Preservation Order is made by the local council to protect specific trees or woodlands because of their contribution to the local environment. This information would've been highlighted when the property was purchased, or a formal notice would've been received from the council.",
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 1,
  },

  {
    sectionKey: 'alterationsAndPlanning',
    taskKey: 'tree_preservation_orders',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'roof_air',
        title: 'Have the terms of the Order been complied with?',
        description:
          'If yes, please supply copies of the confirmation of conservation status, planning permission/ consents for work, any restrictions or conditions from previous applications',
        type: 'RADIO',
        helpText:
          'A conservation area is a designated zone of special architectural or historic interest, where extra planning controls protect the character of the neighbourhood. The local council’s planning department keeps a list and map of conservation areas.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'upload',
        title: 'Please supply copies of the relevant documents: ',
        placeholder: '',
        order: 2,
      },
    ],
    points: 75,
    order: 2,
  },

  // ────────────────────────────────────────────
  // GUARANTEES AND WARRANTIES
  // ────────────────────────────────────────────
  {
    sectionKey: 'guaranteesAndWarranties',
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
    points: 75,
    order: 1,
  },

  {
    sectionKey: 'guaranteesAndWarranties',
    taskKey: 'new_home_warranty',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'detail_outcomes',
        title:
          'Does the property benefit from any New Home guarantees or warranties? (e.g. NHBC or similar)',
        description:
          'Document any planning applications orIf yes, please provide details of the provider, policy number, start and end date, a copy of the certificate and any claims made under the warranty with details and outcomes. notices',
        type: 'RADIO',
        helpText:
          'New home warranties typically cover structural defects for 10 years and are usually provided by NHBC, Premier Guarantee, or similar providers. ',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title:
          'Please provide written instruction for your answer above and supply copies of the relevant documents:',
        placeholder:
          'E.g., Kitchen appliance warranty, garden landscaping guarantee, pest control treatment...',
        order: 2,
        display: 'both',
      },
    ],
    points: 100,
    order: 1,
  },

  {
    sectionKey: 'guaranteesAndWarranties',
    taskKey: 'damp_proofing',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'does_property_benefit',
        title:
          'Does the property benefit from any Damp Proofing guarantees or warranties?',
        description:
          'If yes, please provide details of the provider, policy number, start and end date, a copy of the certificate and any claims made under the warranty with details and outcomes.',
        type: 'RADIO',
        helpText:
          'Certificate from the installer (often insurance-backed) confirming damp treatment, the date, and areas treated. Usually transferable to a new owner if notified; keep paperwork and follow any maintenance conditions to claim. ',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title:
          'Please provide written instruction for your answer above and supply copies of the relevant documents:',
        placeholder:
          'E.g., “I had damp proofing done, but I can’t find the guarantee paperwork.',
        order: 2,
        display: 'both',
      },
    ],
    points: 100,
    order: 1,
  },

  {
    sectionKey: 'guaranteesAndWarranties',
    taskKey: 'timber_treatment',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'inspection_treatment',
        title:
          'Does the property benefit from any Timber Treatment guarantees or warranties?',
        description:
          'If yes, please provide details of the provider, policy number, start and end date, a copy of the certificate and any claims made under the warranty with details and outcomes.',
        type: 'RADIO',
        helpText:
          'Timber treatment is the inspection and treatment of structural wood to eradicate or prevent wood-boring insects and rot (e.g., woodworm, wet/dry rot), typically using approved insecticides/fungicides and targeted repairs.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title:
          'Please provide written instruction for your answer above and supply copies of the relevant documents:',
        placeholder:
          'E.g., I have not had any work carried out or I have but cant find the guarantee/warranty',
        order: 2,
        display: 'both',
      },
    ],
    points: 100,
    order: 1,
  },

  {
    sectionKey: 'guaranteesAndWarranties',
    taskKey: 'window_roof_light_door',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'glazed_doors_guarantees',
        title:
          'Does the property benefit from any Windows, Roof Lights, Roof Windows or Glazed Doors guarantees or warranties?',
        description:
          'If yes, please provide details of the provider, policy number, start and end date, a copy of the certificate and any claims made under the warranty with details and outcomes.',
        type: 'RADIO',
        helpText:
          'These are typically given when any windows, roof lights, or glazed doors are installed or replaced They protect the homeowner if there are problems with the products or the way they were fitted.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title:
          'Please provide written instruction for your answer above and supply copies of the relevant documents:',
        placeholder:
          'E.g.,I have had work done, but my friend did it, or I can’t find the certificate',
        order: 2,
        display: 'both',
      },
    ],
    points: 100,
    order: 1,
  },

  {
    sectionKey: 'guaranteesAndWarranties',
    taskKey: 'electrical_work',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'policy_number',
        title:
          'Does the property benefit from any electrical work guarantees or warranties?',
        description:
          'If yes, please provide details of the provider, policy number, start and end date, a copy of the certificate and any claims made under the warranty with details and outcomes.',
        type: 'RADIO',
        helpText:
          'When electrical work is carried out (such as rewiring, installing a new consumer unit, or adding circuits), the installer sometimes provides a guarantee/warranty. This paperwork would’ve been provided by your supplier after the works have been completed.Provide dates/contractor and term; if missing/expired, buyer may request an EICR or indemnity.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above',
        placeholder:
          'E.g.,I have had work done, but my friend did it, or I can’t find the certificate',
        order: 2,
        display: 'both',
      },
    ],
    points: 100,
    order: 1,
  },

  {
    sectionKey: 'guaranteesAndWarranties',
    taskKey: 'roofing',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'replaced_materials',
        title:
          'Does the property benefit from any of the following guarantees or warranties:',
        description: 'roofing',
        type: 'RADIO',
        helpText:
          'Checks if any roofing was installed/replaced/repaired (including flat roofs).If yes, give what was done, dates, contractor, materials, compliance proof (Building Control/CompetentRoofer), and any warranty.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above',
        placeholder:
          'E.g., Kitchen appliance warranty, garden landscaping guarantee, pest control treatment...',
        order: 2,
        display: 'both',
      },
    ],
    points: 100,
    order: 1,
  },

  {
    sectionKey: 'guaranteesAndWarranties',
    taskKey: 'central_heating',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'gase_safe',
        title:
          'Does the property benefit from any of the following guarantees or warranties:',
        description: 'central_heating',
        type: 'RADIO',
        helpText:
          'Checks if the property has central heating (any type: gas, electric, oil, heat pump). If yes, give system type, install/last-service dates, installer, compliance docs (e.g., Gas Safe/Building Control), and any warranty/manuals.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above',
        placeholder:
          'E.g., Kitchen appliance warranty, garden landscaping guarantee, pest control treatment...',
        order: 2,
        display: 'both',
      },
    ],
    points: 100,
    order: 1,
  },

  {
    sectionKey: 'guaranteesAndWarranties',
    taskKey: 'underpinning',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'underpinning_strengthens',
        title:
          'Does the property benefit from any of the following guarantees or warranties:',
        description: 'Underpinning',
        type: 'RADIO',
        helpText:
          'Underpinning strengthens the foundations (often after subsidence).If done, provide date/location, engineer/contractor, Building Control sign-off, and any warranty; missing docs may trigger extra surveys/indemnity.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above',
        placeholder:
          'E.g., maybe you had work done but cant find the guarantee.',
        order: 2,
        display: 'both',
      },
    ],
    points: 100,
    order: 1,
  },

  {
    sectionKey: 'guaranteesAndWarranties',
    taskKey: 'other',
    title:
      'Does the property benefit from any of the following guarantees or warranties:',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: ' ',
    parts: [
      {
        partKey: 'other_state',
        title:
          'Does the property benefit from any of the following guarantees or warranties:',
        description: 'Other/please state',
        type: 'RADIO',
        helpText: 'please write the other category here',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above',
        placeholder:
          'E.g., Kitchen appliance warranty, garden landscaping guarantee, pest control treatment...',
        order: 2,
        display: 'both',
      },
    ],
    points: 100,
    order: 1,
  },

  {
    sectionKey: 'guaranteesAndWarranties',
    taskKey: 'claims_made_under_guarantees_warranties',
    title:
      'Does the property benefit from any of the following guarantees or warranties:',
    description: 'Other/please state',
    type: 'RADIO',
    helpText: 'please write the other category here ',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 100,
    order: 1,
  },

  // ────────────────────────────────────────────
  // INSURANCE
  // ────────────────────────────────────────────
  {
    sectionKey: 'insurance',
    taskKey: 'seller_insurance',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    parts: [
      {
        partKey: 'insure_property',
        title: 'Does the seller insure the property?',
        description: 'Please answer Yes or No and provide details.',
        type: 'RADIO',
        helpText: 'Other',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Why does the seller not provide insurance for the property?',
        placeholder: 'Start typing your answer here...',
        order: 2,
      },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'insurance',
    taskKey: 'landlord_insurance',
    title: 'If the property is a flat, does the landlord insure the building?',
    description: 'Please answer Yes or No and provide details.',
    type: 'RADIO',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'insurance',
    taskKey: 'buildings_insurance',
    title:
      'Has any buildings insurance taken out by the seller ever been subject to an abnormal rise in premiums?',
    description: 'Please answer Yes or No and provide details.',
    type: 'RADIO',
    helpText: 'Other',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'insurance',
    taskKey: 'buildings_insurance',
    title:
      'Has any buildings insurance taken out by the seller ever been subject to high excesses?',
    description: 'Please answer Yes or No and provide details.',
    type: 'RADIO',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'insurance',
    taskKey: 'buildings_insurance',
    title:
      'Has any buildings insurance taken out by the seller ever been subject to unusual conditions?',
    description: 'Please answer Yes or No and provide details.',
    type: 'RADIO',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'insurance',
    taskKey: 'buildings_insurance',
    title:
      'Has any buildings insurance taken out by the seller ever been refused?',
    description: 'Please answer Yes or No and provide details.',
    type: 'RADIO',
    helpText: 'Other',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'insurance',
    taskKey: 'buildings_insurance',
    title:
      'What were the circumstances regarding the insurance issue(s) you indicated?',
    description: 'Please provide written details below',
    type: 'MULTIPART' as QuestionType,
    parts: [
      {
        partKey: 'photos',
        type: 'text',
        title: '',
        placeholder: 'Start typing your answer here...',
        order: 2,
      },
    ],
    displayMode: 'text',
    points: 50,
    order: 1,
  },
  {
    sectionKey: 'insurance',
    taskKey: 'buildings_insurance',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    parts: [
      {
        partKey: 'insurance_issue',
        title: 'Has the seller made any buildings insurance claims?',
        description: 'Please answer Yes or No and provide details.',
        type: 'RADIO',
        helpText: 'other',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title:
          'Please provide written details for building insurance claims made by the seller.',
        placeholder: 'Start typing your answer here...',
        order: 2,
      },
    ],
    points: 50,
    order: 1,
  },

  // ────────────────────────────────────────────
  // ENVIRONMENTAL
  // ────────────────────────────────────────────
  {
    sectionKey: 'environmental',
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
    points: 75,
    order: 1,
  },
  // {
  //   sectionKey: 'environmental',
  //   taskKey: 'Flooding',
  //   title:
  //     'Has any part of the property (whether buildings or surrounding garden or land) ever been flooded?',
  //   description:
  //     'If Yes, please state when the flooding occurred and identify the parts that flooded:',
  //   type: 'RADIO',
  //   helpText:
  //     'This includes planning permission notices or development proposals.',
  //   options: [
  //     { label: 'Yes', value: 'yes' },
  //     { label: 'No', value: 'no' },
  //   ],
  //   points: 50,
  //   order: 1,
  // },

  {
    sectionKey: 'environmental',
    taskKey: 'Flooding',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'have_any_part',
        title:
          'Has any part of the property (whether buildings or surrounding garden or land) ever been flooded?',
        description:
          'If Yes, please state when the flooding occurred and identify the parts that flooded:',
        type: 'RADIO',
        helpText: '',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title:
          'If Yes, please state when the flooding occurred and identify the parts that flooded:',
        placeholder:
          'E.g., Kitchen appliance warranty, garden landscaping guarantee, pest control treatment...',
        order: 2,
      },
      {
        partKey: 'does_the_property',
        title:
          'What kind of flooding occurred?. Please select all the options that apply:',
        description: '',
        type: 'CHECKBOX',
        helpText: '',
        options: [
          { label: 'Ground Water', value: 'ground_water' },
          { label: 'Sewer flooding', value: 'sewer_flooding' },
          { label: 'Surface water', value: 'surface_water' },
          { label: 'Coastal flooding', value: 'coastal_flooding' },
          { label: 'River flooding', value: 'river_flooding' },
          { label: 'Other, specify below', value: 'other' },
        ],
        order: 3,
      },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'environmental',
    taskKey: 'Flooding',
    title:
      'Has any part of the property (whether buildings or surrounding garden or land) ever been flooded?',
    description:
      'If Yes, please state when the flooding occurred and identify the parts that flooded:',
    type: 'RADIO',
    helpText: '',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 2,
  },

  {
    sectionKey: 'environmental',
    taskKey: 'Flooding',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'have_any_part',
        title: 'Has a Flood Risk Report been prepared?',
        description: 'If Yes, please supply a copy.',
        type: 'RADIO',
        helpText: '',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'upload',
        title: 'Please scan or upload a copy of flood risk assesment.',
        placeholder: '',
        order: 2,
      },
    ],
    points: 50,
    order: 3,
  },

  // {
  //   sectionKey: 'environmental',
  //   taskKey: 'Flooding',
  //   title: 'Has a Flood Risk Report been prepared?',
  //   description: 'If Yes, please supply a copy.',
  //   type: 'RADIO',
  //   helpText:
  //     'This includes planning permission notices or development proposals.',
  //   options: [
  //     { label: 'Yes', value: 'yes' },
  //     { label: 'No', value: 'no' },
  //   ],
  //   points: 25,
  //   order: 3,
  // },

  {
    sectionKey: 'environmental',
    taskKey: 'radon',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'have_any_part',
        title: 'Has a Radon test been carried out on the property?',
        description: 'If Yes, please supply a copy.',
        type: 'RADIO',
        helpText:
          'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'upload',
        title: 'Please scan or upload a copy of Radon Test',
        placeholder: '',
        order: 2,
      },
    ],
    points: 75,
    order: 1,
  },
  // {
  //   sectionKey: 'environmental',
  //   taskKey: 'radon',
  //   title: 'Has a Radon test been carried out on the property?',
  //   description: 'If Yes, please supply a copy.',
  //   type: 'RADIO',
  //   helpText:
  //     'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
  //   options: [
  //     { label: 'Yes', value: 'yes' },
  //     { label: 'No', value: 'no' },
  //   ],
  //   points: 75,
  //   order: 1,
  // },

  {
    sectionKey: 'environmental',
    taskKey: 'radon',
    title: 'Was the test result below the recommended action level?',
    description: 'Please answer Yes or No.',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 2,
  },

  {
    sectionKey: 'environmental',
    taskKey: 'radon',
    title:
      'Were any remedial measures undertaken on construction to reduce Radon gas levels in the property?',
    description: 'Please answer Yes or No.',
    type: 'RADIO',
    helpText:
      'Boundary responsibility determines who pays for maintenance, repairs, or replacement of fences, walls, hedges, or other boundary features. Look for T marks on your property title plan or check your deeds for each side. Still not sure how to answer this question, please watch a short 40 seconds video explaining on how to answer...',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 3,
  },
  {
    sectionKey: 'environmental',
    taskKey: 'energy_efficiency',
    title: 'Please supply a copy of the EPC for the property.',
    description: 'Others',
    type: 'UPLOAD',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'environmental',
    taskKey: 'energy_efficiency',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'have_any_part',
        title:
          'Have any installations in the property been financed under the Green Deal scheme?',
        description:
          'Please answer Yes or No and give details of all installations and supply a copy of your latest electricity bill.',
        type: 'RADIO',
        helpText:
          'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above',
        placeholder: '',
        display: 'both',
        order: 2,
      },
    ],
    points: 75,
    order: 2,
  },

  // {
  //   sectionKey: 'environmental',
  //   taskKey: 'energy_efficiency',
  //   title:
  //     'Have any installations in the property been financed under the Green Deal scheme?',
  //   description:
  //     'Please answer Yes or No and give details of all installations and supply a copy of your latest electricity bill.',
  //   type: 'RADIO',
  //   helpText:
  //     'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
  //   options: [
  //     { label: 'Yes', value: 'yes' },
  //     { label: 'No', value: 'no' },
  //   ],
  //   points: 75,
  //   order: 1,
  // },

  {
    sectionKey: 'environmental',
    taskKey: 'japanese_knotweed',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'have_any_part',
        title: 'Is the property affected by Japanese knotweed?',
        description:
          'Please answer Yes or No and state whether there is a Japanese knotweed management and treatment plan in place and supply a copy with any insurance cover linked to the plan.',
        type: 'RADIO',
        helpText:
          'Boundary responsibility determines who pays for maintenance, repairs, or replacement of fences, walls, hedges, or other boundary features. Look for "T" marks on your property title plan or check your deeds for each side.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above',
        placeholder:
          'E.g., Kitchen appliance warranty, garden landscaping guarantee, pest control treatment...',
        display: 'both',
        order: 2,
      },
    ],
    points: 75,
    order: 1,
  },

  // {
  //   sectionKey: 'environmental',
  //   taskKey: 'japanese_knotweed',
  //   title: 'Is the property affected by Japanese knotweed?',
  //   description:
  //     'Please answer Yes or No and state whether there is a Japanese knotweed management and treatment plan in place and supply a copy with any insurance cover linked to the plan.',
  //   type: 'RADIO',
  //   helpText:
  //     'Boundary responsibility determines who pays for maintenance, repairs, or replacement of fences, walls, hedges, or other boundary features. Look for T marks on your property title plan or check your deeds for each side.',
  //   options: [
  //     { label: 'Yes', value: 'yes' },
  //     { label: 'No', value: 'no' },
  //   ],
  //   points: 75,
  //   order: 1,
  // },

  // ────────────────────────────────────────────
  // RIGHTS AND INFORMAL ARRANGEMENTS
  // ────────────────────────────────────────────
  {
    sectionKey: 'rightsAndInformalArrangements',
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
    points: 75,
    order: 1,
  },

  {
    sectionKey: 'rightsAndInformalArrangements',
    taskKey: 'resposibility_towards_jointly',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'provide_details',
        title:
          'Does ownership of the property carry a responsibility to contribute towards the cost of any jointly used services, such as maintenance of a private road, a shared driveway, a boundary or drain?',
        description: 'Please answer Yes or No and provide details.',
        type: 'RADIO',
        helpText:
          'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above',
        placeholder:
          'E.g., Kitchen appliance warranty, garden landscaping guarantee, pest control treatment...',
        order: 2,
      },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'rightsAndInformalArrangements',
    taskKey: '2_dunno_how_id_surmise_this',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'neighboring_property',
        title:
          'Does the property benefit from any rights or arrangements over any neighboring property this includes any rights of way?',
        description: '',
        type: 'RADIO',
        helpText: 'what other rights would this include?',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above',
        placeholder:
          'E.g., Kitchen appliance warranty, garden landscaping guarantee, pest control treatment...',
        order: 2,
      },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'rightsAndInformalArrangements',
    taskKey: 'prevented_access',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'neighboring_property',
        title:
          'Has anyone taken steps to prevent access to the property or to complain about or demand payment for access to the property?',
        description: 'Please answer Yes or No and provide details.',
        type: 'RADIO',
        helpText: 'WHAT types of steps could be taken - consider this here...',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above',
        placeholder:
          'E.g., Kitchen appliance warranty, garden landscaping guarantee, pest control treatment...',
        order: 2,
      },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'rightsAndInformalArrangements',
    taskKey: 'right_of_light',
    title:
      'Does the seller know if any of the following rights benefit the property:',
    description: 'Rights of light',
    type: 'MULTIPART' as QuestionType,
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'rightsAndInformalArrangements',
    taskKey: 'rights_of_support',
    title:
      'Does the seller know if any of the following rights benefit the property:',
    description: 'Rights of support from adjoining properties',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'rightsAndInformalArrangements',
    taskKey: 'arrangements',
    title:
      'Does the seller know if any of the following rights benefit the property:',
    description:
      'Customary rights (e.g. rights deriving from local traditions)',
    type: 'RADIO',
    helpText:
      'What is this? Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'rightsAndInformalArrangements',
    taskKey: 'other_rights_and_arrangements',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'arrangements_affecty',
        title:
          'Does the seller know if any of the following arrangements affect the property:',
        description:
          'Other peoples rights to mines and minerals under the land.',
        type: 'RADIO',
        helpText:
          'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above',
        placeholder:
          'E.g., Kitchen appliance warranty, garden landscaping guarantee, pest control treatment...',
        order: 2,
      },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'rightsAndInformalArrangements',
    taskKey: 'chancel_repair_liability',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'seller_know',
        title:
          'Does the seller know if any of the following arrangements affect the property:',
        description: 'Chancel repair liability',
        type: 'RADIO',
        helpText:
          'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above',
        placeholder:
          'E.g., Kitchen appliance warranty, garden landscaping guarantee, pest control treatment...',
        order: 2,
      },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'rightsAndInformalArrangements',
    taskKey: 'chancel_repair_liability',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'following_arrangements',
        title:
          'Does the seller know if any of the following arrangements affect the property:',
        description:
          'Other peoples rights to take things from the land such as timber hay or fish',
        type: 'RADIO',
        helpText:
          'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above',
        placeholder:
          'E.g., Kitchen appliance warranty, garden landscaping guarantee, pest control treatment...',
        order: 2,
      },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'rightsAndInformalArrangements',
    taskKey: 'chancel_repair_liability',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'arrangementst_affecting',
        title:
          'Are there any other rights or arrangements affecting the property? This includes any rights of way.',
        description: 'Please answer Yes or No and provide details.',
        type: 'RADIO',
        helpText:
          'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above',
        placeholder:
          'E.g., Kitchen appliance warranty, garden landscaping guarantee, pest control treatment...',
        order: 2,
      },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'rightsAndInformalArrangements',
    taskKey: 'service_crossing_the_property_or_neighboring_property',
    title:
      'Do any drains, pipes or wires leading to any neighbors property cross the property?',
    description: 'Please answer Yes or No',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'rightsAndInformalArrangements',
    taskKey: 'service_crossing_the_property_or_neighboring_property',
    title: '',
    description: 'Please answer Yes or No and provide details.',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'arrangement_ drains',
        title:
          'Is there any agreement or arrangement about drains, pipes or wires?',
        description: 'Please answer Yes or No and provide details.',
        type: 'RADIO',
        helpText:
          'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above',
        placeholder:
          'E.g., Kitchen appliance warranty, garden landscaping guarantee, pest control treatment...',
        order: 2,
      },
    ],
    points: 50,
    order: 1,
  },

  // ────────────────────────────────────────────
  // PARKING
  // ────────────────────────────────────────────
  {
    sectionKey: 'parking',
    taskKey: 'parking_arrangements',
    title: 'What are the parking arrangements at the property?',
    description:
      'For example: garage, carport, driveway, shared driveway, allocated car parking space, on street parking etc.',
    type: 'TEXT',
    helpText: 'Start typing your answer here...',
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'parking',
    taskKey: 'controlled_parking_zone_or_local_authority_schemes',
    title:
      'Is the property in a controlled parking zone or within a local authority parking scheme?',
    description: '',
    type: 'RADIO',
    helpText: '',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 1,
  },

  // ────────────────────────────────────────────
  // OTHER CHARGES
  // ────────────────────────────────────────────
  {
    sectionKey: 'otherCharges',
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
    points: 75,
    order: 1,
  },
  {
    sectionKey: 'otherCharges',
    taskKey: 'charges_relating_to_the_property',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'council_tax',
        title:
          'Does the seller have to pay any charges relating to the property (excluding any payments such as council tax, utility charges, etc.), for example payments to a management company?',
        description:
          'Please answer Yes or No and provide written instructions.',
        type: 'RADIO',
        helpText:
          'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'text',
        title: 'Please provide written instruction for your answer above',
        placeholder:
          'E.g., Kitchen appliance warranty, garden landscaping guarantee, pest control treatment...',
        order: 2,
      },
    ],
    points: 75,
    order: 1,
  },

  // ────────────────────────────────────────────
  // OCCUPIERS
  // ────────────────────────────────────────────
  {
    sectionKey: 'occupiers',
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
    points: 25,
    order: 1,
  },

  {
    sectionKey: 'occupiers',
    taskKey: 'the_seller',
    title: 'Does the seller live at the property?',
    description:
      'Please answer Yes or No and provide full names of any occupiers (other than the sellers) aged 17 or over:',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'occupiers',
    taskKey: 'other_occupiersr',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'full_names_of_sellers',
        type: 'multitextinput',
        title: 'Does anyone else, aged 17 or over, live at the property?',
        description:
          'Please answer Yes or No and provide full names of any occupiers (other than the sellers) aged 17 or over:',
        helpText:
          'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
        placeholder: 'Enter Name',
        buttonText: 'Add More Sellers',
        order: 1,
      },
      {
        partKey: 'are_you_the_owner_of_the_property',
        type: 'radio',
        title: 'Are you the owner of the property?',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 2,
      },
      {
        partKey: 'are_completing_this_form_on_the_behalf_of_the_seller',
        type: 'radio',
        title: 'Are completing this form on the behalf of the seller? ',
        options: [
          { label: 'Will / Grant of Probate', value: 'will_grant_of_probate' },
          { label: 'Trustee', value: 'trustee' },
          { label: 'Representative', value: 'representative' },
          { label: 'Power of Attorney', value: 'power_of_attorney' },
          { label: 'Limited Company ', value: 'limited_company' },
        ],
        order: 3,
      },
      {
        partKey: 'company_details',
        type: 'multifieldform',
        title: '',
        repeatable: false,
        fields: [
          {
            key: 'filler_name',
            label: 'N',
            placeholder: 'Enter Name',
          },
        ],
        order: 4,
      },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'occupiers',
    taskKey: 'lodgers_and_tenants',
    title:
      'Are any of the occupiers (other than the sellers), aged 17 or over, tenants or lodgers?',
    description: 'Please answer Yes or No.',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 1,
  },

  {
    sectionKey: 'occupiers',
    taskKey: 'vacant_possession',
    title: 'Is the property being sold with vacant possession?',
    description: 'If Yes, have all the occupiers aged 17 or over:',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 1,
  },

  {
    sectionKey: 'occupiers',
    taskKey: 'vacant_possession',
    title: 'Is the property being sold with vacant possession?',
    description: 'Agreed to leave prior to completion?',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 1,
  },

  {
    sectionKey: 'occupiers',
    taskKey: 'vacant_possession',
    title: '',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'roof_air',
        title: 'Is the property being sold with vacant possession?',
        description:
          'Agreed to sign the sale contract? Please answer Yes or No. If No, please supply other evidence that the property will be vacant on completion.',
        type: 'RADIO',
        helpText:
          'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories. ',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 1,
      },
      {
        partKey: 'photos',
        type: 'upload',
        title: 'Please supply copies of the relevant documents: ',
        placeholder: '',
        order: 2,
      },
    ],
    points: 75,
    order: 1,
  },

  // ────────────────────────────────────────────
  // SERVICES
  // ────────────────────────────────────────────
  {
    sectionKey: 'services',
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
    points: 75,
    order: 1,
  },
  {
    sectionKey: 'services',
    taskKey: 'electricity',
    title:
      'Has the whole or any part of the electrical installation been tested by a qualified and registered electrician?',
    description:
      'Please answer Yes or No and provide a copy of the test certificate.',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },

  {
    sectionKey: 'services',
    taskKey: 'electricity',
    title:
      'Has the property been rewired or had any electrical installation work carried out since 1 January 2005?',
    description: 'Please answer Yes or No and provide supporting document.',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 2,
  },
  {
    sectionKey: 'services',
    taskKey: 'electricity',
    title: 'Does the property have a central heating system?',
    description: 'Please answer Yes or No.',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 3,
  },
  {
    sectionKey: 'services',
    taskKey: 'electricity',
    title:
      'What type of system is it (e.g. mains gas, liquid gas, oil, electricity, etc.)?',
    description: 'Please select one or more options.',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 4,
  },
  {
    sectionKey: 'services',
    taskKey: 'central_heating',
    title: 'When was the heating system installed?',
    description:
      "If on or after 1 April 2005 please supply a copy of the 'completion certificate' (e.g. CORGI or Gas Safe Register) or the 'exceptional circumstances' form.",
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 1,
  },
  {
    sectionKey: 'services',
    taskKey: 'central_heating',
    title: 'Is the heating system in good working order?',
    description: 'Please answer Yes or No',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 2,
  },
  {
    sectionKey: 'services',
    taskKey: 'central_heating',
    title: 'In what year was the heating system last serviced/maintained?',
    description:
      'Please provide year info and supply a copy of the inspection report..',
    type: 'DATE',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      {
        label: 'Select year of service',
        value: 'yes',
        hasDate: true,
        dateFormat: 'year',
        datePlaceholder: 'Select year',
      },
      { label: 'No', value: 'no', hasDate: false },
    ],
    points: 75,
    order: 3,
  },
  {
    sectionKey: 'services',
    taskKey: 'drainage_and_sewerage',
    title: 'Is the property connected to mains:',
    description: 'A foul water drainage?',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 1,
  },
  {
    sectionKey: 'services',
    taskKey: 'drainage_and_sewerage',
    title: 'Is the property connected to mains:',
    description: 'A surface water drainage?',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 2,
  },
  {
    sectionKey: 'services',
    taskKey: 'drainage_and_sewerage',
    title: 'Is sewerage for the property provided by:',
    description: 'A septic tank?',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 3,
  },
  {
    sectionKey: 'services',
    taskKey: 'drainage_and_sewerage',
    title: 'Is the property connected to mains:',
    description: 'A sewage treatment plant?',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 4,
  },
  {
    sectionKey: 'services',
    taskKey: 'drainage_and_sewerage',
    title: 'Is the property connected to mains:',
    description: 'A cesspool?',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 5,
  },
  {
    sectionKey: 'services',
    taskKey: 'drainage_and_sewerage',
    title:
      'Is the use of the septic tank, sewage treatment plant or cesspool shared with other properties?',
    description:
      'Please answer Yes or No and if yes, specify how many properties share the system?',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 6,
  },
  {
    sectionKey: 'services',
    taskKey: 'drainage_and_sewerage',
    title: 'When was the system last emptied?',
    description: 'Please provide year information.',
    type: 'DATE',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      {
        label: 'Select month of service',
        value: 'yes',
        hasDate: true,
        dateFormat: 'monthYear',
        datePlaceholder: 'Select Month and Year',
      },
      { label: 'No', value: 'no', hasDate: false },
    ],
    points: 25,
    order: 7,
  },
  {
    sectionKey: 'services',
    taskKey: 'drainage_and_sewerage',
    title:
      'If the property is served by a sewage treatment plant, when was the treatment plant last serviced?',
    description: 'Please provide year information.',
    type: 'DATE',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      {
        label: 'Select month of service',
        value: 'yes',
        hasDate: true,
        dateFormat: 'monthYear',
        datePlaceholder: 'Select Month and Year',
      },
      { label: 'No', value: 'no', hasDate: false },
    ],
    points: 25,
    order: 8,
  },
  {
    sectionKey: 'services',
    taskKey: 'drainage_and_sewerage',
    title: 'When was the system installed?',
    description: 'Please provide year information.',
    type: 'DATE',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      {
        label: 'Select month of service',
        value: 'yes',
        hasDate: true,
        dateFormat: 'monthYear',
        datePlaceholder: 'Select Month and Year',
      },
      { label: 'No', value: 'no', hasDate: false },
    ],
    points: 25,
    order: 9,
  },
  {
    sectionKey: 'services',
    taskKey: 'drainage_and_sewerage',
    title:
      'Is any part of the septic tank, sewage treatment plant (including any soakaway or outfall) or cesspool, or the access to it, outside the boundary of the property?',
    description:
      'Please answer Yes and No and supply a plan showing the location of the system and how access is obtained.',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 75,
    order: 10,
  },
  {
    sectionKey: 'services',
    taskKey: 'connection_to_services_and_utilities',
    title:
      'Mains electricity - is this service/utility connected to the property?',
    description:
      'Please answer Yes or No and provide details of any providers.',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },
  {
    sectionKey: 'services',
    taskKey: 'connection_to_services_and_utilities',
    title: 'Mains gas - is this service/utility connected to the property?',
    description:
      'Please answer Yes or No and provide details of any providers.',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 2,
  },
  {
    sectionKey: 'services',
    taskKey: 'connection_to_services_and_utilities',
    title: 'Mains water - is this service/utility connected to the property?',
    description:
      'Please answer Yes or No and provide details of any providers.',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 3,
  },
  {
    sectionKey: 'services',
    taskKey: 'connection_to_services_and_utilities',
    title: 'Mains sewage - is this service/utility connected to the property?',
    description:
      'Please answer Yes or No and provide details of any providers.',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 4,
  },
  {
    sectionKey: 'services',
    taskKey: 'connection_to_services_and_utilities',
    title: 'Telephone - is this service/utility connected to the property?',
    description:
      'Please answer Yes or No and provide details of any providers.',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [{ label: 'No', value: 'no' }],
    points: 50,
    order: 5,
  },
  {
    sectionKey: 'services',
    taskKey: 'connection_to_services_and_utilities',
    title: 'Cable - is this service/utility connected to the property?',
    description:
      'Please answer Yes or No and provide details of any providers.',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 6,
  },

  // ────────────────────────────────────────────
  // TRANSACTION INFORMATION
  // ────────────────────────────────────────────
  {
    sectionKey: 'transactionInformation',
    taskKey: 'transaction_information_questions',
    title:
      'Is this sale dependent on the seller completing the purchase of another property on the same day?',
    description: 'Please answer Yes or No.',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 1,
  },

  {
    sectionKey: 'transactionInformation',
    taskKey: 'special_requirements',
    title: 'Does the seller have any special requirements about a moving date?',
    description: 'Please answer Yes or No and provide information.',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'transactionInformation',
    taskKey: 'payment_of_mortgages_and_charges_after_the_sales_of_the_property',
    title:
      'Will the sale price be sufficient to repay all mortgages and charges secured on the property?',
    description: 'Please select one of the options.',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 1,
  },

  {
    sectionKey: 'transactionInformation',
    taskKey: 'seller_obligations',
    title: 'Will the seller ensure that:',
    description:
      'All rubbish is removed from the property (including from the loft, garden, outbuildings, garages and sheds) and that the property will be left in a clean and tidy condition?',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 1,
  },

  {
    sectionKey: 'transactionInformation',
    taskKey: 'seller_obligations',
    title: 'Will the seller ensure that:',
    description:
      'If light fittings are removed, the fittings will be replaced with ceiling rose, flex, bulb holder and bulb?',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 1,
  },

  {
    sectionKey: 'transactionInformation',
    taskKey: 'seller_obligations',
    title: 'Will the seller ensure that:',
    description:
      'Reasonable care will be taken when removing any other fittings or contents?',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 1,
  },

  {
    sectionKey: 'transactionInformation',
    taskKey: 'seller_obligations',
    title: 'Will the seller ensure that:',
    description:
      'Keys to all windows and doors and details of alarm codes will be left at the property or with the estate agent?',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 25,
    order: 1,
  },

  // ────────────────────────────────────────────
  // FIXTURES AND FITTINGS
  // ────────────────────────────────────────────

  {
    sectionKey: 'fixturesAndFittings',
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
    points: 75,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'basic_fittings',
    title: 'Boiler/Immersion Heater',
    description:
      'Specify heating equipment and hot water systems included in the sale.',
    type: 'RADIO',
    helpText:
      'This covers your central heating boiler, immersion heater, or other hot water heating systems. Buyers need to know what heating equipment stays with the property and its current condition, as this affects both comfort and ongoing maintenance costs',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'basic_fittings',
    title: 'Radiators/Wall Heaters',
    description:
      'Central heating radiators and wall-mounted heating units included in the sale',
    type: 'RADIO',
    helpText:
      'This covers all fixed heating units attached to walls throughout the property  Buyers need to know which radiators and heaters remain  as removing them could affect the heating system s efficiency and leave wall damage',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'basic_fittings',
    title: 'Night-Storage Heaters',
    description:
      'Electric storage heaters that charge overnight and release heat during the day',
    type: 'RADIO',
    helpText:
      'Night storage heaters are electric units that store heat using cheaper overnight electricity They re often the primary heating source in properties without gas central heating, so their inclusion significantly affects heating costs.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'basic_fittings',
    title: 'Free-Standing Heaters',
    description:
      'Portable and moveable heating units not permanently fixed to the property',
    type: 'RADIO',
    helpText:
      'These are standalone heaters that can be moved around, such as electric heaters, gas heaters, or oil-filled radiators. While not fixed to the property, they may add value for buyers, especially in rooms without other heating.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'basic_fittings',
    title: 'GasFires (with surround)',
    description:
      'Gas fireplaces including decorative surrounds and fire installations',
    type: 'RADIO',
    helpText:
      'Gas fires with surrounds are valuable features that provide both heating and aesthetic appeal. The surround (mantelpiece and decorative frame) is often a significant design element that buyers factor into their decision.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'basic_fittings',
    title: 'Electric Fires (with surround)',
    description:
      'Electric fireplaces including decorative surrounds and installations',
    type: 'RADIO',
    helpText:
      'Electric fires offer the ambiance of a fireplace without gas connections. The decorative surround adds character to the room, and these units are often easier to maintain than gas alternatives.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'basic_fittings',
    title: 'Light Switches',
    description:
      'Wall-mounted switches and controls for lighting throughout the property',
    type: 'RADIO',
    helpText:
      '􀛭 What is this This includes all light switches dimmer switches  and special controls like timer switches or smart switches. Modern or high quality switches can add value, while outdated ones may need replacement.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'basic_fittings',
    title: 'Light Switches',
    description:
      'Wall-mounted switches and controls for lighting throughout the property',
    type: 'RADIO',
    helpText:
      '􀛭 What is this This includes all light switches dimmer switches  and special controls like timer switches or smart switches. Modern or high quality switches can add value, while outdated ones may need replacement.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'basic_fittings',
    title: 'Roof Insulation',
    description: 'Thermal insulation installed in the roof space or attic area',
    type: 'RADIO',
    helpText:
      'Roof insulation is crucial for energy efficiency and heating costs. Good insulation can significantly reduce energy bills and is often checked during surveys. Buyers need to know the type and condition of existing insulation.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'basic_fittings',
    title: 'Window Fittings',
    description: 'Hardware, locks, handles, and mechanisms attached to windows',
    type: 'RADIO',
    helpText:
      'This covers window handles, locks, catches, and opening mechanisms. Proper window fittings are essential for security, ventilation, and window operation. Missing or broken fittings can be costly to replace.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'basic_fittings',
    title: 'Window Shutters/Grilles',
    description:
      'External or internal shutters and security grilles fitted to windows',
    type: 'RADIO',
    helpText:
      'Window shutters provide security, privacy, and sometimes weather protection. Security grilles offer protection against break-ins. These features can be valuable selling points, especially in urban areas.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'basic_fittings',
    title: 'Internal Door Fittings',
    description:
      'Handles, locks, hinges, and hardware for doors inside the property',
    type: 'RADIO',
    helpText:
      'This includes all door handles locks hinges and closing mechanisms for internal doors. Quality door furniture can enhance the propertys appearance while missing or broken fittings may need immediate replacement.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'basic_fittings',
    title: 'External Door Fittings',
    description:
      'Hardware, locks, handles, and security features for external doors',
    type: 'RADIO',
    helpText:
      'External door fittings include handles, locks, security bolts, letterboxes, and door knockers. These are crucial for security and first impressions. High-quality external fittings enhance both security and property value.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'basic_fittings',
    title: 'Doorbell/Chime',
    description:
      'Door entry systems, doorbells, and chime units throughout the property',
    type: 'RADIO',
    helpText:
      'This covers doorbells, entry chimes, and any intercom systems. Modern video doorbells or smart entry systems can be valuable features that buyers appreciate for convenience and security.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'basic_fittings',
    title: 'Electric Sockets',
    description:
      'Power outlets and electrical socket installations throughout the property',
    type: 'RADIO',
    helpText:
      'Electric sockets are fixed installations that stay with the property. This refers to any special or additional sockets that might have been added, such as USB sockets, outdoor sockets, or high-quality decorative socket plates.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'basic_fittings',
    title: 'Burglar Alarm',
    description:
      'Security alarm system including control panels and monitoring equipment',
    type: 'RADIO',
    helpText:
      'Burglar alarms can include control panels, sensors, sirens, and monitoring services. A working alarm system is a valuable security feature, but buyers need to know about ongoing monitoring costs and system requirements.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'basic_fitings',
    title: 'Other Basic Fittings',
    description:
      'Additional fixtures, electrical items, or installations not listed in previous sections',
    type: 'RADIO',
    helpText:
      'This covers any other fixed installations like smart home systems, CCTV equipment, intercom systems, additional electrical fittings, or specialized fixtures unique to your property that buyers should know about.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'kitchen',
    title: 'Hob',
    description:
      'Cooktop surface for cooking including gas, electric, or induction hobs',
    type: 'RADIO',
    helpText:
      'The hob is often built into the kitchen worktop and may be gas electric, ceramic, or induction. Built in hobs are usually included in fitted kitchens, but standalone units might be excluded if they re high value items.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'kitchen',
    title: 'Extractor Hood',
    description:
      'Ventilation system above the hob for removing cooking odors and steam',
    type: 'RADIO',
    helpText:
      'Extractorhoods are essential for kitchen ventilation and are usually fitted units connected to external venting. They range from basic models to high-end designer units that can significantly affect kitchen value.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'kitchen',
    title: 'Oven/Grill',
    description:
      'Built-in or freestanding cooking appliances including ovens and grills',
    type: 'RADIO',
    helpText:
      'This covers all oven units  whether built in undercounter  or freestanding. Modern fitted ovens are typically included but high end or professional grade ovens might be excluded if they re particularly valuable',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'kitchen',
    title: 'Cooker',
    description:
      'Combined cooking appliance including hob, oven, and grill in one unit',
    type: 'RADIO',
    helpText:
      'A cooker combines multiple cooking functions in one appliance. Range cookers and professional-style units can be significant investments that sellers might want to take with them or sell separately.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'kitchen',
    title: 'Microwave',
    description:
      'Microwave oven whether built-in, under-counter, or countertop models',
    type: 'RADIO',
    helpText:
      'Built-in microwaves are usually included as part of fitted kitchens, while countertop models are often considered moveable. High-end built-in units might be valuable enough to exclude from the sale.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },
  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'kitchen',
    title: 'Refrigerator/Fridge-Freezer',
    description:
      'Refrigeration appliances including fridges, freezers, and combination units',
    type: 'RADIO',
    helpText:
      'Large appliances like American-style fridge-freezers or built-in units are often included, while smaller or high-end appliances might be excluded. Built-in units that match kitchen units are typically included.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'kitchen',
    title: 'Freezer',
    description: 'Standalone or built-in freezer units for food storage',
    type: 'RADIO',
    helpText:
      'Separate freezers, whether upright or chest freezers, are often considered valuable appliances. Built-in freezers integrated into kitchen design are usually included, while standalone units might be negotiable.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'kitchen',
    title: 'Dishwasher',
    description: 'Built-in or freestanding dishwashing appliances',
    type: 'RADIO',
    helpText:
      'Dishwashers are highly valued by buyers. Built in models integrated into kitchen units are typically included while freestanding models might be excluded if theyr e new or high end',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'kitchen',
    title: 'Tumble Dryer',
    description:
      'Clothes drying appliances whether built-in, stacked, or freestanding',
    type: 'RADIO',
    helpText:
      'Tumble dryers can be valuable appliances especially built in or stacked units in fitted utility areas. Buyers often expect these to be included if they re integrated into the kitchen or utility room design.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'kitchen',
    title: 'Washing Machine',
    description:
      'Clothes washing appliances including built-in and freestanding models',
    type: 'RADIO',
    helpText:
      'Tumble dryers can be valuable appliances especially built in or stacked units in fitted utility areas. Buyers often expect these to be included if they re integrated into the kitchen or utility room design.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'kitchen',
    title: 'Other Kitchen Items',
    description:
      'Additional kitchen appliances, fixtures, or equipment not listed in previous sections',
    type: 'RADIO',
    helpText:
      'Include any specialty kitchen equipment like wine coolers ice makers coffee machines kitchen islands breakfast bar stools or custom installations that aren t covered in the standard kitchen appliances list',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'bathroom',
    title: 'Bath',
    description:
      'Bathtub installations including standard, corner, or luxury bath units',
    type: 'RADIO',
    helpText:
      'Baths are fixed bathroom installations that stay with the property. This includes standard baths, corner baths, jacuzzi baths, or luxury installations. Only in very rare cases would a bath be excluded from a sale.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'bathroom',
    title: 'Shower Fitting for Bath',
    description:
      'Bathtub installations including standard, corner, or luxury bath units',
    type: 'RADIO',
    helpText:
      '􀛭 what is this this covers shower attachments that fit over the bath including handheld showers overhead showers and shower screens. these fittings are usually part of the bathroom suite and expected to remain.in',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'bathroom',
    title: 'Shower Curtain',
    description: 'Fabric or plastic curtains used to contain shower water',
    type: 'RADIO',
    helpText:
      'Shower curtains are inexpensive items that are often included for convenience. However, expensive or designer curtains might be excluded, with basic replacements provided.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'bathroom',
    title: 'Shower Curtain',
    description: 'Storage cabinets and vanity units installed in the bathroom',
    type: 'RADIO',
    helpText:
      'Bathroom cabinets include vanity units, mirror cabinets, and storage units. Built-in or fitted cabinets are typically included, while high-end or antique pieces might be excluded.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'bathroom',
    title: 'Taps',
    description:
      'Water taps and faucets for sinks, baths, and shower installations',
    type: 'RADIO',
    helpText:
      'Taps are essential fixtures that are almost always included. However, designer or antique taps might be excluded if they have significant value, with standard replacements provided.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'bathroom',
    title: 'Separate Shower and Fittings',
    description:
      'Standalone shower cubicles, enclosures, and shower room installations',
    type: 'RADIO',
    helpText:
      'This covers separate shower enclosures, cubicles, and wet rooms. These are major bathroom installations that are always included, as removing them would damage the bathroom.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'bathroom',
    title: 'Towel Rail',
    description:
      'Towel hanging fixtures including heated and standard towel rails',
    type: 'RADIO',
    helpText:
      'Towel rails are bathroom fixtures that are typically included. Heated towel rails are particularly valued by buyers as they provide both towel drying and additional bathroom heating.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'bathroom',
    title: 'Soap/Toothbrush Holders',
    description:
      'Bathroom accessories for holding toiletries and personal items',
    type: 'RADIO',
    helpText:
      'These are small bathroom accessories that are usually included for convenience. While individually low-value a complete set of matching accessories can enhance the bathroom appearance.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'bathroom',
    title: 'Toilet Roll Holders',
    description: 'Wall-mounted fixtures for holding toilet paper rolls',
    type: 'RADIO',
    helpText:
      'Toilet roll holders are basic bathroom fixtures that are typically included. Theyre usually built into the bathroom design and would leave holes in walls or tiles if removed.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'bathroom',
    title: 'Bathroom Mirror',
    description:
      'Mirrors installed in bathrooms including illuminated and cabinet mirrors',
    type: 'RADIO',
    helpText:
      'Bathroom mirrors are usually included, especially if they are built-in or match the bathroom suite. Large or designer mirrors might be excluded if they have significant value.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'carpets',
    title: 'Hall, Stairs and Landing',
    description:
      'Floor coverings in entrance areas, stairways, and upstairs landings',
    type: 'RADIO',
    helpText:
      'Stair carpets and hallway flooring are often high-wear areas that buyers pay attention to. Good quality carpets in these areas add value, while worn carpets may need immediate replacement.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'carpets',
    title: 'Living Room',
    description:
      'Floor coverings and carpets in the main living and reception areas',
    type: 'RADIO',
    helpText:
      'Living room carpets are major features that affect the room  appearance and comfort. High-quality or fitted carpets are typically included while expensive rugs might be excluded.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'carpets',
    title: 'Dining Room',
    description: 'Floor coverings in formal and informal dining areas',
    type: 'RADIO',
    helpText:
      'Dining room carpets or flooring set the tone for the space. Fitted carpets are usually included, while valuable rugs or specialized flooring might be excluded from the sale.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'carpets',
    title: 'Kitchen',
    description:
      'Floor coverings in kitchen areas including mats and specialized flooring',
    type: 'RADIO',
    helpText:
      'Kitchen flooring is usually tile, vinyl, or wood, but this covers any carpet areas or specialized mats. Non-slip mats and entrance mats are often included for practical reasons.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'carpets',
    title: 'Bedroom 1',
    description: 'Floor coverings and carpets in bedroom 1',
    type: 'RADIO',
    helpText:
      'Bedroom carpets provide comfort and warmth Fitted carpets are typically included as theyre cut to room size. High-quality or new carpets might be highlighted as selling features',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'carpets',
    title: 'Bedroom 2',
    description: 'Floor coverings and carpets in bedroom 2',
    type: 'RADIO',
    helpText:
      'Bedroom carpets provide comfort and warmth. Fitted carpets are typically included as they are cut to room size. High-quality or new carpets might be highlighted as selling features.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'carpets',
    title: 'Bedroom 3',
    description: 'Floor coverings and carpets in bedroom 3',
    type: 'RADIO',
    helpText:
      'Bedroom carpets provide comfort and warmth. Fitted carpets are typically included as they are cut to room size. High-quality or new carpets might be highlighted as selling features.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'carpets',
    title: 'Other Floor Coverings',
    description:
      'Additional carpets, rugs, or flooring in areas not listed in previous sections',
    type: 'RADIO',
    helpText:
      'Include floor coverings in areas like conservatories, utility rooms, walk-in wardrobes, loft spaces, or any valuable rugs and specialty flooring not covered in the main room categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'curtains_and_curtain_rails',
    title: 'Hall, Stairs and Landing',
    description:
      'Hardware systems for hanging window treatments in entrance and stairway areas',
    type: 'RADIO',
    helpText:
      'Curtain poles and rails in hallways and staircases are usually fixed installations that remain with the property. These areas often have awkward window shapes that require custom-fitted hardware.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'curtains_and_curtain_rails',
    title: 'Living Room',
    description:
      'Hardwaresystems for hanging curtains and window treatments in the main living area',
    type: 'RADIO',
    helpText:
      'Living room curtain hardware can range from basic tracks to designer poles. Expensive or decorative poles might be excluded, while standard hardware typically remains as its fitted to the walls.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'curtains_and_curtain_rails',
    title: 'Dining Room',
    description:
      'Hardware systems for hanging window treatments in the dining area',
    type: 'RADIO',
    helpText:
      'Dining room curtain rails and poles are usually included as theyre fixed to walls. Formal dining rooms may have more expensive decorative hardware that sellers might choose to exclude.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'curtains_and_curtain_rails',
    title: 'Kitchen',
    description:
      'Hardware systems for hanging window treatments in the kitchen area',
    type: 'RADIO',
    helpText:
      'Kitchen curtain hardware is typically basic and included with the property. This covers rails for cafe curtains, blinds tracks, or any window treatment hardware above kitchen windows.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'curtains_and_curtain_rails',
    title: 'Bedroom 1',
    description:
      'Hardware systems for hanging window treatments in the main bedroom',
    type: 'RADIO',
    helpText:
      'Bedroom curtain rails and poles are usually included as they re fitted installations. Master bedrooms may have more elaborate hardware systems that could be considered for exclusion if particularly valuable.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'curtains_and_curtain_rails',
    title: 'Bedroom 2',
    description:
      'Hardware systems for hanging window treatments in the second bedroom',
    type: 'RADIO',
    helpText:
      'Curtain hardware in bedrooms is typically included with the property. This covers all rails, poles, and tracks fitted to walls for hanging curtains, blinds, or other window treatments.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'curtains_and_curtain_rails',
    title: 'Bedroom 3',
    description:
      'Hardware systems for hanging window treatments in the third bedroom',
    type: 'RADIO',
    helpText:
      'All fitted curtain rails, poles, and hardware in this bedroom are usually included. Removing them would typically leave wall damage, so they re considered part of the property fixtures.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'curtains_and_curtain_rails',
    title: 'Other Rooms',
    description:
      'Hardware systems for hanging curtains in additional rooms not listed in previous sections',
    type: 'RADIO',
    helpText:
      'Include curtain rails, poles, or pelmets in areas like conservatories, utility rooms, home offices, or any other rooms with window treatment hardware not covered in the main room categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'curtains_and_curtain_rails',
    title: 'Hall, Stairs and Landing',
    description:
      'Window treatments and coverings in entrance areas and stairways',
    type: 'RADIO',
    helpText:
      'Window treatments in hallways provide privacy and light control. Basic curtains or blinds are often included, while expensive or designer treatments might be excluded from the sale.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'curtains_and_curtain_rails',
    title: 'Living Room',
    description: 'Window treatments and coverings in the main living area',
    type: 'RADIO',
    helpText:
      'Living room curtains and blinds are often significant decorative features. Made-to-measure curtains are typically included as they are room-specific, while expensive designer treatments might be excluded.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'curtains_and_curtain_rails',
    title: 'Dining Room',
    description: 'Window treatments and coverings in the dining area',
    type: 'RADIO',
    helpText:
      'Dining room window treatments set the formal tone of the space. Custom-fitted blinds or curtains are usually included, while valuable or antique treatments might be excluded if they have significant worth.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'curtains_and_curtain_rails',
    title: 'Kitchen',
    description: 'Window treatments and coverings in the kitchen area',
    type: 'RADIO',
    helpText:
      'Kitchen window treatments are typically practical items like cafe curtains, roller blinds, or venetian blinds. These are usually included for convenience as theyre often moisture-resistant and kitchen-specific.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'curtains_and_curtain_rails',
    title: 'Bedroom 1',
    description: 'Window treatments and coverings in the main bedroom',
    type: 'RADIO',
    helpText:
      'Bedroom curtains and blinds provide privacy and light control for sleep. Blackout curtains or quality window treatments are often included as selling features, while luxury treatments might be excluded.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'curtains_and_curtain_rails',
    title: 'Bedroom 2',
    description: 'Window treatments and coverings in the second bedroom',
    type: 'RADIO',
    helpText:
      'Window treatments in bedrooms are important for privacy and light control. Basic curtains and blinds are typically included, while expensive or personalized treatments might be excluded from the sale.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'curtains_and_curtain_rails',
    title: 'Bedroom 3',
    description: 'Window treatments and coverings in the third bedroom',
    type: 'RADIO',
    helpText:
      'Bedroom window treatments provide essential privacy and light control. Standard curtains, blinds, or shutters are usually included, while designer or expensive treatments might be negotiable.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'curtains_and_curtain_rails',
    title: 'Other Rooms',
    description:
      'Window treatments and coverings in additional rooms not listed in previous sections',
    type: 'RADIO',
    helpText:
      'Include curtains, blinds, or other window treatments in areas like conservatories, utility rooms, home offices, loft conversions, or any other rooms with window coverings not covered in the main room categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'light_fittings',
    title: 'Hall, Stairs and Landing',
    description:
      'Light fixtures and electrical fittings in entrance areas and stairways',
    type: 'RADIO',
    helpText: '',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'light_fittings',
    title: 'Living Room',
    description:
      'Light fixtures and electrical fittings in the main living area',
    type: 'RADIO',
    helpText:
      'Living room lighting can include ceiling lights, wall lights, table lamps, and floor lamps. Fixed ceiling and wall lights are typically included, while expensive or antique fixtures might be excluded.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'light_fittings',
    title: 'Dining Room',
    description:
      'Light fixtures and electrical fittings in the main Dining area',
    type: 'RADIO',
    helpText:
      'Dining room lighting often includes chandeliers, pendant lights, or ceiling fixtures. While basic fixtures are included, expensive chandeliers or designer lighting might be excluded from the sale.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'light_fittings',
    title: 'Kitchen',
    description:
      'Light fixtures and electrical fittings in the main Kitchen area',
    type: 'RADIO',
    helpText:
      'Kitchen lighting includes ceiling lights, under-cabinet lighting, pendant lights, and spotlights. Most kitchen lighting is included, though expensive designer fixtures or smart lighting systems might be excluded.',
    options: [
      { label: 'Y  es', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'light_fittings',
    title: 'Bedroom 1',
    description: 'Light fixtures and electrical fittings in the main bedroom',
    type: 'RADIO',
    helpText:
      'Bedroom lighting includes ceiling lights, bedside wall lights, and any fitted lighting. Standard fixtures are typically included, while expensive or personal lighting choices might be excluded.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'light_fittings',
    title: 'Bedroom 2',
    description: 'Light fixtures and electrical fittings in the second bedroom',
    type: 'RADIO',
    helpText:
      'All fitted light fixtures in this bedroom are usually included with the property. This covers ceiling lights, wall lights, and any built-in lighting installations.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'light_fittings',
    title: 'Bedroom 3',
    description: 'Light fixtures and electrical fittings in the third bedroom',
    type: 'RADIO',
    helpText:
      'Bedroom lighting fixtures are typically included as they re wired installations. If expensive or designer fixtures are removed, basic replacement fittings should be provided.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'light_fittings',
    title: 'Other Light Fittings',
    description:
      'Additional lighting fixtures or electrical installations not listed in previous section',
    type: 'RADIO',
    helpText:
      'Include specialty lighting like chandeliers, designer fixtures, under-cabinet lighting, garden lighting systems, or smart lighting installations that werent covered in the standard room categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'fitted_units',
    title: 'Hall, Stairs and Landing',
    description:
      'Built-in storage and cupboards in entrance areas and stairways',
    type: 'RADIO',
    helpText:
      'This includes built-in coat cupboards, under-stair storage, fitted shoe storage, or any custom storage solutions in hallways and landing areas. These are typically included as they are built into the property.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'fitted_units',
    title: 'Living Room',
    description:
      'Built-in storage, shelving, and furniture in the main living area',
    type: 'RADIO',
    helpText:
      'Living room fitted units include built-in bookcases, entertainment centers, display cabinets, or window seats. These custom installations are typically included as they are designed for specific spaces.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'fitted_units',
    title: 'Dining Room',
    description: 'Built-in storage and furniture in the dining area',
    type: 'RADIO',
    helpText:
      'Dining room fitted units might include built-in sideboards, display cabinets, wine storage, or custom dining furniture. These are usually included as they are made-to-measure for the space.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'fitted_units',
    title: 'Kitchen',
    description: 'Built-in kitchen cabinets, cupboards, and storage systems',
    type: 'RADIO',
    helpText:
      'Kitchen fitted units include all built-in cabinets, cupboards, drawers, pantry units, and kitchen islands. These are integral parts of the kitchen and are always included in the sale.  ',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'fitted_units',
    title: 'Bedroom 1',
    description:
      'Built-in wardrobes, storage, and furniture in the main bedroom',
    type: 'RADIO',
    helpText:
      'Bedroom fitted units include built-in wardrobes, dressing tables, window seats, or custom storage solutions. These made-to-measure installations are typically included with the property.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'fitted_units',
    title: 'Bedroom 2',
    description:
      'Built-in wardrobes, storage, and furniture in the second bedroom',
    type: 'RADIO',
    helpText:
      'All fitted storage in this bedroom is usually included, including built-in wardrobes, cupboards, shelving, or any custom furniture thats permanently installed.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'fitted_units',
    title: 'Bedroom 3',
    description:
      'Built-in wardrobes, storage, and furniture in the third bedroom',
    type: 'RADIO',
    helpText:
      'Fitted bedroom furniture includes built-in wardrobes, storage units, or custom installations. These are typically included as they re designed specifically for the room dimensions.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'fitted_units',
    title: 'Other Fitted Storage',
    description:
      'Additionalbuilt-in storage, cupboards, or fitted furniture not listed above',
    type: 'RADIO',
    helpText:
      'This covers fitted storage in areas like utility rooms, loft spaces, under-stair cupboards, built-in desks, or any custom-built furniture and storage solutions throughout the property.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'outdoor_area',
    title: 'Garden Furniture',
    description:
      'Outdoor seating, tables, and furniture for garden and patio areas',
    type: 'RADIO',
    helpText:
      'Garden furniture can range from basic plastic sets to expensive teak or designer pieces. Built-in seating or heavy stone furniture is often included, while portable or valuable sets might be excluded.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'outdoor_area',
    title: 'Garden Ornaments',
    description:
      'Decorative items including statues, fountains, and ornamental features',
    type: 'RADIO',
    helpText:
      'Garden ornaments can be valuable decorative features. Heavy or built-in ornaments like stone statues or water features are often included, while portable or valuable pieces might be excluded.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'outdoor_area',
    title: 'Trees, Plants, Shrubs',
    description:
      'All planted landscaping including trees, bushes, flowers, and garden plants',
    type: 'RADIO',
    helpText:
      'Established trees and shrubs are typically included as theyre part of the propertys landscaping. However, valuable specimens, potted plants, or recently planted items might be excluded.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'outdoor_area',
    title: 'Barbecue',
    description:
      'Outdoor cooking equipment including built-in and portable barbecue units',
    type: 'RADIO',
    helpText:
      'Built in barbecues are usually included as theyre permanent installations. Portable or expensive barbecue units might be exclude  especially if theyre new or high end models.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'outdoor_area',
    title: 'Dustbins',
    description: 'Waste containers and recycling bins for household refuse',
    type: 'RADIO',
    helpText:
      'Basic dustbins are often included for convenience, especially if they are council-provided or built-in storage. Designer or expensive bin storage systems might be excluded.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'outdoor_area',
    title: 'Garden Shed',
    description: 'Outdoor storage buildings and shed structures in the garden',
    type: 'RADIO',
    helpText:
      'Garden sheds are valuable storage spaces that are typically included. They are often considered permanent structures, though high-end or custom sheds might be excluded if they are easily moveable.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'outdoor_area',
    title: 'Greenhouse',
    description: 'Glass or plastic structures for growing plants and gardening',
    type: 'RADIO',
    helpText:
      'Greenhouses are substantial garden structures that are usually included. They are often permanently installed and add value for gardening enthusiasts. Only very expensive or portable units might be excluded.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'outdoor_area',
    title: 'Outdoor Heater',
    description: 'Patio heaters and outdoor warming equipment for garden areas',
    type: 'RADIO',
    helpText:
      'Outdoor heaters extend the use of garden spaces. Built-in or gas-line connected heaters are typically included, while portable or expensive units might be excluded from the sale.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'outdoor_area',
    title: 'Outside Lights',
    description:
      'External lighting including security lights, garden lights, and pathway illumination',
    type: 'RADIO',
    helpText:
      'Outside lighting includes security lights, decorative garden lighting, and pathway lights. These are usually permanently wired and included, though expensive decorative lighting might be excluded.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'outdoor_area',
    title: 'Clothes Line',
    description: 'Outdoor washing lines and clothes drying equipment',
    type: 'RADIO',
    helpText:
      'Clothes lines include rotary dryers, wall-mounted lines, and pulley systems. Fixed installations are typically included, while portable or expensive rotary dryers might be excluded.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'outdoor_area',
    title: 'Water Butt',
    description:
      'Rainwater collection containers for garden watering and conservation',
    type: 'RADIO',
    helpText:
      'Outdoor heaters extend the use of garden spaces. Built-in or gas-line connected heaters are typically included, while portable or expensive units might be excluded from the sale.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'outdoor_area',
    title: 'Other Outdoor Items',
    description:
      'Additional garden features, equipment, or outdoor installations not listed in previous sections',
    type: 'RADIO',
    helpText:
      'Include items like hot tubs, garden offices, pergolas, water features, outdoor kitchens, play equipment, or any other valuable outdoor installations and equipment that enhance your propertys outdoor spaces.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'televison_and_telephone',
    title: 'Telephone Receivers',
    description: 'Landline telephone handsets and communication devices',
    type: 'RADIO',
    helpText:
      'Basic telephone handsets are often included for convenience, while expensive or smart phone systems might be excluded. Built-in intercom systems are typically included.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'television_and_telephone',
    title: 'Rotary Line',
    description: 'Rotating clothes drying systems installed in garden areas',
    type: 'RADIO',
    helpText:
      'Rotary lines are popular clothes drying solutions. Permanently installed units are usually included, while high-end or easily removable units might be excluded from the sale.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'television_and_telephone',
    title: 'Rotary Line',
    description:
      'Additional garden features, equipment, or outdoor installations not listed in previous sections',
    type: 'RADIO',
    helpText:
      'Include items like hot tubs, garden offices, pergolas, water features, outdoor kitchens, play equipment, or any other valuable outdoor installations and equipment that enhance your property s outdoor spaces.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'television_and_telephone',
    title: 'Telephone Receivers',
    description: 'Landline telephone handsets and communication devices',
    type: 'RADIO',
    helpText:
      'Basic telephone handsets are often included for convenience, while expensive or smart phone systems might be excluded. Built-in intercom systems are typically included.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'television_and_telephone',
    title: 'Television Aerial',
    description:
      'TV reception equipment including roof aerials and satellite dishes',
    type: 'RADIO',
    helpText:
      'TV aerials and dishes are permanent installations that are typically included. They re often shared with neighbors or require professional installation, making them valuable inclusions.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'television_and_telephone',
    title: 'Radio Aerial',
    description: 'Radio reception equipment and aerial installations',
    type: 'RADIO',
    helpText:
      'Radio aerials are usually simple installations that are included with the property. They are typically roof-mounted and would be difficult to remove without damage.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'television_and_telephone',
    title: 'Satellite Dish',
    description:
      'Satellite television reception equipment and dish installations',
    type: 'RADIO',
    helpText:
      'Satellite dishes are permanent roof or wall installations that are typically included. However, the subscription and viewing cards are usually excluded and remain with the seller.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'stock_of_fuels',
    title: 'Oil',
    description: 'Heating oil reserves in tanks for oil-fired heating systems',
    type: 'RADIO',
    helpText:
      'Heating oil is expensive and buyers often negotiate to purchase remaining fuel at cost price. The amount and quality of remaining oil should be clearly stated and verified at completion..',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'stock_of_fuels',
    title: 'Wood',
    description: 'Firewood, logs, and solid fuel supplies for fires and stoves',
    type: 'RADIO',
    helpText:
      'Seasoned firewood can be valuable, especially for properties with wood-burning stoves or open fires. Well-stored, dry wood is often included as a selling feature.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'fixturesAndFittings',
    taskKey: 'stock_of_fuels',
    title: 'Liquefied Petroleum Gas (LPG)',
    description:
      'Gas supplies in bottles or tanks for heating, cooking, or hot water',
    type: 'RADIO',
    helpText:
      'LPG supplies can be valuable, especially full bottles or tank contents. Buyers often purchase remaining gas at cost price, and tank rental agreements may need to be transferred.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  // ────────────────────────────────────────────
  // LEASEHOLD
  // ────────────────────────────────────────────
  {
    sectionKey: 'leasehold',
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
    points: 75,
    order: 1,
  },
  {
    sectionKey: 'leasehold',
    taskKey: 'the_property',
    title: 'What type of leasehold property does the seller own?',
    description: "'Flat' includes maisonette and apartment.",
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Flat', value: 'flat' },
      { label: 'Shared Ownership', value: 'shared_ownership' },
      { label: 'Long leasehold house', value: 'long_leasehold_house' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'the_property',
    title: 'Does the seller pay rent for the property?',
    description: '',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 2,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'the_property',
    title: 'Is the rent subject to increase?',
    description: '',
    type: 'RADIO',
    helpText:
      'Other warranties might include appliance guarantees, garden landscaping, driveway sealing, pest control treatments, or specialized contractor warranties not covered in the main categories.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 3,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'ownership_and_management',
    title: 'Who owns the freehold?',
    description: 'A person or company that is not controlled by the tenants',
    type: 'RADIO',
    helpText:
      'The freeholder is usually the person or company that owns the land your leasehold property sits on. Sometimes, though, the tenants themselves can own the freehold together through a separate management company',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'ownership_and_management',
    title: 'Who owns the freehold?',
    description: 'A person or company that the tenants control',
    type: 'RADIO',
    helpText:
      'The freeholder is usually the person or company that owns the land your leasehold property sits on. Sometimes, though, the tenants themselves can own the freehold together through a separate management company',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 2,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'ownership_and_management',
    title: 'Is there a headlease?',
    description: '',
    type: 'RADIO',
    helpText:
      'A headlease is when the freeholder gives one big lease to a company or person, and that company then grants the individual leases to the flat owners. It creates an extra layer between the freeholder and the tenants, and sometimes the tenants themselves control the company that holds the headlease.',
    options: [{ label: 'Yes', value: 'yes' }],
    points: 50,
    order: 3,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'ownership_and_management',
    title: 'Who is responsible for managing the building?',
    description: 'Please select one or more options. ',
    type: 'RADIO',
    helpText:
      'Responsibility for managing a building can fall to different parties, depending on the lease structure and any statutory rights exercised by the tenants. In some cases, the freeholder or a headleaseholder may retain control, while in others, a management company named in the lease takes on the role.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 4,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'ownership_and_management',
    title:
      "Has any tenants' management company been dissolved or struck off the register at Companies House?",
    description: '',
    type: 'RADIO',
    helpText:
      'A headlease is when the freeholder gives one big lease to a company or person, and that company then grants the individual leases to the flat owners. It creates an extra layer between the freeholder and the tenants, and sometimes the tenants themselves control the company that holds the headlease.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 5,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'ownership_and_management',
    title:
      "Does the landlord, tenants' management company or Right to Manage company employ a managing agent to collect rent or manage the building?",
    description: '',
    type: 'RADIO',
    helpText:
      "A managing agent may be engaged to oversee rent collection, service charges, and the building's day-to-day management, acting on behalf of the party with legal responsibility.",
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 6,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'documents',
    title: 'Please supply a copy of the lease and any supplemental deeds.',
    description: '',
    type: 'RADIO',
    helpText:
      'The lease acts as the rulebook for the flat, setting out rights and responsibilities, while supplemental deeds are official updates or amendments to those rules.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'documents',
    title:
      "Please supply a copy of any regulations made by the landlord or by the tenants' management company additional to those in the lease",
    description: '',
    type: 'RADIO',
    helpText:
      'These are extra rules introduced after the lease was granted, covering practical matters such as use of communal areas, behaviour in the building, or day-to-day management.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 2,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'documents',
    title:
      'Please supply a copy of any correspondence from the landlord, any management company and any managing agent.',
    description: '',
    type: 'RADIO',
    helpText:
      'Includes any letters, notices, or emails from the landlord, management company, or managing agent that relate to building management, charges, decisions, or leaseholder obligations.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 3,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'documents',
    title:
      'Please supply a copy of any invoices or demands and any statements and receipts for the payment of maintenance or service charges for the last three years.',
    description: '',
    type: 'RADIO',
    helpText:
      'Covers financial records for the past three years, including bills, demands, statements, and receipts showing payments made towards maintenance and service charges.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 4,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'documents',
    title:
      'Please supply a copy of any invoices or demands and any statements and receipts for the payment of ground rent for the last three years',
    description: '',
    type: 'RADIO',
    helpText:
      'Provides evidence of ground rent payments over the past three years, including invoices or demands issued and receipts or statements confirming payment.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 5,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'documents',
    title:
      'Please supply a copy of the buildings insurance policy arranged by the seller and a receipt for payment of the last premium',
    description: '',
    type: 'RADIO',
    helpText:
      'Evidence of current buildings insurance cover together with confirmation that the latest premium has been paid.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 6,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'documents',
    title:
      'Please supply a copy of the buildings insurance policy arranged by the landlord or management company and the schedule for the current year',
    description: '',
    type: 'RADIO',
    helpText:
      "Documentation showing the building's insurance cover arranged by the landlord or management company, including the policy schedule for the current year.",
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 7,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'documents',
    title:
      "If a landlord is a company controlled by the tenants and/or if a tenants' management company or Right to Manage company is managing the building, please supply a copy of the Memorandum and Articles of Association",
    description: '',
    type: 'RADIO',
    helpText:
      'The rulebook for the company that runs the building, explaining what it can do, how decisions are made, and the rights of the members.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 8,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'documents',
    title:
      "If a landlord is a company controlled by the tenants and/or if a tenants' management company or Right to Manage company is managing the building, please supply a copy of the share or membership certificate",
    description: 'The share or membership certificate',
    type: 'RADIO',
    helpText:
      "A document that shows you're a shareholder or member of the company that runs the building, confirming your right to have a say in how it's managed.",
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 9,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'documents',
    title:
      "If a landlord is a company controlled by the tenants and/or if a tenants' management company or Right to Manage company is managing the building, please supply a copy of the company accounts for the past three years",
    description: '',
    type: 'RADIO',
    helpText:
      "Financial records showing the company's income and spending over the last three years, giving a picture of how money has been managed.",
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 10,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'maintenance_and_service_charges',
    title:
      'Who is responsible for arranging the buildings insurance on the property?',
    description: '',
    type: 'RADIO',
    helpText:
      "Identifies whether the landlord, management company, or Right to Manage company arranges the building's insurance cover.",
    options: [
      { label: 'Seller', value: 'seller' },
      { label: 'Management Company', value: 'management_company' },
      { label: 'Landlord', value: 'landlord' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'maintenance_and_service_charges',
    title: 'In what year was the outside of the building last decorated?',
    description: 'Please give details if known',
    type: 'DATE',
    helpText:
      'The date when the exterior of the building was most recently repainted or refurbished if known, you may not know the answer to this question, so maybe ask the management company',
    options: [
      {
        label: 'Select year',
        value: 'yes',
        hasDate: true,
        dateFormat: 'monthYear',
        datePlaceholder: 'Select year',
      },
      { label: 'No', value: 'no', hasDate: false },
    ],
    points: 50,
    order: 2,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'maintenance_and_service_charges',
    title: 'In what year were any internal communal parts last decorated?',
    description: 'Please give details of known:',
    type: 'DATE',
    helpText:
      'The date when the interior of the building was most recently repainted or refurbished if known, you may not know the answer to this question, so maybe ask the management company',
    options: [
      {
        label: 'Select year',
        value: 'yes',
        hasDate: true,
        dateFormat: 'monthYear',
        datePlaceholder: 'Select year',
      },
      { label: 'No', value: 'no', hasDate: false },
    ],
    points: 50,
    order: 3,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'maintenance_and_service_charges',
    title:
      'Does the seller contribute to the cost of maintaining the building?',
    description: '',
    type: 'RADIO',
    helpText:
      'This confirms whether the seller has been required to pay towards upkeep of the building through service charges or other contributions.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 4,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'maintenance_and_service_charges',
    title:
      'Does the seller know of any expense likely to be shown in the service charge accounts within the next three years?',
    description:
      'e.g. the cost of redecoration of outside or communal areas not usually incurred annually',
    type: 'RADIO',
    helpText:
      'This checks if the seller is aware of any major or irregular upcoming costs, such as large repairs or redecorations, that will appear in future service charge accounts.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 5,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'maintenance_and_service_charges',
    title:
      'Does the seller know of any problems in the last three years regarding the level of service charges or with the management?',
    description: '',
    type: 'RADIO',
    helpText:
      'Asks whether the seller is aware of recent disputes, complaints, or issues about service charges or the way the building has been managed.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 6,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'notices',
    title:
      'Has the seller challenged the service charge or any expense in the last three years?',
    description: '',
    type: 'RADIO',
    helpText:
      'Checks whether the seller has previously disputed service charge bills or specific expenses.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'notices',
    title:
      'Does the seller know of the existence or suspected existence in the building of cladding or any defects that may create a building safety risk?',
    description: '',
    type: 'RADIO',
    helpText:
      'Aims to uncover any known safety concerns, such as combustible cladding, structural faults, or other defects that could affect compliance with building safety standards.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 2,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'consents',
    title:
      'Is the seller aware of any difficulties encountered in collecting the service charges from other flat owners?',
    description: '',
    type: 'RADIO',
    helpText:
      "Seeks to reveal whether there have been problems with other leaseholders not paying their service charges, which could impact the building's finances and upkeep.",
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'consents',
    title:
      'Does the seller owe any service charges, rent, insurance premium or other financial contribution?',
    description: '',
    type: 'RADIO',
    helpText:
      'This ensures the buyer knows if there are any unpaid sums that could transfer with the property.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 2,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'consents',
    title:
      'Does the seller contribute to the cost of maintaining the building?',
    description: '',
    type: 'RADIO',
    helpText:
      'A headlease is when the freeholder gives one big lease to a company or person, and that company then grants the individual leases to the flat owners. It creates an extra layer between the freeholder and the tenants, and sometimes the tenants themselves control the company that holds the headlease.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 3,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'consents',
    title:
      'Has the seller received a notice that the landlord wants to sell the building?',
    description: '',
    type: 'RADIO',
    helpText:
      "Checks if a sale of the freehold is in play, which could trigger tenants' rights (e.g., first refusal) and affect the buyer's plans. IE: If the landlord has told you they plan to sell the freehold of the building.",
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 4,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'consents',
    title:
      'Has the seller received any other notice about the building, its use, its condition or its repair and maintenance?',
    description: '',
    type: 'RADIO',
    helpText:
      'This is to see if the seller has had any official letters about the building that could affect its use, upkeep, or condition, so a buyer knows if there are issues to be aware of.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 5,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'consents',
    title:
      'Is the seller aware of any changes in the terms of the lease or of the landlord giving any consents under the lease?',
    description: '',
    type: 'RADIO',
    helpText:
      'Checks whether the lease has been altered in any way or if the landlord has granted permissions, such as allowing alterations, pets, or subletting.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 6,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'complaints',
    title:
      'Has the seller received any complaint from the landlord, the management company or any neighbour about anything the seller has or has not done?',
    description: '',
    type: 'RADIO',
    helpText:
      'This says whether anyone (landlord, managing agents, or neighbours) has made formal complaints about the seller or their flat—for example noise, rule breaches, unpaid charges, or unapproved changes.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'complaints',
    title:
      'Has the seller complained or had cause to complain to or about the landlord, the management company, or any neighbour?',
    description: '',
    type: 'RADIO',
    helpText:
      "This shows if the seller has raised any complaints about how the building is managed, the landlord's actions, or issues with neighbours that a buyer should know about.",
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 2,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'alterations',
    title:
      'Is the seller aware of any alterations having been made to the property since the lease was originally granted?',
    description: '',
    type: 'RADIO',
    helpText:
      'Checks if any changes or improvements—like new windows, walls removed, or layout alterations—have been made to the flat since the lease first started.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'alterations',
    title: "Was the landlord's consent for the alterations obtained?",
    description: '',
    type: 'RADIO',
    helpText:
      'Confirms whether the landlord officially approved any alterations made to the flat.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 2,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'enfranchisement',
    title: 'Has the seller owned the property for at least two years?',
    description: '',
    type: 'RADIO',
    helpText:
      "Checks if the seller has owned the flat long enough to use certain rights (e.g., starting a lease extension), which usually require at least two years' ownership.",
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'enfranchisement',
    title:
      "Has the seller served on the landlord a formal notice stating the seller's wish to buy the freehold or be granted an extended lease?",
    description: '',
    type: 'RADIO',
    helpText:
      'This finds out if the seller has started the legal process to either buy the freehold of the building or extend the lease on the flat.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 2,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'enfranchisement',
    title:
      'Is the seller aware of the service of any notice relating to the possible collective purchase of the freehold of the building or part of it by a group of tenants?',
    description: '',
    type: 'RADIO',
    helpText:
      'Checks if the seller knows about tenants in the building joining together to try to buy the freehold.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 3,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'enfranchisement',
    title:
      'Has there been any response to freehold/lease extension notices - either your own formal notices or any collective tenant group notices?',
    description: '',
    type: 'RADIO',
    helpText:
      'Checks if the seller knows about tenants in the building joining together to try to buy the freehold.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 4,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'building_safety_cladding_and_the_leaseholder_deed_of_certificate',
    title:
      'Have any remediation works on the building been proposed or carried out?',
    description: '',
    type: 'RADIO',
    helpText:
      'Asks whether any repair or safety works—such as cladding replacement, fire safety upgrades, or major structural repairs—have been planned or completed on the building',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 1,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'building_safety_cladding_and_the_leaseholder_deed_of_certificate',
    title: 'Is the lease of the property a qualifying lease?',
    description: '',
    type: 'RADIO',
    helpText:
      'Establishes whether the lease meets the legal definition of a "qualifying lease," which affects the leaseholder\'s rights, such as to extend the lease or take part in collective freehold purchase.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 2,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'building_safety_cladding_and_the_leaseholder_deed_of_certificate',
    title: 'Is there a Leaseholder Deed of Certificate for the property?',
    description: '',
    type: 'RADIO',
    helpText:
      'A legal document that confirms important information about the lease and building, often required for mortgage purposes and property sales.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 3,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'building_safety_cladding_and_the_leaseholder_deed_of_certificate',
    title:
      'Did the seller (the current leaseholder) complete the deed of certificate or was it completed by a previous leaseholder?',
    description: '',
    type: 'RADIO',
    helpText:
      'Identifies who provided the certificate information, which affects liability and accuracy of the details disclosed about the property.',
    options: [
      { label: 'Current Leaseholder', value: 'current_leaseholder' },
      { label: 'Previous Leaseholder', value: 'previous_leaseholder' },
    ],
    points: 50,
    order: 4,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'building_safety_cladding_and_the_leaseholder_deed_of_certificate',
    title:
      'Please supply a copy of the leaseholder deed of certificate and the accompanying evidence.',
    description: '',
    type: 'RADIO',
    helpText: '',
    options: [
      { label: 'Current Leaseholder', value: 'current_leaseholder' },
      { label: 'Previous Leaseholder', value: 'previous_leaseholder' },
    ],
    points: 50,
    order: 5,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'building_safety_cladding_and_the_leaseholder_deed_of_certificate',
    title:
      'Has the freeholder / landlord been notified of the intention to sell?',
    description: '',
    type: 'RADIO',
    helpText:
      'Some leases require you to inform the landlord before selling. This ensures compliance with lease terms and any landlord rights of first refusal.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 6,
  },

  {
    sectionKey: 'leasehold',
    taskKey: 'building_safety_cladding_and_the_leaseholder_deed_of_certificate',
    title:
      "Has the seller received a Landlord's Certificate and the accompanying evidence?",
    description: '',
    type: 'RADIO',
    helpText:
      'Official documentation from the freeholder confirming lease details, service charges, and building information required for the sale.',
    options: [
      { label: 'Yes', value: 'yes' },
      { label: 'No', value: 'no' },
    ],
    points: 50,
    order: 7,
  },

  // LEASEHOLD – MULTIPART EXAMPLE (lease_details task)
  {
    sectionKey: 'leasehold',
    taskKey: 'lease_details',
    title: 'Please enter the expiry date and length of your lease.',
    description:
      'You should be able to find this information on your title deeds.',
    type: 'MULTIPART' as QuestionType,
    helpText:
      'The lease expiry date and original length help determine the remaining term and value of the lease.',
    parts: [
      {
        partKey: 'lease_expiry_date',
        type: 'date',
        title: 'Select expiry date',
        options: [
          {
            label: 'Select date',
            value: 'selected',
            hasDate: true,
            dateFormat: 'fullDate',
            datePlaceholder: 'Select date',
          },
        ],
        order: 1,
      },
      {
        partKey: 'length_of_lease',
        type: 'text',
        title: 'Length of lease',
        placeholder: 'Enter years',
        inputType: 'number',
        suffix: 'Years',
        order: 2,
      },
    ],
    points: 100,
    order: 1,
  },
  {
    sectionKey: 'leasehold',
    taskKey: 'lease_details',
    title: 'Provide further information on Leasehold ownership',
    description: '',
    type: 'MULTIPART' as QuestionType,
    helpText: '',
    parts: [
      {
        partKey: 'application_date',
        type: 'date',
        title:
          'If you have applied to extend the lease, buy the freehold of the property, or vary the terms of the lease, provide details of the date the application was made and whether it was accepted by the landlord.',
        options: [
          {
            label: 'Select date',
            value: 'selected',
            hasDate: true,
            dateFormat: 'fullDate',
            datePlaceholder: 'Application date',
          },
        ],
        order: 1,
      },
      {
        partKey: 'landlord_accepted',
        type: 'radio',
        title: 'Was the application accepted by the landlord?',
        options: [
          { label: 'Yes, Accepted by landlord', value: 'yes_accepted' },
          { label: 'No, Rejected by landlord', value: 'no_rejected' },
          { label: 'Yes, Still pending', value: 'still_pending' },
        ],
        order: 2,
      },
      {
        partKey: 'ground_rent',
        type: 'text',
        title:
          'Advise how much ground rent your lease requires to be paid each year to your landlord.',
        placeholder: '0,000',
        inputType: 'number',
        prefix: '\u00a3',
        order: 3,
      },
      {
        partKey: 'rent_increase_provisions',
        type: 'radio',
        title:
          'Does your lease includes provisions for an increase in the rent',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        order: 4,
      },
      {
        partKey: 'rent_increase_frequency',
        type: 'text',
        title:
          'How frequently will the rent increase? And the amount you will pay after the increase (if known)',
        placeholder: '1',
        inputType: 'number',
        suffix: 'Year',
        order: 5,
      },
      {
        partKey: 'rent_increase_amount',
        type: 'text',
        title: 'Enter increase amount',
        placeholder: '0000',
        inputType: 'number',
        prefix: '\u00a3',
        order: 6,
      },
    ],
    points: 100,
    order: 2,
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
        parts: qt.parts || undefined,
        fields: qt.fields || undefined,
        autoSaveOn: qt.autoSaveOn || undefined,
        repeatable: qt.repeatable ?? null,
        buttonText: qt.buttonText || null,
        scaleType: qt.scaleType || null,
        scaleFormat: qt.scaleFormat || null,
        scaleMaxLabel: qt.scaleMaxLabel || null,
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

      for (const [taskKey, questions] of tasksForSection) {
        const taskDescription =
          TASK_DESCRIPTIONS[sectionKey]?.[taskKey] || null;
        const taskOrder = TASK_ORDERS[sectionKey]?.[taskKey] || 999;

        const task = await prisma.passportSectionTask.create({
          data: {
            passportSectionId: section.id,
            key: taskKey,
            title: formatTaskKey(taskKey),
            description: taskDescription,
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

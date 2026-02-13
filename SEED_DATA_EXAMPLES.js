/**
 * SEED DATA EXAMPLES FOR THREE QUESTION TYPES
 * 
 * 1. MultiTextInput - Single input field that repeats
 * 2. MultiFieldForm - Multiple input fields (non-repeatable)
 * 3. MultiFieldForm - Multiple input fields (repeatable)
 */

// ===== TYPE 1: MULTITEXTINPUT (Single input that repeats) =====
// Best for: Adding multiple items of the same type (e.g., names, phone numbers)
{
  sectionKey: 'ownershipProfile',
  taskKey: 'seller_names',
  title: 'Full names of the seller(s)',
  description: 'List all sellers individually',
  type: 'MULTITEXTINPUT',
  helpText: 'Add each seller name separately',
  parts: [
    {
      partKey: 'seller_names_list',
      type: 'multitextinput',
      title: 'Full names of the seller(s)',
      description: 'Please state the full names of everyone who is named as owner on the HM Land Registry title.',
      helpText: 'Add each seller name separately',
      placeholder: 'Enter seller name',
      buttonText: 'Add More Sellers',
      order: 1,
    },
  ],
  points: 50,
  order: 1,
}

// ===== TYPE 2: MULTIFIELDFORM (Multiple fields, NON-REPEATABLE) =====
// Best for: Single form with multiple related fields that don't repeat
{
  sectionKey: 'ownershipProfile',
  taskKey: 'company_details',
  title: 'Enter the details of limited company',
  description: '',
  type: 'MULTIFIELDFORM',
  helpText: '',
  parts: [
    {
      partKey: 'company_info',
      type: 'multifieldform',
      title: 'Company Information',
      description: 'Please provide the company details.',
      helpText: 'All fields are required',
      repeatable: false, // ← KEY: NOT REPEATABLE
      fields: [
        {
          key: 'company_name',
          label: 'Company Name',
          placeholder: 'Enter Limited Company name',
        },
        {
          key: 'registration_number',
          label: 'Company Registration Number',
          placeholder: 'Enter registration number',
        },
        {
          key: 'director_name',
          label: 'Name of Director / Authorized Person',
          placeholder: 'Enter name',
        },
        {
          key: 'country_incorporation',
          label: 'Country of Incorporation',
          placeholder: 'Enter country',
        },
      ],
      order: 1,
    },
  ],
  points: 75,
  order: 2,
}

// ===== TYPE 3: MULTIFIELDFORM (Multiple fields, REPEATABLE) =====
// Best for: Forms with multiple related fields that can be duplicated (e.g., multiple solicitors)
{
  sectionKey: 'ownershipProfile',
  taskKey: 'solicitors_details',
  title: 'Please provide details of solicitor\'s firm',
  description: 'Add solicitor information',
  type: 'MULTIFIELDFORM',
  helpText: '',
  parts: [
    {
      partKey: 'solicitor_info',
      type: 'multifieldform',
      title: 'Solicitor Details',
      description: 'Enter solicitor firm information.',
      helpText: 'You can add multiple solicitors',
      repeatable: true, // ← KEY: REPEATABLE
      buttonText: 'Add More Solicitors',
      fields: [
        {
          key: 'law_firm_name',
          label: 'Name of the Law Firm',
          placeholder: 'Enter law firm name',
        },
        {
          key: 'contact_name',
          label: 'Contact Name',
          placeholder: 'Enter contact name',
        },
        {
          key: 'address',
          label: 'Address',
          placeholder: 'Enter solicitors address',
        },
        {
          key: 'email',
          label: 'Email',
          placeholder: 'Enter solicitors email id',
        },
        {
          key: 'reference_number',
          label: 'Reference Number',
          placeholder: 'Enter reference number',
        },
      ],
      order: 1,
    },
  ],
  points: 100,
  order: 3,
}

/**
 * HOW EACH TYPE WORKS:
 * 
 * 1. MULTITEXTINPUT:
 *    - Shows single input field
 *    - User types and clicks "Add More Sellers"
 *    - Answer stored as: ['Name 1', 'Name 2', 'Name 3']
 * 
 * 2. MULTIFIELDFORM (repeatable: false):
 *    - Shows multiple input fields together
 *    - Fields all show at once in a form
 *    - NO add button
 *    - Answer stored as: { company_name: '...', registration_number: '...', ... }
 * 
 * 3. MULTIFIELDFORM (repeatable: true):
 *    - Shows multiple input fields together
 *    - Initially shows one form
 *    - Has "Add More" button to duplicate the entire form
 *    - Answer stored as: [
 *        { law_firm_name: '...', contact_name: '...', address: '...', ... },
 *        { law_firm_name: '...', contact_name: '...', address: '...', ... }
 *      ]
 * 
 * USAGE IN MULTIPART QUESTIONS:
 * All three types can be used as parts of multipart questions
 * Each type displays its title, description, and helpText from the part configuration
 */

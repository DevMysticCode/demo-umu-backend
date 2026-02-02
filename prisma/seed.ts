import { PrismaClient, QuestionType } from "@prisma/client";

const prisma = new PrismaClient();

interface QuestionData {
  title: string;
  description: string;
  type: QuestionType;
  points: number;
  order: number;
  options?: Array<{ label: string; value: string }>;
}

interface TaskData {
  key: string;
  title: string;
  description: string;
  icon: string;
  order: number;
  questions: QuestionData[];
}

interface SectionData {
  key: string;
  title: string;
  subtitle: string;
  description: string;
  imageKey: string;
  order: number;
  tasks: TaskData[];
}

const SEED_DATA: SectionData[] = [
  {
    key: "instructions",
    title: "Instructions",
    subtitle: "Getting Started",
    description: "Learn how to complete your property passport",
    imageKey: "instructions",
    order: 1,
    tasks: [
      {
        key: "read_instructions",
        title: "Read Instructions",
        description: "Understand the passport process",
        icon: "",
        order: 1,
        questions: [
          {
            title: "What is a Property Passport?",
            description:
              "A Property Passport is a comprehensive document that contains all the information about a property.",
            type: "NOTE" as QuestionType,
            points: 50,
            order: 1,
          },
        ],
      },
    ],
  },
  {
    key: "boundaries",
    title: "Boundaries",
    subtitle: "Identifying Boundaries",
    description: "Define property boundaries",
    imageKey: "boundaries",
    order: 2,
    tasks: [
      {
        key: "notes",
        title: "Notes",
        description: "Read notes before starting",
        icon: "",
        order: 1,
        questions: [
          {
            title: "Important Notes",
            description: "You must read notes before starting.",
            type: "NOTE" as QuestionType,
            points: 0,
            order: 1,
          },
        ],
      },
      {
        key: "boundary_responsibilities",
        title: "Boundary Responsibilities",
        description: "Determine boundary maintenance responsibility",
        icon: "",
        order: 2,
        questions: [
          {
            title: "Who owns or maintains the boundary?",
            description: "Identify who is responsible",
            type: "RADIO" as QuestionType,
            points: 25,
            options: [
              { label: "Neighbour", value: "neighbour" },
              { label: "Self", value: "self" },
              { label: "Shared", value: "shared" },
            ],
            order: 1,
          },
        ],
      },
    ],
  },
  {
    key: "disputes",
    title: "Disputes and Complaints",
    subtitle: "Any Issues?",
    description: "Information about disputes",
    imageKey: "disputes",
    order: 3,
    tasks: [
      {
        key: "disputes_task",
        title: "Dispute Information",
        description: "Record any disputes",
        icon: "",
        order: 1,
        questions: [
          {
            title: "Have there been any disputes?",
            description: "Describe any past disputes",
            type: "TEXT" as QuestionType,
            points: 30,
            order: 1,
          },
        ],
      },
    ],
  },
];

async function main() {
  await prisma.questionAnswer.deleteMany();
  await prisma.passportQuestion.deleteMany();
  await prisma.passportSectionTask.deleteMany();
  await prisma.passportSection.deleteMany();
  await prisma.passport.deleteMany();
  await prisma.questionTemplate.deleteMany();
  await prisma.sectionTemplate.deleteMany();

  console.log("Creating SectionTemplates...");

  const sectionTemplates = [
    { key: "instructions", title: "Instructions", order: 1 },
    { key: "boundaries", title: "Boundaries", order: 2 },
    { key: "disputes", title: "Disputes and Complaints", order: 3 },
    { key: "notices", title: "Notices and Proposals", order: 4 },
    { key: "alterations", title: "Alterations and Planning", order: 5 },
    { key: "guarantees", title: "Guarantees and Warranties", order: 6 },
    { key: "insurance", title: "Insurance", order: 7 },
    { key: "environmental", title: "Environmental", order: 8 },
    { key: "rights", title: "Rights and Informal Arrangements", order: 9 },
    { key: "parking", title: "Parking", order: 10 },
    { key: "otherCharges", title: "Other Charges", order: 11 },
    { key: "occupiers", title: "Occupiers", order: 12 },
    { key: "services", title: "Services", order: 13 },
    { key: "transactionInformation", title: "Transaction Information", order: 14 },
    { key: "fixturesAndFittings", title: "Fixtures and Fittings", order: 15 },
    { key: "leasehold", title: "Leasehold", order: 16 },
    { key: "titleDeedsAndPlan", title: "Title Deeds and Plan", order: 17 },
    { key: "searches", title: "Searches", order: 18 },
  ];

  for (const template of sectionTemplates) {
    await prisma.sectionTemplate.create({ data: template });
  }

  console.log(`Created ${sectionTemplates.length} SectionTemplates`);

  for (const section of SEED_DATA) {
    console.log(`Processing section: ${section.key}`);

    for (const task of section.tasks) {
      console.log(`  Processing task: ${task.key}`);

      for (const question of task.questions) {
        const questionTemplate = await prisma.questionTemplate.create({
          data: {
            sectionKey: section.key,
            taskKey: task.key,
            title: question.title,
            description: question.description,
            type: question.type,
            options: question.options ? question.options : undefined,
            points: question.points,
            order: question.order,
          },
        });

        console.log(`Created question template: ${questionTemplate.id} (${question.title})`);
      }
    }
  }

  console.log("Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

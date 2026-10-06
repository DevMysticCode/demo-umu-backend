// Replaces the "About this form" ownership-notes QuestionTemplate's content
// with UMU's own wording (client guidance, 2026-10-05) - the previous copy
// was the TA6 Seller's Property Information Form's own buyer/seller notes,
// close to verbatim (a copyright exposure flagged by the client's IP
// adviser). QuestionTemplate is a single global row read live by every
// passport (not copied per-passport), so this one update fixes it
// everywhere at once - unlike prisma/seed.ts, which only affects a future
// fresh seed.
//
// Run manually: npx ts-node -r tsconfig-paths/register src/scripts/rewrite-ownership-notes-copy.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NEW_PREWRITTEN = {
  content: [
    {
      type: 'paragraph',
      text: "Your passport is your home's story: the information and documents a buyer and their conveyancer will want when you sell. Building it now means no surprises later.",
    },
    { type: 'heading', text: 'Who should answer' },
    {
      type: 'paragraph',
      text: "The answers should come from the owners named on the title. If there's more than one owner, work through it together, or have each owner check the answers. If you're acting for someone else, for example under a power of attorney or after a death, answer on their behalf.",
    },
    { type: 'heading', text: '"I don\'t know" is a good answer' },
    {
      type: 'paragraph',
      text: "If you're not sure, say so. You aren't expected to be an expert, or to know about things before you owned the home. A guess that turns out wrong causes far more trouble than an honest \"don't know\".",
    },
    { type: 'heading', text: 'Why accuracy matters' },
    {
      type: 'paragraph',
      text: 'When you sell, your buyer relies on what you tell them, whether it comes from your passport, your estate agent or a conversation. If something turns out to be wrong or missing, a buyer could pull out or claim compensation.',
    },
    { type: 'heading', text: 'Keep it up to date' },
    {
      type: 'paragraph',
      text: 'If anything changes, such as new work, a letter from the council or a disagreement with a neighbour, update your passport. Before changing any arrangement with a tenant or neighbour, speak to a conveyancer first.',
    },
    { type: 'heading', text: 'Add your paperwork' },
    {
      type: 'paragraph',
      text: "Upload any letters, certificates, agreements or notices that help answer a question. Many are in the paperwork from when you bought. If something's missing, we'll show you how to get a copy.",
    },
    { type: 'callout', text: 'UMU gives information, not legal advice.' },
  ],
};

async function main() {
  const result = await prisma.questionTemplate.updateMany({
    where: { sectionKey: 'ownershipProfile', taskKey: 'notes' },
    data: {
      title: 'About this notes',
      description: 'Read this before you start.',
      prewrittenTemplates: NEW_PREWRITTEN,
    },
  });
  console.log(`QuestionTemplate (ownershipProfile/notes): ${result.count} row(s) updated.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

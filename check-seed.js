const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const sections = await prisma.sectionTemplate.findMany({ orderBy: { order: 'asc' } });
  console.log('=== SECTION TEMPLATES ===');
  sections.forEach(s => console.log('  ' + s.order + '. ' + s.key + ' (icon: ' + s.icon + ')'));
  console.log('Total:', sections.length);

  const questions = await prisma.questionTemplate.findMany({ orderBy: [{ sectionKey: 'asc' }, { order: 'asc' }] });
  console.log('\n=== QUESTION TEMPLATES ===');
  const grouped = {};
  questions.forEach(q => {
    const k = q.sectionKey + ' > ' + q.taskKey;
    if (!grouped[k]) grouped[k] = 0;
    grouped[k]++;
  });
  Object.entries(grouped).forEach(([k, v]) => console.log('  ' + k + ': ' + v + ' question(s)'));
  console.log('Total:', questions.length);

  const passport = await prisma.passport.findFirst({
    include: {
      sections: {
        orderBy: { order: 'asc' },
        include: {
          tasks: {
            orderBy: { order: 'asc' },
            include: { passportQuestions: true }
          }
        }
      }
    }
  });
  console.log('\n=== PASSPORT:', passport.addressLine1, '===');
  console.log('Sections:', passport.sections.length);
  passport.sections.forEach(s => {
    const taskCount = s.tasks.length;
    const qCount = s.tasks.reduce((sum, t) => sum + t.passportQuestions.length, 0);
    console.log('  ' + s.order + '. ' + s.key + ' [' + s.status + '] imageKey=' + s.imageKey + ' | ' + taskCount + ' task(s), ' + qCount + ' question(s)');
  });

  await prisma.$disconnect();
}
check();

import { Injectable, UnauthorizedException } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── UK property knowledge base ──────────────────────────────────────────────
const PROPERTY_KNOWLEDGE = `
## UK HOME MOVING PROCESS

### The 7 stages
1. Prepare to sell — get EPC, property passport, documents ready BEFORE listing
2. Instruct agent — choose agent, agree fee, sign contract
3. List & market — photos, portal listing, viewings
4. Offers & negotiation — accept offer, instruct solicitor, memorandum of sale issued
5. Conveyancing — searches, mortgage survey, enquiries, draft contracts (typically 8–16 weeks)
6. Exchange of contracts — legally binding, completion date set, 10% deposit paid
7. Completion — remaining funds transfer, keys released, you move

### Why sales fall through (top reasons)
- Missing or incomplete documents discovered late (EPC, planning permissions, warranties)
- Gazumping or buyer pulling out due to delays
- Mortgage valuation lower than offer (down-valuation)
- Survey reveals serious defect (subsidence, damp, roof issues)
- Broken chain — someone else in the chain pulls out
- Boundary disputes or title issues
- Leasehold complications (short lease <80 years, high service charge, missing freeholder consent)
- Slow conveyancing — solicitor delays, slow local authority searches
- Financial issues — buyer loses job or fails stress test

### Key documents sellers need BEFORE listing
- EPC (Energy Performance Certificate) — legally required, valid 10 years
- Title register and title plan (from Land Registry — £3 each online)
- Property Information Form (TA6)
- Fittings and Contents Form (TA10)
- Leasehold Information Form (TA7, if leasehold)
- Planning permissions and building regulations certificates for any works
- FENSA/CERTASS certificates for windows installed after 2002
- Gas and electrical safety certificates
- Boiler service records
- Guarantees and warranties (damp-proofing, roof, structural)
- Boundary agreements or deeds

### Property Passport
The Property Passport is a digital record of everything about a property. It stores all documents, certificates, history, and information in one place before the property goes to market. A well-prepared passport means:
- Buyers see complete information upfront
- Solicitors can act faster
- Fewer surprises mean fewer fall-throughs
- Typical conveyancing time reduces significantly

### Conveyancing explained simply
Conveyancing is the legal process of transferring property ownership. After an offer is accepted:
- Both buyer and seller instruct solicitors (different firms)
- Seller's solicitor sends draft contract and property info
- Buyer's solicitor raises enquiries, orders searches
- Searches include: local authority, water, drainage, environmental — typically 2–6 weeks
- Once satisfied, solicitors agree a completion date and exchange contracts
- Exchange is legally binding — neither party can pull out without penalty
- Completion usually happens 1–4 weeks after exchange

### Common terms explained
- Memorandum of sale: written record from the agent confirming the agreed sale price, buyer, and seller details — not legally binding
- Exchange of contracts: the moment the sale becomes legally binding
- Completion: the day money transfers and keys are handed over
- Gazumping: seller accepts a higher offer from someone else after agreeing a sale — legal in England and Wales
- Gazundering: buyer reduces their offer just before exchange — also legal
- Chain: linked sequence of property transactions dependent on each other
- Freehold: you own the property and the land outright
- Leasehold: you own the property but not the land — you pay ground rent and service charge to a freeholder
- Stamp Duty Land Tax (SDLT): tax paid by buyers. 0% up to £250,000 for most buyers; first-time buyers get relief up to £425,000
- Help to Buy: government scheme to help first-time buyers (closed to new applicants 2023)
- Shared ownership: buy a share of a property and pay rent on the rest

### Seller readiness checklist
A property is ready to sell when:
- EPC is in date
- Title documents obtained
- Property Information Form completed
- Fittings and Contents Form prepared
- All certificates for works gathered
- Solicitor instructed in advance
- Property Passport started or complete
- Boiler serviced recently

### Leasehold — key things to know
- Leases under 80 years are hard to mortgage — buyers often can't get a mortgage
- Lease extension costs: roughly 1% of property value if over 80 years; much more below 80 years
- You can extend a lease after owning for 2 years
- Service charge disputes are common — always check accounts history
- Ground rent — since 2022, new leases cannot have escalating ground rent (must be peppercorn)

### Energy efficiency / EPC
- Ratings: A (most efficient) to G (least efficient)
- Minimum EPC rating E required to rent a property legally
- A good EPC rating increases buyer confidence and mortgage eligibility
- Common improvements: loft insulation, cavity wall insulation, double glazing, heat pump, solar panels
- EPC assessors typically charge £60–£120

### About UMovingU / Open Property
UMovingU (Umovingu) is a property platform built on the belief that the home-moving process is broken because information is gathered too late. The platform helps sellers prepare a Property Passport before listing — collecting all documents, certificates, and property history in advance so that sales complete faster with fewer fall-throughs.
`;

// ─── Tool definitions ─────────────────────────────────────────────────────────
const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_passport_status',
      description:
        'Get the completion status of this user\'s most recent property passport. Returns overall completion %, section-by-section status, and a list of incomplete tasks. Call this when the user asks about their passport, what\'s missing, readiness to sell, or what to do next.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_missing_documents',
      description:
        'Get a plain list of the specific documents and tasks still outstanding in the user\'s property passport. Call this when the user asks what documents they are missing or what they still need to do.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_homescore',
      description:
        'Get the energy efficiency / HomeScore result for the user\'s property. Returns a score, rating, and any tips. Call this when the user asks about their energy rating, home efficiency, running costs, or EPC.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

@Injectable()
export class ChatService {
  private openai: OpenAI;

  constructor(private prisma: PrismaService) {
    this.openai = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }

  // ─── Tool executors ───────────────────────────────────────────────────────

  private async toolGetPassportStatus(userId: string): Promise<string> {
    const passport = await this.prisma.passport.findFirst({
      where: { ownerId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        sections: {
          orderBy: { order: 'asc' },
          include: { tasks: { orderBy: { order: 'asc' } } },
        },
      },
    });

    if (!passport) {
      return JSON.stringify({ hasPassport: false, message: 'No property passport found for this user.' });
    }

    const allTasks = passport.sections.flatMap((s) => s.tasks);
    const completedTasks = allTasks.filter((t) => t.status === 'COMPLETED');
    const completionPct =
      allTasks.length > 0 ? Math.round((completedTasks.length / allTasks.length) * 100) : 0;

    const sections = passport.sections.map((s) => ({
      title: s.title,
      status: s.status,
      tasksTotal: s.tasks.length,
      tasksComplete: s.tasks.filter((t) => t.status === 'COMPLETED').length,
      incompleteTasks: s.tasks
        .filter((t) => t.status !== 'COMPLETED')
        .map((t) => t.title),
    }));

    const incompleteSections = sections.filter((s) => s.status !== 'COMPLETED');

    return JSON.stringify({
      hasPassport: true,
      address: `${passport.addressLine1}, ${passport.postcode}`,
      overallCompletion: `${completionPct}%`,
      totalTasks: allTasks.length,
      completedTasks: completedTasks.length,
      sections,
      incompleteSections,
    });
  }

  private async toolGetMissingDocuments(userId: string): Promise<string> {
    const passport = await this.prisma.passport.findFirst({
      where: { ownerId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        sections: {
          include: { tasks: { where: { status: { not: 'COMPLETED' } }, orderBy: { order: 'asc' } } },
        },
      },
    });

    if (!passport) {
      return JSON.stringify({ hasPassport: false, missing: [], message: 'No passport found.' });
    }

    const missing = passport.sections
      .filter((s) => s.tasks.length > 0)
      .map((s) => ({
        section: s.title,
        items: s.tasks.map((t) => t.title),
      }));

    const totalMissing = missing.reduce((acc, s) => acc + s.items.length, 0);

    return JSON.stringify({
      hasPassport: true,
      address: `${passport.addressLine1}, ${passport.postcode}`,
      totalMissingItems: totalMissing,
      missingBySection: missing,
    });
  }

  private async toolGetHomescore(userId: string): Promise<string> {
    const passport = await this.prisma.passport.findFirst({
      where: { ownerId: userId },
      orderBy: { createdAt: 'desc' },
      select: { propertyId: true, addressLine1: true, postcode: true },
    });

    if (!passport?.propertyId) {
      return JSON.stringify({ hasScore: false, message: 'No property linked to passport.' });
    }

    const score = await this.prisma.homeScoreResult.findFirst({
      where: { propertyId: passport.propertyId, userId },
      orderBy: { updatedAt: 'desc' },
      select: { total: true, rating: true, tier: true, baseBill: true, adjustedBill: true },
    });

    if (!score) {
      return JSON.stringify({ hasScore: false, message: 'No HomeScore found for this property. The user can run the HomeScore assessment from the app.' });
    }

    return JSON.stringify({
      hasScore: true,
      address: `${passport.addressLine1}, ${passport.postcode}`,
      score: score.total,
      rating: score.rating,
      tier: score.tier ?? 'standard',
      estimatedAnnualBill: score.adjustedBill ? `£${Math.round(score.adjustedBill)}` : null,
    });
  }

  // ─── Derive move stage ────────────────────────────────────────────────────

  private async deriveMoveStage(
    userId: string,
    passportCount: number,
    passportCompletion: number | null,
    purpose: string,
  ): Promise<string> {
    if (purpose.includes('buy')) {
      if (passportCount === 0) return 'searching for a property to buy';
      return 'buying a property';
    }

    if (passportCount === 0) return 'thinking about selling / preparing to sell (no passport yet)';
    if (passportCompletion !== null && passportCompletion < 30) return 'early stages — passport just started';
    if (passportCompletion !== null && passportCompletion < 80) return 'building property passport (preparation stage)';
    if (passportCompletion !== null && passportCompletion >= 80) return 'nearly ready to list (passport nearly complete)';

    return 'preparing property for sale';
  }

  // ─── Main chat handler ────────────────────────────────────────────────────

  async chat(userId: string, message: string, history: ChatMessage[] = []) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const prefs = await this.prisma.userPreference.findUnique({
      where: { userId },
      select: {
        purpose: true,
        buyingTimeline: true,
        budgetMin: true,
        budgetMax: true,
        sellingTimeline: true,
        propertyValue: true,
      },
    });

    const passportCount = await this.prisma.passport.count({ where: { ownerId: userId } });

    const latestPassport = await this.prisma.passport.findFirst({
      where: { ownerId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        sections: { include: { tasks: true } },
      },
    });

    // Compute passport completion %
    let passportCompletion: number | null = null;
    if (latestPassport) {
      const allTasks = latestPassport.sections.flatMap((s) => s.tasks);
      const completedTasks = allTasks.filter((t) => t.status === 'COMPLETED');
      passportCompletion = allTasks.length > 0
        ? Math.round((completedTasks.length / allTasks.length) * 100)
        : 0;
    }

    // Build context
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'there';
    const purposeRaw = Array.isArray(prefs?.purpose) ? prefs.purpose : (prefs?.purpose ? [prefs.purpose] : []);
    const purpose = purposeRaw.map(String).join(', ').toLowerCase() || 'not specified';
    const moveStage = await this.deriveMoveStage(userId, passportCount, passportCompletion, purpose);

    const contextLines: string[] = [
      `Name: ${name}`,
      `Purpose: ${purpose}`,
      `Move stage: ${moveStage}`,
    ];

    if (prefs?.budgetMin || prefs?.budgetMax) {
      const min = prefs.budgetMin ? `£${prefs.budgetMin.toLocaleString()}` : '';
      const max = prefs.budgetMax ? `£${prefs.budgetMax.toLocaleString()}` : '';
      contextLines.push(`Budget: ${[min, max].filter(Boolean).join(' – ')}`);
    }
    if (prefs?.sellingTimeline) contextLines.push(`Selling timeline: ${prefs.sellingTimeline}`);
    if (prefs?.buyingTimeline) contextLines.push(`Buying timeline: ${prefs.buyingTimeline}`);
    if (prefs?.propertyValue) contextLines.push(`Estimated property value: £${prefs.propertyValue.toLocaleString()}`);

    if (passportCount > 0 && latestPassport) {
      contextLines.push(`Property passport: ${latestPassport.addressLine1}, ${latestPassport.postcode}`);
      contextLines.push(`Passport completion: ${passportCompletion}%`);
    } else {
      contextLines.push('Property passport: none yet');
    }

    const systemPrompt = `You are MoveCompanion, a trusted property guide from UMovingU / Open Property. You help UK homeowners and buyers navigate the home-moving process.

Your personality:
- Calm, warm, and reassuring — like a knowledgeable friend who has seen it all before
- Plain English only — no legal jargon without an immediate explanation
- Concise: 3–5 sentences unless the user asks for detail
- Always end with a practical next step or question when it helps
- Never give legal or financial advice — for those, recommend a solicitor or financial adviser
- If you don't know something, say so and guide them to the right place

User context (live data):
${contextLines.join('\n')}

You have tools available to look up live data about this user's property passport, missing documents, and HomeScore. Use them when the user asks about their specific situation — don't guess or make up completion stats.

UK property knowledge base:
${PROPERTY_KNOWLEDGE}`;

    // ─── Agentic tool-call loop ───────────────────────────────────────────
    const trimmedHistory = history.slice(-8);
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...trimmedHistory,
      { role: 'user', content: message },
    ];

    let finalReply = '';
    const MAX_ROUNDS = 3; // prevent infinite loops

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const completion = await this.openai.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        max_tokens: 500,
        temperature: 0.6,
      });

      const choice = completion.choices[0];

      // No tool calls — we have the final answer
      if (!choice.message.tool_calls || choice.message.tool_calls.length === 0) {
        finalReply = choice.message.content?.trim() || 'I\'m sorry, I couldn\'t generate a response. Please try again.';
        break;
      }

      // Append assistant message with tool calls
      messages.push(choice.message);

      // Execute each tool call and append results
      for (const toolCall of choice.message.tool_calls) {
        if (toolCall.type !== 'function') continue;
        const fn = (toolCall as { type: 'function'; function: { name: string; arguments: string } }).function;
        let result = '';
        try {
          switch (fn.name) {
            case 'get_passport_status':
              result = await this.toolGetPassportStatus(userId);
              break;
            case 'get_missing_documents':
              result = await this.toolGetMissingDocuments(userId);
              break;
            case 'get_homescore':
              result = await this.toolGetHomescore(userId);
              break;
            default:
              result = JSON.stringify({ error: 'Unknown tool' });
          }
        } catch (err) {
          result = JSON.stringify({ error: 'Tool execution failed', detail: String(err) });
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }
      // Loop continues — model will now respond with tool results in context
    }

    if (!finalReply) {
      finalReply = 'I\'m sorry, I couldn\'t complete that request. Please try again.';
    }

    return { reply: finalReply };
  }
}

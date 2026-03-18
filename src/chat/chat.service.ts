import { Injectable, UnauthorizedException } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

@Injectable()
export class ChatService {
  private openai: OpenAI;

  constructor(private prisma: PrismaService) {
    this.openai = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }

  async chat(userId: string, message: string, history: ChatMessage[] = []) {
    // 1. Fetch minimal user context
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, email: true },
    });

    if (!user) throw new UnauthorizedException('User not found');

    const prefs = await this.prisma.userPreference.findUnique({
      where: { userId },
      select: {
        purpose: true,
        buyingTimeline: true,
        budgetMin: true,
        budgetMax: true,
        propertyTypes: true,
        sellingTimeline: true,
        propertyValue: true,
      },
    });

    const passportCount = await this.prisma.passport.count({
      where: { ownerId: userId },
    });

    const latestPassport = await this.prisma.passport.findFirst({
      where: { ownerId: userId },
      orderBy: { createdAt: 'desc' },
      select: { addressLine1: true, postcode: true },
    });

    // 2. Build user context string
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'there';
    const purposeRaw = Array.isArray(prefs?.purpose) ? prefs.purpose : (prefs?.purpose ? [prefs.purpose] : []);
    const purpose = purposeRaw.map(String).join(', ') || 'not specified';
    const purposeLower = purpose.toLowerCase();
    const journeyType = purposeLower.includes('sell') ? 'seller' : purposeLower.includes('buy') ? 'buyer' : 'property user';

    let contextLines = [
      `Name: ${name}`,
      `Journey type: ${journeyType} (${purpose})`,
    ];

    if (prefs?.budgetMin || prefs?.budgetMax) {
      const min = prefs.budgetMin ? `£${prefs.budgetMin.toLocaleString()}` : '';
      const max = prefs.budgetMax ? `£${prefs.budgetMax.toLocaleString()}` : '';
      contextLines.push(`Budget: ${[min, max].filter(Boolean).join(' – ')}`);
    }

    if (prefs?.buyingTimeline) {
      contextLines.push(`Buying timeline: ${prefs.buyingTimeline}`);
    }

    if (prefs?.sellingTimeline) {
      contextLines.push(`Selling timeline: ${prefs.sellingTimeline}`);
    }

    if (passportCount > 0 && latestPassport) {
      contextLines.push(`Active passports: ${passportCount} (latest: ${latestPassport.addressLine1}${latestPassport.postcode ? ', ' + latestPassport.postcode : ''})`);
    }

    // 3. Build system prompt
    const systemPrompt = `You are MoveMate, a trusted property guide from UMovingU. You help users navigate buying and selling property in the UK.

Your personality:
- Calm, warm, and reassuring — like a knowledgeable friend
- You explain things in simple, clear, non-technical language
- You are available 24/7 and never rush the user
- You guide step-by-step and always suggest a clear next action
- You never overwhelm with too much at once
- You prioritise clarity, practical advice, and emotional reassurance

Rules:
- Keep responses short and focused (3–5 sentences max unless the user asks for detail)
- Always end with a helpful suggestion or next step when relevant
- Never give legal or financial advice — suggest consulting a professional for those
- If unsure, say so honestly and suggest where to get help

User context:
${contextLines.join('\n')}`;

    // 4. Construct messages (limit history to last 8 messages)
    const trimmedHistory = history.slice(-8);
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...trimmedHistory,
      { role: 'user', content: message },
    ];

    // 5. Call OpenAI
    const completion = await this.openai.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: 300,
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content?.trim() || 'I\'m sorry, I couldn\'t generate a response. Please try again.';

    return { reply };
  }
}

"""
Extract help content from UK_Property_Passport_Education_Content.pdf
and write to passport-help-content.ts
"""
import pdfplumber
import re

pdf = pdfplumber.open(r'd:/ReactProjects/op_nuxt/umu-backend/prisma/UK_Property_Passport_Education_Content.pdf')
page_texts = []
for page in pdf.pages:
    t = page.extract_text()
    page_texts.append(t or '')
all_text = '\n'.join(page_texts)
del page_texts

blocks = re.split(r'\n(?=Q\d+\. )', all_text)
del all_text

def clean(s):
    s = s.replace('\u2019', "'").replace('\u2018', "'")
    s = s.replace('\u201c', '"').replace('\u201d', '"')
    s = s.replace('\u2014', '--').replace('\u2013', '-')
    s = s.replace('\ufffd', '-')
    s = s.replace('\u00e2\u20ac\u2122', "'")
    s = s.replace('\u00e2\u20ac\u201c', '-')
    s = re.sub(r'-\n([a-z])', r'\1', s)
    return s

# Known section headers in buyer guidance
BUYER_HEADERS = {
    'What this means',
    'What a good answer looks like',
    'Red flags',
    'Questions to ask your solicitor',
}

def clean_paragraph(text):
    lines = text.split('\n')
    result, current = [], ''
    last_was_bullet = False
    for line in lines:
        line = line.strip()
        if not line:
            if current:
                result.append(current)
                current = ''
            last_was_bullet = False
        elif line in BUYER_HEADERS:
            if current:
                result.append(current)
                current = ''
            result.append('## ' + line)
            last_was_bullet = False
        elif line.startswith('\u2022') or line.startswith('\u2212') or re.match(r'^[-\u2013]\s', line):
            if current:
                result.append(current)
                current = ''
            # Normalise bullet to • and start accumulating
            line = re.sub(r'^[\u2022\u2212\u2013-]\s*', '\u2022 ', line)
            current = line
            last_was_bullet = True
        else:
            if last_was_bullet:
                # Continuation of a wrapped bullet — join to current bullet
                current = (current + ' ' + line) if current else line
            else:
                if current:
                    current += ' ' + line
                else:
                    current = line
    if current:
        result.append(current)
    return '\n'.join(result)

def extract_between(text, start_marker, end_markers):
    start = text.find(start_marker)
    if start == -1:
        return ''
    start += len(start_marker)
    end = len(text)
    for em in end_markers:
        idx = text.find(em, start)
        if idx != -1 and idx < end:
            end = idx
    return text[start:end].strip()

parsed = []
for block in blocks[1:]:
    block = clean(block)
    first_line = block.split('\n')[0]
    m = re.match(r'Q(\d+)\. (.+)', first_line)
    if not m:
        continue
    qnum = int(m.group(1))
    title = m.group(2).strip()

    type_m = re.search(r'\n(SECTION|TASK|QUESTION) ', block)
    qtype = type_m.group(1) if type_m else 'QUESTION'

    slug_m = re.search(r'Slug key: (\S+)', block)
    slug = slug_m.group(1).strip().rstrip('.') if slug_m else ''

    seller_raw = extract_between(block, 'Seller Guidance (Property Passport)\n',
                                  ["Buyer Guidance (Buyer's View)", 'Disclaimer:'])
    buyer_raw = extract_between(block, "Buyer Guidance (Buyer's View)\n",
                                 ['Disclaimer:'])

    seller = clean_paragraph(seller_raw)
    buyer = clean_paragraph(buyer_raw)

    parsed.append({
        'q': qnum, 'title': title, 'type': qtype,
        'slug': slug, 'seller': seller, 'buyer': buyer
    })

sections  = {p['slug']: p for p in parsed if p['type'] == 'SECTION'}
tasks     = {p['slug']: p for p in parsed if p['type'] == 'TASK'}
questions = {p['slug']: p for p in parsed if p['type'] == 'QUESTION'}

print(f'Sections: {len(sections)}, Tasks: {len(tasks)}, Questions: {len(questions)}')

DISCLAIMER = "This content is for general educational purposes only - not legal advice. Always consult a qualified solicitor for guidance specific to your situation."

def ts_key(s):
    """Wrap a key string in single quotes."""
    return "'" + s.replace("'", "\\'") + "'"

def ts_val(s):
    """Wrap a value string in backtick template literal, escaping inner backticks."""
    s = s.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')
    return '`' + s + '`'

out = []
out.append("/**")
out.append(" * Passport Help Content")
out.append(" * AUTO-GENERATED from UK_Property_Passport_Education_Content.pdf")
out.append(" * Re-generate: python prisma/extract_help.py")
out.append(" *")
out.append(" * Format:")
out.append(" *   Seller guidance: plain paragraphs separated by \\n")
out.append(" *   Buyer guidance : paragraphs + ## Section Headers + • bullet lines")
out.append(" *   HelpDrawer.vue renders ## headers and • bullets with styled formatting.")
out.append(" */")
out.append("")
out.append("export interface HelpContent {")
out.append("  sellerGuidance: string;")
out.append("  buyerGuidance: string;")
out.append("  disclaimer?: string;")
out.append("  helpVideoUrl?: string;")
out.append("}")
out.append("")
out.append("/** Convert a question title to a URL/key slug (must match seed.ts logic). */")
out.append("export function toSlug(title: string): string {")
out.append("  return title")
out.append('    .toLowerCase()')
out.append('    .replace(/[^a-z0-9]+/g, "_")')
out.append('    .replace(/^_+|_+$/g, "");')
out.append("}")
out.append("")
out.append(f"const DISCLAIMER = {ts_val(DISCLAIMER)};")
out.append("")
out.append("")

def write_block(label, data_dict):
    out.append(f"// {'─' * 74}")
    out.append(f"// {label}")
    out.append(f"// {'─' * 74}")
    if 'SECTION' in label:
        var_name = 'SECTION_HELP_CONTENT'
    elif 'TASK' in label:
        var_name = 'TASK_HELP_CONTENT'
    else:
        var_name = 'QUESTION_HELP_CONTENT'
    out.append(f"export const {var_name}: Record<string, HelpContent> = {{")
    for slug, p in data_dict.items():
        out.append(f"  {ts_key(slug)}: {{")
        out.append(f"    sellerGuidance: {ts_val(p['seller'])},")
        out.append(f"    buyerGuidance: {ts_val(p['buyer'])},")
        out.append(f"    disclaimer: DISCLAIMER,")
        out.append(f"  }},")
    out.append("};")
    out.append("")

write_block("SECTION-LEVEL HELP", sections)
write_block("TASK-LEVEL HELP", tasks)
write_block("QUESTION-LEVEL HELP (highest priority, overrides task/section)", questions)

output = '\n'.join(out)
with open(r'd:/ReactProjects/op_nuxt/umu-backend/prisma/passport-help-content.ts', 'w', encoding='utf-8') as f:
    f.write(output)

print(f'Written {len(output):,} chars to passport-help-content.ts')
print(f'Total entries: {len(parsed)}')

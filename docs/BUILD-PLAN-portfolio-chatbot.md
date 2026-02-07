# Design Architecture & Build Plan: Portfolio AI Chatbot

**Companion document to:** PRD-portfolio-chatbot.md
**Purpose:** Provide Claude Code with an unambiguous, file-by-file implementation plan.

---

## 1. Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    VISITOR'S BROWSER                     │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │          Existing Single-Page Portfolio            │  │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────────────┐  │  │
│  │  │Experience│  │ Projects │  │    Contact       │  │  │
│  │  │ Section  │  │ Section  │  │    Section       │  │  │
│  │  └─────────┘  └──────────┘  └─────────────────┘  │  │
│  │                                                   │  │
│  │  ┌─────────────────────────────────────────────┐  │  │
│  │  │         CHAT WIDGET (chatbot.js)            │  │  │
│  │  │                                             │  │  │
│  │  │  States:                                    │  │  │
│  │  │  1. Collapsed → Floating button (bottom-R)  │  │  │
│  │  │  2. Expanded  → Chat panel overlay          │  │  │
│  │  │                                             │  │  │
│  │  │  Responsibilities:                          │  │  │
│  │  │  - Render UI (button, panel, messages)      │  │  │
│  │  │  - Track conversation state in memory       │  │  │
│  │  │  - Send messages to Worker endpoint         │  │  │
│  │  │  - Parse SSE stream, render tokens live     │  │  │
│  │  │  - Handle errors gracefully                 │  │  │
│  │  │  - Count exchanges for CTA timing           │  │  │
│  │  └──────────────────┬──────────────────────────┘  │  │
│  └─────────────────────┼─────────────────────────────┘  │
└────────────────────────┼────────────────────────────────┘
                         │
                         │ HTTPS POST /api/chat
                         │ Request: { messages: [...] }
                         │ Response: text/event-stream (SSE)
                         │
┌────────────────────────▼────────────────────────────────┐
│              CLOUDFLARE WORKER (Edge)                    │
│              portfolio-chatbot-proxy                     │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │                  Request Pipeline                  │  │
│  │                                                   │  │
│  │  1. CORS check ──→ reject if origin ≠ allowed     │  │
│  │  2. Method check ──→ reject if ≠ POST             │  │
│  │  3. Rate limit ──→ reject if > 30 req/IP/hr       │  │
│  │  4. Validate body ──→ check messages array         │  │
│  │  5. Build API request:                            │  │
│  │     - Inject SYSTEM_PROMPT (hardcoded in Worker)  │  │
│  │     - Inject ANTHROPIC_API_KEY (from secrets)     │  │
│  │     - Set model: claude-haiku-4-5-20251001        │  │
│  │     - Set max_tokens: 500                         │  │
│  │     - Set stream: true                            │  │
│  │  6. Proxy SSE stream back to client               │  │
│  └───────────────────┬───────────────────────────────┘  │
│                      │                                   │
│  ┌───────────────────┴───────────────────────────────┐  │
│  │              Stored Secrets & Config               │  │
│  │                                                   │  │
│  │  ANTHROPIC_API_KEY  → wrangler secret             │  │
│  │  ALLOWED_ORIGIN     → wrangler.toml env var       │  │
│  │  SYSTEM_PROMPT      → const in worker source      │  │
│  └───────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────┘
                         │
                         │ HTTPS POST /v1/messages
                         │ Authorization: Bearer $API_KEY
                         │ Stream: true
                         │
┌────────────────────────▼────────────────────────────────┐
│              ANTHROPIC API                               │
│              claude-haiku-4-5-20251001                   │
│                                                         │
│  Input:                                                 │
│  - system: SYSTEM_PROMPT (~2500 tokens)                 │
│  - messages: conversation history (max 20 messages)     │
│  - max_tokens: 500                                      │
│  - temperature: 0.7                                     │
│                                                         │
│  Output:                                                │
│  - Server-Sent Events stream                            │
│  - content_block_delta events with text chunks          │
│  - message_stop event on completion                     │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Data Flow (Single Message Lifecycle)

```
VISITOR                    BROWSER                   WORKER                    CLAUDE API
  │                          │                         │                          │
  │  Types message,          │                         │                          │
  │  clicks Send             │                         │                          │
  │ ─────────────────────►   │                         │                          │
  │                          │  Append to messages[]   │                          │
  │                          │  Render user bubble     │                          │
  │                          │  Show typing indicator  │                          │
  │                          │  Disable input          │                          │
  │                          │                         │                          │
  │                          │  POST /api/chat         │                          │
  │                          │  { messages: [...] }    │                          │
  │                          │ ───────────────────►    │                          │
  │                          │                         │  Validate origin         │
  │                          │                         │  Check rate limit        │
  │                          │                         │  Validate body           │
  │                          │                         │                          │
  │                          │                         │  POST /v1/messages       │
  │                          │                         │  + system prompt         │
  │                          │                         │  + API key               │
  │                          │                         │  + stream: true          │
  │                          │                         │ ───────────────────►     │
  │                          │                         │                          │
  │                          │                         │  ◄── SSE: delta "Gavin"  │
  │                          │  ◄── SSE: delta "Gavin" │                          │
  │  See "Gavin" appear      │                         │                          │
  │                          │                         │  ◄── SSE: delta "'s"     │
  │                          │  ◄── SSE: delta "'s"    │                          │
  │  See "Gavin's" appear    │                         │                          │
  │                          │                         │        ...               │
  │                          │                         │  ◄── SSE: message_stop   │
  │                          │  ◄── SSE: message_stop  │                          │
  │                          │                         │                          │
  │                          │  Append full response   │                          │
  │                          │  to messages[]          │                          │
  │                          │  Hide typing indicator  │                          │
  │                          │  Re-enable input        │                          │
  │  See complete response   │                         │                          │
  │                          │                         │                          │
```

---

## 3. File Structure

### 3.1 Portfolio Repository (GitHub Pages)

Only two new files are added to the existing repo:

```
your-portfolio-repo/
├── index.html              ← EXISTING (add 2 lines: link + script)
├── css/                    ← EXISTING
├── js/                     ← EXISTING
├── ...                     ← EXISTING (all other portfolio files untouched)
│
├── chatbot/
│   ├── chatbot.css         ← NEW: All widget styles (~150 lines)
│   └── chatbot.js          ← NEW: All widget logic (~300 lines)
```

**Integration (add to index.html before `</body>`):**
```html
<link rel="stylesheet" href="chatbot/chatbot.css">
<script src="chatbot/chatbot.js" defer></script>
```

### 3.2 Cloudflare Worker (Separate Repository or Directory)

```
portfolio-chatbot-worker/
├── wrangler.toml           ← Worker configuration
├── src/
│   └── index.js            ← Worker logic (~120 lines)
├── package.json            ← Minimal (just wrangler devDependency)
└── README.md               ← Deployment instructions
```

These are deliberately separate repos/directories. The Worker deploys independently from the portfolio site. The only coupling is the Worker's URL hardcoded in `chatbot.js`.

---

## 4. Component Specifications

### 4.1 chatbot.css — Full Style Spec

```
Tokens / CSS Custom Properties (define at :root or scoped to .chatbot-widget):

  --chat-bg:              #0d1820        (panel background)
  --chat-header-bg:       #111f2b        (header gradient start)
  --chat-input-bg:        #141e28        (input area background)
  --chat-border:          #1a2a38        (subtle borders)
  --chat-border-hover:    #1a7a5a        (accent border on hover)
  --chat-bubble-user:     #0f4c3a        (user message background)
  --chat-bubble-assistant:#1e2a35        (assistant message background)
  --chat-text-primary:    #e8f0f5        (headings, user message text)
  --chat-text-secondary:  #c8d6e0        (assistant message text)
  --chat-text-muted:      #5a7a8a        (timestamps, labels)
  --chat-accent:          #1a9a6a        (buttons, indicators, avatar)
  --chat-accent-dark:     #0f4c3a        (accent gradient start)
  --chat-radius-panel:    16px           (panel corners)
  --chat-radius-bubble:   16px           (message bubble corners)
  --chat-radius-button:   50%            (toggle button)
  --chat-width:           380px          (panel width, desktop)
  --chat-height:          520px          (panel height, desktop)
  --chat-z-index:         9999           (above all page content)

Layout classes:

  .chatbot-toggle         Fixed bottom-right button (56x56px, circular)
  .chatbot-panel          Fixed bottom-right panel (380x520, rounded)
  .chatbot-header         Panel header with avatar + title
  .chatbot-messages       Scrollable message container (flex-grow)
  .chatbot-welcome        Centered greeting + starter prompts (shown when empty)
  .chatbot-starters       2x2 grid of clickable prompt buttons
  .chatbot-bubble-user    Right-aligned message bubble
  .chatbot-bubble-bot     Left-aligned message bubble with avatar
  .chatbot-typing         Typing indicator (3 animated dots)
  .chatbot-input-area     Fixed bottom input row
  .chatbot-input          Text input field
  .chatbot-send           Send button

Animations:

  @keyframes chatbot-slideUp     Panel open (translateY(20px) → 0, opacity 0→1, 250ms)
  @keyframes chatbot-slideDown   Panel close (reverse of slideUp, 200ms)
  @keyframes chatbot-fadeIn      Message appear (translateY(8px) → 0, opacity 0→1, 200ms)
  @keyframes chatbot-bounce      Typing dots (staggered Y bounce, 1.2s loop)
  @keyframes chatbot-pulse       Toggle button attention pulse (opacity 0.4→1, 2s, runs once after 2s delay)

Mobile (max-width: 640px):

  .chatbot-panel becomes full-screen (position: fixed, inset: 0, border-radius: 0)
  .chatbot-toggle shrinks to 48x48px
  Close button becomes prominent top-right X
  All touch targets minimum 44x44px

Accessibility:

  Focus-visible outlines on all interactive elements (2px solid var(--chat-accent))
  Reduced motion: disable all animations if prefers-reduced-motion is set
```

### 4.2 chatbot.js — Full Logic Spec

```
Structure (IIFE or module, self-initializing):

  (function() {
    const CONFIG = {
      workerUrl: 'https://portfolio-chatbot.<subdomain>.workers.dev/api/chat',
      maxMessages: 20,
      maxInputLength: 500,
      starterPrompts: [
        "What are Gavin's main technical skills?",
        "Tell me about his genomics projects",
        "Why should we consider hiring Gavin?",
        "What's his background?"
      ]
    };

    // ─── STATE ───
    let messages = [];           // Array of { role: 'user'|'assistant', content: string }
    let isOpen = false;          // Panel visibility
    let isLoading = false;       // Waiting for response
    let assistantMsgCount = 0;   // For CTA timing (tracked in system prompt, but
                                 //   frontend could also visually cue)

    // ─── DOM CREATION ───
    // On DOMContentLoaded:
    // 1. Create toggle button, append to document.body
    // 2. Create panel (header, messages container, welcome screen, input area)
    // 3. Append panel to document.body (hidden initially)
    // 4. Bind event listeners

    // ─── CORE FUNCTIONS ───

    function togglePanel()
      // Toggle isOpen, add/remove .chatbot-open class
      // Manage focus: trap inside panel when open, restore to toggle when closed
      // Set aria-expanded on toggle button

    function sendMessage(text)
      // 1. Validate: trim, check length, check !isLoading
      // 2. Append { role: 'user', content: text } to messages[]
      // 3. Render user bubble
      // 4. Clear input, disable input, show typing indicator
      // 5. Prepare payload: truncate messages to last CONFIG.maxMessages
      // 6. Call fetchStream(payload)
      // 7. On complete: append assistant message, hide typing, enable input
      // 8. On error: show error bubble, enable input

    async function fetchStream(messages)
      // 1. POST to CONFIG.workerUrl with { messages }
      // 2. If response not ok, throw with status-appropriate message
      // 3. Get reader from response.body.getReader()
      // 4. Read chunks, decode with TextDecoder
      // 5. Parse SSE lines:
      //    - Lines starting with "data: " → parse JSON
      //    - If type === "content_block_delta" → extract delta.text
      //    - If type === "message_stop" → finalize
      // 6. As each delta arrives, append text to the current assistant bubble
      // 7. Auto-scroll messages container to bottom
      // 8. Return complete response text

    function renderMessage(role, content)
      // Create DOM elements for a message bubble
      // User: right-aligned, accent background
      // Assistant: left-aligned with avatar, dark background
      // Apply fadeIn animation
      // Append to messages container
      // Return the content element (for streaming updates)

    function showTyping() / hideTyping()
      // Toggle typing indicator visibility

    function showError(message)
      // Render an error-styled assistant bubble
      // Include fallback text: "Feel free to reach out to Gavin directly at [email]"

    function handleStarterClick(text)
      // Hide welcome screen
      // Call sendMessage(text)

    // ─── INITIALIZATION ───
    document.addEventListener('DOMContentLoaded', init);
  })();
```

### 4.3 Cloudflare Worker (src/index.js) — Full Logic Spec

```
Overview: Single-file Worker. No dependencies beyond Web APIs.

// ─── CONFIGURATION ───
const SYSTEM_PROMPT = `...`;   // Full system prompt (see Section 5)
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 500;
const TEMPERATURE = 0.7;
const RATE_LIMIT = 30;          // requests per IP per hour
const RATE_WINDOW = 3600000;    // 1 hour in ms

// ─── RATE LIMITER ───
// In-memory Map<string, { count: number, resetAt: number }>
// Note: Worker instances may restart, resetting the map. This is acceptable —
// it means rate limits are "best effort" rather than strict, which is fine
// for this threat model. For stricter enforcement, use Cloudflare KV.

const rateLimitMap = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ─── REQUEST HANDLER ───
export default {
  async fetch(request, env) {

    // 1. Handle CORS preflight (OPTIONS)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // 2. Reject non-POST
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: corsHeaders(env)
      });
    }

    // 3. Check rate limit
    const ip = request.headers.get('CF-Connecting-IP');
    if (!checkRateLimit(ip)) {
      return new Response(JSON.stringify({
        error: 'Rate limit exceeded. Please try again in a few minutes.'
      }), { status: 429, headers: corsHeaders(env) });
    }

    // 4. Parse and validate body
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400, headers: corsHeaders(env)
      });
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Messages array required' }), {
        status: 400, headers: corsHeaders(env)
      });
    }

    if (body.messages.length > 20) {
      return new Response(JSON.stringify({ error: 'Too many messages' }), {
        status: 400, headers: corsHeaders(env)
      });
    }

    for (const msg of body.messages) {
      if (!['user', 'assistant'].includes(msg.role)) {
        return new Response(JSON.stringify({ error: 'Invalid message role' }), {
          status: 400, headers: corsHeaders(env)
        });
      }
      if (typeof msg.content !== 'string' || msg.content.length > 500) {
        return new Response(JSON.stringify({ error: 'Invalid message content' }), {
          status: 400, headers: corsHeaders(env)
        });
      }
    }

    // 5. Forward to Anthropic API with streaming
    const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: SYSTEM_PROMPT,
        stream: true,
        messages: body.messages
      })
    });

    // 6. Proxy the SSE stream back to client
    return new Response(apiResponse.body, {
      status: apiResponse.status,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        ...corsHeaders(env)
      }
    });
  }
};

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN
  };
}
```

### 4.4 wrangler.toml

```toml
name = "portfolio-chatbot-proxy"
main = "src/index.js"
compatibility_date = "2024-01-01"

[vars]
ALLOWED_ORIGIN = "https://your-github-pages-domain.com"

# ANTHROPIC_API_KEY is set via: wrangler secret put ANTHROPIC_API_KEY
# It does NOT go in this file.
```

---

## 5. System Prompt Template

This is the full template to be placed in the Worker's `SYSTEM_PROMPT` constant. Gavin must fill in the bracketed placeholders before deployment.

```
You are a friendly, knowledgeable AI assistant embedded on Gavin's personal portfolio website. Your purpose is to help visitors — especially recruiters, hiring managers, and potential collaborators — learn about Gavin's qualifications, experience, and what makes him a strong candidate for roles in bioinformatics and computational biology.

## About Gavin

### Summary
[2-3 sentence professional summary. Example: "Gavin is a bioinformatics professional specializing in genomic variant analysis and NGS pipeline development, based in the San Francisco Bay Area. He combines deep understanding of clinical genomics with strong computational skills, making him effective at bridging biology and engineering teams."]

### Technical Skills
- Genomic Analysis: [list specific tools, e.g., GATK HaplotypeCaller, bcftools, VEP, JANNOVAR]
- Databases & Resources: [e.g., ClinVar, gnomAD, OMIM, UniProt, COSMIC]
- Programming: [e.g., Python (pandas, BioPython), R, Bash]
- Bioinformatics Tools: [e.g., BWA, SAMtools, Picard, FastQC, MultiQC, IGV]
- Infrastructure: [e.g., Linux, Git, GitHub Pages, basic cloud/containerization]
- Other: [any additional skills to highlight]

### Key Projects
1. [Project Name]: [3-4 sentence description including what it was, what tools/methods were used, and what the outcome demonstrated]
2. [Project Name]: [Same format]
3. [Additional projects as needed]

### Education
[Degree(s), institution(s), relevant coursework or honors]

### Location & Availability
- Based in Los Gatos, California (San Francisco Bay Area)
- Actively seeking full-time roles in bioinformatics / computational biology
- Open to [remote / hybrid / on-site — specify preference]

### What Makes Gavin Stand Out
- [Differentiator 1 — e.g., bridges biology and computation]
- [Differentiator 2 — e.g., end-to-end pipeline thinker]
- [Differentiator 3 — e.g., self-directed builder who learns by doing]

### Work Style
[2-3 sentences describing how Gavin works — e.g., detail-oriented, collaborative, values reproducibility and clear documentation]

## Behavioral Rules

1. You know ONLY what is described in this prompt. Do not infer, assume, or fabricate any additional details about Gavin's background, skills, or interests beyond what is explicitly listed here.

2. If asked about something not covered in this prompt, respond honestly: "I don't have details on that, but I'd encourage you to reach out to Gavin directly — he'd be happy to discuss it."

3. Keep responses concise: 2-3 paragraphs maximum unless the visitor asks for more detail.

4. Be warm, enthusiastic, and conversational — but never exaggerate or oversell. Let Gavin's actual experience speak for itself.

5. When a visitor asks technical questions, demonstrate depth. Show that Gavin's knowledge is substantive, not surface-level.

6. If a visitor seems to be evaluating Gavin for a specific role, naturally connect his relevant skills and experience to what they might be looking for.

7. Never badmouth other candidates, companies, or technologies.

8. For questions about salary expectations or very personal topics, politely redirect: "That's something Gavin would prefer to discuss directly — feel free to reach out!"

## Contact & Next Steps

Gavin's email: [YOUR EMAIL ADDRESS]

After 3-4 exchanges in the conversation, naturally suggest that the visitor email Gavin if they'd like to continue the conversation or schedule a call. Suggest they use the subject line format "Chatbot Intro: [Their Name / Company]" so Gavin can recognize and prioritize the email. Keep this suggestion warm and natural — frame it as a helpful next step, not a hard sell. Example:

"By the way, if you'd like to take this conversation further, feel free to email Gavin at [email]. If you use the subject line 'Chatbot Intro: [Your Name / Company]', he'll know you came from here and will prioritize getting back to you."

If the visitor asks about contacting Gavin at any point before the 4th exchange, share this information immediately — don't withhold it until the trigger point.
```

---

## 6. Build Sequence for Claude Code

Execute in this exact order. Each step has a verification check before proceeding to the next.

### Step 1: Scaffold the Cloudflare Worker

```
Action:
  1. Create directory: portfolio-chatbot-worker/
  2. Create wrangler.toml with configuration
  3. Create src/index.js with full Worker logic
  4. Create package.json with wrangler as devDependency

Verification:
  - wrangler dev should start local server
  - POST to localhost with valid body should reach the fetch handler
  - OPTIONS request should return CORS headers
  - Invalid requests (wrong method, bad body) should return appropriate errors

Blockers:
  - Gavin must have a Cloudflare account
  - Gavin must have an Anthropic API key
  - Gavin must run: wrangler secret put ANTHROPIC_API_KEY
```

### Step 2: Deploy and Test the Worker

```
Action:
  1. Run: wrangler deploy
  2. Note the deployed URL (https://portfolio-chatbot-proxy.<subdomain>.workers.dev)
  3. Test with curl:
     curl -X POST https://<worker-url>/api/chat \
       -H "Content-Type: application/json" \
       -H "Origin: https://<portfolio-domain>" \
       -d '{"messages":[{"role":"user","content":"What are Gavin'\''s skills?"}]}'

Verification:
  - Should receive streaming SSE response with chatbot content
  - CORS headers present in response
  - Rate limiting rejects after 30 rapid requests
  - Invalid payloads return 400 errors

Blockers:
  - Step 1 must be complete
  - ANTHROPIC_API_KEY secret must be set
  - ALLOWED_ORIGIN must match the portfolio domain exactly (including https://)
```

### Step 3: Build the Frontend Widget

```
Action:
  1. Create chatbot/ directory in the portfolio repo
  2. Create chatbot/chatbot.css with all styles per Section 4.1
  3. Create chatbot/chatbot.js with all logic per Section 4.2
  4. Set CONFIG.workerUrl to the deployed Worker URL from Step 2

Verification:
  - Open index.html locally, widget toggle button appears bottom-right
  - Click toggle opens panel with welcome screen and starter prompts
  - Click starter prompt sends message and receives streamed response
  - Typing indicator shows during loading
  - Messages render correctly (user right, assistant left with avatar)
  - Error state displays when Worker is unreachable
  - Panel closes on toggle click or Escape key
  - Input rejects empty messages and messages > 500 chars
  - Conversation works for 10+ exchanges without issues

Blockers:
  - Step 2 must be complete (need live Worker URL)
  - ALLOWED_ORIGIN in Worker must include localhost/127.0.0.1 for local testing
    OR temporarily set to '*' during development, then restrict before launch
```

### Step 4: Integrate into Portfolio Site

```
Action:
  1. Add to index.html before </body>:
     <link rel="stylesheet" href="chatbot/chatbot.css">
     <script src="chatbot/chatbot.js" defer></script>
  2. Verify no CSS conflicts with existing site styles
     (all chatbot classes are prefixed with .chatbot- to avoid collisions)
  3. Verify z-index doesn't conflict with existing positioned elements
  4. Test on mobile viewport (< 640px) — panel should go full-screen

Verification:
  - Portfolio site loads normally with no visual changes except the chat button
  - Existing scroll navigation and anchor links work unaffected
  - Chat widget works end-to-end on the live site
  - Mobile layout works correctly
  - No console errors

Blockers:
  - Step 3 must be complete
  - ALLOWED_ORIGIN in Worker must be updated to production domain
```

### Step 5: Final Hardening

```
Action:
  1. Update ALLOWED_ORIGIN in wrangler.toml to production domain only
  2. Redeploy Worker: wrangler deploy
  3. Set Anthropic API spend limit to $10/month
  4. Set Anthropic API alert at $5/month
  5. Fill in all [PLACEHOLDER] values in system prompt
  6. Test the full flow on the live production site
  7. Test error states: kill Worker → verify error message shows in widget
  8. Test rate limit: send 31 requests rapidly → verify 429 response
  9. Test prompt boundaries: ask the bot something not in the system prompt →
     verify it responds with "I don't have details on that"

Verification:
  - Full end-to-end flow works on production
  - CORS rejects requests from other origins
  - Rate limiting works
  - Spend cap is set
  - System prompt contains no placeholder text
  - Bot accurately represents Gavin and doesn't fabricate

Blockers:
  - Steps 1-4 must be complete
  - All placeholder values must be filled in
```

---

## 7. Testing Checklist

### Functional
- [ ] Toggle button opens/closes panel
- [ ] Starter prompts send messages
- [ ] Free-text input sends messages
- [ ] Streaming responses render token-by-token
- [ ] Typing indicator shows during loading
- [ ] Messages scroll to bottom on new content
- [ ] Conversation history persists within session
- [ ] History resets on page reload
- [ ] Input disabled during loading
- [ ] Empty/whitespace input rejected
- [ ] Long input (>500 chars) rejected or truncated
- [ ] 20+ message conversations handled (oldest truncated)
- [ ] Escape key closes panel
- [ ] Enter key sends message
- [ ] Shift+Enter allows newline in input (optional — nice-to-have)

### Error Handling
- [ ] Network failure shows user-friendly error
- [ ] Rate limit (429) shows appropriate message
- [ ] API error (500) shows fallback with Gavin's email
- [ ] Malformed response handled gracefully

### Visual / Responsive
- [ ] Dark theme matches portfolio aesthetic
- [ ] No CSS conflicts with existing site styles
- [ ] Desktop layout: 380x520 panel, bottom-right
- [ ] Mobile layout: full-screen overlay
- [ ] Animations are smooth (slideUp, fadeIn, typing dots)
- [ ] Reduced-motion preference respected

### Accessibility
- [ ] All elements keyboard-navigable
- [ ] Focus trapped in open panel
- [ ] Focus restored to toggle on close
- [ ] Screen reader announces new messages
- [ ] ARIA attributes present (role, aria-label, aria-live, aria-expanded)
- [ ] Color contrast meets WCAG AA

### Security
- [ ] API key not visible in frontend source
- [ ] CORS rejects cross-origin requests
- [ ] Rate limiting enforced per IP
- [ ] System prompt not exposed to client

### Bot Behavior
- [ ] Responds accurately about skills listed in prompt
- [ ] Admits ignorance for topics not in prompt
- [ ] Suggests email after ~4 exchanges
- [ ] Shares email immediately if asked
- [ ] Uses "Chatbot Intro:" subject line format
- [ ] Tone is warm, professional, not pushy
- [ ] Never fabricates experiences or skills
- [ ] Handles off-topic questions gracefully

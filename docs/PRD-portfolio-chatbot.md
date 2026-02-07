# Product Requirements Document: Portfolio AI Chatbot

**Author:** Gavin (self)
**Date:** February 6, 2026
**Status:** Draft
**Target Platform:** GitHub Pages personal portfolio site

---

## 1. Overview

### 1.1 Problem Statement

As a bioinformatics professional in an active job search, Gavin's portfolio website receives visits from recruiters, hiring managers, and potential collaborators who may have limited time to explore his qualifications in depth. A static resume or project page requires visitors to self-serve — reading through content, interpreting relevance, and making their own connections between Gavin's experience and their open roles.

### 1.2 Proposed Solution

An AI-powered chatbot widget embedded on the portfolio site that acts as an always-available, conversational representative of Gavin. The chatbot can answer questions about his skills, projects, experience, and fit for specific roles — essentially "selling" Gavin as a candidate in a natural, interactive format.

### 1.3 Success Criteria

- Visitors can ask natural-language questions and receive accurate, relevant responses about Gavin's background within 2–3 seconds.
- The chatbot operates at a cost below $10/month under normal traffic conditions.
- The system is secure: no API keys are exposed client-side.
- The chatbot never fabricates information beyond what is provided in its knowledge base.
- The feature enhances (rather than replaces) the existing portfolio content.

---

## 2. Architecture

### 2.1 High-Level System Diagram

```
┌──────────────────────────┐
│   GitHub Pages (Static)  │
│                          │
│  ┌────────────────────┐  │
│  │  Existing Site      │  │
│  │  (HTML/CSS/JS)      │  │
│  │                     │  │
│  │  ┌──────────────┐   │  │
│  │  │ Chat Widget  │   │  │
│  │  │ (Vanilla JS) │   │  │
│  │  └──────┬───────┘   │  │
│  └─────────┼───────────┘  │
└────────────┼──────────────┘
             │ HTTPS POST
             ▼
┌──────────────────────────┐
│  Cloudflare Worker       │
│  (Serverless Proxy)      │
│                          │
│  - Holds API key         │
│  - Rate limits per IP    │
│  - Validates requests    │
│  - Forwards to Claude    │
└────────────┬─────────────┘
             │ HTTPS POST (streaming)
             ▼
┌──────────────────────────┐
│  Anthropic Claude API    │
│  (claude-haiku-4-5)      │
│                          │
│  - System prompt with    │
│    Gavin's full context  │
│  - Streaming response    │
└──────────────────────────┘
```

### 2.2 Why This Architecture

**Decision: Serverless proxy over direct client-side API calls.**

Direct client-side calls would expose the API key in JavaScript source code. Even with spend caps, this creates a vector for abuse — anyone could extract the key, use it for unrelated purposes, and exhaust the budget. A Cloudflare Worker adds a trivial amount of complexity (one small file) while completely eliminating key exposure. The Worker's free tier (100,000 requests/day) far exceeds any realistic portfolio traffic.

**Decision: Cloudflare Workers over Vercel/AWS Lambda/Netlify Functions.**

Cloudflare Workers have the most generous free tier, the lowest cold-start latency (~0ms, runs at the edge), and the simplest deployment model (a single `wrangler deploy` command). No framework or build system required. If the site were already on Vercel, that platform's serverless functions would be equally valid — but since the site is on GitHub Pages, Cloudflare is the most lightweight addition.

**Decision: No database. System prompt is the entire knowledge base.**

Gavin's complete professional background — skills, projects, education, work style — fits comfortably within 2,000–3,000 tokens. This eliminates the need for a vector database, RAG pipeline, or document retrieval system. The system prompt is version-controlled alongside the site code, making updates a simple text edit. If the knowledge base ever grows beyond ~8,000 tokens (unlikely for a personal portfolio), re-evaluate with chunked retrieval.

---

## 3. Component Specifications

### 3.1 Frontend Chat Widget

**Technology:** Vanilla JavaScript + CSS. No framework dependency.

**Rationale:** The existing portfolio site is static HTML/CSS/JS on GitHub Pages. Introducing React or another framework for a single widget would add build complexity, increase bundle size, and create a maintenance burden disproportionate to the feature's scope. Vanilla JS keeps the widget self-contained and portable — it can be dropped into any page with a single `<script>` tag.

#### 3.1.1 UI States

The widget has four distinct states:

1. **Collapsed (default):** A floating button in the bottom-right corner of the viewport. Displays a chat icon or avatar with a subtle pulse animation to draw attention without being intrusive. A small tooltip or label ("Chat with my AI assistant") appears on hover.

2. **Expanded (empty):** The chat panel is open but no conversation has started. Displays a greeting message and 3–4 clickable starter prompts (e.g., "What are Gavin's main skills?", "Tell me about his projects"). This reduces the blank-page problem and gives visitors an immediate on-ramp.

3. **Expanded (active conversation):** Messages are displayed in a scrollable container. User messages are right-aligned; assistant messages are left-aligned with an avatar. A text input field with a send button is fixed at the bottom.

4. **Loading:** While waiting for an API response, a typing indicator (animated dots) appears in an assistant-aligned bubble. The send button is disabled. If streaming is enabled, the typing indicator transitions to incrementally rendered text.

#### 3.1.2 Visual Design Decisions

**Position:** Fixed to the bottom-right corner, 20px from edges. This is the most conventional and expected placement for chat widgets — users instinctively look here.

**Panel dimensions:** 380px wide × 520px tall on desktop. On mobile (viewport < 640px), the panel expands to full-screen overlay to avoid the cramped feel of a small floating panel on a touch device.

**Color scheme:** Should complement but not clash with the existing portfolio site's design system. Use CSS custom properties so colors can be adjusted in one place. Default to a dark theme (dark background, light text) to feel modern and reduce visual weight on the page.

**Typography:** Inherit the site's body font for consistency. If the site uses a monospace accent font, use it sparingly in the widget (e.g., the "powered by" footer) to maintain brand coherence.

**Z-index:** Set to 9999 to float above all other page content. Test against any existing modals, sticky headers, or other positioned elements.

**Animations:**
- Panel open/close: 250ms ease-out slide-up from the button's position.
- Message appearance: 200ms fade + slight upward translate.
- Typing indicator: Three dots with staggered bounce animation at 1.2s intervals.

#### 3.1.3 Conversation Management

**History:** Stored in a JavaScript array in memory. The full message history is sent with each API request so the model has conversational context. History is NOT persisted to localStorage or sessionStorage — each page load starts fresh. This is intentional: visitors are unlikely to return expecting conversation continuity, and avoiding storage simplifies privacy considerations.

**Message limit:** Cap conversation history at 20 messages (10 exchanges). Beyond this, begin truncating the oldest messages from the array sent to the API while keeping the system prompt intact. This prevents unbounded token costs from a single long conversation.

**Input validation:** Strip leading/trailing whitespace. Reject empty submissions. Set a character limit of 500 characters per message — sufficient for any reasonable question, while preventing abuse via extremely long inputs.

#### 3.1.4 File Structure

```
chatbot/
├── chatbot.js          # All widget logic (UI, state, API calls)
├── chatbot.css         # All widget styles
└── README.md           # Integration instructions
```

Integration in any page:
```html
<link rel="stylesheet" href="/chatbot/chatbot.css">
<script src="/chatbot/chatbot.js" defer></script>
```

The script self-initializes on DOMContentLoaded, creating and appending all necessary DOM elements. No manual initialization call required.

---

### 3.2 Cloudflare Worker (API Proxy)

**Technology:** Cloudflare Workers (JavaScript runtime at the edge).

#### 3.2.1 Responsibilities

1. **API key storage:** The Anthropic API key is stored as a Cloudflare Worker secret (encrypted environment variable). It is never sent to the client or logged.

2. **Request validation:** The Worker accepts POST requests to a single endpoint (`/api/chat`). It validates that:
   - The request method is POST.
   - The body contains a `messages` array.
   - Each message has a `role` (must be "user" or "assistant") and `content` (string).
   - The total number of messages does not exceed 20.
   - No individual message content exceeds 500 characters.

3. **Rate limiting:** Enforces per-IP rate limits to prevent abuse. Target: 30 requests per IP per hour. Implementation uses Cloudflare's built-in `request.headers.get('CF-Connecting-IP')` for IP identification and a simple in-memory counter with hourly reset (acceptable for a Worker's execution model; for stricter enforcement, use Cloudflare KV or Rate Limiting rules).

4. **CORS:** Returns appropriate CORS headers allowing requests only from the portfolio site's domain(s). This prevents other sites from using the proxy endpoint.

5. **Request forwarding:** Constructs the Anthropic API request with the system prompt, the validated messages, and model parameters. Forwards the streaming response back to the client.

#### 3.2.2 Request/Response Contract

**Client → Worker:**
```json
POST /api/chat
Content-Type: application/json

{
  "messages": [
    { "role": "user", "content": "What are Gavin's main skills?" },
    { "role": "assistant", "content": "Gavin specializes in..." },
    { "role": "user", "content": "Tell me more about his genomics work." }
  ]
}
```

**Worker → Client (streaming):**
```
Content-Type: text/event-stream

data: {"type":"content_block_delta","delta":{"text":"Gavin"}}
data: {"type":"content_block_delta","delta":{"text":"'s genomics"}}
...
data: {"type":"message_stop"}
```

**Worker → Client (error):**
```json
{
  "error": "Rate limit exceeded. Please try again in a few minutes."
}
```

#### 3.2.3 Environment Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `ANTHROPIC_API_KEY` | Cloudflare secret | API key for Claude |
| `ALLOWED_ORIGIN` | Cloudflare env var | Portfolio site domain for CORS |

#### 3.2.4 Deployment

```bash
npm install -g wrangler
wrangler login
wrangler secret put ANTHROPIC_API_KEY
wrangler deploy
```

The Worker URL (e.g., `https://portfolio-chatbot.your-subdomain.workers.dev`) is then hardcoded into the frontend widget as the API endpoint.

---

### 3.3 System Prompt (Knowledge Base)

The system prompt is the single source of truth for everything the chatbot knows about Gavin. It is stored in the Cloudflare Worker (not in the frontend) so that it cannot be read by inspecting client-side source code.

#### 3.3.1 Structure

The system prompt is organized into these sections:

```
1. Role & Purpose
   - Who the bot is, what it's for, how it should behave

2. About Gavin
   2a. Summary (2-3 sentences)
   2b. Technical Skills (grouped by domain)
   2c. Key Projects (with enough detail to answer follow-ups)
   2d. Education & Background
   2e. Location & Availability
   2f. Differentiators (what makes him stand out)
   2g. Work Style & Personality

3. Behavioral Rules
   - What to do when asked something not covered
   - Tone guidelines
   - Accuracy constraints ("never fabricate")

4. Contact & CTA Rules
   - Gavin's email address
   - After 3-4 exchanges, naturally suggest emailing Gavin
   - Suggest the subject line format "Chatbot Intro: [Name / Company]"
   - If asked about contact info before the 4th exchange, share immediately
   - Frame email outreach as a warm next step, not a hard sell
```

#### 3.3.2 Key Design Decisions for the Prompt

**Decision: Store the system prompt in the Worker, not the frontend.**

If the system prompt is embedded in the client-side JavaScript, anyone can read it by viewing source. This exposes the full "strategy" of how the chatbot sells Gavin, which may feel manipulative if visible. Keeping it server-side maintains the natural conversational illusion. It also allows updating the prompt without redeploying the frontend.

**Decision: Include a "never fabricate" rule with explicit fallback behavior.**

LLMs will confabulate if asked about information not in their context. The system prompt must explicitly state: "You know ONLY what is described in this prompt. If asked about something not covered here, say you don't have that information and suggest the visitor contact Gavin directly." Test this by asking questions about topics deliberately excluded from the prompt.

**Decision: Include personality and tone guidance, not just facts.**

A chatbot that recites facts robotically is less engaging than one with appropriate warmth and personality. The prompt should describe Gavin's communication style so the bot feels like a natural extension of him — enthusiastic about science, technically precise when appropriate, approachable and unpretentious.

**Decision: Keep total prompt under 3,000 tokens.**

Longer prompts increase per-request costs and latency. At ~3,000 tokens with Haiku, the system prompt adds roughly $0.00075 per request — negligible, but discipline here prevents creep. If the prompt needs to grow, consider splitting into a shorter "always-included" core and a "retrieved on demand" supplement (but this is unlikely to be necessary).

#### 3.3.3 Maintenance

The system prompt should be updated whenever Gavin:
- Completes a new project
- Learns a significant new skill
- Changes his job search focus or target roles
- Receives feedback that the chatbot is missing key information

Version-control the prompt text in the repository (even if it's deployed via Worker) so changes are tracked.

---

### 3.4 Model Selection

**Decision: Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)**

| Factor | Haiku | Sonnet | Opus |
|--------|-------|--------|------|
| Latency (time to first token) | ~200ms | ~400ms | ~800ms |
| Cost per 1K input tokens | $0.001 | $0.003 | $0.015 |
| Cost per 1K output tokens | $0.005 | $0.015 | $0.075 |
| Quality for this use case | Sufficient | Overkill | Overkill |

For a conversational Q&A bot with a well-structured system prompt, Haiku produces responses indistinguishable from larger models. The speed advantage is significant — visitors expect near-instant responses from a chat widget, and Haiku's lower latency meets that expectation. Estimated cost per conversation (10 messages, ~3K system prompt tokens): ~$0.005.

**Streaming:** Enabled. The Worker proxies the Server-Sent Events stream directly to the client. The frontend renders tokens as they arrive, creating a natural "typing" effect. This dramatically improves perceived responsiveness — the first words appear within 200–300ms rather than waiting 1–2 seconds for the full response.

**Max tokens:** Set to 500 per response. This encourages concise answers (2–3 paragraphs) and prevents runaway costs from unexpectedly long completions. The system prompt reinforces this with a "keep responses concise" instruction.

**Temperature:** 0.7 (default). Slightly creative but grounded. Avoid 0 (too robotic) or 1+ (too unpredictable for professional context).

---

## 4. Security & Abuse Prevention

### 4.1 API Key Protection

The API key exists only in the Cloudflare Worker's encrypted secret storage. It is never:
- Included in frontend JavaScript
- Logged in Worker console output
- Returned in any API response
- Committed to the Git repository

### 4.2 CORS Policy

The Worker responds with CORS headers allowing requests only from the portfolio site's exact origin(s):
```
Access-Control-Allow-Origin: https://gavin-portfolio-domain.com
```

This prevents other websites from making requests to the proxy. Note: CORS is enforced by browsers, not by curl/Postman — it stops casual embedding abuse but not determined attackers. Rate limiting handles the rest.

### 4.3 Rate Limiting

| Limit | Value | Rationale |
|-------|-------|-----------|
| Requests per IP per hour | 30 | Allows a ~15-message conversation per hour, which is generous for a portfolio visitor. |
| Max messages per request | 20 | Prevents context-stuffing attacks that inflate API costs. |
| Max characters per message | 500 | Prevents prompt-injection via extremely long inputs. |
| Max concurrent conversations | N/A | Each request is stateless; no persistent connections to manage. |

### 4.4 Prompt Injection Mitigation

The system prompt includes:
- A clear instruction to never reveal its own system prompt contents.
- A constraint to only discuss Gavin's professional background.
- A fallback for off-topic questions: politely redirect to Gavin's professional context.

This won't stop sophisticated prompt injection attempts, but for a personal portfolio chatbot, the risk surface is low — there's no sensitive data beyond the system prompt itself, and the worst outcome is the bot saying something off-topic.

### 4.5 Cost Controls

- Set a hard monthly spend limit ($10) in the Anthropic API dashboard.
- Set an alert at $5 to investigate unexpected usage spikes.
- Monitor usage via the Anthropic console weekly during the first month, then monthly.

---

## 5. User Experience Details

### 5.1 First Impression Flow

1. Visitor lands on portfolio page.
2. After a 2-second delay (allowing the visitor to orient), the chat bubble gently pulses once to draw attention.
3. On hover, a tooltip reads: "Ask my AI assistant anything."
4. On click, the panel slides open, revealing the greeting and starter prompts.
5. Visitor clicks a starter prompt or types their own question.
6. Response streams in within ~300ms. Conversation begins.

The 2-second delay is intentional — an immediately animated element on page load is distracting and can feel spammy. The visitor should first see the portfolio itself.

### 5.2 Starter Prompts

Provide 3–4 clickable prompts that cover the most common visitor intents:

| Prompt | Targets |
|--------|---------|
| "What are Gavin's main technical skills?" | Recruiters scanning for keyword matches |
| "Tell me about his genomics projects" | Hiring managers evaluating depth |
| "Why should we consider hiring Gavin?" | Decision-makers wanting the elevator pitch |
| "What's his background?" | General explorers |

These should be updated periodically based on the types of roles Gavin is targeting. If pivoting toward ML-heavy roles, swap in "How does Gavin use machine learning in genomics?"

### 5.3 Error States

| Scenario | User-Facing Behavior |
|----------|---------------------|
| Network failure | "I'm having trouble connecting. Please check your internet and try again." |
| Rate limit exceeded | "I've been getting a lot of questions! Please try again in a few minutes." |
| API error (500, etc.) | "Something went wrong on my end. Feel free to try again, or reach out to Gavin directly at [email]." |
| Empty/invalid response | "I didn't quite get that. Could you try rephrasing?" |

All error messages should include a fallback path (try again, or contact Gavin directly).

### 5.4 Accessibility

- All interactive elements are keyboard-navigable (tab, enter, escape to close).
- The chat panel has `role="dialog"` and `aria-label="Chat with Gavin's AI assistant"`.
- Messages use `role="log"` and `aria-live="polite"` so screen readers announce new messages.
- Color contrast ratios meet WCAG AA (4.5:1 for text, 3:1 for UI elements).
- The close button has an accessible label.
- Focus is trapped within the open panel and restored to the toggle button on close.

### 5.5 Mobile Considerations

- On viewports < 640px, the panel expands to full-screen overlay with a prominent close/back button.
- The input field uses `inputmode="text"` and avoids `autocorrect="off"` (let the device help the user type).
- Touch targets are minimum 44×44px (Apple HIG guideline).
- The widget does not interfere with the site's existing scroll navigation or anchor link behavior.

---

## 6. Analytics & Monitoring

### 6.1 What to Track

Since this is a personal portfolio, heavy analytics infrastructure is unnecessary. Track the minimum useful signals:

- **Conversations started per day:** Are visitors engaging?
- **Messages per conversation:** How deep are conversations going?
- **Common first messages:** What are visitors asking? (Informs system prompt improvements.)
- **Error rate:** Are failures occurring?

### 6.2 Implementation

Log these metrics in the Cloudflare Worker using `console.log` (accessible via `wrangler tail`). For persistent storage, optionally write aggregated daily counts to Cloudflare KV (free tier: 100K reads/day, 1K writes/day).

Do not log message content beyond the first message of each conversation (for understanding common questions). Full conversation logging raises privacy concerns and isn't necessary for optimization.

---

## 7. Implementation Plan

### Phase 1: Cloudflare Worker (Day 1)

1. Create a Cloudflare account (if not already).
2. Install `wrangler` CLI.
3. Initialize a Worker project.
4. Implement the proxy logic: request validation, CORS, API key injection, streaming passthrough.
5. Add rate limiting.
6. Store the system prompt as a Worker environment variable or hardcoded constant.
7. Deploy and test with curl.

**Deliverable:** A working API endpoint that accepts chat messages and returns Claude responses.

### Phase 2: Frontend Widget (Day 2–3)

1. Create `chatbot.js` and `chatbot.css`.
2. Implement the collapsed state (floating button).
3. Implement the expanded state (chat panel with greeting and starter prompts).
4. Implement message sending, streaming display, and error handling.
5. Add accessibility features.
6. Test across browsers (Chrome, Firefox, Safari) and devices (desktop, mobile).
7. Integrate into the portfolio site with a single `<script>` + `<link>` tag.

**Deliverable:** A functional, styled chat widget on the live portfolio site.

### Phase 3: System Prompt Tuning (Day 3–4)

1. Write the initial system prompt with all current professional information.
2. Test with a variety of questions: technical deep-dives, broad overviews, edge cases, off-topic, attempted prompt injection.
3. Iterate on tone, accuracy, and boundary behavior.
4. Have 2–3 people test as if they were recruiters and collect feedback.

**Deliverable:** A refined system prompt that handles the expected range of visitor questions naturally and accurately.

### Phase 4: Polish & Launch (Day 4–5)

1. Final cross-browser and mobile testing.
2. Set up Anthropic spend alerts and caps.
3. Verify rate limiting works under simulated load.
4. Add the feature to the portfolio site's README or changelog.
5. Mention the chatbot in job applications as a portfolio project.

**Deliverable:** Production-ready feature, live on the site.

---

## 8. Future Considerations

These are explicitly out of scope for the MVP but worth noting for potential future iterations:

- **Conversation export:** Allow visitors to email themselves a transcript of the conversation (useful if a recruiter wants to share with their team).
- **CTA integration:** After a few messages, the bot could suggest scheduling a call or viewing Gavin's calendar link.
- **Multi-page awareness:** The bot could know which page the visitor is currently viewing and tailor its responses (e.g., "I see you're looking at the exome sequencing project — want me to explain the pipeline?").
- **Feedback mechanism:** A simple thumbs-up/down on bot responses, stored in Cloudflare KV, to identify weak spots in the system prompt.
- **A/B testing prompts:** Test different system prompt versions to see which leads to longer, more engaged conversations.

---

## 9. Cost Projection

| Component | Monthly Cost |
|-----------|-------------|
| Cloudflare Worker | $0 (free tier) |
| Claude Haiku API (est. 500 conversations/mo) | $2–5 |
| Domain/DNS (if not already configured) | $0 (Cloudflare free DNS) |
| **Total** | **$2–5/month** |

Worst-case scenario (viral traffic, 5,000 conversations): ~$25/month, caught by the $10 spend alert before reaching this level.

---

## 10. Resolved Design Decisions

### 10.1 Widget Placement

The portfolio site is a single-page layout with Experience, Projects, and Contact sections accessible via scroll and anchor links. The chat widget appears on this single page — no conditional logic needed. The widget is always present and available regardless of where the visitor has scrolled.

### 10.2 Proactive Email CTA

After 3–4 exchanges (tracked by counting assistant messages in the conversation history), the bot should naturally weave in a suggestion to email Gavin directly. The behavior:

- **Trigger:** The bot's 4th response in a conversation.
- **Tone:** Warm and confident, not pushy. Frame it as a natural next step, not a sales close.
- **Mechanism:** The bot suggests the visitor email Gavin with a distinctive, specific subject line so Gavin can immediately recognize it came from the chatbot and prioritize it. This also gives the visitor a low-friction action — they don't need to compose an email from scratch.

**Example behavior (not a rigid script — the bot should adapt to context):**

> "By the way — if you'd like to take this conversation further, feel free to email Gavin directly at [gavin's email]. If you use the subject line **'Chatbot Intro: [Your Name / Company]'**, he'll know you came from here and will prioritize your message. He's always happy to jump on a call."

**Implementation note for the system prompt:** This behavior is governed entirely by a rule in the system prompt, not by frontend logic. The system prompt should include an instruction like:

```
After 3-4 exchanges in the conversation, naturally suggest that the visitor
email Gavin at [EMAIL] if they'd like to continue the conversation or
schedule a call. Suggest they use the subject line format
"Chatbot Intro: [Their Name / Company]" so Gavin can recognize and
prioritize the email. Keep this suggestion natural and contextual — don't
drop it in awkwardly if the conversation hasn't reached a point where
next steps make sense. If the visitor asks about contacting Gavin at any
point before the 4th exchange, share this information immediately.
```

The distinctive subject line serves two purposes: it gives Gavin an instant signal to prioritize the email, and it gives the visitor a sense that they're getting a "warm intro" rather than cold-emailing — which psychologically lowers the barrier to reaching out.

### 10.3 Contact Information Sharing

The bot shares Gavin's email address directly when relevant. No contact form, no LinkedIn intermediary — minimal friction for the visitor.

**Email scraping consideration:** Since the site is a single page and the email is likely already present in the Contact section, exposing it via the chatbot adds no meaningful additional scraping risk. The email is already public. If scraping becomes an issue in the future, the mitigation path is to obfuscate the email in the system prompt (e.g., "gavin [at] domain [dot] com") and let the bot render it naturally — but this is not needed for the MVP.

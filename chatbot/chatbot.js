/**
 * Portfolio Chatbot Widget
 * A self-contained chat widget that connects to a Cloudflare Worker proxy
 */

(function () {
  'use strict';

  // ─── CONFIGURATION ───
  const CONFIG = {
    // UPDATE THIS after deploying the Worker
    workerUrl: 'https://portfolio-chatbot-proxy.portfolio-chatbot-proxy.workers.dev',
    maxMessages: 20,
    maxInputLength: 750,
    starterPrompts: [
      "What are Gavin's technical skills?",
      "Tell me about his ML research",
      "What makes him stand out?",
      "What's his background?"
    ]
  };

  // ─── STATE ───
  let messages = [];
  let isOpen = false;
  let isLoading = false;
  let elements = {};

  // ─── DOM CREATION ───
  function createWidget() {
    // Create container
    const container = document.createElement('div');
    container.className = 'chatbot-widget';
    container.setAttribute('role', 'complementary');
    container.setAttribute('aria-label', 'Chat with AI assistant');

    // Toggle button
    const toggle = document.createElement('button');
    toggle.className = 'chatbot-toggle';
    toggle.setAttribute('aria-label', 'Open chat');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = `
      <span class="chatbot-toggle-icon">💬</span>
      <span class="chatbot-toggle-tooltip">Chat with my AI assistant</span>
    `;

    // Chat panel
    const panel = document.createElement('div');
    panel.className = 'chatbot-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', "Chat with Gavin's AI assistant");
    panel.setAttribute('aria-hidden', 'true');

    panel.innerHTML = `
      <div class="chatbot-header">
        <div class="chatbot-header-info">
          <div class="chatbot-avatar">G</div>
          <div class="chatbot-header-text">
            <h3>Gavin's Assistant</h3>
            <p>Ask me anything</p>
          </div>
        </div>
        <button class="chatbot-close" aria-label="Close chat">&times;</button>
      </div>
      <div class="chatbot-messages" role="log" aria-live="polite" aria-label="Chat messages">
        <div class="chatbot-welcome">
          <div class="chatbot-welcome-icon">👋</div>
          <h4>Hi there!</h4>
          <p>I'm an AI assistant that can tell you about Gavin's experience and skills. How can I help?</p>
          <div class="chatbot-starters"></div>
        </div>
      </div>
      <div class="chatbot-input-area">
        <input
          type="text"
          class="chatbot-input"
          placeholder="Type a message..."
          maxlength="${CONFIG.maxInputLength}"
          aria-label="Type a message"
        />
        <button class="chatbot-send" aria-label="Send message">
          <span class="chatbot-send-icon">➤</span>
        </button>
      </div>
    `;

    container.appendChild(toggle);
    container.appendChild(panel);
    document.body.appendChild(container);

    // Store element references
    elements = {
      container,
      toggle,
      panel,
      header: panel.querySelector('.chatbot-header'),
      closeBtn: panel.querySelector('.chatbot-close'),
      messagesContainer: panel.querySelector('.chatbot-messages'),
      welcome: panel.querySelector('.chatbot-welcome'),
      starters: panel.querySelector('.chatbot-starters'),
      input: panel.querySelector('.chatbot-input'),
      sendBtn: panel.querySelector('.chatbot-send')
    };

    // Create starter prompt buttons
    createStarterButtons();

    // Bind events
    bindEvents();

    // Pulse animation after delay
    setTimeout(() => {
      toggle.classList.add('pulse');
    }, 2000);
  }

  function createStarterButtons() {
    CONFIG.starterPrompts.forEach(prompt => {
      const btn = document.createElement('button');
      btn.className = 'chatbot-starter';
      btn.textContent = prompt;
      btn.addEventListener('click', () => handleStarterClick(prompt));
      elements.starters.appendChild(btn);
    });
  }

  // ─── EVENT BINDING ───
  function bindEvents() {
    elements.toggle.addEventListener('click', togglePanel);
    elements.closeBtn.addEventListener('click', closePanel);
    elements.sendBtn.addEventListener('click', handleSend);

    elements.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        closePanel();
      }
    });

    // Focus trap when panel is open
    elements.panel.addEventListener('keydown', handleFocusTrap);
  }

  // ─── PANEL TOGGLE ───
  function togglePanel() {
    if (isOpen) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function openPanel() {
    isOpen = true;
    elements.panel.classList.add('open');
    elements.panel.setAttribute('aria-hidden', 'false');
    elements.toggle.setAttribute('aria-expanded', 'true');
    elements.toggle.classList.remove('pulse');

    // Focus input or first starter
    setTimeout(() => {
      if (messages.length === 0) {
        const firstStarter = elements.starters.querySelector('.chatbot-starter');
        if (firstStarter) firstStarter.focus();
      } else {
        elements.input.focus();
      }
    }, 100);
  }

  function closePanel() {
    isOpen = false;
    elements.panel.classList.remove('open');
    elements.panel.setAttribute('aria-hidden', 'true');
    elements.toggle.setAttribute('aria-expanded', 'false');
    elements.toggle.focus();
  }

  // ─── FOCUS TRAP ───
  function handleFocusTrap(e) {
    if (e.key !== 'Tab') return;

    const focusable = elements.panel.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // ─── MESSAGE HANDLING ───
  function handleStarterClick(text) {
    hideWelcome();
    sendMessage(text);
  }

  function handleSend() {
    const text = elements.input.value.trim();
    if (!text || isLoading) return;

    if (messages.length === 0) {
      hideWelcome();
    }

    elements.input.value = '';
    sendMessage(text);
  }

  function hideWelcome() {
    elements.welcome.style.display = 'none';
  }

  async function sendMessage(text) {
    if (isLoading) return;

    // Add user message
    messages.push({ role: 'user', content: text });
    renderMessage('user', text);

    // Truncate history if needed
    while (messages.length > CONFIG.maxMessages) {
      messages.shift();
    }

    // Show loading state
    isLoading = true;
    setInputEnabled(false);
    const typingEl = showTypingIndicator();

    try {
      const response = await fetchStream(messages);
      messages.push({ role: 'assistant', content: response });
    } catch (error) {
      console.error('Chat error:', error);
      showError(error.message || 'Something went wrong. Please try again.');
    } finally {
      hideTypingIndicator(typingEl);
      isLoading = false;
      setInputEnabled(true);
      elements.input.focus();
    }
  }

  // ─── API COMMUNICATION ───
  async function fetchStream(messageHistory) {
    const response = await fetch(CONFIG.workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages: messageHistory }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Request failed with status ${response.status}`);
    }

    // Create assistant message bubble for streaming
    const messageEl = renderMessage('assistant', '');
    const contentEl = messageEl.querySelector('.chatbot-message-content');
    let fullText = '';

    // Read the SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;

        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);

          // Handle content deltas
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            fullText += parsed.delta.text;
            contentEl.textContent = fullText;
            scrollToBottom();
          }

          // Handle errors from the API
          if (parsed.type === 'error') {
            throw new Error(parsed.error?.message || 'API error');
          }
        } catch (parseError) {
          // Ignore parse errors for non-JSON lines
          if (parseError.message !== 'API error') continue;
          throw parseError;
        }
      }
    }

    // Handle any remaining buffer
    if (buffer.startsWith('data: ')) {
      const data = buffer.slice(6);
      if (data !== '[DONE]') {
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            fullText += parsed.delta.text;
            contentEl.textContent = fullText;
          }
        } catch {
          // Ignore
        }
      }
    }

    if (!fullText) {
      throw new Error("I didn't receive a response. Please try again.");
    }

    return fullText;
  }

  // ─── UI RENDERING ───
  function renderMessage(role, content) {
    const messageEl = document.createElement('div');
    messageEl.className = `chatbot-message ${role}`;

    const avatar = role === 'user' ? '👤' : 'G';

    messageEl.innerHTML = `
      <div class="chatbot-message-avatar">${avatar}</div>
      <div class="chatbot-message-content">${escapeHtml(content)}</div>
    `;

    elements.messagesContainer.appendChild(messageEl);
    scrollToBottom();

    return messageEl;
  }

  function showError(message) {
    const messageEl = document.createElement('div');
    messageEl.className = 'chatbot-message assistant error';

    messageEl.innerHTML = `
      <div class="chatbot-message-avatar">!</div>
      <div class="chatbot-message-content">
        ${escapeHtml(message)}
        <br><br>
        <small>Feel free to reach out to Gavin directly at gavin.cola@gmail.com</small>
      </div>
    `;

    elements.messagesContainer.appendChild(messageEl);
    scrollToBottom();
  }

  function showTypingIndicator() {
    const typingEl = document.createElement('div');
    typingEl.className = 'chatbot-message assistant';
    typingEl.innerHTML = `
      <div class="chatbot-message-avatar">G</div>
      <div class="chatbot-typing">
        <div class="chatbot-typing-dot"></div>
        <div class="chatbot-typing-dot"></div>
        <div class="chatbot-typing-dot"></div>
      </div>
    `;

    elements.messagesContainer.appendChild(typingEl);
    scrollToBottom();

    return typingEl;
  }

  function hideTypingIndicator(el) {
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }

  function setInputEnabled(enabled) {
    elements.input.disabled = !enabled;
    elements.sendBtn.disabled = !enabled;
  }

  function scrollToBottom() {
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
  }

  // ─── UTILITIES ───
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ─── INITIALIZATION ───
  function init() {
    createWidget();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

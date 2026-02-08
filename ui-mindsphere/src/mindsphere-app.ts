import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import DOMPurify from "dompurify";
import { marked } from "marked";

import { GatewayBrowserClient, type GatewayEventFrame, type GatewayHelloOk } from "../../ui/src/ui/gateway.ts";
import { extractText } from "../../ui/src/ui/chat/message-extract.ts";
import {
  handleChatEvent,
  loadChatHistory,
  sendChatMessage,
  type ChatEventPayload,
  type ChatState,
} from "../../ui/src/ui/controllers/chat.ts";

import { loadSettings, saveSettings, type MsSettings } from "./storage.ts";

function parseTokenFromHash(): string | null {
  const hash = (window.location.hash ?? "").replace(/^#/, "");
  if (!hash) {
    return null;
  }
  const params = new URLSearchParams(hash);
  const token = params.get("token");
  return token && token.trim() ? token.trim() : null;
}

function renderMarkdownToHtml(text: string): string {
  const raw = marked.parse(text, { gfm: true, breaks: true }) as string;
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}

@customElement("mindsphere-app")
export class MindSphereApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
    }

    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }

    header {
      position: sticky;
      top: 0;
      z-index: 10;
      padding: 18px 20px;
      backdrop-filter: blur(14px);
      background: linear-gradient(180deg, rgba(5, 8, 16, 0.92), rgba(5, 8, 16, 0.55));
      border-bottom: 1px solid var(--border);
    }

    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 800;
      letter-spacing: 0.08em;
    }

    .logo {
      width: 32px;
      height: 32px;
      border-radius: 999px;
      background:
        radial-gradient(circle at 30% 30%, rgba(56, 189, 248, 0.9), transparent 55%),
        radial-gradient(circle at 70% 75%, rgba(29, 78, 216, 0.9), transparent 58%),
        radial-gradient(circle at 50% 50%, rgba(56, 189, 248, 0.25), rgba(29, 78, 216, 0.15));
      box-shadow:
        0 0 0 1px rgba(148, 163, 184, 0.16) inset,
        0 12px 36px rgba(29, 78, 216, 0.18);
    }

    .brand span {
      text-transform: uppercase;
      font-size: 13px;
      color: rgba(226, 232, 240, 0.9);
    }

    .status {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--muted);
      font-size: 12px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: rgba(12, 16, 32, 0.45);
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: rgba(148, 163, 184, 0.4);
      box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.08);
    }
    .dot.ok {
      background: var(--ok);
      box-shadow: 0 0 0 4px rgba(52, 211, 153, 0.12);
    }

    main {
      /* Full-bleed stage area (everything below the header). */
      /* We add bottom padding so content never sits under the fixed composer. */
      --composerH: 108px;

      padding: 0 0 var(--composerH) 0;
      display: block;
    }

    .stage {
      width: 100%;
      height: 100%;
      border: 0;
      border-radius: 0;
      background: linear-gradient(180deg, rgba(12, 16, 32, 0.65), rgba(12, 16, 32, 0.32));
      box-shadow: none;
      overflow: hidden;
      position: relative;
    }

    .sphereWrap {
      position: absolute;
      inset: 0;
      pointer-events: none;
      display: grid;
      place-items: center;
      opacity: 0.98;
      background: radial-gradient(900px 520px at 50% 45%, rgba(56, 189, 248, 0.10), transparent 62%);
      transition: opacity 240ms ease;
    }

    .sphereWrap.hidden {
      opacity: 0;
    }

    .sphere {
      width: min(380px, 55vw);
      aspect-ratio: 1/1;
      border-radius: 999px;
      background:
        radial-gradient(circle at 30% 25%, rgba(255, 255, 255, 0.75), rgba(255, 255, 255, 0) 26%),
        radial-gradient(circle at 25% 30%, rgba(56, 189, 248, 0.95), rgba(56, 189, 248, 0) 58%),
        radial-gradient(circle at 75% 75%, rgba(29, 78, 216, 0.95), rgba(29, 78, 216, 0) 60%),
        radial-gradient(circle at 50% 55%, rgba(14, 165, 233, 0.22), rgba(29, 78, 216, 0.18));
      box-shadow:
        0 0 0 1px rgba(148, 163, 184, 0.16) inset,
        0 40px 100px rgba(29, 78, 216, 0.24),
        0 18px 60px rgba(56, 189, 248, 0.16);
      filter: saturate(1.12);
      transform: translateY(0px);
      animation: float 5.8s ease-in-out infinite;
      position: relative;
    }

    .sphere::before {
      content: "";
      position: absolute;
      inset: -14%;
      border-radius: 999px;
      background:
        radial-gradient(circle at 50% 50%, rgba(56, 189, 248, 0.12), transparent 60%),
        radial-gradient(circle at 50% 50%, rgba(29, 78, 216, 0.10), transparent 68%);
      filter: blur(18px);
      animation: pulse 4.8s ease-in-out infinite;
    }

    .sphere::after {
      content: "";
      position: absolute;
      inset: -10%;
      border-radius: 999px;
      border: 1px solid rgba(56, 189, 248, 0.25);
      box-shadow: 0 0 26px rgba(56, 189, 248, 0.12);
      opacity: 0.85;
      mask-image: radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 1), rgba(0, 0, 0, 0) 70%);
    }

    @keyframes float {
      0%, 100% {
        transform: translateY(-6px);
      }
      50% {
        transform: translateY(10px);
      }
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 0.65;
        transform: scale(0.98);
      }
      50% {
        opacity: 0.95;
        transform: scale(1.03);
      }
    }

    .drawer {
      position: absolute;
      inset: 0;
      display: grid;
      grid-template-rows: 1fr;
      background: rgba(5, 8, 16, 0.45);
      backdrop-filter: blur(14px);
      transition: opacity 220ms ease, transform 220ms ease;
    }

    .drawer.closed {
      opacity: 0;
      transform: translateY(6px);
      pointer-events: none;
    }

    .drawer.open {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }

    .chat {
      padding: 22px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      overflow: auto;
      min-width: 0;
    }

    .emptyHint {
      position: relative;
      z-index: 2;
      margin: auto;
      max-width: 560px;
      padding: 16px 18px;
      border: 1px solid rgba(56, 189, 248, 0.12);
      border-radius: 16px;
      background: rgba(5, 8, 16, 0.35);
      backdrop-filter: blur(10px);
      color: rgba(226, 232, 240, 0.92);
      line-height: 1.35;
    }
    .emptyHint .title {
      font-weight: 800;
      letter-spacing: 0.02em;
    }
    .emptyHint .sub {
      margin-top: 6px;
      color: rgba(148, 163, 184, 0.92);
      font-size: 13px;
    }

    .msg {
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;
      z-index: 2;
    }

    .bubble {
      display: inline-block;
      max-width: 82ch;
      padding: 12px 14px;
      border-radius: 16px;
      border: 1px solid var(--border);
      background: rgba(12, 16, 32, 0.55);
      backdrop-filter: blur(12px);
      line-height: 1.35;
      font-size: 14px;
    }

    .bubble.user {
      margin-left: auto;
      background: linear-gradient(180deg, rgba(56, 189, 248, 0.18), rgba(12, 16, 32, 0.55));
      border-color: rgba(56, 189, 248, 0.22);
    }

    .bubble.assistant {
      margin-right: auto;
      border-color: rgba(29, 78, 216, 0.22);
    }

    .bubble .md :first-child { margin-top: 0; }
    .bubble .md :last-child { margin-bottom: 0; }
    .bubble .md p { margin: 0.35em 0; }
    .bubble .md code { 
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 0.95em;
      background: rgba(148, 163, 184, 0.12);
      padding: 0.14em 0.35em;
      border-radius: 8px;
    }
    .bubble .md pre {
      overflow: auto;
      background: rgba(2, 6, 23, 0.55);
      border: 1px solid rgba(148, 163, 184, 0.14);
      padding: 10px 12px;
      border-radius: 14px;
    }
    .bubble .md pre code { background: transparent; padding: 0; }

    .composer {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 20;
      padding: 14px 18px;
      border-top: 1px solid rgba(148, 163, 184, 0.16);
      background: linear-gradient(180deg, rgba(5, 8, 16, 0.35), rgba(5, 8, 16, 0.88));
      backdrop-filter: blur(14px);
    }

    .composerInner {
      width: min(1100px, 100%);
      margin: 0 auto;
      display: grid;
      grid-template-columns: 1fr 120px;
      gap: 12px;
      align-items: end;
    }

    .composerMeta {
      width: min(1100px, 100%);
      margin: 0 auto 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      color: rgba(148, 163, 184, 0.92);
      font-size: 12px;
    }

    textarea {
      width: 100%;
      resize: none;
      min-height: 46px;
      max-height: 140px;
      padding: 11px 12px;
      border-radius: 14px;
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: rgba(2, 6, 23, 0.52);
      color: var(--text);
      outline: none;
      font-size: 14px;
      line-height: 1.35;
    }

    textarea:focus {
      border-color: rgba(56, 189, 248, 0.34);
      box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.12);
    }

    button {
      height: 44px;
      min-width: 120px;
      padding: 0 14px;
      border-radius: 14px;
      border: 1px solid rgba(56, 189, 248, 0.30);
      background: linear-gradient(180deg, rgba(56, 189, 248, 0.28), rgba(29, 78, 216, 0.20));
      color: rgba(226, 232, 240, 0.96);
      font-weight: 700;
      cursor: pointer;
      justify-self: end;
    }

    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .mini {
      font-size: 12px;
      color: rgba(148, 163, 184, 0.95);
      padding: 0 2px;
    }

    .settings {
      margin-top: 10px;
      display: grid;
      gap: 10px;
      grid-template-columns: 1fr 1fr;
    }

    .field {
      display: grid;
      gap: 6px;
    }

    .field label {
      font-size: 11px;
      color: rgba(148, 163, 184, 0.92);
    }

    .field input {
      height: 40px;
      padding: 0 12px;
      border-radius: 12px;
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: rgba(2, 6, 23, 0.45);
      color: var(--text);
      outline: none;
      font-size: 13px;
    }

    .error {
      color: var(--danger);
      font-size: 12px;
    }

    @media (max-width: 900px) {
      .stage {
        height: min(76vh, 820px);
      }
      .sphere {
        width: min(300px, 76vw);
      }
      .settings { grid-template-columns: 1fr; }
      .bubble { max-width: 100%; }
    }
  `;

  @state() settings: MsSettings = loadSettings();
  @state() password = "";

  @state() client: GatewayBrowserClient | null = null;
  @state() connected = false;
  @state() hello: GatewayHelloOk | null = null;
  @state() lastError: string | null = null;

  @state() chatOpen = false;

  @state() chatLoading = false;
  @state() chatSending = false;
  @state() chatMessage = "";
  @state() chatMessages: unknown[] = [];
  @state() chatThinkingLevel: string | null = null;
  @state() chatRunId: string | null = null;
  @state() chatStream: string | null = null;
  @state() chatStreamStartedAt: number | null = null;

  private booted = false;

  connectedCallback(): void {
    super.connectedCallback();
    if (this.booted) {
      return;
    }
    this.booted = true;

    // Optional: accept token from URL fragment (#token=...)
    const tokenFromHash = parseTokenFromHash();
    if (tokenFromHash && tokenFromHash !== this.settings.token) {
      this.settings = { ...this.settings, token: tokenFromHash };
      saveSettings(this.settings);
    }

    this.connect();
  }

  private toChatState(): ChatState {
    return {
      client: this.client,
      connected: this.connected,
      sessionKey: this.settings.sessionKey,
      chatLoading: this.chatLoading,
      chatMessages: this.chatMessages,
      chatThinkingLevel: this.chatThinkingLevel,
      chatSending: this.chatSending,
      chatMessage: this.chatMessage,
      chatAttachments: [],
      chatRunId: this.chatRunId,
      chatStream: this.chatStream,
      chatStreamStartedAt: this.chatStreamStartedAt,
      lastError: this.lastError,
    };
  }

  private syncFromChatState(next: ChatState) {
    this.chatLoading = next.chatLoading;
    this.chatMessages = next.chatMessages;
    this.chatThinkingLevel = next.chatThinkingLevel;
    this.chatSending = next.chatSending;
    this.chatRunId = next.chatRunId;
    this.chatStream = next.chatStream;
    this.chatStreamStartedAt = next.chatStreamStartedAt;
    this.lastError = next.lastError;
  }

  private connect() {
    this.lastError = null;
    this.hello = null;
    this.connected = false;

    this.client?.stop();
    this.client = new GatewayBrowserClient({
      url: this.settings.gatewayUrl,
      token: this.settings.token.trim() ? this.settings.token : undefined,
      password: this.password.trim() ? this.password : undefined,
      // Reuse the canonical Control UI client id so the gateway schema accepts the connect.
      clientName: "openclaw-control-ui",
      mode: "webchat",
      onHello: (hello) => {
        this.connected = true;
        this.lastError = null;
        this.hello = hello;
        const st = this.toChatState();
        // normalize history load after reconnect
        st.chatRunId = null;
        st.chatStream = null;
        st.chatStreamStartedAt = null;
        this.syncFromChatState(st);
        void this.refreshHistory();
      },
      onClose: ({ code, reason }) => {
        this.connected = false;
        if (code !== 1012) {
          this.lastError = `disconnected (${code}): ${reason || "no reason"}`;
        }
      },
      onEvent: (evt) => this.handleGatewayEvent(evt),
      onGap: ({ expected, received }) => {
        this.lastError = `event gap detected (expected seq ${expected}, got ${received})`;
      },
    });

    this.client.start();
  }

  private handleGatewayEvent(evt: GatewayEventFrame) {
    if (evt.event !== "chat") {
      return;
    }
    const payload = evt.payload as ChatEventPayload | undefined;
    const st = this.toChatState();
    const state = handleChatEvent(st, payload);
    this.syncFromChatState(st);

    if (state === "final") {
      void this.refreshHistory();
    }
  }

  private async refreshHistory() {
    const st = this.toChatState();
    await loadChatHistory(st);
    this.syncFromChatState(st);
    await this.updateComplete;
    // Scroll to bottom
    const el = this.renderRoot?.querySelector<HTMLElement>(".chat") ?? null;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }

  private async onSend() {
    const st = this.toChatState();
    const runId = await sendChatMessage(st, this.chatMessage);
    this.chatMessage = "";
    this.syncFromChatState(st);
    if (runId) {
      await this.updateComplete;
      const el = this.renderRoot?.querySelector<HTMLElement>(".chat") ?? null;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }

  private renderMessages() {
    const msgs = Array.isArray(this.chatMessages) ? this.chatMessages : [];
    const hasAny = msgs.length > 0 || (this.chatStream && this.chatStream.trim());

    return html`
      <div class="chat">
        ${!hasAny
          ? html`<div class="emptyHint">
              <div class="title">MindSphere</div>
              <div class="sub">
                Connesso all'agente <code>main</code>. Scrivi un messaggio per iniziare.
              </div>
              <div class="sub">
                Suggerimenti: <span class="mini">"Riepilogami la giornata"</span> ·
                <span class="mini">"Cosa ho in inbox?"</span> ·
                <span class="mini">"Crea un evento"</span>
              </div>
            </div>`
          : nothing}

        ${msgs.map((m) => {
          const role = (m as { role?: unknown } | null)?.role === "user" ? "user" : "assistant";
          const text = extractText(m);
          const safeHtml = typeof text === "string" && text.trim() ? renderMarkdownToHtml(text) : "";
          if (!safeHtml) {
            return nothing;
          }
          return html`<div class="msg">
            <div class="bubble ${role}"><div class="md" .innerHTML=${safeHtml}></div></div>
          </div>`;
        })}

        ${this.chatStream
          ? html`<div class="msg">
              <div class="bubble assistant">
                <div class="md" .innerHTML=${renderMarkdownToHtml(this.chatStream)}></div>
              </div>
            </div>`
          : nothing}
      </div>
    `;
  }

  private onSettingsChange(patch: Partial<MsSettings>) {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
  }

  private renderSphereStatusLabel(): string | null {
    // When the chat is closed, show a small state label inside the sphere.
    if (this.chatOpen) {
      return null;
    }
    if (this.chatSending || this.chatRunId) {
      // If we already have deltas streaming, it's more like "thinking".
      if (this.chatStream && this.chatStream.trim()) {
        return "Thinking";
      }
      return "Working";
    }
    return null;
  }

  render() {
    const sphereStatus = this.renderSphereStatusLabel();

    return html`
      <div class="shell">
        <header>
          <div class="top">
            <div class="brand"><div class="logo"></div><span>MindSphere</span></div>
            <div class="status">
              <button
                class="pill"
                style="cursor:pointer"
                @click=${() => {
                  this.chatOpen = !this.chatOpen;
                  // When opening the drawer, refresh + scroll.
                  if (this.chatOpen) {
                    void this.refreshHistory();
                  }
                }}
                title=${this.chatOpen ? "Close chat" : "Open chat"}
              >
                <span>${this.chatOpen ? "Hide chat" : "Show chat"}</span>
              </button>
              <span class="pill">
                <span class="dot ${this.connected ? "ok" : ""}"></span>
                <span>${this.connected ? "Connected" : "Offline"}</span>
              </span>
              ${this.lastError ? html`<span class="error">${this.lastError}</span>` : nothing}
            </div>
          </div>
        </header>

        <main>
          <div class="stage">
            <div class="sphereWrap ${this.chatOpen ? "hidden" : ""}">
              ${sphereStatus
                ? html`<div
                    style="position:absolute; margin-bottom: 420px; font-weight:800; letter-spacing:0.12em; font-size:12px; color: rgba(226,232,240,0.9); text-transform:uppercase;"
                  >
                    ${sphereStatus}
                  </div>`
                : nothing}
              <div class="sphere"></div>
            </div>

            <div class="drawer ${this.chatOpen ? "open" : "closed"}">
              ${this.renderMessages()}
            </div>
          </div>

          <div class="settings" style="width:min(1100px,100%); margin-top: 14px; display:none;">
            <div class="field">
              <label>Gateway WS URL</label>
              <input
                .value=${this.settings.gatewayUrl}
                @change=${(e: Event) => this.onSettingsChange({ gatewayUrl: (e.target as HTMLInputElement).value })}
              />
            </div>
            <div class="field">
              <label>Session Key (defaults to agent:main:main)</label>
              <input
                .value=${this.settings.sessionKey}
                @change=${(e: Event) => this.onSettingsChange({ sessionKey: (e.target as HTMLInputElement).value })}
              />
            </div>
          </div>
        </main>

        <div class="composer">
          <div class="composerMeta">
            <span>
              ${this.chatSending || this.chatRunId
                ? this.chatStream && this.chatStream.trim()
                  ? "Thinking…"
                  : "Working…"
                : "Ready"}
            </span>
            <span class="mini">Ctrl/Cmd+Enter to send</span>
          </div>
          <div class="composerInner">
            <textarea
              .value=${this.chatMessage}
              placeholder="Scrivi a MindSphere…"
              ?disabled=${!this.connected || this.chatSending}
              @input=${(e: InputEvent) => {
                const target = e.target as HTMLTextAreaElement;
                this.chatMessage = target.value;
              }}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void this.onSend();
                }
              }}
            ></textarea>
            <button
              ?disabled=${!this.connected || this.chatSending}
              @click=${() => void this.onSend()}
              title="Send (Ctrl/Cmd+Enter)"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

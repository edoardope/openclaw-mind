import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import DOMPurify from "dompurify";
import { marked } from "marked";

import { GatewayBrowserClient, type GatewayEventFrame, type GatewayHelloOk } from "../../ui/src/ui/gateway.ts";
import { extractText } from "../../ui/src/ui/chat/message-extract.ts";
import type { CronJob } from "../../ui/src/ui/types.ts";
import {
  loadCronJobs,
  toggleCronJob,
  runCronJob,
  addCronJob,
  type CronState,
} from "../../ui/src/ui/controllers/cron.ts";
import type { CronFormState } from "../../ui/src/ui/ui-types.ts";

import type { AgentsListResult, AgentsFilesListResult } from "../../ui/src/ui/types.ts";
import { loadAgents, type AgentsState } from "../../ui/src/ui/controllers/agents.ts";
import {
  loadAgentFiles,
  loadAgentFileContent,
  saveAgentFile,
  type AgentFilesState,
} from "../../ui/src/ui/controllers/agent-files.ts";

type AgentRow = { id: string; name?: string; default?: boolean };
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

    .panel {
      width: min(1100px, 100%);
      margin: 0 auto;
      height: 100%;
      border-left: 1px solid rgba(148, 163, 184, 0.08);
      border-right: 1px solid rgba(148, 163, 184, 0.08);
    }

    .tasksHeader {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 16px 18px 10px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.10);
      color: rgba(226, 232, 240, 0.92);
    }

    .modalBackdrop {
      position: fixed;
      inset: 0;
      z-index: 50;
      background: rgba(2, 6, 23, 0.55);
      backdrop-filter: blur(12px);
      display: grid;
      place-items: center;
      padding: 18px;
    }

    .modal {
      width: min(720px, 100%);
      border: 1px solid rgba(148, 163, 184, 0.16);
      border-radius: 18px;
      background: rgba(5, 8, 16, 0.92);
      box-shadow: 0 40px 120px rgba(0, 0, 0, 0.55);
      overflow: hidden;
    }

    .modalHeader {
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(148, 163, 184, 0.10);
    }

    .modalHeader .title {
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-size: 12px;
    }

    .modalBody {
      padding: 14px 16px 16px;
      display: grid;
      gap: 12px;
    }

    .row2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .modalBody select {
      height: 40px;
      padding: 0 10px;
      border-radius: 12px;
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: rgba(2, 6, 23, 0.45);
      color: var(--text);
      outline: none;
      font-size: 13px;
    }

    .modalFooter {
      padding: 12px 16px;
      border-top: 1px solid rgba(148, 163, 184, 0.10);
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    .ghostBtn {
      background: rgba(148, 163, 184, 0.10);
      border-color: rgba(148, 163, 184, 0.18);
    }

    @media (max-width: 720px) {
      .row2 {
        grid-template-columns: 1fr;
      }
    }

    .tasksHeader .title {
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-size: 12px;
    }

    .tasksList {
      padding: 14px 18px 18px;
      display: grid;
      gap: 10px;
      overflow: auto;
      height: calc(100% - 52px);
    }

    .taskRow {
      border: 1px solid rgba(148, 163, 184, 0.14);
      border-radius: 16px;
      background: rgba(2, 6, 23, 0.35);
      padding: 12px 12px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: center;
    }

    .taskName {
      font-weight: 800;
    }

    .taskMeta {
      margin-top: 4px;
      font-size: 12px;
      color: rgba(148, 163, 184, 0.92);
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .taskActions {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .tinyBtn {
      height: 34px;
      min-width: 0;
      padding: 0 10px;
      border-radius: 12px;
      font-size: 12px;
    }

    .switch {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      font-size: 12px;
      color: rgba(226, 232, 240, 0.9);
    }

    .agentsHeader {
      padding: 16px 18px 10px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.10);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .agentsHeader .title {
      font-weight: 900;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-size: 12px;
    }

    .agentsBody {
      display: grid;
      grid-template-columns: 340px 1fr;
      height: 100%;
    }

    .agentsList {
      border-right: 1px solid rgba(148, 163, 184, 0.10);
      padding: 14px 14px 18px;
      overflow: auto;
    }

    .agentCard {
      border: 1px solid rgba(148, 163, 184, 0.14);
      border-radius: 16px;
      background: rgba(2, 6, 23, 0.35);
      padding: 12px 12px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      align-items: center;
      cursor: pointer;
      margin-bottom: 10px;
    }

    .agentCard.active {
      border-color: rgba(56, 189, 248, 0.26);
      box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.10);
    }

    .agentName {
      font-weight: 900;
    }

    .agentId {
      margin-top: 3px;
      font-size: 12px;
      color: rgba(148, 163, 184, 0.92);
    }

    .agentEditor {
      padding: 14px 16px 18px;
      overflow: auto;
    }

    .agentEditor textarea {
      min-height: 240px;
      max-height: 48vh;
    }

    .seg {
      display: inline-flex;
      border: 1px solid rgba(148, 163, 184, 0.16);
      border-radius: 999px;
      overflow: hidden;
    }

    .seg button {
      height: 32px;
      min-width: 0;
      padding: 0 12px;
      border-radius: 0;
      border: 0;
      background: transparent;
      font-size: 12px;
      font-weight: 800;
      color: rgba(226, 232, 240, 0.86);
    }

    .seg button.active {
      background: rgba(56, 189, 248, 0.16);
      color: rgba(226, 232, 240, 0.96);
    }

    @media (max-width: 900px) {
      .agentsBody {
        grid-template-columns: 1fr;
      }
      .agentsList {
        border-right: 0;
        border-bottom: 1px solid rgba(148, 163, 184, 0.10);
      }
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
      max-width: 100%;
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
      gap: 40px;
      align-items: end;
    }

    .composerMeta {
      width: min(1100px, 100%);
      margin: 0 auto 0;
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
  @state() tasksOpen = false;
  @state() agentsOpen = false;

  @state() chatLoading = false;
  @state() chatSending = false;
  @state() chatMessage = "";
  @state() chatMessages: unknown[] = [];
  @state() chatThinkingLevel: string | null = null;
  @state() chatRunId: string | null = null;
  @state() chatStream: string | null = null;
  @state() chatStreamStartedAt: number | null = null;

  @state() cronLoading = false;
  @state() cronJobs: CronJob[] = [];
  @state() cronError: string | null = null;
  @state() cronBusy = false;

  @state() cronAddOpen = false;
  @state() cronForm: CronFormState = {
    name: "",
    description: "",
    agentId: "main",
    enabled: true,
    
    scheduleKind: "cron",
    scheduleAt: "",
    everyAmount: "",
    everyUnit: "minutes",
    cronExpr: "0 9 * * *",
    cronTz: "Europe/Rome",
    sessionTarget: "isolated",
    wakeMode: "next-heartbeat",
    payloadKind: "agentTurn",
    payloadText: "",
    timeoutSeconds: "",
    deliveryMode: "none",
    deliveryChannel: "last",
    deliveryTo: "",
  };

  @state() agentsLoading = false;
  @state() agentsError: string | null = null;
  @state() agentsList: AgentsListResult | null = null;
  @state() activeAgentId: string = "main";

  @state() agentCreateOpen = false;
  @state() agentCreateName = "";

  @state() agentFilesLoading = false;
  @state() agentFilesError: string | null = null;
  @state() agentFilesList: AgentsFilesListResult | null = null;
  @state() agentFileActive: string | null = null;
  @state() agentFileDrafts: Record<string, string> = {};
  @state() agentFileContents: Record<string, string> = {};
  @state() agentFileSaving = false;

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

  private toCronState(): CronState {
    // Minimal CronState view for listing/creating jobs.
    return {
      client: this.client,
      connected: this.connected,
      cronLoading: this.cronLoading,
      cronJobs: this.cronJobs,
      cronStatus: null,
      cronError: this.cronError,
      cronForm: this.cronForm,
      cronRunsJobId: null,
      cronRuns: [],
      cronBusy: this.cronBusy,
    };
  }

  private toAgentsState(): AgentsState {
    return {
      client: this.client,
      connected: this.connected,
      agentsLoading: this.agentsLoading,
      agentsError: this.agentsError,
      agentsList: this.agentsList,
      agentsSelectedId: this.activeAgentId,
    };
  }

  private syncFromAgentsState(next: AgentsState) {
    this.agentsLoading = next.agentsLoading;
    this.agentsError = next.agentsError;
    this.agentsList = next.agentsList;
    if (next.agentsSelectedId && next.agentsSelectedId !== this.activeAgentId) {
      this.setActiveAgent(next.agentsSelectedId);
    }
  }

  private toAgentFilesState(): AgentFilesState {
    return {
      client: this.client,
      connected: this.connected,
      agentFilesLoading: this.agentFilesLoading,
      agentFilesError: this.agentFilesError,
      agentFilesList: this.agentFilesList,
      agentFileContents: this.agentFileContents,
      agentFileDrafts: this.agentFileDrafts,
      agentFileActive: this.agentFileActive,
      agentFileSaving: this.agentFileSaving,
    };
  }

  private async ensureAgentFilesLoaded(agentId: string) {
    const st = this.toAgentFilesState();
    await loadAgentFiles(st, agentId);
    this.syncFromAgentFilesState(st);

    const defaults = ["SOUL.md", "USER.md", "IDENTITY.md", "HEARTBEAT.md"];
    const available = st.agentFilesList?.files?.map((f) => f.name) ?? [];
    const pick = defaults.find((n) => available.includes(n)) ?? available[0] ?? null;
    if (pick) {
      this.agentFileActive = pick;
      await loadAgentFileContent(st, agentId, pick, { force: true, preserveDraft: true });
      this.syncFromAgentFilesState(st);
    }
  }

  private syncFromAgentFilesState(next: AgentFilesState) {
    this.agentFilesLoading = next.agentFilesLoading;
    this.agentFilesError = next.agentFilesError;
    this.agentFilesList = next.agentFilesList;
    this.agentFileContents = next.agentFileContents;
    this.agentFileDrafts = next.agentFileDrafts;
    this.agentFileActive = next.agentFileActive;
    this.agentFileSaving = next.agentFileSaving;
  }

  private setActiveAgent(agentId: string) {
    this.activeAgentId = agentId;
    // Switch chat session key to this agent.
    const sessionKey = agentId === "main" ? "agent:main:main" : `agent:${agentId}:main`;
    this.settings = { ...this.settings, sessionKey };
    saveSettings(this.settings);
    // Refresh chat history in the new session.
    void this.refreshHistory();
    // Refresh cron list and agent files.
    const cron = this.toCronState();
    this.cronForm = { ...this.cronForm, agentId };
    void loadCronJobs(cron).then(() => this.syncFromCronState(cron));

    // Load prompt files for the selected agent.
    void this.ensureAgentFilesLoaded(agentId);
  }

  private syncFromCronState(next: CronState) {
    this.cronLoading = next.cronLoading;
    this.cronJobs = next.cronJobs;
    this.cronError = next.cronError;
    this.cronBusy = next.cronBusy;
    this.cronForm = next.cronForm;
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

        // Preload cron jobs for the tasks drawer.
        const cron = this.toCronState();
        void loadCronJobs(cron).then(() => this.syncFromCronState(cron));

        // Load agents list.
        const a = this.toAgentsState();
        void loadAgents(a).then(() => this.syncFromAgentsState(a));
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
    // When overlays are closed, show a small state label above the sphere.
    if (this.chatOpen || this.tasksOpen || this.agentsOpen) {
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

  private formatCronSchedule(job: CronJob): string {
    const s: unknown = job.schedule;
    if (!s || typeof s !== "object") {
      return "schedule";
    }

    const kind = (s as { kind?: unknown }).kind;
    if (kind === "at") {
      const at = (s as { at?: unknown }).at;
      return `at ${typeof at === "string" ? at : ""}`.trim();
    }
    if (kind === "every") {
      const everyMs = (s as { everyMs?: unknown }).everyMs;
      return `every ${typeof everyMs === "number" ? everyMs : ""}ms`;
    }
    if (kind === "cron") {
      const expr = (s as { expr?: unknown }).expr;
      const tz = (s as { tz?: unknown }).tz;
      return `cron ${typeof expr === "string" ? expr : ""}${typeof tz === "string" && tz ? ` (${tz})` : ""}`;
    }

    return typeof kind === "string" ? kind : "schedule";
  }

  private renderCronAddModal() {
    if (!this.cronAddOpen) {
      return nothing;
    }

    const form = this.cronForm;

    const close = () => {
      this.cronAddOpen = false;
    };

    const submit = async () => {
      const st = this.toCronState();
      // Ensure we're creating for main agent.
      st.cronForm = { ...st.cronForm, agentId: "main" };
      try {
        // Use shared controller to validate/build and call cron.add
        await addCronJob(st);
        this.syncFromCronState(st);
        this.cronAddOpen = false;
      } catch (err) {
        this.cronError = String(err);
      }
    };

    return html`
      <div class="modalBackdrop" @click=${close}>
        <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
          <div class="modalHeader">
            <div class="title">Add cron job (main)</div>
            <button class="tinyBtn ghostBtn" @click=${close}>Close</button>
          </div>
          <div class="modalBody">
            ${this.cronError ? html`<div class="error">${this.cronError}</div>` : nothing}

            <div class="field">
              <label>Name</label>
              <input
                .value=${form.name}
                @input=${(e: Event) => (this.cronForm = { ...form, name: (e.target as HTMLInputElement).value })}
              />
            </div>

            <div class="row2">
              <div class="field">
                <label>Schedule</label>
                <select
                  .value=${form.scheduleKind}
                  @change=${(e: Event) =>
                    (this.cronForm = {
                      ...form,
                      scheduleKind: (e.target as HTMLSelectElement).value as CronFormState["scheduleKind"],
                    })}
                >
                  <option value="cron">cron</option>
                  <option value="every">every</option>
                  <option value="at">at</option>
                </select>
              </div>
              <div class="field">
                <label>Enabled</label>
                <select
                  .value=${form.enabled ? "on" : "off"}
                  @change=${(e: Event) =>
                    (this.cronForm = {
                      ...form,
                      enabled: (e.target as HTMLSelectElement).value === "on",
                    })}
                >
                  <option value="on">on</option>
                  <option value="off">off</option>
                </select>
              </div>
            </div>

            ${form.scheduleKind === "cron"
              ? html`<div class="row2">
                  <div class="field">
                    <label>Cron expr</label>
                    <input
                      .value=${form.cronExpr}
                      placeholder="0 9 * * *"
                      @input=${(e: Event) =>
                        (this.cronForm = { ...form, cronExpr: (e.target as HTMLInputElement).value })}
                    />
                  </div>
                  <div class="field">
                    <label>Timezone</label>
                    <input
                      .value=${form.cronTz}
                      placeholder="Europe/Rome"
                      @input=${(e: Event) =>
                        (this.cronForm = { ...form, cronTz: (e.target as HTMLInputElement).value })}
                    />
                  </div>
                </div>`
              : nothing}

            ${form.scheduleKind === "every"
              ? html`<div class="row2">
                  <div class="field">
                    <label>Every</label>
                    <input
                      .value=${form.everyAmount}
                      placeholder="15"
                      @input=${(e: Event) =>
                        (this.cronForm = { ...form, everyAmount: (e.target as HTMLInputElement).value })}
                    />
                  </div>
                  <div class="field">
                    <label>Unit</label>
                    <select
                      .value=${form.everyUnit}
                      @change=${(e: Event) =>
                        (this.cronForm = {
                          ...form,
                          everyUnit: (e.target as HTMLSelectElement).value as CronFormState["everyUnit"],
                        })}
                    >
                      <option value="minutes">minutes</option>
                      <option value="hours">hours</option>
                      <option value="days">days</option>
                    </select>
                  </div>
                </div>`
              : nothing}

            ${form.scheduleKind === "at"
              ? html`<div class="field">
                  <label>Run at (ISO / local parse)</label>
                  <input
                    .value=${form.scheduleAt}
                    placeholder="2026-02-10T09:00:00+01:00"
                    @input=${(e: Event) =>
                      (this.cronForm = { ...form, scheduleAt: (e.target as HTMLInputElement).value })}
                  />
                </div>`
              : nothing}

            <div class="row2">
              <div class="field">
                <label>Payload</label>
                <select
                  .value=${form.payloadKind}
                  @change=${(e: Event) =>
                    (this.cronForm = {
                      ...form,
                      payloadKind: (e.target as HTMLSelectElement).value as CronFormState["payloadKind"],
                    })}
                >
                  <option value="agentTurn">agentTurn</option>
                  <option value="systemEvent">systemEvent</option>
                </select>
              </div>
              <div class="field">
                <label>Session target</label>
                <select
                  .value=${form.sessionTarget}
                  @change=${(e: Event) =>
                    (this.cronForm = {
                      ...form,
                      sessionTarget: (e.target as HTMLSelectElement).value as CronFormState["sessionTarget"],
                    })}
                >
                  <option value="isolated">isolated</option>
                  <option value="main">main</option>
                </select>
              </div>
            </div>

            <div class="field">
              <label>${form.payloadKind === "systemEvent" ? "System event text" : "Agent message"}</label>
              <input
                .value=${form.payloadText}
                placeholder=${form.payloadKind === "systemEvent"
                  ? "Reminder: …"
                  : "Check my calendar and summarize"}
                @input=${(e: Event) =>
                  (this.cronForm = { ...form, payloadText: (e.target as HTMLInputElement).value })}
              />
            </div>
          </div>
          <div class="modalFooter">
            <button class="tinyBtn ghostBtn" @click=${close}>Cancel</button>
            <button class="tinyBtn" ?disabled=${!this.connected || this.cronBusy} @click=${submit}>
              Create
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderAgentsPanel() {
    const agents = (this.agentsList?.agents ?? []) as AgentRow[];
    const selected = this.activeAgentId;

    const activeFile = this.agentFileActive;
    const editorValue = activeFile ? (this.agentFileDrafts[activeFile] ?? "") : "";

    return html`
      <div class="panel">
        <div class="agentsHeader">
          <div class="title">Agents</div>
          <div style="display:flex; gap:10px; align-items:center;">
            <button
              class="tinyBtn"
              ?disabled=${!this.connected || this.agentsLoading}
              @click=${async () => {
                const st = this.toAgentsState();
                await loadAgents(st);
                this.syncFromAgentsState(st);
              }}
            >
              Refresh
            </button>
            <button class="tinyBtn" ?disabled=${!this.connected} @click=${() => {
              this.agentCreateName = "";
              this.agentCreateOpen = true;
            }}>Add</button>
          </div>
        </div>

        <div class="agentsBody">
          <div class="agentsList">
            ${this.agentsError ? html`<div class="error">${this.agentsError}</div>` : nothing}
            ${this.agentsLoading ? html`<div class="mini">Loading…</div>` : nothing}

            ${agents.map((a) => {
              const isActive = a.id === selected;
              const label = a.name?.trim() || a.id;
              const canDelete = a.id !== "main";
              return html`
                <div
                  class="agentCard ${isActive ? "active" : ""}"
                  @click=${() => {
                    this.setActiveAgent(a.id);
                  }}
                >
                  <div>
                    <div class="agentName">${label}</div>
                    <div class="agentId">id: <code>${a.id}</code>${a.default ? " · default" : ""}</div>
                  </div>
                  <div style="display:flex; gap:10px; align-items:center;">
                    ${isActive ? html`<span class="mini">active</span>` : nothing}
                    ${canDelete
                      ? html`<button
                          class="tinyBtn ghostBtn"
                          title="Delete agent"
                          @click=${async (e: Event) => {
                            e.stopPropagation();
                            if (!this.client || !this.connected) {
                              return;
                            }
                            if (!confirm(`Delete agent ${a.id}?`)) {
                              return;
                            }
                            await this.client.request("agents.delete", { agentId: a.id, deleteFiles: true });
                            const st = this.toAgentsState();
                            await loadAgents(st);
                            this.syncFromAgentsState(st);
                            if (this.activeAgentId === a.id) {
                              this.setActiveAgent("main");
                            }
                          }}
                        >
                          Delete
                        </button>`
                      : nothing}
                  </div>
                </div>
              `;
            })}
          </div>

          <div class="agentEditor">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
              <div>
                <div class="taskName">Active agent: <code>${this.activeAgentId}</code></div>
                <div class="mini">Session: <code>${this.settings.sessionKey}</code></div>
              </div>

              <div class="seg">
                <button class="active">Prompts</button>
                <button disabled title="Coming soon">Permissions</button>
              </div>
            </div>

            <div style="height:12px"></div>

            <div class="row2">
              <div class="field">
                <label>Prompt file</label>
                <select
                  .value=${activeFile ?? ""}
                  @change=${async (e: Event) => {
                    const name = (e.target as HTMLSelectElement).value;
                    this.agentFileActive = name;
                    const st = this.toAgentFilesState();
                    await loadAgentFileContent(st, this.activeAgentId, name, { force: true, preserveDraft: true });
                    this.syncFromAgentFilesState(st);
                  }}
                >
                  ${(this.agentFilesList?.files ?? []).map((f) =>
                    html`<option value=${f.name}>${f.name}</option>`,
                  )}
                </select>
              </div>
              <div class="field">
                <label>Actions</label>
                <div style="display:flex; gap:10px; align-items:center; height:40px;">
                  <button
                    class="tinyBtn"
                    ?disabled=${!this.connected || !activeFile || this.agentFileSaving}
                    @click=${async () => {
                      if (!activeFile) {
                        return;
                      }
                      const st = this.toAgentFilesState();
                      const content = this.agentFileDrafts[activeFile] ?? "";
                      await saveAgentFile(st, this.activeAgentId, activeFile, content);
                      this.syncFromAgentFilesState(st);
                    }}
                  >
                    Save
                  </button>
                  <button
                    class="tinyBtn ghostBtn"
                    ?disabled=${!activeFile}
                    @click=${() => {
                      if (!activeFile) {
                        return;
                      }
                      const base = this.agentFileContents[activeFile] ?? "";
                      this.agentFileDrafts = { ...this.agentFileDrafts, [activeFile]: base };
                    }}
                  >
                    Reset
                  </button>
                  ${this.agentFilesError ? html`<span class="error">${this.agentFilesError}</span>` : nothing}
                </div>
              </div>
            </div>

            <div class="field">
              <label>Content</label>
              <textarea
                .value=${editorValue}
                @input=${(e: InputEvent) => {
                  if (!activeFile) {
                    return;
                  }
                  const value = (e.target as HTMLTextAreaElement).value;
                  this.agentFileDrafts = { ...this.agentFileDrafts, [activeFile]: value };
                }}
              ></textarea>
            </div>
          </div>
        </div>

        ${this.agentCreateOpen
          ? html`<div class="modalBackdrop" @click=${() => (this.agentCreateOpen = false)}>
              <div class="modal" @click=${(e: Event) => e.stopPropagation()}>
                <div class="modalHeader">
                  <div class="title">Create agent</div>
                  <button class="tinyBtn ghostBtn" @click=${() => (this.agentCreateOpen = false)}>
                    Close
                  </button>
                </div>
                <div class="modalBody">
                  <div class="field">
                    <label>Name (used to derive id)</label>
                    <input
                      .value=${this.agentCreateName}
                      placeholder="research" 
                      @input=${(e: Event) => (this.agentCreateName = (e.target as HTMLInputElement).value)}
                    />
                  </div>
                  <div class="mini">
                    Workspace will default to the gateway's default workspace.
                  </div>
                </div>
                <div class="modalFooter">
                  <button class="tinyBtn ghostBtn" @click=${() => (this.agentCreateOpen = false)}>
                    Cancel
                  </button>
                  <button
                    class="tinyBtn"
                    ?disabled=${!this.connected || !this.agentCreateName.trim()}
                    @click=${async () => {
                      if (!this.client || !this.connected) {
                        return;
                      }
                      const name = this.agentCreateName.trim();
                      await this.client.request("agents.create", { name });
                      this.agentCreateOpen = false;
                      const st = this.toAgentsState();
                      await loadAgents(st);
                      this.syncFromAgentsState(st);
                    }}
                  >
                    Create
                  </button>
                </div>
              </div>
            </div>`
          : nothing}
      </div>
    `;
  }

  private renderTasks() {
    const jobs = (this.cronJobs ?? [])
      .filter((j) => (j.agentId ?? "main") === "main")
      .toSorted((a, b) => (b.updatedAtMs ?? 0) - (a.updatedAtMs ?? 0));

    return html`
      ${this.renderCronAddModal()}
      <div class="panel">
        <div class="tasksHeader">
          <div class="title">Scheduled jobs (main)</div>
          <div style="display:flex; gap:10px; align-items:center;">
            <button
              class="tinyBtn"
              ?disabled=${!this.connected || this.cronLoading}
              @click=${async () => {
                const st = this.toCronState();
                await loadCronJobs(st);
                this.syncFromCronState(st);
              }}
            >
              Refresh
            </button>
            <button
              class="tinyBtn"
              ?disabled=${!this.connected}
              @click=${() => {
                this.cronError = null;
                this.cronAddOpen = true;
                this.cronForm = { ...this.cronForm, agentId: "main" };
              }}
            >
              Add
            </button>
          </div>
        </div>
        <div class="tasksList">
          ${this.cronError ? html`<div class="error">${this.cronError}</div>` : nothing}
          ${this.cronLoading ? html`<div class="mini">Loading…</div>` : nothing}
          ${!this.cronLoading && jobs.length === 0
            ? html`<div class="mini">No cron jobs found for agent <code>main</code>.</div>`
            : nothing}

          ${jobs.map((job) => {
            const schedule = this.formatCronSchedule(job);
            const target = `${job.sessionTarget}${job.wakeMode ? ` · ${job.wakeMode}` : ""}`;
            const nextRun = job.state?.nextRunAtMs ? new Date(job.state.nextRunAtMs).toLocaleString() : null;
            return html`
              <div class="taskRow">
                <div>
                  <div class="taskName">${job.name}</div>
                  <div class="taskMeta">
                    <span>${schedule}</span>
                    <span>${target}</span>
                    ${nextRun ? html`<span>next: ${nextRun}</span>` : nothing}
                  </div>
                </div>
                <div class="taskActions">
                  <label class="switch">
                    <input
                      type="checkbox"
                      .checked=${job.enabled}
                      ?disabled=${!this.connected || this.cronBusy}
                      @change=${async (e: Event) => {
                        const enabled = (e.target as HTMLInputElement).checked;
                        const st = this.toCronState();
                        st.cronJobs = this.cronJobs;
                        await toggleCronJob(st, job, enabled);
                        this.syncFromCronState(st);
                      }}
                    />
                    <span>${job.enabled ? "On" : "Off"}</span>
                  </label>

                  <button
                    class="tinyBtn"
                    ?disabled=${!this.connected || this.cronBusy}
                    @click=${async () => {
                      const st = this.toCronState();
                      st.cronJobs = this.cronJobs;
                      await runCronJob(st, job);
                      this.syncFromCronState(st);
                    }}
                    title="Run now"
                  >
                    Run
                  </button>
                </div>
              </div>
            `;
          })}
        </div>
      </div>
    `;
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
                  const next = !this.chatOpen;
                  this.chatOpen = next;
                  if (next) {
                    this.tasksOpen = false;
                    void this.refreshHistory();
                  }
                }}
                title=${this.chatOpen ? "Close chat" : "Open chat"}
              >
                <span>${this.chatOpen ? "Hide chat" : "Show chat"}</span>
              </button>

              <button
                class="pill"
                style="cursor:pointer"
                @click=${async () => {
                  const next = !this.tasksOpen;
                  this.tasksOpen = next;
                  if (next) {
                    this.chatOpen = false;
                    const st = this.toCronState();
                    await loadCronJobs(st);
                    this.syncFromCronState(st);
                  }
                }}
                title=${this.tasksOpen ? "Close tasks" : "Show tasks"}
              >
                <span>${this.tasksOpen ? "Hide tasks" : "Show tasks"}</span>
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
            <div class="sphereWrap ${(this.chatOpen || this.tasksOpen || this.agentsOpen) ? "hidden" : ""}">
              ${sphereStatus
                ? html`<div
                    style="position:absolute; margin-bottom: 420px; font-weight:800; letter-spacing:0.12em; font-size:12px; color: rgba(226,232,240,0.9); text-transform:uppercase;"
                  >
                    ${sphereStatus}
                  </div>`
                : nothing}
              <div class="sphere"></div>
            </div>

            <div class="drawer ${(this.chatOpen || this.tasksOpen || this.agentsOpen) ? "open" : "closed"}">
              ${this.chatOpen
                ? this.renderMessages()
                : this.tasksOpen
                  ? this.renderTasks()
                  : this.agentsOpen
                    ? this.renderAgentsPanel()
                    : nothing}
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
            <div style="display:flex; gap:10px; align-items:center;">
              <button
                class="tinyBtn ghostBtn"
                style="height:32px"
                ?disabled=${!this.connected}
                @click=${async () => {
                  const next = !this.agentsOpen;
                  this.agentsOpen = next;
                  if (next) {
                    this.chatOpen = false;
                    this.tasksOpen = false;
                    const st = this.toAgentsState();
                    await loadAgents(st);
                    this.syncFromAgentsState(st);
                    await this.ensureAgentFilesLoaded(this.activeAgentId);
                  }
                }}
                title=${this.agentsOpen ? "Hide agents" : "Show agents"}
              >
                Agents
              </button>
              <span>
                ${this.chatSending || this.chatRunId
                  ? this.chatStream && this.chatStream.trim()
                    ? "Thinking…"
                    : "Working…"
                  : "Ready"}
              </span>
            </div>
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

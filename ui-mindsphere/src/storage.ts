const KEY = "mindsphere.ui.settings.v1";

export type MsSettings = {
  gatewayUrl: string;
  token: string;
  sessionKey: string;
};

export function loadSettings(): MsSettings {
  const defaultUrl = (() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}`;
  })();

  const defaults: MsSettings = {
    gatewayUrl: defaultUrl,
    token: "",
    // Force main agent by default.
    sessionKey: "agent:main:main",
  };

  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<MsSettings>;
    return {
      gatewayUrl:
        typeof parsed.gatewayUrl === "string" && parsed.gatewayUrl.trim()
          ? parsed.gatewayUrl.trim()
          : defaults.gatewayUrl,
      token: typeof parsed.token === "string" ? parsed.token : defaults.token,
      sessionKey:
        typeof parsed.sessionKey === "string" && parsed.sessionKey.trim()
          ? parsed.sessionKey.trim()
          : defaults.sessionKey,
    };
  } catch {
    return defaults;
  }
}

export function saveSettings(next: MsSettings) {
  localStorage.setItem(KEY, JSON.stringify(next));
}

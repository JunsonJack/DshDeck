/**
 * dsh-readonly · model config reader.
 * Scans each profile's cordis(.patch).yml under ~/.dsh/profiles for the
 * llm-pi-ai bundle's config.providers (the models a user configured — e.g.
 * via PiDeck) and reports which profiles define each model. STRICTLY read-only.
 * Format notes: docs/W0-调研笔记.md §10
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { load as yamlLoad } from "js-yaml";

function profileConfigFiles(root, profile) {
  return ["cordis.patch.yml", "cordis.yml"]
    .map((f) => join(root, profile, f))
    .filter((f) => existsSync(f));
}

function extractLlmPiAi(files) {
  let providers = null;
  let defaultModel = null;
  for (const f of files) {
    let doc;
    try { doc = yamlLoad(readFileSync(f, "utf8")); } catch { continue; }
    if (!Array.isArray(doc)) continue;
    for (const entry of doc) {
      if (entry?.id === "llm-pi-ai" && entry.config?.providers) {
        providers = entry.config.providers; // later layers win
      }
      if (entry?.id === "agent-default-model" && entry.config?.provider && entry.config?.model) {
        defaultModel = { provider: entry.config.provider, model: entry.config.model };
      }
    }
  }
  return { providers: providers || {}, defaultModel };
}

/** readModelConfig(activeProfile) → { ok, activeProfile, providers[], defaults{} } */
export function readModelConfig(activeProfile = "acp", dshDir) {
  try {
    const root = dshDir
      ? join(dshDir, "profiles")
      : join(process.env.USERPROFILE || "", ".dsh", "profiles");
    if (!existsSync(root)) return { ok: false, error: "未找到 ~/.dsh/profiles", activeProfile, providers: [], defaults: {} };

    const profiles = readdirSync(root).filter(
      (d) => existsSync(join(root, d, "cordis.patch.yml")) || existsSync(join(root, d, "cordis.yml"))
    );
    const merged = new Map(); // providerKey -> { displayName, baseURL, models: Map }
    const defaults = {};
    for (const pf of profiles) {
      const { providers, defaultModel } = extractLlmPiAi(profileConfigFiles(root, pf));
      if (defaultModel) defaults[pf] = defaultModel;
      for (const [key, p] of Object.entries(providers)) {
        if (!p || typeof p !== "object") continue;
        const rec =
          merged.get(key) ||
          { key, displayName: null, baseURL: null, models: new Map() };
        if (!rec.displayName && p.displayName) rec.displayName = p.displayName;
        if (!rec.baseURL && p.baseURL) rec.baseURL = p.baseURL;
        for (const m of Array.isArray(p.models) ? p.models : []) {
          if (!m?.id) continue;
          const recModel =
            rec.models.get(m.id) ||
            { id: m.id, name: m.name || m.id, contextWindow: m.contextWindow || null, maxTokens: m.maxTokens || null, profiles: [] };
          if (!recModel.profiles.includes(pf)) recModel.profiles.push(pf);
          rec.models.set(m.id, recModel);
        }
        merged.set(key, rec);
      }
    }
    const providersOut = [...merged.values()].map((p) => ({
      key: p.key,
      displayName: p.displayName || p.key,
      baseURL: p.baseURL,
      models: [...p.models.values()].map((m) => ({
        ...m,
        active: m.profiles.includes(activeProfile),
      })),
    }));
    return { ok: true, activeProfile, providers: providersOut, defaults };
  } catch (e) {
    return { ok: false, error: String(e.message || e), activeProfile, providers: [], defaults: {} };
  }
}

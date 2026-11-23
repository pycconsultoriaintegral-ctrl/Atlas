import type { AppConfig } from "./config.js";
import { AuditLog } from "./audit/audit.js";
import { SessionStore } from "./auth/sessions.js";
import { ProviderRegistry } from "./ai/registry.js";
import { ConversationRepo } from "./chat/conversationRepo.js";
import type { DB } from "./db/database.js";
import { DeviceHub } from "./devices/deviceHub.js";
import { MemoryRepo } from "./memory/memoryRepo.js";
import { SettingsStore } from "./settings/settings.js";
import { TaskRepo } from "./tasks/taskRepo.js";
import { ToolRegistry } from "./tools/registry.js";
import { ActiveTurns } from "./chat/activeTurns.js";
import { PendingActions } from "./chat/pendingActions.js";

/** Contenedor de servicios del cerebro central. */
export interface Services {
  config: AppConfig;
  db: DB;
  audit: AuditLog;
  sessions: SessionStore;
  settings: SettingsStore;
  memory: MemoryRepo;
  tasks: TaskRepo;
  conversations: ConversationRepo;
  devices: DeviceHub;
  tools: ToolRegistry;
  providers: ProviderRegistry;
  active: ActiveTurns;
  actions: PendingActions;
}

export function createServices(config: AppConfig, db: DB): Services {
  const audit = new AuditLog(db);
  return {
    config,
    db,
    audit,
    sessions: new SessionStore(db),
    settings: new SettingsStore(db, config.defaultModel),
    memory: new MemoryRepo(db),
    tasks: new TaskRepo(db),
    conversations: new ConversationRepo(db),
    devices: new DeviceHub(db, audit),
    tools: new ToolRegistry(),
    providers: new ProviderRegistry(config),
    active: new ActiveTurns(),
    actions: new PendingActions(db),
  };
}

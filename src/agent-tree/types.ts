export type AgentStatus = 'running' | 'done' | 'failed' | 'stopped' | 'needs-you'

/** Which company made the model. Drives the card icon. */
export type Provider = 'anthropic' | 'openai' | 'google' | 'other'

/** Which harness (app) runs the agent. */
export type Harness = 'claude-code' | 'codex' | 'opencode' | 'pi' | 'antigravity' | 'demo'

export interface AgentIssue {
  /** Short sentence that explains what went wrong or what is being asked. */
  message: string
  /** Buttons for a "needs you" question. */
  choices?: string[]
}

export interface AgentNode {
  id: string
  parentId: string | null
  name: string
  model: string
  /** Browser-local appearance and completion overrides. */
  color?: string
  markedDone?: boolean
  /** Marked as closed by the user with "Mark as closed". Implies `closed`. */
  markedClosed?: boolean
  /** Closed by the user: stays counted in the total but is listed apart, under "Closed". */
  closed?: boolean
  /** Set on a main session that was closed in its own app or terminal. Listed under "Done". */
  ended?: boolean
  /** Set on a finished subagent moved to Closed: the id of the agent that used it. */
  closedFrom?: string
  /** Started by its parent's shell command, as a separate app session, rather than as its subagent. */
  dispatched?: boolean
  /** Id of the session this one was forked from, such as a side chat. Drawn as a link beside it. */
  forkOf?: string
  /** Ids of the sessions this one talked to agent-to-agent (A2A). Drawn as a link to each. */
  peers?: string[]
  /** Reasoning effort as the app recorded it, such as "medium" or "max". */
  effort?: string
  provider: Provider
  harness: Harness
  status: AgentStatus
  task: string
  /** Tool icon keys, see icons.tsx. */
  tools: string[]
  /** The agent's own cost in dollars, without its children. */
  cost: number
  /** Epoch ms. */
  startedAt: number
  endedAt?: number
  /** Short number shown on the card, so a card can be named in conversation, as in "#007". */
  num?: number
  /** Epoch ms of the session's last write, as the collector saw it. */
  activeAt?: number
  issue?: AgentIssue
  /** Extra facts shown when a card is expanded. */
  details?: AgentDetails
}

export interface TokenCounts {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface AgentDetails {
  /** The raw model id, when it differs from the friendly name. */
  modelId?: string
  catalogue?: ModelMetadata
  folder?: string
  sessionId?: string
  tokens?: TokenCounts
  /** Tool names with how often each was called, most used first. */
  toolCounts?: [string, number][]
  lastMessage?: string
  /** How many threads this node stands for, when several were folded into one. */
  threads?: number
}

export interface ModelMetadata {
  provider: string
  context?: number
  output?: number
  releaseDate?: string
  reasoning?: boolean
  toolCall?: boolean
  inputModalities?: string[]
}

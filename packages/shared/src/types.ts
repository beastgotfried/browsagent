/**
 * The source position of an element.
 * The build plugin makes this value.
 */
export interface SourcePosition {
  file: string;
  line: number;
  column: number;
}

/** The size of the browser at the time of the record. */
export interface Viewport {
  name: string;
  width: number;
  height: number;
}

/** The interaction state of an element. */
export interface ElementState {
  hover: boolean;
  focus: boolean;
  active: boolean;
  open: boolean;
  disabled: boolean;
}

/**
 * The static data of an element. The compiler makes this data.
 * The value is exact because the compiler sees the original code.
 */
export interface StaticStamp {
  /** The source position of the element. */
  src: SourcePosition;
  /** The name of the component that made the element. */
  component: string | null;
  /**
   * The raw expression text for each dynamic property.
   * Example: { className: 'cn("px-4", big && "mt-2")' }
   */
  expressions: Record<string, string>;
  /** True if the file is in the project. False for node_modules. */
  editable: boolean;
  /** The source position of the parent element. */
  parentSrc: SourcePosition | null;
  /** The instance identity of the rendered node. */
  inst: string;
}

/**
 * The live data of an element. The client makes this data.
 */
export interface RuntimeRecord {
  /** The instance identity. This value joins the record to the stamp. */
  inst: string;
  /**
   * The evaluated value of each property.
   * Example: { className: 'px-4 mt-2' }
   */
  values: Record<string, string>;
  state: ElementState;
  viewport: Viewport;
}

/** One CSS rule that hits the element. */
export interface StyleRule {
  /** The source position of the rule. Null for a rule made at run time. */
  src: SourcePosition | null;
  selector: string;
  /** The specificity as a string. Example: '0-2-1'. */
  specificity: string;
  /** The origin. Example: 'author', 'user-agent', 'injected'. */
  origin: string;
  properties: Record<string, string>;
  /** True if this rule wins the cascade for at least one property. */
  winner: boolean;
  /** The reason the rule wins or loses. Example: 'higher specificity'. */
  reason: string | null;
}

export type Confidence = 'high' | 'medium' | 'low';

/**
 * The full record for one element. The tool makes this record in Phase 2.
 * The agent gets this record in Phase 3.
 */
export interface ElementRecord {
  inst: string;
  src: SourcePosition;
  component: string | null;
  /** The expression text for each dynamic property. */
  expressions: Record<string, string>;
  /** The evaluated value for each dynamic property. */
  values: Record<string, string>;
  state: ElementState;
  viewport: Viewport;
  editable: boolean;
  parentSrc: SourcePosition | null;
  styles: StyleRule[];
  /** All other places that use the same component. */
  useSites: SourcePosition[];
  confidence: Confidence;
}

export type ProblemType =
  | 'layout'
  | 'style'
  | 'content'
  | 'access'
  | 'behavior'
  | 'speed';

export type Severity = 'low' | 'medium' | 'high';

/** How the repair moves to other screen widths. */
export type PropagateMode = 'auto' | 'always' | 'never';

/** The structured problem from the user. */
export interface Problem {
  type: ProblemType;
  severity: Severity;
  /** The words of the user. */
  text: string;
  /** The wanted result. Can be null. */
  expected: string | null;
  propagate: PropagateMode;
  /** The screen widths of the problem. */
  viewports: Viewport[];
}

export type TaskState =
  | 'queued'
  | 'working'
  | 'waiting'
  | 'verifying'
  | 'done'
  | 'failed'
  | 'rejected';

/** The check result of one task. */
export interface Evidence {
  /** The picture paths before the repair. */
  before: string[];
  /** The picture paths after the repair. */
  after: string[];
  accessOk: boolean;
  typecheckOk: boolean;
  lintOk: boolean;
  /** True if the pixels got worse at a screen width. */
  regression: boolean;
}

/** One task for one agent. */
export interface Task {
  id: string;
  /** The project name. */
  project: string;
  /** The route of the page. */
  route: string;
  /** The commit at the time of the mark. */
  commit: string;
  problem: Problem;
  record: ElementRecord;
  state: TaskState;
  /** The short plan of the agent. Null before the plan exists. */
  plan: string | null;
  /** The files that the agent changes. */
  files: string[];
  cost: number;
  tries: number;
  diff: string | null;
  evidence: Evidence | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One marked element. The extension sends this to the companion.
 *
 * The stamp holds the static data. The compiler makes it.
 * The record holds the live value. The client makes it.
 * The companion joins the two sides into one ElementRecord.
 */
export interface Selection {
  stamp: StaticStamp;
  record: RuntimeRecord;
  /** The address of the page at the time of the mark. */
  tabUrl: string;
}

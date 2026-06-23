export {
  VectorClock,
  initVectorClock,
  getVectorClock,
  type VectorClockSnapshot,
  type ClockComparison,
} from './VectorClock.js';

export {
  DistributedCommsGround,
  initDistributedCommsGround,
  getDistributedCommsGround,
  type DistributedCommsConfig,
  type DistributedCommsStats,
  type Artifact,
} from './DistributedCommsGround.js';

export {
  DistributedRelevanceScorer,
  type DistributedMessage,
} from './DistributedRelevanceScorer.js';

export {
  MessageSummarizer,
  type SummaryMessage,
  type SummarizableMessage,
  type MessageSummarizerConfig,
} from './MessageSummarizer.js';

export {
  DistributedAgentCommunicator,
  initDistributedCommunicator,
  getDistributedCommunicator,
  type DistributedAgentIdentity,
  type TaskScope,
  type DistributedMessageRequest,
  type DistributedMessageResponse,
  type DelegationRequest,
  type DelegationResult,
  type MessageWithCausality,
  type CausalityChain,
} from './DistributedAgentCommunicator.js';

export {
  SharedMemory,
  initSharedMemory,
  getSharedMemory,
  type MemoryEntry,
  type ConflictEvent,
  type SharedMemoryConfig,
  type ConflictResolution,
} from './SharedMemory.js';

export {
  DistributedMemory,
  initDistributedMemory,
  getDistributedMemory,
  type DistributedMemoryEntry,
  type DistributedMemoryConfig,
} from './DistributedMemory.js';

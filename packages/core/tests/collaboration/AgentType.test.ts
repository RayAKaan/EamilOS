import { describe, it, expect } from 'vitest';
import {
  AgentRole,
  AGENT_TYPES,
  getAgentType,
  getAgentCapabilities,
  canDelegate,
  canReceiveDelegation,
  getDependencies,
  getAllRoles,
} from '../../src/collaboration/AgentType.js';

describe('AgentType', () => {
  describe('AgentRole enum', () => {
    it('should have all expected roles', () => {
      const expectedRoles: AgentRole[] = [
        'planner',
        'coder',
        'validator',
        'writer',
        'reviewer',
        'researcher',
        'executor',
      ];

      for (const role of expectedRoles) {
        expect(AGENT_TYPES[role]).toBeDefined();
        expect(AGENT_TYPES[role].role).toBe(role);
      }
    });
  });

  describe('getAgentType', () => {
    it('should return correct agent type config for planner', () => {
      const planner = getAgentType('planner');
      expect(planner.name).toBe('Planner');
      expect(planner.canDelegate).toBe(true);
      expect(planner.canReceiveDelegation).toBe(false);
    });

    it('should return correct agent type config for coder', () => {
      const coder = getAgentType('coder');
      expect(coder.name).toBe('Coder');
      expect(coder.canDelegate).toBe(false);
      expect(coder.canReceiveDelegation).toBe(true);
    });

    it('should have capabilities for each role', () => {
      for (const role of getAllRoles()) {
        const agentType = getAgentType(role);
        expect(agentType.capabilities.length).toBeGreaterThan(0);
      }
    });
  });

  describe('getAgentCapabilities', () => {
    it('should return capabilities for coder', () => {
      const capabilities = getAgentCapabilities('coder');
      expect(capabilities).toContainEqual(
        expect.objectContaining({ name: 'code-generation' })
      );
    });
  });

  describe('canDelegate', () => {
    it('should return true for planner', () => {
      expect(canDelegate('planner')).toBe(true);
    });

    it('should return false for coder', () => {
      expect(canDelegate('coder')).toBe(false);
    });
  });

  describe('canReceiveDelegation', () => {
    it('should return false for planner', () => {
      expect(canReceiveDelegation('planner')).toBe(false);
    });

    it('should return true for coder', () => {
      expect(canReceiveDelegation('coder')).toBe(true);
    });
  });

  describe('getDependencies', () => {
    it('should return planner has no dependencies', () => {
      expect(getDependencies('planner')).toEqual([]);
    });

    it('should return coder depends on planner', () => {
      expect(getDependencies('coder')).toContain('planner');
    });

    it('should return validator depends on planner and coder', () => {
      const deps = getDependencies('validator');
      expect(deps).toContain('planner');
      expect(deps).toContain('coder');
    });
  });

  describe('getAllRoles', () => {
    it('should return all 7 roles', () => {
      const roles = getAllRoles();
      expect(roles).toHaveLength(7);
      expect(roles).toContain('planner');
      expect(roles).toContain('coder');
      expect(roles).toContain('validator');
    });
  });
});

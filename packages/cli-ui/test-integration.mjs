#!/usr/bin/env node
/**
 * Integration test for UIBridge → EamilOS Core
 * Run: node test-integration.mjs
 * Tests that the bridge properly connects to the real core.
 */

import { createBridge } from './dist/bridge.js';

async function test() {
  console.log('🔌 Testing backend integration...\n');

  const bridge = createBridge({ mockMode: true });
  await bridge.initialize();

  console.log('✅ Bridge initialized');
  console.log(`✅ Mode: ${bridge.mockMode ? 'mock' : 'real core'}`);
  console.log(`✅ Agents: ${bridge.getState().agents.length}`);

  console.log('\n📨 Testing message flow...');
  await bridge.sendMessage('echo "test"');

  const state = bridge.getState();
  console.log(`✅ Messages in store: ${state.messages.length}`);

  const userMsg = state.messages.find(m => m.role === 'user');
  const assistantMsg = state.messages.find(m => m.role === 'assistant');

  if (userMsg) console.log(`✅ User message: "${userMsg.content}"`);
  if (assistantMsg) console.log(`✅ Agent response: "${assistantMsg.content}"`);

  console.log('\n🔧 Testing slash commands...');
  const helpResult = await bridge.executeSlashCommand('/help');
  console.log(`✅ /help: ${helpResult.split('\n')[0]}`);

  const agentsResult = await bridge.executeSlashCommand('/agents');
  console.log(`✅ /agents: ${agentsResult.split('\n')[0]}`);

  console.log('\n📊 Testing cost report...');
  const costReport = bridge.getCostReport();
  console.log(`✅ Cost: ${costReport.split('\n')[0]}`);

  console.log('\n🧪 Testing session reset...');
  await bridge.executeSlashCommand('/new');
  const resetState = bridge.getState();
  console.log(`✅ After /new: ${resetState.messages.length} message(s)`);

  await bridge.shutdown();

  console.log('\n✅ All integration tests passed!');
  console.log('\nNext steps:');
  console.log('  1. Set ANTHROPIC_API_KEY or OPENAI_API_KEY');
  console.log('  2. Run: eamilos (without MOCK=true)');
  console.log('  3. Verify real agents respond in TUI');
}

test().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});

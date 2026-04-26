import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Dashboard } from './views/Dashboard';
import { TaskRunner } from './views/TaskRunner';
import { AgentDetail } from './views/AgentDetail';
import { ConfigView } from './views/ConfigView';
import { HelpOverlay, CommandPalette } from './components/HelpOverlay';
import { SearchBar } from './components/SearchBar';
import { SplitView } from './components/SplitView';
import { useKeyboard } from '../hooks/useKeyboard';
import type { UIBridge } from '../bridge';
import { loadWorkspace, saveWorkspace, createWorkspace } from '../state/workspace';

export type View = 'dashboard' | 'task-runner' | 'agent-detail' | 'config';

export interface RouterProps {
  bridge: UIBridge;
}

export const Router: React.FC<RouterProps> = ({ bridge }) => {
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [viewData, setViewData] = useState<any>({});

  useEffect(() => {
    const saved = loadWorkspace();
    if (saved) {
      setCurrentView(saved.view as View);
    }
  }, []);

  useEffect(() => {
    const workspace = createWorkspace(currentView);
    saveWorkspace(workspace);
  }, [currentView]);

  useKeyboard((keyId) => {
    const key = keyId.toLowerCase();

    if (key === 'd') {
      setCurrentView('dashboard');
    } else if (key === 'r') {
      setCurrentView('task-runner');
    } else if (key === 'a') {
      setCurrentView('agent-detail');
    } else if (key === 'c') {
      setCurrentView('config');
    } else if (key === 'ctrl+p') {
      setViewData((prev: any) => ({ ...prev, showPalette: true }));
    } else if (key === 'ctrl+\\') {
      setViewData((prev: any) => ({ ...prev, splitView: !prev.splitView }));
    } else if (key === '/') {
      setViewData((prev: any) => ({ ...prev, showSearch: true }));
    } else if (key === '?') {
      setViewData((prev: any) => ({ ...prev, showHelp: true }));
    } else if (key === 'escape') {
      setViewData({});
    } else if (key === 'q') {
      bridge.shutdown().then(() => process.exit(0));
    }
  });

  const handleSelectAgent = (agentId: string) => {
    setViewData({ agentId });
    setCurrentView('agent-detail');
  };

  const handleSelectTask = (task: any) => {
    setViewData({ task });
    setCurrentView('task-runner');
  };

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <Dashboard bridge={bridge} onSelectAgent={handleSelectAgent} onSelectTask={handleSelectTask} />;
      case 'task-runner':
        return <TaskRunner bridge={bridge} task={viewData.task} onBack={() => setCurrentView('dashboard')} />;
      case 'agent-detail':
        return <AgentDetail bridge={bridge} agentId={viewData.agentId} onBack={() => setCurrentView('dashboard')} />;
      case 'config':
        return <ConfigView bridge={bridge} />;
    }
  };

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <ViewTabs active={currentView} />
      <Box flexGrow={1}>
        {renderView()}
      </Box>
      {viewData.showHelp && <HelpOverlay onClose={() => setViewData((p: any) => ({ ...p, showHelp: false }))} />}
      {viewData.showPalette && <CommandPalette bridge={bridge} onClose={() => setViewData((p: any) => ({ ...p, showPalette: false }))} />}
    </Box>
  );
};

const ViewTabs: React.FC<{ active: View }> = ({ active }) => {
  const tabs: { id: View; label: string; key: string }[] = [
    { id: 'dashboard', label: 'Dashboard', key: 'd' },
    { id: 'task-runner', label: 'Run Task', key: 'r' },
    { id: 'agent-detail', label: 'Agents', key: 'a' },
    { id: 'config', label: 'Config', key: 'c' }
  ];

  return (
    <Box paddingX={2}>
      {tabs.map((tab) => (
        <Box key={tab.id} marginRight={3}>
          <Text color={active === tab.id ? 'cyan' : 'gray'} bold={active === tab.id}>
            {active === tab.id ? '*' : 'o'} {tab.label} ({tab.key})
          </Text>
        </Box>
      ))}
    </Box>
  );
};